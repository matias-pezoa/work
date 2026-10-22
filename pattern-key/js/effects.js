/* ==========================================================
   effects.js — efectos visuales sobre el video

   Todos los efectos trabajan sobre una copia reducida del frame
   (máx. MAX_W px de ancho) y el render la reescala al tamaño del
   video. Así el costo por frame es predecible también en móvil.

     render()  → efecto aplicado a TODO el frame   (vista EFFECT)
     masked()  → el mismo efecto recortado por la máscara
                 (canal alfa), listo para dibujar sobre el
                 video original                    (vista COMPOSITE)

   Intensidad 0..100 → cada efecto la traduce a su propia escala.
   ========================================================== */

const MAX_W = 800;

export class EffectRenderer {
  constructor() {
    this.W = 0;
    this.H = 0;
    this.src = document.createElement("canvas");     // frame reducido
    this.out = document.createElement("canvas");     // efecto
    this.small = document.createElement("canvas");   // auxiliar (pixelado, blur, mapas)
    this.maskCv = document.createElement("canvas");  // máscara en alfa
    this.comp = document.createElement("canvas");    // efecto ∩ máscara
    this.sctx = this.src.getContext("2d", { willReadFrequently: true });
    this.octx = this.out.getContext("2d", { willReadFrequently: true });
    this.smctx = this.small.getContext("2d", { willReadFrequently: true });
    this.seed = 1;
  }

  #resize(w, h) {
    const k = Math.min(1, MAX_W / w);
    const W = Math.max(1, Math.round(w * k));
    const H = Math.max(1, Math.round(h * k));
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    for (const c of [this.src, this.out, this.maskCv, this.comp]) {
      c.width = W; c.height = H;
    }
    this.outData = new ImageData(W, H);
    this.rowOff = new Int32Array(H);
    this.colOff = new Int32Array(W);
  }

  /**
   * Aplica `effect` a `drawable` y devuelve el canvas resultante (W×H).
   * @param {number} t  tiempo en segundos (para los efectos animados)
   */
  render(drawable, w, h, effect, intensity, t) {
    this.#resize(w, h);
    const { W, H } = this;
    this.sctx.drawImage(drawable, 0, 0, W, H);
    const amt = Math.max(0, Math.min(1, intensity / 100));

    switch (effect) {
      case "pixelate":     this.#pixelate(amt); break;
      case "blur":         this.#blur(amt); break;
      case "distortion":   this.#pixels(amt, t, this.#distortion); break;
      case "rgbshift":     this.#pixels(amt, t, this.#rgbShift); break;
      case "noise":        this.#pixels(amt, t, this.#noise); break;
      case "displacement": this.#pixels(amt, t, this.#displacement); break;
      default:             this.octx.drawImage(this.src, 0, 0);
    }
    return this.out;
  }

  /** El último efecto, visible solo donde la máscara es blanca. */
  masked(masker) {
    const { W, H } = this;
    const mctx = this.maskCv.getContext("2d");
    mctx.clearRect(0, 0, W, H);
    masker.draw(mctx, W, H);

    const c = this.comp.getContext("2d");
    c.save();
    c.globalCompositeOperation = "copy";
    c.drawImage(this.out, 0, 0);
    c.globalCompositeOperation = "destination-in";
    c.drawImage(this.maskCv, 0, 0);
    c.restore();
    return this.comp;
  }

  // ---------- efectos que solo reescalan (baratos, sin leer píxeles) ----------

  #pixelate(amt) {
    const { W, H } = this;
    const block = 2 + Math.round(amt * 30);
    const sw = Math.max(1, Math.round(W / block));
    const sh = Math.max(1, Math.round(H / block));
    this.small.width = sw; this.small.height = sh;
    this.smctx.imageSmoothingEnabled = true;
    this.smctx.drawImage(this.src, 0, 0, sw, sh);
    this.octx.imageSmoothingEnabled = false;
    this.octx.drawImage(this.small, 0, 0, W, H);
    this.octx.imageSmoothingEnabled = true;
  }

  #blur(amt) {
    const { W, H } = this;
    const r = amt * 24;
    const o = this.octx;
    if (typeof o.filter === "string") {
      // primero la imagen nítida: así el borde del blur (que se vuelve
      // semitransparente) no deja ver el frame anterior
      o.drawImage(this.src, 0, 0);
      o.filter = `blur(${r.toFixed(1)}px)`;
      o.drawImage(this.src, 0, 0);
      o.filter = "none";
      return;
    }
    // Safari antiguo no tiene ctx.filter: reducir y ampliar con suavizado
    const k = 1 + r / 2;
    const sw = Math.max(1, Math.round(W / k));
    const sh = Math.max(1, Math.round(H / k));
    this.small.width = sw; this.small.height = sh;
    this.smctx.imageSmoothingEnabled = true;
    this.smctx.drawImage(this.src, 0, 0, sw, sh);
    o.imageSmoothingEnabled = true;
    o.drawImage(this.small, 0, 0, W, H);
  }

  // ---------- efectos por píxel ----------

  #pixels(amt, t, fn) {
    const inp = this.sctx.getImageData(0, 0, this.W, this.H).data;
    const out = this.outData.data;
    fn.call(this, inp, out, amt, t);
    this.octx.putImageData(this.outData, 0, 0);
  }

  /** Ondas: cada fila se desplaza en x y cada columna en y (separable). */
  #distortion(inp, out, amt, t) {
    const { W, H, rowOff, colOff } = this;
    const A = amt * W * 0.045;
    const fy = (Math.PI * 2) / (H * 0.35);
    const fx = (Math.PI * 2) / (W * 0.25);
    for (let y = 0; y < H; y++)
      rowOff[y] = Math.round(A * (Math.sin(y * fy + t * 2.2) + 0.4 * Math.sin(y * fy * 2.7 - t * 3.1)));
    for (let x = 0; x < W; x++)
      colOff[x] = Math.round(A * 0.6 * Math.sin(x * fx + t * 1.6));
    for (let y = 0; y < H; y++) {
      const dx = rowOff[y];
      for (let x = 0; x < W; x++) {
        const sx = clamp(x + dx, 0, W - 1);
        const sy = clamp(y + colOff[x], 0, H - 1);
        copyPx(inp, (sy * W + sx) * 4, out, (y * W + x) * 4);
      }
    }
  }

  /** Separa los canales: rojo hacia un lado, azul hacia el otro. */
  #rgbShift(inp, out, amt, t) {
    const { W, H } = this;
    const off = amt * W * 0.03 * (0.8 + 0.2 * Math.sin(t * 3));
    const ox = Math.round(off), oy = Math.round(off * 0.35);
    for (let y = 0; y < H; y++) {
      const yr = clamp(y + oy, 0, H - 1) * W, yb = clamp(y - oy, 0, H - 1) * W, yg = y * W;
      for (let x = 0; x < W; x++) {
        const i = (yg + x) * 4;
        out[i]     = inp[(yr + clamp(x + ox, 0, W - 1)) * 4];
        out[i + 1] = inp[i + 1];
        out[i + 2] = inp[(yb + clamp(x - ox, 0, W - 1)) * 4 + 2];
        out[i + 3] = 255;
      }
    }
  }

  /** Grano de sensor + líneas de barrido. */
  #noise(inp, out, amt) {
    const n = amt * 180;
    let s = (this.seed = (this.seed * 1664525 + 1013904223) >>> 0) || 1;
    for (let i = 0, p = 0; i < inp.length; i += 4, p++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;       // xorshift32
      const g = ((s >>> 0) / 4294967296 - 0.5) * n;
      const line = ((p / this.W) | 0) % 3 === 0 ? 1 - amt * 0.25 : 1;
      out[i]     = (inp[i] + g) * line;
      out[i + 1] = (inp[i + 1] + g) * line;
      out[i + 2] = (inp[i + 2] + g) * line;
      out[i + 3] = 255;
    }
  }

  /**
   * Desplaza cada píxel según la luminosidad local de la propia imagen:
   * las zonas claras y oscuras del estampado se empujan en sentidos
   * opuestos, y la dirección gira con el tiempo.
   */
  #displacement(inp, out, amt, t) {
    const { W, H } = this;
    // mapa de luminosidad grueso (cada celda ≈ 12 px), suavizado por el reescalado
    const gw = Math.max(2, Math.round(W / 12)), gh = Math.max(2, Math.round(H / 12));
    this.small.width = gw; this.small.height = gh;
    this.smctx.imageSmoothingEnabled = true;
    this.smctx.drawImage(this.src, 0, 0, gw, gh);
    const g = this.smctx.getImageData(0, 0, gw, gh).data;
    const L = new Float32Array(gw * gh);
    for (let i = 0; i < L.length; i++) L[i] = (g[i * 4] * 0.299 + g[i * 4 + 1] * 0.587 + g[i * 4 + 2] * 0.114) / 255 - 0.5;

    const A = amt * W * 0.08;
    const cx = Math.cos(t * 0.8) * A, cy = Math.sin(t * 0.8) * A;
    const kx = (gw - 1) / Math.max(1, W - 1), ky = (gh - 1) / Math.max(1, H - 1);
    for (let y = 0; y < H; y++) {
      const gy = y * ky, y0 = gy | 0, y1 = Math.min(gh - 1, y0 + 1), fy = gy - y0;
      for (let x = 0; x < W; x++) {
        const gx = x * kx, x0 = gx | 0, x1 = Math.min(gw - 1, x0 + 1), fx = gx - x0;
        const top = L[y0 * gw + x0] * (1 - fx) + L[y0 * gw + x1] * fx;
        const bot = L[y1 * gw + x0] * (1 - fx) + L[y1 * gw + x1] * fx;
        const v = top * (1 - fy) + bot * fy;
        const sx = clamp(Math.round(x + v * cx), 0, W - 1);
        const sy = clamp(Math.round(y + v * cy), 0, H - 1);
        copyPx(inp, (sy * W + sx) * 4, out, (y * W + x) * 4);
      }
    }
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function copyPx(inp, i, out, j) {
  out[j] = inp[i];
  out[j + 1] = inp[i + 1];
  out[j + 2] = inp[i + 2];
  out[j + 3] = 255;
}

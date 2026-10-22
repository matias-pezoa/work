/* ==========================================================
   mask.js — del mapa de similitud a una máscara estable

   similitud (0..1)
     → threshold con histéresis (Sensibilidad)
     → morphological open   (borra puntos aislados)
     → morphological close  (rellena huecos dentro de la tela)
     → Gaussian blur        (borde suave, Suavizado)
     → estabilización temporal (Persistencia)
     → máscara 0..255 a resolución de análisis

   La máscara se guarda en el canal alfa de dos canvas (anterior y
   actual), se reescala al tamaño del video al componer, y el
   render loop interpola entre las dos últimas máscaras para que
   el borde no avance "a saltos" (el análisis va a ~12 fps, el
   video a 60).
   ========================================================== */

// Frecuencia de referencia para la persistencia: el slider expresa
// cuánto se conserva de la máscara anterior en cada análisis a 12 fps.
const REF_INTERVAL = 1000 / 12;

// Histéresis: un píxel que YA era rapport necesita un poco menos de
// similitud para seguir siéndolo; uno nuevo necesita un poco más.
// Así los píxeles cerca del umbral no parpadean on/off.
const HYSTERESIS = 0.06;

export class MaskBuilder {
  constructor(cv) {
    this.cv = cv;
    this.w = 0;
    this.h = 0;
    // dos canvas: máscara anterior y actual (para interpolar en el render)
    this.prevCanvas = document.createElement("canvas");
    this.currCanvas = document.createElement("canvas");
    this.debugCanvas = document.createElement("canvas");
    this.updatedAt = 0;    // performance.now() del último update
    this.interval = REF_INTERVAL; // tiempo entre los dos últimos updates
  }

  #resize(w, h) {
    const cv = this.cv;
    this.w = w; this.h = h;
    for (const c of [this.prevCanvas, this.currCanvas, this.debugCanvas]) {
      c.width = w; c.height = h;
    }
    this.imageData = new ImageData(w, h);
    for (const m of ["mBin", "mTmp"]) this[m]?.delete();
    this.mBin = new cv.Mat(h, w, cv.CV_8U);
    this.mTmp = new cv.Mat(h, w, cv.CV_8U);
    this.acc = new Float32Array(w * h);   // máscara acumulada (memoria temporal)
    this.current = new Uint8Array(w * h); // máscara final 0..255
    this.hasHistory = false;
  }

  /** Olvida la historia (al cambiar de rapport o de fuente). */
  reset() {
    this.acc?.fill(0);
    this.current?.fill(0);
    this.hasHistory = false;
  }

  /**
   * @param {Float32Array} sim  mapa de similitud
   * @param {number} w, h
   * @param {object} p  { sensitivity 0..100, smoothing 0..100, persistence 0..95 }
   * @param {number} [now]  tiempo actual (ms) para que la persistencia
   *                        no dependa de la velocidad del análisis
   * @returns {Uint8Array} máscara 0..255 (w×h)
   */
  update(sim, w, h, p, now = performance.now()) {
    const cv = this.cv;
    if (w !== this.w || h !== this.h) this.#resize(w, h);

    // --- 1 · threshold con histéresis: más sensibilidad = umbral más bajo ---
    const threshold = 0.7 - (p.sensitivity / 100) * 0.6; // 0.7 … 0.1
    const on = threshold - HYSTERESIS, off = threshold + HYSTERESIS;
    const bin = this.mBin.data, prevMask = this.current;
    const useHyst = this.hasHistory && p.persistence > 0;
    for (let i = 0; i < bin.length; i++) {
      const t = useHyst ? (prevMask[i] > 127 ? on : off) : threshold;
      bin[i] = sim[i] > t ? 255 : 0;
    }

    // --- 2 · morfología: tamaño del kernel según Suavizado ---
    const s = p.smoothing / 100;
    const kOpen = 1 + 2 * Math.round(s * 2);      // 1, 3, 5
    const kClose = 3 + 2 * Math.round(s * 4);     // 3 … 11
    if (kOpen > 1) {
      const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(kOpen, kOpen));
      cv.morphologyEx(this.mBin, this.mBin, cv.MORPH_OPEN, k);
      k.delete();
    }
    const k2 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(kClose, kClose));
    cv.morphologyEx(this.mBin, this.mBin, cv.MORPH_CLOSE, k2);
    k2.delete();

    // --- 3 · borde suave ---
    const blur = 1 + 2 * Math.round(s * 4);       // 1 … 9
    if (blur > 1) cv.GaussianBlur(this.mBin, this.mTmp, new cv.Size(blur, blur), 0);
    else this.mBin.copyTo(this.mTmp);

    // --- 4 · estabilización temporal ---
    //   maskFinal = previousMask * persistence + currentMask * (1 - persistence)
    // La persistencia se escala con el tiempo real entre análisis:
    // si el análisis va más lento (móvil), cada paso pesa más, y la
    // máscara reacciona a la misma velocidad en segundos.
    const dt = this.updatedAt ? Math.min(500, now - this.updatedAt) : REF_INTERVAL;
    const a = this.hasHistory ? Math.pow((p.persistence ?? 0) / 100, dt / REF_INTERVAL) : 0;
    const cur = this.mTmp.data, acc = this.acc, out = this.current;
    for (let i = 0; i < out.length; i++) {
      const v = acc[i] * a + cur[i] * (1 - a);
      acc[i] = v;
      out[i] = v;
    }
    this.hasHistory = true;

    // --- 5 · publicar: la actual pasa a ser "anterior" en el render ---
    [this.prevCanvas, this.currCanvas] = [this.currCanvas, this.prevCanvas];
    this.#paint(this.currCanvas, out);
    this.interval = this.updatedAt ? Math.min(500, now - this.updatedAt) : REF_INTERVAL;
    this.updatedAt = now;
    return out;
  }

  /**
   * Dibuja la máscara (blanco = rapport) escalada en `ctx`, interpolando
   * entre las dos últimas para que el movimiento sea continuo a 60 fps.
   */
  draw(ctx, w, h, now = performance.now()) {
    if (!this.w) return;
    // prev·(1−f) + curr·f  (con "lighter" la suma es exacta, tanto
    // sobre fondo negro como sobre un canvas transparente)
    const f = Math.min(1, (now - this.updatedAt) / this.interval);
    ctx.save();
    ctx.imageSmoothingEnabled = true; // reescalado bilineal = borde suave
    ctx.globalAlpha = 1 - f;
    ctx.drawImage(this.prevCanvas, 0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = f;
    ctx.drawImage(this.currCanvas, 0, 0, w, h);
    ctx.restore();
  }

  /** Para el debug: un mapa Float32 (0..1) en escala de grises. */
  floatToCanvas(map) {
    const d = this.imageData.data;
    for (let i = 0, j = 0; i < map.length; i++, j += 4) {
      const v = map[i] * 255;
      d[j] = d[j + 1] = d[j + 2] = v;
      d[j + 3] = 255;
    }
    this.debugCanvas.getContext("2d").putImageData(this.imageData, 0, 0);
    return this.debugCanvas;
  }

  // La máscara va en el canal alfa (blanco con opacidad = máscara):
  // sobre negro se ve igual que en gris, y sirve para recortar el
  // efecto con "destination-in" en la vista COMPOSITE.
  #paint(canvas, mask) {
    const d = this.imageData.data;
    for (let i = 0, j = 0; i < mask.length; i++, j += 4) {
      d[j] = d[j + 1] = d[j + 2] = 255;
      d[j + 3] = mask[i];
    }
    canvas.getContext("2d").putImageData(this.imageData, 0, 0);
  }
}

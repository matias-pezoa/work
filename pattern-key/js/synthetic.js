/* ==========================================================
   synthetic.js — escena sintética de prueba
   Simula "una pierna con leggings estampados" que se mueve:
   el rapport cargado se repite en mosaico, se rota, se escala
   y se deforma con ondas, dentro de una silueta en movimiento,
   sobre un fondo con otros colores y texturas.

   Sirve para probar la detección sin cámara y para que los
   estudiantes entiendan qué tiene que resolver el algoritmo.
   No forma parte del pipeline final.
   ========================================================== */

export class SyntheticScene {
  constructor(width = 1280, height = 720) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d");
    this.tile = null;      // canvas con el rapport ya repetido
    this.tileSize = 160;   // tamaño de una repetición en px
    this.patternScale = 1; // escala aparente del estampado (1 = ~90 px por repetición)
    this.bg = this.#makeBackground(width, height);
    // Ruido de sensor que cambia en cada frame, como en una cámara real.
    // Es lo que provoca parpadeo (flickering) en la máscara.
    this.sensorNoise = 1;
    this.freezeAt = null;  // número = congela el movimiento en ese instante
    this.noiseTiles = Array.from({ length: 4 }, () => makeNoiseTile(256));
  }

  get videoWidth() { return this.canvas.width; }
  get videoHeight() { return this.canvas.height; }

  /** Recibe el rapport (HTMLImageElement / canvas) que se "imprime" en la prenda. */
  setRapport(img) {
    const s = this.tileSize;
    const reps = 10; // mosaico grande para poder rotar sin bordes vacíos
    const c = document.createElement("canvas");
    c.width = c.height = s * reps;
    const g = c.getContext("2d");
    for (let y = 0; y < reps; y++)
      for (let x = 0; x < reps; x++) g.drawImage(img, x * s, y * s, s, s);
    this.tile = c;
    this.decoy = dominantColor(img);
  }

  /** Dibuja el frame correspondiente al tiempo t (segundos). */
  draw(t) {
    const noiseT = t;
    if (this.freezeAt != null) t = this.freezeAt; // prenda quieta, solo cambia el ruido
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.drawImage(this.bg, 0, 0);
    if (!this.tile) return;

    // Distractor: una "chaqueta" lisa del MISMO color de fondo del rapport.
    // Un detector que solo mire color la confundiría con el estampado.
    ctx.fillStyle = this.decoy;
    ctx.beginPath();
    ctx.roundRect(W * 0.03, H * 0.55, W * 0.2, H * 0.27, 18);
    ctx.fill();

    for (const leg of this.#legs(t)) {
      ctx.save();
      ctx.translate(leg.x, H * 0.05);
      ctx.rotate(leg.a);
      ctx.clip(this.#legPath(H));

      // Estampado deformado: franjas horizontales desplazadas con ondas
      // (aproxima el estiramiento de la tela sobre la pierna)
      const band = 12;
      const scale = this.patternScale * (0.55 + 0.1 * Math.sin(t * 0.7));
      for (let y = 0; y < H; y += band) {
        const dx = Math.sin(y * 0.012 + t * 2) * 18;
        const sx = 1 + 0.15 * Math.sin(y * 0.006 - t); // estiramiento lateral
        ctx.save();
        ctx.beginPath();
        ctx.rect(-200, y, 400, band + 1);
        ctx.clip();
        ctx.translate(dx, y);
        ctx.scale(scale * sx, scale);
        ctx.rotate(0.08 * Math.sin(t * 0.5));
        // el mosaico es periódico: basta con desplazar "módulo" una repetición
        ctx.drawImage(this.tile, -this.tile.width / 2, -(this.tileSize * 2 + ((y / scale) % this.tileSize)));
        ctx.restore();
      }

      // Sombreado cilíndrico (iluminación no uniforme)
      const shade = ctx.createLinearGradient(-110, 0, 110, 0);
      shade.addColorStop(0, "rgba(0,0,0,0.55)");
      shade.addColorStop(0.45, "rgba(0,0,0,0)");
      shade.addColorStop(0.6, "rgba(255,255,255,0.08)");
      shade.addColorStop(1, "rgba(0,0,0,0.6)");
      ctx.fillStyle = shade;
      ctx.fillRect(-120, 0, 240, H);
      ctx.restore();
    }

    // Una "mano" que tapa parcialmente el estampado (oclusión)
    ctx.fillStyle = "#c58f6b";
    this.#hand(ctx, t, W, H);

    if (this.sensorNoise > 0) {
      // grano + leve variación de exposición, distintos en cada frame
      const k = Math.floor(noiseT * 60);
      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = 0.35 * this.sensorNoise;
      ctx.fillStyle = ctx.createPattern(this.noiseTiles[k % 4], "repeat");
      ctx.translate((k * 37) % 256, (k * 91) % 256);
      ctx.fillRect(-256, -256, W + 512, H + 512);
      ctx.restore();
      ctx.fillStyle = `rgba(0,0,0,${0.06 * this.sensorNoise * (1 + Math.sin(k * 1.7))})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /** Dos "piernas" que oscilan como al caminar. */
  #legs(t) {
    const W = this.canvas.width;
    return [
      { x: W * 0.42 + Math.sin(t * 1.3) * 40, a: Math.sin(t * 1.3) * 0.18 },
      { x: W * 0.60 + Math.sin(t * 1.3 + Math.PI) * 40, a: Math.sin(t * 1.3 + Math.PI) * 0.18 },
    ];
  }

  /** Silueta de una pierna: muslo ancho → tobillo estrecho. */
  #legPath(H) {
    const path = new Path2D();
    path.moveTo(-95, 0);
    path.bezierCurveTo(-110, H * 0.35, -60, H * 0.6, -45, H * 0.95);
    path.lineTo(45, H * 0.95);
    path.bezierCurveTo(60, H * 0.6, 110, H * 0.35, 95, 0);
    path.closePath();
    return path;
  }

  #hand(g, t, W, H) {
    g.beginPath();
    g.ellipse(W * 0.5 + Math.cos(t * 0.9) * 120, H * 0.45, 55, 75, 0.3, 0, Math.PI * 2);
    g.fill();
  }

  /**
   * "Verdad de terreno": dónde está realmente el rapport en el frame t
   * (blanco = estampado visible). Sirve para medir la calidad de la
   * máscara de forma objetiva (precisión / exhaustividad).
   */
  drawTruth(t, g, w, h) {
    if (this.freezeAt != null) t = this.freezeAt;
    const W = this.canvas.width, H = this.canvas.height;
    g.save();
    g.fillStyle = "#000";
    g.fillRect(0, 0, w, h);
    g.scale(w / W, h / H);
    g.fillStyle = "#fff";
    for (const leg of this.#legs(t)) {
      g.save();
      g.translate(leg.x, H * 0.05);
      g.rotate(leg.a);
      g.fill(this.#legPath(H));
      g.restore();
    }
    g.fillStyle = "#000";
    this.#hand(g, t, W, H);
    g.restore();
  }

  /** Fondo: pared con degradado, suelo y algunos objetos de color. */
  #makeBackground(W, H) {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const wall = g.createLinearGradient(0, 0, W, H);
    wall.addColorStop(0, "#d9d2c5");
    wall.addColorStop(1, "#8f8a80");
    g.fillStyle = wall;
    g.fillRect(0, 0, W, H);
    g.fillStyle = "#5b4a3a";
    g.fillRect(0, H * 0.82, W, H * 0.18);
    // objetos con colores saturados (distractores)
    g.fillStyle = "#2f6fb0"; g.fillRect(W * 0.06, H * 0.2, 160, 260);
    g.fillStyle = "#d8432f"; g.beginPath(); g.arc(W * 0.86, H * 0.3, 80, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#e9c341"; g.fillRect(W * 0.8, H * 0.55, 120, 140);
    // ruido de sensor leve
    const img = g.getImageData(0, 0, W, H);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
}

/** Color más frecuente del rapport (cuantización RGB gruesa). */
function dominantColor(img) {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, 32, 32);
  const d = g.getImageData(0, 0, 32, 32).data;
  const counts = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = 0, bestN = -1;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  const r = ((best >> 8) & 15) * 16 + 8, gg = ((best >> 4) & 15) * 16 + 8, b = (best & 15) * 16 + 8;
  return `rgb(${r},${gg},${b})`;
}

function makeNoiseTile(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 255;
    img.data[i] = v + (Math.random() - 0.5) * 40; // algo de ruido de color
    img.data[i + 1] = v;
    img.data[i + 2] = v + (Math.random() - 0.5) * 40;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

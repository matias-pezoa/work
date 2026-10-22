/* ==========================================================
   detector.js — detección experimental del rapport (OpenCV.js)

   Idea central: un rapport NO es un color, es una "receta" de
   colores en ciertas proporciones + una textura con rasgos
   característicos. Como la tela se deforma, NO buscamos una
   transformación geométrica global (homografía); buscamos
   EVIDENCIA LOCAL de que "aquí hay rapport" y la acumulamos en
   un mapa de similitud (0 = nada que ver, 1 = muy parecido).

   Tres señales, cada una con su debilidad compensada por otra:

   A · COLOR (por píxel)  — back-projection por razón (Swain & Ballard)
       Histograma HSV del rapport ÷ histograma del frame.
       Colores que están en el rapport y son raros en el resto de
       la escena → 1. Colores ausentes en el rapport → 0.
       Robusto a rotación, escala y deformación. Débil si el fondo
       comparte colores con el estampado.

   B · RECETA (por bloque) — intersección de histogramas
       Para ventanas de varios tamaños compara la MEZCLA de colores
       del bloque con la del rapport. Un suéter azul marino no tiene
       las flores naranjas y rosadas → puntaje bajo, aunque su color
       base coincida con el fondo del estampado.

   C · RASGOS (ORB)       — keypoints binarios + matching Hamming
       Esquinas/manchas del dibujo del rapport encontradas en el
       frame. Cada coincidencia "vota" en su entorno. Invariante a
       rotación y (parcialmente) a escala. Débil con desenfoque de
       movimiento, tela muy estirada o estampados muy pequeños.

   Mapa final:  sim = √(color · receta)  (+ refuerzo ORB)
   ========================================================== */

// ---------------------------------------------------------------
// Carga de OpenCV.js (≈ 9 MB, se cachea en el navegador)
// ---------------------------------------------------------------
const OPENCV_URLS = [
  "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js",
  "https://docs.opencv.org/4.10.0/opencv.js",
];

let cvReady = null;

export function loadOpenCV() {
  if (cvReady) return cvReady;
  cvReady = (async () => {
    for (const url of OPENCV_URLS) {
      try {
        await injectScript(url);
        // OJO: el módulo de Emscripten tiene un método `then` que se
        // resuelve consigo mismo. Hacer `await cv` (o devolverlo desde
        // una función async) entra en un bucle infinito y congela la
        // página. Por eso esperamos a que exista cv.Mat sondeando, y
        // luego eliminamos `then`.
        // (se envuelve en { cv } para que ninguna Promise lo "desenvuelva")
        const box = await waitFor(() => (window.cv?.Mat ? { cv: window.cv } : null), 60000);
        if (typeof box.cv.then === "function") delete box.cv.then;
        return box;
      } catch (err) {
        console.warn("OpenCV.js no cargó desde", url, err);
      }
    }
    throw new Error("No se pudo cargar OpenCV.js (¿sin conexión?).");
  })();
  return cvReady;
}

function waitFor(fn, timeout) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const tick = () => {
      const v = fn();
      if (v) return resolve(v);
      if (performance.now() - t0 > timeout) return reject(new Error("timeout"));
      setTimeout(tick, 50);
    };
    tick();
  });
}

function injectScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error("network")); };
    document.head.appendChild(s);
  });
}

// ---------------------------------------------------------------
// Cuantización de color HSV → "bins"
// ---------------------------------------------------------------
// OpenCV: H ∈ [0,180), S,V ∈ [0,255].
// · Píxeles poco saturados (grises, blancos, negros): el tono no
//   es fiable → se clasifican solo por luminosidad (N_GRAY bins).
// · Píxeles cromáticos: tono (N_H) × saturación (N_S) × valor (N_V).
//   V usa pocos bins a propósito: las sombras cambian V, no el tono.
const N_H = 18, N_S = 3, N_V = 3, N_GRAY = 4;
const N_CHROMA = N_H * N_S * N_V;
export const N_BINS = N_CHROMA + N_GRAY;
const S_MIN = 45;   // por debajo, el píxel se considera acromático
const V_MIN = 35;   // muy oscuro → acromático (el tono es ruido)

function quantize(h, s, v) {
  if (s < S_MIN || v < V_MIN) return N_CHROMA + Math.min(N_GRAY - 1, (v * N_GRAY) >> 8);
  const hb = Math.min(N_H - 1, ((h * N_H) / 180) | 0);
  const sb = Math.min(N_S - 1, (((s - S_MIN) * N_S) / (256 - S_MIN)) | 0);
  const vb = Math.min(N_V - 1, (((v - V_MIN) * N_V) / (256 - V_MIN)) | 0);
  return (hb * N_S + sb) * N_V + vb;
}

/** Suaviza un histograma entre bins vecinos (tono circular, valor lineal)
 *  para tolerar pequeños cambios de iluminación / balance de blancos. */
function smoothHistogram(hist) {
  const out = new Float32Array(N_BINS);
  for (let hb = 0; hb < N_H; hb++)
    for (let sb = 0; sb < N_S; sb++)
      for (let vb = 0; vb < N_V; vb++) {
        const w = hist[(hb * N_S + sb) * N_V + vb];
        if (!w) continue;
        const spread = [
          [hb, vb, 0.5],
          [(hb + 1) % N_H, vb, 0.15], [(hb + N_H - 1) % N_H, vb, 0.15],
          [hb, Math.min(N_V - 1, vb + 1), 0.1], [hb, Math.max(0, vb - 1), 0.1],
        ];
        for (const [h2, v2, k] of spread) out[(h2 * N_S + sb) * N_V + v2] += w * k;
        // en sombra profunda un color oscuro pierde el tono y cae en el
        // bin gris más oscuro: le damos un poco de crédito
        if (vb === 0) out[N_CHROMA] += w * 0.08;
      }
  for (let g = N_CHROMA; g < N_BINS; g++) {
    out[g] += hist[g] * 0.7;
    if (g > N_CHROMA) out[g - 1] += hist[g] * 0.15; else out[g] += hist[g] * 0.15;
    if (g < N_BINS - 1) out[g + 1] += hist[g] * 0.15; else out[g] += hist[g] * 0.15;
  }
  return normalize(out);
}

/**
 * Marca el "color de fondo" del rapport: el bin más frecuente y sus
 * vecinos (tono ±1, saturación ±1, cualquier valor). Lo usa la señal B
 * para distinguir "estampado" de "superficie lisa del mismo color".
 */
function dominantGroup(hist) {
  const flags = new Uint8Array(N_BINS);
  let top = 0;
  for (let i = 1; i < N_BINS; i++) if (hist[i] > hist[top]) top = i;
  if (top >= N_CHROMA) {
    for (let g = top - 1; g <= top + 1; g++) if (g >= N_CHROMA && g < N_BINS) flags[g] = 1;
    return flags;
  }
  const hb = Math.floor(top / (N_S * N_V)), sb = Math.floor(top / N_V) % N_S;
  for (let dh = -1; dh <= 1; dh++)
    for (let s2 = Math.max(0, sb - 1); s2 <= Math.min(N_S - 1, sb + 1); s2++)
      for (let v2 = 0; v2 < N_V; v2++) flags[(((hb + dh + N_H) % N_H) * N_S + s2) * N_V + v2] = 1;
  flags[N_CHROMA] = 1; // su versión en sombra profunda
  return flags;
}

function normalize(h) {
  let sum = 0;
  for (let i = 0; i < h.length; i++) sum += h[i];
  if (sum > 0) for (let i = 0; i < h.length; i++) h[i] /= sum;
  return h;
}

// ---------------------------------------------------------------
// Detector
// ---------------------------------------------------------------
export class PatternDetector {
  /**
   * @param {object} cv  módulo OpenCV.js ya inicializado
   * @param {object} [opts]
   * @param {number} [opts.cvSize=320]  lado mayor del frame de análisis
   */
  constructor(cv, opts = {}) {
    this.cv = cv;
    this.cvSize = opts.cvSize ?? 320;
    this.cell = 8;                 // tamaño de celda (px) para la señal B
    this.weights = { orb: 0.5 };   // peso del refuerzo ORB
    this.ref = null;               // modelo del rapport
    this.work = document.createElement("canvas");   // frame reducido
    this.workCtx = this.work.getContext("2d", { willReadFrequently: true });
    this.orbCanvas = document.createElement("canvas"); // frame para ORB (2×)
    this.orbCtx = this.orbCanvas.getContext("2d", { willReadFrequently: true });
    this.orb = new cv.ORB(700);
    this.matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
    this.noMask = new cv.Mat();
    // salidas (Float32 0..1, resolución de análisis) — útiles para debug
    this.maps = { color: null, recipe: null, orb: null, sim: null };
    this.width = 0;
    this.height = 0;
    this.timings = {};
  }

  // ===========================================================
  // MODELO DEL RAPPORT
  // ===========================================================
  /** Extrae la "firma" del rapport: histograma de color + rasgos ORB. */
  setReference(canvas) {
    const cv = this.cv;
    this.#freeReference();

    // --- A/B · histograma HSV del rapport ---
    const rgba = cv.imread(canvas);
    const hist = new Float32Array(N_BINS);
    const hsv = new cv.Mat();
    cv.cvtColor(rgba, hsv, cv.COLOR_RGBA2RGB);
    cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
    const d = hsv.data;
    for (let i = 0; i < d.length; i += 3) hist[quantize(d[i], d[i + 1], d[i + 2])]++;
    hsv.delete();
    normalize(hist);
    const dominant = dominantGroup(hist);
    const histSmooth = smoothHistogram(hist);
    // bins casi vacíos (antialiasing, compresión JPG) = ruido → fuera
    for (let i = 0; i < N_BINS; i++) if (histSmooth[i] < 0.003) histSmooth[i] = 0;
    normalize(histSmooth);
    rgba.delete();
    // masa de los colores "secundarios" (todo lo que no es el color de fondo)
    let minorMass = 0;
    for (let i = 0; i < N_BINS; i++) if (!dominant[i]) minorMass += histSmooth[i];

    // --- C · rasgos ORB sobre el rapport repetido 2×2 ---
    // El rapport es un módulo que se repite: al teselarlo, los motivos
    // cortados por el borde quedan completos y generan rasgos válidos.
    const side = 256;
    const k = side / Math.max(canvas.width, canvas.height);
    const tw = Math.round(canvas.width * k), th = Math.round(canvas.height * k);
    const tiled = document.createElement("canvas");
    tiled.width = tw * 2; tiled.height = th * 2;
    const tctx = tiled.getContext("2d");
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) tctx.drawImage(canvas, x * tw, y * th, tw, th);
    const tmat = cv.imread(tiled);
    const gray = new cv.Mat();
    cv.cvtColor(tmat, gray, cv.COLOR_RGBA2GRAY);
    const kp = new cv.KeyPointVector();
    const des = new cv.Mat();
    const refOrb = new cv.ORB(1000);
    refOrb.detectAndCompute(gray, this.noMask, kp, des);
    refOrb.delete(); tmat.delete(); gray.delete();
    const nKp = kp.size();
    kp.delete();

    this.ref = { hist: histSmooth, dominant, minorMass, des, nKp };
    return {
      colors: histSmooth.reduce((n, v) => n + (v > 0.01 ? 1 : 0), 0),
      keypoints: nKp,
    };
  }

  #freeReference() {
    if (this.ref?.des) this.ref.des.delete();
    this.ref = null;
  }

  // ===========================================================
  // ANÁLISIS DE UN FRAME
  // ===========================================================
  /**
   * @param {CanvasImageSource} source  video o canvas
   * @param {number} sw, sh  tamaño de la fuente
   * @returns {Float32Array} mapa de similitud (this.width × this.height)
   */
  detect(source, sw, sh) {
    if (!this.ref) return null;
    const t0 = performance.now();

    // --- 0 · reducir el frame ---
    const k = this.cvSize / Math.max(sw, sh);
    const w = Math.round(sw * k), h = Math.round(sh * k);
    if (w !== this.width || h !== this.height) this.#resize(w, h);
    this.workCtx.drawImage(source, 0, 0, w, h);
    const rgba = this.workCtx.getImageData(0, 0, w, h);

    // --- cuantizar cada píxel ---
    const bins = this.#quantizeFrame(rgba);
    const t1 = performance.now();

    // --- A · color ---
    this.#colorMap(bins);
    const t2 = performance.now();
    // --- B · receta ---
    this.#recipeMap(bins);
    const t3 = performance.now();
    // --- C · ORB ---
    this.#orbMap(source, sw, sh);
    const t4 = performance.now();

    // --- combinar ---
    const { color, recipe, orb, sim } = this.maps;
    const wo = this.weights.orb;
    for (let i = 0; i < sim.length; i++) {
      // media geométrica: las dos señales deben estar de acuerdo,
      // pero una sola débil no anula del todo a la otra
      const base = Math.sqrt(color[i] * recipe[i]);
      // ORB refuerza: si hay rasgos del rapport, sube la similitud,
      // pero nunca la crea sola donde el color dice "nada".
      sim[i] = Math.min(1, base + wo * orb[i] * Math.sqrt(color[i]));
    }
    this.timings = {
      quant: t1 - t0, color: t2 - t1, recipe: t3 - t2, orb: t4 - t3,
      total: performance.now() - t0,
    };
    return sim;
  }

  #resize(w, h) {
    const cv = this.cv;
    this.width = w; this.height = h;
    this.work.width = w; this.work.height = h;
    this.orbCanvas.width = w * 2; this.orbCanvas.height = h * 2;
    const n = w * h;
    this.maps = {
      color: new Float32Array(n), recipe: new Float32Array(n),
      orb: new Float32Array(n), sim: new Float32Array(n),
    };
    this.bins = new Uint16Array(n);
    this.cellsX = Math.ceil(w / this.cell);
    this.cellsY = Math.ceil(h / this.cell);
    this.cellHist = new Float32Array(this.cellsX * this.cellsY * N_BINS);
    // Mats reutilizables (evita fugas de memoria en WebAssembly)
    for (const m of ["mRGBA", "mRGB", "mHSV", "mF", "mF2"]) this[m]?.delete();
    this.mRGBA = new cv.Mat(h, w, cv.CV_8UC4);
    this.mRGB = new cv.Mat();
    this.mHSV = new cv.Mat();
    this.mF = new cv.Mat(h, w, cv.CV_32F);
    this.mF2 = new cv.Mat();
  }

  #quantizeFrame(rgba) {
    const cv = this.cv;
    this.mRGBA.data.set(rgba.data);
    cv.cvtColor(this.mRGBA, this.mRGB, cv.COLOR_RGBA2RGB);
    cv.cvtColor(this.mRGB, this.mHSV, cv.COLOR_RGB2HSV);
    const d = this.mHSV.data, bins = this.bins;
    for (let i = 0, j = 0; i < bins.length; i++, j += 3) bins[i] = quantize(d[j], d[j + 1], d[j + 2]);
    return bins;
  }

  /** A · back-projection por razón, luego promedio local. */
  #colorMap(bins) {
    const cv = this.cv;
    const model = this.ref.hist;
    const frame = new Float32Array(N_BINS);
    for (let i = 0; i < bins.length; i++) frame[bins[i]]++;
    normalize(frame);
    // razón modelo/frame, saturada en 1
    const ratio = new Float32Array(N_BINS);
    for (let b = 0; b < N_BINS; b++) ratio[b] = frame[b] > 0 ? Math.min(1, model[b] / frame[b]) : 0;

    const f = this.mF.data32F;
    for (let i = 0; i < bins.length; i++) f[i] = ratio[bins[i]];
    // promedio en una ventana ≈ 3 % del frame: "qué proporción de
    // píxeles cercanos tiene colores del rapport"
    const r = Math.max(3, Math.round(this.cvSize * 0.03)) | 1;
    cv.blur(this.mF, this.mF2, new cv.Size(r, r));
    this.maps.color.set(this.mF2.data32F);
  }

  /** B · intersección de histogramas por bloques (multiescala). */
  #recipeMap(bins) {
    const cv = this.cv;
    const { cell, cellsX, cellsY, cellHist, width: w } = this;
    const model = this.ref.hist;
    cellHist.fill(0);
    // histograma de cada celda
    for (let i = 0; i < bins.length; i++) {
      const x = i % w, y = (i / w) | 0;
      const c = ((y / cell) | 0) * cellsX + ((x / cell) | 0);
      cellHist[c * N_BINS + bins[i]]++;
    }
    // bins que el modelo usa (los demás no aportan a la intersección)
    const used = [];
    for (let b = 0; b < N_BINS; b++) if (model[b] > 0) used.push(b);
    const { dominant, minorMass } = this.ref;
    const useMinor = minorMass > 0.08; // rapport casi monocromo → no aplica

    const scores = new Float32Array(cellsX * cellsY);
    const block = new Float32Array(N_BINS);
    for (const R of [2, 3]) {           // ventanas de 5×5 y 7×7 celdas
      for (let cy = 0; cy < cellsY; cy++) {
        for (let cx = 0; cx < cellsX; cx++) {
          let total = 0;
          for (const b of used) block[b] = 0;
          for (let yy = Math.max(0, cy - R); yy <= Math.min(cellsY - 1, cy + R); yy++) {
            for (let xx = Math.max(0, cx - R); xx <= Math.min(cellsX - 1, cx + R); xx++) {
              const base = (yy * cellsX + xx) * N_BINS;
              for (const b of used) block[b] += cellHist[base + b];
              total += cell * cell;
            }
          }
          // intersección: Σ min(bloque_b, modelo_b)
          // y, por separado, la parte de los colores secundarios
          let inter = 0, minor = 0;
          for (const b of used) {
            const v = Math.min(block[b] / total, model[b]);
            inter += v;
            if (!dominant[b]) minor += v;
          }
          // La intersección sola se deja engañar por una superficie lisa
          // del color de fondo del rapport (p. ej. un suéter azul marino
          // vs. leggings azul marino con flores): exigimos además que
          // aparezcan los colores secundarios.
          const total01 = clamp01((inter - 0.2) / 0.45);
          const minor01 = useMinor ? clamp01(minor / (minorMass * 0.4)) : 1;
          const score = total01 * minor01;
          const i = cy * cellsX + cx;
          if (score > scores[i]) scores[i] = score;
        }
      }
    }

    const small = cv.matFromArray(cellsY, cellsX, cv.CV_32F, scores);
    cv.resize(small, this.mF2, new cv.Size(this.width, this.height), 0, 0, cv.INTER_LINEAR);
    small.delete();
    this.maps.recipe.set(this.mF2.data32F);
  }

  /** C · ORB: cada match con el rapport vota en su vecindario. */
  #orbMap(source, sw, sh) {
    const cv = this.cv;
    const out = this.maps.orb;
    out.fill(0);
    if (!this.ref.des || this.ref.des.rows === 0 || this.weights.orb === 0) return;

    const W = this.orbCanvas.width, H = this.orbCanvas.height;
    this.orbCtx.drawImage(source, 0, 0, W, H);
    const src = cv.matFromImageData(this.orbCtx.getImageData(0, 0, W, H));
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    src.delete();
    const kp = new cv.KeyPointVector();
    const des = new cv.Mat();
    this.orb.detectAndCompute(gray, this.noMask, kp, des);
    gray.delete();

    let good = 0;
    if (des.rows > 0) {
      const matches = new cv.DMatchVector();
      this.matcher.match(des, this.ref.des, matches);
      // Umbral absoluto de Hamming (de 256 bits): dos descriptores al
      // azar difieren ~128 bits. No usamos el "ratio test" de Lowe porque
      // el rapport se repite y tiene motivos casi idénticos entre sí.
      const MAX_DIST = 52;
      const f = this.mF.data32F;
      f.fill(0);
      const s = this.width / W;
      for (let i = 0; i < matches.size(); i++) {
        const m = matches.get(i);
        if (m.distance > MAX_DIST) continue;
        const p = kp.get(m.queryIdx).pt;
        const x = Math.min(this.width - 1, (p.x * s) | 0);
        const y = Math.min(this.height - 1, (p.y * s) | 0);
        f[y * this.width + x] += 1 - m.distance / MAX_DIST;
        good++;
      }
      matches.delete();
      // densidad de votos: gaussiana amplia
      const r = (Math.round(this.cvSize * 0.06) | 1);
      const sigma = r / 4;
      cv.GaussianBlur(this.mF, this.mF2, new cv.Size(r, r), sigma);
      const d = this.mF2.data32F;
      // normalización: ~3 votos fuertes en el mismo entorno = saturado
      const norm = 3 / (2 * Math.PI * sigma * sigma);
      for (let i = 0; i < out.length; i++) out[i] = clamp01(d[i] / norm);
    }
    this.lastOrb = { keypoints: kp.size(), good };
    kp.delete();
    des.delete();
  }

  dispose() {
    this.#freeReference();
    for (const m of ["mRGBA", "mRGB", "mHSV", "mF", "mF2"]) this[m]?.delete();
    this.orb.delete();
    this.matcher.delete();
    this.noMask.delete();
  }
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

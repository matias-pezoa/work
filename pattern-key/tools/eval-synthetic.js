/* ==========================================================
   tools/eval-synthetic.js — medición objetiva de la máscara
   (herramienta de desarrollo, no la usa la app)

   Compara la máscara con la "verdad" de la escena sintética.

   evaluate()          frames sueltos, sin memoria temporal:
                       precisión, recall, IoU y señales dentro/fuera.
   evaluateSequence()  6 s de video continuo a 12 fps CON persistencia:
                       además mide el PARPADEO (píxeles que cambian de
                       estado entre frames sin que la prenda se haya
                       movido ahí) y cuánto se pierde por retraso.

   Uso, en la consola del navegador con la app abierta:
     const T = await import("./tools/eval-synthetic.js");
     await T.evaluate({ sensitivity: 60 });
     await T.evaluateSequence({ persistence: 0 });
     await T.evaluateSequence({ persistence: 60 });
   ========================================================== */

const r3 = (x) => +x.toFixed(3);

async function setup() {
  const PK = window.PK;
  for (let i = 0; i < 60 && !PK.detector; i++) await new Promise((r) => setTimeout(r, 250));
  if (!PK.synthetic) document.getElementById("synthBtn").click();
  for (let i = 0; i < 40 && !(PK.detector.ref && PK.synthetic); i++) await new Promise((r) => setTimeout(r, 250));
  const saved = PK.source;
  PK.source = null; // pausa los bucles de la app mientras evaluamos
  const tc = document.createElement("canvas");
  const tg = tc.getContext("2d", { willReadFrequently: true });
  return { PK, saved, tc, tg };
}

/** Analiza el instante t y devuelve { mask, truth } (binarios 0/1). */
function frameAt(PK, tc, tg, t, params) {
  const d = PK.detector, sc = PK.synthetic;
  sc.draw(t);
  const sim = d.detect(sc.canvas, sc.videoWidth, sc.videoHeight);
  // `now` simulado: la persistencia depende del tiempo entre análisis
  const m = PK.masker.update(sim, d.width, d.height, { ...PK.params, ...params }, t * 1000);
  tc.width = d.width; tc.height = d.height;
  sc.drawTruth(t, tg, d.width, d.height);
  const td = tg.getImageData(0, 0, d.width, d.height).data;
  const mask = new Uint8Array(m.length), truth = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) { mask[i] = m[i] > 127; truth[i] = td[i * 4] > 127; }
  return { mask, truth, raw: Uint8Array.from(m) };
}

export async function evaluate(params = {}, ts = [0.3, 1.1, 2.0, 2.9, 3.7, 4.6, 5.5, 6.4]) {
  const { PK, saved, tc, tg } = await setup();
  const d = PK.detector;
  const keys = ["color", "recipe", "orb", "sim"];
  const acc = { tp: 0, fp: 0, fn: 0, ms: 0, orbGood: 0, nIn: 0, nOut: 0, inn: {}, out: {} };
  keys.forEach((k) => (acc.inn[k] = acc.out[k] = 0));

  for (const t of ts) {
    PK.masker.reset(); // frames independientes
    const { mask, truth } = frameAt(PK, tc, tg, t, { persistence: 0, ...params });
    acc.ms += d.timings.total;
    acc.orbGood += d.lastOrb?.good ?? 0;
    for (let i = 0; i < mask.length; i++) {
      const T = truth[i], M = mask[i];
      if (T && M) acc.tp++; else if (!T && M) acc.fp++; else if (T && !M) acc.fn++;
      const bucket = T ? acc.inn : acc.out;
      for (const k of keys) bucket[k] += d.maps[k][i];
      T ? acc.nIn++ : acc.nOut++;
    }
  }
  PK.masker.reset();
  PK.source = saved;

  const res = {
    precision: r3(acc.tp / (acc.tp + acc.fp || 1)),
    recall: r3(acc.tp / (acc.tp + acc.fn || 1)),
    IoU: r3(acc.tp / (acc.tp + acc.fp + acc.fn || 1)),
    ms: r3(acc.ms / ts.length),
    orbMatches: r3(acc.orbGood / ts.length),
  };
  for (const k of keys) res[k + " (dentro/fuera)"] = [r3(acc.inn[k] / acc.nIn), r3(acc.out[k] / acc.nOut)];
  return res;
}

/**
 * Secuencia continua. Devuelve:
 *  IoU      coincidencia media con la verdad (baja si hay retraso o ruido)
 *  flicker  cuánto cambia la intensidad de la máscara entre frames
 *           consecutivos en zonas donde la verdad NO cambió (parpadeo
 *           puro), como % del área real del estampado
 *  lag      % de píxeles donde la verdad cambió pero la máscara no lo
 *           siguió (retraso / estela)
 */
export async function evaluateSequence(params = {}, { seconds = 6, fps = 12, start = 0.5, still = false } = {}) {
  const { PK, saved, tc, tg } = await setup();
  PK.synthetic.freezeAt = still ? 2.0 : null; // still: prenda quieta → todo cambio es parpadeo
  PK.masker.reset();
  let prev = null, iou = 0, flick = 0, lag = 0, n = 0;
  const frames = Math.round(seconds * fps);
  for (let f = 0; f < frames; f++) {
    const t = start + f / fps;
    const cur = frameAt(PK, tc, tg, t, params);
    if (f < fps) { prev = cur; continue; } // 1 s de calentamiento
    let tp = 0, fp = 0, fn = 0, area = 0, toggles = 0, movedN = 0, missed = 0;
    for (let i = 0; i < cur.mask.length; i++) {
      const M = cur.mask[i], T = cur.truth[i];
      if (T) area++;
      if (T && M) tp++; else if (!T && M) fp++; else if (T && !M) fn++;
      if (cur.truth[i] === prev.truth[i]) {
        toggles += Math.abs(cur.raw[i] - prev.raw[i]) / 255;
      } else {
        movedN++;
        if (M !== T) missed++;
      }
    }
    iou += tp / (tp + fp + fn || 1);
    flick += toggles / (area || 1);
    lag += missed / (movedN || 1);
    n++;
    prev = cur;
  }
  PK.masker.reset();
  PK.synthetic.freezeAt = null;
  PK.source = saved;
  return { IoU: r3(iou / n), "flicker %": r3((flick / n) * 100), "lag %": r3((lag / n) * 100) };
}

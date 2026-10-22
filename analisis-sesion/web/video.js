// Análisis no verbal cuadro a cuadro con MediaPipe en el navegador
// (equivalente a _analizar_cuadros de etapas/no_verbal.py).

const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34";
const MODELO_ROSTRO = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
const MODELO_POSE = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";

export const BLENDSHAPES_CLAVE = [
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight", "eyeBlinkLeft", "eyeBlinkRight",
  "jawOpen", "mouthPressLeft", "mouthPressRight", "mouthSmileLeft", "mouthSmileRight",
  "mouthFrownLeft", "mouthFrownRight", "mouthPucker", "mouthRollLower", "mouthRollUpper",
  "noseSneerLeft", "noseSneerRight", "cheekSquintLeft", "cheekSquintRight",
];
const POSE_PUNTOS = { nariz: 0, hombro_i: 11, hombro_d: 12, codo_i: 13, codo_d: 14, muneca_i: 15, muneca_d: 16 };

async function crearDetectores() {
  const { FilesetResolver, FaceLandmarker, PoseLandmarker } = await import(`${MP}/vision_bundle.mjs`);
  const fs = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
  const crear = async (delegate) => Promise.all([
    FaceLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: MODELO_ROSTRO, delegate },
      runningMode: "VIDEO", numFaces: 4,
      outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
    }),
    PoseLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: MODELO_POSE, delegate },
      runningMode: "VIDEO", numPoses: 2,
    }),
  ]);
  try { return await crear("GPU"); } catch { return crear("CPU"); }
}

// Giro, inclinación y ladeo (grados) desde la matriz 4x4 (MediaPipe web la
// entrega en orden de columnas).
function angulos(m) {
  const R = (i, j) => m[j * 4 + i];
  const sy = Math.hypot(R(0, 0), R(1, 0));
  let pitch, yaw, roll;
  if (sy > 1e-6) { pitch = Math.atan2(R(2, 1), R(2, 2)); yaw = Math.atan2(-R(2, 0), sy); roll = Math.atan2(R(1, 0), R(0, 0)); }
  else { pitch = Math.atan2(-R(1, 2), R(1, 1)); yaw = Math.atan2(-R(2, 0), sy); roll = 0; }
  const g = (a) => Math.round((a * 180) / Math.PI * 100) / 100;
  return [g(yaw), g(pitch), g(roll)];
}

function areaCaja(lm) {
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (const p of lm) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  return Math.max(0, (x1 - x0) * (y1 - y0));
}

// Histograma tono-saturación 32x32 (como el de OpenCV) para detectar cortes de cámara
function histograma(ctx) {
  const { data } = ctx.getImageData(0, 0, 160, 90);
  const h = new Float32Array(32 * 32);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let hue = 0;
    if (d) hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
    const s = max ? d / max : 0;
    h[Math.min(31, Math.floor(hue / 11.25)) * 32 + Math.min(31, Math.floor(s * 32))]++;
  }
  return h;
}
function correlacion(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da && db ? num / Math.sqrt(da * db) : 1;
}

function buscar(video, t) {
  return new Promise((ok) => {
    if (Math.abs(video.currentTime - t) < 1e-3) return ok();
    const fin = () => { clearTimeout(tm); video.removeEventListener("seeked", fin); ok(); };
    const tm = setTimeout(fin, 3000);
    video.addEventListener("seeked", fin);
    video.currentTime = t;
  });
}

/**
 * Recorre el video entre `desde` y `hasta` a `fps` cuadros por segundo.
 * Devuelve cuadros crudos: {t, cambio_plano, n_rostros, rostro_area, yaw,
 * pitch, roll, bs:{blendshape: valor}, pose, hombros_ancho, puntos}.
 */
export async function analizarVideo(archivo, { desde = 0, hasta = null, fps = 3, umbralPlano = 0.45, progreso, cancelado }) {
  const [rostro, pose] = await crearDetectores();
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.preload = "auto";
  video.style.cssText = "position:fixed;left:-9999px;width:320px";
  document.body.appendChild(video);
  const url = URL.createObjectURL(archivo);
  video.src = url;
  await new Promise((ok, mal) => { video.onloadeddata = ok; video.onerror = () => mal(new Error("El navegador no puede leer este video (prueba con MP4 H.264 o WebM).")); });
  const fin = Math.min(hasta ?? video.duration, video.duration);
  const lienzo = document.createElement("canvas");
  lienzo.width = 160; lienzo.height = 90;
  const ctx = lienzo.getContext("2d", { willReadFrequently: true });
  const cuadros = [];
  let histPrev = null, tsPrev = -1;
  try {
    for (let t = desde; t <= fin; t += 1 / fps) {
      if (cancelado?.()) break;
      await buscar(video, t);
      ctx.drawImage(video, 0, 0, 160, 90);
      const hist = histograma(ctx);
      const cambio = histPrev ? 1 - correlacion(histPrev, hist) > umbralPlano : false;
      histPrev = hist;
      const ts = Math.max(tsPrev + 1, Math.round(t * 1000));
      tsPrev = ts;
      const c = { t: Math.round((t - desde) * 1000) / 1000, cambio_plano: cambio ? 1 : 0, n_rostros: 0, pose: 0 };

      const rf = rostro.detectForVideo(video, ts);
      c.n_rostros = rf.faceLandmarks.length;
      if (rf.faceLandmarks.length) {
        const areas = rf.faceLandmarks.map(areaCaja);
        const i = areas.indexOf(Math.max(...areas));
        c.rostro_area = Math.round(areas[i] * 1e5) / 1e5;
        const m = rf.facialTransformationMatrixes?.[i];
        if (m) [c.yaw, c.pitch, c.roll] = angulos(m.data);
        const bs = rf.faceBlendshapes?.[i];
        if (bs) {
          c.bs = {};
          for (const cat of bs.categories) if (BLENDSHAPES_CLAVE.includes(cat.categoryName)) c.bs[cat.categoryName] = Math.round(cat.score * 1e4) / 1e4;
        }
      }
      const rp = pose.detectForVideo(video, ts);
      if (rp.landmarks.length) {
        const ancho = (lm) => Math.abs(lm[11].x - lm[12].x);
        const lm = rp.landmarks.reduce((a, b) => (ancho(b) > ancho(a) ? b : a));
        c.pose = 1;
        c.hombros_ancho = Math.round(ancho(lm) * 1e4) / 1e4;
        c.puntos = {};
        for (const [n, k] of Object.entries(POSE_PUNTOS)) {
          const p = lm[k];
          c.puntos[n] = [Math.round(p.x * 1e4) / 1e4, Math.round(p.y * 1e4) / 1e4, Math.round((p.visibility ?? 1) * 1e3) / 1e3];
        }
      }
      cuadros.push(c);
      progreso?.((t - desde) / Math.max(1e-6, fin - desde), c);
    }
  } finally {
    rostro.close(); pose.close();
    URL.revokeObjectURL(url);
    video.remove();
  }
  return cuadros;
}

export function csvCuadros(cuadros) {
  const cols = ["t", "cambio_plano", "n_rostros", "rostro_area", "yaw", "pitch", "roll",
    ...BLENDSHAPES_CLAVE.map((b) => `bs_${b}`), "pose", "hombros_ancho",
    ...Object.keys(POSE_PUNTOS).flatMap((p) => ["x", "y", "v"].map((e) => `${p}_${e}`))];
  const filas = cuadros.map((c) => {
    const f = { ...c };
    for (const b of BLENDSHAPES_CLAVE) f[`bs_${b}`] = c.bs?.[b];
    for (const p of Object.keys(POSE_PUNTOS)) ["x", "y", "v"].forEach((e, i) => { f[`${p}_${e}`] = c.puntos?.[p]?.[i]; });
    return f;
  });
  return "﻿" + [cols.join(","), ...filas.map((f) => cols.map((k) => f[k] ?? "").join(","))].join("\n");
}

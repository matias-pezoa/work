/* ==========================================================
   app.js — orquestador de PATTERN KEY

   Pipeline conceptual:
     rapport de referencia → cámara → detección de textura →
     mapa de similitud → máscara → estabilización temporal →
     efecto → composición con el video original

   Dos bucles independientes:
     · RENDER LOOP  (requestAnimationFrame, ~30–60 fps)
         dibuja la fuente + la última máscara disponible
     · CV LOOP      (~12 fps)
         analiza un frame reducido y actualiza la máscara
   ========================================================== */

// ?v=N evita que el navegador mezcle módulos nuevos con versiones
// viejas en caché (GitHub Pages cachea 10 min). Súbelo en cada deploy
// que cambie los .js, junto con el de index.html.
import { startCamera, startVideoFile, listCameras, stopCamera, cameraErrorMessage } from "./camera.js?v=4";
import { SyntheticScene } from "./synthetic.js?v=4";
import { loadOpenCV, PatternDetector } from "./detector.js?v=4";
import { MaskBuilder } from "./mask.js?v=4";
import { EffectRenderer } from "./effects.js?v=4";

// ---------- Referencias al DOM ----------
const $ = (id) => document.getElementById(id);
const ui = {
  status: $("status"),
  output: $("output"),
  video: $("video"),
  hud: $("hud"),
  stageEmpty: $("stageEmpty"),
  rapportInput: $("rapportInput"),
  exampleBtn: $("exampleBtn"),
  thumb: $("thumb"),
  cameraBtn: $("cameraBtn"),
  cameraSelect: $("cameraSelect"),
  videoInput: $("videoInput"),
  synthBtn: $("synthBtn"),
  viewSeg: $("viewSeg"),
  debugSelect: $("debugSelect"),
  effectSelect: $("effectSelect"),
  recordBtn: $("recordBtn"),
  resetBtn: $("resetBtn"),
  sliders: ["sensitivity", "smoothing", "persistence", "intensity"].reduce((o, k) => {
    o[k] = $(k);
    return o;
  }, {}),
};
const ctx = ui.output.getContext("2d");

// ---------- Estado global ----------
const state = {
  rapport: null,        // canvas con el rapport (máx. 512 px) para el detector
  source: null,         // objeto con videoWidth/videoHeight dibujable (video o escena sintética)
  sourceKind: "none",   // "camera" | "file" | "synthetic"
  synthetic: null,
  view: "original",     // original | mask | effect | composite
  params: null,         // valores de los sliders (ver DEFAULTS)
  fps: 0,
  cvFps: 0,
  // computer vision
  cv: null,
  detector: null,
  masker: null,
  mask: null,           // última máscara calculada (Uint8, resolución CV)
  maskSize: [0, 0],
  effects: new EffectRenderer(),
};

const CV_INTERVAL = 1000 / 12; // CV loop ≈ 12 fps (independiente del render)

const DEFAULTS = { sensitivity: 50, smoothing: 40, persistence: 40, intensity: 60 };
const STORAGE_KEY = "pattern-key:params";

// Acceso desde la consola del navegador para experimentar: PK.detector.maps, PK.params…
window.PK = state;

// ---------- Utilidades de interfaz ----------
function setStatus(msg, isError = false) {
  ui.status.textContent = msg;
  ui.status.classList.toggle("error", isError);
  if (isError) console.error(msg);
}

/** Bloquea controles que todavía no están implementados en esta fase. */
function lock(el, locked = true) {
  const target = el.closest(".slider") || el;
  target.classList.toggle("locked", locked);
  if ("disabled" in el) el.disabled = locked;
}

// Fase 4: todas las vistas y efectos. La grabación llega en la fase 5.
lock(ui.recordBtn);

// ==========================================================
// 1 · CARGA DEL RAPPORT
// ==========================================================
ui.rapportInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!/^image\/(png|jpeg)$/.test(file.type)) {
    setStatus("El rapport debe ser PNG o JPG.", true);
    return;
  }
  const url = URL.createObjectURL(file);
  try {
    await setRapport(url, file.name);
  } finally {
    URL.revokeObjectURL(url);
  }
});

ui.exampleBtn.addEventListener("click", () =>
  setRapport("assets/examples/rapport-ejemplo.svg", "rapport-ejemplo.svg")
);

async function setRapport(url, name) {
  try {
    const img = await loadImage(url);
    // Rasterizamos a un canvas de tamaño acotado: el detector no
    // necesita más de 512 px y así el análisis es predecible.
    const max = 512;
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    state.rapport = c;

    // thumbnail
    ui.thumb.innerHTML = "";
    const t = new Image();
    t.src = c.toDataURL("image/png");
    t.alt = `Rapport: ${name}`;
    ui.thumb.appendChild(t);

    state.synthetic?.setRapport(c);
    state.masker?.reset();
    setStatus(`Rapport cargado: ${name} (${img.naturalWidth}×${img.naturalHeight})`);
    analyzeRapport();
  } catch (err) {
    setStatus("No se pudo leer la imagen del rapport.", true);
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// ==========================================================
// 2 · FUENTES DE VIDEO
// ==========================================================
ui.cameraBtn.addEventListener("click", () => openCamera());
ui.cameraSelect.addEventListener("change", () => openCamera(ui.cameraSelect.value));

async function openCamera(deviceId) {
  setStatus("Solicitando cámara…");
  try {
    await startCamera(ui.video, deviceId);
    useSource(ui.video, "camera");
    setStatus(`Cámara activa ${ui.video.videoWidth}×${ui.video.videoHeight}`);
    await fillCameraSelect(deviceId);
  } catch (err) {
    setStatus(cameraErrorMessage(err), true);
  }
}

async function fillCameraSelect(activeId) {
  const cams = await listCameras();
  if (cams.length < 2) return; // con una sola cámara no hace falta selector
  const current = activeId || ui.video.srcObject?.getVideoTracks()[0]?.getSettings().deviceId;
  ui.cameraSelect.innerHTML = cams
    .map((c, i) => `<option value="${c.deviceId}">${c.label || `Cámara ${i + 1}`}</option>`)
    .join("");
  if (current) ui.cameraSelect.value = current;
  ui.cameraSelect.hidden = false;
}

ui.videoInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    await startVideoFile(ui.video, file);
    useSource(ui.video, "file");
    setStatus(`Video: ${file.name}`);
  } catch (err) {
    setStatus("No se pudo reproducir ese video.", true);
  }
});

ui.synthBtn.addEventListener("click", async () => {
  stopCamera();
  ui.video.pause();
  if (!state.rapport) await setRapport("assets/examples/rapport-ejemplo.svg", "rapport-ejemplo.svg");
  state.synthetic ??= new SyntheticScene(1280, 720);
  state.synthetic.setRapport(state.rapport);
  useSource(state.synthetic.canvas, "synthetic", state.synthetic);
  setStatus("Escena sintética (prueba sin cámara)");
});

/**
 * Define la fuente activa. `drawable` es lo que se dibuja en el canvas;
 * `sizeRef` es de donde leemos el tamaño (video.videoWidth o la escena).
 */
function useSource(drawable, kind, sizeRef = drawable) {
  state.source = { drawable, sizeRef };
  state.sourceKind = kind;
  state.masker?.reset(); // la máscara anterior pertenece a otra imagen
  ui.stageEmpty.hidden = true;
}

// ==========================================================
// 3 · VISUALIZACIÓN
// ==========================================================
ui.viewSeg.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (btn) setView(btn.dataset.view);
});

function setView(view) {
  const btn = ui.viewSeg.querySelector(`button[data-view=${view}]`);
  if (!btn || btn.disabled) return;
  state.view = view;
  ui.viewSeg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
}

// Atajos de teclado: 1 ORIGINAL · 2 MASK · 3 EFFECT · 4 COMPOSITE
const VIEW_KEYS = { 1: "original", 2: "mask", 3: "effect", 4: "composite" };
window.addEventListener("keydown", (e) => {
  if (e.target instanceof Element && e.target.matches("input[type=text], textarea, select")) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (VIEW_KEYS[e.key]) setView(VIEW_KEYS[e.key]);
});

// ---------- Sliders (se recuerdan entre sesiones en este navegador) ----------
function loadParams() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveParams() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.params)); } catch { /* modo privado */ }
}

function applyParams(params) {
  state.params = { ...params };
  for (const [key, input] of Object.entries(ui.sliders)) {
    input.value = state.params[key];
    $(`${key}Out`).textContent = input.value;
  }
}

for (const [key, input] of Object.entries(ui.sliders)) {
  const out = $(`${key}Out`);
  input.addEventListener("input", () => {
    state.params[key] = Number(input.value);
    out.textContent = input.value;
    saveParams();
  });
}

ui.resetBtn.addEventListener("click", () => {
  applyParams(DEFAULTS);
  saveParams();
  state.masker?.reset();
});

applyParams(loadParams());

// ==========================================================
// 4 · COMPUTER VISION LOOP (≈ 12 fps, separado del render)
// ==========================================================
async function initCV() {
  setStatus("Cargando OpenCV.js…");
  try {
    state.cv = (await loadOpenCV()).cv;
    state.detector = new PatternDetector(state.cv, { cvSize: 320 });
    state.masker = new MaskBuilder(state.cv);
    analyzeRapport();
    if (!state.rapport) setStatus("OpenCV listo. Carga un rapport y abre la cámara.");
    cvLoop();
  } catch (err) {
    setStatus(err.message, true);
  }
}

/** Extrae la firma del rapport (cuando hay rapport y OpenCV). */
function analyzeRapport() {
  if (!state.detector || !state.rapport) return;
  const info = state.detector.setReference(state.rapport);
  state.mask = null;
  state.masker?.reset();
  setStatus(`Rapport analizado: ${info.colors} colores dominantes, ${info.keypoints} rasgos ORB`);
}

function cvLoop() {
  const t0 = performance.now();
  const src = state.source;
  if (src && state.detector?.ref) {
    const w = src.sizeRef.videoWidth, h = src.sizeRef.videoHeight;
    if (w && h) {
      try {
        const sim = state.detector.detect(src.drawable, w, h);
        const d = state.detector;
        state.mask = state.masker.update(sim, d.width, d.height, state.params);
        state.maskSize = [d.width, d.height];
      } catch (err) {
        console.error(err);
        setStatus("Error en la detección: " + (err.message || err), true);
      }
    }
  }
  const dt = performance.now() - t0;
  state.cvFps = state.cvFps * 0.8 + (1000 / Math.max(dt, CV_INTERVAL)) * 0.2;
  setTimeout(cvLoop, Math.max(0, CV_INTERVAL - dt));
}

// ==========================================================
// 5 · RENDER LOOP
// ==========================================================
let lastT = performance.now();

function renderLoop(now) {
  requestAnimationFrame(renderLoop);
  const dt = now - lastT;
  lastT = now;
  state.fps = state.fps * 0.9 + (1000 / Math.max(dt, 1)) * 0.1;

  const src = state.source;
  if (!src) return;

  if (state.sourceKind === "synthetic") state.synthetic.draw(now / 1000);

  const w = src.sizeRef.videoWidth;
  const h = src.sizeRef.videoHeight;
  if (!w || !h) return;

  // El canvas de salida adopta la resolución de la fuente
  if (ui.output.width !== w || ui.output.height !== h) {
    ui.output.width = w;
    ui.output.height = h;
  }

  if (state.view === "mask") {
    drawMaskView(w, h);
  } else if (state.view === "effect") {
    ctx.drawImage(renderEffect(src, w, h, now), 0, 0, w, h);
  } else if (state.view === "composite") {
    ctx.drawImage(src.drawable, 0, 0, w, h);
    if (state.mask) {
      renderEffect(src, w, h, now);
      ctx.drawImage(state.effects.masked(state.masker), 0, 0, w, h);
    }
  } else {
    ctx.drawImage(src.drawable, 0, 0, w, h);
  }

  const d = state.detector;
  const t = d?.timings?.total;
  ui.hud.textContent =
    `${state.view.toUpperCase()}  ${w}×${h}  render ${state.fps.toFixed(0)} fps` +
    (t ? `
CV ${d.width}×${d.height}  ${state.cvFps.toFixed(0)} fps  ${t.toFixed(0)} ms` +
         `  (ORB ${d.lastOrb?.good ?? 0}/${d.lastOrb?.keypoints ?? 0})` : "");
}

/** Efecto elegido sobre todo el frame (vista EFFECT, y base de COMPOSITE). */
function renderEffect(src, w, h, now) {
  return state.effects.render(src.drawable, w, h, ui.effectSelect.value, state.params.intensity, now / 1000);
}

/** Vista MASK: blanco = rapport detectado, negro = resto. */
function drawMaskView(w, h) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  if (!state.mask) return;
  const which = ui.debugSelect.value;
  if (which === "mask") {
    // máscara final, interpolada entre los dos últimos análisis
    state.masker.draw(ctx, w, h);
  } else {
    // señales crudas del detector (sin umbral ni persistencia)
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(state.masker.floatToCanvas(state.detector.maps[which]), 0, 0, w, h);
  }
}

requestAnimationFrame(renderLoop);
initCV();

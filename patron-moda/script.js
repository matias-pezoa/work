// Las URLs de los módulos llevan ?v=N para no mezclar archivos viejos del caché
// (GitHub Pages cachea 10 min). Subir N en todos los imports al cambiar un módulo.
import { MEASUREMENT_GROUPS, defaultMeasurements } from "./measurements.js?v=5";
import { buildBodice, mirrorToFullPiece } from "./bodice.js?v=5";
import { renderBodiceSvg, renderRuler, fitScale } from "./render.js?v=5";
import { buildDxf, downloadDxf } from "./dxf.js?v=5";
import { buildSheet, sheetToSvg, sheetToVectorSvg, sheetToPdf } from "./sheet.js?v=5";
import { prepareExportPiece, loadClipper } from "./exportPieces.js?v=5";

// v2: la pinza de espalda pasó a 3 cm y centrada; se descartan medidas guardadas antes.
const STORAGE_KEY = "patron-moda:measurements:v2";


const form = document.getElementById("measurement-form");
const canvas = document.getElementById("pattern-canvas");
const rulerWrap = document.getElementById("ruler-wrap");
const mirrorToggle = document.getElementById("mirror-toggle");
const resetBtn = document.getElementById("reset-btn");
const exportMenu = document.getElementById("export-menu");
const exportForm = document.getElementById("export-form");
const statusLine = document.getElementById("status-line");
const modeCaption = document.getElementById("mode-caption");
const mat = document.getElementById("cutting-mat");
const scaleReadout = document.getElementById("scale-readout");

let measurements = loadMeasurements();

function loadMeasurements() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultMeasurements();
    return { ...defaultMeasurements(), ...JSON.parse(raw) };
  } catch {
    return defaultMeasurements();
  }
}

function saveMeasurements() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(measurements));
  } catch {
    // localStorage puede fallar (modo privado, cuota); no es crítico.
  }
}

function clamp(v, min, max) {
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}

function buildForm() {
  form.innerHTML = "";
  for (const group of MEASUREMENT_GROUPS) {
    const details = document.createElement("details");
    if (group.open) details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = group.label;
    details.appendChild(summary);

    const list = document.createElement("div");
    list.className = "field-list";
    for (const field of group.fields) list.appendChild(buildFieldRow(field));
    details.appendChild(list);

    const section = document.createElement("section");
    section.appendChild(details);
    form.appendChild(section);
  }
  refreshConditionalRows();
}

// Filas con `showIf`: solo visibles mientras su interruptor está activo.
function refreshConditionalRows() {
  for (const row of form.querySelectorAll("[data-show-if]")) {
    row.hidden = !measurements[row.dataset.showIf];
  }
}

function buildToggleRow(field) {
  const row = document.createElement("label");
  row.className = "switch-row";
  const text = document.createElement("span");
  text.textContent = field.label;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(measurements[field.key]);
  input.addEventListener("change", () => {
    measurements[field.key] = input.checked;
    saveMeasurements();
    refreshConditionalRows();
    update();
  });
  row.append(text, input);
  return row;
}

function buildFieldRow(field) {
  if (field.type === "toggle") return buildToggleRow(field);
  if (field.type === "heading") {
    const heading = document.createElement("h3");
    heading.className = "field-heading";
    heading.textContent = field.label;
    return heading;
  }
  const row = document.createElement("div");
  row.className = "spec-row";
  if (field.showIf) row.dataset.showIf = field.showIf;

  const label = document.createElement("label");
  label.htmlFor = `f-${field.key}`;
  label.textContent = field.label;

  const leader = document.createElement("div");
  leader.className = "leader";

  const value = document.createElement("div");
  value.className = "value";
  const number = document.createElement("input");
  number.type = "number";
  number.id = `f-${field.key}`;
  number.min = field.min;
  number.max = field.max;
  number.step = field.step;
  number.value = measurements[field.key];
  const unit = document.createElement("span");
  unit.className = "unit";
  unit.textContent = field.unit;
  value.append(number, unit);

  const range = document.createElement("input");
  range.type = "range";
  range.className = "slider";
  range.min = field.min;
  range.max = field.max;
  range.step = field.step;
  range.value = measurements[field.key];
  range.setAttribute("aria-label", field.label);

  const sync = (v) => {
    const val = clamp(Number(v), field.min, field.max);
    measurements[field.key] = val;
    range.value = val;
    number.value = val;
    saveMeasurements();
    update();
  };
  range.addEventListener("input", (e) => sync(e.target.value));
  number.addEventListener("change", (e) => sync(e.target.value));

  row.append(label, leader, value, range);
  return row;
}

function currentPieces() {
  const { front, back } = buildBodice(measurements);
  if (mirrorToggle.checked) return { front: mirrorToFullPiece(front), back: mirrorToFullPiece(back) };
  return { front, back };
}

// La cuadrícula de la mesa marca 5 cm a la escala actual y se alinea con el
// doblez del delantero y la línea de cintura.
const GRID_CM = 5;

function update() {
  const pieces = currentPieces();
  // El molde llena la mesa: la escala se calcula con el espacio disponible.
  // Se reservan ~56 px de alto para la lectura de escala (arriba) y la regla (abajo).
  const scale = fitScale(pieces, mat.clientWidth, mat.clientHeight - 56);
  canvas.innerHTML = renderBodiceSvg(pieces, { scale });

  const svg = canvas.querySelector("svg");
  const matRect = mat.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  const originX = svgRect.left - matRect.left - mat.clientLeft + Number(svg.dataset.originX);
  const waistY = svgRect.top - matRect.top - mat.clientTop + Number(svg.dataset.waistY);
  const grid = GRID_CM * scale;
  mat.style.backgroundSize = `${grid}px ${grid}px`;
  mat.style.backgroundPosition = `${originX % grid}px ${waistY % grid}px`;

  rulerWrap.innerHTML = renderRuler(20, scale);
  scaleReadout.textContent = `Pantalla: ${scale.toFixed(1)} px/cm · cuadrícula ${GRID_CM} cm`;
  const view = mirrorToggle.checked
    ? "Vista: pieza completa (delantero + espalda espejados sobre el doblez)."
    : "Vista: mitad de pieza — la línea de doblez (punteada) va sobre el centro delantero/espalda.";
  const { front, back } = pieces;
  const side = front.sideMatched
    ? `Costado: delantero ${front.sideLength.toFixed(1)} cm = espalda ${back.sideLength.toFixed(1)} cm (pinza de busto cerrada).`
    : `Costado sin igualar: delantero ${front.sideLength.toFixed(1)} cm / espalda ${back.sideLength.toFixed(1)} cm — revisa pinza de busto o largos de talle.`;
  const dart = measurements.bustDartManual
    ? `Pinza de busto: ${front.bustDartDepth.toFixed(1)} cm (manual).`
    : `Pinza de busto: ${front.bustDartDepth.toFixed(1)} cm (talle delantero − talle espalda).`;
  modeCaption.textContent = `${view} ${dart} ${side}`;
}

buildForm();
mirrorToggle.addEventListener("change", update);
resetBtn.addEventListener("click", () => {
  measurements = defaultMeasurements();
  saveMeasurements();
  buildForm();
  update();
});
// ---------- exportar (menú desplegable con casillas: formato, piezas, contenido) ----------
const PNG_PX_PER_CM = 40; // ~102 dpi
const JSPDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
let jsPdfPromise = null;

function loadJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  jsPdfPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = JSPDF_URL;
    s.onload = () => resolve(window.jspdf.jsPDF);
    s.onerror = () => {
      jsPdfPromise = null;
      reject(new Error("no se pudo cargar jsPDF"));
    };
    document.head.appendChild(s);
  });
  return jsPdfPromise;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- opciones de exportación (casillas) ----------
const EXPORT_KEY = "patron-moda:export:v1";
const EXPORT_DEFAULTS = { format: ["pdf"], piece: ["front", "back"], mold: false, seam: false, seamCm: 1 };

function loadExportOptions() {
  try {
    return { ...EXPORT_DEFAULTS, ...JSON.parse(localStorage.getItem(EXPORT_KEY) ?? "{}") };
  } catch {
    return { ...EXPORT_DEFAULTS };
  }
}

function applyExportOptions(opts) {
  for (const box of exportForm.querySelectorAll('[name="format"]')) box.checked = opts.format.includes(box.value);
  for (const box of exportForm.querySelectorAll('[name="piece"]')) box.checked = opts.piece.includes(box.value);
  exportForm.elements.mold.checked = opts.mold;
  exportForm.elements.seam.checked = opts.seam;
  exportForm.elements.seamCm.value = opts.seamCm;
  exportForm.elements.seamCm.disabled = !opts.seam;
}

function readExportOptions() {
  const checked = (name) => [...exportForm.querySelectorAll(`[name="${name}"]:checked`)].map((b) => b.value);
  const seamInput = exportForm.elements.seamCm;
  return {
    format: checked("format"),
    piece: checked("piece"),
    mold: exportForm.elements.mold.checked,
    seam: exportForm.elements.seam.checked,
    seamCm: clamp(Number(seamInput.value), Number(seamInput.min), Number(seamInput.max)),
  };
}

function saveExportOptions(opts) {
  try {
    localStorage.setItem(EXPORT_KEY, JSON.stringify(opts));
  } catch {
    // no es crítico
  }
}

// Piezas elegidas, ya preparadas (aplanadas y, si corresponde, con margen).
async function exportPieces(opts) {
  const seam = opts.seam ? opts.seamCm : 0;
  const ClipperLib = seam ? await loadClipper() : null;
  const all = currentPieces();
  return opts.piece.map((id) => prepareExportPiece(all[id], { seam, ClipperLib }));
}

function exportFileName(opts, ext) {
  const pieces = opts.piece.map((id) => (id === "front" ? "delantero" : "espalda")).join("-");
  const parts = ["patron", pieces, mirrorToggle.checked ? "completo" : "mitad"];
  if (opts.mold) parts.push("molde");
  if (opts.seam) parts.push(`costura-${String(opts.seamCm).replace(".", "_")}cm`);
  return `${parts.join("-")}.${ext}`;
}

function exportSheet(pieces, opts) {
  const m = measurements;
  const subtitle = `Busto ${m.bust} - Cintura ${m.waist} - Cadera ${m.hip} - Talle del. ${m.frontWaistLength} / esp. ${m.backWaistLength} cm` +
    (mirrorToggle.checked ? " - pieza completa" : " - mitad (doblar en el centro)");
  return buildSheet(pieces, { title: "CUERPO BASE", subtitle, mold: opts.mold, seam: opts.seam ? opts.seamCm : 0 });
}

// CRC-32 para el chunk pHYs del PNG.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Inserta la resolución (px por metro) tras el IHDR, para que el PNG se
// imprima a escala real en programas que respetan los dpi del archivo.
async function withPngResolution(blob, pxPerCm) {
  const src = new Uint8Array(await blob.arrayBuffer());
  const ppm = Math.round(pxPerCm * 100);
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  chunk[16] = 1; // unidad: metro
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  const ihdrEnd = 8 + 25; // firma (8) + IHDR (4 largo + 4 tipo + 13 datos + 4 crc)
  const out = new Uint8Array(src.length + chunk.length);
  out.set(src.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(src.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return new Blob([out], { type: "image/png" });
}

async function exportPng(sheet, filename) {
  const svg = sheetToSvg(sheet, PNG_PX_PER_CM);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("no se pudo dibujar la lámina"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext("2d").drawImage(img, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    downloadBlob(await withPngResolution(blob, PNG_PX_PER_CM), filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function exportPdf(sheet, filename) {
  const jsPDF = await loadJsPdf();
  sheetToPdf(sheet, jsPDF).save(filename);
}

function exportSvg(sheet, filename) {
  downloadBlob(new Blob([sheetToVectorSvg(sheet)], { type: "image/svg+xml" }), filename);
}

const EXPORTERS = {
  pdf: (pieces, opts, name) => exportPdf(exportSheet(pieces, opts), name),
  png: (pieces, opts, name) => exportPng(exportSheet(pieces, opts), name),
  svg: (pieces, opts, name) => exportSvg(exportSheet(pieces, opts), name),
  dxf: (pieces, opts, name) => downloadDxf(buildDxf(pieces, { mold: opts.mold }), name),
};

applyExportOptions(loadExportOptions());
exportForm.addEventListener("change", () => {
  exportForm.elements.seamCm.disabled = !exportForm.elements.seam.checked;
  saveExportOptions(readExportOptions());
});

exportForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const opts = readExportOptions();
  exportForm.elements.seamCm.value = opts.seamCm;
  if (!opts.format.length) return void (statusLine.textContent = "Elige al menos un formato.");
  if (!opts.piece.length) return void (statusLine.textContent = "Elige al menos una pieza.");
  statusLine.textContent = "Generando…";
  try {
    const pieces = await exportPieces(opts);
    for (const fmt of opts.format) await EXPORTERS[fmt](pieces, opts, exportFileName(opts, fmt));
    statusLine.textContent = `Descargado: ${opts.format.map((f) => f.toUpperCase()).join(", ")}.`;
  } catch (err) {
    statusLine.textContent = `Error al exportar: ${err.message}`;
  }
});
// Cerrar el menú al hacer clic fuera de él.
document.addEventListener("click", (e) => {
  if (exportMenu.open && !exportMenu.contains(e.target)) exportMenu.open = false;
});

update();

// Al cambiar el tamaño de la mesa (ventana, panel), se recalcula la escala.
let resizeFrame = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(update);
}).observe(mat);

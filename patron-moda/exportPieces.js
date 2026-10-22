// Prepara las piezas para exportar: todo queda aplanado a polilíneas en cm,
// con el contorno de corte con o sin margen de costura.
//
// Margen de costura: el contorno se desplaza hacia afuera con Clipper (offset
// de polígonos robusto, también en la pinza de busto del costado). En una
// mitad de pieza el doblez no lleva margen: el desplazado se recorta sobre el
// eje del doblez (x = 0). La línea original pasa a ser la línea de costura.

import { flattenChain } from "./dxf.js?v=5";

const CLIPPER_URL = "https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js";
const SCALE = 1000; // Clipper trabaja con enteros: 1 unidad = 0,01 mm
const EPS = 1e-6;
const CLOSE_CM = 0.6;
let clipperPromise = null;

export function loadClipper() {
  if (window.ClipperLib) return Promise.resolve(window.ClipperLib);
  clipperPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = CLIPPER_URL;
    s.onload = () => resolve(window.ClipperLib);
    s.onerror = () => {
      clipperPromise = null;
      reject(new Error("no se pudo cargar Clipper (margen de costura)"));
    };
    document.head.appendChild(s);
  });
  return clipperPromise;
}

function bounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

// flattenChain repite el primer punto al final de un contorno cerrado.
function dropClosingPoint(points) {
  const a = points[0];
  const b = points[points.length - 1];
  return Math.hypot(a.x - b.x, a.y - b.y) < EPS ? points.slice(0, -1) : points;
}

// side: 0 = sin recorte; 1 / -1 = conservar solo x >= 0 / x <= 0 (mitad sobre el doblez).
function offsetLoop(points, seam, ClipperLib, side) {
  const path = points.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
  const offset = (paths, delta) => {
    const co = new ClipperLib.ClipperOffset(3, 0.005 * SCALE);
    co.AddPaths(paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const res = new ClipperLib.Paths();
    co.Execute(res, delta * SCALE);
    return res;
  };
  // Se desplaza de más y se vuelve CLOSE_CM: rellena las muescas angostas que
  // deja la boca de la pinza de busto sin redondear las esquinas.
  let out = offset(offset([path], seam + CLOSE_CM), -CLOSE_CM);

  if (side) {
    const big = 1e4 * SCALE;
    const [x0, x1] = side > 0 ? [0, big] : [-big, 0];
    const rect = [{ X: x0, Y: -big }, { X: x1, Y: -big }, { X: x1, Y: big }, { X: x0, Y: big }];
    const c = new ClipperLib.Clipper();
    c.AddPaths(out, ClipperLib.PolyType.ptSubject, true);
    c.AddPath(rect, ClipperLib.PolyType.ptClip, true);
    const clipped = new ClipperLib.Paths();
    c.Execute(ClipperLib.ClipType.ctIntersection, clipped, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    out = clipped;
  }
  if (!out.length) throw new Error("el margen de costura no produjo un contorno");
  const area = (p) => Math.abs(ClipperLib.Clipper.Area(p));
  const largest = out.reduce((a, b) => (area(b) > area(a) ? b : a));
  return largest.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }));
}

// Abre un contorno cerrado en el tramo que corre sobre el doblez (x = 0):
// el corte queda como polilínea abierta y el doblez como el segmento faltante.
function openAtFold(loop) {
  const on = (p) => Math.abs(p.x) < 1e-4;
  const n = loop.length;
  const start = loop.findIndex((p, i) => on(p) && !on(loop[(i + 1) % n]));
  if (start < 0) return { cut: loop, cutClosed: true, fold: null };
  const rotated = [...loop.slice(start), ...loop.slice(0, start)];
  let end = rotated.length - 1;
  while (end > 0 && on(rotated[end]) && on(rotated[end - 1])) end--;
  const cut = rotated.slice(0, end + 1);
  return { cut, cutClosed: false, fold: [cut[cut.length - 1], cut[0]] };
}

/**
 * @param piece pieza de bodice.js (mitad o espejada)
 * @param {{seam?: number, ClipperLib?: object}} opts seam en cm (0 = sin margen)
 * @returns {{
 *   id, label, waistY, bounds, darts, guides, apex,
 *   loop,                 contorno de corte cerrado (incluye el doblez)
 *   cut, cutClosed,       contorno de corte para dibujar (sin el tramo del doblez)
 *   fold,                 doblez o línea de centro, o null
 *   stitch, stitchClosed, línea de costura (solo con margen), o null
 * }}
 */
export function prepareExportPiece(piece, { seam = 0, ClipperLib = null } = {}) {
  const cutSegs = piece.outline.filter((s) => !s.fold);
  const foldSegs = piece.outline.filter((s) => s.fold);
  const half = foldSegs.length > 0;
  const outlineLoop = dropClosingPoint(flattenChain(piece.outline));
  const center = piece.centerLine ?? foldSegs;
  const centerPts = center.length ? flattenChain(center) : null;

  let shape;
  if (!seam) {
    shape = { loop: outlineLoop, cut: flattenChain(cutSegs), cutClosed: !half, fold: centerPts, stitch: null, stitchClosed: false };
  } else if (half) {
    const side = piece.bounds.minX >= -EPS ? 1 : -1;
    const loop = offsetLoop(outlineLoop, seam, ClipperLib, side);
    shape = { loop, ...openAtFold(loop), stitch: flattenChain(cutSegs), stitchClosed: false };
  } else {
    const loop = offsetLoop(outlineLoop, seam, ClipperLib, 0);
    shape = { loop, cut: loop, cutClosed: true, fold: centerPts, stitch: outlineLoop, stitchClosed: true };
  }

  return {
    id: piece.id,
    label: piece.label,
    waistY: piece.points.W.y,
    darts: piece.darts,
    guides: piece.guides,
    apex: piece.points.apex ?? null,
    ...shape,
    bounds: bounds(shape.loop),
  };
}

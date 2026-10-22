// Lámina de impresión a escala real (1 unidad = 1 cm) para exportar a PDF y PNG.
//
// Produce una lista de trazos independiente del formato:
//   { kind: "poly", points, closed, style }   style: cut | fold | dart | guide | waist | frame
//   { kind: "dot",  x, y, r }
//   { kind: "text", x, y, text, size, weight }  size en cm
// El eje y crece hacia abajo, como en el resto del sistema.

import { flattenChain } from "./dxf.js?v=4";

export const SHEET_STYLES = {
  cut: { width: 0.05, dash: null, color: "#060606" },
  fold: { width: 0.03, dash: [0.5, 0.4], color: "#060606" },
  dart: { width: 0.03, dash: null, color: "#060606" },
  guide: { width: 0.02, dash: [0.1, 0.3], color: "#4a4a46" },
  waist: { width: 0.015, dash: [0.2, 0.6], color: "#8c8c87" },
  frame: { width: 0.02, dash: null, color: "#060606" },
};

const MARGIN = 2;
const GAP = 6;
const HEADER = 4; // título + datos
const LABEL = 1.5; // espacio para el nombre de cada pieza
const FOOTER = 14; // leyenda + cuadrado de control

const shift = (points, dx, dy) => points.map((p) => ({ x: p.x + dx, y: p.y + dy }));

function pieceItems(piece, dx, dy) {
  const items = [];
  const cut = piece.outline.filter((s) => !s.fold);
  const fold = piece.centerLine ?? piece.outline.filter((s) => s.fold);
  for (const g of piece.guides) items.push({ kind: "poly", points: shift(g.points, dx, dy), style: "guide" });
  items.push({ kind: "poly", points: shift(flattenChain(cut), dx, dy), closed: !fold.length || piece.mirrored, style: "cut" });
  if (fold.length) items.push({ kind: "poly", points: shift(flattenChain(fold), dx, dy), style: "fold" });
  for (const d of piece.darts) items.push({ kind: "poly", points: shift(d.points, dx, dy), closed: !!d.closed, style: "dart" });
  const apex = piece.points.apex;
  if (apex) items.push({ kind: "dot", x: apex.x + dx, y: apex.y + dy, r: 0.15 });
  return items;
}

/**
 * @param {{front, back}} pieces piezas en cm (mitad o completas)
 * @param {{title?: string, subtitle?: string}} info
 * @returns {{width: number, height: number, items: object[]}} medidas en cm
 */
export function buildSheet({ front, back }, info = {}) {
  const fb = front.bounds;
  const bb = back.bounds;
  // Igual que en pantalla: las piezas se alinean por la línea de cintura.
  const above = Math.max(front.points.W.y - fb.minY, back.points.W.y - bb.minY);
  const below = Math.max(fb.maxY - front.points.W.y, bb.maxY - back.points.W.y);
  const waistY = MARGIN + HEADER + LABEL + above;
  const piecesW = fb.width + GAP + bb.width;
  const width = Math.max(MARGIN * 2 + piecesW, 40);
  const height = waistY + below + FOOTER + MARGIN;

  const frontDx = MARGIN - fb.minX;
  const frontDy = waistY - front.points.W.y;
  const backDx = MARGIN + fb.width + GAP - bb.minX;
  const backDy = waistY - back.points.W.y;

  const items = [];
  items.push({ kind: "text", x: MARGIN, y: MARGIN + 1, text: info.title ?? "CUERPO BASE", size: 1.1, weight: "bold" });
  if (info.subtitle) items.push({ kind: "text", x: MARGIN, y: MARGIN + 2.2, text: info.subtitle, size: 0.45 });
  items.push({ kind: "text", x: MARGIN, y: MARGIN + 3, text: "Escala 1:1 - 1 unidad = 1 cm - sin margen de costura", size: 0.45 });

  items.push({ kind: "poly", points: [{ x: MARGIN * 0.5, y: waistY }, { x: width - MARGIN * 0.5, y: waistY }], style: "waist" });

  items.push(...pieceItems(front, frontDx, frontDy));
  items.push({ kind: "text", x: fb.minX + frontDx, y: fb.minY + frontDy - 0.6, text: front.label.toUpperCase(), size: 0.5 });
  items.push(...pieceItems(back, backDx, backDy));
  items.push({ kind: "text", x: bb.minX + backDx, y: bb.minY + backDy - 0.6, text: back.label.toUpperCase(), size: 0.5 });

  // Pie: cuadrado de control de 10 cm + leyenda.
  const footY = waistY + below + 2;
  const sq = [
    { x: MARGIN, y: footY }, { x: MARGIN + 10, y: footY },
    { x: MARGIN + 10, y: footY + 10 }, { x: MARGIN, y: footY + 10 },
  ];
  items.push({ kind: "poly", points: sq, closed: true, style: "frame" });
  items.push({ kind: "text", x: MARGIN + 0.5, y: footY + 5.2, text: "10 x 10 cm", size: 0.5 });
  items.push({ kind: "text", x: MARGIN + 0.5, y: footY + 6, text: "verificar escala al imprimir", size: 0.35 });

  const legendX = MARGIN + 13;
  const legend = [
    ["cut", "Corte"],
    ["fold", "Doblez (CF / CB)"],
    ["dart", "Pinza"],
    ["guide", "Linea de cintura"],
  ];
  legend.forEach(([style, text], i) => {
    const y = footY + 1 + i * 1.2;
    items.push({ kind: "poly", points: [{ x: legendX, y }, { x: legendX + 2, y }], style });
    items.push({ kind: "text", x: legendX + 2.6, y: y + 0.18, text, size: 0.45 });
  });

  return { width, height, items };
}

// ---------- SVG (base del PNG) ----------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function sheetToSvg(sheet, pxPerCm) {
  const k = pxPerCm;
  const parts = [];
  for (const it of sheet.items) {
    if (it.kind === "poly") {
      const st = SHEET_STYLES[it.style];
      const d = it.points.map((p, i) => `${i ? "L" : "M"}${(p.x * k).toFixed(2)} ${(p.y * k).toFixed(2)}`).join(" ") + (it.closed ? " Z" : "");
      const dash = st.dash ? ` stroke-dasharray="${st.dash.map((v) => (v * k).toFixed(2)).join(" ")}"` : "";
      parts.push(`<path d="${d}" fill="none" stroke="${st.color}" stroke-width="${Math.max(1, st.width * k).toFixed(2)}" stroke-linejoin="miter"${dash}/>`);
    } else if (it.kind === "dot") {
      parts.push(`<circle cx="${(it.x * k).toFixed(2)}" cy="${(it.y * k).toFixed(2)}" r="${(it.r * k).toFixed(2)}" fill="#060606"/>`);
    } else if (it.kind === "text") {
      const weight = it.weight === "bold" ? ' font-weight="700"' : "";
      parts.push(`<text x="${(it.x * k).toFixed(2)}" y="${(it.y * k).toFixed(2)}" font-family="'JetBrains Mono', Menlo, Consolas, monospace" font-size="${(it.size * k).toFixed(2)}"${weight} fill="#060606">${esc(it.text)}</text>`);
    }
  }
  const w = Math.round(sheet.width * k);
  const h = Math.round(sheet.height * k);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#ffffff"/>${parts.join("")}</svg>`;
}

// ---------- PDF (jsPDF, vectorial, página del tamaño de la lámina) ----------

export function sheetToPdf(sheet, jsPDF) {
  const { width, height } = sheet;
  const doc = new jsPDF({ unit: "cm", format: [width, height], orientation: width > height ? "landscape" : "portrait" });
  for (const it of sheet.items) {
    if (it.kind === "poly") {
      const st = SHEET_STYLES[it.style];
      doc.setDrawColor(st.color);
      doc.setLineWidth(st.width);
      doc.setLineDashPattern(st.dash ?? [], 0);
      const [first, ...rest] = it.points;
      const deltas = [];
      let prev = first;
      for (const p of rest) {
        deltas.push([p.x - prev.x, p.y - prev.y]);
        prev = p;
      }
      doc.lines(deltas, first.x, first.y, [1, 1], "S", !!it.closed);
    } else if (it.kind === "dot") {
      doc.setFillColor("#060606");
      doc.circle(it.x, it.y, it.r, "F");
    } else if (it.kind === "text") {
      doc.setFont("courier", it.weight === "bold" ? "bold" : "normal");
      // jsPDF usa puntos tipográficos: 1 cm = 28.35 pt.
      doc.setFontSize(it.size * 28.35);
      doc.setTextColor("#060606");
      doc.text(it.text, it.x, it.y);
    }
  }
  doc.setLineDashPattern([], 0);
  return doc;
}

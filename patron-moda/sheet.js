// Lámina a escala real (1 unidad = 1 cm) para exportar a PDF, PNG y SVG.
//
// Produce una lista de trazos independiente del formato:
//   { kind: "poly", points, closed, style }   style: cut | stitch | fold | dart | guide | waist | frame
//   { kind: "dot",  x, y, r }
//   { kind: "text", x, y, text, size, weight }  size en cm
// El eje y crece hacia abajo, como en el resto del sistema.

export const SHEET_STYLES = {
  cut: { width: 0.05, dash: null, color: "#060606" },
  stitch: { width: 0.02, dash: [0.3, 0.2], color: "#4a4a46" },
  fold: { width: 0.03, dash: [0.5, 0.4], color: "#060606" },
  dart: { width: 0.03, dash: null, color: "#060606" },
  guide: { width: 0.02, dash: [0.1, 0.3], color: "#4a4a46" },
  waist: { width: 0.015, dash: [0.2, 0.6], color: "#8c8c87" },
  frame: { width: 0.02, dash: null, color: "#060606" },
};

const MARGIN = 2;
const MOLD_MARGIN = 1; // "solo molde": solo el borde alrededor de las piezas
const GAP = 6;
const HEADER = 4; // título + datos
const LABEL = 1.5; // espacio para el nombre de cada pieza
const FOOTER = 14; // leyenda + cuadrado de control

const shift = (points, dx, dy) => points.map((p) => ({ x: p.x + dx, y: p.y + dy }));

function pieceItems(piece, dx, dy) {
  const items = [];
  for (const g of piece.guides) items.push({ kind: "poly", points: shift(g.points, dx, dy), style: "guide" });
  if (piece.stitch) items.push({ kind: "poly", points: shift(piece.stitch, dx, dy), closed: piece.stitchClosed, style: "stitch" });
  items.push({ kind: "poly", points: shift(piece.cut, dx, dy), closed: piece.cutClosed, style: "cut" });
  if (piece.fold) items.push({ kind: "poly", points: shift(piece.fold, dx, dy), style: "fold" });
  for (const d of piece.darts) items.push({ kind: "poly", points: shift(d.points, dx, dy), closed: !!d.closed, style: "dart" });
  if (piece.apex) items.push({ kind: "dot", x: piece.apex.x + dx, y: piece.apex.y + dy, r: 0.15 });
  return items;
}

/**
 * @param {object[]} pieces piezas preparadas por exportPieces.js (una o varias)
 * @param {{title?: string, subtitle?: string, mold?: boolean, seam?: number}} info
 *   mold: "solo molde" — únicamente el contorno de corte cerrado de cada pieza,
 *   sin textos, guías, pinzas, cintura ni pie.
 * @returns {{width: number, height: number, items: object[]}} medidas en cm
 */
export function buildSheet(pieces, info = {}) {
  const mold = !!info.mold;
  const margin = mold ? MOLD_MARGIN : MARGIN;
  const top = mold ? margin : margin + HEADER + LABEL;
  // Igual que en pantalla: las piezas se alinean por la línea de cintura.
  const above = Math.max(...pieces.map((p) => p.waistY - p.bounds.minY));
  const below = Math.max(...pieces.map((p) => p.bounds.maxY - p.waistY));
  const waistY = top + above;
  const piecesW = pieces.reduce((s, p) => s + p.bounds.width, 0) + GAP * (pieces.length - 1);
  const width = mold ? margin * 2 + piecesW : Math.max(margin * 2 + piecesW, 40);
  const height = waistY + below + (mold ? 0 : FOOTER) + margin;

  const items = [];
  let x = margin;
  const placed = pieces.map((p) => {
    const at = { piece: p, dx: x - p.bounds.minX, dy: waistY - p.waistY };
    x += p.bounds.width + GAP;
    return at;
  });

  if (mold) {
    for (const { piece, dx, dy } of placed) {
      items.push({ kind: "poly", points: shift(piece.loop, dx, dy), closed: true, style: "cut" });
    }
    return { width, height, items };
  }

  const seamNote = info.seam ? `margen de costura ${info.seam} cm incluido` : "sin margen de costura";
  items.push({ kind: "text", x: margin, y: margin + 1, text: info.title ?? "CUERPO BASE", size: 1.1, weight: "bold" });
  if (info.subtitle) items.push({ kind: "text", x: margin, y: margin + 2.2, text: info.subtitle, size: 0.45 });
  items.push({ kind: "text", x: margin, y: margin + 3, text: `Escala 1:1 - 1 unidad = 1 cm - ${seamNote}`, size: 0.45 });

  items.push({ kind: "poly", points: [{ x: margin * 0.5, y: waistY }, { x: width - margin * 0.5, y: waistY }], style: "waist" });

  for (const { piece, dx, dy } of placed) {
    items.push(...pieceItems(piece, dx, dy));
    items.push({ kind: "text", x: piece.bounds.minX + dx, y: piece.bounds.minY + dy - 0.6, text: piece.label.toUpperCase(), size: 0.5 });
  }

  // Pie: cuadrado de control de 10 cm + leyenda.
  const footY = waistY + below + 2;
  const sq = [
    { x: margin, y: footY }, { x: margin + 10, y: footY },
    { x: margin + 10, y: footY + 10 }, { x: margin, y: footY + 10 },
  ];
  items.push({ kind: "poly", points: sq, closed: true, style: "frame" });
  items.push({ kind: "text", x: margin + 0.5, y: footY + 5.2, text: "10 x 10 cm", size: 0.5 });
  items.push({ kind: "text", x: margin + 0.5, y: footY + 6, text: "verificar escala al imprimir", size: 0.35 });

  const legendX = margin + 13;
  const legend = [
    ["cut", "Corte"],
    ...(info.seam ? [["stitch", "Costura"]] : []),
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

// ---------- SVG (base del PNG, y archivo .svg vectorial en cm) ----------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// k: unidades SVG por cm; minStroke: grosor mínimo (1 px en el PNG).
function svgParts(sheet, k, digits, minStroke) {
  const n = (v) => (v * k).toFixed(digits);
  const parts = [];
  for (const it of sheet.items) {
    if (it.kind === "poly") {
      const st = SHEET_STYLES[it.style];
      const d = it.points.map((p, i) => `${i ? "L" : "M"}${n(p.x)} ${n(p.y)}`).join(" ") + (it.closed ? " Z" : "");
      const dash = st.dash ? ` stroke-dasharray="${st.dash.map(n).join(" ")}"` : "";
      parts.push(`<path d="${d}" fill="none" stroke="${st.color}" stroke-width="${Math.max(minStroke, st.width * k).toFixed(digits)}" stroke-linejoin="miter"${dash}/>`);
    } else if (it.kind === "dot") {
      parts.push(`<circle cx="${n(it.x)}" cy="${n(it.y)}" r="${n(it.r)}" fill="#060606"/>`);
    } else if (it.kind === "text") {
      const weight = it.weight === "bold" ? ' font-weight="700"' : "";
      parts.push(`<text x="${n(it.x)}" y="${n(it.y)}" font-family="'JetBrains Mono', Menlo, Consolas, monospace" font-size="${n(it.size)}"${weight} fill="#060606">${esc(it.text)}</text>`);
    }
  }
  return parts.join("\n");
}

export function sheetToSvg(sheet, pxPerCm) {
  const w = Math.round(sheet.width * pxPerCm);
  const h = Math.round(sheet.height * pxPerCm);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#ffffff"/>${svgParts(sheet, pxPerCm, 2, 1)}</svg>`;
}

// 1 unidad = 1 cm y tamaño físico en cm. Sin rectángulo de fondo: al
// importarlo (p. ej. en plataforma-parametrica) el contorno más grande debe
// ser el de la pieza.
export function sheetToVectorSvg(sheet) {
  const w = +sheet.width.toFixed(3);
  const h = +sheet.height.toFixed(3);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}cm" height="${h}cm" viewBox="0 0 ${w} ${h}">
${svgParts(sheet, 1, 3, 0)}
</svg>
`;
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

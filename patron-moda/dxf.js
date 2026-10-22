// Exportador DXF (ASCII, AC1015 / AutoCAD 2000). 1 unidad de dibujo = 1 cm
// ($INSUNITS 5). Las curvas de Bézier se aproximan por muestreo a LWPOLYLINE.

const STEPS_PER_CURVE = 24;

function quadPoint(p0, c, p1, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
    y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y,
  };
}
function cubicPoint(p0, c1, c2, p1, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p1.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p1.y,
  };
}

function flattenSegment(seg) {
  const pts = [];
  if (seg.type === "line") {
    pts.push(seg.p1);
  } else if (seg.type === "quad") {
    for (let i = 1; i <= STEPS_PER_CURVE; i++) pts.push(quadPoint(seg.p0, seg.c, seg.p1, i / STEPS_PER_CURVE));
  } else if (seg.type === "cubic") {
    for (let i = 1; i <= STEPS_PER_CURVE; i++) pts.push(cubicPoint(seg.p0, seg.c1, seg.c2, seg.p1, i / STEPS_PER_CURVE));
  }
  return pts;
}

export function flattenChain(segments) {
  if (!segments.length) return [];
  const pts = [segments[0].p0];
  for (const seg of segments) pts.push(...flattenSegment(seg));
  return pts;
}

let handleCounter = 0x40;
function nextHandle() {
  return (handleCounter++).toString(16).toUpperCase();
}

function lwpolyline(points, { layer, closed = false }) {
  const vertexLines = points.map((p) => `10\n${p.x.toFixed(3)}\n20\n${p.y.toFixed(3)}\n`).join("");
  return (
    `0\nLWPOLYLINE\n5\n${nextHandle()}\n100\nAcDbEntity\n8\n${layer}\n100\nAcDbPolyline\n` +
    `90\n${points.length}\n70\n${closed ? 1 : 0}\n43\n0\n` +
    vertexLines
  );
}

function textEntity(text, x, y, { layer = "ETIQUETAS", height = 1.2 } = {}) {
  return (
    `0\nTEXT\n5\n${nextHandle()}\n100\nAcDbEntity\n8\n${layer}\n100\nAcDbText\n` +
    `10\n${x.toFixed(3)}\n20\n${y.toFixed(3)}\n40\n${height}\n1\n${text}\n`
  );
}

// El patrón usa y hacia abajo; el DXF usa y hacia arriba.
function transformPoints(points, offsetX, offsetY) {
  return points.map((p) => ({ x: p.x + offsetX, y: offsetY - p.y }));
}

const HEADER = `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n9\n$INSUNITS\n70\n5\n0\nENDSEC\n`;

const TABLES =
  `0\nSECTION\n2\nTABLES\n` +
  `0\nTABLE\n2\nLTYPE\n70\n2\n` +
  `0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n` +
  `0\nLTYPE\n2\nDASHED\n70\n0\n3\nDashed line\n72\n65\n73\n2\n40\n0.75\n49\n0.5\n74\n0\n49\n-0.25\n74\n0\n` +
  `0\nENDTAB\n` +
  `0\nTABLE\n2\nLAYER\n70\n4\n` +
  `0\nLAYER\n2\nCORTE\n70\n0\n62\n7\n6\nCONTINUOUS\n` +
  `0\nLAYER\n2\nPINZAS\n70\n0\n62\n1\n6\nCONTINUOUS\n` +
  `0\nLAYER\n2\nGUIAS\n70\n0\n62\n8\n6\nDASHED\n` +
  `0\nLAYER\n2\nETIQUETAS\n70\n0\n62\n7\n6\nCONTINUOUS\n` +
  `0\nENDTAB\n` +
  `0\nENDSEC\n`;

/**
 * Capas: CORTE (contorno cerrado), PINZAS, GUIAS (doblez y línea de cintura), ETIQUETAS.
 */
export function buildDxf(pieces, { gap = 10 } = {}) {
  handleCounter = 0x40;
  const entities = [];
  let cursorX = 0;
  // Las piezas se alinean por la línea de cintura (W.y): en el DXF la cintura
  // de todas queda a la misma altura, `waistY`, y nada baja de y = 0.
  const waistOf = (p) => p.points?.W?.y ?? p.bounds.minY;
  const waistY = Math.max(...pieces.map((p) => p.bounds.maxY - waistOf(p)));

  for (const piece of pieces) {
    const b = piece.bounds;
    const offsetX = cursorX - b.minX;
    const offsetY = waistOf(piece) + waistY;
    cursorX += b.width + gap;

    const foldSegs = piece.centerLine ?? piece.outline.filter((s) => s.fold);
    entities.push(lwpolyline(transformPoints(flattenChain(piece.outline), offsetX, offsetY), { layer: "CORTE", closed: true }));

    if (foldSegs.length) {
      entities.push(lwpolyline(transformPoints(flattenChain(foldSegs), offsetX, offsetY), { layer: "GUIAS" }));
    }
    for (const guide of piece.guides) {
      entities.push(lwpolyline(transformPoints(guide.points, offsetX, offsetY), { layer: "GUIAS" }));
    }
    for (const dart of piece.darts) {
      entities.push(lwpolyline(transformPoints(dart.points, offsetX, offsetY), { layer: "PINZAS", closed: !!dart.closed }));
    }

    const labelPt = transformPoints([{ x: b.minX, y: b.minY - 2 }], offsetX, offsetY)[0];
    entities.push(textEntity(piece.label, labelPt.x, labelPt.y));
  }

  return `${HEADER}${TABLES}0\nSECTION\n2\nENTITIES\n${entities.join("")}0\nENDSEC\n0\nEOF\n`;
}

export function downloadDxf(dxfText, filename = "patron-cuerpo-base.dxf") {
  const blob = new Blob([dxfText], { type: "application/dxf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

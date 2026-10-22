// Dibuja las piezas como SVG. El espacio de la pieza (x derecha, y abajo)
// coincide con el espacio SVG: solo se aplica escala (cm -> px) y traslación.

function segPathData(segments) {
  if (!segments.length) return "";
  let d = `M ${segments[0].p0.x} ${segments[0].p0.y}`;
  for (const seg of segments) {
    if (seg.type === "line") d += ` L ${seg.p1.x} ${seg.p1.y}`;
    else if (seg.type === "quad") d += ` Q ${seg.c.x} ${seg.c.y} ${seg.p1.x} ${seg.p1.y}`;
    else if (seg.type === "cubic") d += ` C ${seg.c1.x} ${seg.c1.y} ${seg.c2.x} ${seg.c2.y} ${seg.p1.x} ${seg.p1.y}`;
  }
  return d;
}

function polyPathData(points, closed) {
  return points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ") + (closed ? " Z" : "");
}

function pieceToSvgGroup(piece, scale) {
  const cutSegs = piece.outline.filter((s) => !s.fold);
  const foldSegs = piece.centerLine ?? piece.outline.filter((s) => s.fold);
  const g = [];
  for (const guide of piece.guides) {
    g.push(`<path class="pattern-guide" d="${polyPathData(guide.points, false)}" transform="scale(${scale})" />`);
  }
  g.push(`<path class="pattern-cut" d="${segPathData(cutSegs)}" transform="scale(${scale})" />`);
  if (foldSegs.length) {
    g.push(`<path class="pattern-fold" d="${segPathData(foldSegs)}" transform="scale(${scale})" />`);
  }
  for (const dart of piece.darts) {
    g.push(`<path class="pattern-dart" d="${polyPathData(dart.points, dart.closed)}" transform="scale(${scale})" />`);
  }
  const apex = piece.points.apex;
  if (apex) g.push(`<circle class="pattern-apex" cx="${apex.x * scale}" cy="${apex.y * scale}" r="2.5" />`);
  return g.join("\n");
}

function shortLabel(label) {
  return label.split(" (")[0].toUpperCase();
}

export function renderBodiceSvg({ front, back }, { scale = 6, margin = 24, gap = 64 } = {}) {
  const fb = front.bounds;
  const bb = back.bounds;
  const frontW = fb.width * scale;
  const frontH = fb.height * scale;
  const backW = bb.width * scale;
  const backH = bb.height * scale;
  const height = Math.max(frontH, backH) + margin * 2 + 16;
  const width = frontW + backW + gap + margin * 2;

  // Se resta minX/minY escalado: una pieza espejada tiene x negativa.
  const frontX = margin - fb.minX * scale;
  const frontY = margin - fb.minY * scale + 16;
  const backX = margin + frontW + gap - bb.minX * scale;
  const backY = margin - bb.minY * scale + 16;

  return `
<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(${frontX}, ${frontY})">
    <text class="pattern-label" x="${fb.minX * scale}" y="-8">${shortLabel(front.label)}</text>
    ${pieceToSvgGroup(front, scale)}
  </g>
  <g transform="translate(${backX}, ${backY})">
    <text class="pattern-label" x="${bb.minX * scale}" y="-8">${shortLabel(back.label)}</text>
    ${pieceToSvgGroup(back, scale)}
  </g>
</svg>`;
}

export function renderRuler(cmSpan, pxPerCm) {
  const w = cmSpan * pxPerCm + 8;
  let ticks = "";
  for (let cm = 0; cm <= cmSpan; cm++) {
    const x = 4 + cm * pxPerCm;
    const major = cm % 5 === 0;
    ticks += `<line class="ruler-tick" x1="${x}" y1="0" x2="${x}" y2="${major ? 14 : 8}" />`;
    if (major) ticks += `<text class="ruler-text" x="${x}" y="26" text-anchor="middle">${cm}</text>`;
  }
  return `<svg width="${w}" height="30"><line class="ruler-tick" x1="4" y1="0" x2="${4 + cmSpan * pxPerCm}" y2="0" />${ticks}</svg>`;
}

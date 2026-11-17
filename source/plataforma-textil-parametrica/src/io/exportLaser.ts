/**
 * Exportadores del modo Corte laser: SVG (en mm, un <g> por capa) y DXF R12
 * (una capa por tipo de corte). Ambos respetan LAYER_ORDER: los cortes
 * interiores primero y el contorno al final, para que la pieza no se suelte
 * de la cama antes de terminar.
 *
 * Colores por capa (convencion habitual para asignar orden/potencia en el
 * software del laser): calados azul, cortes verde, contorno rojo.
 *
 * Funciones puras (salvo `download*`): devuelven el texto del archivo.
 */
import type { CutLayer, CutPath, LaserCutResult, TextLabel } from '../geometry/laserCut'
import { LAYER_ORDER } from '../geometry/laserCut'
import type { SwatchSheet } from '../geometry/laserSwatch'
import type { BedLayout } from '../geometry/laserBed'
import type { Vec2 } from '../geometry/polygon'
import { textToStrokes } from '../geometry/strokeFont'
import type { NumberParam } from '../utils/params'
import { triggerDownload } from './download'

/**
 * Ancho de la ranura con que se cierran los cortes abiertos para CLO3D
 * (`closeOpenCuts` en cloExport.ts, que se carga recien al exportar).
 */
export const CLO_SLOT_PARAM: NumberParam = {
  key: 'cloSlotMm',
  label: 'Ancho del corte cerrado',
  min: 0.1,
  max: 2,
  step: 0.05,
  default: 0.2,
  unit: 'mm',
}

export const LAYER_COLORS: Record<CutLayer, { hex: string; aci: number; name: string }> =
  {
    calado: { hex: '#0000ff', aci: 5, name: 'CALADO' },
    corte: { hex: '#00a000', aci: 3, name: 'CORTE' },
    contorno: { hex: '#ff0000', aci: 1, name: 'CONTORNO' },
  }

/** Margen alrededor de la pieza en el lienzo SVG, en mm. */
const SVG_PAD_MM = 5

const fmt = (n: number) => (Math.abs(n) < 5e-4 ? '0' : n.toFixed(3))

/**
 * Vertices a escribir de un trazo: si es cerrado, se repite el primero al
 * final. La marca de cerrado (`Z`, `s`, flag 70) se mantiene, pero varios
 * programas de laser (RDWorks, LaserCut, algunos importadores de AI) la
 * ignoran: sin el vertice de cierre falta el ultimo lado (p. ej. un lado del
 * marco de la probeta).
 */
export function closedPoints(points: readonly Vec2[], closed: boolean): readonly Vec2[] {
  if (!closed || points.length < 2) return points
  const a = points[0]
  const b = points[points.length - 1]
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6 ? points : [...points, a]
}

/** `d` de un path SVG. El plano XZ se mapea directo a SVG (x -> x, z -> y). */
export function pathData(path: CutPath): string {
  if (path.points.length === 0) return ''
  const [first, ...rest] = closedPoints(path.points, path.closed)
  return (
    `M${fmt(first[0])} ${fmt(first[1])}` +
    rest.map(([x, z]) => `L${fmt(x)} ${fmt(z)}`).join('') +
    (path.closed ? 'Z' : '')
  )
}

/** Texto a grabar (no cortar): rotulos del muestrario, numeros de pieza. */
export type SvgLabel = TextLabel

/** Marco de la cama: referencia visual, en su capa propia para NO cortarlo. */
const FRAME = { hex: '#999999', aci: 8, name: 'CAMA_REFERENCIA_NO_CORTAR' }

export function laserToSvg(
  result: Pick<LaserCutResult, 'paths' | 'bounds'>,
  title = 'Corte laser',
  labels: readonly SvgLabel[] = [],
  frames: readonly (readonly Vec2[])[] = [],
  /** Aire alrededor de `bounds`; 0 = el lienzo mide exactamente `bounds` (cama de probetas). */
  padMm = SVG_PAD_MM,
): string {
  const { minX, maxX, minZ, maxZ } = result.bounds
  const x0 = minX - padMm
  const y0 = minZ - padMm
  const w = maxX - minX + 2 * padMm
  const h = maxZ - minZ + 2 * padMm

  const groups = LAYER_ORDER.map((layer) => {
    const paths = result.paths.filter((p) => p.layer === layer)
    if (paths.length === 0) return ''
    const c = LAYER_COLORS[layer]
    const body = paths.map((p) => `    <path d="${pathData(p)}"/>`).join('\n')
    return `  <g id="${layer}" data-layer="${c.name}" stroke="${c.hex}">\n${body}\n  </g>`
  })
    .filter(Boolean)
    .join('\n')

  // grabado primero: se graba antes de cortar, con la pieza todavia fija.
  const engrave = labels.length
    ? `  <g id="grabado" data-layer="GRABADO" fill="#000000" stroke="none" font-family="Arial, Helvetica, sans-serif" font-weight="bold" text-anchor="middle">
${labels
  .map(
    (l) =>
      `    <text x="${fmt(l.x)}" y="${fmt(l.z)}" font-size="${fmt(l.sizeMm)}"${l.anchor && l.anchor !== 'middle' ? ` text-anchor="${l.anchor}"` : ''}>${escapeXml(l.text)}</text>`,
  )
  .join('\n')}
  </g>
`
    : ''

  const frame = frames.length
    ? `  <g id="cama" data-layer="${FRAME.name}" fill="none" stroke="${FRAME.hex}" stroke-width="0.3" stroke-dasharray="4 3">
${frames.map((f) => `    <path d="${pathData({ layer: 'contorno', points: [...f], closed: true })}"/>`).join('\n')}
  </g>
`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(w)}mm" height="${fmt(h)}mm" viewBox="${fmt(x0)} ${fmt(y0)} ${fmt(w)} ${fmt(h)}">
  <title>${escapeXml(title)}</title>
  <desc>Unidades: mm. Kerf ya compensado. Orden: ${labels.length ? 'grabado, ' : ''}calado, corte, contorno.${frames.length ? ' El grupo "cama" es solo referencia: no cortar.' : ''}</desc>
${frame}${engrave}  <g fill="none" stroke-width="0.1" stroke-linejoin="miter" stroke-linecap="butt">
${groups}
  </g>
</svg>
`
}

function escapeXml(s: string): string {
  return s.replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!,
  )
}

/**
 * DXF R12 (AC1009) en ASCII: la version mas compatible con software de
 * laser (LightBurn, RDWorks, LaserCut...). POLYLINE + VERTEX por trazo.
 * DXF tiene Y hacia arriba, SVG hacia abajo: se invierte Z para que la pieza
 * se vea igual que en la app y en el SVG.
 */
export function laserToDxf(
  result: Pick<LaserCutResult, 'paths'>,
  labels: readonly TextLabel[] = [],
  frames: readonly (readonly Vec2[])[] = [],
): string {
  const out: (string | number)[] = []
  const g = (code: number, value: string | number) => out.push(code, value)
  const extraLayers = [
    ...(labels.length ? [{ name: 'GRABADO', aci: 7 }] : []),
    ...(frames.length ? [{ name: FRAME.name, aci: FRAME.aci }] : []),
  ]
  const polyline = (name: string, points: readonly Vec2[], closed: boolean) => {
    g(0, 'POLYLINE')
    g(8, name)
    g(66, 1)
    g(10, 0)
    g(20, 0)
    g(30, 0)
    g(70, closed ? 1 : 0)
    for (const [x, z] of closedPoints(points, closed)) {
      g(0, 'VERTEX')
      g(8, name)
      g(10, fmt(x))
      g(20, fmt(-z))
      g(30, 0)
    }
    g(0, 'SEQEND')
    g(8, name)
  }

  g(0, 'SECTION')
  g(2, 'HEADER')
  g(9, '$ACADVER')
  g(1, 'AC1009')
  g(9, '$INSUNITS')
  g(70, 4) // milimetros
  g(0, 'ENDSEC')

  g(0, 'SECTION')
  g(2, 'TABLES')
  g(0, 'TABLE')
  g(2, 'LTYPE')
  g(70, 1)
  g(0, 'LTYPE')
  g(2, 'CONTINUOUS')
  g(70, 0)
  g(3, 'Solid line')
  g(72, 65)
  g(73, 0)
  g(40, 0)
  g(0, 'ENDTAB')
  g(0, 'TABLE')
  g(2, 'LAYER')
  const tableLayers = [...LAYER_ORDER.map((layer) => LAYER_COLORS[layer]), ...extraLayers]
  g(70, tableLayers.length)
  for (const layer of tableLayers) {
    g(0, 'LAYER')
    g(2, layer.name)
    g(70, 0)
    g(62, layer.aci)
    g(6, 'CONTINUOUS')
  }
  g(0, 'ENDTAB')
  g(0, 'ENDSEC')

  g(0, 'SECTION')
  g(2, 'ENTITIES')
  for (const f of frames) polyline(FRAME.name, f, true)
  // grabado antes del corte, con la pieza todavia fija.
  for (const l of labels) {
    const align = l.anchor === 'end' ? 2 : l.anchor === 'start' ? 0 : 1
    g(0, 'TEXT')
    g(8, 'GRABADO')
    g(10, fmt(l.x))
    g(20, fmt(-l.z))
    g(30, 0)
    g(40, fmt(l.sizeMm))
    g(1, l.text)
    if (align !== 0) {
      g(72, align)
      g(11, fmt(l.x))
      g(21, fmt(-l.z))
      g(31, 0)
    }
  }
  for (const layer of LAYER_ORDER) {
    const name = LAYER_COLORS[layer].name
    for (const p of result.paths) {
      if (p.layer !== layer || p.points.length < 2) continue
      polyline(name, p.points, p.closed)
    }
  }
  g(0, 'ENDSEC')
  g(0, 'EOF')

  return out.join('\n') + '\n'
}

/** Puntos PostScript por milimetro. */
const PT_PER_MM = 72 / 25.4

/** Colores de trazo CMYK (operador `K`) por capa en el .ai. */
const AI_CMYK: Record<CutLayer, string> = {
  calado: '1 1 0 0',
  corte: '1 0 1 0',
  contorno: '0 1 1 0',
}

/**
 * Adobe Illustrator 3 (.ai): PostScript/EPS de texto plano, el formato "AI"
 * que importan RDWorks, LaserCut, LightBurn y casi cualquier software de
 * laser. Sin capas (llegaron en Illustrator 5): cada tipo de corte va en su
 * grupo (`u`...`U`) con su color de trazo, en LAYER_ORDER, y el software lo
 * asigna por color. Los rotulos se graban como trazos negros (tipografia de
 * trazo, strokeFont.ts) porque el texto AI3 no se lee de forma fiable. El
 * marco de la cama NO se incluye (no hay capa "no cortar"): la mesa de
 * trabajo (`%%BoundingBox`) ya mide lo que la cama.
 *
 * Unidades en puntos (1 mm = 72/25.4 pt), Y hacia arriba como en DXF.
 */
export function laserToAi(
  result: Pick<LaserCutResult, 'paths' | 'bounds'>,
  title = 'Corte laser',
  labels: readonly TextLabel[] = [],
  padMm = SVG_PAD_MM,
): string {
  const { minX, maxX, minZ, maxZ } = result.bounds
  const x0 = minX - padMm
  const z1 = maxZ + padMm
  const wPt = (maxX - minX + 2 * padMm) * PT_PER_MM
  const hPt = (maxZ - minZ + 2 * padMm) * PT_PER_MM
  const px = (x: number) => fmt((x - x0) * PT_PER_MM)
  const py = (z: number) => fmt((z1 - z) * PT_PER_MM)
  const lines: string[] = []
  const path = (points: readonly Vec2[], closed: boolean) => {
    closedPoints(points, closed).forEach(([x, z], k) =>
      lines.push(`${px(x)} ${py(z)} ${k ? 'L' : 'm'}`),
    )
    lines.push(closed ? 's' : 'S')
  }

  lines.push(
    '%!PS-Adobe-2.0 EPSF-1.2',
    '%%Creator: Adobe Illustrator(TM) 3.2',
    `%%Title: (${psString(title)})`,
    '%%For: (Plataforma parametrica textil)',
    `%%BoundingBox: 0 0 ${Math.ceil(wPt)} ${Math.ceil(hPt)}`,
    `%%HiResBoundingBox: 0 0 ${fmt(wPt)} ${fmt(hPt)}`,
    '%%DocumentProcessColors: Cyan Magenta Yellow Black',
    '%%DocumentFonts:',
    `%%TemplateBox: ${fmt(wPt / 2)} ${fmt(hPt / 2)} ${fmt(wPt / 2)} ${fmt(hPt / 2)}`,
    `%%TileBox: 0 0 ${fmt(wPt)} ${fmt(hPt)}`,
    '%%EndComments',
    '%%EndProlog',
    '%%BeginSetup',
    '%%EndSetup',
    // planitud, extremos rectos y uniones en inglete (un extremo redondeado se
    // ve como un semicirculo), trazo fino (0.1 mm), sin guiones
    `0 i 0 J 0 j ${fmt(0.1 * PT_PER_MM)} w 4 M []0 d`,
  )
  // grabado primero, con la pieza todavia fija.
  if (labels.length) {
    lines.push('u', '0 0 0 1 K')
    for (const l of labels) for (const s of textToStrokes(l)) path(s, false)
    lines.push('U')
  }
  for (const layer of LAYER_ORDER) {
    const paths = result.paths.filter((p) => p.layer === layer && p.points.length >= 2)
    if (paths.length === 0) continue
    lines.push('u', `${AI_CMYK[layer]} K`)
    for (const p of paths) path(p.points, p.closed)
    lines.push('U')
  }
  lines.push('%%PageTrailer', '%%Trailer', '%%EOF')
  return lines.join('\n') + '\n'
}

/**
 * PDF 1.5 vectorial (sin comprimir, texto plano): una capa (OCG) por tipo de
 * corte, que Illustrator, Inkscape y LightBurn muestran como capas, en
 * LAYER_ORDER, con el color de trazo de LAYER_COLORS. Un `S` por trazo para
 * que cada corte llegue como objeto propio. Rotulos como trazos negros
 * (strokeFont.ts) en la capa GRABADO. Como en el .ai, el marco de la cama no
 * se incluye. Pagina = pieza + `padMm`, en puntos (1 mm = 72/25.4 pt).
 */
export function laserToPdf(
  result: Pick<LaserCutResult, 'paths' | 'bounds'>,
  title = 'Corte laser',
  labels: readonly TextLabel[] = [],
  padMm = SVG_PAD_MM,
): string {
  const { minX, maxX, minZ, maxZ } = result.bounds
  const x0 = minX - padMm
  const z1 = maxZ + padMm
  const wPt = (maxX - minX + 2 * padMm) * PT_PER_MM
  const hPt = (maxZ - minZ + 2 * padMm) * PT_PER_MM
  const px = (x: number) => fmt((x - x0) * PT_PER_MM)
  const py = (z: number) => fmt((z1 - z) * PT_PER_MM)
  const rgb = (hex: string) =>
    [1, 3, 5].map((k) => fmt(Number.parseInt(hex.slice(k, k + 2), 16) / 255)).join(' ')

  const groups: {
    name: string
    color: string
    strokes: { points: readonly Vec2[]; closed: boolean }[]
  }[] = []
  if (labels.length) {
    groups.push({
      name: 'GRABADO',
      color: '#000000',
      strokes: labels.flatMap((l) =>
        textToStrokes(l).map((points) => ({ points, closed: false })),
      ),
    })
  }
  for (const layer of LAYER_ORDER) {
    const paths = result.paths.filter((p) => p.layer === layer && p.points.length >= 2)
    if (paths.length)
      groups.push({
        ...LAYER_COLORS[layer],
        color: LAYER_COLORS[layer].hex,
        strokes: paths,
      })
  }

  const content: string[] = [`${fmt(0.1 * PT_PER_MM)} w 0 J 0 j`]
  groups.forEach((g, k) => {
    content.push(`/OC /L${k} BDC`, `${rgb(g.color)} RG`)
    for (const s of g.strokes) {
      const pts = closedPoints(s.points, s.closed)
      content.push(
        pts.map(([x, z], i) => `${px(x)} ${py(z)} ${i ? 'l' : 'm'}`).join(' ') +
          (s.closed ? ' h S' : ' S'),
      )
    }
    content.push('EMC')
  })
  const stream = content.join('\n') + '\n'

  // objetos: 1 catalogo, 2 paginas, 3 pagina, 4 contenido, 5 info, 6.. capas
  const ocg = (k: number) => `${6 + k} 0 R`
  const refs = groups.map((_, k) => ocg(k)).join(' ')
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [${refs}] /D << /Order [${refs}] /ON [${refs}] >> >> >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(wPt)} ${fmt(hPt)}] /Contents 4 0 R /Resources << /Properties << ${groups.map((_, k) => `/L${k} ${ocg(k)}`).join(' ')} >> >> >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    `<< /Title (${psString(title)}) /Creator (Plataforma parametrica textil) >>`,
    ...groups.map((g) => `<< /Type /OCG /Name (${psString(g.name)}) >>`),
  ]
  let pdf = '%PDF-1.5\n'
  const offsets: number[] = []
  objects.forEach((o, k) => {
    offsets.push(pdf.length)
    pdf += `${k + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = pdf.length
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}

function psString(s: string): string {
  return s.replace(/[()\\]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?')
}

/** `padMm` = 0: el archivo mide exactamente la pieza (probeta de 200 x 200). */
export function downloadLaserAi(
  result: LaserCutResult,
  filename = 'corte-laser',
  padMm = SVG_PAD_MM,
): void {
  triggerDownload(
    new Blob([laserToAi(result, filename, [], padMm)], {
      type: 'application/postscript',
    }),
    `${filename}.ai`,
  )
}

/** `padMm` = 0: el archivo mide exactamente la pieza (probeta de 200 x 200). */
export function downloadLaserPdf(
  result: LaserCutResult,
  filename = 'corte-laser',
  padMm = SVG_PAD_MM,
): void {
  triggerDownload(
    new Blob([laserToPdf(result, filename, [], padMm)], { type: 'application/pdf' }),
    `${filename}.pdf`,
  )
}

export function downloadBedPdf(bed: BedLayout, filename = 'cama-laser'): void {
  triggerDownload(
    new Blob([laserToPdf(bed, filename, bed.labels)], { type: 'application/pdf' }),
    `${filename}.pdf`,
  )
}

export function downloadBedAi(bed: BedLayout, filename = 'cama-laser'): void {
  triggerDownload(
    new Blob([laserToAi(bed, filename, bed.labels)], { type: 'application/postscript' }),
    `${filename}.ai`,
  )
}

export function downloadLaserSvg(
  result: LaserCutResult,
  filename = 'corte-laser',
  padMm = SVG_PAD_MM,
): void {
  triggerDownload(
    new Blob([laserToSvg(result, filename, [], [], padMm)], { type: 'image/svg+xml' }),
    `${filename}.svg`,
  )
}

export function downloadSwatchSvg(
  sheet: SwatchSheet,
  filename = 'muestrario-kerf',
): void {
  triggerDownload(
    new Blob([laserToSvg(sheet, filename, sheet.labels)], { type: 'image/svg+xml' }),
    `${filename}.svg`,
  )
}

/** Piezas sueltas distribuidas en la cama, numeradas. */
export function downloadBedSvg(bed: BedLayout, filename = 'cama-laser'): void {
  triggerDownload(
    new Blob([laserToSvg(bed, filename, bed.labels, bed.frames)], {
      type: 'image/svg+xml',
    }),
    `${filename}.svg`,
  )
}

export function downloadBedDxf(bed: BedLayout, filename = 'cama-laser'): void {
  triggerDownload(
    new Blob([laserToDxf(bed, bed.labels, bed.frames)], { type: 'application/dxf' }),
    `${filename}.dxf`,
  )
}

export function downloadLaserDxf(result: LaserCutResult, filename = 'corte-laser'): void {
  triggerDownload(
    new Blob([laserToDxf(result)], { type: 'application/dxf' }),
    `${filename}.dxf`,
  )
}

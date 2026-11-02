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
import { triggerDownload } from './download'

export const LAYER_COLORS: Record<CutLayer, { hex: string; aci: number; name: string }> =
  {
    calado: { hex: '#0000ff', aci: 5, name: 'CALADO' },
    corte: { hex: '#00a000', aci: 3, name: 'CORTE' },
    contorno: { hex: '#ff0000', aci: 1, name: 'CONTORNO' },
  }

/** Margen alrededor de la pieza en el lienzo SVG, en mm. */
const SVG_PAD_MM = 5

const fmt = (n: number) => (Math.abs(n) < 5e-4 ? '0' : n.toFixed(3))

/** `d` de un path SVG. El plano XZ se mapea directo a SVG (x -> x, z -> y). */
export function pathData(path: CutPath): string {
  if (path.points.length === 0) return ''
  const [first, ...rest] = path.points
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
): string {
  const { minX, maxX, minZ, maxZ } = result.bounds
  const x0 = minX - SVG_PAD_MM
  const y0 = minZ - SVG_PAD_MM
  const w = maxX - minX + 2 * SVG_PAD_MM
  const h = maxZ - minZ + 2 * SVG_PAD_MM

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
${frame}${engrave}  <g fill="none" stroke-width="0.1" stroke-linejoin="round" stroke-linecap="round">
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
    for (const [x, z] of points) {
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

export function downloadLaserSvg(result: LaserCutResult, filename = 'corte-laser'): void {
  triggerDownload(
    new Blob([laserToSvg(result, filename)], { type: 'image/svg+xml' }),
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

/**
 * Muestrario de prueba para bisagras kerf (como la hoja de referencia):
 * tarjetas con agujero para colgar, rotulo grabado y el patron en la parte
 * inferior. Dos variantes:
 *   - spacing   el patron actual con separaciones de 1.5 a 4 mm (cada 0.25)
 *   - patterns  todos los patrones con los parametros actuales
 *
 * Cada tarjeta es un `buildLaserCut` uniforme (sin atractores ni simetria)
 * sobre el area del patron; se reubica en la hoja y se le suman el contorno
 * de la tarjeta y el agujero. Funcion pura.
 */
import { buildLaserCut, ellipsePolygon, type CutPath, type LaserParams } from './laserCut'
import { HINGE_LABELS, type HingePattern } from './laserPattern'
import {
  offsetPolygon,
  polygonBounds,
  rectBoundary,
  type Bounds2D,
  type Vec2,
} from './polygon'

export type SwatchVariant = 'spacing' | 'patterns'

export const SWATCH_SPACINGS_MM: readonly number[] = [
  1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4,
]

export const SWATCH_CARD = {
  widthMm: 60,
  heightMm: 90,
  headerMm: 24,
  holeRadiusMm: 2.5,
  gapMm: 6,
  columns: 6,
} as const

export interface SwatchLabel {
  x: number
  z: number
  text: string
  sizeMm: number
}

export interface SwatchSheet {
  paths: CutPath[]
  labels: SwatchLabel[]
  bounds: Bounds2D
  cards: number
}

const fmtMm = (v: number) => `${Number(v.toFixed(2))}mm`

export function buildSwatchSheet(
  params: LaserParams,
  variant: SwatchVariant,
): SwatchSheet {
  const cards: {
    pattern: HingePattern
    spacing: number
    title: string
    subtitle: string
  }[] =
    variant === 'spacing'
      ? SWATCH_SPACINGS_MM.map((s) => ({
          pattern: params.hingePattern,
          spacing: s,
          title: fmtMm(s),
          subtitle: HINGE_LABELS[params.hingePattern],
        }))
      : (Object.keys(HINGE_LABELS) as HingePattern[]).map((pattern) => ({
          pattern,
          spacing: params.hingeSpacingMm,
          title: HINGE_LABELS[pattern],
          subtitle: fmtMm(params.hingeSpacingMm),
        }))

  const { widthMm: W, heightMm: H, headerMm, holeRadiusMm, gapMm, columns } = SWATCH_CARD
  const comp = params.kerfCompensation ? params.kerfMm : 0
  const interior: CutPath[] = []
  const outlines: CutPath[] = []
  const labels: SwatchLabel[] = []
  const areaH = H - headerMm

  cards.forEach((card, k) => {
    const x0 = (k % columns) * (W + gapMm)
    const z0 = Math.floor(k / columns) * (H + gapMm)
    const cut = buildLaserCut(
      [],
      {
        ...params,
        family: 'hinge',
        hingePattern: card.pattern,
        hingeSpacingMm: card.spacing,
        distribution: 'uniform',
        symmetry: 'none',
        layout: 'grid',
        centerXMm: 0,
        centerZMm: 0,
        edgeMarginMm: Math.min(params.edgeMarginMm, 4),
      },
      { boundary: rectBoundary(W, areaH) },
    )
    const dx = x0 + W / 2
    const dz = z0 + headerMm + areaH / 2
    for (const p of cut.paths) {
      if (p.layer === 'contorno') continue
      interior.push({ ...p, points: p.points.map(([x, z]): Vec2 => [x + dx, z + dz]) })
    }
    const hole = ellipsePolygon(x0 + 7, z0 + 7, holeRadiusMm, holeRadiusMm, 32, 0)
    interior.push({
      layer: 'calado',
      points: offsetPolygon(hole, -comp / 2),
      closed: true,
    })
    const rect = rectBoundary(W, H).outer.map(([x, z]): Vec2 => [
      x + x0 + W / 2,
      z + z0 + H / 2,
    ])
    outlines.push({
      layer: 'contorno',
      points: offsetPolygon(rect, comp / 2),
      closed: true,
    })
    labels.push({ x: x0 + W / 2 + 4, z: z0 + 10, text: card.title, sizeMm: 6 })
    labels.push({ x: x0 + W / 2 + 4, z: z0 + 18.5, text: card.subtitle, sizeMm: 5 })
  })

  const paths = [...interior, ...outlines]
  return {
    paths,
    labels,
    bounds: polygonBounds(outlines.flatMap((o) => o.points)),
    cards: cards.length,
  }
}

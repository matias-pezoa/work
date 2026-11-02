/**
 * Distribucion de piezas en la cama del laser (familia "capas": cada capa es
 * una pieza). Empaquetado skyline abajo-izquierda: de mayor a menor area,
 * cada pieza va donde quede mas arriba, probando sus dos orientaciones; si
 * ya no entra se abre otra cama debajo. Cada pieza lleva su numero AL COSTADO, fuera
 * de la pieza (en una columna reservada a su izquierda).
 *
 * El marco de cada cama es solo referencia: se exporta en su propia capa
 * para no cortarlo. Funcion pura.
 */
import { LAYER_ORDER, type CutPath, type LaserPiece, type TextLabel } from './laserCut'
import { polygonBounds, polylineLength, type Bounds2D, type Vec2 } from './polygon'

/** Pieza a ubicar: la misma forma que `LaserCutResult.pieces`. */
export type BedPiece = LaserPiece

export interface BedOptions {
  widthMm: number
  heightMm: number
  /** Separacion entre piezas y al borde de la cama. */
  gapMm: number
  /** Alto del numero grabado. */
  labelMm: number
}

export interface BedLayout {
  paths: CutPath[]
  labels: TextLabel[]
  /** Rectangulo de cada cama (referencia, no se corta). */
  frames: Vec2[][]
  bounds: Bounds2D
  beds: number
  /** Piezas que no entran en la cama en ninguna orientacion. */
  oversize: number
  cutLengthMm: number
}

/** Separacion vertical entre camas en el archivo. */
const BED_SPACING_MM = 30

export function layoutOnBed(pieces: readonly BedPiece[], o: BedOptions): BedLayout {
  const gap = Math.max(0, o.gapMm)
  const labelW = o.labelMm * (1 + 0.6 * String(pieces.length).length)
  const usableW = o.widthMm - 2 * gap
  const usableH = o.heightMm - 2 * gap
  let oversize = 0

  const rotated = (paths: readonly CutPath[]) =>
    paths.map((p) => ({ ...p, points: p.points.map(([x, z]): Vec2 => [-z, x]) }))
  const items = pieces.map((piece) => {
    const options = [piece.paths, rotated(piece.paths)].map((paths) => {
      const b = boundsOf(paths)
      // huella: la pieza + la columna del numero, + la separacion.
      return { paths, b, w: b.maxX - b.minX + labelW, h: b.maxZ - b.minZ }
    })
    const fits = options.filter((op) => op.w <= usableW && op.h <= usableH)
    if (fits.length === 0) oversize++
    return {
      piece,
      options: fits.length ? fits : [options[0]],
      area: options[0].w * options[0].h,
    }
  })
  items.sort((a, b) => b.area - a.area || a.piece.number - b.piece.number)

  const out: CutPath[] = []
  const labels: TextLabel[] = []
  const bedTop = (k: number) => k * (o.heightMm + BED_SPACING_MM)
  let bed = 0
  let sky = newSkyline(gap, o.widthMm - gap, gap)
  for (const it of items) {
    let spot = bestSpot(sky, it.options, o.heightMm - gap)
    if (!spot) {
      // no entra en lo que queda: cama nueva (o, si no entra en ninguna, sola).
      bed++
      sky = newSkyline(gap, o.widthMm - gap, gap)
      spot = bestSpot(sky, it.options, Infinity)!
    }
    const { x, y, op } = spot
    sky = raiseSkyline(sky, x, op.w + gap, y + op.h + gap)
    const ox = x + labelW - op.b.minX
    const oz = bedTop(bed) + y - op.b.minZ
    const it2 = { ...it, paths: op.paths }
    for (const p of it2.paths) {
      out.push({ ...p, points: p.points.map(([px, pz]): Vec2 => [px + ox, pz + oz]) })
    }
    labels.push({
      x: x + labelW - o.labelMm * 0.4,
      z: bedTop(bed) + y + o.labelMm,
      text: String(it.piece.number),
      sizeMm: o.labelMm,
      anchor: 'end',
    })
  }

  const frames: Vec2[][] = Array.from({ length: bed + 1 }, (_, k) => [
    [0, bedTop(k)],
    [o.widthMm, bedTop(k)],
    [o.widthMm, bedTop(k) + o.heightMm],
    [0, bedTop(k) + o.heightMm],
  ])
  const paths = out.sort(
    (a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer),
  )
  return {
    paths,
    labels,
    frames,
    bounds: polygonBounds([...frames.flat(), ...paths.flatMap((p) => p.points)]),
    beds: bed + 1,
    oversize,
    cutLengthMm: paths.reduce((s, p) => s + polylineLength(p.points, p.closed), 0),
  }
}

/**
 * Skyline: el borde inferior de lo ocupado, como tramos horizontales de
 * izquierda a derecha. Una pieza se apoya sobre el tramo mas alto que cubre.
 */
interface SkySegment {
  x: number
  w: number
  y: number
}

function newSkyline(x0: number, x1: number, y: number): SkySegment[] {
  return [{ x: x0, w: x1 - x0, y }]
}

/** Abajo-izquierda: el lugar (y orientacion) donde la pieza queda mas arriba. */
function bestSpot<T extends { w: number; h: number }>(
  sky: readonly SkySegment[],
  options: readonly T[],

  maxY: number,
): { x: number; y: number; op: T } | null {
  const right = sky[sky.length - 1].x + sky[sky.length - 1].w
  let best: { x: number; y: number; op: T } | null = null
  for (const op of options) {
    for (let i = 0; i < sky.length; i++) {
      const x = sky[i].x
      if (x + op.w > right + 1e-9) break
      let y = 0
      for (let j = i; j < sky.length && sky[j].x < x + op.w - 1e-9; j++)
        y = Math.max(y, sky[j].y)
      if (y + op.h > maxY + 1e-9) continue
      if (
        !best ||
        y + op.h < best.y + best.op.h - 1e-9 ||
        (Math.abs(y + op.h - best.y - best.op.h) < 1e-9 && x < best.x)
      )
        best = { x, y, op }
    }
  }
  return best
}

/** Eleva el skyline a `top` en [x, x + w). */
function raiseSkyline(
  sky: readonly SkySegment[],
  x: number,
  w: number,
  top: number,
): SkySegment[] {
  const out: SkySegment[] = []
  const x1 = x + w
  for (const s of sky) {
    const s1 = s.x + s.w
    if (s1 <= x || s.x >= x1) {
      out.push(s)
      continue
    }
    if (s.x < x) out.push({ x: s.x, w: x - s.x, y: s.y })
    if (s1 > x1) out.push({ x: x1, w: s1 - x1, y: s.y })
  }
  const right = sky[sky.length - 1].x + sky[sky.length - 1].w
  out.push({ x, w: Math.min(x1, right) - x, y: top })
  out.sort((a, b) => a.x - b.x)
  // une tramos contiguos a la misma altura.
  return out.reduce<SkySegment[]>((acc, s) => {
    const last = acc[acc.length - 1]
    if (last && Math.abs(last.y - s.y) < 1e-9 && Math.abs(last.x + last.w - s.x) < 1e-9)
      last.w += s.w
    else acc.push({ ...s })
    return acc
  }, [])
}

function boundsOf(paths: readonly CutPath[]): Bounds2D {
  return polygonBounds(paths.flatMap((p) => p.points))
}

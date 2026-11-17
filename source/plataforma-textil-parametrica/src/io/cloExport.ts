/**
 * Export "Para CLO3D": CLO solo corta poligonos cerrados, asi que cada corte
 * ABIERTO (escamas, bisagras, triangulos, cruces, modulos de lineas) pasa a
 * ser una ranura cerrada de `widthMm` (`polylineOutline`: inglete, extremos
 * rectos justo en los extremos del trazo). Las ranuras que se tocan (la cruz
 * del auxetico, el tripode del modulo) se FUSIONAN en un solo contorno con
 * la union de Clipper2, para no tener que unirlas en CLO. Calados y contorno
 * ya son cerrados y no cambian.
 *
 * Clipper2 (clipper2-js, TS puro) trabaja en enteros: mm -> micrones. NO se
 * usa su `InflatePaths` para trazos abiertos: en clipper2-js 1.2.4 parte un
 * arco en decenas de fragmentos; la union de poligonos cerrados si es fiable.
 * Se importa dinamicamente al exportar: no pesa en el arranque.
 */
import { Clipper, FillRule, type Paths64 } from 'clipper2-js'
import type { CutPath, LaserCutResult } from '../geometry/laserCut'
import { distanceToSegment, polylineOutline, type Vec2 } from '../geometry/polygon'

/** Unidades de Clipper por mm (micrones). */
const SCALE = 1000
/** Un extremo a menos de esto (mm) de otro corte es una union, no un extremo libre. */
const JOIN_TOL = 1e-3
/** Celda de la grilla para buscar uniones (mm). */
const CELL = 2

/**
 * Por trazo, si su inicio / su final cae sobre OTRO corte (la horquilla de
 * la cruz, el centro del tripode). Las ranuras solo se tocarian de punta ahi
 * y la union las dejaria separadas: esos extremos se prolongan.
 */
function joinedEnds(open: readonly CutPath[]): [boolean, boolean][] {
  const grid = new Map<string, [number, number][]>()
  const key = (i: number, j: number) => `${i},${j}`
  open.forEach((p, k) => {
    for (let s = 0; s + 1 < p.points.length; s++) {
      const [ax, az] = p.points[s]
      const [bx, bz] = p.points[s + 1]
      const i0 = Math.floor((Math.min(ax, bx) - JOIN_TOL) / CELL)
      const i1 = Math.floor((Math.max(ax, bx) + JOIN_TOL) / CELL)
      const j0 = Math.floor((Math.min(az, bz) - JOIN_TOL) / CELL)
      const j1 = Math.floor((Math.max(az, bz) + JOIN_TOL) / CELL)
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++) {
          const list = grid.get(key(i, j))
          if (list) list.push([k, s])
          else grid.set(key(i, j), [[k, s]])
        }
    }
  })
  const touches = (k: number, [x, z]: Vec2) =>
    (grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []).some(
      ([o, s]) =>
        o !== k &&
        distanceToSegment(x, z, open[o].points[s], open[o].points[s + 1]) < JOIN_TOL,
    )
  return open.map((p, k) => [
    touches(k, p.points[0]),
    touches(k, p.points[p.points.length - 1]),
  ])
}

/** Corre el extremo `end` del trazo `d` mm hacia afuera, siguiendo su ultimo tramo. */
function extendEnd(points: readonly Vec2[], end: 'start' | 'end', d: number): Vec2[] {
  const pts = end === 'start' ? [...points].reverse() : [...points]
  const [ax, az] = pts[pts.length - 2]
  const [bx, bz] = pts[pts.length - 1]
  const len = Math.hypot(bx - ax, bz - az)
  if (len > 1e-9)
    pts[pts.length - 1] = [bx + ((bx - ax) / len) * d, bz + ((bz - az) / len) * d]
  return end === 'start' ? pts.reverse() : pts
}

export function closeOpenCuts<T extends Pick<LaserCutResult, 'paths'>>(
  result: T,
  widthMm: number,
): T {
  const open = result.paths.filter((p) => !p.closed && p.points.length >= 2)
  if (open.length === 0 || !(widthMm > 0)) return result
  const joined = joinedEnds(open)
  const slots = open
    .map((p, k) => {
      // un extremo que llega a otro corte se prolonga medio ancho: las
      // ranuras se superponen y la union las funde en un solo contorno.
      let pts: readonly Vec2[] = p.points
      if (joined[k][0]) pts = extendEnd(pts, 'start', widthMm / 2)
      if (joined[k][1]) pts = extendEnd(pts, 'end', widthMm / 2)
      return polylineOutline(pts, widthMm)
    })
    .filter((s) => s.length >= 3)
    .map((s) =>
      s.map(([x, z]) => ({ x: Math.round(x * SCALE), y: Math.round(z * SCALE) })),
    )
  const merged = Clipper.Union(slots as Paths64, undefined, FillRule.NonZero)
  const cuts: CutPath[] = merged.map((path) => ({
    layer: 'corte',
    points: path.map((p) => [p.x / SCALE, p.y / SCALE] as const),
    closed: true,
  }))
  // mismo orden de corte: las ranuras van donde estaban los cortes (antes del contorno).
  const closed = result.paths.filter((p) => p.closed)
  const at = closed.findIndex((p) => p.layer === 'contorno')
  const k = at < 0 ? closed.length : at
  return { ...result, paths: [...closed.slice(0, k), ...cuts, ...closed.slice(k)] }
}

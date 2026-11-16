/**
 * Piezas comunes de los importadores de base personalizada (SVG, DXF, PDF):
 * todos terminan en una lista de trazos (polilineas abiertas o cerradas) que
 * se convierten en un contorno externo + agujeros.
 *
 * Funciones puras: sin DOM, testeables en node.
 */
import { pointInPolygon, polygonArea, polygonBounds, type Vec2 } from '../geometry/polygon'

export interface ImportedBoundary {
  outer: Vec2[]
  holes: Vec2[][]
  /**
   * Ancho real del contorno externo en mm, si el archivo declara unidades
   * (DXF con $INSUNITS, PDF en puntos). El SVG no lo trae: se elige a mano.
   */
  widthMm?: number
}

/** Trazo leido de un archivo, en sus propias unidades y con Y hacia arriba. */
export interface ImportedPolyline {
  points: Vec2[]
  closed: boolean
}

/**
 * Une trazos abiertos que se tocan por los extremos (un contorno de CAD suele
 * venir como LINE + ARC sueltos, un PDF como tramos de un mismo trazo) y
 * devuelve SOLO los lazos cerrados, sin repetir el primer vertice al final.
 * `tol`: distancia maxima entre extremos para considerarlos el mismo punto.
 */
export function closedLoops(polylines: readonly ImportedPolyline[], tol: number): Vec2[][] {
  const near = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol
  const dropEnd = (pts: Vec2[]) => (pts.length > 1 && near(pts[0], pts[pts.length - 1]) ? pts.slice(0, -1) : pts)

  const loops: Vec2[][] = []
  const open: Vec2[][] = []
  for (const p of polylines) {
    if (p.points.length < 2) continue
    if (p.closed) loops.push(dropEnd([...p.points]))
    else if (p.points.length > 2 && near(p.points[0], p.points[p.points.length - 1]))
      loops.push(dropEnd([...p.points]))
    else open.push([...p.points])
  }

  const used = new Array<boolean>(open.length).fill(false)
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue
    used[i] = true
    let chain = open[i]
    let grew = true
    while (grew && !near(chain[0], chain[chain.length - 1])) {
      grew = false
      const head = chain[0]
      const tail = chain[chain.length - 1]
      for (let j = 0; j < open.length; j++) {
        if (used[j]) continue
        const s = open[j]
        const s0 = s[0]
        const s1 = s[s.length - 1]
        if (near(tail, s0)) chain = [...chain, ...s.slice(1)]
        else if (near(tail, s1)) chain = [...chain, ...s.slice(0, -1).reverse()]
        else if (near(head, s1)) chain = [...s.slice(0, -1), ...chain]
        else if (near(head, s0)) chain = [...s.slice(1).reverse(), ...chain]
        else continue
        used[j] = true
        grew = true
        break
      }
    }
    if (chain.length > 2 && near(chain[0], chain[chain.length - 1])) loops.push(dropEnd(chain))
  }
  return loops.filter((l) => l.length >= 3 && polygonArea(l) > 0)
}

/** Tolerancia de union de extremos: una fraccion pequena del tamano del dibujo. */
export function joinTolerance(polylines: readonly ImportedPolyline[]): number {
  const all = polylines.flatMap((p) => p.points)
  if (all.length === 0) return 1e-6
  const b = polygonBounds(all)
  return Math.max(1e-6, Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) * 5e-4)
}

/**
 * El lazo de mayor area es el borde externo; los demas que caen dentro de el
 * son agujeros (p. ej. pinzas). Lo que queda afuera (otra pieza) se ignora.
 */
export function loopsToBoundary(loops: readonly Vec2[][], what: string): ImportedBoundary {
  if (loops.length === 0) {
    throw new Error(
      `No se encontraron contornos cerrados en el ${what}. Revisa que la pieza este cerrada (sin tramos sueltos).`,
    )
  }
  const sorted = [...loops].sort((a, b) => polygonArea(b) - polygonArea(a))
  const outer = sorted[0]
  const ob = polygonBounds(outer)
  const holes = sorted.slice(1).filter((h) => {
    const b = polygonBounds(h)
    return (
      b.minX >= ob.minX - 1e-6 &&
      b.maxX <= ob.maxX + 1e-6 &&
      b.minZ >= ob.minZ - 1e-6 &&
      b.maxZ <= ob.maxZ + 1e-6 &&
      pointInPolygon(h[0][0], h[0][1], outer)
    )
  })
  return { outer, holes }
}

/** Ancho del contorno externo, en mm, a partir de cuantos mm mide una unidad del archivo. */
export function widthInMm(outer: readonly Vec2[], mmPerUnit: number | undefined): number | undefined {
  if (!mmPerUnit) return undefined
  const b = polygonBounds(outer)
  return (b.maxX - b.minX) * mmPerUnit
}

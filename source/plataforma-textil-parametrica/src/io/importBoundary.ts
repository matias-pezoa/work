/**
 * Piezas comunes de los importadores de base personalizada (SVG, DXF, PDF):
 * todos terminan en una lista de trazos (polilineas abiertas o cerradas) que
 * se convierten en piezas (contorno externo + agujeros). Un archivo puede
 * traer varias piezas (p. ej. un patron completo); el panel deja elegir una.
 *
 * Funciones puras: sin DOM, testeables en node.
 */
import { pointInPolygon, polygonArea, polygonBounds, type Vec2 } from '../geometry/polygon'

/**
 * Una pieza, en las unidades del archivo y con Y hacia ABAJO como el SVG: el
 * plano de la app (x, z) tiene +z hacia abajo en la vista laser, en el export
 * y hacia la camara en 3D, asi "arriba en el papel" queda arriba en pantalla.
 */
export interface ImportedBoundary {
  outer: Vec2[]
  holes: Vec2[][]
}

/** Todas las piezas de un archivo, de mayor a menor area. */
export interface ImportedShapes {
  pieces: ImportedBoundary[]
  /**
   * mm por unidad del archivo, si declara unidades (DXF con $INSUNITS, PDF en
   * puntos): las piezas entran a su medida real. El SVG no lo trae.
   */
  mmPerUnit?: number
}

/** Trazo leido de un archivo, en sus propias unidades (Y segun el formato). */
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

/** DXF y PDF tienen Y hacia arriba: se invierte para la convencion de `ImportedBoundary`. */
export function flipLoopsY(loops: readonly Vec2[][]): Vec2[][] {
  return loops.map((l) => l.map(([x, y]): Vec2 => [x, -y]))
}

/** Tolerancia de union de extremos: una fraccion pequena del tamano del dibujo. */
export function joinTolerance(polylines: readonly ImportedPolyline[]): number {
  const all = polylines.flatMap((p) => p.points)
  if (all.length === 0) return 1e-6
  const b = polygonBounds(all)
  return Math.max(1e-6, Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) * 5e-4)
}

/** `inner` cae dentro de `outer` (caja + primer vertice dentro del poligono). */
function insideOf(inner: readonly Vec2[], outer: readonly Vec2[]): boolean {
  const ob = polygonBounds(outer)
  const b = polygonBounds(inner)
  return (
    b.minX >= ob.minX - 1e-6 &&
    b.maxX <= ob.maxX + 1e-6 &&
    b.minZ >= ob.minZ - 1e-6 &&
    b.maxZ <= ob.maxZ + 1e-6 &&
    pointInPolygon(inner[0][0], inner[0][1], outer)
  )
}

/**
 * Separa los lazos en piezas: cada lazo que no cae dentro de otra pieza es
 * una pieza nueva; uno que cae dentro de una pieza es su agujero (p. ej. una
 * pinza); uno dentro de un agujero (una isla) vuelve a ser pieza propia.
 * Las piezas salen de mayor a menor area.
 */
export function loopsToPieces(loops: readonly Vec2[][], what: string): ImportedBoundary[] {
  if (loops.length === 0) {
    throw new Error(
      `No se encontraron contornos cerrados en el ${what}. Revisa que la pieza este cerrada (sin tramos sueltos).`,
    )
  }
  const sorted = [...loops].sort((a, b) => polygonArea(b) - polygonArea(a))
  const pieces: ImportedBoundary[] = []
  for (const loop of sorted) {
    // la pieza contenedora mas chica (las piezas van de mayor a menor area).
    let owner: ImportedBoundary | undefined
    for (let k = pieces.length - 1; k >= 0 && !owner; k--)
      if (insideOf(loop, pieces[k].outer)) owner = pieces[k]
    if (owner && !owner.holes.some((h) => insideOf(loop, h))) owner.holes.push(loop)
    else pieces.push({ outer: loop, holes: [] })
  }
  return pieces
}

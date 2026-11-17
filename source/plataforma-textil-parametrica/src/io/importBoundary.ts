/**
 * Piezas comunes de los importadores de base personalizada (SVG, DXF, PDF):
 * todos terminan en una lista de trazos (polilineas abiertas o cerradas) que
 * se convierten en piezas (contorno externo + agujeros). Un archivo puede
 * traer varias piezas (p. ej. un patron completo); el panel deja elegir una.
 *
 * Funciones puras: sin DOM, testeables en node.
 */
import {
  distanceToPolygonEdges,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  type Vec2,
} from '../geometry/polygon'

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
export function closedLoops(
  polylines: readonly ImportedPolyline[],
  tol: number,
): Vec2[][] {
  const near = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol
  const dropEnd = (pts: Vec2[]) =>
    pts.length > 1 && near(pts[0], pts[pts.length - 1]) ? pts.slice(0, -1) : pts

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
    if (chain.length > 2 && near(chain[0], chain[chain.length - 1]))
      loops.push(dropEnd(chain))
  }
  return loops.filter((l) => l.length >= 3 && polygonArea(l) > 0)
}

/** DXF y PDF tienen Y hacia arriba: se invierte para la convencion de `ImportedBoundary`. */
export function flipLoopsY(loops: readonly Vec2[][]): Vec2[][] {
  return loops.map((l) => l.map(([x, y]): Vec2 => [x, -y]))
}

/** Ramer-Douglas-Peucker: saca vertices colineales (una recta muestreada queda en 2 puntos). */
export function simplify(points: readonly Vec2[], eps: number): Vec2[] {
  if (points.length < 3) return [...points]
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = keep[points.length - 1] = true
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()!
    const [ax, az] = points[i]
    const [bx, bz] = points[j]
    const len = Math.hypot(bx - ax, bz - az)
    let best = -1
    let idx = -1
    for (let k = i + 1; k < j; k++) {
      const [px, pz] = points[k]
      const d =
        len < 1e-12
          ? Math.hypot(px - ax, pz - az)
          : Math.abs((bx - ax) * (az - pz) - (ax - px) * (bz - az)) / len
      if (d > best) {
        best = d
        idx = k
      }
    }
    if (best > eps) {
      keep[idx] = true
      stack.push([i, idx], [idx, j])
    }
  }
  return points.filter((_, k) => keep[k])
}

/**
 * Lazo cerrado simplificado (RDP): un arco de PDF/DXF llega muestreado en
 * cientos de vertices, y cada calado se compara con todo el borde. Con una
 * tolerancia invisible (`eps`) la falda circular pasa de 1408 a ~190
 * vertices y el diseno se genera 5-8 veces mas rapido.
 */
export function simplifyLoop(loop: readonly Vec2[], eps: number): Vec2[] {
  if (loop.length <= 4) return [...loop]
  const out = simplify([...loop, loop[0]], eps).slice(0, -1)
  return out.length >= 3 ? out : [...loop]
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
 * `inner` (ya dentro de `outer`) es la linea de costura de la pieza y no un
 * agujero: ocupa al menos la mitad del area y corre paralela al borde (ningun
 * vertice se aleja del borde mas de 1/4 del lado menor de la pieza). Los
 * moldes de patronaje traen linea de corte + linea de costura; tomar la de
 * costura como agujero dejaba la pieza sin lugar para los calados.
 */
export function isSeamLine(inner: readonly Vec2[], outer: readonly Vec2[]): boolean {
  if (polygonArea(inner) < 0.5 * polygonArea(outer)) return false
  const b = polygonBounds(outer)
  const reach = 0.25 * Math.min(b.maxX - b.minX, b.maxZ - b.minZ)
  return inner.every(([x, z]) => distanceToPolygonEdges(x, z, outer) <= reach)
}

/**
 * Separa los lazos en piezas: cada lazo que no cae dentro de otra pieza es
 * una pieza nueva; uno que cae dentro de una pieza es su agujero (p. ej. una
 * pinza), salvo que sea su linea de costura (`isSeamLine`, se descarta); uno
 * dentro de un agujero (una isla) vuelve a ser pieza propia.
 * Las piezas salen de mayor a menor area.
 */
export function loopsToPieces(
  loops: readonly Vec2[][],
  what: string,
): ImportedBoundary[] {
  if (loops.length === 0) {
    throw new Error(
      `No se encontraron contornos cerrados en el ${what}. Revisa que la pieza este cerrada (sin tramos sueltos).`,
    )
  }
  // tolerancia de simplificacion: 5e-5 de la diagonal del dibujo (~0,07 mm en
  // una falda de 1,2 m), invisible en el corte.
  const all = polygonBounds(loops.flat())
  const eps = Math.hypot(all.maxX - all.minX, all.maxZ - all.minZ) * 5e-5
  const sorted = loops
    .map((l) => simplifyLoop(l, eps))
    .sort((a, b) => polygonArea(b) - polygonArea(a))
  const pieces: ImportedBoundary[] = []
  for (const loop of sorted) {
    // la pieza contenedora mas chica (las piezas van de mayor a menor area).
    let owner: ImportedBoundary | undefined
    for (let k = pieces.length - 1; k >= 0 && !owner; k--)
      if (insideOf(loop, pieces[k].outer)) owner = pieces[k]
    if (owner && !owner.holes.some((h) => insideOf(loop, h))) {
      if (!isSeamLine(loop, owner.outer)) owner.holes.push(loop)
    } else pieces.push({ outer: loop, holes: [] })
  }
  return pieces
}

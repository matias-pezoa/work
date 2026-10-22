/**
 * Utilidades de poligonos 2D (en el plano XZ, mismas unidades que el resto de
 * geometry/). Sirven para acotar el area donde se generan puas/ondas a una
 * forma personalizada importada (ver io/importSvg.ts), en vez del panel
 * cuadrado por defecto.
 *
 * Funciones puras.
 */

/** Punto 2D como [x, z]. */
export type Vec2 = readonly [x: number, z: number]

/** Un contorno externo mas 0 o mas agujeros (p. ej. pinzas de un patron). */
export interface Boundary {
  outer: readonly Vec2[]
  holes: readonly (readonly Vec2[])[]
}

/** Ray casting: true si el punto cae dentro del poligono (borde inclusive-ish). */
export function pointInPolygon(x: number, z: number, polygon: readonly Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]
    const [xj, zj] = polygon[j]
    const intersects = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

/** Dentro del contorno externo y fuera de todos los agujeros. */
export function pointInBoundary(x: number, z: number, boundary: Boundary): boolean {
  if (!pointInPolygon(x, z, boundary.outer)) return false
  return !boundary.holes.some((h) => pointInPolygon(x, z, h))
}

export interface Bounds2D {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export function polygonBounds(points: readonly Vec2[]): Bounds2D {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [x, z] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  return { minX, maxX, minZ, maxZ }
}

/** Area con signo (formula del cordon); su valor absoluto es el area real. */
export function polygonSignedArea(points: readonly Vec2[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i]
    const [x2, z2] = points[(i + 1) % points.length]
    sum += x1 * z2 - x2 * z1
  }
  return sum / 2
}

export function polygonArea(points: readonly Vec2[]): number {
  return Math.abs(polygonSignedArea(points))
}

/**
 * Recentra y reescala un conjunto de contornos (mismo factor para todos, para
 * no deformar el patron) para que el contorno de referencia quede centrado en
 * el origen con el ancho (X) objetivo, en mm.
 */
export function fitBoundaryToWidth(
  outer: readonly Vec2[],
  holes: readonly (readonly Vec2[])[],
  targetWidthMm: number,
): { outer: Vec2[]; holes: Vec2[][]; widthMm: number; heightMm: number } {
  const b = polygonBounds(outer)
  const rawWidth = Math.max(b.maxX - b.minX, 1e-6)
  const scale = targetWidthMm / rawWidth
  const cx = (b.minX + b.maxX) / 2
  const cz = (b.minZ + b.maxZ) / 2
  const apply = (pts: readonly Vec2[]): Vec2[] =>
    pts.map(([x, z]) => [(x - cx) * scale, (z - cz) * scale] as Vec2)

  const scaledOuter = apply(outer)
  const scaledHoles = holes.map(apply)
  const sb = polygonBounds(scaledOuter)
  return {
    outer: scaledOuter,
    holes: scaledHoles,
    widthMm: sb.maxX - sb.minX,
    heightMm: sb.maxZ - sb.minZ,
  }
}

/** Reescala contornos ya centrados por un factor uniforme (mismo centro). */
export function rescaleBoundary(
  outer: readonly Vec2[],
  holes: readonly (readonly Vec2[])[],
  factor: number,
): { outer: Vec2[]; holes: Vec2[][] } {
  const scale = (pts: readonly Vec2[]): Vec2[] =>
    pts.map(([x, z]) => [x * factor, z * factor] as Vec2)
  return { outer: scale(outer), holes: holes.map(scale) }
}

/** Rectangulo centrado en el origen como contorno sin agujeros. */
export function rectBoundary(widthMm: number, heightMm: number): Boundary {
  const hw = widthMm / 2
  const hh = heightMm / 2
  return {
    outer: [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ],
    holes: [],
  }
}

/** Distancia de `(x, z)` al segmento `[a, b]`. */
export function distanceToSegment(x: number, z: number, a: Vec2, b: Vec2): number {
  const abx = b[0] - a[0]
  const abz = b[1] - a[1]
  const lenSq = abx * abx + abz * abz
  let t = lenSq < 1e-12 ? 0 : ((x - a[0]) * abx + (z - a[1]) * abz) / lenSq
  t = Math.min(1, Math.max(0, t))
  return Math.hypot(x - (a[0] + abx * t), z - (a[1] + abz * t))
}

/** Distancia de `(x, z)` al borde (aristas) de un poligono cerrado. */
export function distanceToPolygonEdges(
  x: number,
  z: number,
  polygon: readonly Vec2[],
): number {
  let best = Infinity
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const d = distanceToSegment(x, z, polygon[j], polygon[i])
    if (d < best) best = d
  }
  return best
}

/** Distancia de `(x, z)` al borde mas cercano del contorno (externo o agujeros). */
export function distanceToBoundaryEdges(
  x: number,
  z: number,
  boundary: Boundary,
): number {
  let best = distanceToPolygonEdges(x, z, boundary.outer)
  for (const h of boundary.holes) best = Math.min(best, distanceToPolygonEdges(x, z, h))
  return best
}

/** Largo de una polilinea (sumando el tramo de cierre si `closed`). */
export function polylineLength(points: readonly Vec2[], closed: boolean): number {
  let len = 0
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  }
  if (closed && points.length > 2) {
    const a = points[points.length - 1]
    const b = points[0]
    len += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return len
}

/** Tope del largo de inglete (en multiplos de |distance|) en vertices muy agudos. */
const MITER_LIMIT = 4

/**
 * Offset de un poligono cerrado simple, con uniones en inglete: `distance`
 * positiva lo agranda (hacia afuera), negativa lo achica. Pensado para
 * offsets CHICOS respecto del tamano de los rasgos (compensacion de kerf,
 * decimas de mm): no resuelve auto-intersecciones ni colapsos de rasgos mas
 * finos que el offset — para eso hara falta Clipper2 (roadmap, CLAUDE.md).
 */
export function offsetPolygon(points: readonly Vec2[], distance: number): Vec2[] {
  const pts = points.filter((p, i) => {
    const q = points[(i + 1) % points.length]
    return Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-9
  })
  const n = pts.length
  if (n < 3 || distance === 0) return pts.map(([x, z]) => [x, z] as Vec2)
  // normal "hacia afuera" depende de la orientacion del poligono.
  const sign = polygonSignedArea(pts) > 0 ? 1 : -1
  const normals: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[(i + 1) % n]
    const len = Math.hypot(bx - ax, bz - az)
    normals.push([(sign * (bz - az)) / len, (sign * -(bx - ax)) / len])
  }
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const n1 = normals[(i - 1 + n) % n]
    const n2 = normals[i]
    const denom = 1 + n1[0] * n2[0] + n1[1] * n2[1]
    let mx = (n1[0] + n2[0]) / Math.max(denom, 1e-9)
    let mz = (n1[1] + n2[1]) / Math.max(denom, 1e-9)
    const m = Math.hypot(mx, mz)
    if (m > MITER_LIMIT) {
      mx = (mx / m) * MITER_LIMIT
      mz = (mz / m) * MITER_LIMIT
    }
    out.push([pts[i][0] + mx * distance, pts[i][1] + mz * distance])
  }
  return out
}

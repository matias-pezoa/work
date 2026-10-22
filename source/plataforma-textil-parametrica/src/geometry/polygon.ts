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

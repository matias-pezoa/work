/**
 * Mapas de atraccion.
 *
 * Un atractor tiene un radio de influencia y una funcion de caida, y puede
 * ser de dos formas:
 *   - PUNTO: la influencia decae desde un unico punto 3D (radial, como una
 *     piedra tirada al agua).
 *   - CURVA: la influencia decae desde la LINEA POLIGONAL que conectan sus
 *     puntos de control en orden (como una piedra... pero una zanja: decae
 *     desde el punto mas cercano de esa linea, no desde un solo centro). Sirve
 *     para atraer a lo largo de una costura, un pliegue o cualquier trazo,
 *     no solo un punto. Se usan segmentos RECTOS entre puntos de control (sin
 *     suavizado tipo spline) a proposito: asi lo que se ve en el viewport
 *     (la linea entre los gizmos arrastrables) es EXACTAMENTE la geometria
 *     que decide la distancia — agregar mas puntos de control es lo que
 *     suaviza la curva, no una interpolacion oculta que podria no coincidir
 *     con lo que el usuario arrastra.
 *
 * Dado un punto en el espacio y una lista de atractores, `sampleField`
 * devuelve un valor de campo combinado en [0,1] y una direccion (gradiente
 * aproximado) para orientar instancias siguiendo el campo.
 *
 * Funciones puras. Unidades: las del viewport (Three.js).
 */
import * as THREE from 'three'
import { clamp } from '../utils/params'
import type { NumberParam } from '../utils/params'

export type FalloffType = 'linear' | 'inverseSquare' | 'gaussian'

export const FALLOFF_LABELS: Record<FalloffType, string> = {
  linear: 'Lineal',
  inverseSquare: 'Cuadratica inversa',
  gaussian: 'Gaussiana',
}

interface AttractorCommon {
  id: string
  /** Radio de influencia. Fuera de ~este radio la contribucion es ~0. */
  radius: number
  /** Peso del atractor (puede ser negativo para "repeler" densidad). */
  strength: number
  falloff: FalloffType
}

export interface PointAttractor extends AttractorCommon {
  kind: 'point'
  /** Posicion en unidades de Three.js. */
  position: THREE.Vector3
}

export interface CurveAttractor extends AttractorCommon {
  kind: 'curve'
  /** Puntos de control, en orden, en unidades de Three.js. Minimo 2. */
  points: THREE.Vector3[]
}

export type Attractor = PointAttractor | CurveAttractor

/** Minimo de puntos de control que puede tener una curva (por debajo de esto no es una linea). */
export const MIN_CURVE_POINTS = 2

/**
 * Parche editable desde la UI: los campos comunes siempre aplican; `position`
 * solo tiene efecto sobre un atractor `kind: 'point'` y `points` solo sobre
 * uno `kind: 'curve'` (el otro se ignora en `applyAttractorPatch`). Separado
 * de `Partial<Attractor>` porque `Partial` de una union solo deja pasar las
 * claves COMUNES a ambas variantes — no `position` ni `points`.
 */
export interface AttractorPatch {
  radius?: number
  strength?: number
  falloff?: FalloffType
  position?: THREE.Vector3
  points?: THREE.Vector3[]
}

/** Aplica un `AttractorPatch`, clonando los vectores para no aliasear el estado. */
export function applyAttractorPatch(a: Attractor, patch: AttractorPatch): Attractor {
  const common = {
    radius: patch.radius ?? a.radius,
    strength: patch.strength ?? a.strength,
    falloff: patch.falloff ?? a.falloff,
  }
  if (a.kind === 'point') {
    return {
      ...a,
      ...common,
      position: patch.position ? patch.position.clone() : a.position,
    }
  }
  return {
    ...a,
    ...common,
    points: patch.points ? patch.points.map((p) => p.clone()) : a.points,
  }
}

export const ATTRACTOR_UI_PARAMS: readonly NumberParam[] = [
  {
    key: 'radius',
    label: 'Radio de influencia',
    min: 0.2,
    max: 40,
    step: 0.1,
    default: 6,
    unit: 'u3d',
  },
  {
    key: 'strength',
    label: 'Intensidad',
    min: -2,
    max: 2,
    step: 0.05,
    default: 1,
    unit: 'x',
  },
]

/** Contribucion normalizada [0,1] de un atractor a distancia `d`. */
export function falloff(type: FalloffType, d: number, radius: number): number {
  const r = Math.max(radius, 1e-6)
  const t = d / r
  switch (type) {
    case 'linear':
      return clamp(1 - t, 0, 1)
    case 'inverseSquare': {
      // cae rapido como 1/(1+(3t)^2) y se fuerza a 0 en t>=1 con una ventana lineal.
      const base = 1 / (1 + 9 * t * t)
      return clamp(base * clamp(1 - t, 0, 1), 0, 1)
    }
    case 'gaussian': {
      const sigma = 0.5
      return clamp(Math.exp(-(t * t) / (2 * sigma * sigma)), 0, 1)
    }
  }
}

const _segAB = new THREE.Vector3()
const _segAP = new THREE.Vector3()

/** Punto de `[a, b]` mas cercano a `p` (proyeccion recortada al segmento). */
function closestPointOnSegment(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  out: THREE.Vector3,
): THREE.Vector3 {
  _segAB.subVectors(b, a)
  const lenSq = _segAB.lengthSq()
  if (lenSq < 1e-12) return out.copy(a)
  _segAP.subVectors(p, a)
  const t = clamp(_segAP.dot(_segAB) / lenSq, 0, 1)
  return out.copy(a).addScaledVector(_segAB, t)
}

const _closestCand = new THREE.Vector3()

/**
 * Punto DEL ATRACTOR mas cercano a `point` (en 3D): la posicion misma si es
 * `kind: 'point'`, o el punto mas cercano de la linea poligonal si es
 * `kind: 'curve'` (recorriendo cada segmento entre puntos de control
 * consecutivos).
 */
export function closestPointOnAttractor(
  point: THREE.Vector3,
  a: Attractor,
  out: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  if (a.kind === 'point') return out.copy(a.position)
  const pts = a.points
  if (pts.length <= 1) return out.copy(pts[0] ?? point)
  let bestDistSq = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    closestPointOnSegment(point, pts[i], pts[i + 1], _closestCand)
    const distSq = _closestCand.distanceToSquared(point)
    if (distSq < bestDistSq) {
      bestDistSq = distSq
      out.copy(_closestCand)
    }
  }
  return out
}

function distanceToSegment2D(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const abx = bx - ax
  const abz = bz - az
  const lenSq = abx * abx + abz * abz
  const t = lenSq < 1e-12 ? 0 : clamp(((px - ax) * abx + (pz - az) * abz) / lenSq, 0, 1)
  const cx = ax + abx * t
  const cz = az + abz * t
  return Math.hypot(px - cx, pz - cz)
}

/**
 * Distancia de `(x, z)` al atractor IGNORANDO la altura (proyectado sobre el
 * plano XZ): para un punto, la distancia radial de siempre; para una curva,
 * la distancia a la linea poligonal proyectada. Lo usa el modo Ondas, que
 * solo razona en el plano del panel (ver waveField.ts).
 */
export function closestDistance2D(x: number, z: number, a: Attractor): number {
  if (a.kind === 'point') return Math.hypot(x - a.position.x, z - a.position.z)
  const pts = a.points
  if (pts.length === 0) return Infinity
  if (pts.length === 1) return Math.hypot(x - pts[0].x, z - pts[0].z)
  let best = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distanceToSegment2D(x, z, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z)
    if (d < best) best = d
  }
  return best
}

export interface FieldSample {
  /** Valor de campo combinado, recortado a [0,1]. */
  value: number
  /**
   * Direccion unitaria hacia donde CRECE el campo (hacia los atractores
   * dominantes), o null si el campo es plano en ese punto.
   */
  direction: THREE.Vector3 | null
}

const _closest = new THREE.Vector3()
const _toClosest = new THREE.Vector3()

/**
 * Evalua el campo en `point`.
 * @param combine 'max' = domina el atractor mas fuerte (transiciones nitidas
 *                entre zonas); 'sum' = se acumulan (zonas de solape mas densas).
 */
export function sampleField(
  point: THREE.Vector3,
  attractors: readonly Attractor[],
  combine: CombineMode = 'max',
): FieldSample {
  let value = 0
  const dir = new THREE.Vector3()
  let any = false

  for (const a of attractors) {
    closestPointOnAttractor(point, a, _closest)
    const d = _closest.distanceTo(point)
    const contribRaw = falloff(a.falloff, d, a.radius) * a.strength
    if (contribRaw === 0) continue
    any = true

    if (combine === 'max') {
      if (Math.abs(contribRaw) > Math.abs(value)) value = contribRaw
    } else {
      value += contribRaw
    }

    // el gradiente apunta desde el punto hacia el atractor, pesado por |contrib|.
    if (d > 1e-6) {
      dir.addScaledVector(_toClosest.subVectors(_closest, point).normalize(), contribRaw)
    }
  }

  return {
    value: clamp(value, 0, 1),
    direction: any && dir.lengthSq() > 1e-10 ? dir.normalize() : null,
  }
}

export type CombineMode = 'max' | 'sum'

let _autoId = 0
function nextAttractorId(): string {
  return `attr-${Date.now().toString(36)}-${(_autoId++).toString(36)}`
}

export function createAttractor(
  position: THREE.Vector3,
  overrides: Partial<Omit<PointAttractor, 'id' | 'kind' | 'position'>> = {},
): PointAttractor {
  return {
    id: nextAttractorId(),
    kind: 'point',
    position: position.clone(),
    radius: overrides.radius ?? 6,
    strength: overrides.strength ?? 1,
    falloff: overrides.falloff ?? 'gaussian',
  }
}

export function createCurveAttractor(
  points: readonly THREE.Vector3[],
  overrides: Partial<Omit<CurveAttractor, 'id' | 'kind' | 'points'>> = {},
): CurveAttractor {
  if (points.length < MIN_CURVE_POINTS) {
    throw new Error(`una curva atractora necesita al menos ${MIN_CURVE_POINTS} puntos`)
  }
  return {
    id: nextAttractorId(),
    kind: 'curve',
    points: points.map((p) => p.clone()),
    radius: overrides.radius ?? 6,
    strength: overrides.strength ?? 1,
    falloff: overrides.falloff ?? 'gaussian',
  }
}

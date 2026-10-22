/**
 * Mapas de atraccion.
 *
 * Un atractor tiene un radio de influencia y una funcion de caida, y puede
 * ser de dos formas:
 *   - PUNTO: la influencia decae desde un unico punto 3D (radial, como una
 *     piedra tirada al agua).
 *   - CURVA: la influencia decae desde la LINEA que pasa por sus puntos de
 *     control en orden (como una piedra... pero una zanja: decae desde el
 *     punto mas cercano de esa linea, no desde un solo centro). Sirve para
 *     atraer a lo largo de una costura, un pliegue o cualquier trazo.
 *     Cada punto de control es ESQUINA o SUAVE (`smooth[i]`). La linea es una
 *     curva Bezier cubica por tramos que PASA por los puntos de control; en un
 *     punto suave los manejadores salen automaticos de la tangente de sus
 *     vecinos (Catmull-Rom), en una esquina se colapsan sobre el punto. Todo
 *     esquina = la poligonal recta de siempre. La curva se teselada UNA vez
 *     (`curvePath`) y esa misma polilinea es la que se dibuja en el viewport y
 *     la que decide la distancia: lo que se ve es exactamente lo que atrae.
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
  /**
   * Forma de las crestas (solo modo Ondas). 'concentric': la onda se aleja
   * del atractor (circulos alrededor de un punto, paralelas a una curva).
   * 'directional': la onda VIAJA en una direccion — la del angulo de un
   * punto, o a lo largo del trazo de una curva (crestas cruzadas a ella).
   */
  waveMode: WaveMode
}

export type WaveMode = 'concentric' | 'directional'

export const WAVE_MODE_LABELS: Record<WaveMode, string> = {
  concentric: 'Concentrica',
  directional: 'Direccional',
}

export interface PointAttractor extends AttractorCommon {
  kind: 'point'
  /** Posicion en unidades de Three.js. */
  position: THREE.Vector3
  /**
   * Direccion en el plano XZ, en grados (0 = +X, 90 = +Z). Solo la usa el
   * modo Ondas: orienta las costillas cerca del punto y, en modo
   * 'directional', la direccion en que viaja la onda. Es un EJE (0 y 180 dan
   * lo mismo para las costillas).
   */
  angleDeg: number
}

export interface CurveAttractor extends AttractorCommon {
  kind: 'curve'
  /** Puntos de control, en orden, en unidades de Three.js. Minimo 2. */
  points: THREE.Vector3[]
  /** Por punto de control: true = vertice suave (Bezier), false = esquina. */
  smooth: boolean[]
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
  waveMode?: WaveMode
  /** Solo puntos: direccion en grados (ver PointAttractor.angleDeg). */
  angleDeg?: number
  position?: THREE.Vector3
  points?: THREE.Vector3[]
  /** Solo curvas: tipo de vertice por punto (se alinea al largo de `points`). */
  smooth?: boolean[]
}

/**
 * Ajusta `smooth` al largo de la curva: recorta lo que sobra y completa lo
 * que falta repitiendo el ultimo valor (un punto nuevo hereda el tipo de su
 * vecino), o `true` si la lista esta vacia.
 */
function alignSmooth(smooth: readonly boolean[], length: number): boolean[] {
  const fill = smooth.length > 0 ? smooth[smooth.length - 1] : true
  return Array.from({ length }, (_, i) => smooth[i] ?? fill)
}

/** Aplica un `AttractorPatch`, clonando los vectores para no aliasear el estado. */
export function applyAttractorPatch(a: Attractor, patch: AttractorPatch): Attractor {
  const common = {
    radius: patch.radius ?? a.radius,
    strength: patch.strength ?? a.strength,
    falloff: patch.falloff ?? a.falloff,
    waveMode: patch.waveMode ?? a.waveMode,
  }
  if (a.kind === 'point') {
    return {
      ...a,
      ...common,
      angleDeg: patch.angleDeg ?? a.angleDeg,
      position: patch.position ? patch.position.clone() : a.position,
    }
  }
  const points = patch.points ? patch.points.map((p) => p.clone()) : a.points
  return {
    ...a,
    ...common,
    points,
    smooth: alignSmooth(patch.smooth ?? a.smooth, points.length),
  }
}

// ------------------------------------------------------------ curva Bezier

/** Muestras por tramo curvo al teselar (un tramo recto usa solo sus extremos). */
const SAMPLES_PER_SEGMENT = 16

/**
 * Tramos Bezier cubicos [p0, c1, c2, p1] que pasan por los puntos de control.
 * Tangente de un punto suave = (siguiente - anterior)/2 (Catmull-Rom; en los
 * extremos, el unico vecino); los manejadores van a 1/3 de esa tangente. En
 * una esquina la tangente es 0: los manejadores caen sobre el punto, asi que
 * un tramo entre dos esquinas es exactamente recto.
 */
export function bezierSegments(
  points: readonly THREE.Vector3[],
  smooth: readonly boolean[],
): [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3][] {
  const n = points.length
  const tangent = (i: number) => {
    if (!smooth[i] || n < 2) return new THREE.Vector3()
    const prev = points[Math.max(0, i - 1)]
    const next = points[Math.min(n - 1, i + 1)]
    const scale = i === 0 || i === n - 1 ? 1 : 0.5
    return next.clone().sub(prev).multiplyScalar(scale)
  }
  const tangents = points.map((_, i) => tangent(i))
  const segs: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3][] = []
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i]
    const p1 = points[i + 1]
    segs.push([
      p0,
      p0.clone().addScaledVector(tangents[i], 1 / 3),
      p1.clone().addScaledVector(tangents[i + 1], -1 / 3),
      p1,
    ])
  }
  return segs
}

const _pathCache = new WeakMap<CurveAttractor, THREE.Vector3[]>()

/**
 * Polilinea que representa la curva (teselada si tiene vertices suaves).
 * Cacheada por objeto: el estado es inmutable (cada edicion crea un atractor
 * nuevo), asi que una curva se tesela una sola vez por version.
 */
export function curvePath(a: CurveAttractor): THREE.Vector3[] {
  const cached = _pathCache.get(a)
  if (cached) return cached
  const segs = bezierSegments(a.points, a.smooth)
  const out: THREE.Vector3[] = a.points.length ? [a.points[0].clone()] : []
  segs.forEach(([p0, c1, c2, p1], i) => {
    const straight = !a.smooth[i] && !a.smooth[i + 1]
    const steps = straight ? 1 : SAMPLES_PER_SEGMENT
    for (let k = 1; k <= steps; k++) {
      const t = k / steps
      const u = 1 - t
      out.push(
        new THREE.Vector3()
          .addScaledVector(p0, u * u * u)
          .addScaledVector(c1, 3 * u * u * t)
          .addScaledVector(c2, 3 * u * t * t)
          .addScaledVector(p1, t * t * t),
      )
    }
  })
  _pathCache.set(a, out)
  return out
}

/**
 * Parche que inserta un punto de control en la curva, cerca de `point`
 * (se razona en el plano XZ). Si `point` cae junto a un extremo, extiende la
 * curva por ese lado; si no, lo inserta en el tramo mas cercano. La altura (y)
 * se interpola de los vecinos, para no "pinchar" la curva en 3D. El nuevo
 * punto hereda el tipo de vertice de su vecino.
 */
export function insertCurvePoint(
  a: CurveAttractor,
  point: THREE.Vector3,
): { patch: AttractorPatch; index: number } {
  const pts = a.points
  let best = { d: Infinity, seg: 0, t: 0 }
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x
    const az = pts[i].z
    const abx = pts[i + 1].x - ax
    const abz = pts[i + 1].z - az
    const lenSq = abx * abx + abz * abz
    const t =
      lenSq < 1e-12
        ? 0
        : clamp(((point.x - ax) * abx + (point.z - az) * abz) / lenSq, 0, 1)
    const d = Math.hypot(point.x - (ax + abx * t), point.z - (az + abz * t))
    if (d < best.d) best = { d, seg: i, t }
  }
  const last = pts.length - 1
  let index: number
  let y: number
  if (best.seg === 0 && best.t === 0) {
    index = 0
    y = pts[0].y
  } else if (best.seg === last - 1 && best.t === 1) {
    index = pts.length
    y = pts[last].y
  } else {
    index = best.seg + 1
    y = pts[best.seg].y + (pts[best.seg + 1].y - pts[best.seg].y) * best.t
  }
  const neighbor = a.smooth[Math.min(index, last)] ?? true
  const newPoint = new THREE.Vector3(point.x, y, point.z)
  return {
    index,
    patch: {
      points: [...pts.slice(0, index), newPoint, ...pts.slice(index)],
      smooth: [...a.smooth.slice(0, index), neighbor, ...a.smooth.slice(index)],
    },
  }
}

/** Parche que quita el punto `index` (null si la curva quedaria bajo el minimo). */
export function removeCurvePoint(
  a: CurveAttractor,
  index: number,
): AttractorPatch | null {
  if (a.points.length <= MIN_CURVE_POINTS) return null
  return {
    points: a.points.filter((_, i) => i !== index),
    smooth: a.smooth.filter((_, i) => i !== index),
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
  const pts = curvePath(a)
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
  const pts = curvePath(a)
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
    waveMode: overrides.waveMode ?? 'concentric',
    // 90 = a lo largo de Z: la misma direccion base de las costillas.
    angleDeg: overrides.angleDeg ?? 90,
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
    // por defecto recta (todas esquinas): la forma mas predecible.
    smooth: alignSmooth(overrides.smooth ?? [false], points.length),
    radius: overrides.radius ?? 6,
    strength: overrides.strength ?? 1,
    falloff: overrides.falloff ?? 'gaussian',
    waveMode: overrides.waveMode ?? 'concentric',
  }
}

// ------------------------------------------------ marco local de una curva

const _lengthCache = new WeakMap<CurveAttractor, number[]>()

/** Largo acumulado (XZ) en cada vertice de `curvePath(a)`. */
function cumulativeLengths(a: CurveAttractor): number[] {
  const cached = _lengthCache.get(a)
  if (cached) return cached
  const pts = curvePath(a)
  const acc = [0]
  for (let i = 1; i < pts.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z))
  }
  _lengthCache.set(a, acc)
  return acc
}

export interface CurveFrame {
  /** Distancia (XZ) al punto mas cercano de la curva. */
  d: number
  /** Largo recorrido sobre la curva hasta ese punto. */
  s: number
  /** Tangente unitaria (XZ) de la curva en ese punto. */
  tx: number
  tz: number
}

/**
 * Marco local de una curva visto desde (x, z), en el plano XZ: distancia,
 * largo recorrido y tangente en el punto mas cercano. Lo usa el modo Ondas
 * para que las costillas sigan la curva y la onda viaje a lo largo de ella.
 */
export function curveFrame2D(x: number, z: number, a: CurveAttractor): CurveFrame {
  const pts = curvePath(a)
  const acc = cumulativeLengths(a)
  let best: CurveFrame = { d: Infinity, s: 0, tx: 1, tz: 0 }
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x
    const az = pts[i].z
    const abx = pts[i + 1].x - ax
    const abz = pts[i + 1].z - az
    const lenSq = abx * abx + abz * abz
    if (lenSq < 1e-12) continue
    const t = clamp(((x - ax) * abx + (z - az) * abz) / lenSq, 0, 1)
    const d = Math.hypot(x - (ax + abx * t), z - (az + abz * t))
    if (d < best.d) {
      const len = Math.sqrt(lenSq)
      best = { d, s: acc[i] + t * len, tx: abx / len, tz: abz / len }
    }
  }
  if (best.d === Infinity && pts.length) {
    best.d = Math.hypot(x - pts[0].x, z - pts[0].z)
  }
  return best
}

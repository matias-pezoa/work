/**
 * Corte laser — patrones por elementos repetidos. Funciones puras que usa
 * `laserCut.ts`:
 *
 *   - DISPOSICION: donde va cada elemento. `grid` = filas (con desfase y
 *     rotacion global); `radial` = anillos concentricos alrededor de un
 *     centro, con N sectores opcionales. En radial cada elemento puede
 *     CURVARSE a lo largo de su anillo (`warp`): un corte recto se vuelve un
 *     arco y la bisagra recta, una bisagra concentrica.
 *   - SIMETRIA: se aplica al CAMPO, no a los cortes: cada atractor se copia
 *     por el grupo de simetria (espejos, rotacion de orden N, caleidoscopio).
 *     Asi un solo atractor ya produce un patron simetrico, y el puente minimo
 *     se sigue garantizando por construccion.
 *   - BISAGRA KERF (kerf bending / living hinge): los patrones clasicos de
 *     la muestra de referencia — recto, rombo, hex, panal, bolo, cruz,
 *     corchetes, meandro y triangulos — como generadores de un elemento.
 *   - MODULO PERSONALIZADO: trazos dibujados por el usuario en una celda
 *     normalizada [-0.5, 0.5]^2, repetidos por la disposicion.
 *   - ALTERNANCIA DE CELDA: espejar columnas/filas o girar en damero.
 *   - CONTROL DE PUENTE: indice espacial de segmentos que rechaza un
 *     elemento si queda a menos del puente minimo de uno ya aceptado. En
 *     grilla los tamanos ya se derivan del paso, asi que casi nunca actua; en
 *     radial y con modulos libres es lo que mantiene la garantia.
 */
import * as THREE from 'three'
import { DEG2RAD } from '../utils/params'
import type { Attractor } from './attractionField'
import { distanceToSegment, type Bounds2D, type Vec2 } from './polygon'

/** Trazo de un elemento: en coordenadas locales o ya en el plano (mm). */
export interface Shape {
  points: Vec2[]
  closed: boolean
}

// ------------------------------------------------------------ disposicion

export type LaserLayout = 'grid' | 'radial'

export const LAYOUT_LABELS: Record<LaserLayout, string> = {
  grid: 'Grilla',
  radial: 'Radial',
}

export interface Lattice {
  /** Paso a lo largo de la fila (eje x local), en mm. */
  w: number
  /** Paso entre filas (eje z local), en mm. */
  h: number
  /** Desfase de las filas impares, en fraccion de `w`. */
  stagger: number
  /** Radial: cantidad par de elementos por anillo (patrones con paridad arriba/abajo). */
  evenRings?: boolean
}

export interface LayoutOptions {
  layout: LaserLayout
  center: Vec2
  rotationDeg: number
  radialStartMm: number
  /** Radial: elementos por anillo multiplo de esto (1 = libre). */
  radialSectors: number
  /** Radial: curvar cada elemento a lo largo de su anillo. */
  radialWarp: boolean
}

export interface Placement {
  x: number
  z: number
  /** Direccion del eje x local en el plano (rad). */
  angle: number
  /** Paso disponible a lo largo de la fila en este lugar (mm). */
  cellW: number
  cellH: number
  i: number
  j: number
  /** Lleva un punto local (mm, origen en el elemento) al plano. */
  map: (lx: number, lz: number) => Vec2
  /** true si `map` deforma (radial curvado): hay que densificar los tramos. */
  warped: boolean
}

/** Recorre los lugares de la disposicion; `fn` devuelve false para cortar. */
export function forEachPlacement(
  bounds: Bounds2D,
  lattice: Lattice,
  opts: LayoutOptions,
  fn: (p: Placement) => boolean | void,
): void {
  if (opts.layout === 'radial') radialPlacements(bounds, lattice, opts, fn)
  else gridPlacements(bounds, lattice, opts, fn)
}

function rigidMap(x: number, z: number, angle: number): Placement['map'] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return (lx, lz) => [x + lx * cos - lz * sin, z + lx * sin + lz * cos]
}

function gridPlacements(
  b: Bounds2D,
  lat: Lattice,
  opts: LayoutOptions,
  fn: (p: Placement) => boolean | void,
): void {
  const angle = opts.rotationDeg * DEG2RAD
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const [cx, cz] = opts.center
  // caja de la pieza en el marco de la grilla (rotada y centrada).
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  for (const [x, z] of [
    [b.minX, b.minZ],
    [b.maxX, b.minZ],
    [b.maxX, b.maxZ],
    [b.minX, b.maxZ],
  ]) {
    const u = (x - cx) * cos + (z - cz) * sin
    const v = -(x - cx) * sin + (z - cz) * cos
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }
  const j0 = Math.floor(minV / lat.h) - 1
  const j1 = Math.ceil(maxV / lat.h) + 1
  const i0 = Math.floor(minU / lat.w) - 2
  const i1 = Math.ceil(maxU / lat.w) + 1
  for (let j = j0; j <= j1; j++) {
    const offset = Math.abs(j) % 2 === 1 ? lat.stagger * lat.w : 0
    for (let i = i0; i <= i1; i++) {
      const u = i * lat.w + offset
      const v = j * lat.h
      const x = cx + u * cos - v * sin
      const z = cz + u * sin + v * cos
      const go = fn({
        x,
        z,
        angle,
        cellW: lat.w,
        cellH: lat.h,
        i,
        j,
        map: rigidMap(x, z, angle),
        warped: false,
      })
      if (go === false) return
    }
  }
}

function radialPlacements(
  b: Bounds2D,
  lat: Lattice,
  opts: LayoutOptions,
  fn: (p: Placement) => boolean | void,
): void {
  const [cx, cz] = opts.center
  const R = Math.max(
    ...[
      [b.minX, b.minZ],
      [b.maxX, b.minZ],
      [b.maxX, b.maxZ],
      [b.minX, b.maxZ],
    ].map(([x, z]) => Math.hypot(x - cx, z - cz)),
  )
  const r0 = Math.max(opts.radialStartMm, lat.h / 2)
  const sectors = Math.max(1, Math.round(opts.radialSectors))
  const rot = opts.rotationDeg * DEG2RAD
  for (let k = 0; ; k++) {
    const r = r0 + k * lat.h
    if (r > R + lat.h) return
    // floor: el arco por elemento nunca es menor que el paso pedido.
    let n = Math.max(1, Math.floor((2 * Math.PI * r) / lat.w))
    if (sectors > 1) n = Math.max(sectors, Math.floor(n / sectors) * sectors)
    if (lat.evenRings && n % 2 === 1) n = n > 1 ? n - 1 : 2
    const dTheta = (2 * Math.PI) / n
    const phase = rot + (k % 2 === 1 ? lat.stagger * dTheta : 0)
    for (let i = 0; i < n; i++) {
      const theta = phase + i * dTheta
      const x = cx + r * Math.cos(theta)
      const z = cz + r * Math.sin(theta)
      // eje x local = tangente (sentido antihorario), eje z local = hacia el centro.
      const angle = theta + Math.PI / 2
      const map: Placement['map'] = opts.radialWarp
        ? (lx, lz) => {
            const phi = theta + lx / r
            const rho = r - lz
            return [cx + rho * Math.cos(phi), cz + rho * Math.sin(phi)]
          }
        : rigidMap(x, z, angle)
      const go = fn({
        x,
        z,
        angle,
        cellW: r * dTheta,
        cellH: lat.h,
        i,
        j: k,
        map,
        warped: opts.radialWarp,
      })
      if (go === false) return
    }
  }
}

/** Lleva trazos locales al plano; si la disposicion curva, densifica antes. */
export function placeShapes(shapes: readonly Shape[], p: Placement): Shape[] {
  return shapes.map((s) => {
    const pts = p.warped ? densify(s.points, s.closed, WARP_STEP_MM) : s.points
    return { points: pts.map(([x, z]) => p.map(x, z)), closed: s.closed }
  })
}

/** Largo maximo de tramo antes de curvar (radial): el arco se lee liso. */
const WARP_STEP_MM = 1.5

export function densify(points: readonly Vec2[], closed: boolean, step: number): Vec2[] {
  const out: Vec2[] = []
  const n = points.length
  const last = closed ? n : n - 1
  for (let k = 0; k < last; k++) {
    const a = points[k]
    const b = points[(k + 1) % n]
    const parts = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
    for (let s = 0; s < parts; s++) {
      const t = s / parts
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  if (!closed && n > 0) out.push(points[n - 1])
  return out
}

// --------------------------------------------------------------- simetria

export type LaserSymmetry =
  'none' | 'mirrorX' | 'mirrorZ' | 'mirrorXZ' | 'rotational' | 'kaleido'

export const SYMMETRY_LABELS: Record<LaserSymmetry, string> = {
  none: 'Ninguna',
  mirrorX: 'Espejo |',
  mirrorZ: 'Espejo —',
  mirrorXZ: 'Espejo +',
  rotational: 'Rotacion N',
  kaleido: 'Caleidoscopio',
}

/** Matriz 2x2 [a, b, c, d]: x' = a x + b z, z' = c x + d z (alrededor del centro). */
type Mat2 = readonly [number, number, number, number]

const IDENTITY: Mat2 = [1, 0, 0, 1]
const MIRROR_X: Mat2 = [-1, 0, 0, 1]
const MIRROR_Z: Mat2 = [1, 0, 0, -1]

function rotation(angle: number): Mat2 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [c, -s, s, c]
}

function mul(m: Mat2, n: Mat2): Mat2 {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
  ]
}

/** Elementos del grupo de simetria (el primero siempre es la identidad). */
export function symmetryTransforms(mode: LaserSymmetry, order: number): Mat2[] {
  const n = Math.max(2, Math.round(order))
  switch (mode) {
    case 'none':
      return [IDENTITY]
    case 'mirrorX':
      return [IDENTITY, MIRROR_X]
    case 'mirrorZ':
      return [IDENTITY, MIRROR_Z]
    case 'mirrorXZ':
      return [IDENTITY, MIRROR_X, MIRROR_Z, [-1, 0, 0, -1]]
    case 'rotational':
      return Array.from({ length: n }, (_, k) => rotation((2 * Math.PI * k) / n))
    case 'kaleido': {
      const rots = Array.from({ length: n }, (_, k) => rotation((2 * Math.PI * k) / n))
      return [...rots, ...rots.map((r) => mul(r, MIRROR_Z))]
    }
  }
}

/** Angulos (rad) de los ejes de espejo, como rectas por el centro. */
export function symmetryAxes(mode: LaserSymmetry, order: number): number[] {
  const n = Math.max(2, Math.round(order))
  switch (mode) {
    case 'mirrorX':
      return [Math.PI / 2]
    case 'mirrorZ':
      return [0]
    case 'mirrorXZ':
      return [0, Math.PI / 2]
    case 'kaleido':
      return Array.from({ length: n }, (_, k) => (Math.PI * k) / n)
    default:
      return []
  }
}

/**
 * Copia cada atractor por el grupo de simetria alrededor de `center` (en
 * unidades Three). Las copias llevan id `original~k`: la vista las dibuja
 * como fantasmas no editables.
 */
export function symmetrizeAttractors(
  attractors: readonly Attractor[],
  mode: LaserSymmetry,
  order: number,
  center: { x: number; z: number },
): Attractor[] {
  const transforms = symmetryTransforms(mode, order)
  if (transforms.length === 1) return [...attractors]
  const out: Attractor[] = []
  transforms.forEach((m, k) => {
    for (const a of attractors)
      out.push(k === 0 ? a : transformAttractor(a, m, center, k))
  })
  return out
}

function transformAttractor(
  a: Attractor,
  m: Mat2,
  c: { x: number; z: number },
  k: number,
): Attractor {
  const tp = (p: THREE.Vector3) => {
    const dx = p.x - c.x
    const dz = p.z - c.z
    return new THREE.Vector3(
      c.x + m[0] * dx + m[1] * dz,
      p.y,
      c.z + m[2] * dx + m[3] * dz,
    )
  }
  const id = `${a.id}~${k}`
  if (a.kind === 'point') {
    const r = a.angleDeg * DEG2RAD
    const dx = Math.cos(r)
    const dz = Math.sin(r)
    const angleDeg =
      (Math.atan2(m[2] * dx + m[3] * dz, m[0] * dx + m[1] * dz) * 180) / Math.PI
    return { ...a, id, position: tp(a.position), angleDeg }
  }
  return { ...a, id, points: a.points.map(tp), smooth: [...a.smooth] }
}

// ----------------------------------------------------- alternancia de celda

export type CellFlip = 'none' | 'mirrorCols' | 'mirrorRows' | 'checker180' | 'checker90'

export const CELL_FLIP_LABELS: Record<CellFlip, string> = {
  none: 'Igual',
  mirrorCols: 'Espejo columnas',
  mirrorRows: 'Espejo filas',
  checker180: 'Damero 180',
  checker90: 'Damero 90',
}

const odd = (n: number) => Math.abs(n) % 2 === 1

/** Transforma un trazo local segun la celda (i, j). */
export function flipShapes(
  shapes: readonly Shape[],
  flip: CellFlip,
  i: number,
  j: number,
): Shape[] {
  let f: ((p: Vec2) => Vec2) | null = null
  if (flip === 'mirrorCols' && odd(i)) f = ([x, z]) => [-x, z]
  else if (flip === 'mirrorRows' && odd(j)) f = ([x, z]) => [x, -z]
  else if (flip === 'checker180' && odd(i + j)) f = ([x, z]) => [-x, -z]
  else if (flip === 'checker90' && odd(i + j)) f = ([x, z]) => [-z, x]
  if (!f) return [...shapes]
  return shapes.map((s) => ({ points: s.points.map(f), closed: s.closed }))
}

export function rotateShapes(shapes: readonly Shape[], angle: number): Shape[] {
  if (angle === 0) return [...shapes]
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return shapes.map((sh) => ({
    points: sh.points.map(([x, z]): Vec2 => [x * c - z * s, x * s + z * c]),
    closed: sh.closed,
  }))
}

// ---------------------------------------------------------- bisagra kerf

export type HingePattern =
  | 'straight'
  | 'diamond'
  | 'hex'
  | 'beehive'
  | 'bowling'
  | 'cross'
  | 'brackets'
  | 'meander'
  | 'triangles'

export const HINGE_LABELS: Record<HingePattern, string> = {
  straight: 'Recto',
  diamond: 'Rombo',
  hex: 'Hex',
  beehive: 'Panal',
  bowling: 'Bolo',
  cross: 'Cruz',
  brackets: 'Corchetes',
  meander: 'Meandro',
  triangles: 'Triangulos',
}

/** Patrones que usan el ancho de figura (`hingeWidthMm`). */
export const HINGE_USES_WIDTH: ReadonlySet<HingePattern> = new Set([
  'diamond',
  'hex',
  'beehive',
  'bowling',
  'cross',
  'brackets',
])

/** Patrones cuyos elementos son figuras cerradas (calados) y no cortes abiertos. */
export const HINGE_CLOSED: ReadonlySet<HingePattern> = new Set([
  'diamond',
  'hex',
  'beehive',
  'bowling',
])

export type HingeLatticeKind = 'brick' | 'square' | 'triangle'

export function hingeLatticeKind(pattern: HingePattern): HingeLatticeKind {
  if (pattern === 'meander') return 'square'
  if (pattern === 'triangles') return 'triangle'
  return 'brick'
}

/**
 * Elemento de una bisagra en filas, centrado en el origen: largo `L` a lo
 * largo de x, ancho `w` en z (amplitud en corchetes, horquilla en cruz).
 */
export function hingeRowElement(
  pattern: HingePattern,
  L: number,
  w: number,
  waves: number,
): Shape[] {
  const a = L / 2
  const b = w / 2
  switch (pattern) {
    case 'diamond':
      return [
        {
          points: [
            [-a, 0],
            [0, -b],
            [a, 0],
            [0, b],
          ],
          closed: true,
        },
      ]
    case 'hex': {
      const c = Math.min(b, a / 2)
      return [
        {
          points: [
            [-a, 0],
            [-a + c, -b],
            [a - c, -b],
            [a, 0],
            [a - c, b],
            [-a + c, b],
          ],
          closed: true,
        },
      ]
    }
    case 'beehive': {
      const n = 24
      return [
        {
          points: Array.from({ length: n }, (_, k): Vec2 => {
            const phi = (2 * Math.PI * k) / n
            return [a * Math.cos(phi), b * Math.sin(phi)]
          }),
          closed: true,
        },
      ]
    }
    case 'bowling': {
      // dos lobulos con cintura al centro (la "botella" de la muestra).
      const n = 16
      const top: Vec2[] = []
      const bottom: Vec2[] = []
      for (let k = 0; k <= 2 * n; k++) {
        const u = k / n - 1
        const hw =
          b *
          Math.sqrt(Math.max(0, 1 - u * u)) *
          (0.45 + 0.55 * Math.abs(Math.sin(Math.PI * u)))
        top.push([a * u, hw])
        if (k > 0 && k < 2 * n) bottom.push([a * u, -hw])
      }
      return [{ points: [...top, ...bottom.reverse()], closed: true }]
    }
    case 'cross': {
      // >—< : horquillas abiertas hacia los extremos.
      const f = Math.min(a * 0.35, Math.max(b, 0.5))
      return [
        {
          points: [
            [-a + f, 0],
            [a - f, 0],
          ],
          closed: false,
        },
        {
          points: [
            [-a, -b],
            [-a + f, 0],
            [-a, b],
          ],
          closed: false,
        },
        {
          points: [
            [a, -b],
            [a - f, 0],
            [a, b],
          ],
          closed: false,
        },
      ]
    }
    case 'brackets': {
      const n = Math.max(8, Math.ceil(16 * waves))
      return [
        {
          points: Array.from({ length: n + 1 }, (_, k): Vec2 => {
            const x = -a + (L * k) / n
            return [x, b * Math.sin((2 * Math.PI * waves * k) / n)]
          }),
          closed: false,
        },
      ]
    }
    default:
      return [
        {
          points: [
            [-a, 0],
            [a, 0],
          ],
          closed: false,
        },
      ]
  }
}

/**
 * Meandro: espiral cuadrada abierta dentro de una celda de lado `cell`,
 * separada `gap` de las vecinas y con `spacing` entre vueltas. Cada vuelta
 * mantiene un pasillo de material de `spacing` hasta la anterior.
 */
export function meanderElement(cell: number, gap: number, spacing: number): Shape[] {
  const a = (cell - gap) / 2
  if (a <= spacing) return []
  const dirs: Vec2[] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ]
  let p: Vec2 = [-a, -a]
  const pts: Vec2[] = [p]
  for (let k = 0; k < 400; k++) {
    const len = k < 3 ? 2 * a : 2 * a - Math.floor((k - 1) / 2) * spacing
    if (len < spacing) break
    const d = dirs[k % 4]
    p = [p[0] + d[0] * len, p[1] + d[1] * len]
    pts.push(p)
  }
  return pts.length >= 2 ? [{ points: pts, closed: false }] : []
}

/**
 * Triangulos anidados (muestras "Bastian"/"Geodesic"): dentro de cada
 * triangulo de la teselacion, contornos concentricos separados `spacing`,
 * cada uno ABIERTO en un vertice (rotando de vertice en cada nivel) para que
 * ningun anillo se suelte. `up`: punta hacia +z local.
 */
export function trianglesElement(
  side: number,
  up: boolean,
  gap: number,
  spacing: number,
  opening: number,
): Shape[] {
  const h = (side * Math.sqrt(3)) / 2
  const s = up ? 1 : -1
  const verts: Vec2[] = [
    [-side / 2, (-s * h) / 2],
    [side / 2, (-s * h) / 2],
    [0, (s * h) / 2],
  ]
  const cz = (-s * h) / 6
  const inradius = h / 3
  const out: Shape[] = []
  for (let m = 0; ; m++) {
    const d = gap / 2 + m * spacing
    const k = (inradius - d) / inradius
    if (k <= 0) break
    const v = verts.map(([x, z]): Vec2 => [x * k, cz + (z - cz) * k])
    const edge = side * k
    if (edge < 2 * opening) break
    // abierto en el vertice `m % 3`: arranca y termina a opening/2 de el.
    const c = m % 3
    const v0 = v[c]
    const v1 = v[(c + 1) % 3]
    const v2 = v[(c + 2) % 3]
    const t = opening / 2 / edge
    out.push({
      points: [
        [v0[0] + (v1[0] - v0[0]) * t, v0[1] + (v1[1] - v0[1]) * t],
        v1,
        v2,
        [v0[0] + (v2[0] - v0[0]) * t, v0[1] + (v2[1] - v0[1]) * t],
      ],
      closed: false,
    })
  }
  return out
}

// ---------------------------------------------------------------- modulo

/** Modulo dibujado por el usuario, en coordenadas de celda [-0.5, 0.5]^2. */
export interface LaserModule {
  paths: Shape[]
}

export const DEFAULT_MODULE: LaserModule = {
  // tripode: tres cortes desde el centro (bisagra auxetica clasica).
  paths: [
    {
      points: [
        [-0.42, 0.24],
        [0, 0],
        [0.42, 0.24],
      ],
      closed: false,
    },
    {
      points: [
        [0, 0],
        [0, -0.45],
      ],
      closed: false,
    },
  ],
}

/** Escala el modulo normalizado a un rectangulo `sx` x `sz` mm. */
export function moduleShapes(module: LaserModule, sx: number, sz: number): Shape[] {
  return module.paths
    .filter((p) => p.points.length >= (p.closed ? 3 : 2))
    .map((p) => ({
      points: p.points.map(([u, v]): Vec2 => [u * sx, v * sz]),
      closed: p.closed,
    }))
}

// ------------------------------------------------------- control de puente

interface Seg {
  ax: number
  az: number
  bx: number
  bz: number
  open: boolean
}

function orient(ax: number, az: number, bx: number, bz: number, cx: number, cz: number) {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
}

/** Distancia entre dos segmentos (0 si se cruzan). */
export function segmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const o1 = orient(a[0], a[1], b[0], b[1], c[0], c[1])
  const o2 = orient(a[0], a[1], b[0], b[1], d[0], d[1])
  const o3 = orient(c[0], c[1], d[0], d[1], a[0], a[1])
  const o4 = orient(c[0], c[1], d[0], d[1], b[0], b[1])
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0
  return Math.min(
    distanceToSegment(a[0], a[1], c, d),
    distanceToSegment(b[0], b[1], c, d),
    distanceToSegment(c[0], c[1], a, b),
    distanceToSegment(d[0], d[1], a, b),
  )
}

function shapeSegments(s: Shape): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = []
  for (let k = 1; k < s.points.length; k++) out.push([s.points[k - 1], s.points[k]])
  if (s.closed && s.points.length > 2)
    out.push([s.points[s.points.length - 1], s.points[0]])
  return out
}

/**
 * Separacion de material que exige el puente entre dos trazos DISENADOS: el
 * haz quema kerf/2 a cada lado de un corte abierto; un calado cerrado ya se
 * compensa hacia adentro, asi que su borde disenado es el borde real.
 */
export function requiredGap(
  bridge: number,
  kerf: number,
  openA: boolean,
  openB: boolean,
) {
  return bridge + (openA ? kerf / 2 : 0) + (openB ? kerf / 2 : 0)
}

/** Distancia minima entre dos grupos de trazos, comparada contra el puente requerido. */
export function shapesClearance(
  a: readonly Shape[],
  b: readonly Shape[],
  bridge: number,
  kerf: number,
): number {
  let best = Infinity
  for (const sa of a) {
    for (const sb of b) {
      const req = requiredGap(bridge, kerf, !sa.closed, !sb.closed)
      for (const [p, q] of shapeSegments(sa))
        for (const [r, s] of shapeSegments(sb)) {
          const d = segmentDistance(p, q, r, s) - req
          if (d < best) best = d
        }
    }
  }
  return best
}

export function translateShapes(
  shapes: readonly Shape[],
  dx: number,
  dz: number,
): Shape[] {
  return shapes.map((s) => ({
    points: s.points.map(([x, z]): Vec2 => [x + dx, z + dz]),
    closed: s.closed,
  }))
}

export interface BridgeGuard {
  /** true si el elemento respeta el puente contra todo lo aceptado. */
  fits(shapes: readonly Shape[]): boolean
  add(shapes: readonly Shape[]): void
}

export function createBridgeGuard(bridge: number, kerf: number): BridgeGuard {
  const reach = bridge + kerf
  const cell = Math.max(4, 2 * reach)
  const grid = new Map<string, Seg[]>()
  const key = (i: number, j: number) => `${i},${j}`
  const cellsOf = (s: Seg, pad: number, fn: (k: string) => boolean | void) => {
    const i0 = Math.floor((Math.min(s.ax, s.bx) - pad) / cell)
    const i1 = Math.floor((Math.max(s.ax, s.bx) + pad) / cell)
    const j0 = Math.floor((Math.min(s.az, s.bz) - pad) / cell)
    const j1 = Math.floor((Math.max(s.az, s.bz) + pad) / cell)
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) if (fn(key(i, j)) === false) return false
    return true
  }
  const segs = (shapes: readonly Shape[]): Seg[] =>
    shapes.flatMap((s) =>
      shapeSegments(s).map(([a, b]) => ({
        ax: a[0],
        az: a[1],
        bx: b[0],
        bz: b[1],
        open: !s.closed,
      })),
    )
  return {
    fits(shapes) {
      for (const s of segs(shapes)) {
        const ok = cellsOf(s, reach, (k) => {
          for (const o of grid.get(k) ?? []) {
            const d = segmentDistance(
              [s.ax, s.az],
              [s.bx, s.bz],
              [o.ax, o.az],
              [o.bx, o.bz],
            )
            if (d < requiredGap(bridge, kerf, s.open, o.open) - 1e-6) return false
          }
        })
        if (!ok) return false
      }
      return true
    },
    add(shapes) {
      for (const s of segs(shapes)) {
        cellsOf(s, 0, (k) => {
          const list = grid.get(k)
          if (list) list.push(s)
          else grid.set(k, [s])
        })
      }
    },
  }
}

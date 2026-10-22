/**
 * Modo Corte laser: intervencion de una pieza plana con cortes y calados
 * parametricos, SOLO vector (2D, en mm, plano XZ con el mismo origen que la
 * base de los modos 3D).
 *
 * Familias:
 *   - perforation  Calado por campo: perforaciones poligonales en una grilla
 *                  hexagonal; tamano y orientacion salen del mapa de atractores.
 *   - kirigami     Reticula auxetica de cuadrados rotantes: cortes rectos
 *                  alternados (horizontal/vertical) en una grilla cuadrada. El
 *                  campo achica la bisagra entre cortes -> mas estiramiento.
 *   - scales       Escamas: cortes abiertos en arco, en filas alternadas. La
 *                  lengueta que queda dentro del arco se levanta al curvar la
 *                  pieza; el campo controla el tamano y la orientacion.
 *   - footprint    Huella de las puas del modo Volumen: un calado circular en
 *                  la base de cada pua (mismas posiciones), para que el corte
 *                  calce con la pieza impresa — el filamento atraviesa el
 *                  calado y se ancla a la tela.
 *
 * Fabricable por construccion (mismo principio que printability.ts en 3D):
 *   - PUENTE MINIMO: entre dos cortes vecinos siempre queda al menos
 *     `minBridgeMm` de material real (ya descontado el kerf). Los tamanos se
 *     recortan a lo que la grilla permite; nunca se acepta un solape.
 *   - MARGEN AL BORDE: ningun corte se acerca al contorno (ni a sus agujeros)
 *     a menos de `edgeMarginMm` (y nunca menos que el puente).
 *   - RASGO MINIMO: perforaciones o cortes mas chicos que `MIN_FEATURE_MM` no
 *     se generan (el haz solo quemaria un punto).
 *   - KERF: los calados cerrados se ofsetean kerf/2 HACIA ADENTRO y el
 *     contorno kerf/2 HACIA AFUERA, para que la pieza fisica mida lo disenado.
 *     Los cortes abiertos se acortan kerf/2 en cada extremo (el haz quema medio
 *     kerf mas alla del final) y su puente lateral suma el ancho quemado.
 *
 * Funciones puras y deterministas.
 */
import * as THREE from 'three'
import { clamp, DEG2RAD, lerp } from '../utils/params'
import type { NumberParam } from '../utils/params'
import { mmToThree } from '../utils/units'
import { sampleField } from './attractionField'
import type { Attractor, CombineMode } from './attractionField'
import {
  distanceToBoundaryEdges,
  offsetPolygon,
  pointInBoundary,
  polygonArea,
  polygonBounds,
  polylineLength,
  rectBoundary,
  type Boundary,
  type Bounds2D,
  type Vec2,
} from './polygon'

/** Piso absoluto del puente de material entre cortes, en mm. */
export const MIN_BRIDGE_MM = 1
/** Rasgo minimo cortable (diametro menor de un calado, largo de un corte), en mm. */
export const MIN_FEATURE_MM = 1
/** Tope de elementos por pieza, para que una grilla muy fina no congele la UI. */
export const MAX_ELEMENTS = 20000

export type LaserFamily = 'perforation' | 'kirigami' | 'scales' | 'footprint'

export const FAMILY_LABELS: Record<LaserFamily, string> = {
  perforation: 'Calado',
  kirigami: 'Auxetico',
  scales: 'Escamas',
  footprint: 'Huella puas',
}

/**
 * Capas de corte. Se exportan en este orden: primero lo interior, el
 * contorno AL FINAL (si se corta antes, la pieza se suelta y se mueve).
 */
export type CutLayer = 'calado' | 'corte' | 'contorno'

export const LAYER_ORDER: readonly CutLayer[] = ['calado', 'corte', 'contorno']

export interface CutPath {
  layer: CutLayer
  points: Vec2[]
  closed: boolean
}

export interface LaserMaterial {
  id: string
  label: string
  /** Ancho de corte de referencia: probar en un retazo y ajustar. */
  kerfMm: number
  /** Puente minimo sugerido: materiales que se deshilachan o rasgan piden mas. */
  minBridgeMm: number
}

export const LASER_MATERIALS: readonly LaserMaterial[] = [
  { id: 'felt', label: 'Fieltro 2 mm', kerfMm: 0.3, minBridgeMm: 3 },
  { id: 'leather', label: 'Cuero 1.5 mm', kerfMm: 0.2, minBridgeMm: 2 },
  { id: 'cotton', label: 'Algodon / lino', kerfMm: 0.15, minBridgeMm: 2.5 },
  { id: 'neoprene', label: 'Neopreno 3 mm', kerfMm: 0.4, minBridgeMm: 3 },
  { id: 'acrylic', label: 'Acrilico 3 mm', kerfMm: 0.15, minBridgeMm: 1.5 },
  { id: 'cardboard', label: 'Carton 2 mm', kerfMm: 0.25, minBridgeMm: 2 },
]

export interface LaserParams {
  family: LaserFamily
  materialId: string
  kerfMm: number
  minBridgeMm: number
  edgeMarginMm: number
  /** Pieza rectangular por defecto (si no hay base importada). */
  sheetWidthMm: number
  sheetHeightMm: number
  /** Por debajo de este valor de campo no se corta nada (la pieza queda entera). */
  fieldThreshold: number
  combine: CombineMode
  /** Orienta los elementos segun el gradiente del campo. */
  alignToField: boolean

  // --- calado ---
  perfPitchMm: number
  perfSides: number
  perfSizeMin: number
  perfSizeMax: number
  perfElongation: number
  perfRotationDeg: number

  // --- auxetico (kirigami) ---
  kiriCellMm: number
  kiriHingeFarMm: number
  kiriHingeNearMm: number

  // --- escamas ---
  scaleWidthMm: number
  scaleRowRatio: number
  scaleSizeMin: number
  scaleSizeMax: number
  scaleOpeningDeg: number

  // --- huella de puas ---
  footprintScale: number
}

export const DEFAULT_LASER: LaserParams = {
  family: 'perforation',
  materialId: 'felt',
  kerfMm: 0.3,
  minBridgeMm: 3,
  edgeMarginMm: 6,
  sheetWidthMm: 300,
  sheetHeightMm: 200,
  fieldThreshold: 0.05,
  combine: 'max',
  alignToField: true,

  perfPitchMm: 14,
  perfSides: 6,
  perfSizeMin: 0.15,
  perfSizeMax: 1,
  perfElongation: 1.6,
  perfRotationDeg: 0,

  kiriCellMm: 10,
  kiriHingeFarMm: 6,
  kiriHingeNearMm: 3,

  scaleWidthMm: 20,
  scaleRowRatio: 0.6,
  scaleSizeMin: 0.35,
  scaleSizeMax: 1,
  scaleOpeningDeg: 200,

  footprintScale: 0.5,
}

export type LaserNumericKey = {
  [K in keyof LaserParams]: LaserParams[K] extends number ? K : never
}[keyof LaserParams]

export interface LaserParam extends NumberParam {
  readonly key: LaserNumericKey
}

export const MATERIAL_UI_PARAMS: readonly LaserParam[] = [
  {
    key: 'kerfMm',
    label: 'Kerf (ancho de corte)',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.3,
    unit: 'mm',
  },
  {
    key: 'minBridgeMm',
    label: 'Puente minimo',
    min: MIN_BRIDGE_MM,
    max: 10,
    step: 0.1,
    default: 3,
    unit: 'mm',
  },
  {
    key: 'edgeMarginMm',
    label: 'Margen al borde',
    min: MIN_BRIDGE_MM,
    max: 40,
    step: 0.5,
    default: 6,
    unit: 'mm',
  },
]

export const SHEET_UI_PARAMS: readonly LaserParam[] = [
  {
    key: 'sheetWidthMm',
    label: 'Ancho de pieza',
    min: 40,
    max: 1200,
    step: 5,
    default: 300,
    unit: 'mm',
  },
  {
    key: 'sheetHeightMm',
    label: 'Alto de pieza',
    min: 40,
    max: 1200,
    step: 5,
    default: 200,
    unit: 'mm',
  },
]

export const FIELD_LASER_UI_PARAMS: readonly LaserParam[] = [
  {
    key: 'fieldThreshold',
    label: 'Umbral de campo',
    min: 0,
    max: 0.9,
    step: 0.01,
    default: 0.05,
    unit: '-',
  },
]

export const FAMILY_UI_PARAMS: Record<LaserFamily, readonly LaserParam[]> = {
  perforation: [
    {
      key: 'perfPitchMm',
      label: 'Paso de grilla',
      min: 4,
      max: 60,
      step: 0.5,
      default: 14,
      unit: 'mm',
    },
    {
      key: 'perfSides',
      label: 'Lados (24 = circulo)',
      min: 3,
      max: 24,
      step: 1,
      default: 6,
      unit: '-',
    },
    {
      key: 'perfSizeMin',
      label: 'Tamano lejos (x maximo)',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.15,
      unit: '-',
    },
    {
      key: 'perfSizeMax',
      label: 'Tamano cerca (x maximo)',
      min: 0,
      max: 1,
      step: 0.01,
      default: 1,
      unit: '-',
    },
    {
      key: 'perfElongation',
      label: 'Alargamiento',
      min: 1,
      max: 6,
      step: 0.05,
      default: 1.6,
      unit: 'x',
    },
    {
      key: 'perfRotationDeg',
      label: 'Rotacion extra',
      min: -180,
      max: 180,
      step: 1,
      default: 0,
      unit: 'grados',
    },
  ],
  kirigami: [
    {
      key: 'kiriCellMm',
      label: 'Celda',
      min: 4,
      max: 40,
      step: 0.5,
      default: 10,
      unit: 'mm',
    },
    {
      key: 'kiriHingeFarMm',
      label: 'Bisagra lejos',
      min: MIN_BRIDGE_MM,
      max: 20,
      step: 0.1,
      default: 6,
      unit: 'mm',
    },
    {
      key: 'kiriHingeNearMm',
      label: 'Bisagra cerca',
      min: MIN_BRIDGE_MM,
      max: 20,
      step: 0.1,
      default: 3,
      unit: 'mm',
    },
  ],
  scales: [
    {
      key: 'scaleWidthMm',
      label: 'Ancho de escama',
      min: 6,
      max: 80,
      step: 0.5,
      default: 20,
      unit: 'mm',
    },
    {
      key: 'scaleRowRatio',
      label: 'Separacion de filas',
      min: 0.4,
      max: 1.2,
      step: 0.01,
      default: 0.6,
      unit: 'x',
    },
    {
      key: 'scaleSizeMin',
      label: 'Tamano lejos (x maximo)',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.35,
      unit: '-',
    },
    {
      key: 'scaleSizeMax',
      label: 'Tamano cerca (x maximo)',
      min: 0,
      max: 1,
      step: 0.01,
      default: 1,
      unit: '-',
    },
    {
      key: 'scaleOpeningDeg',
      label: 'Apertura del arco',
      min: 60,
      max: 300,
      step: 1,
      default: 200,
      unit: 'grados',
    },
  ],
  footprint: [
    {
      key: 'footprintScale',
      label: 'Calado / base de pua',
      min: 0.1,
      max: 1,
      step: 0.01,
      default: 0.5,
      unit: 'x',
    },
  ],
}

/** Huella de una pua del modo Volumen, ya en mm. */
export interface SpikeFootprint {
  x: number
  z: number
  rootRadiusMm: number
}

export interface LaserInput {
  /** Base importada (mm); si es null se usa la pieza rectangular. */
  boundary?: Boundary | null
  /** Solo familia `footprint`: puas del modo Volumen. */
  footprints?: readonly SpikeFootprint[]
  /** Solo familia `footprint` sin base importada: lado del panel de Volumen (mm). */
  footprintPlaneMm?: number
}

export interface LaserCutResult {
  /** Trazos en orden de corte (ver LAYER_ORDER), ya compensados por kerf. */
  paths: CutPath[]
  /** Pieza SIN compensar (lo disenado). */
  sheet: Boundary
  /** Caja del contorno compensado. */
  bounds: Bounds2D
  calados: number
  cortes: number
  /** Elementos descartados por quedar demasiado cerca del borde. */
  rejectedByEdge: number
  /** Elementos descartados por violar el puente minimo con un vecino (solo huella). */
  rejectedByBridge: number
  /** Elementos que no se generaron por ser menores que el rasgo minimo. */
  skippedBySize: number
  /** Elementos cuyo tamano pedido se recorto para respetar el puente minimo. */
  limitedByBridge: number
  /** Puente efectivamente garantizado (>= minBridge, >= piso absoluto). */
  bridgeMm: number
  cutLengthMm: number
  openAreaMm2: number
  pieceAreaMm2: number
  /** Fraccion de la pieza removida por calados (0..1). */
  openRatio: number
}

interface Ctx {
  params: LaserParams
  attractors: readonly Attractor[]
  sheet: Boundary
  kerf: number
  bridge: number
  margin: number
  out: CutPath[]
  stats: {
    rejectedByEdge: number
    rejectedByBridge: number
    skippedBySize: number
    limitedByBridge: number
    openAreaMm2: number
  }
}

export function buildLaserCut(
  attractors: readonly Attractor[],
  params: LaserParams,
  input: LaserInput = {},
): LaserCutResult {
  const sheet = resolveSheet(params, input)
  const kerf = Math.max(0, params.kerfMm)
  const bridge = Math.max(MIN_BRIDGE_MM, params.minBridgeMm)
  const ctx: Ctx = {
    params,
    attractors,
    sheet,
    kerf,
    bridge,
    margin: Math.max(params.edgeMarginMm, bridge + kerf / 2),
    out: [],
    stats: {
      rejectedByEdge: 0,
      rejectedByBridge: 0,
      skippedBySize: 0,
      limitedByBridge: 0,
      openAreaMm2: 0,
    },
  }

  switch (params.family) {
    case 'perforation':
      buildPerforation(ctx)
      break
    case 'kirigami':
      buildKirigami(ctx)
      break
    case 'scales':
      buildScales(ctx)
      break
    case 'footprint':
      buildFootprint(ctx, input.footprints ?? [])
      break
  }

  const interior = ctx.out
  const outline: CutPath[] = [
    { layer: 'contorno', points: offsetPolygon(sheet.outer, kerf / 2), closed: true },
    ...sheet.holes.map((h): CutPath => ({
      layer: 'contorno',
      points: offsetPolygon(h, -kerf / 2),
      closed: true,
    })),
  ]
  const paths = [...interior, ...outline].sort(
    (a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer),
  )

  const pieceAreaMm2 =
    polygonArea(sheet.outer) - sheet.holes.reduce((s, h) => s + polygonArea(h), 0)

  return {
    paths,
    sheet,
    bounds: polygonBounds(outline[0].points),
    calados: interior.filter((p) => p.layer === 'calado').length,
    cortes: interior.filter((p) => p.layer === 'corte').length,
    ...ctx.stats,
    bridgeMm: bridge,
    cutLengthMm: paths.reduce((s, p) => s + polylineLength(p.points, p.closed), 0),
    pieceAreaMm2,
    openRatio: pieceAreaMm2 > 0 ? ctx.stats.openAreaMm2 / pieceAreaMm2 : 0,
  }
}

function resolveSheet(params: LaserParams, input: LaserInput): Boundary {
  if (input.boundary) return input.boundary
  if (params.family === 'footprint' && input.footprintPlaneMm) {
    return rectBoundary(input.footprintPlaneMm, input.footprintPlaneMm)
  }
  return rectBoundary(params.sheetWidthMm, params.sheetHeightMm)
}

interface FieldAt {
  value: number
  /** Direccion unitaria (x, z) hacia donde CRECE el campo, o null. */
  dir: Vec2 | null
}

const _p = new THREE.Vector3()

/** Campo en un punto del plano (mm). Los atractores viven en unidades Three. */
function fieldAt(ctx: Ctx, x: number, z: number): FieldAt {
  _p.set(mmToThree(x), 0, mmToThree(z))
  const s = sampleField(_p, ctx.attractors, ctx.params.combine)
  if (!s.direction) return { value: s.value, dir: null }
  const len = Math.hypot(s.direction.x, s.direction.z)
  return {
    value: s.value,
    dir: len > 1e-9 ? [s.direction.x / len, s.direction.z / len] : null,
  }
}

/** Todos los puntos dentro de la pieza y a >= margen de cualquier borde. */
function fits(ctx: Ctx, points: readonly Vec2[]): boolean {
  return points.every(
    ([x, z]) =>
      pointInBoundary(x, z, ctx.sheet) &&
      distanceToBoundaryEdges(x, z, ctx.sheet) >= ctx.margin,
  )
}

/** Recorre una grilla sobre la caja de la pieza (filas alternadas opcionales). */
function forEachGridPoint(
  ctx: Ctx,
  stepX: number,
  stepZ: number,
  stagger: boolean,
  fn: (x: number, z: number, i: number, j: number) => void,
): void {
  const b = polygonBounds(ctx.sheet.outer)
  const cx = (b.minX + b.maxX) / 2
  const cz = (b.minZ + b.maxZ) / 2
  // grilla centrada en la pieza: el patron queda simetrico respecto del contorno.
  const ni = Math.ceil((b.maxX - b.minX) / stepX / 2) + 1
  const nj = Math.ceil((b.maxZ - b.minZ) / stepZ / 2) + 1
  for (let j = -nj; j <= nj; j++) {
    const offset = stagger && Math.abs(j) % 2 === 1 ? stepX / 2 : 0
    for (let i = -ni; i <= ni; i++) {
      if (ctx.out.length >= MAX_ELEMENTS) return
      const x = cx + i * stepX + offset
      const z = cz + j * stepZ
      if (!pointInBoundary(x, z, ctx.sheet)) continue
      fn(x, z, i, j)
    }
  }
}

/** Valor de campo re-normalizado sobre el umbral: 0 en el umbral, 1 en el maximo. */
function aboveThreshold(ctx: Ctx, value: number): number | null {
  const thr = clamp(ctx.params.fieldThreshold, 0, 0.99)
  if (value < thr || value <= 0) return null
  return (value - thr) / (1 - thr)
}

// ------------------------------------------------------------------ calado

export function ellipsePolygon(
  cx: number,
  cz: number,
  a: number,
  b: number,
  sides: number,
  angle: number,
): Vec2[] {
  const n = Math.max(3, Math.round(sides))
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const pts: Vec2[] = []
  for (let k = 0; k < n; k++) {
    const phi = (2 * Math.PI * k) / n - Math.PI / 2
    const lx = a * Math.cos(phi)
    const lz = b * Math.sin(phi)
    pts.push([cx + lx * cos - lz * sin, cz + lx * sin + lz * cos])
  }
  return pts
}

function buildPerforation(ctx: Ctx): void {
  const p = ctx.params
  const pitch = Math.max(p.perfPitchMm, MIN_FEATURE_MM + ctx.bridge)
  // grilla hexagonal: los 6 vecinos quedan exactamente a `pitch`. Un calado de
  // radio mayor (circunscrito) <= (pitch - puente)/2 garantiza el puente en
  // cualquier orientacion y alargamiento.
  const rMax = (pitch - ctx.bridge) / 2
  const elong = Math.max(1, p.perfElongation)
  forEachGridPoint(ctx, pitch, (pitch * Math.sqrt(3)) / 2, true, (x, z) => {
    const f = fieldAt(ctx, x, z)
    const t = aboveThreshold(ctx, f.value)
    if (t === null) return
    const sizeFrac = lerp(p.perfSizeMin, p.perfSizeMax, t)
    if (sizeFrac > 1) ctx.stats.limitedByBridge++
    const a = rMax * clamp(sizeFrac, 0, 1)
    const b = a / elong
    if (2 * b < MIN_FEATURE_MM) {
      ctx.stats.skippedBySize++
      return
    }
    const fieldAngle = p.alignToField && f.dir ? Math.atan2(f.dir[1], f.dir[0]) : 0
    const designed = ellipsePolygon(
      x,
      z,
      a,
      b,
      p.perfSides,
      fieldAngle + p.perfRotationDeg * DEG2RAD,
    )
    if (!fits(ctx, designed)) {
      ctx.stats.rejectedByEdge++
      return
    }
    ctx.stats.openAreaMm2 += polygonArea(designed)
    ctx.out.push({
      layer: 'calado',
      points: offsetPolygon(designed, -ctx.kerf / 2),
      closed: true,
    })
  })
}

// --------------------------------------------------------------- auxetico

function buildKirigami(ctx: Ctx): void {
  const p = ctx.params
  // Cuadrados rotantes: en cada nodo de una grilla cuadrada de lado `a` va un
  // corte recto, alternando horizontal/vertical como un tablero. Un corte de
  // semilargo L = a - h deja una bisagra de ancho h contra la linea del corte
  // perpendicular vecino. El haz ensancha ese corte vecino kerf/2, asi que la
  // bisagra disenada debe ser >= puente + kerf/2.
  const minHinge = ctx.bridge + ctx.kerf / 2
  const a = Math.max(p.kiriCellMm, minHinge / 0.8 + MIN_FEATURE_MM)
  const maxHinge = 0.8 * a
  forEachGridPoint(ctx, a, a, false, (x, z, i, j) => {
    const f = fieldAt(ctx, x, z)
    const t = aboveThreshold(ctx, f.value)
    if (t === null) return
    const wanted = lerp(p.kiriHingeFarMm, p.kiriHingeNearMm, t)
    if (wanted < minHinge) ctx.stats.limitedByBridge++
    const h = clamp(wanted, minHinge, maxHinge)
    const half = a - h - ctx.kerf / 2
    if (2 * half < MIN_FEATURE_MM) {
      ctx.stats.skippedBySize++
      return
    }
    const horizontal = (i + j) % 2 === 0
    const dx = horizontal ? half : 0
    const dz = horizontal ? 0 : half
    const seg: Vec2[] = [
      [x - dx, z - dz],
      [x + dx, z + dz],
    ]
    // el corte disenado (sin acortar) es el que no debe acercarse al borde
    const probe: Vec2[] = [0, 0.25, 0.5, 0.75, 1].map((s) => {
      const k = (2 * s - 1) * (half + ctx.kerf / 2)
      return horizontal ? [x + k, z] : [x, z + k]
    })
    if (!fits(ctx, probe)) {
      ctx.stats.rejectedByEdge++
      return
    }
    ctx.out.push({ layer: 'corte', points: seg, closed: false })
  })
}

// ---------------------------------------------------------------- escamas

function buildScales(ctx: Ctx): void {
  const p = ctx.params
  const w = Math.max(p.scaleWidthMm, MIN_FEATURE_MM + ctx.bridge + ctx.kerf)
  const rowStep = w * clamp(p.scaleRowRatio, 0.4, 1.2)
  // vecino mas cercano en filas alternadas: al costado (w) o en diagonal.
  const neighbor = Math.min(w, Math.hypot(w / 2, rowStep), 2 * rowStep)
  // ambos arcos vecinos se ensanchan kerf/2 -> se descuenta un kerf entero.
  const rMax = (neighbor - ctx.bridge - ctx.kerf) / 2
  const opening = clamp(p.scaleOpeningDeg, 10, 340) * DEG2RAD
  forEachGridPoint(ctx, w, rowStep, true, (x, z) => {
    const f = fieldAt(ctx, x, z)
    const t = aboveThreshold(ctx, f.value)
    if (t === null) return
    const sizeFrac = lerp(p.scaleSizeMin, p.scaleSizeMax, t)
    if (sizeFrac > 1) ctx.stats.limitedByBridge++
    const r = rMax * clamp(sizeFrac, 0, 1)
    if (r * opening < MIN_FEATURE_MM || r < MIN_FEATURE_MM / 2) {
      ctx.stats.skippedBySize++
      return
    }
    // la punta de la lengueta apunta lejos del atractor (o "hacia abajo", +z).
    const theta = p.alignToField && f.dir ? Math.atan2(-f.dir[1], -f.dir[0]) : Math.PI / 2
    const designed = arcPoints(x, z, r, theta, opening, 0)
    if (!fits(ctx, designed)) {
      ctx.stats.rejectedByEdge++
      return
    }
    const trim = Math.min(ctx.kerf / 2 / r, opening / 4)
    ctx.out.push({
      layer: 'corte',
      points: arcPoints(x, z, r, theta, opening, trim),
      closed: false,
    })
  })
}

/** Arco centrado en `theta` con apertura total `opening`, recortado `trim` rad por extremo. */
function arcPoints(
  cx: number,
  cz: number,
  r: number,
  theta: number,
  opening: number,
  trim: number,
): Vec2[] {
  const from = theta - opening / 2 + trim
  const to = theta + opening / 2 - trim
  const steps = Math.max(4, Math.ceil(((to - from) / Math.PI) * 18))
  const pts: Vec2[] = []
  for (let k = 0; k <= steps; k++) {
    const ang = from + ((to - from) * k) / steps
    pts.push([cx + r * Math.cos(ang), cz + r * Math.sin(ang)])
  }
  return pts
}

// ----------------------------------------------------------- huella puas

const FOOTPRINT_SIDES = 32

function buildFootprint(ctx: Ctx, footprints: readonly SpikeFootprint[]): void {
  const accepted: { x: number; z: number; r: number }[] = []
  for (const fp of footprints) {
    if (ctx.out.length >= MAX_ELEMENTS) break
    const r = fp.rootRadiusMm * clamp(ctx.params.footprintScale, 0, 1)
    if (2 * r < MIN_FEATURE_MM) {
      ctx.stats.skippedBySize++
      continue
    }
    const designed = ellipsePolygon(fp.x, fp.z, r, r, FOOTPRINT_SIDES, 0)
    if (!fits(ctx, designed)) {
      ctx.stats.rejectedByEdge++
      continue
    }
    if (accepted.some((o) => Math.hypot(o.x - fp.x, o.z - fp.z) - o.r - r < ctx.bridge)) {
      ctx.stats.rejectedByBridge++
      continue
    }
    accepted.push({ x: fp.x, z: fp.z, r })
    ctx.stats.openAreaMm2 += polygonArea(designed)
    ctx.out.push({
      layer: 'calado',
      points: ellipsePolygon(
        fp.x,
        fp.z,
        r - ctx.kerf / 2,
        r - ctx.kerf / 2,
        FOOTPRINT_SIDES,
        0,
      ),
      closed: true,
    })
  }
}

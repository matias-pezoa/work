/**
 * Generador de probetas: una serie de probetas del diseno actual para probar
 * en el material real antes de la pieza. Cada probeta es su propio archivo
 * de formato fijo (por defecto 200 x 200 mm: la pieza mide el formato) y se
 * exporta por separado, asi no hay que adivinar que probeta es cual en la
 * mesa del laser.
 *
 * La serie varia hasta dos parametros en matriz (pasos X x pasos Y) o un solo
 * parametro probeta a probeta; sin ejes son copias identicas numeradas (para
 * probar potencia/velocidad). Cada probeta lleva su numero y sus valores
 * grabados en una franja superior sin cortes.
 *
 * `planSpecimens` es barato (solo valores); `buildSpecimen` arma la geometria
 * de una probeta con `buildLaserCut` (mismas garantias de puente, margen y
 * kerf), por defecto uniforme y sin simetria, o con el campo del diseno
 * escalado a la probeta (`keepField`). Funciones puras.
 */
import * as THREE from 'three'
import { clamp, lerp, type NumberParam } from '../utils/params'
import { mmToThree } from '../utils/units'
import type { Attractor } from './attractionField'
import {
  buildLaserCut,
  FAMILY_LABELS,
  FAMILY_UI_PARAMS,
  FIELD_LASER_UI_PARAMS,
  hingeUiParams,
  IMAGE_BITMAP_UI_PARAMS,
  IMAGE_HALFTONE_UI_PARAMS,
  IMAGE_TONE_UI_PARAMS,
  LAYER_ORDER,
  MATERIAL_UI_PARAMS,
  type CutPath,
  type LaserFamily,
  type LaserNumericKey,
  type LaserParam,
  type LaserParams,
  type TextLabel,
} from './laserCut'
import type { LaserBitmap } from './laserImage'
import {
  offsetPolygon,
  polylineLength,
  rectBoundary,
  type Bounds2D,
  type Vec2,
} from './polygon'
import { strokeTextWidth } from './strokeFont'

/** Familias que generan piezas sueltas o dependen de otro modo: sin probetas. */
export const SPECIMEN_UNSUPPORTED: ReadonlySet<LaserFamily> = new Set([
  'layers',
  'footprint',
])

export type SpecimenAxis = LaserNumericKey | 'none'

export interface SpecimenParams {
  /** Apellido de quien corta: va en el nombre de archivo y grabado en la probeta. */
  surname: string
  /** Formato de cada probeta = tamano del archivo y de la pieza. */
  widthMm: number
  heightMm: number
  /** Pasos del eje X (con un solo eje o sin ejes: cantidad de probetas). */
  steps: number
  /** Pasos del eje Y (solo con dos ejes: filas de la matriz). */
  stepsY: number
  /** Franja superior sin cortes para el rotulo grabado (0 = sin rotulo). */
  headerMm: number
  labelMm: number
  /** Cortar el contorno de la probeta (apagado: el material ya viene al formato). */
  cutOutline: boolean
  axisX: SpecimenAxis
  xFrom: number
  xTo: number
  axisY: SpecimenAxis
  yFrom: number
  yTo: number
  /** Usar el campo del diseno (atractores o imagen) escalado a cada probeta. */
  keepField: boolean
}

export const DEFAULT_SPECIMEN: SpecimenParams = {
  surname: '',
  widthMm: 200,
  heightMm: 200,
  steps: 4,
  stepsY: 3,
  headerMm: 14,
  labelMm: 4,
  cutOutline: true,
  axisX: 'perfPitchMm',
  xFrom: 8,
  xTo: 20,
  axisY: 'none',
  yFrom: 0,
  yTo: 0,
  keepField: false,
}

export type SpecimenNumericKey = {
  [K in keyof SpecimenParams]: SpecimenParams[K] extends number ? K : never
}[keyof SpecimenParams]

export interface SpecimenParam extends NumberParam {
  readonly key: SpecimenNumericKey
}

export const SPECIMEN_FORMAT_UI_PARAMS: readonly SpecimenParam[] = [
  {
    key: 'widthMm',
    label: 'Formato: ancho',
    min: 30,
    max: 600,
    step: 5,
    default: 200,
    unit: 'mm',
  },
  {
    key: 'heightMm',
    label: 'Formato: alto',
    min: 30,
    max: 600,
    step: 5,
    default: 200,
    unit: 'mm',
  },
  {
    key: 'headerMm',
    label: 'Franja del rotulo',
    min: 0,
    max: 30,
    step: 0.5,
    default: 14,
    unit: 'mm',
  },
  {
    key: 'labelMm',
    label: 'Alto del texto',
    min: 1.5,
    max: 10,
    step: 0.1,
    default: 4,
    unit: 'mm',
  },
]

export const SPECIMEN_STEPS_PARAM: SpecimenParam = {
  key: 'steps',
  label: 'Probetas',
  min: 1,
  max: 30,
  step: 1,
  default: 4,
  unit: '-',
}

export const SPECIMEN_STEPS_Y_PARAM: SpecimenParam = {
  key: 'stepsY',
  label: 'Pasos eje Y',
  min: 1,
  max: 10,
  step: 1,
  default: 3,
  unit: '-',
}

/** Parametros del diseno que tiene sentido variar en las probetas de esta familia. */
export function specimenAxisParams(laser: LaserParams): LaserParam[] {
  const family =
    laser.family === 'hinge'
      ? hingeUiParams(laser.hingePattern)
      : laser.family === 'image'
        ? [
            ...FAMILY_UI_PARAMS.image,
            ...(laser.imgMode === 'halftone'
              ? IMAGE_HALFTONE_UI_PARAMS
              : IMAGE_BITMAP_UI_PARAMS),
            ...IMAGE_TONE_UI_PARAMS,
          ]
        : FAMILY_UI_PARAMS[laser.family]
  const all = [...MATERIAL_UI_PARAMS, ...family, ...FIELD_LASER_UI_PARAMS]
  return all.filter((p, k) => all.findIndex((q) => q.key === p.key) === k)
}

/** Rango inicial al elegir un eje: alrededor del valor actual, en pasos del parametro. */
export function defaultAxisRange(param: LaserParam, current: number): [number, number] {
  const span = (param.max - param.min) * 0.15
  const snap = (v: number) =>
    clamp(Math.round(v / param.step) * param.step, param.min, param.max)
  return [snap(current - span), snap(current + span)]
}

/** Nombre corto para el rotulo y el archivo: sin parentesis ni "Celda: ". */
export function shortLabel(param: NumberParam): string {
  return param.label.replace(/\s*\(.*\)\s*/g, '').replace(/^Celda: /, '')
}

export interface SpecimenValue {
  key: LaserNumericKey
  label: string
  value: number
  unit: string
}

/** Una probeta de la serie, sin geometria (barato: para la lista y los nombres). */
export interface SpecimenPlan {
  /** 1..total. */
  number: number
  /** Columna / fila en la matriz (0 con un solo eje). */
  col: number
  row: number
  /** Valores aplicados (vacio si son copias). */
  values: SpecimenValue[]
  params: LaserParams
}

export interface SpecimenSeries {
  plans: SpecimenPlan[]
  cols: number
  rows: number
  /** La familia actual no admite probetas (capas, huella). */
  unsupported: boolean
}

/** Probeta lista para exportar: un archivo de exactamente `bounds` (el formato). */
export interface Specimen {
  number: number
  total: number
  values: SpecimenValue[]
  /** Nombre de archivo sin extension: `apellido_probeta_03`. */
  name: string
  paths: CutPath[]
  labels: TextLabel[]
  /** Borde del formato como referencia (solo si no se corta el contorno). */
  frames: Vec2[][]
  bounds: Bounds2D
  calados: number
  cortes: number
  cutLengthMm: number
}

export interface SpecimenInput {
  image?: LaserBitmap | null
  /** Caja de la pieza del diseno (mm): referencia para escalar el campo. */
  designBounds?: Bounds2D
}

const fmtValue = (v: number) => String(Number(v.toFixed(2)))
const fmtWithUnit = (v: SpecimenValue) =>
  `${fmtValue(v.value)}${v.unit === 'mm' ? 'mm' : v.unit === '°' ? '°' : ''}`

/** Serie de probetas: que valores lleva cada una. */
export function planSpecimens(laser: LaserParams, sp: SpecimenParams): SpecimenSeries {
  const unsupported = SPECIMEN_UNSUPPORTED.has(laser.family)
  const axisParams = specimenAxisParams(laser)
  const find = (key: SpecimenAxis) =>
    key === 'none' ? null : (axisParams.find((p) => p.key === key) ?? null)
  const px = find(sp.axisX)
  const py = find(sp.axisY)
  const steps = Math.max(1, Math.round(sp.steps))
  const matrix = px !== null && py !== null
  const cols = steps
  const rows = matrix ? Math.max(1, Math.round(sp.stepsY)) : 1
  if (unsupported) return { plans: [], cols, rows, unsupported }

  const snap = (p: LaserParam, v: number) =>
    clamp(Math.round(v / p.step) * p.step, p.min, p.max)
  const t = (k: number, m: number) => (m > 1 ? k / (m - 1) : 0)
  const plans: SpecimenPlan[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const params: LaserParams = { ...laser }
      const values: SpecimenValue[] = []
      const apply = (p: LaserParam | null, v: number) => {
        if (!p) return
        const value = snap(p, v)
        params[p.key] = value
        values.push({ key: p.key, label: shortLabel(p), value, unit: p.unit })
      }
      if (matrix) {
        apply(px, lerp(sp.xFrom, sp.xTo, t(col, cols)))
        apply(py, lerp(sp.yFrom, sp.yTo, t(row, rows)))
      } else if (px) {
        apply(px, lerp(sp.xFrom, sp.xTo, t(col, cols)))
      } else {
        apply(py, lerp(sp.yFrom, sp.yTo, t(col, cols)))
      }
      plans.push({ number: plans.length + 1, col, row, values, params })
    }
  }
  return { plans, cols, rows, unsupported }
}

/** Apellido apto para nombre de archivo: sin tildes, espacios ni simbolos. */
export function surnameSlug(surname: string): string {
  return surname
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Nombre de archivo de una probeta: `apellido_probeta_03` (numero con 2 cifras o mas). */
export function specimenFileName(surname: string, number: number, total: number): string {
  const n = String(number).padStart(Math.max(2, String(total).length), '0')
  const who = surnameSlug(surname)
  return who ? `${who}_probeta_${n}` : `probeta_${n}`
}

/** Geometria de una probeta: patron en su area, rotulo y contorno al formato. */
export function buildSpecimen(
  plan: SpecimenPlan,
  total: number,
  attractors: readonly Attractor[],
  laser: LaserParams,
  sp: SpecimenParams,
  input: SpecimenInput = {},
): Specimen {
  const W = sp.widthMm
  const H = sp.heightMm
  const bounds: Bounds2D = { minX: 0, maxX: W, minZ: 0, maxZ: H }
  const frame: Vec2[] = [
    [0, 0],
    [W, 0],
    [W, H],
    [0, H],
  ]
  const header = Math.min(Math.max(0, sp.headerMm), H / 2)
  const areaH = H - header
  const comp = laser.kerfCompensation ? laser.kerfMm : 0

  // campo del diseno escalado a la probeta (mismo encuadre que la pieza).
  const db = input.designBounds
  const fitScale = db
    ? Math.min(W / Math.max(1, db.maxX - db.minX), areaH / Math.max(1, db.maxZ - db.minZ))
    : 1
  const scale = sp.keepField ? fitScale : 1
  const dcx = db ? (db.minX + db.maxX) / 2 : 0
  const dcz = db ? (db.minZ + db.maxZ) / 2 : 0
  const fieldAttractors = sp.keepField
    ? attractors.map((a) => scaleAttractor(a, mmToThree(dcx), mmToThree(dcz), scale))
    : []

  const params: LaserParams = {
    ...plan.params,
    symmetry: sp.keepField ? laser.symmetry : 'none',
    centerXMm: sp.keepField ? laser.centerXMm * scale : 0,
    centerZMm: sp.keepField ? laser.centerZMm * scale : 0,
    // la imagen cubre la probeta como cubria la pieza: el desplazamiento escala igual.
    imgOffsetXMm: laser.imgOffsetXMm * fitScale,
    imgOffsetZMm: laser.imgOffsetZMm * fitScale,
    distribution:
      sp.keepField || (laser.imgAsField && input.image) ? laser.distribution : 'uniform',
  }
  const cut = buildLaserCut(fieldAttractors, params, {
    boundary: rectBoundary(W, areaH),
    image: input.image ?? null,
  })
  const dx = W / 2
  const dz = header + areaH / 2
  const paths: CutPath[] = cut.paths
    .filter((p) => p.layer !== 'contorno')
    .map((p) => ({ ...p, points: p.points.map(([x, z]): Vec2 => [x + dx, z + dz]) }))
  if (sp.cutOutline) {
    // el kerf hacia afuera: la pieza cortada mide el formato.
    paths.push({
      layer: 'contorno',
      points: offsetPolygon(frame, comp / 2),
      closed: true,
    })
  }
  paths.sort((a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer))

  const labels: TextLabel[] = []
  if (header > 0) {
    const values = plan.values.map((v) => `${v.label} ${fmtWithUnit(v)}`).join(' · ')
    const lines = [
      `#${plan.number}/${total}${values ? `  ${values}` : ''}`,
      `${sp.surname.trim() ? `${sp.surname.trim()} · ` : ''}${FAMILY_LABELS[laser.family]} · kerf ${fmtValue(params.kerfMm)}mm · puente ${fmtValue(params.minBridgeMm)}mm`,
    ]
    const lineH = header / lines.length
    lines.forEach((text, li) => {
      // el texto se achica si no entra en el ancho o en su renglon.
      const fit = (W - 6) / Math.max(1e-6, strokeTextWidth(text, 1))
      const size = Math.max(0.8, Math.min(sp.labelMm * (li ? 0.75 : 1), lineH * 0.8, fit))
      labels.push({
        x: 3,
        z: li * lineH + (lineH + size * 0.72) / 2,
        text,
        sizeMm: size,
        anchor: 'start',
      })
    })
  }

  return {
    number: plan.number,
    total,
    values: plan.values,
    name: specimenFileName(sp.surname, plan.number, total),
    paths,
    labels,
    frames: sp.cutOutline ? [] : [frame],
    bounds,
    calados: cut.calados,
    cortes: cut.cortes,
    cutLengthMm: paths.reduce((s, p) => s + polylineLength(p.points, p.closed), 0),
  }
}

/** Escala un atractor (unidades Three) alrededor de (cx, cz), radio incluido. */
function scaleAttractor(a: Attractor, cx: number, cz: number, s: number): Attractor {
  const map = (p: THREE.Vector3) => new THREE.Vector3((p.x - cx) * s, 0, (p.z - cz) * s)
  return a.kind === 'point'
    ? { ...a, position: map(a.position), radius: a.radius * s }
    : { ...a, points: a.points.map(map), radius: a.radius * s }
}

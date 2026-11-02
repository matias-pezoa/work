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
 *   - hinge        Bisagra kerf (kerf bending): patrones de la muestra de
 *                  referencia (recto, rombo, hex, panal, bolo, cruz,
 *                  corchetes, meandro, triangulos) que vuelven flexible una
 *                  plancha rigida. El campo modula el puente entre cortes.
 *   - module       Modulo personalizado: trazos dibujados (o importados) en
 *                  una celda, repetidos por la disposicion.
 *
 * Calado, escamas, bisagra y modulo son familias "por elementos": se
 * disponen en grilla o en anillos (radial) y pasan por un control de puente
 * comun (ver laserPattern.ts). La simetria (espejos, rotacion, caleidoscopio)
 * se aplica al campo copiando los atractores, en todas las familias con campo.
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
  distanceToSegment,
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
import {
  createBridgeGuard,
  DEFAULT_MODULE,
  flipShapes,
  forEachPlacement,
  HINGE_CLOSED,
  HINGE_USES_WIDTH,
  hingeLatticeKind,
  hingeRowElement,
  meanderElement,
  moduleShapes,
  placeShapes,
  rotateShapes,
  shapesClearance,
  symmetrizeAttractors,
  translateShapes,
  trianglesElement,
  type BridgeGuard,
  type CellFlip,
  type HingePattern,
  type Lattice,
  type LaserLayout,
  type LaserModule,
  type LaserSymmetry,
  type LayoutOptions,
  type Placement,
  type Shape,
} from './laserPattern'
import { buildLayers, type LayerEdge, type LayerJoin } from './laserLayers'

/** Piso absoluto del puente de material entre cortes, en mm. */
export const MIN_BRIDGE_MM = 1
/** Rasgo minimo cortable (diametro menor de un calado, largo de un corte), en mm. */
export const MIN_FEATURE_MM = 1
/** Tope de elementos por pieza, para que una grilla muy fina no congele la UI. */
export const MAX_ELEMENTS = 20000

export type LaserFamily =
  'perforation' | 'kirigami' | 'scales' | 'hinge' | 'module' | 'layers' | 'footprint'

export const FAMILY_LABELS: Record<LaserFamily, string> = {
  perforation: 'Calado',
  kirigami: 'Auxetico',
  scales: 'Escamas',
  hinge: 'Bisagra kerf',
  module: 'Modulo',
  layers: 'Capas',
  footprint: 'Huella puas',
}

/** Texto a grabar (no cortar): numeros de pieza, rotulos del muestrario. */
export interface TextLabel {
  x: number
  z: number
  text: string
  sizeMm: number
  /** Alineacion horizontal respecto de `x` (por defecto al centro). */
  anchor?: 'start' | 'middle' | 'end'
}

/** Una pieza suelta (familia capas): sus trazos ya compensados, en coordenadas de diseno. */
export interface LaserPiece {
  number: number
  paths: CutPath[]
}

/** Familias que se disponen por elementos (grilla o radial). */
export const ELEMENT_FAMILIES: ReadonlySet<LaserFamily> = new Set([
  'perforation',
  'scales',
  'hinge',
  'module',
])

/**
 * Como reparte el campo los cortes:
 *   - field    solo donde el campo supera el umbral (fuera, la pieza queda entera)
 *   - full     en toda la pieza; el campo solo interpola entre "lejos" y "cerca"
 *   - uniform  en toda la pieza con los valores "cerca" (ignora atractores)
 */
export type LaserDistribution = 'field' | 'full' | 'uniform'

export const DISTRIBUTION_LABELS: Record<LaserDistribution, string> = {
  field: 'Solo con campo',
  full: 'Toda la pieza',
  uniform: 'Uniforme',
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
  { id: 'mdf', label: 'MDF 3 mm', kerfMm: 0.2, minBridgeMm: 1.5 },
  { id: 'plywood', label: 'Terciado 3 mm', kerfMm: 0.2, minBridgeMm: 1.5 },
  { id: 'polypropylene', label: 'Polipropileno 0.8 mm', kerfMm: 0.1, minBridgeMm: 1.2 },
  { id: 'leatherThick', label: 'Suela / cuero 3 mm', kerfMm: 0.3, minBridgeMm: 2.5 },
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
  distribution: LaserDistribution
  /**
   * Compensar el kerf en el archivo (calados hacia adentro, contorno hacia
   * afuera, cortes acortados). Apagar si el software del laser ya lo hace;
   * el puente se sigue calculando con el kerf real.
   */
  kerfCompensation: boolean

  // --- disposicion (familias por elementos) y simetria del campo ---
  layout: LaserLayout
  /** Rotacion global de la grilla, o fase de los anillos en radial. */
  rotationDeg: number
  /** Centro de los anillos / de la simetria, desplazado desde el centro de la pieza. */
  centerXMm: number
  centerZMm: number
  radialStartMm: number
  radialSectors: number
  radialWarp: boolean
  symmetry: LaserSymmetry
  symmetryOrder: number
  cellFlip: CellFlip

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

  // --- bisagra kerf ---
  hingePattern: HingePattern
  /** Largo de corte (filas), lado de celda (meandro) o del triangulo. */
  hingeLengthMm: number
  /** Separacion entre filas de cortes / entre vueltas (la "s" de la muestra). */
  hingeSpacingMm: number
  /** Puente entre cortes consecutivos de una fila, lejos y cerca del atractor. */
  hingeGapFarMm: number
  hingeGapNearMm: number
  /** Ancho de figura (rombo, hex...), horquilla (cruz) o amplitud (corchetes). */
  hingeWidthMm: number
  hingeWaves: number

  // --- modulo personalizado ---
  module: LaserModule
  moduleCellWMm: number
  moduleCellHMm: number
  /** Desfase de filas impares, en fraccion de la celda (0.5 = ladrillo). */
  moduleStagger: number
  moduleSizeFar: number
  moduleSizeNear: number
  moduleRotationDeg: number

  // --- capas concentricas (cada capa es una pieza) ---
  layerCount: number
  layerJoin: LayerJoin
  layerEdge: LayerEdge
  layerInnerScale: number
  layerMinStepMm: number
  layerWaveAmp: number
  layerWaveLobes: number
  layerTwistDeg: number
  layerFieldPull: number
  layerEdgeTaper: number
  layerHoleMm: number
  layerEdgeHoles: number
  layerHoleInsetMm: number

  // --- cama del laser (export de piezas sueltas) ---
  bedWidthMm: number
  bedHeightMm: number
  bedGapMm: number
  bedLabelMm: number
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
  distribution: 'field',
  kerfCompensation: true,

  layout: 'grid',
  rotationDeg: 0,
  centerXMm: 0,
  centerZMm: 0,
  radialStartMm: 10,
  radialSectors: 1,
  radialWarp: true,
  symmetry: 'none',
  symmetryOrder: 6,
  cellFlip: 'none',

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

  hingePattern: 'straight',
  hingeLengthMm: 24,
  hingeSpacingMm: 2.5,
  hingeGapFarMm: 5,
  hingeGapNearMm: 2,
  hingeWidthMm: 4,
  hingeWaves: 1,

  module: DEFAULT_MODULE,
  moduleCellWMm: 16,
  moduleCellHMm: 14,
  moduleStagger: 0.5,
  moduleSizeFar: 0.4,
  moduleSizeNear: 1,
  moduleRotationDeg: 0,

  layerCount: 12,
  layerJoin: 'center',
  layerEdge: 'top',
  layerInnerScale: 0.18,
  layerMinStepMm: 3,
  layerWaveAmp: 0.12,
  layerWaveLobes: 5,
  layerTwistDeg: 14,
  layerFieldPull: 0.5,
  layerEdgeTaper: 0.3,
  layerHoleMm: 2,
  layerEdgeHoles: 3,
  layerHoleInsetMm: 5,

  bedWidthMm: 600,
  bedHeightMm: 400,
  bedGapMm: 4,
  bedLabelMm: 4,
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
  // depende del patron elegido: ver hingeUiParams
  hinge: [],
  // depende de la union (centro / arista): ver layersUiParams
  layers: [],
  module: [
    {
      key: 'moduleCellWMm',
      label: 'Celda: ancho',
      min: 4,
      max: 80,
      step: 0.5,
      default: 16,
      unit: 'mm',
    },
    {
      key: 'moduleCellHMm',
      label: 'Celda: alto',
      min: 4,
      max: 80,
      step: 0.5,
      default: 14,
      unit: 'mm',
    },
    {
      key: 'moduleStagger',
      label: 'Desfase de filas',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5,
      unit: 'x celda',
    },
    {
      key: 'moduleSizeFar',
      label: 'Tamano lejos',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.4,
      unit: 'x celda',
    },
    {
      key: 'moduleSizeNear',
      label: 'Tamano cerca',
      min: 0,
      max: 1,
      step: 0.01,
      default: 1,
      unit: 'x celda',
    },
    {
      key: 'moduleRotationDeg',
      label: 'Rotacion del modulo',
      min: -180,
      max: 180,
      step: 1,
      default: 0,
      unit: 'grados',
    },
  ],
}

/** Sliders de la bisagra kerf: el significado del largo cambia con el patron. */
export function hingeUiParams(pattern: HingePattern): LaserParam[] {
  const kind = hingeLatticeKind(pattern)
  const out: LaserParam[] = [
    {
      key: 'hingeLengthMm',
      label:
        kind === 'square'
          ? 'Celda del meandro'
          : kind === 'triangle'
            ? 'Lado del triangulo'
            : 'Largo de corte',
      min: 4,
      max: 120,
      step: 0.5,
      default: 24,
      unit: 'mm',
    },
    {
      key: 'hingeSpacingMm',
      label: kind === 'brick' ? 'Separacion entre filas' : 'Separacion entre vueltas',
      min: 0.5,
      max: 12,
      step: 0.05,
      default: 2.5,
      unit: 'mm',
    },
    {
      key: 'hingeGapFarMm',
      label: kind === 'brick' ? 'Puente en la fila: lejos' : 'Puente entre celdas: lejos',
      min: MIN_BRIDGE_MM,
      max: 30,
      step: 0.1,
      default: 5,
      unit: 'mm',
    },
    {
      key: 'hingeGapNearMm',
      label: kind === 'brick' ? 'Puente en la fila: cerca' : 'Puente entre celdas: cerca',
      min: MIN_BRIDGE_MM,
      max: 30,
      step: 0.1,
      default: 2,
      unit: 'mm',
    },
  ]
  if (HINGE_USES_WIDTH.has(pattern)) {
    out.push({
      key: 'hingeWidthMm',
      label:
        pattern === 'brackets'
          ? 'Amplitud de la onda'
          : pattern === 'cross'
            ? 'Abertura de la horquilla'
            : 'Ancho de figura',
      min: 0.2,
      max: 20,
      step: 0.1,
      default: 4,
      unit: 'mm',
    })
  }
  if (pattern === 'brackets') {
    out.push({
      key: 'hingeWaves',
      label: 'Ondas por corte',
      min: 0.5,
      max: 6,
      step: 0.5,
      default: 1,
      unit: '-',
    })
  }
  return out
}

/** Sliders de las capas concentricas; algunos solo aplican a la union por arista. */
export function layersUiParams(join: LayerJoin): LaserParam[] {
  const out: LaserParam[] = [
    {
      key: 'layerCount',
      label: 'Capas',
      min: 2,
      max: 40,
      step: 1,
      default: 12,
      unit: '-',
    },
    {
      key: 'layerInnerScale',
      label: 'Tamano de la capa interior',
      min: 0.05,
      max: 0.95,
      step: 0.01,
      default: 0.18,
      unit: 'x pieza',
    },
    {
      key: 'layerMinStepMm',
      label: 'Banda minima entre capas',
      min: 0.5,
      max: 30,
      step: 0.5,
      default: 3,
      unit: 'mm',
    },
    {
      key: 'layerWaveAmp',
      label: 'Ondulacion',
      min: 0,
      max: 0.5,
      step: 0.01,
      default: 0.12,
      unit: '-',
    },
    {
      key: 'layerWaveLobes',
      label: 'Lobulos',
      min: 0,
      max: 16,
      step: 1,
      default: 5,
      unit: '-',
    },
    {
      key: 'layerTwistDeg',
      label: 'Giro por capa',
      min: -90,
      max: 90,
      step: 1,
      default: 14,
      unit: 'grados',
    },
    {
      key: 'layerFieldPull',
      label: 'Empuje del campo',
      min: -1,
      max: 1.5,
      step: 0.05,
      default: 0.5,
      unit: '-',
    },
    {
      key: 'layerHoleMm',
      label: 'Radio de agujeros de union (0 = sin)',
      min: 0,
      max: 10,
      step: 0.25,
      default: 2,
      unit: 'mm',
    },
  ]
  if (join === 'edge') {
    out.push(
      {
        key: 'layerEdgeTaper',
        label: 'Acortar la arista por capa',
        min: 0,
        max: 0.9,
        step: 0.01,
        default: 0.3,
        unit: '-',
      },
      {
        key: 'layerEdgeHoles',
        label: 'Agujeros en la arista',
        min: 1,
        max: 20,
        step: 1,
        default: 3,
        unit: '-',
      },
      {
        key: 'layerHoleInsetMm',
        label: 'Agujeros: distancia a la arista',
        min: 1,
        max: 40,
        step: 0.5,
        default: 5,
        unit: 'mm',
      },
    )
  }
  return out
}

export const BED_UI_PARAMS: readonly LaserParam[] = [
  {
    key: 'bedWidthMm',
    label: 'Cama: ancho',
    min: 100,
    max: 1600,
    step: 10,
    default: 600,
    unit: 'mm',
  },
  {
    key: 'bedHeightMm',
    label: 'Cama: alto',
    min: 100,
    max: 1200,
    step: 10,
    default: 400,
    unit: 'mm',
  },
  {
    key: 'bedGapMm',
    label: 'Separacion entre piezas',
    min: 0,
    max: 30,
    step: 0.5,
    default: 4,
    unit: 'mm',
  },
  {
    key: 'bedLabelMm',
    label: 'Alto del numero',
    min: 2,
    max: 12,
    step: 0.5,
    default: 4,
    unit: 'mm',
  },
]

export const LAYOUT_UI_PARAMS: readonly LaserParam[] = [
  {
    key: 'rotationDeg',
    label: 'Rotacion del patron',
    min: -180,
    max: 180,
    step: 1,
    default: 0,
    unit: 'grados',
  },
]

export const RADIAL_UI_PARAMS: readonly LaserParam[] = [
  {
    key: 'radialStartMm',
    label: 'Radio inicial',
    min: 0,
    max: 300,
    step: 1,
    default: 10,
    unit: 'mm',
  },
  {
    key: 'radialSectors',
    label: 'Sectores (1 = libre)',
    min: 1,
    max: 36,
    step: 1,
    default: 1,
    unit: '-',
  },
]

export const CENTER_UI_PARAMS: readonly LaserParam[] = [
  {
    key: 'centerXMm',
    label: 'Centro: desplazamiento X',
    min: -400,
    max: 400,
    step: 1,
    default: 0,
    unit: 'mm',
  },
  {
    key: 'centerZMm',
    label: 'Centro: desplazamiento Y',
    min: -400,
    max: 400,
    step: 1,
    default: 0,
    unit: 'mm',
  },
]

export const SYMMETRY_ORDER_PARAM: LaserParam = {
  key: 'symmetryOrder',
  label: 'Orden N',
  min: 2,
  max: 24,
  step: 1,
  default: 6,
  unit: '-',
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
  /** Centro de los anillos (radial) y de la simetria, en mm. */
  center: Vec2
  /** Atractores que de verdad evaluan el campo: los editables + sus copias por simetria. */
  fieldAttractors: readonly Attractor[]
  /** Piezas sueltas (familia capas) para distribuir en la cama; vacio en las demas. */
  pieces: LaserPiece[]
  /** Rotulos de la vista (numero de cada capa). No se exportan con el diseno. */
  labels: TextLabel[]
}

interface Ctx {
  params: LaserParams
  attractors: readonly Attractor[]
  sheet: Boundary
  center: Vec2
  kerf: number
  /** Kerf que se compensa en el archivo (0 si la compensacion esta apagada). */
  comp: number
  bridge: number
  margin: number
  out: CutPath[]
  pieces: LaserPiece[]
  labels: TextLabel[]
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
  const comp = params.kerfCompensation ? kerf : 0
  const bridge = Math.max(MIN_BRIDGE_MM, params.minBridgeMm)
  const sb = polygonBounds(sheet.outer)
  const center: Vec2 = [
    (sb.minX + sb.maxX) / 2 + params.centerXMm,
    (sb.minZ + sb.maxZ) / 2 + params.centerZMm,
  ]
  const fieldAttractors =
    params.family === 'footprint'
      ? []
      : symmetrizeAttractors(attractors, params.symmetry, params.symmetryOrder, {
          x: mmToThree(center[0]),
          z: mmToThree(center[1]),
        })
  const ctx: Ctx = {
    params,
    attractors: fieldAttractors,
    sheet,
    center,
    kerf,
    comp,
    bridge,
    margin: Math.max(params.edgeMarginMm, bridge + kerf / 2),
    out: [],
    pieces: [],
    labels: [],
    stats: {
      rejectedByEdge: 0,
      rejectedByBridge: 0,
      skippedBySize: 0,
      limitedByBridge: 0,
      openAreaMm2: 0,
    },
  }

  const guard = createBridgeGuard(bridge, kerf)
  switch (params.family) {
    case 'perforation':
      buildPerforation(ctx, guard)
      break
    case 'kirigami':
      buildKirigami(ctx)
      break
    case 'scales':
      buildScales(ctx, guard)
      break
    case 'hinge':
      buildHinge(ctx, guard)
      break
    case 'module':
      buildModule(ctx, guard)
      break
    case 'layers':
      buildLayerPieces(ctx)
      break
    case 'footprint':
      buildFootprint(ctx, input.footprints ?? [])
      break
  }

  const interior = ctx.out
  const outline: CutPath[] = [
    { layer: 'contorno', points: offsetPolygon(sheet.outer, comp / 2), closed: true },
    ...sheet.holes.map((h): CutPath => ({
      layer: 'contorno',
      points: offsetPolygon(h, -comp / 2),
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
    center,
    fieldAttractors,
    pieces: ctx.pieces,
    labels: ctx.labels,
  }
}

// ------------------------------------------------------------------ capas

/**
 * Capas concentricas (ver laserLayers.ts). En la vista de diseno se ven
 * superpuestas, como curvas de nivel: el contorno de la pieza es la capa 1 y
 * cada borde interior es otra capa (capa "corte" cerrada). Para fabricar,
 * cada capa sale como pieza suelta (`pieces`) con sus agujeros de union, y
 * se distribuye en la cama (laserBed.ts).
 */
function buildLayerPieces(ctx: Ctx): void {
  const p = ctx.params
  const { layers, skipped } = buildLayers(
    ctx.sheet.outer,
    (x, z) => (ctx.params.distribution === 'uniform' ? 0 : fieldAt(ctx, x, z).value),
    {
      count: p.layerCount,
      join: p.layerJoin,
      edge: p.layerEdge,
      innerScale: p.layerInnerScale,
      minStepMm: Math.max(p.layerMinStepMm, MIN_FEATURE_MM),
      waveAmp: p.layerWaveAmp,
      waveLobes: p.layerWaveLobes,
      twistDeg: p.layerTwistDeg,
      fieldPull: p.layerFieldPull,
      edgeTaper: p.layerEdgeTaper,
      holeRadiusMm: p.layerHoleMm > 0 ? Math.max(p.layerHoleMm, MIN_FEATURE_MM / 2) : 0,
      edgeHoles: p.layerEdgeHoles,
      holeInsetMm: p.layerHoleInsetMm,
      bridgeMm: ctx.bridge,
      center: ctx.center,
    },
  )
  ctx.stats.skippedBySize += skipped
  const holes = layers[0]?.holes ?? []
  for (const h of holes) {
    ctx.out.push({
      layer: 'calado',
      points: offsetPolygon(h, -ctx.comp / 2),
      closed: true,
    })
  }
  for (const layer of layers) {
    const outline = offsetPolygon(layer.outline, ctx.comp / 2)
    // la capa 1 ya es el contorno de la pieza en la vista de diseno.
    if (layer.index > 0) ctx.out.push({ layer: 'corte', points: outline, closed: true })
    ctx.pieces.push({
      number: layer.index + 1,
      paths: [
        ...layer.holes.map((h): CutPath => ({
          layer: 'calado',
          points: offsetPolygon(h, -ctx.comp / 2),
          closed: true,
        })),
        { layer: 'contorno', points: outline, closed: true },
      ],
    })
    ctx.labels.push({
      x: layer.labelAt[0],
      z: layer.labelAt[1],
      text: String(layer.index + 1),
      sizeMm: Math.min(6, Math.max(2.5, p.layerMinStepMm * 0.8)),
    })
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

/**
 * Peso 0..1 (0 = valores "lejos", 1 = "cerca") segun la distribucion, o null
 * si en este punto no se corta. El valor se re-normaliza sobre el umbral.
 */
function cutWeight(ctx: Ctx, value: number): number | null {
  const mode = ctx.params.distribution
  if (mode === 'uniform') return 1
  const thr = clamp(ctx.params.fieldThreshold, 0, 0.99)
  if (value < thr || value <= 0) return mode === 'full' ? 0 : null
  return (value - thr) / (1 - thr)
}

function layoutOptions(ctx: Ctx): LayoutOptions {
  const p = ctx.params
  return {
    layout: p.layout,
    center: ctx.center,
    rotationDeg: p.rotationDeg,
    radialStartMm: p.radialStartMm,
    radialSectors: p.radialSectors,
    radialWarp: p.radialWarp,
  }
}

/**
 * Recorre la disposicion para una familia por elementos: corta en el tope
 * de elementos y salta los lugares fuera de la pieza.
 */
function forEachElement(
  ctx: Ctx,
  lattice: Lattice,
  fn: (pl: Placement, f: FieldAt) => void,
): void {
  forEachPlacement(polygonBounds(ctx.sheet.outer), lattice, layoutOptions(ctx), (pl) => {
    if (ctx.out.length >= MAX_ELEMENTS) return false
    if (!pointInBoundary(pl.x, pl.z, ctx.sheet)) return
    fn(pl, fieldAt(ctx, pl.x, pl.z))
  })
}

/** Angulo local (respecto del marco del lugar) que apunta segun el campo. */
function fieldAngleLocal(ctx: Ctx, pl: Placement, f: FieldAt): number {
  return ctx.params.alignToField && f.dir ? Math.atan2(f.dir[1], f.dir[0]) - pl.angle : 0
}

/**
 * Lleva un elemento (trazos locales) a la pieza: verifica margen al borde y
 * puente contra lo ya aceptado, y emite los trazos compensados por kerf
 * (cerrados -> calado hacia adentro; abiertos -> corte acortado en los extremos).
 */
function emitElement(ctx: Ctx, guard: BridgeGuard, pl: Placement, local: Shape[]): void {
  const designed = placeShapes(local, pl)
  if (designed.length === 0) return
  if (!designed.every((s) => fits(ctx, s.points))) {
    ctx.stats.rejectedByEdge++
    return
  }
  if (!guard.fits(designed)) {
    ctx.stats.rejectedByBridge++
    return
  }
  guard.add(designed)
  for (const s of designed) {
    if (s.closed) {
      ctx.stats.openAreaMm2 += polygonArea(s.points)
      ctx.out.push({
        layer: 'calado',
        points: offsetPolygon(s.points, -ctx.comp / 2),
        closed: true,
      })
    } else {
      // un extremo que cae sobre otro trazo del mismo elemento es una union
      // (horquilla de la cruz, centro del tripode): ahi el corte sigue, no se acorta.
      const free = (q: Vec2) =>
        !designed.some(
          (o) =>
            o !== s &&
            o.points.some((r, k) => {
              const next = o.points[k + 1] ?? (o.closed ? o.points[0] : null)
              return next !== null && distanceToSegment(q[0], q[1], r, next) < 1e-6
            }),
        )
      const half = ctx.comp / 2
      const trimmed = trimPolyline(
        s.points,
        free(s.points[0]) ? half : 0,
        free(s.points[s.points.length - 1]) ? half : 0,
      )
      ctx.out.push({ layer: 'corte', points: trimmed, closed: false })
    }
  }
}

/**
 * Acorta una polilinea abierta `dStart`/`dEnd` en cada extremo (el haz quema
 * medio kerf mas alla del final del trazo). Nunca la deja con menos de un
 * tercio de su largo original.
 */
export function trimPolyline(
  points: readonly Vec2[],
  dStart: number,
  dEnd = dStart,
): Vec2[] {
  const total = polylineLength(points, false)
  if (points.length < 2) return points.map(([x, z]) => [x, z] as Vec2)
  const trimStart = (pts: readonly Vec2[], d: number): Vec2[] => {
    let left = Math.min(d, total / 3)
    if (left <= 0) return [...pts]
    for (let k = 1; k < pts.length; k++) {
      const [ax, az] = pts[k - 1]
      const [bx, bz] = pts[k]
      const len = Math.hypot(bx - ax, bz - az)
      if (len > left) {
        const t = left / len
        return [[ax + (bx - ax) * t, az + (bz - az) * t], ...pts.slice(k)]
      }
      left -= len
    }
    return [...pts]
  }
  return trimStart(trimStart(points, dStart).reverse(), dEnd).reverse()
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

function buildPerforation(ctx: Ctx, guard: BridgeGuard): void {
  const p = ctx.params
  const pitch = Math.max(p.perfPitchMm, MIN_FEATURE_MM + ctx.bridge)
  // grilla hexagonal: los 6 vecinos quedan exactamente a `pitch`. Un calado de
  // radio mayor (circunscrito) <= (pitch - puente)/2 garantiza el puente en
  // cualquier orientacion y alargamiento. En radial los anillos van a `pitch`
  // (no a pitch*sqrt(3)/2): las fases de anillos vecinos no calzan como en la
  // grilla hexagonal.
  const rMax = (pitch - ctx.bridge) / 2
  const elong = Math.max(1, p.perfElongation)
  const rowStep = p.layout === 'radial' ? pitch : (pitch * Math.sqrt(3)) / 2
  forEachElement(ctx, { w: pitch, h: rowStep, stagger: 0.5 }, (pl, f) => {
    const t = cutWeight(ctx, f.value)
    if (t === null) return
    const sizeFrac = lerp(p.perfSizeMin, p.perfSizeMax, t)
    if (sizeFrac > 1) ctx.stats.limitedByBridge++
    const a = rMax * clamp(sizeFrac, 0, 1)
    const b = a / elong
    if (2 * b < MIN_FEATURE_MM) {
      ctx.stats.skippedBySize++
      return
    }
    const angle = fieldAngleLocal(ctx, pl, f) + p.perfRotationDeg * DEG2RAD
    emitElement(ctx, guard, pl, [
      { points: ellipsePolygon(0, 0, a, b, p.perfSides, angle), closed: true },
    ])
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
    const t = cutWeight(ctx, f.value)
    if (t === null) return
    const wanted = lerp(p.kiriHingeFarMm, p.kiriHingeNearMm, t)
    if (wanted < minHinge) ctx.stats.limitedByBridge++
    const h = clamp(wanted, minHinge, maxHinge)
    const half = a - h - ctx.comp / 2
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
      const k = (2 * s - 1) * (half + ctx.comp / 2)
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

function buildScales(ctx: Ctx, guard: BridgeGuard): void {
  const p = ctx.params
  const w = Math.max(p.scaleWidthMm, MIN_FEATURE_MM + ctx.bridge + ctx.kerf)
  const rowStep = w * clamp(p.scaleRowRatio, 0.4, 1.2)
  // vecino mas cercano en filas alternadas: al costado (w) o en diagonal.
  const neighbor = Math.min(w, Math.hypot(w / 2, rowStep), 2 * rowStep)
  // ambos arcos vecinos se ensanchan kerf/2 -> se descuenta un kerf entero.
  const rMax = (neighbor - ctx.bridge - ctx.kerf) / 2
  const opening = clamp(p.scaleOpeningDeg, 10, 340) * DEG2RAD
  forEachElement(ctx, { w, h: rowStep, stagger: 0.5 }, (pl, f) => {
    const t = cutWeight(ctx, f.value)
    if (t === null) return
    const sizeFrac = lerp(p.scaleSizeMin, p.scaleSizeMax, t)
    if (sizeFrac > 1) ctx.stats.limitedByBridge++
    const r = rMax * clamp(sizeFrac, 0, 1)
    if (r * opening < MIN_FEATURE_MM || r < MIN_FEATURE_MM / 2) {
      ctx.stats.skippedBySize++
      return
    }
    // la punta de la lengueta apunta lejos del atractor (o "hacia abajo", +z local).
    const theta =
      p.alignToField && f.dir ? Math.atan2(-f.dir[1], -f.dir[0]) - pl.angle : Math.PI / 2
    emitElement(ctx, guard, pl, [
      { points: arcPoints(0, 0, r, theta, opening, 0), closed: false },
    ])
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
        r - ctx.comp / 2,
        r - ctx.comp / 2,
        FOOTPRINT_SIDES,
        0,
      ),
      closed: true,
    })
  }
}

// ---------------------------------------------------------- bisagra kerf

/**
 * Bisagra kerf. Tres tipos de reticula segun el patron (ver laserPattern.ts):
 *   - filas (recto, rombo, hex, panal, bolo, cruz, corchetes): paso fijo a
 *     lo largo de la fila = largo + puente lejos; el campo cambia el puente y
 *     con eso el largo de cada corte (puente chico = mas flexible). Las filas
 *     se desfasan medio paso, como en la muestra.
 *   - meandro: espirales cuadradas en celdas, giradas 90 en damero.
 *   - triangulos: teselacion triangular con contornos anidados abiertos.
 *
 * Puente por construccion: el puente en la fila y la separacion entre filas
 * nunca bajan del minimo (+ kerf si son cortes abiertos); el ancho de las
 * figuras se recorta con una busqueda contra sus vecinas reales en la
 * reticula, y el control de puente comun cubre el resto (radial, campo).
 */
function buildHinge(ctx: Ctx, guard: BridgeGuard): void {
  const p = ctx.params
  const pattern = p.hingePattern
  const kind = hingeLatticeKind(pattern)
  const closed = HINGE_CLOSED.has(pattern)
  const openGap = ctx.bridge + ctx.kerf
  const gapMin = closed ? ctx.bridge : openGap
  const length = Math.max(p.hingeLengthMm, MIN_FEATURE_MM + gapMin)
  const spacingWanted = Math.max(p.hingeSpacingMm, 0)
  // entre cortes abiertos paralelos el material es (separacion - kerf). Las
  // figuras cerradas de filas vecinas se solapan en x: aunque se encastren,
  // sus ejes quedan a `separacion`, asi que hace falta el puente + una figura
  // minima o ninguna entra.
  const spacing = closed
    ? Math.max(spacingWanted, ctx.bridge + MIN_FEATURE_MM)
    : Math.max(spacingWanted, openGap)
  const spacingLimited = spacing > spacingWanted + 1e-9

  const lattice: Lattice =
    kind === 'square'
      ? { w: length, h: length, stagger: 0 }
      : kind === 'triangle'
        ? { w: length / 2, h: (length * Math.sqrt(3)) / 2, stagger: 0, evenRings: true }
        : { w: length + Math.max(p.hingeGapFarMm, gapMin), h: spacing, stagger: 0.5 }

  // el ancho se limita UNA vez por paso, contra el peor caso: el corte mas
  // largo que puede pedir el campo (puente minimo) y vecinas igual de largas.
  const shortestGap = Math.max(gapMin, Math.min(p.hingeGapFarMm, p.hingeGapNearMm))
  const widthCache = new Map<string, number>()
  const widthFor = (P: number): number => {
    const key = P.toFixed(1)
    let w = widthCache.get(key)
    if (w === undefined) {
      const Pk = Number(key)
      w = rowWidthLimit(
        pattern,
        Pk - shortestGap,
        Pk,
        spacing,
        p.hingeWidthMm,
        p.hingeWaves,
        ctx,
      )
      widthCache.set(key, w)
    }
    return w
  }

  forEachElement(ctx, lattice, (pl, f) => {
    const t = cutWeight(ctx, f.value)
    if (t === null) return
    const gapWanted = lerp(p.hingeGapFarMm, p.hingeGapNearMm, t)
    const gap = Math.max(gapWanted, gapMin)
    if (gap > gapWanted + 1e-9 || spacingLimited) ctx.stats.limitedByBridge++

    let local: Shape[]
    if (kind === 'square') {
      local = meanderElement(Math.min(pl.cellW, pl.cellH), gap, spacing)
      // damero de espirales giradas: el entrelazado del patron "Fabric".
      if (Math.abs(pl.i + pl.j) % 2 === 1) local = rotateShapes(local, Math.PI / 2)
    } else if (kind === 'triangle') {
      const up = Math.abs(pl.i + pl.j) % 2 === 0
      // abertura de cada anillo: sus dos extremos quedan a opening/2 (60 grados).
      local = trianglesElement(length, up, gap, spacing, 2 * openGap)
    } else {
      const L = pl.cellW - gap
      if (L < MIN_FEATURE_MM) {
        ctx.stats.skippedBySize++
        return
      }
      let w = p.hingeWidthMm
      if (HINGE_USES_WIDTH.has(pattern)) {
        w = widthFor(pl.cellW)
        if (w < p.hingeWidthMm - 1e-9) ctx.stats.limitedByBridge++
        if (closed && w < MIN_FEATURE_MM) {
          ctx.stats.skippedBySize++
          return
        }
      }
      local = hingeRowElement(pattern, L, w, p.hingeWaves)
    }
    if (local.length === 0) {
      ctx.stats.skippedBySize++
      return
    }
    emitElement(ctx, guard, pl, flipShapes(local, p.cellFlip, pl.i, pl.j))
  })
}

/**
 * Ancho maximo de una figura de fila que deja el puente contra sus vecinas
 * en la reticula de ladrillo (al costado, en diagonal y dos filas mas alla).
 * Busqueda binaria sobre el ancho pedido.
 */
function rowWidthLimit(
  pattern: HingePattern,
  L: number,
  P: number,
  s: number,
  wanted: number,
  waves: number,
  ctx: Ctx,
): number {
  const neighbors: Vec2[] = [
    [P, 0],
    [P / 2, s],
    [-P / 2, s],
    [0, 2 * s],
  ]
  const ok = (w: number) => {
    const e = hingeRowElement(pattern, L, w, waves)
    return neighbors.every(
      ([dx, dz]) =>
        shapesClearance(e, translateShapes(e, dx, dz), ctx.bridge, ctx.kerf) >= -1e-9,
    )
  }
  if (ok(wanted)) return wanted
  let lo = 0
  let hi = wanted
  if (!ok(lo)) return 0
  for (let k = 0; k < 16; k++) {
    const mid = (lo + hi) / 2
    if (ok(mid)) lo = mid
    else hi = mid
  }
  return lo
}

// ------------------------------------------------------------------ modulo

/**
 * El elemento de la bisagra actual como modulo editable (normalizado a la
 * celda, con aire alrededor): punto de partida para personalizarlo.
 */
export function hingeAsModule(p: LaserParams): LaserModule {
  const kind = hingeLatticeKind(p.hingePattern)
  const L = Math.max(p.hingeLengthMm, 2)
  const s = Math.max(p.hingeSpacingMm, 0.5)
  const shapes =
    kind === 'square'
      ? meanderElement(L, 0, s)
      : kind === 'triangle'
        ? trianglesElement(L, true, 0, s, 2 * s)
        : hingeRowElement(p.hingePattern, L, Math.min(p.hingeWidthMm, L), p.hingeWaves)
  const all = shapes.flatMap((sh) => sh.points)
  if (all.length === 0) return DEFAULT_MODULE
  const b = polygonBounds(all)
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 1e-9) / 0.9
  const cx = (b.minX + b.maxX) / 2
  const cz = (b.minZ + b.maxZ) / 2
  return {
    paths: shapes.map((sh) => ({
      points: sh.points.map(([x, z]): Vec2 => [(x - cx) / size, (z - cz) / size]),
      closed: sh.closed,
    })),
  }
}

/**
 * Modulo personalizado: los trazos de la celda normalizada se escalan al
 * paso de la disposicion menos el puente (+ kerf), asi dos modulos vecinos
 * que tocan el borde de su celda igual dejan el puente. El campo escala el
 * modulo entre "lejos" y "cerca" y, con "Seguir el campo", lo gira.
 */
function buildModule(ctx: Ctx, guard: BridgeGuard): void {
  const p = ctx.params
  const req = ctx.bridge + ctx.kerf
  const lattice: Lattice = {
    w: Math.max(p.moduleCellWMm, req + MIN_FEATURE_MM),
    h: Math.max(p.moduleCellHMm, req + MIN_FEATURE_MM),
    stagger: clamp(p.moduleStagger, 0, 1),
  }
  forEachElement(ctx, lattice, (pl, f) => {
    const t = cutWeight(ctx, f.value)
    if (t === null) return
    const k = clamp(lerp(p.moduleSizeFar, p.moduleSizeNear, t), 0, 1)
    const sx = (pl.cellW - req) * k
    const sz = (pl.cellH - req) * k
    if (Math.max(sx, sz) < MIN_FEATURE_MM) {
      ctx.stats.skippedBySize++
      return
    }
    let local = moduleShapes(p.module, sx, sz)
    if (local.length === 0) return
    local = flipShapes(local, p.cellFlip, pl.i, pl.j)
    local = rotateShapes(
      local,
      p.moduleRotationDeg * DEG2RAD + fieldAngleLocal(ctx, pl, f),
    )
    emitElement(ctx, guard, pl, local)
  })
}

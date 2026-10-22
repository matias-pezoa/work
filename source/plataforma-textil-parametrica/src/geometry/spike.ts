/**
 * "Pua": pieza solida y simple (cono truncado inclinado en linea recta) que
 * emerge de un plano. Reemplaza el enfoque anterior (pluma: pared delgada de
 * perfil 2D barrida por una curva arqueada), que no era imprimible:
 *
 *   - se arqueaba hasta ~150 grados desde la vertical -> vuelo/voladizo muy
 *     por encima de lo que FDM imprime sin soporte;
 *   - la punta se afinaba hasta un espesor menor al de una linea de
 *     extrusion -> no imprime o se rompe;
 *   - nacia de un solo punto sobre la tela, sin area de contacto real para
 *     que la primera capa se adhiera.
 *
 * El cono truncado solido resuelve las tres cosas por construccion:
 *   - Es una linea recta de base a punta con inclinacion CONSTANTE. Si esa
 *     inclinacion no supera el angulo autosoportado, CADA corte horizontal
 *     se desplaza lo mismo respecto del anterior (no hay ningun punto que
 *     vuele mas que el resto) -> imprimible sin soporte de punta a punta.
 *   - El radio de la punta nunca baja de un piso en mm.
 *   - El radio de la base (raiz) nunca baja de un piso en mm, para que la
 *     primera capa tenga area de contacto suficiente con la tela.
 *
 * Ojo: el limite de vuelo por capa (arriba) NO evita que una pua se despegue
 * de la cama/tela. Ese es un problema distinto: una pua alta e inclinada hace
 * palanca sobre su propia base (el peso/las fuerzas de la boquilla se
 * transmiten como un torque en el punto de apoyo) y puede despegarla aunque
 * cada corte individual sea "imprimible". Por eso la inclinacion tiene un
 * SEGUNDO limite, independiente del vuelo: que la punta nunca proyecte, en
 * horizontal, mas alla de `BASE_STABILITY_FACTOR` veces el radio de la propia
 * base. En la practica esto hace que las puas altas y angostas se inclinen
 * poco (o nada) aunque el campo pida mas — es la restriccion correcta, no un
 * bug: una pua alta y angosta inclinada de verdad SI se despega.
 *
 * Es ademas un solido cerrado (tapas incluidas): sin paredes delgadas que
 * dependan de normales para no verse como una lamina de espesor cero.
 *
 * Importante sobre la malla: la base NUNCA se inclina. Un corte FDM apila
 * capas HORIZONTALES sin importar cuanto "se incline" la pieza a simple
 * vista, asi que el solido se arma como un tronco de cono oblicuo: el anillo
 * de la base y el anillo de la punta son ambos horizontales (paralelos al
 * plano) y solo el CENTRO del anillo de la punta se desplaza lateralmente.
 * Si en cambio se rotara un cono recto de forma rigida (como se hizo en un
 * primer intento), el disco de la base tambien quedaria inclinado —
 * despegado del plano de un lado y hundido del otro — que es exactamente el
 * problema de adherencia que este modulo existe para evitar.
 *
 * Funcion pura.
 */
import * as THREE from 'three'
import { clamp, DEG2RAD, RAD2DEG } from '../utils/params'
import type { NumberParam } from '../utils/params'
import { mmToThree } from '../utils/units'
import { SAFE_OVERHANG_DEG } from './printability'

export { SAFE_OVERHANG_DEG }

/**
 * Cuantos "radios de base" puede proyectar la punta en horizontal antes de
 * que la palanca arriesgue despegar la base de la cama/tela. 1.0 = la punta
 * nunca queda mas lejos del eje vertical de la base que su propio radio; es
 * una regla conservadora y facil de explicar, no un calculo estructural fino.
 */
export const BASE_STABILITY_FACTOR = 1

/** Pisos de fabricacion, en mm (boquilla tipica de 0.4mm). */
export const MIN_TIP_RADIUS_MM = 0.5
export const MIN_ROOT_RADIUS_MM = 1.5
export const MIN_GAP_MM = 0

export const SPIKE_UI_PARAMS: readonly NumberParam[] = [
  {
    key: 'heightBase',
    label: 'Altura base',
    min: 0.1,
    max: 6,
    step: 0.05,
    default: 0.6,
    unit: 'u3d',
  },
  {
    key: 'heightField',
    label: 'Altura x campo',
    min: 0,
    max: 8,
    step: 0.05,
    default: 1.6,
    unit: 'u3d',
  },
  {
    key: 'rootRadiusBaseMm',
    label: 'Radio de base (raiz)',
    min: MIN_ROOT_RADIUS_MM,
    max: 12,
    step: 0.1,
    default: 3,
    unit: 'mm',
  },
  {
    key: 'rootRadiusFieldMm',
    label: 'Radio de base x campo',
    min: 0,
    max: 12,
    step: 0.1,
    default: 4,
    unit: 'mm',
  },
  {
    key: 'tipRadiusBaseMm',
    label: 'Radio de punta',
    min: MIN_TIP_RADIUS_MM,
    max: 6,
    step: 0.05,
    default: 0.8,
    unit: 'mm',
  },
  {
    key: 'tipRadiusFieldMm',
    label: 'Radio de punta x campo',
    min: 0,
    max: 6,
    step: 0.05,
    default: 0.6,
    unit: 'mm',
  },
  {
    key: 'leanDegBase',
    label: 'Inclinacion base',
    min: 0,
    max: SAFE_OVERHANG_DEG,
    step: 1,
    default: 8,
    unit: 'grados',
  },
  {
    key: 'leanDegField',
    label: 'Inclinacion x campo',
    min: 0,
    max: SAFE_OVERHANG_DEG,
    step: 1,
    default: 25,
    unit: 'grados',
  },
  {
    key: 'maxOverhangDeg',
    label: 'Vuelo maximo (por capa)',
    min: 0,
    max: SAFE_OVERHANG_DEG,
    step: 1,
    default: 35,
    unit: 'grados',
  },
  {
    key: 'gapMm',
    label: 'Separacion minima entre puas',
    min: MIN_GAP_MM,
    max: 6,
    step: 0.1,
    default: 1,
    unit: 'mm',
  },
  {
    key: 'segments',
    label: 'Caras (3=piramide, 32=cono)',
    min: 3,
    max: 32,
    step: 1,
    default: 20,
    unit: '-',
  },
]

export interface SpikeParams {
  /** Altura VERTICAL (no la longitud del eje inclinado), en unidades Three. */
  height: number
  rootRadiusMm: number
  tipRadiusMm: number
  /** Inclinacion deseada desde la vertical, en grados. Se recorta a [0, maxOverhangDeg]. */
  leanDeg: number
  /** Techo de inclinacion autosoportada para ESTA pua (grados, <= SAFE_OVERHANG_DEG). */
  maxOverhangDeg: number
}

export interface Spike {
  /** Centro del anillo de la base. SIEMPRE horizontal, nunca se inclina. */
  base: THREE.Vector3
  /** Centro del anillo de la punta. SIEMPRE horizontal; es el que se desplaza. */
  tip: THREE.Vector3
  /** Vector unitario de base a punta. Solo descriptivo (ver nota de arriba). */
  axis: THREE.Vector3
  rootRadius: number
  tipRadius: number
  /** Distancia recta de base a punta, en unidades Three. Solo descriptivo. */
  axisLength: number
  /** Radio conservador del area que ocupa sobre el plano (para evitar solapes). */
  footprintRadius: number
  /** Inclinacion realmente aplicada (tras recortar), en grados. */
  leanDegApplied: number
  /** true si la inclinacion pedida se recorto por estabilidad (no por vuelo). */
  limitedByStability: boolean
}

const UP = new THREE.Vector3(0, 1, 0)

/**
 * @param base    punto sobre el plano (se respeta su `y`, normalmente 0).
 * @param leanDir direccion en el plano XZ hacia la que se inclina la pua.
 */
export function buildSpike(
  base: THREE.Vector3,
  leanDir: THREE.Vector2,
  params: SpikeParams,
): Spike {
  const dir =
    leanDir.lengthSq() > 1e-8 ? leanDir.clone().normalize() : new THREE.Vector2(1, 0)
  const horiz = new THREE.Vector3(dir.x, 0, dir.y)

  const height = Math.max(1e-3, params.height)
  const rootRadius = mmToThree(Math.max(MIN_ROOT_RADIUS_MM, params.rootRadiusMm))
  const tipRadius = mmToThree(Math.max(MIN_TIP_RADIUS_MM, params.tipRadiusMm))

  // limite 1: vuelo por capa (autosoportado sin soporte).
  const overhangCeilingDeg = clamp(params.maxOverhangDeg, 0, SAFE_OVERHANG_DEG)
  // limite 2: estabilidad de la base (no hacer palanca y despegarla). Cuando
  // la pua es baja y ancha, atan(...) da un angulo grande y no restringe nada.
  const stabilityCeilingDeg =
    Math.atan2(rootRadius * BASE_STABILITY_FACTOR, height) * RAD2DEG
  const leanCeilingDeg = Math.min(overhangCeilingDeg, stabilityCeilingDeg)

  const leanDeg = clamp(params.leanDeg, 0, leanCeilingDeg)
  const lean = leanDeg * DEG2RAD

  const horizontalDrift = height * Math.tan(lean)
  const tip = base
    .clone()
    .addScaledVector(UP, height)
    .addScaledVector(horiz, horizontalDrift)

  const axisVec = tip.clone().sub(base)
  const axisLength = Math.max(axisVec.length(), 1e-6)
  const axis = axisVec.clone().multiplyScalar(1 / axisLength)

  const footprintRadius = Math.max(rootRadius, horizontalDrift + tipRadius)

  return {
    base: base.clone(),
    tip,
    axis,
    rootRadius,
    tipRadius,
    axisLength,
    footprintRadius,
    leanDegApplied: leanDeg,
    // la estabilidad fue la que realmente recorto el pedido (no solo que su
    // techo sea mas bajo que el de vuelo, sino que el pedido lo supero).
    limitedByStability:
      stabilityCeilingDeg < overhangCeilingDeg - 1e-6 &&
      params.leanDeg > stabilityCeilingDeg + 1e-6,
  }
}

/**
 * Malla solida y cerrada (tronco de cono OBLICUO) de una pua ya calculada.
 * El anillo de la base y el de la punta son ambos horizontales; solo el
 * centro de la punta esta desplazado del centro de la base. La base nunca
 * se inclina (ver nota al inicio del archivo).
 */
export function spikeGeometry(spike: Spike, segments: number): THREE.BufferGeometry {
  const n = Math.max(3, Math.round(segments))

  // eje horizontal estable en la direccion de la deriva (o uno fijo si no
  // hay deriva); ambos anillos usan el MISMO par de ejes para que sus
  // vertices queden alineados radialmente (caras laterales planas).
  const driftX = spike.tip.x - spike.base.x
  const driftZ = spike.tip.z - spike.base.z
  const driftLen = Math.hypot(driftX, driftZ)
  const ex = driftLen > 1e-8 ? driftX / driftLen : 1
  const ez = driftLen > 1e-8 ? driftZ / driftLen : 0
  const fx = -ez // perpendicular horizontal a (ex, ez)
  const fz = ex

  const positions: number[] = []
  const baseRing: number[] = []
  const tipRing: number[] = []

  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    const ox = c * ex + s * fx
    const oz = c * ez + s * fz

    baseRing.push(positions.length / 3)
    positions.push(
      spike.base.x + spike.rootRadius * ox,
      spike.base.y,
      spike.base.z + spike.rootRadius * oz,
    )

    tipRing.push(positions.length / 3)
    positions.push(
      spike.tip.x + spike.tipRadius * ox,
      spike.tip.y,
      spike.tip.z + spike.tipRadius * oz,
    )
  }

  const indices: number[] = []

  // caras laterales
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const b0 = baseRing[i]
    const b1 = baseRing[j]
    const t0 = tipRing[i]
    const t1 = tipRing[j]
    indices.push(b0, b1, t1, b0, t1, t0)
  }

  // tapa de la base, mirando hacia abajo
  const baseCenterIdx = positions.length / 3
  positions.push(spike.base.x, spike.base.y, spike.base.z)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    indices.push(baseCenterIdx, baseRing[j], baseRing[i])
  }

  // tapa de la punta, mirando hacia arriba
  const tipCenterIdx = positions.length / 3
  positions.push(spike.tip.x, spike.tip.y, spike.tip.z)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    indices.push(tipCenterIdx, tipRing[i], tipRing[j])
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

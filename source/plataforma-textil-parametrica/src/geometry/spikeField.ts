/**
 * Campo de puas que emergen de un plano, dirigido por el mapa de atractores.
 *
 * Sobre un panel plano (la base de tela) se siembran puntos con densidad
 * proporcional al campo; en cada punto crece una pua solida (ver spike.ts)
 * cuya altura, radios y inclinacion tambien salen del campo, siempre dentro
 * de limites imprimibles (ver spike.ts). Las puas nunca se solapan entre si:
 * antes de aceptar una, se verifica que su huella sobre el plano no invada la
 * de ninguna pua ya colocada.
 *
 * Funcion pura y determinista (mismo seed -> mismo resultado).
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { clamp, lerp } from '../utils/params'
import type { NumberParam } from '../utils/params'
import { mulberry32 } from '../utils/random'
import { mmToThree, threeToMm } from '../utils/units'
import { buildSpike, spikeGeometry, SAFE_OVERHANG_DEG, MIN_GAP_MM } from './spike'
import { sampleField } from './attractionField'
import type { Attractor, CombineMode } from './attractionField'
import { pointInBoundary, polygonBounds, type Boundary, type Vec2 } from './polygon'

export interface SpikeFieldParams {
  /** Lado del panel cuadrado (u3d). Centrado en el origen, sobre y = 0. */
  planeSize: number

  // --- distribucion sobre el plano ---
  gridU: number
  gridV: number
  densityMin: number
  densityMax: number
  jitter: number
  maxCount: number
  seed: number
  combine: CombineMode

  // --- forma de la pua (base + aporte del campo) ---
  heightBase: number
  heightField: number
  rootRadiusBaseMm: number
  rootRadiusFieldMm: number
  tipRadiusBaseMm: number
  tipRadiusFieldMm: number
  leanDegBase: number
  leanDegField: number
  /** Techo de inclinacion autosoportada (grados, <= SAFE_OVERHANG_DEG). */
  maxOverhangDeg: number
  /** Separacion minima extra entre puas vecinas, en mm. */
  gapMm: number
  /** Caras del cono truncado (3 = piramide, muchas = liso). */
  segments: number
  /** La pua se inclina alejandose de los atractores (sigue el gradiente). */
  alignToField: boolean
}

export const DEFAULT_SPIKE_FIELD: SpikeFieldParams = {
  planeSize: 30,
  gridU: 30,
  gridV: 30,
  densityMin: 0.03,
  densityMax: 0.85,
  jitter: 0.85,
  maxCount: 260,
  seed: 4242,
  combine: 'max',
  heightBase: 0.6,
  heightField: 1.6,
  rootRadiusBaseMm: 3,
  rootRadiusFieldMm: 4,
  tipRadiusBaseMm: 0.8,
  tipRadiusFieldMm: 0.6,
  leanDegBase: 8,
  leanDegField: 25,
  maxOverhangDeg: 35,
  gapMm: 1,
  segments: 20,
  alignToField: true,
}

export const FIELD_UI_PARAMS: readonly NumberParam[] = [
  {
    key: 'planeSize',
    label: 'Lado del panel',
    min: 6,
    max: 80,
    step: 1,
    default: 30,
    unit: 'u3d',
  },
  {
    key: 'gridU',
    label: 'Grilla U',
    min: 6,
    max: 160,
    step: 1,
    default: 30,
    unit: 'celdas',
  },
  {
    key: 'gridV',
    label: 'Grilla V',
    min: 6,
    max: 160,
    step: 1,
    default: 30,
    unit: 'celdas',
  },
  {
    key: 'densityMin',
    label: 'Densidad (campo=0)',
    min: 0,
    max: 1,
    step: 0.005,
    default: 0.03,
    unit: 'prob',
  },
  {
    key: 'densityMax',
    label: 'Densidad (campo=1)',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.85,
    unit: 'prob',
  },
  {
    key: 'jitter',
    label: 'Desorden posicional',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.85,
    unit: 'frac',
  },
  {
    key: 'maxCount',
    label: 'Maximo de puas',
    min: 10,
    max: 1500,
    step: 10,
    default: 260,
    unit: '-',
  },
]

export interface SpikePlacement {
  x: number
  z: number
  height: number
  /** Radios YA aplicados (con los pisos de fabricacion), en mm. */
  rootRadiusMm: number
  tipRadiusMm: number
  /** Inclinacion YA aplicada (recortada a los limites), en grados. */
  leanDeg: number
  field: number
  /** Radio conservador de la huella sobre el plano (unidades Three), ver spike.ts. */
  footprintRadius: number
  /** true si la inclinacion pedida se recorto por estabilidad de la base. */
  limitedByStability: boolean
}

export interface SpikeFieldResult {
  /** Malla solida con todas las puas fusionadas. Vacia si no se coloco ninguna. */
  geometry: THREE.BufferGeometry
  /** Caja envolvente, en unidades de Three. */
  bounds: THREE.Box3
  count: number
  triangleCount: number
  /** Cuantos candidatos se descartaron solo por solaparse con una pua vecina. */
  rejectedByOverlap: number
  /** Cuantas puas colocadas se inclinaron menos de lo pedido para no despegar la base. */
  limitedByStabilityCount: number
  placements: SpikePlacement[]
}

interface Footprint {
  x: number
  z: number
  r: number
}

export function buildSpikeField(
  attractors: readonly Attractor[],
  params: SpikeFieldParams,
  boundary?: Boundary | null,
): SpikeFieldResult {
  const rng = mulberry32(params.seed)
  const gu = Math.max(1, Math.round(params.gridU))
  const gv = Math.max(1, Math.round(params.gridV))
  const maxOverhang = clamp(params.maxOverhangDeg, 0, SAFE_OVERHANG_DEG)
  const gap = mmToThree(Math.max(MIN_GAP_MM, params.gapMm))
  const domain = resolveDomain(params.planeSize, boundary)

  const geoms: THREE.BufferGeometry[] = []
  const placed: Footprint[] = []
  const placements: SpikePlacement[] = []
  let rejectedByOverlap = 0
  let limitedByStabilityCount = 0

  const p = new THREE.Vector3()
  const leanDir = new THREE.Vector2()

  outer: for (let iv = 0; iv < gv; iv++) {
    for (let iu = 0; iu < gu; iu++) {
      const u = clamp((iu + 0.5 + (rng() - 0.5) * params.jitter) / gu, 0, 1)
      const v = clamp((iv + 0.5 + (rng() - 0.5) * params.jitter) / gv, 0, 1)
      const x = lerp(domain.minX, domain.maxX, u)
      const z = lerp(domain.minZ, domain.maxZ, v)
      if (!domain.test(x, z)) continue
      p.set(x, 0, z)

      const field = sampleField(p, attractors, params.combine)
      const accept = lerp(params.densityMin, params.densityMax, field.value)
      if (rng() >= accept) continue

      const height = Math.max(0.02, params.heightBase + field.value * params.heightField)
      const rootRadiusMm =
        params.rootRadiusBaseMm + field.value * params.rootRadiusFieldMm
      const tipRadiusMm = params.tipRadiusBaseMm + field.value * params.tipRadiusFieldMm
      const leanDeg = params.leanDegBase + field.value * params.leanDegField

      if (params.alignToField && field.direction) {
        // se inclinan ALEJANDOSE de los atractores, como el borde de una
        // zona densa que se abre hacia afuera.
        leanDir.set(-field.direction.x, -field.direction.z)
      } else if (x === 0 && z === 0) {
        const a = rng() * Math.PI * 2
        leanDir.set(Math.cos(a), Math.sin(a))
      } else {
        leanDir.set(x, z) // radial desde el centro del panel
      }

      const spike = buildSpike(p, leanDir, {
        height,
        rootRadiusMm,
        tipRadiusMm,
        leanDeg,
        maxOverhangDeg: maxOverhang,
      })

      if (overlapsAny(x, z, spike.footprintRadius + gap, placed)) {
        rejectedByOverlap++
        continue
      }

      placed.push({ x, z, r: spike.footprintRadius })
      geoms.push(spikeGeometry(spike, params.segments))
      if (spike.limitedByStability) limitedByStabilityCount++
      placements.push({
        x,
        z,
        height,
        rootRadiusMm: threeToMm(spike.rootRadius),
        tipRadiusMm: threeToMm(spike.tipRadius),
        leanDeg: spike.leanDegApplied,
        field: field.value,
        footprintRadius: spike.footprintRadius,
        limitedByStability: spike.limitedByStability,
      })

      if (geoms.length >= params.maxCount) break outer
    }
  }

  const geometry = geoms.length ? mergeNormalized(geoms) : new THREE.BufferGeometry()
  geoms.forEach((g) => g.dispose())

  const bounds = new THREE.Box3()
  if (hasVerts(geometry)) {
    geometry.computeBoundingBox()
    if (geometry.boundingBox) bounds.copy(geometry.boundingBox)
  }

  return {
    geometry,
    bounds,
    count: placements.length,
    triangleCount: indexCount(geometry) / 3,
    rejectedByOverlap,
    limitedByStabilityCount,
    placements,
  }
}

interface Domain {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  /** true si (x,z) cae dentro del area sembrable. */
  test: (x: number, z: number) => boolean
}

/**
 * Sin `boundary`: el cuadrado `planeSize` de siempre (test siempre true).
 * Con `boundary` (p. ej. una pieza de patron importada, en mm): su caja
 * envolvente en unidades Three, y el test es "dentro del contorno externo y
 * fuera de los agujeros".
 */
function resolveDomain(planeSize: number, boundary?: Boundary | null): Domain {
  if (!boundary) {
    const half = planeSize / 2
    return { minX: -half, maxX: half, minZ: -half, maxZ: half, test: () => true }
  }
  const toThree = (pts: readonly Vec2[]): Vec2[] =>
    pts.map(([x, z]) => [mmToThree(x), mmToThree(z)])
  const outer = toThree(boundary.outer)
  const holes = boundary.holes.map(toThree)
  const b = polygonBounds(outer)
  return {
    minX: b.minX,
    maxX: b.maxX,
    minZ: b.minZ,
    maxZ: b.maxZ,
    test: (x, z) => pointInBoundary(x, z, { outer, holes }),
  }
}

function overlapsAny(
  x: number,
  z: number,
  radius: number,
  placed: readonly Footprint[],
): boolean {
  for (const f of placed) {
    const dx = x - f.x
    const dz = z - f.z
    const minDist = radius + f.r
    if (dx * dx + dz * dz < minDist * minDist) return true
  }
  return false
}

/** Fusiona dejando solo `position` + `index` (clona los inputs), recalcula normales. */
function mergeNormalized(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = geoms.map((g) => {
    const c = new THREE.BufferGeometry()
    c.setAttribute('position', g.getAttribute('position').clone())
    const idx = g.getIndex()
    if (idx) c.setIndex(idx.clone())
    return c
  })
  const merged = mergeGeometries(clean, false) ?? new THREE.BufferGeometry()
  clean.forEach((c) => c.dispose())
  merged.computeVertexNormals()
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

function hasVerts(g: THREE.BufferGeometry): boolean {
  const pos = g.getAttribute('position')
  return !!pos && pos.count > 0
}

function indexCount(g: THREE.BufferGeometry): number {
  const idx = g.getIndex()
  if (idx) return idx.count
  const pos = g.getAttribute('position')
  return pos ? pos.count : 0
}

/**
 * "Ondas": peine de costillas INDEPENDIENTES (una por una, sin plancha que
 * las una) generadas por corte transversal (contour) de una superficie de
 * ondulacion trigonometrica dirigida por el mapa de atractores.
 *
 * Esto NO es un panel corrugado tallado en un bloque solido (ese fue el
 * primer intento de este modo, ver historial): eso es la logica de un
 * calado CNC, donde hace falta una plancha de base porque la maquina resta
 * material de un bloque. Aca se imprime en 3D: cada costilla es su propio
 * solido cerrado, nace en y = 0 y no hay ninguna plancha que las conecte
 * entre si. La "base" es la tela ya puesta en la cama de impresion (ver
 * `BaseShapeGround`, que sigue siendo solo la referencia visual de esa tela)
 * — por eso no hace falta modelar espesor de base ninguno.
 *
 * Construccion de cada costilla: es una linea recta en X (perpendicular a
 * las demas, todas paralelas y equiespaciadas por `spacingMm`); a lo largo
 * de su longitud en Z se muestrea la MISMA ondulacion radial que el modo
 * Volumen usa para atraer (`attractionField.falloff`, combinada por atractor
 * como un circulo concentrico que se aleja de una piedra tirada al agua), y
 * esa altura se extruye como un solido delgado (espesor `ribThicknessMm`)
 * de seccion "cerca de tierra". Una costilla no baja de una altura piso
 * (`heightFloorMm`): en zonas sin influencia de ningun atractor sigue
 * siendo un diente visible del peine. Si se pone `heightFloorMm` en 0, esa
 * garantia desaparece a proposito: donde la altura pedida (piso + campo) cae
 * por debajo del minimo imprimible (`MIN_RIB_HEIGHT_MM`) directamente NO se
 * genera material ahi — la costilla se corta y deja un hueco real, el mismo
 * mecanismo que usa el contorno del panel para partir costillas en tramos
 * (ver mas abajo).
 *
 * Si el contorno del panel (una base importada, con agujeros) corta una
 * costilla en tramos separados, cada tramo se emite como su propio solido
 * cerrado independiente (con tapas en sus dos extremos) — no se intenta
 * "saltar" el agujero con una sola pieza.
 *
 * Factibilidad de impresion: a diferencia de una superficie corrugada
 * continua, una costilla delgada de pie a copete NO tiene vuelo/voladizo
 * real (sus caras laterales son practicamente verticales; el perfil
 * superior simplemente sube y baja dentro de esa pared, nunca "cuelga"
 * hacia afuera) — por eso este modo no recorta la amplitud por angulo como
 * el modo Volumen. Los pisos que si aplican: espesor minimo de costilla
 * (`MIN_RIB_THICKNESS_MM`, ~2 perimetros de una boquilla de 0.4mm),
 * separacion minima entre costillas vecinas para que no se toquen
 * (`MIN_SPACING_MM` + un margen fijo `RIB_GAP_MM`, que recorta el espesor
 * pedido si no entra) y una altura minima imprimible (`MIN_RIB_HEIGHT_MM`):
 * por debajo de eso no se afina la costilla hasta un hilo, se corta y queda
 * vacio (ver `heightFloorMm` arriba). Ademas se reporta la
 * esbeltez maxima (altura / espesor) como aviso: costillas muy altas y
 * finas pueden vibrar o desprenderse durante la impresion aunque cada corte
 * sea imprimible.
 *
 * Funcion pura.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { clamp } from '../utils/params'
import type { NumberParam } from '../utils/params'
import { mmToThree, threeToMm } from '../utils/units'
import { closestDistance2D, falloff } from './attractionField'
import type { Attractor, CombineMode } from './attractionField'
import { pointInBoundary, polygonBounds, type Boundary, type Vec2 } from './polygon'

/** Piso de espesor de costilla, en mm (2 perimetros de una boquilla de 0.4mm). */
export const MIN_RIB_THICKNESS_MM = 0.8
/** Piso de separacion entre ejes de costillas vecinas, en mm. */
export const MIN_SPACING_MM = 2
/** Margen de aire fijo entre las caras de dos costillas vecinas, en mm. */
export const RIB_GAP_MM = 0.6
/**
 * Altura minima imprimible de una costilla, en mm. No es un piso que se le
 * imponga a `heightFloorMm` (ese puede ser 0) — es el umbral por debajo del
 * cual una costilla directamente no se genera ahi (queda vacio) en vez de
 * afinarse hasta un hilo imposible de imprimir.
 */
export const MIN_RIB_HEIGHT_MM = 1
/** Piso de longitud de onda, en mm (que la ondulacion no sea mas fina que un par de lineas). */
export const MIN_WAVELENGTH_MM = 4

export interface WaveFieldParams {
  /** Lado del panel cuadrado (u3d). Centrado en el origen, costillas desde y = 0. */
  planeSize: number
  /** Distancia entre ejes de costillas consecutivas (piso MIN_SPACING_MM). */
  spacingMm: number
  /** Espesor pedido de cada costilla (se recorta si no entra en `spacingMm`, ver arriba). */
  ribThicknessMm: number
  /**
   * Altura minima de costilla, incluso sin influencia de atractores. En 0:
   * sin atractores cerca, esa zona del panel queda vacia (ver arriba).
   */
  heightFloorMm: number
  /** Amplitud pedida de las crestas, por encima de la altura piso. */
  amplitudeMm: number
  /** Distancia entre crestas consecutivas a lo largo de una costilla (piso MIN_WAVELENGTH_MM). */
  wavelengthMm: number
  /** Muestras del perfil por longitud de onda. Bajo = perfil angular; alto = curva suave. */
  facetsPerWave: number
  combine: CombineMode
}

export const DEFAULT_WAVE_FIELD: WaveFieldParams = {
  planeSize: 24,
  spacingMm: 5,
  ribThicknessMm: 1.2,
  heightFloorMm: 3,
  amplitudeMm: 22,
  wavelengthMm: 70,
  facetsPerWave: 6,
  combine: 'max',
}

export const WAVE_UI_PARAMS: readonly NumberParam[] = [
  {
    key: 'planeSize',
    label: 'Lado del panel',
    min: 6,
    max: 80,
    step: 1,
    default: 24,
    unit: 'u3d',
  },
  {
    key: 'spacingMm',
    label: 'Separacion entre costillas',
    min: MIN_SPACING_MM,
    max: 30,
    step: 0.5,
    default: 5,
    unit: 'mm',
  },
  {
    key: 'ribThicknessMm',
    label: 'Espesor de costilla',
    min: MIN_RIB_THICKNESS_MM,
    max: 6,
    step: 0.1,
    default: 1.2,
    unit: 'mm',
  },
  {
    key: 'heightFloorMm',
    label: 'Altura minima (valle)',
    min: 0,
    max: 30,
    step: 0.5,
    default: 3,
    unit: 'mm',
  },
  {
    key: 'wavelengthMm',
    label: 'Longitud de onda',
    min: MIN_WAVELENGTH_MM,
    max: 120,
    step: 0.5,
    default: 70,
    unit: 'mm',
  },
  {
    key: 'amplitudeMm',
    label: 'Amplitud (cresta)',
    min: 0,
    max: 60,
    step: 0.5,
    default: 22,
    unit: 'mm',
  },
  {
    key: 'facetsPerWave',
    label: 'Muestras por onda',
    min: 2,
    max: 24,
    step: 1,
    default: 6,
    unit: '-',
  },
]

const MAX_RIBS = 200
const MAX_SAMPLES_PER_RIB = 200

export interface WaveFieldResult {
  /** Malla con todas las costillas fusionadas (cada una sigue siendo un solido disjunto). */
  geometry: THREE.BufferGeometry
  bounds: THREE.Box3
  triangleCount: number
  /** Cuantos ejes de costilla caen dentro del panel (antes de partirlos por el contorno). */
  ribCount: number
  /** Cuantas piezas solidas independientes se emitieron en total (una costilla puede partirse en varias). */
  segmentCount: number
  /** Espesor de costilla efectivamente usado (mm), tras el recorte por separacion. */
  appliedRibThicknessMm: number
  /** true si el espesor pedido se recorto porque no entraba en la separacion pedida. */
  thicknessLimited: boolean
  /** Altura maxima alcanzada por cualquier costilla (mm), para juzgar esbeltez. */
  maxHeightMm: number
  /** Esbeltez maxima (altura / espesor): aviso de vibracion/desprendimiento en costillas muy altas y finas. */
  maxAspectRatio: number
}

export function buildWaveField(
  attractors: readonly Attractor[],
  params: WaveFieldParams,
  boundary?: Boundary | null,
): WaveFieldResult {
  const spacing = mmToThree(Math.max(MIN_SPACING_MM, params.spacingMm))
  const requestedThickness = mmToThree(Math.max(MIN_RIB_THICKNESS_MM, params.ribThicknessMm))
  const gap = mmToThree(RIB_GAP_MM)
  const thickness = Math.max(
    mmToThree(MIN_RIB_THICKNESS_MM),
    Math.min(requestedThickness, spacing - gap),
  )
  const heightFloor = mmToThree(Math.max(0, params.heightFloorMm))
  const amplitude = mmToThree(Math.max(0, params.amplitudeMm))
  const wavelength = mmToThree(Math.max(MIN_WAVELENGTH_MM, params.wavelengthMm))
  const facets = Math.max(2, Math.round(params.facetsPerWave))
  const materialThreshold = mmToThree(MIN_RIB_HEIGHT_MM)

  const domain = resolveDomain(params.planeSize, boundary)
  const width = domain.maxX - domain.minX
  const height = domain.maxZ - domain.minZ

  const ribCount = clamp(width > 0 ? Math.floor(width / spacing) + 1 : 1, 1, MAX_RIBS)
  const effectiveSpacing = ribCount > 1 ? width / (ribCount - 1) : 0

  const sampleStep = wavelength / facets
  const sampleCount = clamp(height > 0 ? Math.round(height / sampleStep) : 1, 4, MAX_SAMPLES_PER_RIB)

  const heightAt = (x: number, z: number): number =>
    heightFloor + rippleHeight(x, z, attractors, params.combine, wavelength) * amplitude
  // sin material (hueco) si la altura pedida ahi no llega al minimo imprimible.
  const hasMaterial = (x: number, z: number): boolean =>
    domain.test(x, z) && heightAt(x, z) >= materialThreshold

  const geoms: THREE.BufferGeometry[] = []
  let segmentCount = 0
  let maxHeight = 0

  for (let i = 0; i < ribCount; i++) {
    const x = ribCount > 1 ? domain.minX + i * effectiveSpacing : (domain.minX + domain.maxX) / 2
    for (const run of insideRuns(hasMaterial, domain.minZ, height, x, sampleCount)) {
      const zs: number[] = []
      const hs: number[] = []
      for (let s = run.start; s <= run.end; s++) {
        const z = domain.minZ + (s / sampleCount) * height
        const h = heightAt(x, z)
        zs.push(z)
        hs.push(h)
        if (h > maxHeight) maxHeight = h
      }
      if (zs.length < 2) continue
      geoms.push(ribSegmentGeometry(x, thickness, zs, hs))
      segmentCount++
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
    triangleCount: indexCount(geometry) / 3,
    ribCount,
    segmentCount,
    appliedRibThicknessMm: threeToMm(thickness),
    thicknessLimited: thickness < requestedThickness - 1e-9,
    maxHeightMm: threeToMm(maxHeight),
    maxAspectRatio: thickness > 0 ? maxHeight / thickness : 0,
  }
}

interface Domain {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  /** true si (x,z) cae dentro del area a llenar. */
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

/**
 * Ondulacion combinada de todos los atractores en (x, z), normalizada a
 * [0, 1]. 0 = sin influencia en ese punto (costilla en su altura piso), 1 =
 * cresta maxima. La distancia es al PUNTO mas cercano del atractor (radial
 * para uno `kind: 'point'`, a la linea poligonal para uno `kind: 'curve'`,
 * ver `closestDistance2D`) — asi una curva atractora genera una cresta a lo
 * largo de todo su trazo, no solo en sus puntos de control.
 */
function rippleHeight(
  x: number,
  z: number,
  attractors: readonly Attractor[],
  combine: CombineMode,
  wavelength: number,
): number {
  let acc = 0
  for (const a of attractors) {
    const strength = Math.max(0, a.strength) // solo relieve hacia arriba
    if (strength <= 0) continue
    const d = closestDistance2D(x, z, a)
    const envelope = falloff(a.falloff, d, a.radius) * strength
    if (envelope <= 0) continue
    const wave = 0.5 + 0.5 * Math.sin((2 * Math.PI * d) / wavelength)
    const contribution = envelope * wave
    acc = combine === 'sum' ? acc + contribution : Math.max(acc, contribution)
  }
  return clamp(acc, 0, 1)
}

interface Run {
  start: number
  end: number
}

/**
 * Tramos de muestras (indices [0, sampleCount] a lo largo de Z) donde el eje
 * `x` de una costilla tiene material segun `hasMaterial` (dentro del
 * contorno del panel Y con altura suficiente para imprimirse). Tanto un
 * contorno no convexo (p. ej. un agujero) como una altura piso en 0 pueden
 * partir una costilla en varios tramos disjuntos; cada uno se devuelve por
 * separado para emitirse como su propio solido cerrado.
 */
function insideRuns(
  hasMaterial: (x: number, z: number) => boolean,
  minZ: number,
  spanZ: number,
  x: number,
  sampleCount: number,
): Run[] {
  const inside: boolean[] = []
  for (let s = 0; s <= sampleCount; s++) {
    const z = minZ + (s / sampleCount) * spanZ
    inside.push(hasMaterial(x, z))
  }
  const runs: Run[] = []
  let start = -1
  for (let s = 0; s <= sampleCount; s++) {
    if (inside[s] && start < 0) start = s
    if ((!inside[s] || s === sampleCount) && start >= 0) {
      const end = inside[s] ? s : s - 1
      if (end > start) runs.push({ start, end })
      start = -1
    }
  }
  return runs
}

/**
 * Solido cerrado de UNA costilla (o UN tramo de costilla): pie plano en
 * y = 0 (lo que se apoya contra la tela en la cama de impresion), perfil
 * superior siguiendo `hs[j]` en cada `zs[j]`, espesor constante `thickness`
 * en X, y tapas en los dos extremos de la lista de muestras. Vertices
 * duplicados entre solidos (no hay: cada costilla es su propia malla) para
 * que cada pieza sea manifold por separado.
 */
function ribSegmentGeometry(
  x: number,
  thickness: number,
  zs: readonly number[],
  hs: readonly number[],
): THREE.BufferGeometry {
  const half = thickness / 2
  const xf = x - half
  const xb = x + half
  const n = zs.length

  const positions: number[] = []
  const frontBottom: number[] = []
  const frontTop: number[] = []
  const backBottom: number[] = []
  const backTop: number[] = []

  const push = (px: number, py: number, pz: number): number => {
    const i = positions.length / 3
    positions.push(px, py, pz)
    return i
  }

  for (let j = 0; j < n; j++) {
    const z = zs[j]
    const h = hs[j]
    frontBottom.push(push(xf, 0, z))
    frontTop.push(push(xf, h, z))
    backBottom.push(push(xb, 0, z))
    backTop.push(push(xb, h, z))
  }

  const indices: number[] = []
  const quad = (a: number, b: number, c: number, d: number) => {
    indices.push(a, b, c, a, c, d)
  }

  for (let j = 0; j < n - 1; j++) {
    // cara frontal (x = xf, normal hacia -X)
    quad(frontBottom[j], frontBottom[j + 1], frontTop[j + 1], frontTop[j])
    // cara trasera (x = xb, normal hacia +X)
    quad(backTop[j], backTop[j + 1], backBottom[j + 1], backBottom[j])
    // filo superior (perfil de la onda)
    quad(frontTop[j], frontTop[j + 1], backTop[j + 1], backTop[j])
    // pie (y = 0, normal hacia -Y, apoya contra la tela)
    quad(frontBottom[j + 1], frontBottom[j], backBottom[j], backBottom[j + 1])
  }

  // tapa del extremo inicial (normal hacia -Z: el solido crece hacia +Z desde aca)
  quad(frontTop[0], backTop[0], backBottom[0], frontBottom[0])
  // tapa del extremo final (normal hacia +Z)
  const last = n - 1
  quad(frontBottom[last], backBottom[last], backTop[last], frontTop[last])

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
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

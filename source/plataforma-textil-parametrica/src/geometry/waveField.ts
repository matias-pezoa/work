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
 * Trazado de las costillas en planta: son LINEAS DE FLUJO equiespaciadas
 * (`spacingMm`) de un campo de direcciones (`flowDirection`). Lejos de los
 * atractores siguen la direccion base del panel (`ribAngleDeg`; sin
 * atractores = el peine de rectas paralelas de siempre); cerca de una curva
 * atractora corren a lo largo de ella, y cerca de un punto toman su angulo
 * (`angleDeg`, rotable). `flowStrength` = 0 vuelve a rectas paralelas. Dos
 * costillas nunca se acercan eje a eje a menos de espesor + aire: si las
 * lineas convergen, la costilla se corta ahi (`minRibDistanceMm`).
 *
 * A lo largo de cada costilla se muestrea la ondulacion de los atractores
 * (`rippleHeight`: concentrica o direccional por atractor, con la misma
 * envolvente `falloff` que el modo Volumen), y esa altura se extruye como un solido delgado (espesor `ribThicknessMm`)
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
import { clamp, DEG2RAD } from '../utils/params'
import type { NumberParam } from '../utils/params'
import { mmToThree, threeToMm } from '../utils/units'
import { curveFrame2D, falloff } from './attractionField'
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
  /** Direccion base de las costillas en el plano, grados (0 = +X, 90 = +Z). */
  ribAngleDeg: number
  /** Cuanto doblan los atractores a las costillas (0 = rectas paralelas, 1 = siguen al atractor). */
  flowStrength: number
  /**
   * Como se orientan las costillas respecto de una curva atractora:
   * 'across' = perpendiculares (la cruzan, como peldanos), 'along' = la
   * acompanan, corriendo a lo largo de ella.
   */
  curveRibs: CurveRibs
}

export type CurveRibs = 'across' | 'along'

export const CURVE_RIBS_LABELS: Record<CurveRibs, string> = {
  across: 'Perpendiculares a la curva',
  along: 'A lo largo de la curva',
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
  ribAngleDeg: 90,
  flowStrength: 1,
  curveRibs: 'across',
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
    key: 'ribAngleDeg',
    label: 'Direccion base de costillas',
    min: 0,
    max: 180,
    step: 1,
    default: 90,
    unit: 'grados',
  },
  {
    key: 'flowStrength',
    label: 'Flujo (costillas siguen atractores)',
    min: 0,
    max: 1,
    step: 0.01,
    default: 1,
    unit: '-',
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

/** Tope de costillas (lineas de flujo) por panel. */
const MAX_RIBS = 1200
/** Tope de pasos de integracion por sentido de una linea de flujo. */
const MAX_STEPS = 4000
/** Una linea de flujo mas corta que esto (en separaciones) no se emite como costilla. */
const MIN_RIB_LENGTH_SEPS = 1.5
/** Peso minimo de la direccion base aun en el centro de un atractor (evita indefiniciones). */
const BASE_FLOW_FLOOR = 0.02

export interface WaveFieldResult {
  /** Malla con todas las costillas fusionadas (cada una sigue siendo un solido disjunto). */
  geometry: THREE.BufferGeometry
  bounds: THREE.Box3
  triangleCount: number
  /** Cuantas costillas (lineas de flujo) se trazaron, antes de partirlas por altura minima. */
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
  /** Distancia minima garantizada entre ejes de costillas vecinas (mm): espesor + aire, o mas. */
  minRibDistanceMm: number
  /** Ejes de las costillas en planta (x, z en u3d), antes de partirlas por altura. */
  ribLines: Vec2[][]
}

export function buildWaveField(
  attractors: readonly Attractor[],
  params: WaveFieldParams,
  boundary?: Boundary | null,
): WaveFieldResult {
  const spacing = mmToThree(Math.max(MIN_SPACING_MM, params.spacingMm))
  const requestedThickness = mmToThree(
    Math.max(MIN_RIB_THICKNESS_MM, params.ribThicknessMm),
  )
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

  // Dos costillas vecinas nunca se acercan (eje a eje) a menos de `minDist`:
  // asi entre sus caras siempre queda al menos el aire RIB_GAP_MM, aunque las
  // lineas de flujo converjan. Si convergen mas, la costilla se corta ahi.
  const minDist = Math.max(spacing * 0.5, thickness + gap)
  const step = clamp(spacing / 3, 0.02, 0.4)

  const lines = traceRibLines(
    domain,
    (x, z) => flowDirection(x, z, attractors, params),
    spacing,
    minDist,
    step,
  )

  const heightAt = (x: number, z: number): number =>
    heightFloor + rippleHeight(x, z, attractors, params.combine, wavelength) * amplitude

  const geoms: THREE.BufferGeometry[] = []
  let segmentCount = 0
  let maxHeight = 0

  for (const line of lines) {
    // perfil facetado: la altura se muestrea cada `wavelength / facets` a lo
    // largo de la costilla y se interpola linealmente entre estaciones (el
    // trazo en planta sigue fino, la cresta queda angular como antes).
    const hs = profileHeights(line, heightAt, wavelength / facets)
    let start = -1
    for (let i = 0; i <= line.length; i++) {
      // sin material (hueco) donde la altura pedida no llega al minimo imprimible
      const solid = i < line.length && hs[i] >= materialThreshold
      if (solid && start < 0) start = i
      if (!solid && start >= 0) {
        if (i - start >= 2) {
          const pts = line.slice(start, i)
          const run = hs.slice(start, i)
          for (const h of run) if (h > maxHeight) maxHeight = h
          geoms.push(ribPolylineGeometry(pts, run, thickness))
          segmentCount++
        }
        start = -1
      }
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
    ribCount: lines.length,
    segmentCount,
    appliedRibThicknessMm: threeToMm(thickness),
    thicknessLimited: thickness < requestedThickness - 1e-9,
    maxHeightMm: threeToMm(maxHeight),
    maxAspectRatio: thickness > 0 ? maxHeight / thickness : 0,
    minRibDistanceMm: threeToMm(minDist),
    ribLines: lines,
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

// ------------------------------------------------------- campo de direccion

/**
 * Direccion (unitaria, en XZ) que siguen las costillas en (x, z).
 *
 * Una costilla es un EJE: 0 y 180 grados son la misma costilla. Por eso las
 * direcciones se promedian en "angulo doble" (cos 2θ, sin 2θ): dos costillas
 * a 10° y 190° suman en vez de anularse. Se mezclan:
 *   - la direccion base del panel (`ribAngleDeg`), con peso 1 - (influencia
 *     maxima de un atractor), para que lejos de todo mande la base y cerca de
 *     un atractor mande el atractor;
 *   - por atractor, con peso = su envolvente * `flowStrength`: el angulo
 *     propio de un punto (`angleDeg`), o la direccion de una curva en su
 *     punto mas cercano: perpendicular a la tangente (`curveRibs` 'across',
 *     las costillas cruzan la curva) o la tangente misma ('along', corren a
 *     lo largo de ella).
 */
export function flowDirection(
  x: number,
  z: number,
  attractors: readonly Attractor[],
  params: Pick<WaveFieldParams, 'ribAngleDeg' | 'flowStrength' | 'curveRibs'>,
): Vec2 {
  const flow = clamp(params.flowStrength, 0, 1)
  const base = params.ribAngleDeg * DEG2RAD
  let ax = 0
  let az = 0
  let maxEnv = 0
  if (flow > 0) {
    for (const a of attractors) {
      let d: number
      let theta: number
      if (a.kind === 'point') {
        d = Math.hypot(x - a.position.x, z - a.position.z)
        theta = a.angleDeg * DEG2RAD
      } else {
        const f = curveFrame2D(x, z, a)
        d = f.d
        theta = Math.atan2(f.tz, f.tx) + (params.curveRibs === 'along' ? 0 : Math.PI / 2)
      }
      const env =
        falloff(a.falloff, d, a.radius) * Math.min(1, Math.abs(a.strength)) * flow
      if (env <= 0) continue
      ax += env * Math.cos(2 * theta)
      az += env * Math.sin(2 * theta)
      if (env > maxEnv) maxEnv = env
    }
  }
  const wb = Math.max(BASE_FLOW_FLOOR, 1 - maxEnv)
  const vx = wb * Math.cos(2 * base) + ax
  const vz = wb * Math.sin(2 * base) + az
  const theta = Math.hypot(vx, vz) < 1e-9 ? base : Math.atan2(vz, vx) / 2
  return [Math.cos(theta), Math.sin(theta)]
}

/**
 * Lineas de flujo equiespaciadas (Jobard & Lefer, 1997) del campo `dirAt`:
 * se traza una linea desde el centro; de cada linea aceptada salen semillas
 * a `dsep` a cada lado; una semilla solo se usa si esta a >= `dsep` de todas
 * las lineas existentes; cada linea se integra (RK2) en ambos sentidos hasta
 * salir del dominio o acercarse a otra (o a si misma, si da la vuelta) a
 * menos de `dtest`. Al agotarse las semillas se barre una grilla para cubrir
 * zonas sueltas (islas, el otro lado de un agujero).
 *
 * Con un campo uniforme el resultado son rectas paralelas a `dsep` — el
 * peine de siempre.
 */
function traceRibLines(
  domain: Domain,
  dirAt: (x: number, z: number) => Vec2,
  dsep: number,
  dtest: number,
  step: number,
): Vec2[][] {
  const cell = dsep
  const grid = new Map<string, { line: number; x: number; z: number }[]>()
  const keyOf = (x: number, z: number) =>
    `${Math.floor(x / cell)},${Math.floor(z / cell)}`
  const lines: Vec2[][] = []
  let totalPoints = 0
  const maxTotalPoints = MAX_RIBS * 600
  // descarta migajas, pero sin exigir mas largo del que entra en el panel
  const minLength = Math.min(
    MIN_RIB_LENGTH_SEPS * dsep,
    0.5 * Math.min(domain.maxX - domain.minX, domain.maxZ - domain.minZ),
  )

  const inside = (x: number, z: number) =>
    x >= domain.minX &&
    x <= domain.maxX &&
    z >= domain.minZ &&
    z <= domain.maxZ &&
    domain.test(x, z)

  /** Algun punto de OTRA linea (o de cualquiera, si `self` es -1) a menos de `r`. */
  const nearOthers = (x: number, z: number, r: number): boolean => {
    const cx = Math.floor(x / cell)
    const cz = Math.floor(z / cell)
    const reach = Math.ceil(r / cell)
    for (let i = cx - reach; i <= cx + reach; i++) {
      for (let j = cz - reach; j <= cz + reach; j++) {
        const bucket = grid.get(`${i},${j}`)
        if (!bucket) continue
        for (const p of bucket) if (Math.hypot(p.x - x, p.z - z) < r) return true
      }
    }
    return false
  }

  // vecindad de la linea en curso: puntos ya trazados con su orden a lo largo
  // de la linea, para detectar que da la vuelta sobre si misma.
  const selfReach = Math.ceil((2 * dtest) / step) + 2
  const integrate = (
    x0: number,
    z0: number,
    sign: 1 | -1,
    own: { x: number; z: number; order: number }[],
  ): Vec2[] => {
    const out: Vec2[] = []
    const d0 = dirAt(x0, z0)
    let px = d0[0] * sign
    let pz = d0[1] * sign
    let x = x0
    let z = z0
    for (let n = 1; n <= MAX_STEPS; n++) {
      // RK2 (punto medio), manteniendo el sentido del paso anterior: el campo
      // es un eje y su signo es arbitrario.
      let [d1x, d1z] = dirAt(x, z)
      if (d1x * px + d1z * pz < 0) [d1x, d1z] = [-d1x, -d1z]
      const mx = x + (d1x * step) / 2
      const mz = z + (d1z * step) / 2
      let [d2x, d2z] = dirAt(mx, mz)
      if (d2x * d1x + d2z * d1z < 0) [d2x, d2z] = [-d2x, -d2z]
      const nx = x + d2x * step
      const nz = z + d2z * step
      if (!inside(nx, nz) || nearOthers(nx, nz, dtest)) break
      const order = sign * n
      if (
        own.some(
          (p) =>
            Math.abs(p.order - order) > selfReach &&
            Math.hypot(p.x - nx, p.z - nz) < dtest,
        )
      )
        break
      own.push({ x: nx, z: nz, order })
      out.push([nx, nz])
      x = nx
      z = nz
      px = d2x
      pz = d2z
    }
    return out
  }

  const tryLine = (sx: number, sz: number): Vec2[] | null => {
    if (!inside(sx, sz) || nearOthers(sx, sz, dsep * 0.99)) return null
    const own = [{ x: sx, z: sz, order: 0 }]
    const back = integrate(sx, sz, -1, own)
    const fwd = integrate(sx, sz, 1, own)
    const line: Vec2[] = [...back.reverse(), [sx, sz], ...fwd]
    if ((line.length - 1) * step < minLength) return null
    const id = lines.length
    lines.push(line)
    totalPoints += line.length
    for (const [x, z] of line) {
      const k = keyOf(x, z)
      const bucket = grid.get(k)
      if (bucket) bucket.push({ line: id, x, z })
      else grid.set(k, [{ line: id, x, z }])
    }
    return line
  }

  const full = () => lines.length >= MAX_RIBS || totalPoints >= maxTotalPoints

  // semillas a `dsep` a cada lado de una linea aceptada, cada ~media separacion
  const seedEvery = Math.max(1, Math.round(dsep / step / 2))
  const grow = (first: Vec2[]) => {
    const queue = [first]
    while (queue.length && !full()) {
      const line = queue.shift()!
      for (let i = 0; i < line.length && !full(); i += seedEvery) {
        const a = line[Math.max(0, i - 1)]
        const b = line[Math.min(line.length - 1, i + 1)]
        const len = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (len < 1e-12) continue
        const nx = -(b[1] - a[1]) / len
        const nz = (b[0] - a[0]) / len
        for (const s of [1, -1]) {
          const next = tryLine(line[i][0] + s * nx * dsep, line[i][1] + s * nz * dsep)
          if (next) queue.push(next)
        }
      }
    }
  }

  const cx = (domain.minX + domain.maxX) / 2
  const cz = (domain.minZ + domain.maxZ) / 2
  const first = tryLine(cx, cz)
  if (first) grow(first)
  // cobertura: zonas a las que no llego ninguna semilla
  for (let z = domain.minZ + dsep / 2; z <= domain.maxZ && !full(); z += dsep) {
    for (let x = domain.minX + dsep / 2; x <= domain.maxX && !full(); x += dsep) {
      const line = tryLine(x, z)
      if (line) grow(line)
    }
  }
  return lines
}

// ------------------------------------------------------------------- altura

/**
 * Ondulacion combinada de todos los atractores en (x, z), normalizada a
 * [0, 1]. 0 = sin influencia en ese punto (costilla en su altura piso), 1 =
 * cresta maxima. La envolvente decae con la distancia al atractor (radial
 * para un punto, a la curva para una curva); la FASE de la onda depende de
 * su `waveMode`:
 *   - 'concentric': la distancia misma -> circulos alrededor de un punto,
 *     crestas paralelas a una curva (la onda se aleja del atractor).
 *   - 'directional': un punto proyecta sobre su direccion (`angleDeg`) ->
 *     crestas rectas y paralelas, cruzadas a esa direccion; una curva usa el
 *     largo recorrido sobre ella -> la onda viaja a lo largo del trazo.
 */
export function rippleHeight(
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
    let d: number
    let phase: number
    if (a.kind === 'point') {
      const dx = x - a.position.x
      const dz = z - a.position.z
      d = Math.hypot(dx, dz)
      const ang = a.angleDeg * DEG2RAD
      phase = a.waveMode === 'directional' ? dx * Math.cos(ang) + dz * Math.sin(ang) : d
    } else {
      const f = curveFrame2D(x, z, a)
      d = f.d
      phase = a.waveMode === 'directional' ? f.s : d
    }
    const envelope = falloff(a.falloff, d, a.radius) * strength
    if (envelope <= 0) continue
    const wave = 0.5 + 0.5 * Math.sin((2 * Math.PI * phase) / wavelength)
    const contribution = envelope * wave
    acc = combine === 'sum' ? acc + contribution : Math.max(acc, contribution)
  }
  return clamp(acc, 0, 1)
}

/**
 * Altura en cada punto de la linea: se evalua `heightAt` en estaciones cada
 * ~`stationStep` de largo recorrido (incluidos los extremos) y se interpola
 * linealmente entre ellas — la cresta queda facetada aunque la linea en
 * planta tenga muchos mas puntos.
 */
function profileHeights(
  line: readonly Vec2[],
  heightAt: (x: number, z: number) => number,
  stationStep: number,
): number[] {
  const acc = [0]
  for (let i = 1; i < line.length; i++) {
    acc.push(
      acc[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]),
    )
  }
  const total = acc[acc.length - 1]
  const n = Math.max(1, Math.round(total / stationStep))
  const at = (s: number): Vec2 => {
    let i = 1
    while (i < acc.length - 1 && acc[i] < s) i++
    const seg = acc[i] - acc[i - 1]
    const t = seg > 1e-12 ? clamp((s - acc[i - 1]) / seg, 0, 1) : 0
    return [
      line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t,
      line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t,
    ]
  }
  const stations: number[] = []
  for (let k = 0; k <= n; k++) {
    const [x, z] = at((k / n) * total)
    stations.push(heightAt(x, z))
  }
  return acc.map((s) => {
    const u = total > 0 ? (s / total) * n : 0
    const k = Math.min(n - 1, Math.floor(u))
    return stations[k] + (stations[k + 1] - stations[k]) * (u - k)
  })
}

/**
 * Solido cerrado de UNA costilla (o UN tramo) que sigue la polilinea `pts`
 * en planta: pie plano en y = 0 (lo que se apoya contra la tela), perfil
 * superior `hs[j]`, espesor constante `thickness` repartido a ambos lados del
 * eje (desplazamiento en inglete, con tope para que una curva cerrada no
 * dispare el vertice), y tapas en los dos extremos. Cada costilla es su
 * propia malla, asi cada pieza es manifold por separado.
 */
function ribPolylineGeometry(
  pts: readonly Vec2[],
  hs: readonly number[],
  thickness: number,
): THREE.BufferGeometry {
  const half = thickness / 2
  const n = pts.length

  // normal izquierda de cada tramo (para una costilla en +Z, apunta a -X:
  // la misma cara "frontal" de siempre, asi el winding no cambia)
  const segN: Vec2[] = []
  for (let j = 0; j < n - 1; j++) {
    const dx = pts[j + 1][0] - pts[j][0]
    const dz = pts[j + 1][1] - pts[j][1]
    const len = Math.hypot(dx, dz) || 1
    segN.push([-dz / len, dx / len])
  }
  const offsetAt = (j: number): Vec2 => {
    const a = segN[Math.max(0, j - 1)]
    const b = segN[Math.min(n - 2, j)]
    // inglete: |(a+b)/2| = cos(medio angulo); desplazar half/cos, con tope 2*half
    const mx = (a[0] + b[0]) / 2
    const mz = (a[1] + b[1]) / 2
    const scale = half / Math.max(mx * mx + mz * mz, 0.25)
    return [mx * scale, mz * scale]
  }

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
    const [ox, oz] = offsetAt(j)
    const [x, z] = pts[j]
    const h = hs[j]
    frontBottom.push(push(x + ox, 0, z + oz))
    frontTop.push(push(x + ox, h, z + oz))
    backBottom.push(push(x - ox, 0, z - oz))
    backTop.push(push(x - ox, h, z - oz))
  }

  const indices: number[] = []
  const quad = (a: number, b: number, c: number, d: number) => {
    indices.push(a, b, c, a, c, d)
  }

  for (let j = 0; j < n - 1; j++) {
    // cara frontal (lado izquierdo del avance)
    quad(frontBottom[j], frontBottom[j + 1], frontTop[j + 1], frontTop[j])
    // cara trasera
    quad(backTop[j], backTop[j + 1], backBottom[j + 1], backBottom[j])
    // filo superior (perfil de la onda)
    quad(frontTop[j], frontTop[j + 1], backTop[j + 1], backTop[j])
    // pie (y = 0, apoya contra la tela)
    quad(frontBottom[j + 1], frontBottom[j], backBottom[j], backBottom[j + 1])
  }

  // tapas de los extremos
  quad(frontTop[0], backTop[0], backBottom[0], frontBottom[0])
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

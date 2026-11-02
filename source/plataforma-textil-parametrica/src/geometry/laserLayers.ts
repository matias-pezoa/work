/**
 * Corte laser — capas concentricas (como curvas de nivel). Cada capa es una
 * PIEZA independiente: la capa 0 es la pieza entera y cada una de las
 * siguientes es mas chica y queda dentro de la anterior. Apiladas, sus
 * bordes dibujan las curvas de nivel (la referencia: los vestidos de capas
 * de Iris van Herpen).
 *
 * Union de las capas:
 *   - center  todas comparten un centro: cada capa es una forma estrellada
 *             alrededor de el (rayos desde el centro hasta el contorno), y un
 *             agujero central comun sirve para remachar o coser el paquete.
 *   - edge    todas comparten una arista de la pieza (como hojas de un
 *             cuaderno): la capa va desde esa arista hacia adentro, y una
 *             fila de agujeros comunes a lo largo de ella las une.
 *
 * La forma de cada capa sale de una fraccion del contorno (de 1 a
 * `innerScale`) modulada por lobulos senoidales que giran de capa en capa
 * (`twistDeg`) y por el campo de atractores (`fieldPull`: el campo empuja la
 * capa hacia afuera o, si es negativo, hacia adentro).
 *
 * Fabricable por construccion: entre una capa y la siguiente siempre queda
 * al menos `minStepMm` de banda visible (salvo donde ambas tocan el piso),
 * y ninguna capa se achica por debajo del piso que necesitan los agujeros de
 * union (radio + puente). Funcion pura.
 */
import { clamp } from '../utils/params'
import { pointInPolygon, polygonArea, polygonBounds, type Vec2 } from './polygon'

export type LayerJoin = 'center' | 'edge'

export const LAYER_JOIN_LABELS: Record<LayerJoin, string> = {
  center: 'Desde el centro',
  edge: 'Desde una arista',
}

export type LayerEdge = 'top' | 'bottom' | 'left' | 'right'

export const LAYER_EDGE_LABELS: Record<LayerEdge, string> = {
  top: 'Arriba',
  bottom: 'Abajo',
  left: 'Izquierda',
  right: 'Derecha',
}

export interface LayerOptions {
  count: number
  join: LayerJoin
  edge: LayerEdge
  innerScale: number
  minStepMm: number
  waveAmp: number
  waveLobes: number
  twistDeg: number
  fieldPull: number
  /** Solo arista: cuanto se acorta la arista compartida en cada capa (0..1). */
  edgeTaper: number
  /** Radio de los agujeros de union (0 = sin agujeros). */
  holeRadiusMm: number
  /** Solo arista: cantidad de agujeros a lo largo de la arista. */
  edgeHoles: number
  /** Solo arista: distancia de los agujeros a la arista compartida. */
  holeInsetMm: number
  /** Material minimo alrededor de un agujero. */
  bridgeMm: number
  /** Centro de union (modo centro). */
  center: Vec2
}

export interface Layer {
  /** 0 = la pieza entera (la mas grande). */
  index: number
  outline: Vec2[]
  /** Agujeros de union: los mismos en todas las capas. */
  holes: Vec2[][]
  /** Donde rotular la capa en la vista (en la banda entre esta y la siguiente). */
  labelAt: Vec2
}

const RAYS = 180
const HOLE_SIDES = 24
const MIN_LAYER_MM = 2

function circle(c: Vec2, r: number): Vec2[] {
  return Array.from({ length: HOLE_SIDES }, (_, k): Vec2 => {
    const a = (2 * Math.PI * k) / HOLE_SIDES
    return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]
  })
}

/** Parametros t >= 0 donde el rayo `o + t*d` cruza el poligono, ordenados. */
function rayHits(o: Vec2, d: Vec2, poly: readonly Vec2[]): number[] {
  const out: number[] = []
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j]
    const [bx, bz] = poly[i]
    const ex = bx - ax
    const ez = bz - az
    const den = d[0] * ez - d[1] * ex
    if (Math.abs(den) < 1e-12) continue
    const t = ((ax - o[0]) * ez - (az - o[1]) * ex) / den
    const s = ((ax - o[0]) * d[1] - (az - o[1]) * d[0]) / den
    if (t >= -1e-9 && s >= 0 && s < 1) out.push(Math.max(0, t))
  }
  return out.sort((a, b) => a - b)
}

/**
 * Recorte suave a [0, 1): cerca del contorno la capa se acerca al borde sin
 * pegarse. Un recorte duro dejaba tramos planos contra el contorno y el
 * anidado (banda minima) los volvia dientes de sierra.
 */
function saturate(f: number): number {
  const knee = 0.8
  if (f <= 0) return 0
  if (f <= knee) return f
  return knee + (1 - knee) * Math.tanh((f - knee) / (1 - knee))
}

/** Fraccion nominal (sin piso ni anidado) de la capa k en el parametro de forma `phase`. */
function nominalFraction(k: number, phase: number, o: LayerOptions): number {
  const n = Math.max(2, Math.round(o.count))
  const level = 1 - (k / (n - 1)) * (1 - clamp(o.innerScale, 0.02, 0.98))
  const lobes = Math.round(o.waveLobes)
  const twist = (o.twistDeg * Math.PI) / 180
  return level * (1 + o.waveAmp * Math.sin(lobes * phase + k * twist))
}

/**
 * Genera las capas. `field(x, z)` devuelve el valor del campo (0..1) en un
 * punto de la pieza. Devuelve tambien cuantas capas no entraron.
 */
export function buildLayers(
  outer: readonly Vec2[],
  field: (x: number, z: number) => number,
  o: LayerOptions,
): { layers: Layer[]; skipped: number } {
  return o.join === 'edge' ? edgeLayers(outer, field, o) : centerLayers(outer, field, o)
}

function centerLayers(
  outer: readonly Vec2[],
  field: (x: number, z: number) => number,
  o: LayerOptions,
): { layers: Layer[]; skipped: number } {
  const n = Math.max(2, Math.round(o.count))
  let c = o.center
  if (!pointInPolygon(c[0], c[1], outer)) {
    const b = polygonBounds(outer)
    c = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2]
  }
  const dirs: Vec2[] = Array.from({ length: RAYS }, (_, k) => {
    const a = (2 * Math.PI * k) / RAYS
    return [Math.cos(a), Math.sin(a)]
  })
  // radio del contorno en cada rayo: el primer cruce (forma estrellada desde el centro).
  const R = dirs.map((d) => rayHits(c, d, outer)[0] ?? 0)
  const hole = o.holeRadiusMm > 0 ? o.holeRadiusMm : 0
  const floor = Math.max(MIN_LAYER_MM, hole > 0 ? hole + o.bridgeMm : 0)
  const holes = hole > 0 ? [circle(c, hole)] : []

  const layers: Layer[] = []
  let prev = R
  let skipped = 0
  for (let k = 0; k < n; k++) {
    const r =
      k === 0
        ? R
        : R.map((Rk, i) => {
            const phase = (2 * Math.PI * i) / RAYS
            const base = nominalFraction(k, phase, o)
            const p: Vec2 = [c[0] + dirs[i][0] * Rk * base, c[1] + dirs[i][1] * Rk * base]
            const f = saturate(base * (1 + o.fieldPull * field(p[0], p[1])))
            return Math.max(floor, Math.min(Rk * f, prev[i] - o.minStepMm))
          })
    // una capa que quedo entera en el piso ya no aporta una curva nueva.
    if (k > 0 && r.every((v, i) => v <= floor + 1e-6 || v >= prev[i] - 1e-6)) {
      skipped += n - k
      break
    }
    const outline = r.map((v, i): Vec2 => [c[0] + dirs[i][0] * v, c[1] + dirs[i][1] * v])
    if (polygonArea(outline) < 1) {
      skipped += n - k
      break
    }
    // rotulo: en el rayo de arriba, a mitad de la banda hasta la capa siguiente.
    const top = Math.round((RAYS * 3) / 4)
    const inner = k < n - 1 ? r[top] - o.minStepMm : floor
    const lr = (r[top] + Math.max(inner, floor)) / 2
    layers.push({
      index: k,
      outline,
      holes,
      labelAt: [c[0] + dirs[top][0] * lr, c[1] + dirs[top][1] * lr],
    })
    prev = r
  }
  return { layers, skipped }
}

interface EdgeFrame {
  origin: Vec2
  u: Vec2
  v: Vec2
  length: number
}

function edgeFrame(outer: readonly Vec2[], edge: LayerEdge): EdgeFrame {
  const b = polygonBounds(outer)
  const w = b.maxX - b.minX
  const h = b.maxZ - b.minZ
  // el origen queda un poco afuera de la caja: el rayo entra al contorno.
  const pad = 1
  switch (edge) {
    case 'bottom':
      return { origin: [b.minX, b.maxZ + pad], u: [1, 0], v: [0, -1], length: w }
    case 'left':
      return { origin: [b.minX - pad, b.minZ], u: [0, 1], v: [1, 0], length: h }
    case 'right':
      return { origin: [b.maxX + pad, b.minZ], u: [0, 1], v: [-1, 0], length: h }
    default:
      return { origin: [b.minX, b.minZ - pad], u: [1, 0], v: [0, 1], length: w }
  }
}

function edgeLayers(
  outer: readonly Vec2[],
  field: (x: number, z: number) => number,
  o: LayerOptions,
): { layers: Layer[]; skipped: number } {
  const n = Math.max(2, Math.round(o.count))
  const fr = edgeFrame(outer, o.edge)
  const at = (u: number, t: number): Vec2 => [
    fr.origin[0] + fr.u[0] * u + fr.v[0] * t,
    fr.origin[1] + fr.u[1] * u + fr.v[1] * t,
  ]
  // muestras a lo largo de la arista: donde el rayo entra (a) y sale (b) del contorno.
  const samples: { u: number; a: number; b: number }[] = []
  for (let i = 0; i <= RAYS; i++) {
    const u = fr.length * (0.002 + (0.996 * i) / RAYS)
    const hits = rayHits(at(u, 0), fr.v, outer)
    samples.push(hits.length >= 2 ? { u, a: hits[0], b: hits[1] } : { u, a: 0, b: 0 })
  }
  // tramo continuo mas largo con contorno (una base concava puede cortar el tramo).
  let best: [number, number] = [0, -1]
  for (let i = 0; i < samples.length;) {
    if (samples[i].b - samples[i].a <= 0) {
      i++
      continue
    }
    let j = i
    while (j + 1 < samples.length && samples[j + 1].b - samples[j + 1].a > 0) j++
    if (j - i > best[1] - best[0]) best = [i, j]
    i = j + 1
  }
  const run = samples.slice(best[0], best[1] + 1)
  if (run.length < 3) return { layers: [], skipped: n }

  const hole = o.holeRadiusMm > 0 ? o.holeRadiusMm : 0
  const inset = Math.max(o.holeInsetMm, hole + o.bridgeMm)
  const floor = Math.max(MIN_LAYER_MM, hole > 0 ? inset + hole + o.bridgeMm : 0)
  const taper = clamp(o.edgeTaper, 0, 0.9)
  const span = (k: number): [number, number] => {
    // la capa k usa la fraccion central (1 - taper * k/(n-1)) de la arista.
    const keep = 1 - (taper * k) / (n - 1)
    const drop = Math.floor(((run.length - 1) * (1 - keep)) / 2)
    return [drop, run.length - 1 - drop]
  }

  // agujeros: dentro del tramo de la capa mas chica, a `inset` de la arista.
  const holes: Vec2[][] = []
  const count = hole > 0 ? Math.max(0, Math.round(o.edgeHoles)) : 0
  if (count > 0) {
    const [s0, s1] = span(n - 1)
    const u0 = run[s0].u + inset
    const u1 = run[s1].u - inset
    // si la capa mas chica no da para la fila, un solo agujero al medio.
    const us =
      u1 < u0 || count === 1
        ? [(run[s0].u + run[s1].u) / 2]
        : Array.from({ length: count }, (_, h) => u0 + ((u1 - u0) * h) / (count - 1))
    for (const u of us) {
      const idx = run.reduce(
        (bi, s, si) => (Math.abs(s.u - u) < Math.abs(run[bi].u - u) ? si : bi),
        0,
      )
      holes.push(circle(at(u, run[idx].a + inset), hole))
    }
  }

  const layers: Layer[] = []
  let prev = run.map((s) => s.b - s.a)
  let skipped = 0
  for (let k = 0; k < n; k++) {
    const d =
      k === 0
        ? prev
        : run.map((s, i) => {
            const full = s.b - s.a
            const phase = (2 * Math.PI * s.u) / fr.length
            const base = nominalFraction(k, phase, o)
            const p = at(s.u, s.a + full * base)
            const f = saturate(base * (1 + o.fieldPull * field(p[0], p[1])))
            return Math.min(
              full,
              Math.max(floor, Math.min(full * f, prev[i] - o.minStepMm)),
            )
          })
    const [s0, s1] = k === 0 ? [0, run.length - 1] : span(k)
    if (k > 0 && d.every((v, i) => v <= floor + 1e-6 || v >= prev[i] - 1e-6)) {
      skipped += n - k
      break
    }
    const outline: Vec2[] = []
    for (let i = s0; i <= s1; i++) outline.push(at(run[i].u, run[i].a))
    for (let i = s1; i >= s0; i--) outline.push(at(run[i].u, run[i].a + d[i]))
    const mid = Math.round((s0 + s1) / 2)
    const inner = Math.max(k < n - 1 ? d[mid] - o.minStepMm : floor, floor)
    layers.push({
      index: k,
      outline,
      holes,
      labelAt: at(run[mid].u, run[mid].a + (d[mid] + inner) / 2),
    })
    prev = d
  }
  return { layers, skipped }
}

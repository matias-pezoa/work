/**
 * Importador de DXF (ASCII) -> contorno para la base personalizada.
 *
 * Lee las entidades 2D que usan el CAD y el software de patronaje para
 * dibujar una pieza: LWPOLYLINE y POLYLINE (con arcos por `bulge`), LINE,
 * ARC, CIRCLE, ELLIPSE y SPLINE, tambien dentro de bloques (INSERT, como en
 * los DXF AAMA/ASTM de patronaje, que guardan cada pieza en un bloque). Los
 * tramos sueltos (LINE + ARC) se unen por sus extremos en lazos cerrados.
 *
 * DXF ya tiene Y hacia arriba como el plano de la app: no se invierte.
 * Entidades en el espacio papel (codigo 67 = 1) se ignoran.
 */
import type { Vec2 } from '../geometry/polygon'
import {
  closedLoops,
  joinTolerance,
  loopsToBoundary,
  widthInMm,
  type ImportedBoundary,
  type ImportedPolyline,
} from './importBoundary'

/** Paso angular al muestrear arcos y circulos. */
const ARC_STEP = (3 * Math.PI) / 180
/** Muestras por tramo de control al evaluar un SPLINE. */
const SPLINE_SAMPLES_PER_SPAN = 12
/** Bloques dentro de bloques: corta referencias circulares. */
const MAX_INSERT_DEPTH = 8

/** mm por unidad segun `$INSUNITS`. 0 (sin unidad) o desconocida -> sin ancho real. */
const INSUNITS_MM: Record<number, number> = {
  1: 25.4, // pulgadas
  2: 304.8, // pies
  4: 1, // mm
  5: 10, // cm
  6: 1000, // m
}

export async function importDxfFile(file: File): Promise<ImportedBoundary> {
  return parseDxfToBoundary(await file.text())
}

export function parseDxfToBoundary(text: string): ImportedBoundary {
  const dxf = parseDxf(text)
  const polylines = dxf.entities.flatMap((e) => entityPolylines(e, dxf.blocks, IDENTITY, 0))
  const boundary = loopsToBoundary(closedLoops(polylines, joinTolerance(polylines)), 'DXF')
  const widthMm = widthInMm(boundary.outer, dxf.insUnits ? INSUNITS_MM[dxf.insUnits] : undefined)
  return widthMm ? { ...boundary, widthMm } : boundary
}

// ------------------------------------------------------------ lectura

type Pair = [code: number, value: string]

interface Entity {
  type: string
  pairs: Pair[]
  /** VERTEX de un POLYLINE. */
  vertices: Entity[]
}

interface Block {
  base: Vec2
  entities: Entity[]
}

interface Dxf {
  insUnits: number | undefined
  entities: Entity[]
  blocks: Map<string, Block>
}

function readPairs(text: string): Pair[] {
  if (text.startsWith('AutoCAD Binary DXF'))
    throw new Error('DXF binario no soportado: exportalo como DXF ASCII (texto).')
  const lines = text.split(/\r\n|\r|\n/)
  const pairs: Pair[] = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10)
    if (Number.isNaN(code)) throw new Error('El archivo no es un DXF valido.')
    pairs.push([code, lines[i + 1].trim()])
  }
  return pairs
}

/** Agrupa los pares en registros que empiezan con un codigo 0. */
function readRecords(pairs: readonly Pair[]): Entity[] {
  const records: Entity[] = []
  for (const p of pairs) {
    if (p[0] === 0) records.push({ type: p[1].toUpperCase(), pairs: [], vertices: [] })
    else records[records.length - 1]?.pairs.push(p)
  }
  return records
}

function parseDxf(text: string): Dxf {
  const records = readRecords(readPairs(text))
  if (!records.some((r) => r.type === 'SECTION')) throw new Error('El archivo no es un DXF valido.')
  let insUnits: number | undefined
  const entities: Entity[] = []
  const blocks = new Map<string, Block>()

  let section = ''
  let block: Block | null = null
  let owner: Entity | null = null // POLYLINE / INSERT que espera su SEQEND
  for (const r of records) {
    if (r.type === 'SECTION') {
      section = str(r, 2).toUpperCase()
      if (section === 'HEADER') {
        const k = r.pairs.findIndex(([c, v]) => c === 9 && v.toUpperCase() === '$INSUNITS')
        const v = k >= 0 ? r.pairs[k + 1] : undefined
        if (v && v[0] === 70) insUnits = Number.parseInt(v[1], 10)
      }
      continue
    }
    if (r.type === 'ENDSEC') {
      section = ''
      continue
    }
    if (section !== 'ENTITIES' && section !== 'BLOCKS') continue

    if (r.type === 'BLOCK') {
      block = { base: [num(r, 10), num(r, 20)], entities: [] }
      blocks.set(str(r, 2), block)
      continue
    }
    if (r.type === 'ENDBLK') {
      block = null
      continue
    }
    if (r.type === 'VERTEX') {
      if (owner?.type === 'POLYLINE') owner.vertices.push(r)
      continue
    }
    if (r.type === 'SEQEND') {
      owner = null
      continue
    }
    if (owner?.type === 'INSERT' && r.type === 'ATTRIB') continue
    owner = null
    if (num(r, 67) === 1) continue // espacio papel
    if (section === 'BLOCKS' && !block) continue
    ;(block ? block.entities : entities).push(r)
    if (r.type === 'POLYLINE' || (r.type === 'INSERT' && num(r, 66) === 1)) owner = r
  }
  return { insUnits, entities, blocks }
}

function str(e: Entity, code: number): string {
  return e.pairs.find((p) => p[0] === code)?.[1] ?? ''
}

function num(e: Entity, code: number, fallback = 0): number {
  const p = e.pairs.find((q) => q[0] === code)
  const v = p ? Number.parseFloat(p[1]) : Number.NaN
  return Number.isFinite(v) ? v : fallback
}

function nums(e: Entity, code: number): number[] {
  return e.pairs.filter((p) => p[0] === code).map((p) => Number.parseFloat(p[1]))
}

// ------------------------------------------------------------ geometria

/** Afin 2D: x' = a x + c y + e, y' = b x + d y + f. */
type Mat = [a: number, b: number, c: number, d: number, e: number, f: number]

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]
/** OCS con extrusion (0, 0, -1), tipico de piezas espejadas en CAD: x -> -x. */
const MIRROR_X: Mat = [-1, 0, 0, 1, 0, 0]

function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

function apply(m: Mat, [x, y]: Vec2): Vec2 {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/** Las entidades con OCS (circulos, arcos, polilineas, bloques) se espejan si la extrusion apunta a -Z. */
function ocs(e: Entity, m: Mat): Mat {
  return num(e, 230, 1) < 0 ? mul(m, MIRROR_X) : m
}

function entityPolylines(
  e: Entity,
  blocks: ReadonlyMap<string, Block>,
  m: Mat,
  depth: number,
): ImportedPolyline[] {
  const out = (points: Vec2[], closed: boolean, mat: Mat): ImportedPolyline[] =>
    points.length >= 2 ? [{ points: points.map((p) => apply(mat, p)), closed }] : []

  switch (e.type) {
    case 'LINE':
      return out(
        [
          [num(e, 10), num(e, 20)],
          [num(e, 11), num(e, 21)],
        ],
        false,
        m,
      )
    case 'LWPOLYLINE': {
      const verts: { p: [number, number]; bulge: number }[] = []
      for (const [code, value] of e.pairs) {
        const v = Number.parseFloat(value)
        if (code === 10) verts.push({ p: [v, 0], bulge: 0 })
        else if (code === 20 && verts.length) verts[verts.length - 1].p[1] = v
        else if (code === 42 && verts.length) verts[verts.length - 1].bulge = v
      }
      const closed = (num(e, 70) & 1) === 1
      return out(bulgePolyline(verts, closed), closed, ocs(e, m))
    }
    case 'POLYLINE': {
      const flags = num(e, 70)
      if (flags & (16 | 64)) return [] // mallas 3D / policaras
      const verts = e.vertices
        .filter((v) => (num(v, 70) & 16) === 0) // sin puntos de control de spline
        .map((v) => ({ p: [num(v, 10), num(v, 20)] as Vec2, bulge: num(v, 42) }))
      const closed = (flags & 1) === 1
      return out(bulgePolyline(verts, closed), closed, ocs(e, m))
    }
    case 'CIRCLE': {
      const pts = arcPoints(num(e, 10), num(e, 20), num(e, 40), 0, 2 * Math.PI)
      return out(pts.slice(0, -1), true, ocs(e, m))
    }
    case 'ARC': {
      const a0 = (num(e, 50) * Math.PI) / 180
      let a1 = (num(e, 51) * Math.PI) / 180
      while (a1 <= a0) a1 += 2 * Math.PI
      return out(arcPoints(num(e, 10), num(e, 20), num(e, 40), a0, a1 - a0), false, ocs(e, m))
    }
    case 'ELLIPSE': {
      const [cx, cy] = [num(e, 10), num(e, 20)]
      const [mx, my] = [num(e, 11), num(e, 21)]
      const ratio = num(e, 40, 1)
      // eje menor = N x mayor * ratio (N = extrusion; -Z invierte el sentido).
      const s = num(e, 230, 1) < 0 ? -1 : 1
      const [nx, ny] = [-my * ratio * s, mx * ratio * s]
      const t0 = num(e, 41, 0)
      let t1 = num(e, 42, 2 * Math.PI)
      while (t1 <= t0) t1 += 2 * Math.PI
      const full = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-6
      const n = Math.max(8, Math.ceil((t1 - t0) / ARC_STEP))
      const pts = Array.from({ length: full ? n : n + 1 }, (_, k): Vec2 => {
        const t = t0 + ((t1 - t0) * k) / n
        return [cx + mx * Math.cos(t) + nx * Math.sin(t), cy + my * Math.cos(t) + ny * Math.sin(t)]
      })
      return out(pts, full, m)
    }
    case 'SPLINE': {
      const pts = splinePoints(e)
      return out(pts, (num(e, 70) & 1) === 1, m)
    }
    case 'INSERT': {
      const b = blocks.get(str(e, 2))
      if (!b || depth >= MAX_INSERT_DEPTH) return []
      const rot = (num(e, 50) * Math.PI) / 180
      const sx = num(e, 41, 1)
      const sy = num(e, 42, 1)
      const cos = Math.cos(rot)
      const sin = Math.sin(rot)
      // ins * R(rot) * S(sx, sy) * T(-base)
      const local: Mat = mul(
        [cos * sx, sin * sx, -sin * sy, cos * sy, num(e, 10), num(e, 20)],
        [1, 0, 0, 1, -b.base[0], -b.base[1]],
      )
      const mat = mul(ocs(e, m), local)
      return b.entities.flatMap((c) => entityPolylines(c, blocks, mat, depth + 1))
    }
    default:
      return []
  }
}

/** Arco de centro (cx, cy) desde `a0` barriendo `sweep` (con signo), incluidos ambos extremos. */
function arcPoints(cx: number, cy: number, r: number, a0: number, sweep: number): Vec2[] {
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / ARC_STEP))
  return Array.from({ length: n + 1 }, (_, k): Vec2 => {
    const a = a0 + (sweep * k) / n
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  })
}

/**
 * Vertices de una polilinea con `bulge` (tan(angulo/4) del arco que sale de
 * cada vertice; positivo = antihorario). Sin repetir el primero al cerrar.
 */
export function bulgePolyline(
  verts: readonly { p: Vec2; bulge: number }[],
  closed: boolean,
): Vec2[] {
  const out: Vec2[] = []
  const n = verts.length
  for (let i = 0; i < n; i++) {
    const { p, bulge } = verts[i]
    out.push(p)
    const next = i + 1 < n ? verts[i + 1].p : closed ? verts[0].p : null
    if (!next || Math.abs(bulge) < 1e-9) continue
    const [x1, y1] = p
    const [x2, y2] = next
    const c = Math.hypot(x2 - x1, y2 - y1)
    if (c < 1e-12) continue
    const theta = 4 * Math.atan(bulge)
    const r = c / (2 * Math.sin(theta / 2))
    const h = r * Math.cos(theta / 2)
    const cx = (x1 + x2) / 2 - ((y2 - y1) / c) * h
    const cy = (y1 + y2) / 2 + ((x2 - x1) / c) * h
    const arc = arcPoints(cx, cy, Math.abs(r), Math.atan2(y1 - cy, x1 - cx), theta)
    out.push(...arc.slice(1, -1))
  }
  return out
}

/** SPLINE (NURBS) por de Boor; sin nudos validos cae a los puntos de ajuste o de control. */
function splinePoints(e: Entity): Vec2[] {
  const deg = num(e, 71, 3)
  const knots = nums(e, 40)
  const weights = nums(e, 41)
  const cx = nums(e, 10)
  const cy = nums(e, 20)
  const ctrl = cx.map((x, k): Vec2 => [x, cy[k] ?? 0])
  const n = ctrl.length
  if (n === 0 || knots.length !== n + deg + 1) {
    const fx = nums(e, 11)
    const fy = nums(e, 21)
    return fx.length >= 2 ? fx.map((x, k): Vec2 => [x, fy[k] ?? 0]) : ctrl
  }
  const w = (k: number) => (weights.length === n ? weights[k] : 1)
  const t0 = knots[deg]
  const t1 = knots[n]
  const samples = Math.max(16, (n - deg) * SPLINE_SAMPLES_PER_SPAN)
  const pts: Vec2[] = []
  for (let s = 0; s <= samples; s++) {
    const t = t0 + ((t1 - t0) * s) / samples
    let k = deg
    while (k < n - 1 && t >= knots[k + 1]) k++
    const d = Array.from({ length: deg + 1 }, (_, j) => {
      const i = j + k - deg
      return [ctrl[i][0] * w(i), ctrl[i][1] * w(i), w(i)]
    })
    for (let r = 1; r <= deg; r++) {
      for (let j = deg; j >= r; j--) {
        const i = j + k - deg
        const denom = knots[i + deg - r + 1] - knots[i]
        const alpha = denom > 0 ? (t - knots[i]) / denom : 0
        for (let q = 0; q < 3; q++) d[j][q] = (1 - alpha) * d[j - 1][q] + alpha * d[j][q]
      }
    }
    const [x, y, ww] = d[deg]
    pts.push([x / ww, y / ww])
  }
  return pts
}

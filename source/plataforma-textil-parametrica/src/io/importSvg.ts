/**
 * Importador de SVG -> contorno (poligono + agujeros) para usar como base
 * personalizada (p. ej. una pieza de patron de moda) en los modos 3D.
 *
 * No se implementa matematica de curvas Bezier/arcos a mano: se apoya en las
 * APIs nativas del navegador (`getTotalLength` / `getPointAtLength`) para
 * muestrear CUALQUIER `<path>` (o `<polygon>`/`<polyline>`/`<rect>`/`<circle>`/
 * `<ellipse>`) como una polilinea, y en `getCTM()` para resolver transforms
 * anidados (`<g transform="...">`) sin parsearlos manualmente.
 *
 * El contorno con mayor area se toma como borde externo; el resto (si caen
 * dentro de ese borde) se tratan como agujeros (p. ej. pinzas).
 */
import { polygonArea, polygonBounds, type Vec2 } from '../geometry/polygon'

const SAMPLES_PER_SHAPE = 160
const SHAPE_SELECTOR = 'path, polygon, polyline, rect, circle, ellipse'

export interface ImportedBoundary {
  outer: Vec2[]
  holes: Vec2[][]
}

/** Lee un archivo .svg y devuelve su contorno (en las unidades del propio SVG). */
export async function importSvgFile(file: File): Promise<ImportedBoundary> {
  const text = await file.text()
  return parseSvgToBoundary(text)
}

/**
 * Monta el SVG oculto en el documento (getCTM()/getTotalLength() necesitan
 * que el elemento este "vivo" en un documento con layout), le pasa sus
 * formas a `fn` y lo desmonta al terminar.
 */
function withMountedShapes<T>(
  svgText: string,
  fn: (shapes: SVGGeometryElement[]) => T,
): T {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) throw new Error('El archivo no es un SVG valido.')
  const svgRoot = doc.documentElement as unknown as SVGSVGElement
  if (svgRoot.tagName.toLowerCase() !== 'svg') throw new Error('El archivo no es un SVG.')

  const host = document.createElement('div')
  host.style.position = 'absolute'
  host.style.left = '-99999px'
  host.style.top = '0'
  host.style.width = '1px'
  host.style.height = '1px'
  host.style.overflow = 'hidden'
  document.body.appendChild(host)

  try {
    const imported = document.importNode(svgRoot, true) as unknown as SVGSVGElement
    host.appendChild(imported as unknown as Node)
    return fn(
      Array.from(
        imported.querySelectorAll(SHAPE_SELECTOR),
      ) as unknown as SVGGeometryElement[],
    )
  } finally {
    document.body.removeChild(host)
  }
}

/** Trazo de un modulo importado, en la celda normalizada [-0.5, 0.5]^2. */
export interface ImportedStroke {
  points: Vec2[]
  closed: boolean
}

/**
 * SVG -> modulo de corte laser: TODAS las formas (abiertas o cerradas) como
 * polilineas, simplificadas y encajadas en la celda [-0.5, 0.5]^2 sin
 * deformar (el lado mayor ocupa la celda). Aca el eje Y del SVG se mantiene
 * (hacia abajo = +z), igual que en la vista 2D.
 */
export async function importSvgModule(file: File): Promise<ImportedStroke[]> {
  return parseSvgToModule(await file.text())
}

export function parseSvgToModule(svgText: string): ImportedStroke[] {
  const strokes = withMountedShapes(svgText, (shapes) =>
    shapes.flatMap((el): ImportedStroke[] => {
      const pts = sampleShape(el, true)
      if (!pts || pts.length < 2) return []
      const closed = isClosedShape(el, pts)
      return [{ points: closed ? pts.slice(0, -1) : pts, closed }]
    }),
  )
  if (strokes.length === 0) throw new Error('No se encontraron trazos en el SVG.')
  const b = polygonBounds(strokes.flatMap((s) => s.points))
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 1e-9)
  const cx = (b.minX + b.maxX) / 2
  const cz = (b.minZ + b.maxZ) / 2
  return strokes.map((s) => {
    const pts = simplify(
      s.points.map(([x, z]): Vec2 => [(x - cx) / size, (z - cz) / size]),
      0.002,
    )
    return { points: pts, closed: s.closed && pts.length >= 3 }
  })
}

function isClosedShape(el: SVGGeometryElement, pts: readonly Vec2[]): boolean {
  const tag = el.tagName.toLowerCase()
  if (tag === 'polygon' || tag === 'rect' || tag === 'circle' || tag === 'ellipse')
    return true
  if (tag === 'polyline') return false
  const a = pts[0]
  const b = pts[pts.length - 1]
  return (
    Math.hypot(a[0] - b[0], a[1] - b[1]) <
    1e-6 * Math.max(1, Math.abs(a[0]) + Math.abs(a[1]))
  )
}

/** Ramer-Douglas-Peucker: saca vertices colineales (una recta muestreada queda en 2 puntos). */
function simplify(points: readonly Vec2[], eps: number): Vec2[] {
  if (points.length < 3) return [...points]
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = keep[points.length - 1] = true
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()!
    const [ax, az] = points[i]
    const [bx, bz] = points[j]
    const len = Math.hypot(bx - ax, bz - az)
    let best = -1
    let idx = -1
    for (let k = i + 1; k < j; k++) {
      const [px, pz] = points[k]
      const d =
        len < 1e-12
          ? Math.hypot(px - ax, pz - az)
          : Math.abs((bx - ax) * (az - pz) - (ax - px) * (bz - az)) / len
      if (d > best) {
        best = d
        idx = k
      }
    }
    if (best > eps) {
      keep[idx] = true
      stack.push([i, idx], [idx, j])
    }
  }
  return points.filter((_, k) => keep[k])
}

/** Version testeable: recibe el texto del SVG directamente. */
export function parseSvgToBoundary(svgText: string): ImportedBoundary {
  return withMountedShapes(svgText, (shapes) => {
    const loops: Vec2[][] = []
    for (const shape of shapes) {
      const loop = sampleShape(shape)
      if (loop && loop.length >= 3) loops.push(loop)
    }

    if (loops.length === 0) {
      throw new Error(
        'No se encontraron formas cerradas (path/polygon/rect/circle/...) en el SVG.',
      )
    }

    // el de mayor area es el borde externo; el resto (si caen dentro de su
    // caja) son agujeros.
    loops.sort((a, b) => polygonArea(b) - polygonArea(a))
    const outer = loops[0]
    const outerBounds = polygonBounds(outer)
    const holes = loops.slice(1).filter((h) => isRoughlyInside(h, outerBounds))

    return { outer: flipY(outer), holes: holes.map(flipY) }
  })
}

/** @param includeEnd agrega el punto final (para trazos abiertos). */
function sampleShape(el: SVGGeometryElement, includeEnd = false): Vec2[] | null {
  let ctm: DOMMatrix | null = null
  try {
    ctm = (el as unknown as SVGGraphicsElement).getCTM()
  } catch {
    ctm = null
  }

  let length = 0
  try {
    length = el.getTotalLength()
  } catch {
    length = 0
  }
  if (!Number.isFinite(length) || length <= 0) return null

  const points: Vec2[] = []
  for (let i = 0; i < SAMPLES_PER_SHAPE + (includeEnd ? 1 : 0); i++) {
    const dist = (i / SAMPLES_PER_SHAPE) * length
    const p = el.getPointAtLength(dist)
    const transformed = ctm ? new DOMPoint(p.x, p.y).matrixTransform(ctm) : p
    points.push([transformed.x, transformed.y])
  }
  return points
}

function isRoughlyInside(
  points: readonly Vec2[],
  outerBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  const b = polygonBounds(points)
  return (
    b.minX >= outerBounds.minX - 1e-6 &&
    b.maxX <= outerBounds.maxX + 1e-6 &&
    b.minZ >= outerBounds.minZ - 1e-6 &&
    b.maxZ <= outerBounds.maxZ + 1e-6
  )
}

/** SVG crece en Y hacia abajo; se invierte para que "arriba en el papel" sea +Z. */
function flipY(points: readonly Vec2[]): Vec2[] {
  return points.map(([x, y]) => [x, -y] as Vec2)
}

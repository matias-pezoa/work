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

/** Version testeable: recibe el texto del SVG directamente. */
export function parseSvgToBoundary(svgText: string): ImportedBoundary {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) throw new Error('El archivo no es un SVG valido.')
  const svgRoot = doc.documentElement as unknown as SVGSVGElement
  if (svgRoot.tagName.toLowerCase() !== 'svg') throw new Error('El archivo no es un SVG.')

  // getCTM()/getTotalLength() necesitan que el elemento este "vivo" en un
  // documento con layout; se monta oculto y se desmonta al terminar.
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

    const shapes = Array.from(
      imported.querySelectorAll(SHAPE_SELECTOR),
    ) as unknown as SVGGeometryElement[]

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
  } finally {
    document.body.removeChild(host)
  }
}

function sampleShape(el: SVGGeometryElement): Vec2[] | null {
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
  for (let i = 0; i < SAMPLES_PER_SHAPE; i++) {
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

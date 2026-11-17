/**
 * Importador de PDF vectorial -> contorno para la base personalizada.
 *
 * pdf.js (Mozilla) interpreta el PDF y entrega la lista de operaciones de
 * dibujo de la primera pagina; aca solo se recorren los trazos (`constructPath`)
 * con la matriz vigente (cm, q/Q, formularios XObject) y se muestrean las
 * curvas. pdf.js se carga recien al importar un PDF: no pesa en el arranque.
 *
 * Se ignoran los trazos de recorte (`W n`, p. ej. la mesa de trabajo de
 * Illustrator), el texto y las imagenes. Un PDF escaneado (solo imagen) no
 * tiene contornos: hay que vectorizarlo antes o exportarlo como PDF vectorial.
 *
 * PDF tiene Y hacia arriba (se invierte al final, `flipLoopsY`); unidades en puntos.
 */
import type { Vec2 } from '../geometry/polygon'
import {
  closedLoops,
  flipLoopsY,
  joinTolerance,
  loopsToPieces,
  type ImportedPolyline,
  type ImportedShapes,
} from './importBoundary'

/** mm por punto PDF. */
const MM_PER_PT = 25.4 / 72
/** Muestras por curva Bezier. */
const CURVE_SAMPLES = 16

export async function importPdfFile(file: File): Promise<ImportedShapes> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  let doc
  try {
    doc = await task.promise
  } catch {
    await task.destroy()
    throw new Error('El archivo no es un PDF valido (o esta protegido con contrasena).')
  }
  try {
    const page = await doc.getPage(1)
    const list = await page.getOperatorList()
    const polylines = pdfOperatorPolylines(list.fnArray, list.argsArray, pdfjs.OPS)
    const pieces = loopsToPieces(
      flipLoopsY(closedLoops(polylines, joinTolerance(polylines))),
      'PDF',
    )
    return { pieces, mmPerUnit: MM_PER_PT }
  } finally {
    // destruir la tarea libera el documento y el worker.
    await task.destroy()
  }
}

/** Codigos de `OPS` de pdf.js que se usan (se pasan desde afuera para testear sin pdf.js). */
export interface PdfOps {
  save: number
  restore: number
  transform: number
  paintFormXObjectBegin: number
  paintFormXObjectEnd: number
  constructPath: number
  endPath: number
  stroke: number
}

/** Comandos de `DrawOPS` dentro de los datos de un `constructPath` (pdf.js >= 5). */
const DRAW = {
  moveTo: 0,
  lineTo: 1,
  curveTo: 2,
  quadraticCurveTo: 3,
  closePath: 4,
} as const

type Mat = [number, number, number, number, number, number]

function mul(m: Mat, n: Mat): Mat {
  // PDF: [a b c d e f] aplicado como fila; n se aplica primero.
  return [
    n[0] * m[0] + n[1] * m[2],
    n[0] * m[1] + n[1] * m[3],
    n[2] * m[0] + n[3] * m[2],
    n[2] * m[1] + n[3] * m[3],
    n[4] * m[0] + n[5] * m[2] + m[4],
    n[4] * m[1] + n[5] * m[3] + m[5],
  ]
}

/**
 * Recorre la lista de operaciones de pdf.js y devuelve cada subtrazo como
 * polilinea en coordenadas de pagina. Un subtrazo relleno cuenta como
 * cerrado aunque no tenga `h` (el relleno lo cierra igual).
 */
export function pdfOperatorPolylines(
  fnArray: readonly number[],
  argsArray: readonly unknown[],
  ops: PdfOps,
): ImportedPolyline[] {
  const out: ImportedPolyline[] = []
  let ctm: Mat = [1, 0, 0, 1, 0, 0]
  const stack: Mat[] = []
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    const args = argsArray[i] as unknown[] | null
    if (fn === ops.save) stack.push(ctm)
    else if (fn === ops.restore) ctm = stack.pop() ?? ctm
    else if (fn === ops.transform) ctm = mul(ctm, args as unknown as Mat)
    else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm)
      const m = args?.[0] as Mat | null | undefined
      if (m && m.length === 6) ctm = mul(ctm, [...m] as Mat)
    } else if (fn === ops.paintFormXObjectEnd) ctm = stack.pop() ?? ctm
    else if (fn === ops.constructPath && args) {
      const paintOp = args[0] as number
      if (paintOp === ops.endPath) continue // solo recorte
      const data = (
        args[1] as ArrayLike<unknown> | undefined
      )?.[0] as ArrayLike<number> | null
      if (!data) continue
      const filled = paintOp !== ops.stroke
      out.push(...drawOpsPolylines(data, ctm, filled))
    }
  }
  return out
}

function drawOpsPolylines(
  data: ArrayLike<number>,
  m: Mat,
  filled: boolean,
): ImportedPolyline[] {
  const tf = (x: number, y: number): Vec2 => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  ]
  const out: ImportedPolyline[] = []
  let cur: Vec2[] = []
  let last: [number, number] = [0, 0]
  let start: [number, number] = [0, 0]
  const flush = (closed: boolean) => {
    if (cur.length >= 2) out.push({ points: cur, closed: closed || filled })
    cur = []
  }
  for (let i = 0; i < data.length;) {
    const op = data[i++]
    if (op === DRAW.moveTo) {
      flush(false)
      last = start = [data[i++], data[i++]]
      cur = [tf(...last)]
    } else if (op === DRAW.lineTo) {
      last = [data[i++], data[i++]]
      cur.push(tf(...last))
    } else if (op === DRAW.curveTo || op === DRAW.quadraticCurveTo) {
      const cubic = op === DRAW.curveTo
      const c = Array.from({ length: cubic ? 6 : 4 }, () => data[i++])
      const p0 = last
      for (let k = 1; k <= CURVE_SAMPLES; k++) {
        const t = k / CURVE_SAMPLES
        const u = 1 - t
        const [x, y] = cubic
          ? [
              u * u * u * p0[0] +
                3 * u * u * t * c[0] +
                3 * u * t * t * c[2] +
                t * t * t * c[4],
              u * u * u * p0[1] +
                3 * u * u * t * c[1] +
                3 * u * t * t * c[3] +
                t * t * t * c[5],
            ]
          : [
              u * u * p0[0] + 2 * u * t * c[0] + t * t * c[2],
              u * u * p0[1] + 2 * u * t * c[1] + t * t * c[3],
            ]
        cur.push(tf(x, y))
      }
      last = cubic ? [c[4], c[5]] : [c[2], c[3]]
    } else if (op === DRAW.closePath) {
      flush(true)
      last = start
    } else break // comando desconocido: el resto de los datos no se puede leer
  }
  flush(false)
  return out
}

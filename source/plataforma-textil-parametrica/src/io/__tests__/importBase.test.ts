import { describe, expect, it } from 'vitest'
import { polygonArea, polygonBounds } from '../../geometry/polygon'
import { closedLoops, loopsToPieces } from '../importBoundary'
import { bulgePolyline, parseDxfToShapes } from '../importDxf'
import { pdfOperatorPolylines, type PdfOps } from '../importPdf'

/** Arma un DXF ASCII con las entidades dadas (pares codigo/valor). */
function dxf(entities: (string | number)[][], opts: { units?: number; blocks?: (string | number)[][] } = {}) {
  const pairs: (string | number)[] = []
  if (opts.units !== undefined) pairs.push(0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, opts.units, 0, 'ENDSEC')
  if (opts.blocks) pairs.push(0, 'SECTION', 2, 'BLOCKS', ...opts.blocks.flat(), 0, 'ENDSEC')
  pairs.push(0, 'SECTION', 2, 'ENTITIES', ...entities.flat(), 0, 'ENDSEC', 0, 'EOF')
  return pairs.join('\r\n') + '\r\n'
}

const rect = (w: number, h: number, x = 0, y = 0) => [
  0, 'LWPOLYLINE', 8, '0', 90, 4, 70, 1,
  10, x, 20, y, 10, x + w, 20, y, 10, x + w, 20, y + h, 10, x, 20, y + h,
]
const circle = (x: number, y: number, r: number) => [0, 'CIRCLE', 8, '0', 10, x, 20, y, 40, r]
const line = (x1: number, y1: number, x2: number, y2: number) => [
  0, 'LINE', 8, '0', 10, x1, 20, y1, 11, x2, 21, y2,
]

/** Primera pieza del DXF + su ancho real en mm (si el archivo trae unidades). */
function parseDxfToBoundary(text: string) {
  const { pieces, mmPerUnit } = parseDxfToShapes(text)
  const b = polygonBounds(pieces[0].outer)
  return { ...pieces[0], widthMm: mmPerUnit ? (b.maxX - b.minX) * mmPerUnit : undefined }
}

describe('DXF', () => {
  it('rectangulo con un circulo adentro: externo + agujero, ancho real en mm', () => {
    const b = parseDxfToBoundary(dxf([rect(100, 50), circle(50, 25, 10)], { units: 4 }))
    expect(polygonArea(b.outer)).toBeCloseTo(5000, 6)
    expect(b.holes).toHaveLength(1)
    expect(polygonArea(b.holes[0])).toBeCloseTo(Math.PI * 100, 0)
    expect(b.widthMm).toBeCloseTo(100, 6)
  })

  it('unidades en cm y sin unidad', () => {
    expect(parseDxfToBoundary(dxf([rect(10, 5)], { units: 5 })).widthMm).toBeCloseTo(100, 6)
    expect(parseDxfToBoundary(dxf([rect(10, 5)])).widthMm).toBeUndefined()
  })

  it('une LINE sueltas (en cualquier orden y sentido) en un lazo', () => {
    const b = parseDxfToBoundary(
      dxf([line(0, 0, 80, 0), line(0, 40, 80, 40), line(80, 0, 80, 40), line(0, 0, 0, 40)]),
    )
    expect(polygonArea(b.outer)).toBeCloseTo(3200, 6)
  })

  it('LINE + ARC: esquina redondeada', () => {
    const arc = [0, 'ARC', 8, '0', 10, 90, 20, 10, 40, 10, 50, 270, 51, 90]
    const b = parseDxfToBoundary(dxf([line(0, 0, 90, 0), arc, line(90, 20, 0, 20), line(0, 20, 0, 0)]))
    expect(polygonArea(b.outer)).toBeCloseTo(1800 + (Math.PI * 100) / 2, 0)
    expect(polygonBounds(b.outer).maxX).toBeCloseTo(100, 6)
  })

  it('bulge = 1 es una semicircunferencia hacia la izquierda', () => {
    const pts = bulgePolyline(
      [
        { p: [0, 0], bulge: 1 },
        { p: [10, 0], bulge: 0 },
      ],
      false,
    )
    const b = polygonBounds(pts)
    expect(b.minZ).toBeCloseTo(-5, 6) // antihorario de (0,0) a (10,0): pasa por abajo
    expect(b.maxZ).toBeCloseTo(0, 6)
  })

  it('pieza dentro de un bloque (INSERT con escala y desplazamiento)', () => {
    const blocks = [[0, 'BLOCK', 8, '0', 2, 'PIEZA', 70, 0, 10, 0, 20, 0], rect(10, 20), [0, 'ENDBLK', 8, '0']]
    const insert = [0, 'INSERT', 8, '0', 2, 'PIEZA', 10, 500, 20, 500, 41, 2, 42, 2, 50, 90]
    const b = parseDxfToBoundary(dxf([insert], { units: 4, blocks }))
    expect(polygonArea(b.outer)).toBeCloseTo(800, 6)
    const bb = polygonBounds(b.outer)
    // rotado 90 grados: el alto del bloque pasa a ser el ancho.
    expect(bb.maxX - bb.minX).toBeCloseTo(40, 6)
    expect(b.widthMm).toBeCloseTo(40, 6)
  })

  it('POLYLINE + VERTEX cerrada', () => {
    const v = (x: number, y: number) => [0, 'VERTEX', 8, '0', 10, x, 20, y]
    const pl = [[0, 'POLYLINE', 8, '0', 66, 1, 70, 1], v(0, 0), v(30, 0), v(30, 30), v(0, 30), [0, 'SEQEND']]
    expect(polygonArea(parseDxfToBoundary(dxf(pl)).outer)).toBeCloseTo(900, 6)
  })

  it('SPLINE cerrada (circulo racional de 9 puntos)', () => {
    const s = Math.SQRT1_2
    const ctrl = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0]]
    const w = [1, s, 1, s, 1, s, 1, s, 1]
    const knots = [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4]
    const spline = [
      0, 'SPLINE', 8, '0', 70, 1 | 4, 71, 2, 72, knots.length, 73, ctrl.length,
      ...knots.flatMap((k) => [40, k]),
      ...w.flatMap((x) => [41, x]),
      ...ctrl.flatMap(([x, y]) => [10, x * 10, 20, y * 10]),
    ]
    expect(polygonArea(parseDxfToBoundary(dxf([spline])).outer)).toBeCloseTo(Math.PI * 100, 0)
  })

  it('sin contornos cerrados: error claro', () => {
    expect(() => parseDxfToBoundary(dxf([line(0, 0, 10, 0)]))).toThrow(/contornos cerrados/)
    expect(() => parseDxfToBoundary('hola')).toThrow(/DXF/)
  })
})

describe('PDF (lista de operaciones de pdf.js)', () => {
  const OPS: PdfOps = {
    save: 10,
    restore: 11,
    transform: 12,
    paintFormXObjectBegin: 74,
    paintFormXObjectEnd: 75,
    constructPath: 91,
    endPath: 28,
    stroke: 20,
  }
  const square = (x: number, y: number, s: number, close = true) =>
    Float32Array.from([0, x, y, 1, x + s, y, 1, x + s, y + s, 1, x, y + s, ...(close ? [4] : [])])

  it('rectangulo trazado con matriz de escala; el recorte se ignora', () => {
    const fn = [OPS.save, OPS.transform, OPS.constructPath, OPS.constructPath, OPS.restore]
    const args = [
      null,
      [2, 0, 0, 2, 10, 10],
      [OPS.endPath, [square(0, 0, 1000)], null],
      [OPS.stroke, [square(0, 0, 50)], null],
      null,
    ]
    const polys = pdfOperatorPolylines(fn, args, OPS)
    expect(polys).toHaveLength(1)
    expect(polys[0].closed).toBe(true)
    expect(polygonBounds(polys[0].points)).toEqual({ minX: 10, maxX: 110, minZ: 10, maxZ: 110 })
  })

  it('un relleno sin "h" cuenta como cerrado; un trazo abierto no', () => {
    const fill = 22
    const polys = pdfOperatorPolylines(
      [OPS.constructPath, OPS.constructPath],
      [
        [fill, [square(0, 0, 10, false)], null],
        [OPS.stroke, [square(0, 0, 10, false)], null],
      ],
      OPS,
    )
    expect(polys.map((p) => p.closed)).toEqual([true, false])
    expect(closedLoops(polys, 1e-6)).toHaveLength(1)
  })

  it('curva Bezier: circulo aproximado con 4 cubicas', () => {
    const k = 0.5523
    const data = Float32Array.from([
      0, 10, 0,
      2, 10, k * 10, k * 10, 10, 0, 10,
      2, -k * 10, 10, -10, k * 10, -10, 0,
      2, -10, -k * 10, -k * 10, -10, 0, -10,
      2, k * 10, -10, 10, -k * 10, 10, 0,
      4,
    ])
    const [p] = pdfOperatorPolylines([OPS.constructPath], [[OPS.stroke, [data], null]], OPS)
    expect(p.closed).toBe(true)
    expect(polygonArea(p.points)).toBeCloseTo(Math.PI * 100, -1)
  })
})

describe('varias piezas en un archivo', () => {
  const sq = (x: number, y: number, s: number): [number, number][] => [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
  ]

  it('cada contorno suelto es una pieza, con sus propios agujeros, de mayor a menor', () => {
    const pieces = loopsToPieces(
      [sq(0, 0, 10), sq(100, 0, 50), sq(110, 10, 10), sq(2, 2, 3), sq(300, 0, 20)],
      'test',
    )
    expect(pieces.map((p) => polygonArea(p.outer))).toEqual([2500, 400, 100])
    expect(pieces.map((p) => p.holes.length)).toEqual([1, 0, 1])
  })

  it('una isla dentro de un agujero vuelve a ser pieza', () => {
    const pieces = loopsToPieces([sq(0, 0, 100), sq(30, 30, 40), sq(40, 40, 20)], 'test')
    expect(pieces).toHaveLength(2)
    expect(pieces[0].holes).toHaveLength(1)
    expect(polygonArea(pieces[1].outer)).toBe(400)
  })

  it('DXF con dos piezas en bloques distintos', () => {
    const { pieces, mmPerUnit } = parseDxfToShapes(
      dxf([rect(100, 50), circle(50, 25, 10), rect(30, 30, 200, 0)], { units: 4 }),
    )
    expect(pieces).toHaveLength(2)
    expect(pieces[0].holes).toHaveLength(1)
    expect(pieces[1].holes).toHaveLength(0)
    expect(mmPerUnit).toBe(1)
  })
})

describe('orientacion', () => {
  it('DXF: lo que esta arriba en el plano queda arriba en pantalla (z menor)', () => {
    // triangulo con la punta hacia arriba (y mayor en el DXF).
    const tri = [0, 'LWPOLYLINE', 8, '0', 90, 3, 70, 1, 10, 0, 20, 0, 10, 100, 20, 0, 10, 50, 20, 80]
    const { pieces } = parseDxfToShapes(dxf([tri]))
    const tip = pieces[0].outer.find(([x]) => Math.abs(x - 50) < 1e-9)!
    expect(tip[1]).toBe(Math.min(...pieces[0].outer.map((p) => p[1])))
  })
})

describe('linea de costura', () => {
  const rectLoop = (x: number, y: number, w: number, h: number): [number, number][] => [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]

  it('un contorno paralelo dentro de la pieza (corte + costura) no es agujero', () => {
    const pieces = loopsToPieces([rectLoop(0, 0, 200, 1000), rectLoop(10, 10, 180, 980)], 'test')
    expect(pieces).toHaveLength(1)
    expect(pieces[0].holes).toHaveLength(0)
    expect(polygonArea(pieces[0].outer)).toBe(200000) // queda la linea de corte
  })

  it('una pinza o un agujero chico sigue siendo agujero', () => {
    const pieces = loopsToPieces([rectLoop(0, 0, 200, 1000), rectLoop(80, 300, 40, 200)], 'test')
    expect(pieces[0].holes).toHaveLength(1)
  })

  it('pieza angosta (pretina) con costura', () => {
    const pieces = loopsToPieces([rectLoop(0, 0, 720, 70), rectLoop(10, 10, 700, 50)], 'test')
    expect(pieces[0].holes).toHaveLength(0)
  })
})

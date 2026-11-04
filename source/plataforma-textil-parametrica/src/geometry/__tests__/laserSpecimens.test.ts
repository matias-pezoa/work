import { describe, expect, it } from 'vitest'
import { DEFAULT_LASER, LAYER_ORDER, type LaserParams } from '../laserCut'
import {
  buildSpecimen,
  DEFAULT_SPECIMEN,
  planSpecimens,
  specimenFileName,
  type SpecimenParams,
} from '../laserSpecimens'
import { textToStrokes, strokeTextWidth } from '../strokeFont'
import { laserToAi, laserToDxf, laserToSvg, specimenToFile } from '../../io/exportLaser'
import { buildZip, crc32 } from '../../io/zip'
import { polygonBounds } from '../polygon'

const laser = (patch: Partial<LaserParams> = {}): LaserParams => ({
  ...DEFAULT_LASER,
  ...patch,
})
const spec = (patch: Partial<SpecimenParams> = {}): SpecimenParams => ({
  ...DEFAULT_SPECIMEN,
  ...patch,
})
const build = (l: LaserParams, sp: SpecimenParams, k = 0) => {
  const series = planSpecimens(l, sp)
  return buildSpecimen(series.plans[k], series.plans.length, [], l, sp)
}

describe('generador de probetas: serie', () => {
  it('un parametro: N probetas, de "desde" a "hasta"', () => {
    const s = planSpecimens(
      laser(),
      spec({ axisX: 'minBridgeMm', xFrom: 1.5, xTo: 4, steps: 6 }),
    )
    expect(s.plans).toHaveLength(6)
    const v = s.plans.map((p) => p.values[0].value)
    expect(v[0]).toBeCloseTo(1.5)
    expect(v[5]).toBeCloseTo(4)
    for (let k = 1; k < v.length; k++) expect(v[k]).toBeGreaterThanOrEqual(v[k - 1])
    expect(s.plans.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('dos parametros: todas las combinaciones (pasos X x pasos Y)', () => {
    const s = planSpecimens(
      laser(),
      spec({
        axisX: 'perfPitchMm',
        xFrom: 8,
        xTo: 20,
        axisY: 'minBridgeMm',
        yFrom: 1.5,
        yTo: 4,
        steps: 4,
        stepsY: 3,
      }),
    )
    expect(s.plans).toHaveLength(12)
    const at = (col: number, row: number) => s.plans[row * 4 + col]
    expect(at(0, 0).values.map((v) => v.value)).toEqual([8, 1.5])
    expect(at(3, 0).values[0].value).toBeCloseTo(20)
    expect(at(0, 2).values[1].value).toBeCloseTo(4)
    expect(at(2, 1).params.perfPitchMm).toBe(at(2, 1).values[0].value)
  })

  it('sin parametros: copias iguales', () => {
    const s = planSpecimens(laser(), spec({ axisX: 'none', axisY: 'none', steps: 3 }))
    expect(s.plans).toHaveLength(3)
    expect(s.plans.every((p) => p.values.length === 0)).toBe(true)
  })

  it('capas y huella no admiten probetas', () => {
    expect(planSpecimens(laser({ family: 'layers' }), spec()).unsupported).toBe(true)
    expect(planSpecimens(laser({ family: 'footprint' }), spec()).plans).toHaveLength(0)
  })
})

describe('generador de probetas: una probeta por archivo', () => {
  it('el formato por defecto es 200 x 200 y todo queda dentro', () => {
    const s = build(laser(), spec())
    expect(s.bounds).toEqual({ minX: 0, maxX: 200, minZ: 0, maxZ: 200 })
    const b = polygonBounds(s.paths.flatMap((p) => p.points))
    const comp = DEFAULT_LASER.kerfMm
    expect(b.minX).toBeGreaterThanOrEqual(-comp)
    expect(b.minZ).toBeGreaterThanOrEqual(-comp)
    expect(b.maxX).toBeLessThanOrEqual(200 + comp)
    expect(b.maxZ).toBeLessThanOrEqual(200 + comp)
    expect(s.calados).toBeGreaterThan(0)
  })

  it('un solo contorno, al final, y nada cortado en la franja del rotulo', () => {
    const sp = spec()
    const s = build(laser(), sp)
    const order = s.paths.map((p) => LAYER_ORDER.indexOf(p.layer))
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(s.paths.filter((p) => p.layer === 'contorno')).toHaveLength(1)
    for (const p of s.paths.filter((q) => q.layer !== 'contorno')) {
      expect(polygonBounds(p.points).minZ).toBeGreaterThanOrEqual(sp.headerMm)
    }
  })

  it('sin contorno: el borde va como referencia', () => {
    const s = build(laser(), spec({ cutOutline: false }))
    expect(s.paths.some((p) => p.layer === 'contorno')).toBe(false)
    expect(s.frames).toHaveLength(1)
  })

  it('rotulo con numero y valores, dentro del ancho', () => {
    const sp = spec({ axisX: 'minBridgeMm', xFrom: 1.5, xTo: 4, steps: 4 })
    const s = build(laser(), sp, 2)
    expect(s.labels[0].text).toMatch(/^#3\/4 /)
    for (const l of s.labels) {
      expect(l.x + strokeTextWidth(l.text, l.sizeMm)).toBeLessThanOrEqual(sp.widthMm)
    }
  })

  it('los valores de cada probeta cambian el patron', () => {
    const sp = spec({ axisX: 'perfPitchMm', xFrom: 8, xTo: 20, steps: 2 })
    expect(build(laser(), sp, 0).calados).toBeGreaterThan(build(laser(), sp, 1).calados)
  })

  it('nombre de archivo: apellido_probeta_numero', () => {
    const sp = spec({ surname: ' Muñoz Pérez ', steps: 12 })
    expect(build(laser(), sp, 2).name).toBe('Munoz-Perez_probeta_03')
    expect(specimenFileName('Pezoa', 7, 120)).toBe('Pezoa_probeta_007')
    expect(specimenFileName('  ', 1, 4)).toBe('probeta_01')
  })

  it('el apellido va grabado en la probeta', () => {
    const s = build(laser(), spec({ surname: 'Pezoa' }))
    expect(s.labels.some((l) => l.text.startsWith('Pezoa · '))).toBe(true)
  })
})

describe('tipografia de trazo', () => {
  it('genera trazos dentro de la caja del texto', () => {
    const strokes = textToStrokes({
      x: 0,
      z: 10,
      text: '#12 Puente',
      sizeMm: 5,
      anchor: 'start',
    })
    expect(strokes.length).toBeGreaterThan(5)
    const b = polygonBounds(strokes.flat())
    expect(b.minX).toBeGreaterThanOrEqual(0)
    expect(b.maxX).toBeLessThanOrEqual(strokeTextWidth('#12 Puente', 5) + 1e-9)
    expect(b.maxZ).toBeLessThanOrEqual(10 + 1e-9)
  })
})

describe('export de una probeta', () => {
  const s = build(laser(), spec())

  it('SVG sin aire mide exactamente 200 x 200 mm', () => {
    const svg = specimenToFile(s, 'svg')
    expect(svg).toContain('width="200.000mm" height="200.000mm"')
    expect(svg).toContain('viewBox="0 0 200.000 200.000"')
    expect(svg).toBe(laserToSvg(s, s.name, s.labels, s.frames, 0))
  })

  it('DXF trae capas de corte y grabado', () => {
    const dxf = laserToDxf(s, s.labels, s.frames)
    for (const name of ['CALADO', 'CONTORNO', 'GRABADO']) expect(dxf).toContain(name)
  })

  it('AI (Illustrator 3): cabecera EPS, mesa de 200 mm en puntos, grupos por color', () => {
    const ai = laserToAi(s, 'probeta', s.labels, 0)
    expect(
      ai.startsWith('%!PS-Adobe-2.0 EPSF-1.2\n%%Creator: Adobe Illustrator(TM) 3.2'),
    ).toBe(true)
    expect(ai).toContain('%%BoundingBox: 0 0 567 567')
    expect(ai).toContain('0 0 0 1 K') // grabado
    expect(ai).toContain('1 1 0 0 K') // calado
    expect(ai).toContain('0 1 1 0 K') // contorno
    expect(ai.trimEnd().endsWith('%%EOF')).toBe(true)
    // grabado antes que el contorno
    expect(ai.indexOf('0 0 0 1 K')).toBeLessThan(ai.indexOf('0 1 1 0 K'))
    const groups = ai.split('\n').filter((l) => l === 'u').length
    expect(groups).toBe(ai.split('\n').filter((l) => l === 'U').length)
    // cada linea de trazo es "x y m|L" o un cierre s/S
    const body = ai
      .slice(ai.indexOf('%%EndSetup'), ai.indexOf('%%PageTrailer'))
      .split('\n')
    for (const line of body) {
      if (/^-?\d/.test(line) && / [mL]$/.test(line)) {
        const [x, y] = line.split(' ').map(Number)
        expect(x).toBeGreaterThanOrEqual(-1)
        expect(y).toBeGreaterThanOrEqual(-1)
        expect(x).toBeLessThanOrEqual(568)
        expect(y).toBeLessThanOrEqual(568)
      }
    }
  })
})

describe('zip', () => {
  it('crc32 conocido', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('un archivo por entrada, con directorio central', () => {
    const zip = buildZip([
      { name: 'a.svg', content: 'hola' },
      { name: 'b.dxf', content: 'chau' },
    ])
    const view = new DataView(zip.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    const end = zip.length - 22
    expect(view.getUint32(end, true)).toBe(0x06054b50)
    expect(view.getUint16(end + 10, true)).toBe(2)
    const text = new TextDecoder().decode(zip)
    expect(text).toContain('a.svghola')
    expect(text).toContain('b.dxfchau')
  })
})

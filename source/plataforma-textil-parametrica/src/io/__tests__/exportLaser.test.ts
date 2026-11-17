import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildLaserCut, DEFAULT_LASER } from '../../geometry/laserCut'
import { createAttractor } from '../../geometry/attractionField'
import {
  closedPoints,
  laserToAi,
  laserToDxf,
  laserToPdf,
  laserToSvg,
  pathData,
} from '../exportLaser'
import { polygonArea, polylineLength } from '../../geometry/polygon'
import { closeOpenCuts } from '../cloExport'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { pdfOperatorPolylines } from '../importPdf'

const result = buildLaserCut(
  [createAttractor(new THREE.Vector3(0, 0, 0), { radius: 10, falloff: 'linear' })],
  { ...DEFAULT_LASER, family: 'scales' },
)

describe('laserToSvg', () => {
  const svg = laserToSvg(result)

  it('declara el tamano en mm', () => {
    expect(svg).toMatch(/width="[\d.]+mm" height="[\d.]+mm"/)
  })

  it('un grupo por capa usada, contorno al final', () => {
    expect(svg.indexOf('id="corte"')).toBeGreaterThan(0)
    expect(svg.indexOf('id="contorno"')).toBeGreaterThan(svg.indexOf('id="corte"'))
    expect(svg).not.toContain('id="calado"')
  })

  it('un path por trazo', () => {
    expect(svg.match(/<path /g)?.length).toBe(result.paths.length)
  })
})

describe('laserToDxf', () => {
  const dxf = laserToDxf(result)
  const lines = dxf.trim().split('\n')

  it('R12 en mm, termina en EOF', () => {
    expect(dxf).toContain('AC1009')
    expect(lines.slice(-2)).toEqual(['0', 'EOF'])
  })

  it('una POLYLINE por trazo, con su capa', () => {
    expect(dxf.match(/^POLYLINE$/gm)?.length).toBe(result.paths.length)
    expect(dxf).toContain('CONTORNO')
    expect(dxf).toContain('CORTE')
  })

  it('codigos y valores en pares', () => {
    expect(lines.length % 2).toBe(0)
  })
})

describe('trazos cerrados', () => {
  // marco de 200 x 200 como el de la probeta: 4 vertices, cierre implicito.
  const square = {
    paths: [
      {
        layer: 'contorno' as const,
        points: [
          [-100, -100],
          [100, -100],
          [100, 100],
          [-100, 100],
        ] as [number, number][],
        closed: true,
      },
    ],
    bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
  }

  it('closedPoints repite el primer vertice una sola vez', () => {
    const pts = closedPoints(square.paths[0].points, true)
    expect(pts).toHaveLength(5)
    expect(pts[4]).toEqual(pts[0])
    expect(closedPoints(pts, true)).toHaveLength(5)
    expect(closedPoints(square.paths[0].points, false)).toHaveLength(4)
  })

  it('SVG: vuelve al inicio antes de Z', () => {
    expect(pathData(square.paths[0])).toMatch(/L-100\.000 -100\.000Z$/)
  })

  it('DXF: 5 vertices, el ultimo igual al primero', () => {
    expect(laserToDxf(square).match(/^VERTEX$/gm)).toHaveLength(5)
  })

  it('AI: 5 vertices y sin extremos redondeados', () => {
    const ai = laserToAi(square, 'probeta', [], 0)
    const contour = ai.slice(ai.indexOf('0 1 1 0 K'))
    expect(contour.match(/ [mL]$/gm)).toHaveLength(5)
    const verts = contour.match(/^.* [mL]$/gm)!.map((v) => v.slice(0, -2))
    expect(verts[4]).toBe(verts[0])
    expect(ai).toContain('0 J 0 j')
  })
})

describe('calados cerrados en todas las familias', () => {
  const families = [
    'perforation',
    'kirigami',
    'scales',
    'hinge',
    'module',
    'layers',
  ] as const
  for (const family of families) {
    it(`${family}: cada trazo cerrado del AI vuelve a su primer vertice`, () => {
      const r = buildLaserCut(
        [createAttractor(new THREE.Vector3(0, 0, 0), { radius: 40, falloff: 'linear' })],
        { ...DEFAULT_LASER, family },
      )
      const ai = laserToAi(r, 'x', [], 0)
      const paths = ai.split(/\n[sS]\n/).slice(0, -1)
      const closedOps = ai.match(/^s$/gm)?.length ?? 0
      expect(closedOps).toBe(r.paths.filter((p) => p.closed).length)
      let checked = 0
      ai.split('\n').reduce<string[]>((cur, line) => {
        if (/ [mL]$/.test(line)) return [...cur, line.slice(0, -2)]
        if (line === 's') {
          expect(cur[cur.length - 1]).toBe(cur[0])
          checked++
        }
        return line === 's' || line === 'S' ? [] : cur
      }, [])
      expect(checked).toBe(closedOps)
      expect(paths.length).toBeGreaterThan(0)
    })
  }
})

describe('laserToPdf', () => {
  const r = buildLaserCut(
    [createAttractor(new THREE.Vector3(0, 0, 0), { radius: 40, falloff: 'linear' })],
    { ...DEFAULT_LASER, family: 'perforation' },
  )
  const pdf = laserToPdf(r, 'probeta (01)', [{ x: 0, z: 0, sizeMm: 5, text: 'AB' }], 0)

  it('xref exacta: cada desplazamiento apunta al inicio de su objeto', () => {
    const start = Number(pdf.match(/startxref\n(\d+)/)![1])
    expect(pdf.slice(start, start + 4)).toBe('xref')
    const offsets = [...pdf.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    )
    offsets.forEach((o, k) =>
      expect(pdf.slice(o, o + `${k + 1} 0 obj`.length)).toBe(`${k + 1} 0 obj`),
    )
  })

  it('pdf.js lo lee: pagina a escala real, capas y trazos cerrados', async () => {
    const task = pdfjs.getDocument({ data: new TextEncoder().encode(pdf) })
    const doc = await task.promise
    const page = await doc.getPage(1)
    const { minX, maxX, minZ, maxZ } = r.bounds
    expect(page.view[2]).toBeCloseTo(((maxX - minX) * 72) / 25.4, 2)
    expect(page.view[3]).toBeCloseTo(((maxZ - minZ) * 72) / 25.4, 2)
    const oc = await doc.getOptionalContentConfig()
    const names = [...oc].map(([, g]) => g.name)
    expect(names).toEqual(['GRABADO', 'CALADO', 'CONTORNO'])
    const list = await page.getOperatorList()
    const polys = pdfOperatorPolylines(list.fnArray, list.argsArray, pdfjs.OPS)
    expect(polys.filter((p) => p.closed)).toHaveLength(
      r.paths.filter((p) => p.closed).length,
    )
    await task.destroy()
  })
})

describe('CLO3D: cortes abiertos como poligono cerrado', () => {
  const sheet = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 }
  const open = (...pts: [number, number][]) => ({
    layer: 'corte' as const,
    points: pts,
    closed: false,
  })

  it('una recta pasa a ser un rectangulo de largo x ancho', () => {
    const { paths } = closeOpenCuts(
      { paths: [open([0, 0], [10, 0])], bounds: sheet },
      0.2,
    )
    expect(paths).toHaveLength(1)
    expect(paths[0].closed).toBe(true)
    expect(polygonArea(paths[0].points)).toBeCloseTo(2, 3)
  })

  it('dos cortes que se cruzan salen como UN contorno', () => {
    const { paths } = closeOpenCuts(
      { paths: [open([-10, 0], [10, 0]), open([0, -10], [0, 10])], bounds: sheet },
      0.5,
    )
    expect(paths).toHaveLength(1)
    expect(polygonArea(paths[0].points)).toBeCloseTo(2 * 20 * 0.5 - 0.5 * 0.5, 3)
  })

  it('escamas (cortes separados): una ranura por corte; calados y contorno intactos, contorno al final', () => {
    const r = buildLaserCut(
      [createAttractor(new THREE.Vector3(0, 0, 0), { radius: 10, falloff: 'linear' })],
      { ...DEFAULT_LASER, family: 'scales' },
    )
    const openCuts = r.paths.filter((p) => !p.closed)
    expect(openCuts.length).toBeGreaterThan(0)
    const clo = closeOpenCuts(r, 0.3)
    expect(clo.paths.every((p) => p.closed)).toBe(true)
    const slots = clo.paths.filter((p) => p.layer === 'corte')
    expect(slots).toHaveLength(openCuts.length)
    const want = openCuts.reduce((s, p) => s + polylineLength(p.points, false), 0) * 0.3
    const got = slots.reduce((s, p) => s + polygonArea(p.points), 0)
    expect(got / want).toBeCloseTo(1, 2)
    expect(clo.paths[clo.paths.length - 1].layer).toBe('contorno')
    for (const p of r.paths.filter((q) => q.closed)) expect(clo.paths).toContain(p)
  })

  it('modulo tripode (dos trazos que se tocan): un contorno por tripode', () => {
    const r = buildLaserCut(
      [createAttractor(new THREE.Vector3(0, 0, 0), { radius: 10, falloff: 'linear' })],
      { ...DEFAULT_LASER, family: 'module' },
    )
    const openCuts = r.paths.filter((p) => !p.closed).length
    expect(openCuts).toBeGreaterThan(0)
    const slots = closeOpenCuts(r, 0.2).paths.filter((p) => p.layer === 'corte')
    expect(slots).toHaveLength(openCuts / 2)
  })
})

describe('CLO3D: uniones de punta', () => {
  it('bisagra cruz: tres trazos que solo se tocan de punta salen como un contorno', () => {
    const r = buildLaserCut(
      [createAttractor(new THREE.Vector3(0, 0, 0), { radius: 10, falloff: 'linear' })],
      { ...DEFAULT_LASER, family: 'hinge', hingePattern: 'cross' },
    )
    const openCuts = r.paths.filter((p) => !p.closed).length
    expect(openCuts % 3).toBe(0)
    const slots = closeOpenCuts(r, 0.2).paths.filter((p) => p.layer === 'corte')
    expect(slots).toHaveLength(openCuts / 3)
  })

  it('un extremo libre no se prolonga', () => {
    const { paths } = closeOpenCuts(
      {
        paths: [
          {
            layer: 'corte',
            points: [
              [0, 0],
              [10, 0],
            ],
            closed: false,
          },
        ],
      },
      0.4,
    )
    const xs = paths[0].points.map(([x]) => x)
    expect(Math.min(...xs)).toBeCloseTo(0, 6)
    expect(Math.max(...xs)).toBeCloseTo(10, 6)
  })
})

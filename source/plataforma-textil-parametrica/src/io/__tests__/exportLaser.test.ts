import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildLaserCut, DEFAULT_LASER } from '../../geometry/laserCut'
import { createAttractor } from '../../geometry/attractionField'
import { closedPoints, laserToAi, laserToDxf, laserToSvg, pathData } from '../exportLaser'

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

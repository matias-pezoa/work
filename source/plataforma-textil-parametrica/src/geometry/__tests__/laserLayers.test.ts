import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildLaserCut, DEFAULT_LASER, type LaserParams } from '../laserCut'
import { createAttractor } from '../attractionField'
import { layoutOnBed } from '../laserBed'
import {
  pointInPolygon,
  polygonBounds,
  distanceToPolygonEdges,
  type Vec2,
} from '../polygon'
import { laserToDxf, laserToSvg } from '../../io/exportLaser'

const params = (patch: Partial<LaserParams>): LaserParams => ({
  ...DEFAULT_LASER,
  family: 'layers',
  kerfMm: 0,
  ...patch,
})

const attractors = [
  createAttractor(new THREE.Vector3(5, 0, 2), { radius: 8, falloff: 'linear' }),
]

const outlineOf = (paths: { layer: string; points: Vec2[] }[]) =>
  paths.find((p) => p.layer === 'contorno')!.points
const holesOf = (paths: { layer: string; points: Vec2[] }[]) =>
  paths.filter((p) => p.layer === 'calado').map((p) => p.points)

for (const join of ['center', 'edge'] as const) {
  describe(`capas unidas desde ${join === 'center' ? 'el centro' : 'una arista'}`, () => {
    const r = buildLaserCut(attractors, params({ layerJoin: join }))

    it('una pieza por capa, numeradas desde 1', () => {
      expect(r.pieces.length).toBeGreaterThanOrEqual(6)
      expect(r.pieces.map((p) => p.number)).toEqual(r.pieces.map((_, k) => k + 1))
      expect(r.labels).toHaveLength(r.pieces.length)
    })

    it('cada capa queda dentro de la anterior', () => {
      for (let k = 1; k < r.pieces.length; k++) {
        const outer = outlineOf(r.pieces[k - 1].paths)
        for (const [x, z] of outlineOf(r.pieces[k].paths)) {
          const inside =
            pointInPolygon(x, z, outer) || distanceToPolygonEdges(x, z, outer) < 1e-6
          expect(inside).toBe(true)
        }
      }
    })

    it('los agujeros de union son los mismos en todas las capas y caben con puente', () => {
      const ref = holesOf(r.pieces[0].paths)
      expect(ref.length).toBeGreaterThan(0)
      for (const piece of r.pieces) {
        expect(holesOf(piece.paths)).toEqual(ref)
        const outline = outlineOf(piece.paths)
        for (const hole of holesOf(piece.paths))
          for (const [x, z] of hole) {
            expect(pointInPolygon(x, z, outline)).toBe(true)
            expect(distanceToPolygonEdges(x, z, outline)).toBeGreaterThanOrEqual(
              DEFAULT_LASER.minBridgeMm - 1e-6,
            )
          }
      }
    })
  })
}

describe('capas: arista compartida', () => {
  it('todas las capas tocan la arista elegida (arriba = z minima)', () => {
    const r = buildLaserCut([], params({ layerJoin: 'edge', layerEdge: 'top' }))
    const top = polygonBounds(outlineOf(r.pieces[0].paths)).minZ
    for (const piece of r.pieces) {
      expect(polygonBounds(outlineOf(piece.paths)).minZ).toBeCloseTo(top, 6)
    }
  })
})

describe('cama del laser', () => {
  const r = buildLaserCut(attractors, params({ layerCount: 16 }))
  const bed = layoutOnBed(r.pieces, { widthMm: 600, heightMm: 400, gapMm: 4, labelMm: 4 })

  it('todas las piezas quedan dentro de alguna cama, sin solaparse', () => {
    const boxes = r.pieces.map((_, k) => {
      // cada pieza aporta sus trazos en orden: se reagrupan por contorno
      const outlines = bed.paths.filter((p) => p.layer === 'contorno')
      return polygonBounds(outlines[k].points)
    })
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]
      const frame = bed.frames.find((f) => {
        const fb = polygonBounds(f)
        return (
          b.minX >= fb.minX && b.maxX <= fb.maxX && b.minZ >= fb.minZ && b.maxZ <= fb.maxZ
        )
      })
      expect(frame).toBeDefined()
      for (let j = i + 1; j < boxes.length; j++) {
        const c = boxes[j]
        const overlap =
          b.minX < c.maxX && c.minX < b.maxX && b.minZ < c.maxZ && c.minZ < b.maxZ
        expect(overlap).toBe(false)
      }
    }
  })

  it('el numero de cada pieza queda al costado, fuera de toda pieza', () => {
    expect(bed.labels.map((l) => l.text).sort((a, b) => +a - +b)).toEqual(
      r.pieces.map((p) => String(p.number)),
    )
    const outlines = bed.paths.filter((p) => p.layer === 'contorno')
    for (const l of bed.labels) {
      for (const o of outlines) expect(pointInPolygon(l.x, l.z, o.points)).toBe(false)
    }
  })

  it('gira las piezas para aprovechar la cama (dos de 300x200 por cama de 600x400)', () => {
    const big = buildLaserCut(
      [],
      params({ layerCount: 4, layerInnerScale: 0.9, layerMinStepMm: 1 }),
    )
    const b = layoutOnBed(big.pieces, {
      widthMm: 600,
      heightMm: 400,
      gapMm: 4,
      labelMm: 4,
    })
    expect(big.pieces).toHaveLength(4)
    expect(b.beds).toBe(2)
  })

  it('una cama chica abre camas nuevas', () => {
    const small = layoutOnBed(r.pieces, {
      widthMm: 320,
      heightMm: 230,
      gapMm: 4,
      labelMm: 4,
    })
    expect(small.beds).toBeGreaterThan(1)
  })

  it('el export lleva numeros grabados y el marco en su capa de referencia', () => {
    const svg = laserToSvg(bed, 'cama', bed.labels, bed.frames)
    expect(svg).toContain('id="grabado"')
    expect(svg).toContain('id="cama"')
    expect(svg.match(/<text /g)?.length).toBe(bed.labels.length)
    const dxf = laserToDxf(bed, bed.labels, bed.frames)
    expect(dxf.split('\n').filter((l) => l === 'TEXT')).toHaveLength(bed.labels.length)
    expect(dxf).toContain('CAMA_REFERENCIA_NO_CORTAR')
  })
})

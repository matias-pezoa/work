import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildLaserCut, DEFAULT_LASER } from '../../geometry/laserCut'
import { createAttractor } from '../../geometry/attractionField'
import { laserToDxf, laserToSvg } from '../exportLaser'

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

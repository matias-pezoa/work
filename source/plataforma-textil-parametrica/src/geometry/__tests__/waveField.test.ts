import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  buildWaveField,
  DEFAULT_WAVE_FIELD,
  MIN_RIB_THICKNESS_MM,
  MIN_RIB_HEIGHT_MM,
} from '../waveField'
import { createAttractor, createCurveAttractor } from '../attractionField'
import { mmToThree, threeToMm } from '../../utils/units'
import type { Boundary } from '../polygon'

const base = { ...DEFAULT_WAVE_FIELD, planeSize: 20 }

function centerAttractor(strength = 1) {
  return createAttractor(new THREE.Vector3(0, 3, 0), {
    radius: 15,
    strength,
    falloff: 'gaussian',
  })
}

function allFinite(geometry: THREE.BufferGeometry): boolean {
  const pos = geometry.getAttribute('position')
  for (let i = 0; i < pos.array.length; i++) {
    if (!Number.isFinite(pos.array[i])) return false
  }
  return true
}

describe('buildWaveField', () => {
  it('sin atractores, las costillas quedan en su altura piso', () => {
    const res = buildWaveField([], base)
    expect(res.bounds.min.y).toBeCloseTo(0, 6)
    expect(res.bounds.max.y).toBeCloseTo(mmToThree(base.heightFloorMm), 4)
  })

  it('con un atractor aparecen crestas por encima de la altura piso', () => {
    const res = buildWaveField([centerAttractor()], base)
    expect(res.bounds.max.y).toBeGreaterThan(mmToThree(base.heightFloorMm) + 1e-4)
  })

  it('ninguna costilla nace por debajo de y = 0 (pie apoyado contra la tela)', () => {
    const res = buildWaveField([centerAttractor()], base)
    expect(res.bounds.min.y).toBeCloseTo(0, 6)
  })

  it('el espesor de costilla se recorta si no entra en la separacion pedida', () => {
    const tight = { ...base, spacingMm: 2, ribThicknessMm: 6 }
    const res = buildWaveField([], tight)
    expect(res.thicknessLimited).toBe(true)
    expect(res.appliedRibThicknessMm).toBeLessThan(tight.ribThicknessMm)
    expect(res.appliedRibThicknessMm).toBeGreaterThanOrEqual(MIN_RIB_THICKNESS_MM - 1e-9)
  })

  it('un espesor modesto para su separacion no se recorta', () => {
    const loose = { ...base, spacingMm: 20, ribThicknessMm: 1 }
    const res = buildWaveField([], loose)
    expect(res.thicknessLimited).toBe(false)
    expect(res.appliedRibThicknessMm).toBeCloseTo(1, 6)
  })

  it('con altura piso >= minimo imprimible, cada costilla es un solo tramo continuo (sin huecos)', () => {
    const res = buildWaveField([centerAttractor()], base) // heightFloorMm default = 3 >= MIN_RIB_HEIGHT_MM
    expect(res.segmentCount).toBe(res.ribCount)
  })

  it('con altura piso en 0 y sin atractores, no se genera ninguna costilla (todo vacio)', () => {
    const res = buildWaveField([], { ...base, heightFloorMm: 0 })
    expect(res.segmentCount).toBe(0)
    expect(res.triangleCount).toBe(0)
  })

  it('con altura piso en 0, las costillas lejos de todo atractor quedan vacias (huecos reales)', () => {
    const near = createAttractor(new THREE.Vector3(0, 3, 0), {
      radius: 3, // u3d = 30mm, chico frente al panel de 200mm
      strength: 1,
      falloff: 'linear',
    })
    const res = buildWaveField([near], { ...base, heightFloorMm: 0, spacingMm: 10 })
    expect(res.segmentCount).toBeGreaterThan(0)
    expect(res.segmentCount).toBeLessThan(res.ribCount)
    expect(threeToMm(res.bounds.max.y)).toBeGreaterThanOrEqual(MIN_RIB_HEIGHT_MM - 1e-6)
  })

  it('combine "sum" da crestas iguales o mayores que "max" donde se solapan dos atractores', () => {
    const a1 = createAttractor(new THREE.Vector3(-2, 3, 0), {
      radius: 15,
      strength: 1,
      falloff: 'linear',
    })
    const a2 = createAttractor(new THREE.Vector3(2, 3, 0), {
      radius: 15,
      strength: 1,
      falloff: 'linear',
    })
    const sum = buildWaveField([a1, a2], { ...base, combine: 'sum' })
    const max = buildWaveField([a1, a2], { ...base, combine: 'max' })
    expect(sum.bounds.max.y).toBeGreaterThanOrEqual(max.bounds.max.y - 1e-6)
  })

  it('respeta el piso y el techo de cantidad de costillas segun la separacion pedida', () => {
    const sparse = buildWaveField([], { ...base, spacingMm: 200 })
    expect(sparse.ribCount).toBeGreaterThanOrEqual(1)
    const dense = buildWaveField([], { ...base, spacingMm: 2 })
    expect(dense.ribCount).toBeLessThanOrEqual(200)
  })

  it('genera una malla solida valida (indexada, sin NaN)', () => {
    const res = buildWaveField([centerAttractor()], base)
    expect(res.geometry.getIndex()).not.toBeNull()
    expect(allFinite(res.geometry)).toBe(true)
    expect(res.triangleCount).toBeGreaterThan(0)
  })

  it('es determinista: mismos parametros -> mismo resultado', () => {
    const a = buildWaveField([centerAttractor()], base)
    const b = buildWaveField([centerAttractor()], base)
    expect(a.triangleCount).toBe(b.triangleCount)
    expect(a.bounds.max.y).toBeCloseTo(b.bounds.max.y, 9)
  })

  it('mas costillas (separacion mas chica) da mas piezas y mas triangulos', () => {
    const wide = buildWaveField([], { ...base, spacingMm: 20 })
    const tight = buildWaveField([], { ...base, spacingMm: 4 })
    expect(tight.ribCount).toBeGreaterThan(wide.ribCount)
    expect(tight.triangleCount).toBeGreaterThan(wide.triangleCount)
  })

  it('una curva atractora levanta costillas a lo largo de todo su trazo (no solo cerca de un punto)', () => {
    // linea recta en Z=0 desde x=-8 hasta x=8 (u3d): con heightFloorMm en 0,
    // solo deberia haber material cerca de esa linea.
    const curve = createCurveAttractor(
      [new THREE.Vector3(-8, 3, 0), new THREE.Vector3(8, 3, 0)],
      { radius: 2, strength: 1, falloff: 'linear' },
    )
    const res = buildWaveField([curve], { ...base, heightFloorMm: 0, spacingMm: 10 })
    // varias costillas deberian tener material (a lo largo de la linea),
    // no solo una: eso distingue una curva de un atractor punto.
    expect(res.segmentCount).toBeGreaterThan(1)
  })

  describe('con un contorno personalizado (base importada)', () => {
    // rectangulo 80x60mm, mucho mas chico que el panel cuadrado por defecto
    const rect: Boundary = {
      outer: [
        [-40, -30],
        [40, -30],
        [40, 30],
        [-40, 30],
      ],
      holes: [],
    }

    it('recorta el peine al contorno: menos triangulos que el panel cuadrado completo', () => {
      const square = buildWaveField([], base) // sin boundary, planeSize=20 (u3d=200mm)
      const clipped = buildWaveField([], base, rect)
      expect(clipped.triangleCount).toBeLessThan(square.triangleCount)
    })

    it('un agujero (p. ej. una pinza) parte algunas costillas en mas de un tramo', () => {
      const fine = { ...base, spacingMm: 8, wavelengthMm: 20, facetsPerWave: 4 }
      const withHole: Boundary = {
        outer: rect.outer,
        holes: [
          [
            [-10, -10],
            [10, -10],
            [10, 10],
            [-10, 10],
          ],
        ],
      }
      const solid = buildWaveField([], fine, rect)
      const holed = buildWaveField([], fine, withHole)
      expect(holed.segmentCount).toBeGreaterThan(solid.segmentCount)
      expect(holed.triangleCount).toBeLessThan(solid.triangleCount)
    })

    it('base plana en y=0 se mantiene aunque se use un contorno personalizado', () => {
      const res = buildWaveField([centerAttractor()], base, rect)
      expect(res.bounds.min.y).toBeCloseTo(0, 6)
    })

    it('malla valida (indexada, sin NaN) con contorno personalizado', () => {
      const res = buildWaveField([centerAttractor()], base, rect)
      expect(res.geometry.getIndex()).not.toBeNull()
      expect(allFinite(res.geometry)).toBe(true)
      expect(res.triangleCount).toBeGreaterThan(0)
    })
  })
})

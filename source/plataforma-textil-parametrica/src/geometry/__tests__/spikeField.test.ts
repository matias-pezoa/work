import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildSpikeField, DEFAULT_SPIKE_FIELD } from '../spikeField'
import { SAFE_OVERHANG_DEG, MIN_ROOT_RADIUS_MM, MIN_TIP_RADIUS_MM } from '../spike'
import { createAttractor, createCurveAttractor } from '../attractionField'
import type { Boundary } from '../polygon'

const centerAttractor = () =>
  createAttractor(new THREE.Vector3(0, 4, 0), {
    radius: 16,
    strength: 1,
    falloff: 'gaussian',
  })

// campo chico y rapido para los tests
const base = {
  ...DEFAULT_SPIKE_FIELD,
  gridU: 18,
  gridV: 18,
  maxCount: 150,
  segments: 8,
}

describe('buildSpikeField', () => {
  it('es determinista: mismo seed -> mismo resultado', () => {
    const a = buildSpikeField([centerAttractor()], base)
    const b = buildSpikeField([centerAttractor()], base)
    expect(a.count).toBe(b.count)
    expect(a.placements).toEqual(b.placements)
    a.geometry.dispose()
    b.geometry.dispose()
  })

  it('mas puas con un atractor que sin atractores', () => {
    const withA = buildSpikeField([centerAttractor()], { ...base, densityMin: 0 })
    const without = buildSpikeField([], { ...base, densityMin: 0 })
    expect(withA.count).toBeGreaterThan(without.count)
    expect(without.count).toBe(0)
    expect(without.geometry.getAttribute('position')?.count ?? 0).toBe(0)
  })

  it('respeta el tope maxCount', () => {
    const res = buildSpikeField(
      [createAttractor(new THREE.Vector3(0, 2, 0), { radius: 80, strength: 1 })],
      { ...base, densityMin: 1, densityMax: 1, maxCount: 20, gapMm: 0.2 },
    )
    expect(res.count).toBeLessThanOrEqual(20)
    expect(res.count).toBeGreaterThan(0)
  })

  it('ninguna pua supera el angulo de vuelo autosoportado', () => {
    const res = buildSpikeField([centerAttractor()], {
      ...base,
      leanDegBase: 80,
      leanDegField: 80,
      maxOverhangDeg: 30,
    })
    expect(res.count).toBeGreaterThan(0)
    for (const p of res.placements) {
      expect(p.leanDeg).toBeLessThanOrEqual(30 + 1e-6)
      expect(p.leanDeg).toBeLessThanOrEqual(SAFE_OVERHANG_DEG + 1e-6)
    }
  })

  it('ninguna pua queda con radios por debajo del piso de fabricacion', () => {
    const res = buildSpikeField([centerAttractor()], {
      ...base,
      rootRadiusBaseMm: 0,
      rootRadiusFieldMm: 0,
      tipRadiusBaseMm: 0,
      tipRadiusFieldMm: 0,
    })
    expect(res.count).toBeGreaterThan(0)
    for (const p of res.placements) {
      expect(p.rootRadiusMm).toBeGreaterThanOrEqual(MIN_ROOT_RADIUS_MM - 1e-9)
      expect(p.tipRadiusMm).toBeGreaterThanOrEqual(MIN_TIP_RADIUS_MM - 1e-9)
    }
  })

  it('ninguna pua se solapa con otra (distancia entre centros >= suma de huellas)', () => {
    const res = buildSpikeField([centerAttractor()], {
      ...base,
      densityMin: 0.5,
      densityMax: 1,
    })
    expect(res.count).toBeGreaterThan(5)
    for (let i = 0; i < res.placements.length; i++) {
      for (let j = i + 1; j < res.placements.length; j++) {
        const a = res.placements[i]
        const b = res.placements[j]
        const dist = Math.hypot(a.x - b.x, a.z - b.z)
        expect(dist).toBeGreaterThanOrEqual(a.footprintRadius + b.footprintRadius - 1e-6)
      }
    }
  })

  it('limitedByStabilityCount coincide con las puas marcadas y crece con puas altas y angostas', () => {
    const res = buildSpikeField([centerAttractor()], {
      ...base,
      heightBase: 5,
      heightField: 5,
      rootRadiusBaseMm: MIN_ROOT_RADIUS_MM,
      rootRadiusFieldMm: 0,
      leanDegBase: 40,
      leanDegField: 0,
      maxOverhangDeg: 45,
    })
    expect(res.count).toBeGreaterThan(0)
    const flagged = res.placements.filter((p) => p.limitedByStability).length
    expect(res.limitedByStabilityCount).toBe(flagged)
    // altas (5-10 u3d) y angostas (radio minimo): la estabilidad SI debe actuar.
    expect(res.limitedByStabilityCount).toBeGreaterThan(0)
  })

  it('genera una malla solida valida (indexada, sin NaN)', () => {
    const res = buildSpikeField([centerAttractor()], base)
    expect(res.geometry.getIndex()).not.toBeNull()
    const pos = res.geometry.getAttribute('position')
    for (let i = 0; i < pos.array.length; i++)
      expect(Number.isFinite(pos.array[i])).toBe(true)
    expect(res.bounds.isEmpty()).toBe(false)
  })

  it('una curva atractora siembra puas a lo largo de todo su trazo (no solo en sus puntos de control)', () => {
    // sampleField mide distancia 3D: el radio tiene que cubrir la altura (y=3)
    // del atractor ademas de la distancia horizontal a la linea.
    const curve = createCurveAttractor(
      [new THREE.Vector3(-8, 3, 0), new THREE.Vector3(8, 3, 0)],
      { radius: 6, strength: 1, falloff: 'linear' },
    )
    const res = buildSpikeField([curve], { ...base, densityMin: 0, densityMax: 1, jitter: 0 })
    expect(res.count).toBeGreaterThan(0)
    // deberian aparecer puas cerca de ambos extremos de la linea, no solo
    // agrupadas en el medio: eso distingue una curva de un atractor punto.
    const nearLeft = res.placements.some((p) => p.x < -5)
    const nearRight = res.placements.some((p) => p.x > 5)
    expect(nearLeft).toBe(true)
    expect(nearRight).toBe(true)
  })

  describe('con un contorno personalizado (base importada)', () => {
    // triangulo rectangulo de 60x60mm: la mitad del cuadrado envolvente
    const triangle: Boundary = {
      outer: [
        [-30, -30],
        [30, -30],
        [-30, 30],
      ],
      holes: [],
    }

    it('ninguna pua cae fuera del contorno', () => {
      const res = buildSpikeField(
        [centerAttractor()],
        {
          ...base,
          densityMin: 1,
          densityMax: 1,
          jitter: 0, // sin jitter: el centro de cada celda es exacto y facil de chequear
        },
        triangle,
      )
      expect(res.count).toBeGreaterThan(0)
      for (const p of res.placements) {
        // dentro del triangulo x<=30, z<=30, x+z<=0 (hipotenusa de (30,-30) a (-30,30))
        expect(p.x + p.z).toBeLessThanOrEqual(0 + 1e-6)
      }
    })

    it('menos puas que en el cuadrado envolvente completo (misma grilla)', () => {
      const params = { ...base, densityMin: 1, densityMax: 1, maxCount: 1000, gapMm: 0.1 }
      const full = buildSpikeField([centerAttractor()], { ...params, planeSize: 6 })
      const clipped = buildSpikeField([centerAttractor()], params, triangle)
      expect(clipped.count).toBeLessThan(full.count)
    })
  })
})

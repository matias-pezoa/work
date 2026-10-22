import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  buildWaveField,
  DEFAULT_WAVE_FIELD,
  flowDirection,
  rippleHeight,
} from '../waveField'
import { createAttractor, createCurveAttractor } from '../attractionField'
import { mmToThree } from '../../utils/units'

const base = { ...DEFAULT_WAVE_FIELD, planeSize: 20 }

/** Angulo de eje (0..180) de un vector (x, z). */
const axisDeg = ([x, z]: readonly [number, number]) =>
  ((((Math.atan2(z, x) * 180) / Math.PI) % 180) + 180) % 180

/** Diferencia entre dos ejes, en grados (0..90). */
const axisDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 180
  return Math.min(d, 180 - d)
}

describe('flowDirection: hacia donde corren las costillas', () => {
  it('sin atractores sigue la direccion base del panel', () => {
    expect(
      axisDiff(
        axisDeg(flowDirection(3, 4, [], { ribAngleDeg: 90, flowStrength: 1 })),
        90,
      ),
    ).toBeLessThan(1e-6)
    expect(
      axisDiff(
        axisDeg(flowDirection(3, 4, [], { ribAngleDeg: 30, flowStrength: 1 })),
        30,
      ),
    ).toBeLessThan(1e-6)
  })

  it('junto a un punto rotado toma el angulo del punto', () => {
    const p = createAttractor(new THREE.Vector3(0, 3, 0), { radius: 10, angleDeg: 35 })
    const dir = flowDirection(0.2, 0.1, [p], { ribAngleDeg: 90, flowStrength: 1 })
    expect(axisDiff(axisDeg(dir), 35)).toBeLessThan(3)
  })

  it('junto a una curva corre a lo largo de ella (tangente)', () => {
    // curva recta en diagonal a 45 grados, base perpendicular (135)
    const c = createCurveAttractor(
      [new THREE.Vector3(-5, 3, -5), new THREE.Vector3(5, 3, 5)],
      {
        radius: 4,
        falloff: 'linear',
      },
    )
    const dir = flowDirection(0.3, -0.3, [c], { ribAngleDeg: 135, flowStrength: 1 })
    expect(axisDiff(axisDeg(dir), 45)).toBeLessThan(5)
  })

  it('con flujo en 0 los atractores no doblan las costillas', () => {
    const p = createAttractor(new THREE.Vector3(0, 3, 0), { radius: 10, angleDeg: 0 })
    const dir = flowDirection(0, 0, [p], { ribAngleDeg: 90, flowStrength: 0 })
    expect(axisDiff(axisDeg(dir), 90)).toBeLessThan(1e-6)
  })

  it('0 y 180 grados son el mismo eje (no se anulan entre si)', () => {
    const a = createAttractor(new THREE.Vector3(-0.1, 3, 0), { radius: 10, angleDeg: 10 })
    const b = createAttractor(new THREE.Vector3(0.1, 3, 0), { radius: 10, angleDeg: 190 })
    const dir = flowDirection(0, 0, [a, b], { ribAngleDeg: 90, flowStrength: 1 })
    expect(axisDiff(axisDeg(dir), 10)).toBeLessThan(5)
  })
})

describe('costillas como lineas de flujo', () => {
  /** Distancia minima entre puntos de costillas DISTINTAS. */
  function minCrossDistance(lines: (readonly [number, number])[][]): number {
    let best = Infinity
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        for (const [ax, az] of lines[i]) {
          for (const [bx, bz] of lines[j]) {
            const d = Math.hypot(ax - bx, az - bz)
            if (d < best) best = d
          }
        }
      }
    }
    return best
  }

  it('sin atractores: rectas paralelas en la direccion base', () => {
    const res = buildWaveField([], { ...base, ribAngleDeg: 0 })
    expect(res.ribCount).toBeGreaterThan(5)
    for (const line of res.ribLines) {
      const zs = line.map((p) => p[1])
      expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(1e-6) // corre en X
    }
  })

  it('las costillas nunca se acercan a menos de espesor + aire, aunque converjan', () => {
    const swirl = [
      createCurveAttractor(
        [
          new THREE.Vector3(-8, 3, -6),
          new THREE.Vector3(0, 3, 4),
          new THREE.Vector3(8, 3, -6),
        ],
        { radius: 6, falloff: 'linear', smooth: [true] },
      ),
      createAttractor(new THREE.Vector3(-4, 3, 5), { radius: 5, angleDeg: 0 }),
    ]
    const res = buildWaveField(swirl, { ...base, spacingMm: 6 })
    expect(res.ribCount).toBeGreaterThan(5)
    expect(minCrossDistance(res.ribLines)).toBeGreaterThanOrEqual(
      mmToThree(res.minRibDistanceMm) - 1e-6,
    )
  })

  it('una curva dobla las costillas: dejan de ser rectas', () => {
    const c = createCurveAttractor(
      [
        new THREE.Vector3(-8, 3, 0),
        new THREE.Vector3(0, 3, 3),
        new THREE.Vector3(8, 3, 0),
      ],
      { radius: 5, falloff: 'linear', smooth: [true] },
    )
    const straight = buildWaveField([c], { ...base, flowStrength: 0 })
    const bent = buildWaveField([c], base)
    const maxDeviation = (lines: (readonly [number, number])[][]) =>
      Math.max(
        ...lines.map(
          (l) => Math.max(...l.map((p) => p[0])) - Math.min(...l.map((p) => p[0])),
        ),
      )
    expect(maxDeviation(straight.ribLines)).toBeLessThan(1e-6)
    expect(maxDeviation(bent.ribLines)).toBeGreaterThan(1)
  })

  it('malla valida con costillas curvas (indexada, sin NaN, pie en y = 0)', () => {
    const c = createCurveAttractor(
      [
        new THREE.Vector3(-8, 3, -4),
        new THREE.Vector3(0, 3, 4),
        new THREE.Vector3(8, 3, -4),
      ],
      { radius: 6, smooth: [true] },
    )
    const res = buildWaveField([c], base)
    const pos = res.geometry.getAttribute('position')
    expect(res.geometry.getIndex()).not.toBeNull()
    expect(Array.from(pos.array).every(Number.isFinite)).toBe(true)
    expect(res.bounds.min.y).toBeCloseTo(0, 6)
  })
})

describe('crestas: concentricas o direccionales', () => {
  const wl = 2 // u3d

  it('punto direccional: la altura no cambia a lo largo de la cresta (perpendicular al angulo)', () => {
    const p = createAttractor(new THREE.Vector3(0, 0, 0), {
      radius: 50,
      falloff: 'linear',
      angleDeg: 0,
      waveMode: 'directional',
    })
    // angulo 0: la onda viaja en X, las crestas corren en Z
    const h1 = rippleHeight(0.5, 0, [p], 'max', wl) / (1 - 0.5 / 50)
    const h2 = rippleHeight(0.5, 3, [p], 'max', wl) / (1 - Math.hypot(0.5, 3) / 50)
    expect(h1).toBeCloseTo(h2, 6)
    // y si cambia al avanzar en X
    expect(
      Math.abs(rippleHeight(1, 0, [p], 'max', wl) - rippleHeight(0.5, 0, [p], 'max', wl)),
    ).toBeGreaterThan(0.1)
  })

  it('punto concentrico: misma altura a la misma distancia en cualquier direccion', () => {
    const p = createAttractor(new THREE.Vector3(0, 0, 0), {
      radius: 50,
      falloff: 'linear',
    })
    expect(rippleHeight(1.3, 0, [p], 'max', wl)).toBeCloseTo(
      rippleHeight(0, 1.3, [p], 'max', wl),
      9,
    )
  })

  it('curva direccional: la onda viaja a lo largo de la curva', () => {
    const line = (waveMode: 'concentric' | 'directional') =>
      createCurveAttractor([new THREE.Vector3(-10, 0, 0), new THREE.Vector3(10, 0, 0)], {
        radius: 50,
        falloff: 'linear',
        waveMode,
      })
    // sobre la curva (d = 0): concentrica es constante, direccional varia con x
    const conc = line('concentric')
    const dir = line('directional')
    expect(rippleHeight(-2, 0, [conc], 'max', wl)).toBeCloseTo(
      rippleHeight(2.5, 0, [conc], 'max', wl),
      9,
    )
    expect(
      Math.abs(
        rippleHeight(-2, 0, [dir], 'max', wl) - rippleHeight(-1.5, 0, [dir], 'max', wl),
      ),
    ).toBeGreaterThan(0.1)
  })
})

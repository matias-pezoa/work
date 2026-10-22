import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  buildSpike,
  spikeGeometry,
  SAFE_OVERHANG_DEG,
  BASE_STABILITY_FACTOR,
  MIN_ROOT_RADIUS_MM,
  MIN_TIP_RADIUS_MM,
} from '../spike'
import { mmToThree } from '../../utils/units'

const base = new THREE.Vector3(1, 0, -2)

describe('buildSpike', () => {
  it('sin inclinacion, la punta queda directamente sobre la base', () => {
    const s = buildSpike(base, new THREE.Vector2(1, 0), {
      height: 2,
      rootRadiusMm: 3,
      tipRadiusMm: 1,
      leanDeg: 0,
      maxOverhangDeg: 45,
    })
    expect(s.tip.x).toBeCloseTo(base.x, 6)
    expect(s.tip.z).toBeCloseTo(base.z, 6)
    expect(s.tip.y - base.y).toBeCloseTo(2, 6)
    expect(s.axisLength).toBeCloseTo(2, 6)
  })

  it('la inclinacion nunca supera maxOverhangDeg aunque leanDeg lo pida', () => {
    const s = buildSpike(base, new THREE.Vector2(1, 0), {
      height: 3,
      rootRadiusMm: 3,
      tipRadiusMm: 1,
      leanDeg: 89,
      maxOverhangDeg: 20,
    })
    expect(s.leanDegApplied).toBeLessThanOrEqual(20)
  })

  it('maxOverhangDeg nunca supera el techo absoluto SAFE_OVERHANG_DEG', () => {
    const s = buildSpike(base, new THREE.Vector2(1, 0), {
      height: 3,
      rootRadiusMm: 3,
      tipRadiusMm: 1,
      leanDeg: 200, // valor absurdo, defensivo
      maxOverhangDeg: 999, // idem
    })
    expect(s.leanDegApplied).toBeLessThanOrEqual(SAFE_OVERHANG_DEG)
  })

  it('el angulo de inclinacion es constante a lo largo de todo el eje (autosoportado en cada corte)', () => {
    const s = buildSpike(base, new THREE.Vector2(0, 1), {
      height: 4,
      rootRadiusMm: 3,
      tipRadiusMm: 1,
      leanDeg: 30,
      maxOverhangDeg: 45,
    })
    // en cualquier punto intermedio, el desplazamiento horizontal respecto de
    // la base debe ser proporcional a la altura recorrida (linea recta) con
    // pendiente = tan(leanDegApplied): ningun tramo "vuela" mas que otro.
    const leanRad = (s.leanDegApplied * Math.PI) / 180
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const pt = base.clone().lerp(s.tip, t)
      const risen = pt.y - base.y
      const drift = Math.hypot(pt.x - base.x, pt.z - base.z)
      expect(drift).toBeCloseTo(risen * Math.tan(leanRad), 5)
    }
  })

  it('los radios nunca bajan de los pisos de fabricacion', () => {
    const s = buildSpike(base, new THREE.Vector2(1, 0), {
      height: 1,
      rootRadiusMm: 0, // por debajo del piso a proposito
      tipRadiusMm: 0,
      leanDeg: 0,
      maxOverhangDeg: 45,
    })
    expect(s.rootRadius).toBeCloseTo(mmToThree(MIN_ROOT_RADIUS_MM), 6)
    expect(s.tipRadius).toBeCloseTo(mmToThree(MIN_TIP_RADIUS_MM), 6)
  })

  it('footprintRadius crece con la deriva horizontal y con el radio de punta', () => {
    const straight = buildSpike(base, new THREE.Vector2(1, 0), {
      height: 3,
      rootRadiusMm: 3,
      tipRadiusMm: 1,
      leanDeg: 0,
      maxOverhangDeg: 45,
    })
    const leaned = buildSpike(base, new THREE.Vector2(1, 0), {
      height: 3,
      rootRadiusMm: 3,
      tipRadiusMm: 1,
      leanDeg: 40,
      maxOverhangDeg: 45,
    })
    expect(leaned.footprintRadius).toBeGreaterThan(straight.footprintRadius)
  })

  it('una pua alta y angosta se inclina menos que una baja y ancha pidiendo lo mismo', () => {
    const tallNarrow = buildSpike(base, new THREE.Vector2(1, 0), {
      height: 6,
      rootRadiusMm: 2,
      tipRadiusMm: 1,
      leanDeg: 40,
      maxOverhangDeg: 45,
    })
    const shortWide = buildSpike(base, new THREE.Vector2(1, 0), {
      height: 0.5,
      rootRadiusMm: 8,
      tipRadiusMm: 1,
      leanDeg: 40,
      maxOverhangDeg: 45,
    })
    expect(tallNarrow.limitedByStability).toBe(true)
    expect(shortWide.limitedByStability).toBe(false)
    expect(tallNarrow.leanDegApplied).toBeLessThan(shortWide.leanDegApplied)
    expect(shortWide.leanDegApplied).toBeCloseTo(40, 6) // no la toco ninguno de los dos limites
  })

  it('cuando la estabilidad limita, la deriva horizontal no supera BASE_STABILITY_FACTOR * radio de base', () => {
    const s = buildSpike(base, new THREE.Vector2(1, 0), {
      height: 10,
      rootRadiusMm: 1.5,
      tipRadiusMm: 0.5,
      leanDeg: 44, // pide casi el maximo permitido por vuelo
      maxOverhangDeg: 45,
    })
    expect(s.limitedByStability).toBe(true)
    const horizontalDrift = Math.hypot(s.tip.x - s.base.x, s.tip.z - s.base.z)
    expect(horizontalDrift).toBeLessThanOrEqual(
      s.rootRadius * BASE_STABILITY_FACTOR + 1e-6,
    )
  })

  it('la base de la malla queda siempre horizontal y centrada en spike.base, aunque la pua se incline', () => {
    const s = buildSpike(base, new THREE.Vector2(1, 0.4), {
      height: 1.5,
      rootRadiusMm: 8,
      tipRadiusMm: 1,
      leanDeg: 30,
      maxOverhangDeg: 45,
    })
    expect(s.leanDegApplied).toBeGreaterThan(0) // que realmente haya inclinacion que verificar
    const n = 16
    const geo = spikeGeometry(s, n)
    const pos = geo.getAttribute('position')
    // los primeros 2*n vertices son los anillos (base y punta intercalados,
    // ver spikeGeometry); despues vienen los 2 centros de las tapas, que no
    // son parte del anillo y se excluyen del recorrido. Los de la base
    // (indices pares) deben tener y == base.y y quedar exactamente al radio
    // de la base desde spike.base (en XZ).
    for (let i = 0; i < 2 * n; i += 2) {
      const y = pos.getY(i)
      expect(y).toBeCloseTo(base.y, 6)
      const dx = pos.getX(i) - base.x
      const dz = pos.getZ(i) - base.z
      expect(Math.hypot(dx, dz)).toBeCloseTo(s.rootRadius, 6)
    }
    // el anillo de la punta (indices impares) tambien es horizontal, pero
    // centrado en spike.tip (que SI esta desplazado del centro de la base).
    for (let i = 1; i < 2 * n; i += 2) {
      expect(pos.getY(i)).toBeCloseTo(s.tip.y, 6)
      const dx = pos.getX(i) - s.tip.x
      const dz = pos.getZ(i) - s.tip.z
      expect(Math.hypot(dx, dz)).toBeCloseTo(s.tipRadius, 6)
    }
    expect(Math.hypot(s.tip.x - base.x, s.tip.z - base.z)).toBeGreaterThan(0.01)
    geo.dispose()
  })

  it('spikeGeometry produce un solido cerrado, indexado y sin NaN', () => {
    const s = buildSpike(base, new THREE.Vector2(1, 1), {
      height: 2,
      rootRadiusMm: 3,
      tipRadiusMm: 1,
      leanDeg: 20,
      maxOverhangDeg: 45,
    })
    const geo = spikeGeometry(s, 12)
    const pos = geo.getAttribute('position')
    expect(geo.getIndex()).not.toBeNull()
    expect(pos.count).toBeGreaterThan(0)
    for (let i = 0; i < pos.array.length; i++)
      expect(Number.isFinite(pos.array[i])).toBe(true)
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    // la caja envolvente debe cubrir aprox. desde la base hasta la punta
    expect(bb.min.y).toBeLessThanOrEqual(base.y + 1e-3)
    expect(bb.max.y).toBeGreaterThanOrEqual(s.tip.y - 1e-3)
    geo.dispose()
  })
})

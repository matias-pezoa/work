import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  closestDistance2D,
  closestPointOnAttractor,
  createAttractor,
  createCurveAttractor,
  falloff,
  sampleField,
  type FalloffType,
} from '../attractionField'

describe('falloff', () => {
  const types: FalloffType[] = ['linear', 'inverseSquare', 'gaussian']

  it('vale ~1 en el centro y decrece con la distancia', () => {
    for (const t of types) {
      expect(falloff(t, 0, 5)).toBeCloseTo(1, 1)
      let prev = Infinity
      for (let d = 0; d <= 5; d += 0.5) {
        const v = falloff(t, d, 5)
        expect(v).toBeLessThanOrEqual(prev + 1e-9)
        prev = v
      }
    }
  })

  it('linear llega a 0 en el radio', () => {
    expect(falloff('linear', 5, 5)).toBeCloseTo(0, 6)
    expect(falloff('linear', 10, 5)).toBe(0)
  })
})

describe('sampleField', () => {
  it('el valor es mayor cerca de un atractor que lejos', () => {
    const a = createAttractor(new THREE.Vector3(0, 0, 0), { radius: 10, strength: 1 })
    const near = sampleField(new THREE.Vector3(1, 0, 0), [a])
    const far = sampleField(new THREE.Vector3(8, 0, 0), [a])
    expect(near.value).toBeGreaterThan(far.value)
  })

  it('la direccion apunta hacia el atractor', () => {
    const a = createAttractor(new THREE.Vector3(10, 0, 0), { radius: 20, strength: 1 })
    const s = sampleField(new THREE.Vector3(0, 0, 0), [a])
    expect(s.direction).not.toBeNull()
    expect(s.direction!.dot(new THREE.Vector3(1, 0, 0))).toBeGreaterThan(0.9)
  })

  it('combine "sum" acumula solapes; "max" no', () => {
    const p = new THREE.Vector3(0, 0, 0)
    const a1 = createAttractor(p.clone(), {
      radius: 10,
      strength: 0.5,
      falloff: 'linear',
    })
    const a2 = createAttractor(p.clone(), {
      radius: 10,
      strength: 0.5,
      falloff: 'linear',
    })
    const sum = sampleField(p, [a1, a2], 'sum')
    const max = sampleField(p, [a1, a2], 'max')
    expect(sum.value).toBeGreaterThan(max.value)
    expect(max.value).toBeCloseTo(0.5, 5)
  })

  it('campo vacio -> valor 0 y sin direccion', () => {
    const s = sampleField(new THREE.Vector3(0, 0, 0), [])
    expect(s.value).toBe(0)
    expect(s.direction).toBeNull()
  })

  it('una curva atrae a lo largo de todo su trazo, no solo en sus puntos de control', () => {
    const curve = createCurveAttractor(
      [new THREE.Vector3(-10, 0, 0), new THREE.Vector3(10, 0, 0)],
      { radius: 5, strength: 1, falloff: 'linear' },
    )
    // (0,0,0) esta a mitad de camino entre los dos puntos de control, lejos
    // de ambos, pero SOBRE la linea -> deberia tener campo maximo ahi.
    const onLine = sampleField(new THREE.Vector3(0, 0, 0), [curve])
    const nearControlPoint = sampleField(new THREE.Vector3(-10, 0, 0), [curve])
    expect(onLine.value).toBeCloseTo(1, 5)
    expect(nearControlPoint.value).toBeCloseTo(1, 5)
  })
})

describe('curvas atractoras', () => {
  it('createCurveAttractor exige al menos 2 puntos', () => {
    expect(() => createCurveAttractor([new THREE.Vector3(0, 0, 0)])).toThrow()
  })

  it('closestPointOnAttractor cae sobre el segmento, no en un punto de control', () => {
    const curve = createCurveAttractor([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(10, 0, 0),
    ])
    const closest = closestPointOnAttractor(new THREE.Vector3(4, 0, 3), curve)
    expect(closest.x).toBeCloseTo(4, 5)
    expect(closest.z).toBeCloseTo(0, 5)
  })

  it('closestDistance2D usa el segmento mas cercano de una curva con varios tramos', () => {
    const curve = createCurveAttractor([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(10, 0, 0),
      new THREE.Vector3(10, 0, 10),
    ])
    // (10, _, 5) esta sobre el segundo tramo -> distancia ~0.
    expect(closestDistance2D(10, 5, curve)).toBeCloseTo(0, 5)
    // lejos de los dos tramos.
    expect(closestDistance2D(-5, -5, curve)).toBeGreaterThan(5)
  })

  it('closestDistance2D de un atractor punto es la distancia radial de siempre', () => {
    const p = createAttractor(new THREE.Vector3(3, 7, 4))
    expect(closestDistance2D(3, 4, p)).toBeCloseTo(0, 6)
    expect(closestDistance2D(0, 0, p)).toBeCloseTo(Math.hypot(3, 4), 6)
  })
})

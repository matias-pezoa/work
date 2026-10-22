import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  applyAttractorPatch,
  closestDistance2D,
  createCurveAttractor,
  curvePath,
  insertCurvePoint,
  removeCurvePoint,
  type CurveAttractor,
} from '../attractionField'

const v = (x: number, z: number, y = 0) => new THREE.Vector3(x, y, z)

// "V": (0,0) -> (10,10) -> (20,0)
const vShape = (smooth: boolean) =>
  createCurveAttractor([v(0, 0), v(10, 10), v(20, 0)], { smooth: [smooth] })

describe('curva Bezier de un atractor', () => {
  it('por defecto es recta: la polilinea son los propios puntos de control', () => {
    const c = createCurveAttractor([v(0, 0), v(10, 10), v(20, 0)])
    expect(c.smooth).toEqual([false, false, false])
    expect(curvePath(c).map((p) => [p.x, p.z])).toEqual([
      [0, 0],
      [10, 10],
      [20, 0],
    ])
  })

  it('suave: pasa por todos los puntos de control', () => {
    const path = curvePath(vShape(true))
    for (const cp of [v(0, 0), v(10, 10), v(20, 0)]) {
      expect(Math.min(...path.map((p) => p.distanceTo(cp)))).toBeLessThan(1e-9)
    }
  })

  it('suave: redondea el vertice (la esquina de la V deja de estar en la linea recta)', () => {
    // un punto en la bisectriz, justo bajo el vertice: lejos de la recta, cerca de la curva
    const straight = vShape(false)
    const smooth = vShape(true)
    expect(closestDistance2D(10, 10, straight)).toBeCloseTo(0, 9)
    expect(closestDistance2D(10, 10, smooth)).toBeCloseTo(0, 9)
    // en medio del primer tramo la curva se separa de la cuerda
    const mid = curvePath(smooth)[8]
    expect(Math.abs(mid.x - mid.z)).toBeGreaterThan(0.1)
  })

  it('mezcla: un tramo entre dos esquinas es exactamente recto', () => {
    const c = createCurveAttractor([v(0, 0), v(10, 0), v(20, 10), v(30, 10)], {
      smooth: [false, false, true, false],
    })
    // el primer tramo (esquina -> esquina) no agrega muestras intermedias
    const path = curvePath(c)
    expect([path[0].x, path[1].x]).toEqual([0, 10])
    expect(path.length).toBeGreaterThan(4)
  })

  it('el cache se invalida al editar (cada edicion es un objeto nuevo)', () => {
    const c = vShape(false)
    const before = curvePath(c)
    const edited = applyAttractorPatch(c, {
      smooth: [true, true, true],
    }) as CurveAttractor
    expect(curvePath(edited).length).toBeGreaterThan(before.length)
    expect(curvePath(c)).toBe(before)
  })
})

describe('insertar / quitar puntos de control', () => {
  it('cerca de un tramo: inserta en ese tramo, con altura interpolada', () => {
    const c = createCurveAttractor([v(0, 0, 2), v(10, 0, 6)])
    const { patch, index } = insertCurvePoint(c, v(5, 1))
    expect(index).toBe(1)
    expect(patch.points![1].toArray()).toEqual([5, 4, 1])
    expect(patch.smooth).toHaveLength(3)
  })

  it('mas alla de un extremo: extiende la curva por ese lado', () => {
    const c = createCurveAttractor([v(0, 0), v(10, 0)])
    expect(insertCurvePoint(c, v(-5, 0)).index).toBe(0)
    expect(insertCurvePoint(c, v(15, 2)).index).toBe(2)
  })

  it('el punto nuevo hereda el tipo de vertice del vecino', () => {
    const c = createCurveAttractor([v(0, 0), v(10, 0)], { smooth: [true] })
    expect(insertCurvePoint(c, v(5, 1)).patch.smooth).toEqual([true, true, true])
  })

  it('quitar respeta el minimo de 2 puntos', () => {
    const c = vShape(true)
    const patch = removeCurvePoint(c, 1)!
    expect(patch.points!.map((p) => p.x)).toEqual([0, 20])
    const two = applyAttractorPatch(c, patch) as CurveAttractor
    expect(removeCurvePoint(two, 0)).toBeNull()
  })

  it('applyAttractorPatch mantiene smooth alineado con points', () => {
    const c = vShape(true)
    const longer = applyAttractorPatch(c, {
      points: [...c.points, v(30, 10)],
    }) as CurveAttractor
    expect(longer.smooth).toEqual([true, true, true, true])
  })
})

import { describe, expect, it } from 'vitest'
import {
  pointInPolygon,
  pointInBoundary,
  polygonBounds,
  polygonArea,
  fitBoundaryToWidth,
  rescaleBoundary,
  type Vec2,
  type Boundary,
} from '../polygon'

const square: Vec2[] = [
  [-10, -10],
  [10, -10],
  [10, 10],
  [-10, 10],
]

const triangle: Vec2[] = [
  [0, 0],
  [10, 0],
  [0, 10],
]

describe('pointInPolygon', () => {
  it('detecta puntos claramente adentro y afuera de un cuadrado', () => {
    expect(pointInPolygon(0, 0, square)).toBe(true)
    expect(pointInPolygon(9, 9, square)).toBe(true)
    expect(pointInPolygon(20, 0, square)).toBe(false)
    expect(pointInPolygon(0, -20, square)).toBe(false)
  })

  it('funciona con un triangulo', () => {
    expect(pointInPolygon(2, 2, triangle)).toBe(true)
    expect(pointInPolygon(9, 9, triangle)).toBe(false) // fuera de la hipotenusa
  })
})

describe('pointInBoundary', () => {
  const boundary: Boundary = {
    outer: square,
    holes: [
      [
        [-3, -3],
        [3, -3],
        [3, 3],
        [-3, 3],
      ],
    ],
  }

  it('adentro del borde externo y fuera del agujero -> true', () => {
    expect(pointInBoundary(8, 8, boundary)).toBe(true)
  })

  it('dentro del agujero -> false aunque este dentro del borde externo', () => {
    expect(pointInBoundary(0, 0, boundary)).toBe(false)
  })

  it('fuera del borde externo -> false', () => {
    expect(pointInBoundary(20, 20, boundary)).toBe(false)
  })
})

describe('polygonBounds', () => {
  it('calcula el rectangulo envolvente correcto', () => {
    const b = polygonBounds(square)
    expect(b).toEqual({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 })
  })
})

describe('polygonArea', () => {
  it('cuadrado de 20x20 -> area 400', () => {
    expect(polygonArea(square)).toBeCloseTo(400, 6)
  })

  it('triangulo rectangulo de catetos 10 y 10 -> area 50', () => {
    expect(polygonArea(triangle)).toBeCloseTo(50, 6)
  })
})

describe('fitBoundaryToWidth', () => {
  it('escala y centra preservando la proporcion', () => {
    const rect: Vec2[] = [
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50],
    ]
    const fitted = fitBoundaryToWidth(rect, [], 50)
    expect(fitted.widthMm).toBeCloseTo(50, 6)
    expect(fitted.heightMm).toBeCloseTo(25, 6) // proporcion 2:1 preservada
    const b = polygonBounds(fitted.outer)
    expect(b.minX + b.maxX).toBeCloseTo(0, 6) // centrado en X
    expect(b.minZ + b.maxZ).toBeCloseTo(0, 6) // centrado en Z
  })

  it('reescala los agujeros con el mismo factor y centro que el borde externo', () => {
    const rect: Vec2[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]
    const hole: Vec2[] = [
      [40, 40],
      [60, 40],
      [60, 60],
      [40, 60],
    ]
    const fitted = fitBoundaryToWidth(rect, [hole], 50)
    // el agujero (originalmente centrado en el rectangulo) sigue centrado
    const hb = polygonBounds(fitted.holes[0])
    expect(hb.minX + hb.maxX).toBeCloseTo(0, 6)
    expect(hb.minZ + hb.maxZ).toBeCloseTo(0, 6)
    expect(hb.maxX - hb.minX).toBeCloseTo(10, 6) // 20 * (50/100)
  })
})

describe('rescaleBoundary', () => {
  it('multiplica todos los puntos por el factor', () => {
    const { outer } = rescaleBoundary(square, [], 2)
    expect(polygonBounds(outer)).toEqual({ minX: -20, maxX: 20, minZ: -20, maxZ: 20 })
  })
})

import { describe, expect, it } from 'vitest'
import { useAppStore } from '../store'
import type { Vec2 } from '../../geometry/polygon'

const rect = (w: number, h: number, x = 0): Vec2[] => [
  [x, 0],
  [x + w, 0],
  [x + w, h],
  [x, h],
]

describe('base personalizada con varias piezas', () => {
  const pieces = [
    { outer: rect(100, 40), holes: [] },
    { outer: rect(50, 50, 200), holes: [] },
  ]

  it('sin unidades: la primera pieza al ancho pedido; al cambiar, misma escala', () => {
    const s = useAppStore.getState()
    s.setBaseShape({ pieces }, 300, 'patron.svg')
    let b = useAppStore.getState().baseShape!
    expect(b.pieceIndex).toBe(0)
    expect(b.widthMm).toBeCloseTo(300, 6)
    useAppStore.getState().selectBasePiece(1)
    b = useAppStore.getState().baseShape!
    expect(b.pieceIndex).toBe(1)
    expect(b.widthMm).toBeCloseTo(150, 6) // 50 unidades x 3 mm/unidad
    expect(b.heightMm).toBeCloseTo(150, 6)
  })

  it('con unidades: medida real; el ancho elegido a mano se conserva al cambiar', () => {
    useAppStore.getState().setBaseShape({ pieces, mmPerUnit: 10 }, 200, 'patron.dxf')
    expect(useAppStore.getState().baseShape!.widthMm).toBeCloseTo(1000, 6)
    useAppStore.getState().setBaseShapeWidthMm(500) // 5 mm/unidad
    useAppStore.getState().selectBasePiece(1)
    expect(useAppStore.getState().baseShape!.widthMm).toBeCloseTo(250, 6)
    expect(useAppStore.getState().baseShape!.pieces).toHaveLength(2)
  })
})

describe('atractores del modo laser acompanan el tamano de la pieza', () => {
  it('probeta 200 mm -> base de 1200 mm: posiciones y radios x6; reset no escala', () => {
    const st = useAppStore.getState
    st().reset()
    const before = st().laserAttractors
    st().setLaserPiece('custom')
    st().setBaseShape({ pieces: [{ outer: rect(1200, 600), holes: [] }], mmPerUnit: 1 }, 200, 'falda.pdf')
    const after = st().laserAttractors
    expect(after).toHaveLength(before.length)
    after.forEach((a, k) => {
      const b = before[k]
      expect(a.radius).toBeCloseTo(b.radius * 6, 6)
      if (a.kind === 'point' && b.kind === 'point') expect(a.position.x).toBeCloseTo(b.position.x * 6, 6)
      if (a.kind === 'curve' && b.kind === 'curve') expect(a.points[0].z).toBeCloseTo(b.points[0].z * 6, 6)
    })
    st().reset()
    expect(st().laserAttractors[0].radius).toBeCloseTo(before[0].radius, 6)
  })
})

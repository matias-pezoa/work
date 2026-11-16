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

import { describe, expect, it } from 'vitest'
import { buildLaserCut, DEFAULT_LASER } from '../laserCut'
import { specimenFileName, specimenParams, SPECIMEN_SIZE_MM } from '../laserSpecimens'
import { textToStrokes, strokeTextWidth } from '../strokeFont'
import { laserToAi } from '../../io/exportLaser'
import { polygonBounds } from '../polygon'

describe('probeta 20 x 20', () => {
  it('fija la pieza en 200 x 200 sin tocar el resto del diseno', () => {
    const laser = { ...DEFAULT_LASER, sheetWidthMm: 300, sheetHeightMm: 120 }
    const p = specimenParams(laser)
    expect(p.sheetWidthMm).toBe(SPECIMEN_SIZE_MM)
    expect(p.sheetHeightMm).toBe(SPECIMEN_SIZE_MM)
    expect({ ...p, sheetWidthMm: 300, sheetHeightMm: 120 }).toEqual(laser)
  })

  it('el corte resultante mide 200 x 200', () => {
    const r = buildLaserCut(
      [],
      specimenParams({ ...DEFAULT_LASER, distribution: 'uniform' }),
    )
    const b = polygonBounds(r.sheet.outer)
    expect(b.maxX - b.minX).toBeCloseTo(200)
    expect(b.maxZ - b.minZ).toBeCloseTo(200)
  })

  it('nombre de archivo: apellido_probeta_numero', () => {
    expect(specimenFileName('Pezoa', 3)).toBe('Pezoa_probeta_03')
    expect(specimenFileName(' Muñoz Pérez ', 12)).toBe('Munoz-Perez_probeta_12')
    expect(specimenFileName('  ', 1)).toBe('probeta_01')
  })
})

describe('tipografia de trazo', () => {
  it('genera trazos dentro de la caja del texto', () => {
    const strokes = textToStrokes({
      x: 0,
      z: 10,
      text: '#12 Puente',
      sizeMm: 5,
      anchor: 'start',
    })
    expect(strokes.length).toBeGreaterThan(5)
    const b = polygonBounds(strokes.flat())
    expect(b.minX).toBeGreaterThanOrEqual(0)
    expect(b.maxX).toBeLessThanOrEqual(strokeTextWidth('#12 Puente', 5) + 1e-9)
    expect(b.maxZ).toBeLessThanOrEqual(10 + 1e-9)
  })
})

describe('export AI (Illustrator 3)', () => {
  const r = buildLaserCut(
    [],
    specimenParams({ ...DEFAULT_LASER, distribution: 'uniform' }),
  )

  it('cabecera EPS, mesa en puntos, grupos por color, contorno al final', () => {
    const ai = laserToAi(r, 'Pezoa_probeta_01', [], 0)
    expect(
      ai.startsWith('%!PS-Adobe-2.0 EPSF-1.2\n%%Creator: Adobe Illustrator(TM) 3.2'),
    ).toBe(true)
    expect(ai).toContain('%%Title: (Pezoa_probeta_01)')
    expect(ai).toContain('1 1 0 0 K') // calado
    expect(ai).toContain('0 1 1 0 K') // contorno
    expect(ai.indexOf('1 1 0 0 K')).toBeLessThan(ai.indexOf('0 1 1 0 K'))
    expect(ai.trimEnd().endsWith('%%EOF')).toBe(true)
    const groups = ai.split('\n').filter((l) => l === 'u').length
    expect(groups).toBe(ai.split('\n').filter((l) => l === 'U').length)
  })

  it('grabado en negro antes de los cortes', () => {
    const ai = laserToAi(r, 'x', [{ x: 10, z: 10, text: '#1', sizeMm: 4 }], 0)
    expect(ai.indexOf('0 0 0 1 K')).toBeLessThan(ai.indexOf('1 1 0 0 K'))
  })
})

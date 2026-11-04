import { describe, expect, it } from 'vitest'
import { buildLaserCut, DEFAULT_LASER, type CutPath, type LaserParams } from '../laserCut'
import {
  createImageSampler,
  imageRect,
  rgbaToLuminance,
  toOneBit,
  toneToDarkness,
  type LaserBitmap,
} from '../laserImage'
import { distanceToSegment, polygonArea, polygonBounds, rectBoundary } from '../polygon'

const params = (patch: Partial<LaserParams>): LaserParams => ({
  ...DEFAULT_LASER,
  family: 'image',
  ...patch,
})

/** Degradado horizontal: blanco a la izquierda, negro a la derecha. */
function gradient(w = 60, h = 40): LaserBitmap {
  const lum = new Float32Array(w * h)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) lum[j * w + i] = 1 - i / (w - 1)
  return { width: w, height: h, lum }
}

function solid(v: number, w = 10, h = 10): LaserBitmap {
  return { width: w, height: h, lum: new Float32Array(w * h).fill(v) }
}

function minGap(paths: readonly CutPath[]): number {
  let best = Infinity
  const cx = (p: CutPath) => polygonBounds(p.points)
  for (let a = 0; a < paths.length; a++) {
    const ba = cx(paths[a])
    for (let b = a + 1; b < paths.length; b++) {
      const bb = cx(paths[b])
      if (bb.minX - ba.maxX > best || ba.minX - bb.maxX > best) continue
      if (bb.minZ - ba.maxZ > best || ba.minZ - bb.maxZ > best) continue
      for (const [P, Q] of [
        [paths[a], paths[b]],
        [paths[b], paths[a]],
      ]) {
        for (const v of P.points) {
          for (let k = 0; k < Q.points.length; k++) {
            const e0 = Q.points[k]
            const e1 = Q.points[(k + 1) % Q.points.length]
            best = Math.min(best, distanceToSegment(v[0], v[1], e0, e1))
          }
        }
      }
    }
  }
  return best
}

describe('laserImage: tono y muestreo', () => {
  const tone = {
    imgContrast: 1,
    imgBrightness: 0,
    imgGamma: 1,
    imgInvert: false,
    imgScale: 1,
    imgOffsetXMm: 0,
    imgOffsetZMm: 0,
  }

  it('oscuridad = 1 - luminancia, invertir la da vuelta', () => {
    expect(toneToDarkness(0, tone)).toBeCloseTo(1)
    expect(toneToDarkness(1, tone)).toBeCloseTo(0)
    expect(toneToDarkness(0.25, { ...tone, imgInvert: true })).toBeCloseTo(0.25)
  })

  it('contraste alto empuja los grises a los extremos', () => {
    expect(toneToDarkness(0.4, { ...tone, imgContrast: 4 })).toBeGreaterThan(
      toneToDarkness(0.4, tone),
    )
  })

  it('la imagen cubre la pieza (cover) manteniendo proporcion', () => {
    const sheet = { minX: -150, maxX: 150, minZ: -100, maxZ: 100 }
    const r = imageRect({ width: 100, height: 100 }, sheet, tone)
    expect(r.w).toBeCloseTo(300)
    expect(r.h).toBeCloseTo(300)
    expect(r.x + r.w / 2).toBeCloseTo(0)
  })

  it('el muestreador sigue el degradado y fuera de la imagen es blanco', () => {
    const sheet = { minX: -30, maxX: 30, minZ: -20, maxZ: 20 }
    const s = createImageSampler(gradient(), sheet, tone)
    expect(s.darkness(-29, 0)).toBeLessThan(0.1)
    expect(s.darkness(29, 0)).toBeGreaterThan(0.9)
    expect(s.darkness(0, 0, 6)).toBeCloseTo(0.5, 1)
    expect(s.darkness(500, 0)).toBe(0)
  })

  it('rgbaToLuminance compone el alfa sobre blanco', () => {
    const lum = rgbaToLuminance([0, 0, 0, 255, 0, 0, 0, 0], 2, 1)
    expect(lum[0]).toBeCloseTo(0)
    expect(lum[1]).toBeCloseTo(1)
  })
})

describe('laserImage: mapa de bits de 1 bit', () => {
  it('umbral: todo o nada', () => {
    expect(toOneBit([[0.2, 0.8]], 0.5, false)).toEqual([[false, true]])
  })

  it('tramado conserva el gris medio como densidad (~50%)', () => {
    const grid = Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => 0.5))
    const on = toOneBit(grid, 0.5, true).flat().filter(Boolean).length
    expect(on / 400).toBeGreaterThan(0.4)
    expect(on / 400).toBeLessThan(0.6)
  })
})

describe('familia imagen', () => {
  const base = { boundary: rectBoundary(200, 120) }

  it('sin imagen no corta nada', () => {
    const r = buildLaserCut([], params({}), base)
    expect(r.calados).toBe(0)
  })

  it('imagen blanca no corta, negra cala toda la pieza', () => {
    expect(buildLaserCut([], params({}), { ...base, image: solid(1) }).calados).toBe(0)
    expect(
      buildLaserCut([], params({}), { ...base, image: solid(0) }).calados,
    ).toBeGreaterThan(100)
  })

  it('semitono: lo oscuro cala mas que lo claro', () => {
    const r = buildLaserCut([], params({ imgMode: 'halftone' }), {
      ...base,
      image: gradient(),
    })
    const area = (side: 'left' | 'right') =>
      r.paths
        .filter((p) => p.layer === 'calado')
        .filter((p) => {
          const b = polygonBounds(p.points)
          return side === 'left' ? b.maxX < -20 : b.minX > 20
        }).length
    expect(area('right')).toBeGreaterThan(area('left'))
  })

  for (const mode of ['halftone', 'threshold', 'dither'] as const) {
    for (const sides of [4, 24]) {
      it(`${mode} (${sides} lados) respeta el puente minimo`, () => {
        const p = params({
          imgMode: mode,
          imgSides: sides,
          imgPitchMm: 6,
          minBridgeMm: 2,
        })
        const r = buildLaserCut([], p, { ...base, image: solid(0) })
        const holes = r.paths.filter((q) => q.layer === 'calado')
        expect(holes.length).toBeGreaterThan(10)
        // el archivo esta compensado: el aire real es el gap + kerf
        expect(minGap(holes) + p.kerfMm).toBeGreaterThanOrEqual(2 - 1e-6)
      })
    }
  }

  it('determinista', () => {
    const p = params({ imgMode: 'dither' })
    const a = buildLaserCut([], p, { ...base, image: gradient() })
    const b = buildLaserCut([], p, { ...base, image: gradient() })
    expect(a.paths).toEqual(b.paths)
  })
})

describe('imagen como campo', () => {
  it('el calado sigue la imagen e ignora los atractores', () => {
    const p: LaserParams = {
      ...DEFAULT_LASER,
      family: 'perforation',
      imgAsField: true,
      distribution: 'field',
    }
    const r = buildLaserCut([], p, {
      boundary: rectBoundary(200, 120),
      image: gradient(),
    })
    const holes = r.paths.filter((q) => q.layer === 'calado')
    expect(holes.length).toBeGreaterThan(0)
    const areaWhere = (test: (cx: number) => boolean) =>
      holes
        .filter((q) => {
          const b = polygonBounds(q.points)
          return test((b.minX + b.maxX) / 2)
        })
        .reduce((s, q) => s + polygonArea(q.points), 0)
    const left = areaWhere((x) => x < -40)
    const right = areaWhere((x) => x > 40)
    expect(right).toBeGreaterThan(left)
    expect(r.fieldAttractors).toHaveLength(0)
  })

  it('sin imagen cargada, imgAsField no cambia nada', () => {
    const p: LaserParams = { ...DEFAULT_LASER, imgAsField: true }
    const a = buildLaserCut([], p, {})
    const b = buildLaserCut([], { ...p, imgAsField: false }, {})
    expect(a.paths).toEqual(b.paths)
  })
})

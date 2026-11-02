import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  buildLaserCut,
  DEFAULT_LASER,
  hingeAsModule,
  type CutPath,
  type LaserParams,
} from '../laserCut'
import { createAttractor, type Attractor } from '../attractionField'
import {
  HINGE_LABELS,
  segmentDistance,
  symmetrizeAttractors,
  type HingePattern,
} from '../laserPattern'
import { buildSwatchSheet, SWATCH_SPACINGS_MM } from '../laserSwatch'
import { distanceToBoundaryEdges, pointInBoundary, type Vec2 } from '../polygon'

const params = (patch: Partial<LaserParams>): LaserParams => ({
  ...DEFAULT_LASER,
  ...patch,
})

const center: Attractor[] = [
  createAttractor(new THREE.Vector3(0, 0, 0), {
    radius: 14,
    strength: 1,
    falloff: 'linear',
  }),
]

const edges = (p: CutPath): [Vec2, Vec2][] => {
  const out: [Vec2, Vec2][] = []
  for (let i = 1; i < p.points.length; i++) out.push([p.points[i - 1], p.points[i]])
  if (p.closed) out.push([p.points[p.points.length - 1], p.points[0]])
  return out
}

/**
 * Material real minimo entre trazos interiores de DISTINTOS elementos: el
 * gap del archivo menos kerf/2 por cada lado abierto. Trazos que se tocan
 * (gap ~0) son partes del mismo elemento (horquillas de la cruz) y se ignoran.
 */
function minRealBridge(paths: CutPath[], kerf: number): number {
  const interior = paths.filter((p) => p.layer !== 'contorno')
  const boxes = interior.map((p) => {
    const xs = p.points.map((q) => q[0])
    const zs = p.points.map((q) => q[1])
    return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  })
  let best = Infinity
  for (let i = 0; i < interior.length; i++) {
    for (let j = i + 1; j < interior.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a[0] > b[1] + 10 || b[0] > a[1] + 10 || a[2] > b[3] + 10 || b[2] > a[3] + 10)
        continue
      let d = Infinity
      for (const [p, q] of edges(interior[i]))
        for (const [r, s] of edges(interior[j]))
          d = Math.min(d, segmentDistance(p, q, r, s))
      if (d < 0.05) continue
      const real =
        d - (interior[i].closed ? 0 : kerf / 2) - (interior[j].closed ? 0 : kerf / 2)
      best = Math.min(best, real)
    }
  }
  return best
}

describe('bisagra kerf', () => {
  const patterns = Object.keys(HINGE_LABELS) as HingePattern[]

  for (const pattern of patterns) {
    describe(pattern, () => {
      const kerf = 0.2
      const p = params({
        family: 'hinge',
        hingePattern: pattern,
        distribution: 'full',
        kerfMm: kerf,
        minBridgeMm: 1.5,
        sheetWidthMm: 200,
        sheetHeightMm: 140,
      })
      const r = buildLaserCut(center, p)

      it('genera cortes en toda la pieza', () => {
        expect(r.calados + r.cortes).toBeGreaterThan(10)
      })

      it('respeta el puente real entre elementos vecinos', () => {
        expect(minRealBridge(r.paths, kerf)).toBeGreaterThanOrEqual(1.5 - 1e-6)
      })

      it('nada se acerca al borde a menos del margen', () => {
        for (const path of r.paths.filter((x) => x.layer !== 'contorno'))
          for (const [x, z] of path.points) {
            expect(pointInBoundary(x, z, r.sheet)).toBe(true)
            expect(distanceToBoundaryEdges(x, z, r.sheet)).toBeGreaterThanOrEqual(
              p.edgeMarginMm - 1e-6,
            )
          }
      })
    })
  }

  it('la separacion entre filas nunca baja de puente + kerf en cortes rectos', () => {
    const r = buildLaserCut(
      [],
      params({
        family: 'hinge',
        distribution: 'uniform',
        hingeSpacingMm: 0.5,
        minBridgeMm: 2,
        kerfMm: 0.3,
      }),
    )
    expect(r.limitedByBridge).toBeGreaterThan(0)
    expect(minRealBridge(r.paths, 0.3)).toBeGreaterThanOrEqual(2 - 1e-6)
  })

  it('el campo achica el puente: cortes mas largos cerca del atractor', () => {
    const r = buildLaserCut(
      center,
      params({ family: 'hinge', distribution: 'full', kerfMm: 0 }),
    )
    const cuts = r.paths.filter((x) => x.layer === 'corte')
    const len = (c: CutPath) => Math.abs(c.points[1][0] - c.points[0][0])
    const mid = (c: CutPath) =>
      Math.hypot((c.points[0][0] + c.points[1][0]) / 2, c.points[0][1])
    const near = cuts.filter((c) => mid(c) < 20)
    const far = cuts.filter((c) => mid(c) > 120)
    expect(Math.max(...near.map(len))).toBeGreaterThan(Math.max(...far.map(len)))
  })

  // regresion: con fieltro (puente 3 mm) y separacion 2.5 mm, las figuras
  // cerradas no entraban y la pieza quedaba vacia.
  it('con el material y los valores por defecto todos los patrones cortan', () => {
    for (const hingePattern of Object.keys(HINGE_LABELS) as HingePattern[]) {
      const r = buildLaserCut(
        [],
        params({ family: 'hinge', hingePattern, distribution: 'uniform' }),
      )
      expect(r.calados + r.cortes, hingePattern).toBeGreaterThan(10)
    }
  })
})

describe('disposicion radial', () => {
  it('bisagra recta curvada: los cortes quedan sobre anillos alrededor del centro', () => {
    const r = buildLaserCut(
      [],
      params({
        family: 'hinge',
        distribution: 'uniform',
        layout: 'radial',
        radialStartMm: 20,
        kerfMm: 0,
      }),
    )
    const cuts = r.paths.filter((x) => x.layer === 'corte')
    expect(cuts.length).toBeGreaterThan(20)
    // cada corte curvado esta a radio ~constante (es un arco, no una recta)
    for (const c of cuts.slice(0, 50)) {
      const radii = c.points.map(([x, z]) => Math.hypot(x, z))
      expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.5)
    }
    expect(minRealBridge(r.paths, 0)).toBeGreaterThanOrEqual(
      DEFAULT_LASER.minBridgeMm - 1e-6,
    )
  })

  it('el calado radial respeta el puente', () => {
    const r = buildLaserCut(center, params({ layout: 'radial', kerfMm: 0 }))
    expect(r.calados).toBeGreaterThan(10)
    expect(minRealBridge(r.paths, 0)).toBeGreaterThanOrEqual(
      DEFAULT_LASER.minBridgeMm - 1e-6,
    )
  })
})

describe('simetria', () => {
  it('copia los atractores por el grupo (rotacion N, caleidoscopio 2N)', () => {
    const c = { x: 0, z: 0 }
    expect(symmetrizeAttractors(center, 'rotational', 5, c)).toHaveLength(5)
    expect(symmetrizeAttractors(center, 'kaleido', 4, c)).toHaveLength(8)
    expect(symmetrizeAttractors(center, 'mirrorXZ', 4, c)).toHaveLength(4)
  })

  it('espejo: un atractor de un lado produce cortes a ambos lados, reflejados', () => {
    const side = [
      createAttractor(new THREE.Vector3(-8, 0, 0), { radius: 4, falloff: 'linear' }),
    ]
    const r = buildLaserCut(side, params({ symmetry: 'mirrorX', kerfMm: 0 }))
    const centroids = r.paths
      .filter((p) => p.layer === 'calado')
      .map((p) => p.points.reduce((s, q) => s + q[0], 0) / p.points.length)
    const left = centroids.filter((x) => x < -1).length
    const right = centroids.filter((x) => x > 1).length
    expect(left).toBeGreaterThan(0)
    expect(right).toBe(left)
  })
})

describe('modulo personalizado', () => {
  it('repite el modulo y respeta el puente entre celdas', () => {
    const r = buildLaserCut(
      center,
      params({ family: 'module', distribution: 'full', kerfMm: 0.2 }),
    )
    expect(r.cortes).toBeGreaterThan(20)
    expect(minRealBridge(r.paths, 0.2)).toBeGreaterThanOrEqual(
      DEFAULT_LASER.minBridgeMm - 1e-6,
    )
  })

  it('un modulo cerrado genera calados', () => {
    const r = buildLaserCut(
      center,
      params({
        family: 'module',
        module: {
          paths: [
            {
              points: [
                [-0.5, 0],
                [0, -0.5],
                [0.5, 0],
                [0, 0.5],
              ],
              closed: true,
            },
          ],
        },
      }),
    )
    expect(r.calados).toBeGreaterThan(0)
    expect(r.openAreaMm2).toBeGreaterThan(0)
  })

  it('cualquier patron de bisagra sirve de punto de partida, dentro de la celda', () => {
    for (const hingePattern of Object.keys(HINGE_LABELS) as HingePattern[]) {
      const m = hingeAsModule(params({ hingePattern }))
      expect(m.paths.length).toBeGreaterThan(0)
      for (const s of m.paths)
        for (const [u, v] of s.points) {
          expect(Math.abs(u)).toBeLessThanOrEqual(0.5)
          expect(Math.abs(v)).toBeLessThanOrEqual(0.5)
        }
    }
  })
})

describe('kerf', () => {
  it('sin compensar, el contorno es el disenado', () => {
    const r = buildLaserCut([], params({ kerfCompensation: false, kerfMm: 0.5 }))
    expect(r.bounds.maxX - r.bounds.minX).toBeCloseTo(DEFAULT_LASER.sheetWidthMm, 6)
  })
})

describe('muestrario', () => {
  it('una tarjeta por separacion, con agujero, rotulos y contorno', () => {
    const sheet = buildSwatchSheet(params({ family: 'hinge' }), 'spacing')
    expect(sheet.cards).toBe(SWATCH_SPACINGS_MM.length)
    expect(sheet.paths.filter((p) => p.layer === 'contorno')).toHaveLength(sheet.cards)
    expect(sheet.labels).toHaveLength(2 * sheet.cards)
    expect(sheet.paths.filter((p) => p.layer === 'corte').length).toBeGreaterThan(
      sheet.cards,
    )
  })

  it('variante de patrones: una tarjeta por patron', () => {
    const sheet = buildSwatchSheet(params({ family: 'hinge' }), 'patterns')
    expect(sheet.cards).toBe(Object.keys(HINGE_LABELS).length)
  })
})

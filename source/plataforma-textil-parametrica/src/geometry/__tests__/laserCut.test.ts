import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  buildLaserCut,
  DEFAULT_LASER,
  MIN_FEATURE_MM,
  type CutPath,
  type LaserParams,
} from '../laserCut'
import { createAttractor, type Attractor } from '../attractionField'
import {
  distanceToBoundaryEdges,
  distanceToSegment,
  offsetPolygon,
  pointInBoundary,
  polygonArea,
  rectBoundary,
  type Boundary,
  type Vec2,
} from '../polygon'

const params = (patch: Partial<LaserParams>): LaserParams => ({
  ...DEFAULT_LASER,
  ...patch,
})

// un atractor grande en el centro: cubre casi toda la pieza de 300x200 mm.
const center: Attractor[] = [
  createAttractor(new THREE.Vector3(0, 0, 0), {
    radius: 14,
    strength: 1,
    falloff: 'linear',
  }),
]

/** Distancia minima entre dos trazos (vertice contra arista, en ambos sentidos). */
function pathDistance(a: CutPath, b: CutPath): number {
  const edges = (p: CutPath): [Vec2, Vec2][] => {
    const out: [Vec2, Vec2][] = []
    for (let i = 1; i < p.points.length; i++) out.push([p.points[i - 1], p.points[i]])
    if (p.closed) out.push([p.points[p.points.length - 1], p.points[0]])
    return out
  }
  let best = Infinity
  for (const [x, z] of a.points)
    for (const [s, e] of edges(b)) best = Math.min(best, distanceToSegment(x, z, s, e))
  for (const [x, z] of b.points)
    for (const [s, e] of edges(a)) best = Math.min(best, distanceToSegment(x, z, s, e))
  return best
}

/** Puente real minimo entre pares de trazos interiores. */
function minInteriorGap(paths: CutPath[]): number {
  const interior = paths.filter((p) => p.layer !== 'contorno')
  let best = Infinity
  for (let i = 0; i < interior.length; i++) {
    for (let j = i + 1; j < interior.length; j++) {
      // descarta pares lejanos rapido por su primer punto
      const [ax, az] = interior[i].points[0]
      const [bx, bz] = interior[j].points[0]
      if (Math.hypot(ax - bx, az - bz) > 80) continue
      best = Math.min(best, pathDistance(interior[i], interior[j]))
    }
  }
  return best
}

describe('polygon: offset y distancias', () => {
  it('offsetPolygon agranda y achica un cuadrado exactamente', () => {
    const sq = rectBoundary(10, 10).outer
    expect(polygonArea(offsetPolygon(sq, 1))).toBeCloseTo(144, 6)
    expect(polygonArea(offsetPolygon(sq, -1))).toBeCloseTo(64, 6)
    // la orientacion no cambia el sentido del offset
    expect(polygonArea(offsetPolygon([...sq].reverse(), 1))).toBeCloseTo(144, 6)
  })

  it('distanceToBoundaryEdges mide contra el contorno y los agujeros', () => {
    const b: Boundary = {
      outer: rectBoundary(100, 100).outer,
      holes: [rectBoundary(20, 20).outer],
    }
    expect(distanceToBoundaryEdges(30, 0, b)).toBeCloseTo(20, 6)
    expect(distanceToBoundaryEdges(45, 0, b)).toBeCloseTo(5, 6)
  })
})

describe('buildLaserCut — comun a todas las familias', () => {
  const families = ['perforation', 'kirigami', 'scales'] as const

  for (const family of families) {
    describe(family, () => {
      const p = params({ family, kerfMm: 0 })
      const r = buildLaserCut(center, p)

      it('genera cortes con un atractor', () => {
        expect(r.calados + r.cortes).toBeGreaterThan(10)
      })

      it('sin atractores no corta nada (la pieza queda entera)', () => {
        const empty = buildLaserCut([], p)
        expect(empty.calados + empty.cortes).toBe(0)
        expect(empty.paths.filter((x) => x.layer === 'contorno')).toHaveLength(1)
      })

      it('respeta el puente minimo entre cortes vecinos', () => {
        expect(minInteriorGap(r.paths)).toBeGreaterThanOrEqual(p.minBridgeMm - 1e-6)
      })

      it('ningun corte se acerca al borde a menos del margen', () => {
        for (const path of r.paths.filter((x) => x.layer !== 'contorno')) {
          for (const [x, z] of path.points) {
            expect(pointInBoundary(x, z, r.sheet)).toBe(true)
            expect(distanceToBoundaryEdges(x, z, r.sheet)).toBeGreaterThanOrEqual(
              p.edgeMarginMm - 1e-6,
            )
          }
        }
      })

      it('es determinista', () => {
        const again = buildLaserCut(center, p)
        expect(again.paths).toEqual(r.paths)
      })

      it('el contorno va al final del orden de corte', () => {
        const firstOutline = r.paths.findIndex((x) => x.layer === 'contorno')
        expect(r.paths.slice(firstOutline).every((x) => x.layer === 'contorno')).toBe(
          true,
        )
      })
    })
  }

  it('respeta el puente aun con kerf: se descuenta el ancho quemado', () => {
    for (const family of families) {
      const kerf = 0.4
      const p = params({ family, kerfMm: kerf, minBridgeMm: 2 })
      const r = buildLaserCut(center, p)
      // calados: ya compensados -> gap del archivo = puente real.
      // cortes abiertos: el haz quema kerf/2 a cada lado -> gap del archivo - kerf.
      const real = minInteriorGap(r.paths) - (family === 'perforation' ? 0 : kerf)
      expect(real).toBeGreaterThanOrEqual(2 - 1e-6)
    }
  })

  it('un contorno importado con agujero: nada se corta dentro del agujero', () => {
    const boundary: Boundary = {
      outer: rectBoundary(300, 200).outer,
      holes: [rectBoundary(60, 60).outer],
    }
    const r = buildLaserCut(center, params({ family: 'perforation' }), { boundary })
    const holeCut = r.paths.filter((x) => x.layer === 'contorno')
    expect(holeCut).toHaveLength(2)
    for (const path of r.paths.filter((x) => x.layer === 'calado')) {
      for (const [x, z] of path.points)
        expect(Math.max(Math.abs(x), Math.abs(z))).toBeGreaterThan(30)
    }
  })
})

describe('kerf', () => {
  it('achica los calados y agranda el contorno', () => {
    const p0 = buildLaserCut(center, params({ family: 'perforation', kerfMm: 0 }))
    const p1 = buildLaserCut(center, params({ family: 'perforation', kerfMm: 0.5 }))
    const area = (r: typeof p0, layer: string) =>
      r.paths
        .filter((x) => x.layer === layer)
        .reduce((s, x) => s + polygonArea(x.points), 0)
    expect(p1.calados).toBe(p0.calados)
    expect(area(p1, 'calado')).toBeLessThan(area(p0, 'calado'))
    expect(area(p1, 'contorno')).toBeGreaterThan(area(p0, 'contorno'))
    // el area calada reportada es la DISENADA, independiente del kerf
    expect(p1.openAreaMm2).toBeCloseTo(p0.openAreaMm2, 6)
  })
})

describe('calado', () => {
  it('ningun calado es menor que el rasgo minimo', () => {
    const r = buildLaserCut(
      center,
      params({ family: 'perforation', perfSizeMin: 0, kerfMm: 0 }),
    )
    for (const path of r.paths.filter((x) => x.layer === 'calado')) {
      expect(Math.sqrt(polygonArea(path.points))).toBeGreaterThan(MIN_FEATURE_MM * 0.5)
    }
    expect(r.skippedBySize).toBeGreaterThan(0)
  })

  it('cerca del atractor los calados son mas grandes que lejos', () => {
    const r = buildLaserCut(center, params({ family: 'perforation', kerfMm: 0 }))
    const calados = r.paths.filter((x) => x.layer === 'calado')
    const dist = (p: CutPath) => {
      const cx = p.points.reduce((s, q) => s + q[0], 0) / p.points.length
      const cz = p.points.reduce((s, q) => s + q[1], 0) / p.points.length
      return Math.hypot(cx, cz)
    }
    const near = calados.filter((p) => dist(p) < 30)
    const far = calados.filter((p) => dist(p) > 90)
    const mean = (ps: CutPath[]) =>
      ps.reduce((s, p) => s + polygonArea(p.points), 0) / ps.length
    expect(near.length).toBeGreaterThan(0)
    expect(far.length).toBeGreaterThan(0)
    expect(mean(near)).toBeGreaterThan(mean(far))
  })
})

describe('auxetico', () => {
  it('cortes rectos alternados horizontal / vertical', () => {
    const r = buildLaserCut(center, params({ family: 'kirigami' }))
    const cuts = r.paths.filter((x) => x.layer === 'corte')
    const horiz = cuts.filter((c) => Math.abs(c.points[0][1] - c.points[1][1]) < 1e-9)
    const vert = cuts.filter((c) => Math.abs(c.points[0][0] - c.points[1][0]) < 1e-9)
    expect(horiz.length + vert.length).toBe(cuts.length)
    expect(horiz.length).toBeGreaterThan(0)
    expect(vert.length).toBeGreaterThan(0)
    expect(cuts.every((c) => !c.closed && c.points.length === 2)).toBe(true)
  })

  it('la bisagra pedida bajo el puente se recorta y se informa', () => {
    const r = buildLaserCut(
      center,
      params({
        family: 'kirigami',
        kiriHingeNearMm: 1,
        kiriHingeFarMm: 1,
        minBridgeMm: 3,
      }),
    )
    expect(r.limitedByBridge).toBeGreaterThan(0)
  })
})

describe('huella de puas', () => {
  const footprints = [
    { x: 0, z: 0, rootRadiusMm: 6 },
    { x: 40, z: 0, rootRadiusMm: 6 },
    { x: 400, z: 0, rootRadiusMm: 6 }, // fuera de la pieza
    { x: 0, z: 2, rootRadiusMm: 6 }, // pegada a la primera: viola el puente
  ]

  it('un calado por pua dentro de la pieza, sin violar el puente', () => {
    const r = buildLaserCut(
      [],
      params({ family: 'footprint', footprintScale: 0.5, kerfMm: 0 }),
      {
        footprints,
        footprintPlaneMm: 300,
      },
    )
    expect(r.calados).toBe(2)
    expect(r.rejectedByEdge).toBe(1)
    expect(r.rejectedByBridge).toBe(1)
    // radio = 6 * 0.5
    const xs = r.paths[0].points.map((p) => p[0])
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(6, 1)
  })

  it('sin base importada usa el panel cuadrado del modo Volumen', () => {
    const r = buildLaserCut([], params({ family: 'footprint' }), {
      footprints: [],
      footprintPlaneMm: 300,
    })
    expect(r.bounds.maxZ - r.bounds.minZ).toBeCloseTo(300 + DEFAULT_LASER.kerfMm, 6)
  })
})

/**
 * Corte laser en un Web Worker (laserCut.worker.ts) con `LatestJobWorker`:
 * una pieza grande (una falda de 1,2 m) ya no congela la interfaz.
 */
import {
  buildLaserCut,
  type LaserCutResult,
  type LaserInput,
  type LaserParams,
} from '../geometry/laserCut'
import { reviveAttractor, type Attractor } from '../geometry/attractionField'
import { LatestJobWorker } from './latestJobWorker'

export interface LaserCutJob {
  attractors: readonly Attractor[]
  params: LaserParams
  input: LaserInput
}

export function computeLaserCutSync(job: LaserCutJob): LaserCutResult {
  return buildLaserCut(job.attractors, job.params, job.input)
}

export function createLaserCutClient(): LatestJobWorker<LaserCutJob, LaserCutResult> {
  return new LatestJobWorker<LaserCutJob, LaserCutResult>(
    () =>
      new Worker(new URL('./laserCut.worker.ts', import.meta.url), { type: 'module' }),
    computeLaserCutSync,
    (r) => ({ ...r, fieldAttractors: r.fieldAttractors.map(reviveAttractor) }),
  )
}

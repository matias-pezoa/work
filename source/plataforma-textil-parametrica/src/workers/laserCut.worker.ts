/**
 * Web Worker del modo Corte laser: corre `buildLaserCut` fuera del hilo
 * principal, para que la interfaz no se congele mientras se genera un
 * diseno grande (una falda de 1,2 m tarda decenas o cientos de ms por
 * cambio). Ver laserCutClient.ts.
 */
import { buildLaserCut } from '../geometry/laserCut'
import { reviveAttractor } from '../geometry/attractionField'
import type { LaserCutJob } from './laserCutClient'

self.onmessage = (e: MessageEvent<{ id: number; job: LaserCutJob }>) => {
  const { id, job } = e.data
  try {
    const result = buildLaserCut(
      job.attractors.map(reviveAttractor),
      job.params,
      job.input,
    )
    self.postMessage({ id, result })
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}

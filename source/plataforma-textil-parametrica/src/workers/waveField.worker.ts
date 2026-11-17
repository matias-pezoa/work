/**
 * Web Worker del modo Ondas: corre `buildWaveField` fuera del hilo principal
 * (con una base grande la malla tarda cientos de ms por cambio). La malla
 * viaja como arreglos tipados transferidos (sin copiarlos); ver
 * waveFieldClient.ts.
 */
import { buildWaveField } from '../geometry/waveField'
import { reviveAttractor } from '../geometry/attractionField'
import { packWaveResult, type WaveFieldJob } from './waveFieldClient'

self.onmessage = (e: MessageEvent<{ id: number; job: WaveFieldJob }>) => {
  const { id, job } = e.data
  try {
    const result = buildWaveField(
      job.attractors.map(reviveAttractor),
      job.params,
      job.boundary,
    )
    const { packed, transfer } = packWaveResult(result)
    result.geometry.dispose()
    self.postMessage({ id, result: packed }, { transfer })
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}

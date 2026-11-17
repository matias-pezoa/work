/**
 * Ondas en un Web Worker (waveField.worker.ts) con `LatestJobWorker`. Con
 * una base grande (una falda de 1,2 m) armar la malla tarda cientos de ms
 * por cambio: en el hilo principal eso congelaba la interfaz al arrastrar.
 *
 * `postMessage` no conserva BufferGeometry ni Box3: la malla se empaqueta
 * como arreglos tipados (transferidos, sin copia) y se rearma al llegar.
 */
import * as THREE from 'three'
import {
  buildWaveField,
  type WaveFieldParams,
  type WaveFieldResult,
} from '../geometry/waveField'
import type { Boundary } from '../geometry/polygon'
import type { Attractor } from '../geometry/attractionField'
import { LatestJobWorker } from './latestJobWorker'

export interface WaveFieldJob {
  attractors: readonly Attractor[]
  params: WaveFieldParams
  boundary: Boundary | null
}

interface PackedAttribute {
  array: THREE.TypedArray
  itemSize: number
  normalized: boolean
}

/** WaveFieldResult sin clases de three: lo que cruza el `postMessage`. */
export type PackedWaveResult = Omit<WaveFieldResult, 'geometry' | 'bounds'> & {
  attributes: Record<string, PackedAttribute>
  index: THREE.TypedArray | null
  bounds: { min: [number, number, number]; max: [number, number, number] }
}

export function packWaveResult(r: WaveFieldResult): {
  packed: PackedWaveResult
  transfer: ArrayBuffer[]
} {
  const { geometry, bounds, ...rest } = r
  const attributes: Record<string, PackedAttribute> = {}
  const transfer: ArrayBuffer[] = []
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    if (!(attr instanceof THREE.BufferAttribute)) continue
    attributes[name] = {
      array: attr.array,
      itemSize: attr.itemSize,
      normalized: attr.normalized,
    }
    transfer.push(attr.array.buffer as ArrayBuffer)
  }
  const index = geometry.index ? geometry.index.array : null
  if (index) transfer.push(index.buffer as ArrayBuffer)
  return {
    // un buffer compartido por dos atributos se transfiere una sola vez.
    transfer: [...new Set(transfer)],
    packed: {
      ...rest,
      attributes,
      index,
      bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    },
  }
}

export function unpackWaveResult(p: PackedWaveResult): WaveFieldResult {
  const { attributes, index, bounds, ...rest } = p
  const geometry = new THREE.BufferGeometry()
  for (const [name, a] of Object.entries(attributes))
    geometry.setAttribute(
      name,
      new THREE.BufferAttribute(a.array, a.itemSize, a.normalized),
    )
  if (index) geometry.setIndex(new THREE.BufferAttribute(index, 1))
  return {
    ...rest,
    geometry,
    bounds: new THREE.Box3(
      new THREE.Vector3(...bounds.min),
      new THREE.Vector3(...bounds.max),
    ),
  }
}

export function computeWaveFieldSync(job: WaveFieldJob): WaveFieldResult {
  return buildWaveField(job.attractors, job.params, job.boundary)
}

export function createWaveFieldClient(): LatestJobWorker<
  WaveFieldJob,
  WaveFieldResult,
  PackedWaveResult
> {
  return new LatestJobWorker<WaveFieldJob, WaveFieldResult, PackedWaveResult>(
    () =>
      new Worker(new URL('./waveField.worker.ts', import.meta.url), { type: 'module' }),
    computeWaveFieldSync,
    unpackWaveResult,
  )
}

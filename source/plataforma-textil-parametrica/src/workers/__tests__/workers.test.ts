import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { LatestJobWorker } from '../latestJobWorker'
import {
  computeWaveFieldSync,
  packWaveResult,
  unpackWaveResult,
} from '../waveFieldClient'
import { createAttractor, reviveAttractor } from '../../geometry/attractionField'
import { DEFAULT_WAVE_FIELD } from '../../geometry/waveField'

/** Worker de mentira: guarda lo que recibe y responde cuando se le pide. */
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  inbox: { id: number; job: number }[] = []
  postMessage(msg: { id: number; job: number }) {
    this.inbox.push(msg)
  }
  terminate() {}
  /** Responde el ultimo mensaje recibido con job * 10. */
  reply() {
    const msg = this.inbox[this.inbox.length - 1]
    this.onmessage?.({ data: { id: msg.id, result: msg.job * 10 } })
  }
}

describe('LatestJobWorker', () => {
  it('mientras calcula, los pedidos nuevos se pisan: solo va el ultimo', () => {
    const fake = new FakeWorker()
    const client = new LatestJobWorker<number, number>(
      () => fake as unknown as Worker,
      (n) => -n,
      (r) => r,
    )
    const got: number[] = []
    for (const n of [1, 2, 3, 4, 5]) client.run(n, (r) => got.push(r))
    expect(fake.inbox.map((m) => m.job)).toEqual([1]) // el 1 ya salio; 2..4 se pisaron
    fake.reply()
    expect(got).toEqual([10])
    expect(fake.inbox.map((m) => m.job)).toEqual([1, 5])
    fake.reply()
    expect(got).toEqual([10, 50])
  })

  it('sin worker posible calcula en el hilo principal', () => {
    const client = new LatestJobWorker<number, number>(
      () => {
        throw new Error('sin workers')
      },
      (n) => n + 1,
      (r) => r,
    )
    let got = 0
    client.run(41, (r) => (got = r))
    expect(got).toBe(42)
  })
})

describe('transferencia', () => {
  it('reviveAttractor rearma los Vector3 que postMessage deja como objetos planos', () => {
    const a = createAttractor(new THREE.Vector3(1, 2, 3))
    const plain = structuredClone(a)
    expect(plain.kind === 'point' && plain.position instanceof THREE.Vector3).toBe(false)
    const back = reviveAttractor(plain)
    expect(back.kind === 'point' && back.position instanceof THREE.Vector3).toBe(true)
    expect(back.kind === 'point' && back.position.distanceTo(a.position)).toBe(0)
  })

  it('la malla de Ondas sale igual tras empaquetarla y rearmarla', () => {
    const r = computeWaveFieldSync({
      attractors: [createAttractor(new THREE.Vector3(0, 0, 0), { radius: 6 })],
      params: DEFAULT_WAVE_FIELD,
      boundary: null,
    })
    const positions = Array.from(r.geometry.getAttribute('position').array)
    const { packed } = packWaveResult(r)
    const back = unpackWaveResult(structuredClone(packed))
    expect(Array.from(back.geometry.getAttribute('position').array)).toEqual(positions)
    expect(back.triangleCount).toBe(r.triangleCount)
    expect(back.bounds.equals(r.bounds)).toBe(true)
  })
})

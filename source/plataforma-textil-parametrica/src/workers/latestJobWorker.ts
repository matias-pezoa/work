/**
 * Corre calculos pesados en un Web Worker quedandose SIEMPRE con el ultimo
 * pedido: mientras el worker calcula, los pedidos nuevos se pisan entre si y
 * al terminar se manda solo el mas reciente. Asi, al arrastrar un slider no
 * se acumula una cola de calculos viejos: la vista muestra el ultimo
 * resultado listo y se pone al dia apenas se suelta.
 *
 * Si el navegador no puede crear el worker (o este falla), se calcula en el
 * hilo principal con `computeSync`, como antes.
 *
 * Protocolo con el worker: recibe `{ id, job }` y responde `{ id, result }` o
 * `{ id, error }`. `revive` rearma lo que `postMessage` no conserva (clases
 * como THREE.Vector3 o BufferGeometry).
 */
type Reply<Raw> = { id: number; result?: Raw; error?: string }

export class LatestJobWorker<Job, Result, Raw = Result> {
  private worker: Worker | null = null
  /** El navegador no pudo con el worker: todo en el hilo principal. */
  private failed = false
  private pending: { job: Job; done: (r: Result) => void } | null = null
  private current: { id: number; job: Job; done: (r: Result) => void } | null = null
  private nextId = 0
  private readonly create: () => Worker
  private readonly computeSync: (job: Job) => Result
  private readonly revive: (raw: Raw) => Result

  constructor(
    create: () => Worker,
    computeSync: (job: Job) => Result,
    revive: (raw: Raw) => Result,
  ) {
    this.create = create
    this.computeSync = computeSync
    this.revive = revive
  }

  /** Pide un calculo; `done` recibe el resultado (sincrono si no hay worker). */
  run(job: Job, done: (r: Result) => void): void {
    const worker = this.ensureWorker()
    if (!worker) {
      done(this.computeSync(job))
      return
    }
    this.pending = { job, done }
    this.pump()
  }

  /** Cierra el worker; un `run` posterior lo vuelve a crear. */
  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.current = null
    this.pending = null
  }

  private ensureWorker(): Worker | null {
    if (this.worker || this.failed) return this.worker
    try {
      const worker = this.create()
      worker.onmessage = (e: MessageEvent<Reply<Raw>>) => this.onReply(e.data)
      worker.onerror = () => this.fallback()
      this.worker = worker
    } catch {
      this.failed = true
    }
    return this.worker
  }

  private pump(): void {
    if (this.current || !this.pending || !this.worker) return
    const { job, done } = this.pending
    this.pending = null
    this.current = { id: ++this.nextId, job, done }
    this.worker.postMessage({ id: this.current.id, job })
  }

  private onReply(msg: Reply<Raw>): void {
    const current = this.current
    if (!current || msg.id !== current.id) return
    this.current = null
    // un resultado intermedio igual se muestra: da respuesta mientras se arrastra.
    current.done(
      msg.result !== undefined ? this.revive(msg.result) : this.computeSync(current.job),
    )
    this.pump()
  }

  /** El worker se cayo: se sigue en el hilo principal. */
  private fallback(): void {
    const last = this.pending ?? this.current
    this.failed = true
    this.dispose()
    if (last) last.done(this.computeSync(last.job))
  }
}

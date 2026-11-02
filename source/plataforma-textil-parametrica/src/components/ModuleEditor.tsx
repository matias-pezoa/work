/**
 * Editor del modulo de corte personalizado: una celda donde se dibujan
 * trazos (abiertos = cortes, cerrados = calados) que luego se repiten por la
 * disposicion del modo Corte laser. Alrededor se ven las celdas vecinas en
 * gris para leer como se encadena la repeticion.
 *
 * Interaccion: clic en la celda agrega un punto al trazo activo (o empieza
 * uno nuevo); arrastrar un punto lo mueve; clic derecho sobre un punto lo
 * borra; doble clic termina el trazo. Coordenadas normalizadas [-0.5, 0.5]^2
 * (+z hacia abajo, igual que la vista 2D).
 */
import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { LaserModule, Shape } from '../geometry/laserPattern'
import type { Vec2 } from '../geometry/polygon'
import { importSvgModule } from '../io/importSvg'

interface ModuleEditorProps {
  module: LaserModule
  cellW: number
  cellH: number
  stagger: number
  onChange: (module: LaserModule) => void
  /** Reemplaza el modulo por el elemento de la bisagra kerf actual. */
  onFromHinge: () => void
}

/** Subdivisiones de la grilla de ajuste por lado de celda. */
const SNAP_DIVISIONS = 12
/** Cuanto de las celdas vecinas se ve alrededor, en fraccion de celda. */
const PEEK = 0.4

export function ModuleEditor({
  module,
  cellW,
  cellH,
  stagger,
  onChange,
  onFromHinge,
}: ModuleEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const drag = useRef<{ path: number; index: number } | null>(null)
  const [active, setActive] = useState<number | null>(null)
  const [snap, setSnap] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const m = Math.max(cellW, cellH, 1e-9)
  const aw = cellW / m
  const ah = cellH / m
  const paths = module.paths
  const activePath = active !== null && active < paths.length ? active : null

  const toCell = (e: { clientX: number; clientY: number }): Vec2 => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    let u = Math.min(0.5, Math.max(-0.5, p.x / aw))
    let v = Math.min(0.5, Math.max(-0.5, p.y / ah))
    if (snap) {
      u = Math.round(u * SNAP_DIVISIONS) / SNAP_DIVISIONS
      v = Math.round(v * SNAP_DIVISIONS) / SNAP_DIVISIONS
    }
    return [u, v]
  }

  const setPaths = (next: Shape[]) => onChange({ paths: next })

  const onBackgroundDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const p = toCell(e)
    if (activePath === null) {
      setPaths([...paths, { points: [p], closed: false }])
      setActive(paths.length)
    } else {
      setPaths(
        paths.map((s, k) => (k === activePath ? { ...s, points: [...s.points, p] } : s)),
      )
    }
  }

  const onPointDown = (e: ReactPointerEvent, path: number, index: number) => {
    e.stopPropagation()
    if (e.button !== 0) return
    setActive(path)
    drag.current = { path, index }
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    const p = toCell(e)
    setPaths(
      paths.map((s, k) =>
        k === d.path
          ? { ...s, points: s.points.map((q, i) => (i === d.index ? p : q)) }
          : s,
      ),
    )
  }

  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    drag.current = null
    if (svgRef.current?.hasPointerCapture(e.pointerId))
      svgRef.current.releasePointerCapture(e.pointerId)
  }

  const removePoint = (path: number, index: number) => {
    const s = paths[path]
    const pts = s.points.filter((_, i) => i !== index)
    if (pts.length === 0) {
      setPaths(paths.filter((_, k) => k !== path))
      setActive(null)
    } else {
      setPaths(
        paths.map((q, k) =>
          k === path ? { points: pts, closed: q.closed && pts.length >= 3 } : q,
        ),
      )
    }
  }

  const d = (s: Shape, dx = 0, dz = 0) =>
    s.points.length
      ? s.points
          .map(([u, v], i) => `${i ? 'L' : 'M'}${(u + dx) * aw} ${(v + dz) * ah}`)
          .join('') + (s.closed ? 'Z' : '')
      : ''

  // celdas vecinas: misma fila a +-1, filas de arriba/abajo con el desfase.
  const neighbors: Vec2[] = [
    [-1, 0],
    [1, 0],
    [stagger - 1, -1],
    [stagger, -1],
    [stagger - 1, 1],
    [stagger, 1],
  ]
  const ghostD = neighbors.flatMap(([dx, dz]) => paths.map((s) => d(s, dx, dz))).join('')

  const vbX = -(0.5 + PEEK) * aw
  const vbY = -(0.5 + PEEK) * ah
  const handle = 0.022

  const onImport = async (file: File | undefined) => {
    if (!file) return
    try {
      const strokes = await importSvgModule(file)
      setPaths(strokes)
      setActive(null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer el SVG.')
    }
  }

  return (
    <div className="module-editor">
      <svg
        ref={svgRef}
        viewBox={`${vbX} ${vbY} ${(1 + 2 * PEEK) * aw} ${(1 + 2 * PEEK) * ah}`}
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setActive(null)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {snap &&
          Array.from({ length: SNAP_DIVISIONS + 1 }, (_, k) => {
            const t = k / SNAP_DIVISIONS - 0.5
            return (
              <g key={k} className="module-snap">
                <line x1={t * aw} y1={-0.5 * ah} x2={t * aw} y2={0.5 * ah} />
                <line x1={-0.5 * aw} y1={t * ah} x2={0.5 * aw} y2={t * ah} />
              </g>
            )
          })}
        <rect
          x={-0.5 * aw}
          y={-0.5 * ah}
          width={aw}
          height={ah}
          className="module-cell"
        />
        <path d={ghostD} className="module-ghost" />
        {paths.map((s, k) => (
          <path
            key={k}
            d={d(s)}
            className={`module-path${s.closed ? ' closed' : ''}${k === activePath ? ' active' : ''}`}
          />
        ))}
        {paths.map((s, k) =>
          s.points.map(([u, v], i) => (
            <circle
              key={`${k}-${i}`}
              cx={u * aw}
              cy={v * ah}
              r={handle}
              className={`module-handle${k === activePath ? ' active' : ''}`}
              onPointerDown={(e) => onPointDown(e, k, i)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                removePoint(k, i)
              }}
            />
          )),
        )}
      </svg>

      <div className="row">
        <button type="button" onClick={() => setActive(null)}>
          Nuevo trazo
        </button>
        <button
          type="button"
          disabled={activePath === null || paths[activePath].points.length < 3}
          onClick={() =>
            activePath !== null &&
            setPaths(
              paths.map((s, k) => (k === activePath ? { ...s, closed: !s.closed } : s)),
            )
          }
        >
          {activePath !== null && paths[activePath].closed ? 'Abrir' : 'Cerrar'}
        </button>
        <button
          type="button"
          disabled={activePath === null}
          onClick={() => {
            if (activePath === null) return
            setPaths(paths.filter((_, k) => k !== activePath))
            setActive(null)
          }}
        >
          Borrar trazo
        </button>
      </div>
      <div className="row">
        <button
          type="button"
          onClick={() => {
            setPaths([])
            setActive(null)
          }}
        >
          Limpiar
        </button>
        <button
          type="button"
          onClick={() => {
            onFromHinge()
            setActive(null)
          }}
        >
          Desde bisagra
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          Importar SVG
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".svg,image/svg+xml"
        hidden
        onChange={(e) => {
          void onImport(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <label className="check">
        <input type="checkbox" checked={snap} onChange={() => setSnap(!snap)} />
        Ajustar a grilla ({SNAP_DIVISIONS}x{SNAP_DIVISIONS})
      </label>
      {error && <p className="hint error">{error}</p>}
    </div>
  )
}

/**
 * Vista 2D del modo Corte laser: la pieza a escala real (mm) con grilla de
 * 10 mm, los trazos de corte por capa y los atractores editables.
 *
 * Interaccion: arrastrar un atractor (o un punto de control de una curva) lo
 * mueve; arrastrar el fondo desplaza la vista; la rueda hace zoom alrededor
 * del cursor; doble clic en el fondo vuelve a encuadrar la pieza. A
 * diferencia del viewport 3D, aca los atractores son elementos SVG propios,
 * asi que no existe el problema del gizmo que "atraviesa" el clic (ver
 * CLAUDE.md, seccion Interaccion).
 *
 * Clic derecho: agrega un punto a la curva seleccionada (o un atractor punto
 * si no hay curva seleccionada), ver `addAtPoint`. Las curvas se dibujan con
 * `curvePath`, la misma polilinea que usa el campo. Manejador circular =
 * vertice suave, cuadrado = esquina.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import * as THREE from 'three'
import { curvePath } from '../geometry/attractionField'
import { addAtPoint, type AttractorSet } from '../state/attractorSets'
import { LAYER_ORDER } from '../geometry/laserCut'
import type { LaserCutResult } from '../geometry/laserCut'
import type { Vec2 } from '../geometry/polygon'
import { pathData } from '../io/exportLaser'
import { mmToThree, threeToMm } from '../utils/units'

interface LaserViewProps {
  result: LaserCutResult
  /** null = la familia no usa atractores (huella de puas). */
  set: AttractorSet | null
}

/** Aire alrededor de la pieza al encuadrar, en mm. */
const FIT_PAD_MM = 20
/** Radio de los manejadores de atractor, en px de pantalla. */
const HANDLE_PX = 7

type Drag =
  | { kind: 'attractor'; id: string; index: number }
  | { kind: 'pan'; clientX: number; clientY: number; center: Vec2 }

export function LaserView({ result, set }: LaserViewProps) {
  const attractors = set?.attractors ?? null
  const selectedId = set?.selectedId ?? null
  const selectedPointIndex = set?.selectedPointIndex ?? null
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [zoom, setZoom] = useState(1)
  const [center, setCenter] = useState<Vec2 | null>(null)

  const { minX, maxX, minZ, maxZ } = result.bounds
  const fitCenter: Vec2 = [(minX + maxX) / 2, (minZ + maxZ) / 2]
  const c = center ?? fitCenter

  // encuadre: la pieza + aire entra completa respetando la proporcion del contenedor.
  const fitW = Math.max(
    maxX - minX + 2 * FIT_PAD_MM,
    ((maxZ - minZ + 2 * FIT_PAD_MM) * size.w) / size.h,
  )
  const vbW = fitW / zoom
  const vbH = (vbW * size.h) / size.w
  const mmPerPx = vbW / size.w

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ w: width, h: height })
    })
    ro.observe(svg)
    return () => ro.disconnect()
  }, [])

  // rueda: listener nativo no pasivo, para poder evitar el scroll de la pagina.
  const view = useRef({ c, zoom, vbW, vbH })
  useEffect(() => {
    view.current = { c, zoom, vbW, vbH }
  })
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = view.current
      const rect = svg.getBoundingClientRect()
      const px = v.c[0] + ((e.clientX - rect.left) / rect.width - 0.5) * v.vbW
      const pz = v.c[1] + ((e.clientY - rect.top) / rect.height - 0.5) * v.vbH
      const next = Math.min(40, Math.max(0.25, v.zoom * Math.exp(-e.deltaY * 0.0015)))
      const k = v.zoom / next
      // el punto bajo el cursor queda fijo
      setCenter([px + (v.c[0] - px) * k, pz + (v.c[1] - pz) * k])
      setZoom(next)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  const toMm = (clientX: number, clientY: number): Vec2 => {
    const rect = svgRef.current!.getBoundingClientRect()
    return [
      c[0] + ((clientX - rect.left) / rect.width - 0.5) * vbW,
      c[1] + ((clientY - rect.top) / rect.height - 0.5) * vbH,
    ]
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    if (d.kind === 'pan') {
      setCenter([
        d.center[0] - (e.clientX - d.clientX) * mmPerPx,
        d.center[1] - (e.clientY - d.clientY) * mmPerPx,
      ])
      return
    }
    const a = attractors?.find((at) => at.id === d.id)
    if (!a) return
    const [x, z] = toMm(e.clientX, e.clientY)
    const p = new THREE.Vector3(mmToThree(x), 0, mmToThree(z))
    if (a.kind === 'point') set?.update(a.id, { position: p })
    else set?.update(a.id, { points: a.points.map((q, i) => (i === d.index ? p : q)) })
  }

  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    drag.current = null
    if (svgRef.current?.hasPointerCapture(e.pointerId)) {
      svgRef.current.releasePointerCapture(e.pointerId)
    }
  }

  const startAttractorDrag = (e: ReactPointerEvent, id: string, index: number) => {
    e.stopPropagation()
    if (e.button !== 0) return
    set?.select(id, index)
    drag.current = { kind: 'attractor', id, index }
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  const layerPaths = useMemo(
    () =>
      LAYER_ORDER.map((layer) => ({
        layer,
        d: result.paths
          .filter((p) => p.layer === layer)
          .map(pathData)
          .join(''),
      })),
    [result.paths],
  )

  const sheetD = useMemo(() => {
    const ring = (pts: readonly Vec2[]) =>
      pts.length ? pathData({ layer: 'contorno', points: [...pts], closed: true }) : ''
    return ring(result.sheet.outer) + result.sheet.holes.map(ring).join('')
  }, [result.sheet])

  const handleR = HANDLE_PX * mmPerPx

  return (
    <svg
      ref={svgRef}
      className="laser-view"
      viewBox={`${c[0] - vbW / 2} ${c[1] - vbH / 2} ${vbW} ${vbH}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        set?.select(null)
        drag.current = { kind: 'pan', clientX: e.clientX, clientY: e.clientY, center: c }
        svgRef.current?.setPointerCapture(e.pointerId)
      }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onContextMenu={(e) => {
        e.preventDefault()
        if (!set) return
        const [x, z] = toMm(e.clientX, e.clientY)
        addAtPoint(set, new THREE.Vector3(mmToThree(x), 0, mmToThree(z)), 0)
      }}
      onDoubleClick={() => {
        setZoom(1)
        setCenter(null)
      }}
    >
      <defs>
        <pattern id="laser-grid" width={10} height={10} patternUnits="userSpaceOnUse">
          <path d="M10 0H0V10" className="laser-grid-line" />
        </pattern>
      </defs>

      <path d={sheetD} className="laser-sheet" fillRule="evenodd" />
      <path d={sheetD} fill="url(#laser-grid)" fillRule="evenodd" />

      {layerPaths.map(({ layer, d }) =>
        d ? <path key={layer} d={d} className={`laser-cut laser-cut-${layer}`} /> : null,
      )}

      {attractors?.map((a) => {
        const selected = a.id === selectedId
        const cls = `laser-attr${selected ? ' selected' : ''}${a.strength < 0 ? ' negative' : ''}`
        const pts = a.kind === 'point' ? [a.position] : a.points
        const radiusMm = threeToMm(a.radius)
        return (
          <g key={a.id} className={cls}>
            {a.kind === 'point' ? (
              <circle
                cx={threeToMm(a.position.x)}
                cy={threeToMm(a.position.z)}
                r={radiusMm}
                className="laser-attr-reach"
              />
            ) : (
              <polyline
                points={curvePath(a)
                  .map((p) => `${threeToMm(p.x)},${threeToMm(p.z)}`)
                  .join(' ')}
                className="laser-attr-line"
              />
            )}
            {pts.map((p, i) => {
              const cx = threeToMm(p.x)
              const cy = threeToMm(p.z)
              const active = selected && i === (selectedPointIndex ?? 0)
              const handleCls = `laser-attr-handle${active ? ' active' : ''}`
              const onDown = (e: ReactPointerEvent) => startAttractorDrag(e, a.id, i)
              return a.kind === 'curve' && !a.smooth[i] ? (
                <rect
                  key={i}
                  x={cx - handleR}
                  y={cy - handleR}
                  width={2 * handleR}
                  height={2 * handleR}
                  className={handleCls}
                  onPointerDown={onDown}
                />
              ) : (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={handleR}
                  className={handleCls}
                  onPointerDown={onDown}
                />
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}

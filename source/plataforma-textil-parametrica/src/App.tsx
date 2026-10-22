/**
 * Layout raiz: barra lateral de parametros + viewport (3D, o vista 2D en
 * el modo Corte laser).
 * La geometria se deriva del estado con funciones puras y se memoiza aca (una
 * sola vez), compartida entre el panel (stats, export) y la escena.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import './App.css'
import { Viewport } from './scene/Viewport'
import { SpikeFieldScene } from './components/SpikeFieldScene'
import { SpikeFieldPanel } from './components/SpikeFieldPanel'
import { WaveFieldScene } from './components/WaveFieldScene'
import { WaveFieldPanel } from './components/WaveFieldPanel'
import { useAppStore } from './state/store'
import { LaserView } from './components/LaserView'
import { LaserPanel } from './components/LaserPanel'
import { buildSpikeField } from './geometry/spikeField'
import type { SpikePlacement } from './geometry/spikeField'
import { buildWaveField } from './geometry/waveField'
import { buildLaserCut } from './geometry/laserCut'
import { threeToMm } from './utils/units'
import {
  attractorSetFrom,
  deleteSelection,
  useAttractorSet,
  type AttractorSetKind,
} from './state/attractorSets'

export default function App() {
  const mode = useAppStore((s) => s.mode)
  const setMode = useAppStore((s) => s.setMode)
  const reset = useAppStore((s) => s.reset)
  const planeSize = useAppStore((s) => s.field.planeSize)
  const wavePlaneSize = useAppStore((s) => s.wave.planeSize)

  const spikes = useSpikeField()
  const waves = useWaveFieldResult()
  const laser = useLaserCut(mode === 'laser', spikes.placements)
  const laserFamily = useAppStore((s) => s.laser.family)
  const laserSet = useAttractorSet('laser')
  useDeleteShortcut(mode === 'laser' && laserFamily === 'footprint' ? null : mode)

  return (
    <div className="app">
      <div className="grain" aria-hidden="true" />

      <header className="frame-bar">
        <div className="frame-bar-left">
          <span>MP — 2026</span>
          <nav className="frame-nav">
            <a href="../index.html" className="frame-nav-btn">
              Inicio
            </a>
          </nav>
        </div>
        <span>Plataforma paramétrica textil</span>
      </header>

      <main className="viewport">
        {mode === 'laser' && laser ? (
          <LaserView result={laser} set={laserFamily === 'footprint' ? null : laserSet} />
        ) : (
          <Viewport>
            {mode === 'volume' && (
              <SpikeFieldScene geometry={spikes.geometry} planeSize={planeSize} />
            )}
            {mode === 'wave' && (
              <WaveFieldScene geometry={waves.geometry} planeSize={wavePlaneSize} />
            )}
          </Viewport>
        )}
        <div className="obs-meta obs-meta-top">
          <span>{mode === 'laser' ? 'Escala 1:1 — grilla 10 mm' : '1 u = 1 cm'}</span>
          <span className="ref">Viewport — {MODE_LABEL[mode]}</span>
        </div>
        <p className="obs-meta note">
          <span>
            {mode === 'volume' &&
              'Puas solidas y autosoportadas que emergen del plano (base de tela), sin solape entre si. Altura, radios, inclinacion y densidad segun el mapa de atractores.'}
            {mode === 'wave' &&
              'Peine de costillas independientes (contour): cada una nace en y=0 sin plancha de base, que fluyen siguiendo la direccion de los atractores (R rota el punto seleccionado), con relieve concentrico o direccional.'}
            {mode === 'laser' &&
              'Solo vector: cortes y calados sobre la pieza plana, con puente minimo de material y kerf compensado. En el archivo: azul calado · verde corte · rojo contorno.'}
          </span>
        </p>
      </main>

      <aside className="sidebar">
        <header className="brand">
          <p className="eyebrow">Fabricación digital · moda</p>
          <h1>Plataforma parametrica textil</h1>
          <div className="seg mode">
            <button
              type="button"
              className={mode === 'volume' ? 'active' : ''}
              onClick={() => setMode('volume')}
            >
              Volumen (3D)
            </button>
            <button
              type="button"
              className={mode === 'wave' ? 'active' : ''}
              onClick={() => setMode('wave')}
            >
              Ondas (3D)
            </button>
            <button
              type="button"
              className={mode === 'laser' ? 'active' : ''}
              onClick={() => setMode('laser')}
            >
              Corte laser
            </button>
          </div>
          <button type="button" className="ghost" onClick={reset}>
            Restablecer todo
          </button>
        </header>

        {mode === 'volume' && <SpikeFieldPanel result={spikes} />}
        {mode === 'wave' && <WaveFieldPanel result={waves} />}
        {mode === 'laser' && laser && (
          <LaserPanel result={laser} spikeCount={spikes.placements.length} />
        )}
      </aside>
    </div>
  )
}

const MODE_LABEL = { volume: 'Volumen', wave: 'Ondas', laser: 'Corte laser' } as const

/**
 * Supr / Delete (o Backspace, la tecla "delete" de Mac) borra el punto o el
 * atractor seleccionado del modo activo. Se ignora mientras se escribe en un
 * campo de texto/numero, para no borrar atractores al editar un valor.
 * En el modo Ondas, R alterna el gizmo entre mover y rotar.
 */
function useDeleteShortcut(kind: AttractorSetKind | null) {
  useEffect(() => {
    if (!kind) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing =
        t?.isContentEditable ||
        t?.tagName === 'TEXTAREA' ||
        (t?.tagName === 'INPUT' &&
          !['range', 'checkbox', 'button'].includes((t as HTMLInputElement).type))
      if (typing) return
      const state = useAppStore.getState()
      if (
        kind === 'wave' &&
        (e.key === 'r' || e.key === 'R') &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        state.setGizmoMode(state.gizmoMode === 'rotate' ? 'translate' : 'rotate')
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      // snapshot fresco del store: el listener no se recrea en cada cambio.
      if (deleteSelection(attractorSetFrom(useAppStore.getState(), kind)))
        e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [kind])
}

/**
 * Corte laser (2D, mm). Solo se calcula con el modo activo: no hay malla que
 * liberar, pero recorrer la grilla en cada cambio de los modos 3D seria
 * trabajo perdido.
 */
function useLaserCut(active: boolean, placements: readonly SpikePlacement[]) {
  const laser = useAppStore((s) => s.laser)
  const attractors = useAppStore((s) => s.laserAttractors)
  const baseShape = useAppStore((s) => s.baseShape)
  const spikePlaneSize = useAppStore((s) => s.field.planeSize)

  return useMemo(() => {
    if (!active) return null
    const footprints =
      laser.family === 'footprint'
        ? placements.map((p) => ({
            x: threeToMm(p.x),
            z: threeToMm(p.z),
            rootRadiusMm: p.rootRadiusMm,
          }))
        : []
    return buildLaserCut(attractors, laser, {
      boundary: baseShape,
      footprints,
      footprintPlaneMm: threeToMm(spikePlaneSize),
    })
  }, [active, laser, attractors, baseShape, placements, spikePlaneSize])
}

function useSpikeField() {
  const field = useAppStore((s) => s.field)
  const attractors = useAppStore((s) => s.attractors)
  const baseShape = useAppStore((s) => s.baseShape)

  const result = useMemo(
    () => buildSpikeField(attractors, field, baseShape),
    [attractors, field, baseShape],
  )
  useDisposePrevious(result.geometry)
  return result
}

function useWaveFieldResult() {
  const wave = useAppStore((s) => s.wave)
  const attractors = useAppStore((s) => s.waveAttractors)
  const baseShape = useAppStore((s) => s.baseShape)

  const result = useMemo(
    () => buildWaveField(attractors, wave, baseShape),
    [attractors, wave, baseShape],
  )
  useDisposePrevious(result.geometry)
  return result
}

/** Libera la BufferGeometry anterior cuando el memo produce una nueva. */
function useDisposePrevious(geometry: THREE.BufferGeometry | null) {
  const prev = useRef<THREE.BufferGeometry | null>(null)
  useEffect(() => {
    if (prev.current && prev.current !== geometry) prev.current.dispose()
    prev.current = geometry
  }, [geometry])
  useEffect(() => () => prev.current?.dispose(), [])
}

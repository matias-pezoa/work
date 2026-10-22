/**
 * Seccion de panel para gestionar un set de atractores: botones para agregar
 * (punto o curva), lista, y sliders / forma de curva / puntos del
 * seleccionado. Recibe el set del modo (state/attractorSets.ts) para
 * reusarse en Volumen, Ondas y Corte laser.
 */
import { ParamSlider } from './ParamSlider'
import {
  ATTRACTOR_UI_PARAMS,
  FALLOFF_LABELS,
  MIN_CURVE_POINTS,
  removeCurvePoint,
} from '../geometry/attractionField'
import type { FalloffType } from '../geometry/attractionField'
import type { AttractorSet } from '../state/attractorSets'

interface AttractorEditorProps {
  set: AttractorSet
  /** Lado del panel: se usa para dispersar la posicion inicial de uno nuevo. */
  planeSize: number
  /** Texto de ayuda propio del modo (por defecto, el del viewport 3D). */
  hint?: string
}

const DEFAULT_HINT =
  'Clic en un punto para seleccionarlo y arrastrarlo con el gizmo (su altura tambien ' +
  'influye en el campo). Clic derecho en el plano: agrega un punto a la curva ' +
  'seleccionada, o un atractor nuevo si no hay curva seleccionada. Supr borra el punto ' +
  'seleccionado. Esfera = vertice suave (Bezier), cubo = esquina.'

export function AttractorEditor({
  set,
  planeSize,
  hint = DEFAULT_HINT,
}: AttractorEditorProps) {
  const { attractors, selectedId, selectedPointIndex } = set
  const selected = attractors.find((a) => a.id === selectedId)

  // posicion aleatoria dentro del panel: si se agregan varios de una, no
  // quedan apilados exactamente uno sobre el otro. Se ajustan despues
  // arrastrando el gizmo.
  const randomPoint = (): [number, number, number] => {
    const half = planeSize * 0.3
    return [
      (Math.random() * 2 - 1) * half,
      3 + Math.random() * 2,
      (Math.random() * 2 - 1) * half,
    ]
  }

  const addRandom = () => set.add(randomPoint())

  const addCurve = () => {
    const half = planeSize * 0.3
    const y = 3 + Math.random() * 2
    const z = (Math.random() * 2 - 1) * half
    set.addCurve([
      [-half, y, z],
      [half, y, z],
    ])
  }

  const addWaypoint = () => {
    if (!selected || selected.kind !== 'curve') return
    const last = selected.points[selected.points.length - 1]
    const prev = selected.points[selected.points.length - 2]
    // extiende la curva en la misma direccion del ultimo tramo; el usuario la
    // reubica despues arrastrando el gizmo.
    const extended = last.clone().add(last.clone().sub(prev))
    set.update(selected.id, { points: [...selected.points, extended] })
    set.select(selected.id, selected.points.length)
  }

  const removeActivePoint = () => {
    if (!selected || selected.kind !== 'curve') return
    const index = selectedPointIndex ?? selected.points.length - 1
    const patch = removeCurvePoint(selected, index)
    if (!patch) return
    set.update(selected.id, patch)
    set.select(selected.id, Math.max(0, index - 1))
  }

  const curve = selected?.kind === 'curve' ? selected : null
  const allCorner = curve ? curve.smooth.every((s) => !s) : false
  const allSmooth = curve ? curve.smooth.every((s) => s) : false
  const activePoint =
    curve && selectedPointIndex !== null && selectedPointIndex < curve.points.length
      ? selectedPointIndex
      : null

  const setAllSmooth = (value: boolean) => {
    if (!curve) return
    set.update(curve.id, { smooth: curve.smooth.map(() => value) })
  }

  const setPointSmooth = (value: boolean) => {
    if (!curve || activePoint === null) return
    set.update(curve.id, {
      smooth: curve.smooth.map((s, i) => (i === activePoint ? value : s)),
    })
  }

  return (
    <section>
      <h3>Atractores ({attractors.length})</h3>
      <p className="hint">{hint}</p>
      <div className="seg">
        <button type="button" onClick={addRandom}>
          + Agregar punto
        </button>
        <button type="button" onClick={addCurve}>
          + Agregar curva
        </button>
      </div>
      <ul className="attractor-list">
        {attractors.map((a) => (
          <li key={a.id} className={a.id === selectedId ? 'active' : ''}>
            <button type="button" className="link" onClick={() => set.select(a.id, 0)}>
              {a.kind === 'curve'
                ? `${a.smooth.some((s) => s) ? 'curva' : 'recta'} (${a.points.length} pts)`
                : 'punto'}{' '}
              · r{a.radius.toFixed(1)} · {FALLOFF_LABELS[a.falloff]}
            </button>
            <button type="button" className="del" onClick={() => set.remove(a.id)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="sub">
          <h4>
            {selected.kind === 'curve' ? 'Linea' : 'Atractor'} {selected.id.slice(-5)}
          </h4>
          {ATTRACTOR_UI_PARAMS.map((p) => (
            <ParamSlider
              key={p.key}
              param={p}
              value={p.key === 'radius' ? selected.radius : selected.strength}
              onChange={(v) =>
                set.update(
                  selected.id,
                  p.key === 'radius' ? { radius: v } : { strength: v },
                )
              }
            />
          ))}
          <label className="param-label">Caida</label>
          <div className="seg">
            {(Object.keys(FALLOFF_LABELS) as FalloffType[]).map((f) => (
              <button
                key={f}
                type="button"
                className={selected.falloff === f ? 'active' : ''}
                onClick={() => set.update(selected.id, { falloff: f })}
              >
                {FALLOFF_LABELS[f]}
              </button>
            ))}
          </div>
          {curve && (
            <>
              <label className="param-label">Forma de la linea</label>
              <div className="seg">
                <button
                  type="button"
                  className={allCorner ? 'active' : ''}
                  onClick={() => setAllSmooth(false)}
                >
                  Recta
                </button>
                <button
                  type="button"
                  className={allSmooth ? 'active' : ''}
                  onClick={() => setAllSmooth(true)}
                >
                  Curva (Bezier)
                </button>
              </div>
              <label className="param-label">
                {activePoint !== null
                  ? `Vertice ${activePoint + 1} de ${curve.points.length}`
                  : 'Selecciona un punto para editar su vertice'}
              </label>
              <div className="seg">
                <button
                  type="button"
                  disabled={activePoint === null}
                  className={
                    activePoint !== null && !curve.smooth[activePoint] ? 'active' : ''
                  }
                  onClick={() => setPointSmooth(false)}
                >
                  Esquina
                </button>
                <button
                  type="button"
                  disabled={activePoint === null}
                  className={
                    activePoint !== null && curve.smooth[activePoint] ? 'active' : ''
                  }
                  onClick={() => setPointSmooth(true)}
                >
                  Suave
                </button>
              </div>
              <label className="param-label">
                Puntos de control ({curve.points.length})
              </label>
              <div className="seg">
                <button type="button" onClick={addWaypoint}>
                  + Agregar punto
                </button>
                <button
                  type="button"
                  onClick={removeActivePoint}
                  disabled={curve.points.length <= MIN_CURVE_POINTS}
                >
                  {activePoint !== null ? 'Quitar seleccionado' : 'Quitar ultimo'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

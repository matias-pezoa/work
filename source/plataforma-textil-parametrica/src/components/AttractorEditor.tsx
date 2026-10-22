/**
 * Seccion de panel para gestionar un set de atractores: botones para agregar
 * (punto o curva), lista, y sliders/waypoints del seleccionado. Sin acoplar
 * a un store en particular (recibe todo por props) para reusarse en
 * cualquier modo (Volumen, Ondas, ...).
 */
import { ParamSlider } from './ParamSlider'
import { ATTRACTOR_UI_PARAMS, FALLOFF_LABELS, MIN_CURVE_POINTS } from '../geometry/attractionField'
import type { Attractor, AttractorPatch, FalloffType } from '../geometry/attractionField'

interface AttractorEditorProps {
  attractors: readonly Attractor[]
  selectedId: string | null
  /** Lado del panel: se usa para dispersar la posicion inicial de uno nuevo. */
  planeSize: number
  onAdd: (position: [number, number, number]) => void
  onAddCurve: (points: readonly [number, number, number][]) => void
  onSelect: (id: string) => void
  onUpdate: (id: string, patch: AttractorPatch) => void
  onRemove: (id: string) => void
}

export function AttractorEditor({
  attractors,
  selectedId,
  planeSize,
  onAdd,
  onAddCurve,
  onSelect,
  onUpdate,
  onRemove,
}: AttractorEditorProps) {
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

  const addRandom = () => onAdd(randomPoint())

  const addCurve = () => {
    const half = planeSize * 0.3
    const y = 3 + Math.random() * 2
    const z = (Math.random() * 2 - 1) * half
    onAddCurve([
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
    onUpdate(selected.id, { points: [...selected.points, extended] })
  }

  const removeWaypoint = () => {
    if (!selected || selected.kind !== 'curve') return
    if (selected.points.length <= MIN_CURVE_POINTS) return
    onUpdate(selected.id, { points: selected.points.slice(0, -1) })
  }

  return (
    <section>
      <h3>Atractores ({attractors.length})</h3>
      <p className="hint">
        Clic en una esfera roja para seleccionarla y arrastrarla con el gizmo (su altura
        tambien influye en el campo). Una curva es una linea recta entre sus puntos de
        control — agregar puntos la hace mas curva.
      </p>
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
            <button type="button" className="link" onClick={() => onSelect(a.id)}>
              {a.kind === 'curve' ? `curva (${a.points.length} pts)` : 'punto'} · r
              {a.radius.toFixed(1)} · {FALLOFF_LABELS[a.falloff]}
            </button>
            <button type="button" className="del" onClick={() => onRemove(a.id)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="sub">
          <h4>
            {selected.kind === 'curve' ? 'Curva' : 'Atractor'} {selected.id.slice(-5)}
          </h4>
          {ATTRACTOR_UI_PARAMS.map((p) => (
            <ParamSlider
              key={p.key}
              param={p}
              value={p.key === 'radius' ? selected.radius : selected.strength}
              onChange={(v) =>
                onUpdate(
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
                onClick={() => onUpdate(selected.id, { falloff: f })}
              >
                {FALLOFF_LABELS[f]}
              </button>
            ))}
          </div>
          {selected.kind === 'curve' && (
            <>
              <label className="param-label">Puntos de control ({selected.points.length})</label>
              <div className="seg">
                <button type="button" onClick={addWaypoint}>
                  + Agregar punto
                </button>
                <button
                  type="button"
                  onClick={removeWaypoint}
                  disabled={selected.points.length <= MIN_CURVE_POINTS}
                >
                  Quitar ultimo
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

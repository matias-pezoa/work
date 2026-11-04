/**
 * Panel del generador de probetas (modo Corte laser): una serie de probetas
 * del diseno actual, cada una en su propio archivo de formato fijo (por
 * defecto 200 x 200 mm), que varian uno o dos parametros. La vista muestra
 * la probeta seleccionada mientras esta pestana esta activa.
 */
import { useAppStore } from '../state/store'
import { ParamSlider } from './ParamSlider'
import { FAMILY_LABELS, LASER_MATERIALS, type LaserParam } from '../geometry/laserCut'
import { HINGE_LABELS } from '../geometry/laserPattern'
import {
  defaultAxisRange,
  SPECIMEN_FORMAT_UI_PARAMS,
  SPECIMEN_STEPS_PARAM,
  SPECIMEN_STEPS_Y_PARAM,
  specimenAxisParams,
  type Specimen,
  type SpecimenAxis,
  type SpecimenParam,
  type SpecimenSeries,
  type SpecimenValue,
  surnameSlug,
} from '../geometry/laserSpecimens'
import {
  downloadSpecimen,
  downloadSpecimensZip,
  type SpecimenFormat,
} from '../io/exportLaser'

/** Serie planificada + la probeta a la vista; el resto se arma al exportar. */
export interface SpecimenView {
  series: SpecimenSeries
  index: number
  current: Specimen | null
  buildAll: () => Specimen[]
}

const FORMATS: { id: SpecimenFormat; label: string }[] = [
  { id: 'svg', label: 'SVG' },
  { id: 'dxf', label: 'DXF' },
  { id: 'ai', label: 'AI (Illustrator 3)' },
]

const describe = (values: readonly SpecimenValue[]) =>
  values
    .map((v) => `${v.label} ${Number(v.value.toFixed(2))}${v.unit === 'mm' ? ' mm' : ''}`)
    .join(' · ')

export function SpecimenPanel({ view }: { view: SpecimenView | null }) {
  const laser = useAppStore((s) => s.laser)
  const sp = useAppStore((s) => s.specimen)
  const setParam = useAppStore((s) => s.setSpecimenParam)
  const setSpecimen = useAppStore((s) => s.setSpecimen)
  const setIndex = useAppStore((s) => s.setSpecimenIndex)
  const setTab = useAppStore((s) => s.setLaserTab)
  const hasImage = useAppStore((s) => s.laserImage !== null)

  const axisParams = specimenAxisParams(laser)
  const paramOf = (key: SpecimenAxis) =>
    key === 'none' ? null : (axisParams.find((p) => p.key === key) ?? null)
  const px = paramOf(sp.axisX)
  const py = paramOf(sp.axisY)
  const matrix = px !== null && py !== null

  const slider = (p: SpecimenParam) => (
    <ParamSlider
      key={p.key}
      param={p}
      value={sp[p.key]}
      onChange={(v) => setParam(p.key, v)}
    />
  )

  const chooseAxis = (axis: 'x' | 'y', key: SpecimenAxis) => {
    const p = paramOf(key)
    const [from, to] = p ? defaultAxisRange(p, laser[p.key]) : [0, 0]
    setSpecimen(
      axis === 'x'
        ? { axisX: key, xFrom: from, xTo: to }
        : { axisY: key, yFrom: from, yTo: to },
    )
  }

  const rangeSliders = (
    p: LaserParam,
    fromKey: 'xFrom' | 'yFrom',
    toKey: 'xTo' | 'yTo',
  ) => (
    <>
      <ParamSlider
        param={{ ...p, label: 'Desde' }}
        value={sp[fromKey]}
        onChange={(v) => setParam(fromKey, v)}
      />
      <ParamSlider
        param={{ ...p, label: 'Hasta' }}
        value={sp[toKey]}
        onChange={(v) => setParam(toKey, v)}
      />
    </>
  )

  const axisSelect = (axis: 'x' | 'y', value: SpecimenAxis, label: string) => (
    <label className="param">
      <span className="param-label">{label}</span>
      <select
        className="select"
        value={value}
        onChange={(e) => chooseAxis(axis, e.target.value as SpecimenAxis)}
      >
        <option value="none">— nada —</option>
        {axisParams.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  )

  const material = LASER_MATERIALS.find((m) => m.id === laser.materialId)
  const design =
    laser.family === 'hinge'
      ? `${FAMILY_LABELS.hinge} · ${HINGE_LABELS[laser.hingePattern]}`
      : FAMILY_LABELS[laser.family]
  const plans = view?.series.plans ?? []
  const total = plans.length
  const current = view?.current ?? null
  const surname = surnameSlug(sp.surname)
  const zipName = `${surname}_probetas`
  const canExport = surname !== ''

  return (
    <>
      <section>
        <h3>Generador de probetas</h3>
        <p className="hint">
          Genera una serie de probetas del diseno actual para probar en el material real.
          Cada probeta es un archivo independiente de {sp.widthMm} x {sp.heightMm} mm (la
          pieza mide el formato), con su numero y sus valores grabados en la franja
          superior: no hay como confundirlas en la mesa del laser.
        </p>
        <dl className="stats">
          <div>
            <dt>Diseno</dt>
            <dd>{design}</dd>
          </div>
          <div>
            <dt>Material</dt>
            <dd>{material?.label ?? '—'}</dd>
          </div>
          <div>
            <dt>Kerf / puente</dt>
            <dd>
              {laser.kerfMm.toFixed(2)} / {laser.minBridgeMm.toFixed(1)} mm
            </dd>
          </div>
        </dl>
        <button type="button" className="ghost" onClick={() => setTab('design')}>
          Cambiar el diseno (pestana Diseno)
        </button>
        {view?.series.unsupported && (
          <p className="hint error">
            La familia {FAMILY_LABELS[laser.family]} no admite probetas (genera piezas
            sueltas o depende del modo Volumen). Elegi otra familia en la pestana Diseno.
          </p>
        )}
        {laser.family === 'image' && !hasImage && (
          <p className="hint error">Carga una imagen en la pestana Diseno.</p>
        )}
      </section>

      <section>
        <h3>Nombre</h3>
        <label className="param">
          <span className="param-label">Apellido</span>
          <input
            type="text"
            className="text-input"
            value={sp.surname}
            placeholder="Ej. Pezoa"
            maxLength={40}
            onChange={(e) => setSpecimen({ surname: e.target.value })}
          />
        </label>
        <p className={canExport ? 'hint' : 'hint error'}>
          {canExport
            ? `Los archivos se llaman ${surname}_probeta_01, ${surname}_probeta_02... y el apellido va grabado en cada probeta.`
            : 'Escribe tu apellido para poder exportar: los archivos se llaman apellido_probeta_numero.'}
        </p>
      </section>

      <section>
        <h3>Formato de cada probeta</h3>
        <div className="row">
          {[100, 150, 200].map((mm) => (
            <button
              key={mm}
              type="button"
              className={sp.widthMm === mm && sp.heightMm === mm ? 'active' : ''}
              onClick={() => setSpecimen({ widthMm: mm, heightMm: mm })}
            >
              {mm / 10} x {mm / 10} cm
            </button>
          ))}
        </div>
        {SPECIMEN_FORMAT_UI_PARAMS.map(slider)}
        <label className="check">
          <input
            type="checkbox"
            checked={sp.cutOutline}
            onChange={() => setSpecimen({ cutOutline: !sp.cutOutline })}
          />
          Cortar el contorno de la probeta
        </label>
        <p className="hint">
          {sp.cutOutline
            ? 'El contorno (rojo, al final) recorta la probeta del material, con el kerf hacia afuera.'
            : 'Sin contorno: para material ya cortado al formato. El borde va como referencia en su propia capa (no cortar).'}
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={sp.keepField}
            onChange={() => setSpecimen({ keepField: !sp.keepField })}
          />
          Usar el campo del diseno (escalado a la probeta)
        </label>
        <p className="hint">
          {sp.keepField
            ? 'Cada probeta es una version a escala de la pieza: los atractores (y la simetria) se escalan a su tamano.'
            : 'Patron uniforme en toda la probeta (valores "cerca"): lo mejor para comparar parametros.'}
        </p>
      </section>

      <section>
        <h3>Variar parametros</h3>
        {axisSelect('x', sp.axisX, 'Parametro 1')}
        {px && rangeSliders(px, 'xFrom', 'xTo')}
        {axisSelect('y', sp.axisY, 'Parametro 2')}
        {py && rangeSliders(py, 'yFrom', 'yTo')}
        <ParamSlider
          param={{
            ...SPECIMEN_STEPS_PARAM,
            label: matrix ? 'Pasos parametro 1' : px || py ? 'Probetas' : 'Copias',
          }}
          value={sp.steps}
          onChange={(v) => setParam('steps', v)}
        />
        {matrix && (
          <ParamSlider
            param={{ ...SPECIMEN_STEPS_Y_PARAM, label: 'Pasos parametro 2' }}
            value={sp.stepsY}
            onChange={(v) => setParam('stepsY', v)}
          />
        )}
        <p className="hint">
          {matrix
            ? `Todas las combinaciones: ${sp.steps} x ${sp.stepsY} = ${total} probetas.`
            : px || py
              ? 'Un parametro: el valor avanza de la primera a la ultima probeta.'
              : 'Sin parametros: copias iguales, numeradas (para probar potencia y velocidad).'}
        </p>
      </section>

      <section>
        <h3>Probetas ({total})</h3>
        {total > 0 && view && (
          <>
            <div className="row">
              <button
                type="button"
                disabled={view.index === 0}
                onClick={() => setIndex(view.index - 1)}
              >
                ‹ Anterior
              </button>
              <span className="specimen-pos">
                {view.index + 1} / {total}
              </span>
              <button
                type="button"
                disabled={view.index >= total - 1}
                onClick={() => setIndex(view.index + 1)}
              >
                Siguiente ›
              </button>
            </div>
            <ol className="specimen-list">
              {plans.map((p, k) => (
                <li key={p.number} className={k === view.index ? 'active' : ''}>
                  <button type="button" onClick={() => setIndex(k)}>
                    <b>#{p.number}</b> {describe(p.values) || 'copia'}
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
        {current && (
          <dl className="stats">
            <div>
              <dt>Calados</dt>
              <dd>{current.calados}</dd>
            </div>
            <div>
              <dt>Cortes</dt>
              <dd>{current.cortes}</dd>
            </div>
            <div>
              <dt>Largo de corte</dt>
              <dd>{(current.cutLengthMm / 1000).toFixed(2)} m</dd>
            </div>
          </dl>
        )}
        {current && current.calados + current.cortes === 0 && (
          <p className="hint error">Esta probeta queda sin calados con estos valores.</p>
        )}
      </section>

      <section>
        <h3>Exportar</h3>
        <p className="hint">
          Cada archivo mide exactamente {sp.widthMm} x {sp.heightMm} mm y se llama con su
          apellido y su numero (ej. <code>{current?.name ?? 'apellido_probeta_01'}</code>
          ); los valores van grabados en la probeta. Colores: grabado negro, calados azul,
          cortes verde, contorno rojo (al final).
        </p>
        <h4>Esta probeta (#{current?.number ?? '—'})</h4>
        <div className="row">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="primary"
              disabled={!current || !canExport}
              onClick={() => current && downloadSpecimen(current, f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <h4>Todas, en un .zip (un archivo por probeta)</h4>
        <div className="row">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              disabled={!view || total === 0 || !canExport}
              onClick={() =>
                view && downloadSpecimensZip(view.buildAll(), [f.id], zipName)
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!view || total === 0 || !canExport}
          onClick={() =>
            view &&
            downloadSpecimensZip(
              view.buildAll(),
              FORMATS.map((f) => f.id),
              zipName,
            )
          }
        >
          Todas en los 3 formatos (.zip)
        </button>
      </section>
    </>
  )
}

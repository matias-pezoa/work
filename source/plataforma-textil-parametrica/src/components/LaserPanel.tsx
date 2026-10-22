/** Panel del modo Corte laser: cortes y calados parametricos sobre una pieza plana. */
import { useAppStore } from '../state/store'
import { ParamSlider } from './ParamSlider'
import { AttractorEditor } from './AttractorEditor'
import { useAttractorSet } from '../state/attractorSets'
import { BaseShapeImporter } from './BaseShapeImporter'
import {
  FAMILY_LABELS,
  FAMILY_UI_PARAMS,
  FIELD_LASER_UI_PARAMS,
  LASER_MATERIALS,
  MATERIAL_UI_PARAMS,
  MIN_FEATURE_MM,
  SHEET_UI_PARAMS,
} from '../geometry/laserCut'
import type { LaserCutResult, LaserFamily, LaserParam } from '../geometry/laserCut'
import { downloadLaserDxf, downloadLaserSvg } from '../io/exportLaser'
import { mmToThree } from '../utils/units'

interface LaserPanelProps {
  result: LaserCutResult
  /** Puas del modo Volumen disponibles para la familia "huella". */
  spikeCount: number
}

const FAMILY_HINTS: Record<LaserFamily, string> = {
  perforation:
    'Perforaciones en grilla hexagonal. Cerca de un atractor crecen hasta el maximo que ' +
    'permite el puente; con "Alargamiento" > 1 se vuelven ranuras orientadas segun el campo.',
  kirigami:
    'Reticula auxetica de cuadrados rotantes: cortes rectos alternados. Al traccionar, los ' +
    'cuadrados giran y la pieza se ensancha en ambos sentidos. Cerca de un atractor la ' +
    'bisagra se achica: mas estiramiento y caida.',
  scales:
    'Cortes en arco en filas alternadas: la lengueta dentro de cada arco se levanta al ' +
    'curvar la pieza. Con "Seguir el campo" las puntas apuntan lejos del atractor.',
  footprint:
    'Un calado circular en la base de cada pua del modo Volumen (mismas posiciones y base). ' +
    'Impreso encima, el filamento atraviesa el calado y se ancla a la tela. Se ajusta ' +
    'desde los atractores y parametros del modo Volumen.',
}

export function LaserPanel({ result, spikeCount }: LaserPanelProps) {
  const laser = useAppStore((s) => s.laser)
  const setParam = useAppStore((s) => s.setLaserParam)
  const setFamily = useAppStore((s) => s.setLaserFamily)
  const setMaterial = useAppStore((s) => s.setLaserMaterial)
  const setCombine = useAppStore((s) => s.setLaserCombine)
  const toggleAlign = useAppStore((s) => s.toggleLaserAlign)

  const attractorSet = useAttractorSet('laser')
  const baseShape = useAppStore((s) => s.baseShape)

  const usesField = laser.family !== 'footprint'
  const usesAlign = laser.family === 'perforation' || laser.family === 'scales'
  const editorPlaneSize = mmToThree(baseShape?.widthMm ?? laser.sheetWidthMm)

  const slider = (p: LaserParam) => (
    <ParamSlider
      key={p.key}
      param={p}
      value={laser[p.key]}
      onChange={(v) => setParam(p.key, v)}
    />
  )

  const filename = `corte-laser-${laser.family}`

  return (
    <div className="panel">
      <section>
        <h3>Fabricable por construccion</h3>
        <p className="hint">
          Entre dos cortes vecinos siempre queda al menos el puente minimo de material
          real ({result.bridgeMm.toFixed(1)} mm, ya descontado el kerf): los tamanos se
          recortan a lo que permite la grilla. Ningun corte se acerca al borde a menos del
          margen, y no se generan rasgos menores a {MIN_FEATURE_MM} mm. Los calados se
          compensan kerf/2 hacia adentro y el contorno hacia afuera, para que la pieza
          fisica mida lo disenado.
        </p>
      </section>

      <section>
        <h3>Familia</h3>
        <div className="seg">
          {(Object.keys(FAMILY_LABELS) as LaserFamily[]).map((f) => (
            <button
              key={f}
              type="button"
              className={laser.family === f ? 'active' : ''}
              onClick={() => setFamily(f)}
            >
              {FAMILY_LABELS[f]}
            </button>
          ))}
        </div>
        <p className="hint">{FAMILY_HINTS[laser.family]}</p>
        {laser.family === 'footprint' && spikeCount === 0 && (
          <p className="hint error">
            El modo Volumen no tiene puas: no hay huellas que cortar.
          </p>
        )}
        {FAMILY_UI_PARAMS[laser.family].map(slider)}
        {usesField && FIELD_LASER_UI_PARAMS.map(slider)}
        {usesAlign && (
          <label className="check">
            <input type="checkbox" checked={laser.alignToField} onChange={toggleAlign} />
            Seguir el campo (orientacion)
          </label>
        )}
        {usesField && (
          <div className="seg" style={{ marginTop: 14 }}>
            <button
              type="button"
              className={laser.combine === 'max' ? 'active' : ''}
              onClick={() => setCombine('max')}
            >
              Campo: maximo
            </button>
            <button
              type="button"
              className={laser.combine === 'sum' ? 'active' : ''}
              onClick={() => setCombine('sum')}
            >
              Campo: suma
            </button>
          </div>
        )}
      </section>

      <section>
        <h3>Material y kerf</h3>
        <div className="seg seg-grid">
          {LASER_MATERIALS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={laser.materialId === m.id ? 'active' : ''}
              onClick={() => setMaterial(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="hint">
          Valores de referencia: corta una muestra en un retazo del material real y ajusta
          el kerf y el puente antes de la pieza final.
        </p>
        {MATERIAL_UI_PARAMS.map(slider)}
      </section>

      {!baseShape && laser.family !== 'footprint' && (
        <section>
          <h3>Pieza</h3>
          {SHEET_UI_PARAMS.map(slider)}
        </section>
      )}

      <BaseShapeImporter />

      {usesField ? (
        <AttractorEditor
          set={attractorSet}
          planeSize={editorPlaneSize}
          hint={
            'Arrastra un punto en la vista para moverlo. Clic derecho: agrega un punto a ' +
            'la curva seleccionada (o un atractor nuevo si no hay curva seleccionada). ' +
            'Supr borra el punto seleccionado. Circulo = vertice suave (Bezier), cuadrado ' +
            '= esquina. Arrastrar el fondo desplaza, rueda = zoom, doble clic = encuadrar.'
          }
        />
      ) : null}

      <section>
        <h3>Exportar</h3>
        <dl className="stats">
          <div>
            <dt>Calados</dt>
            <dd>{result.calados}</dd>
          </div>
          <div>
            <dt>Cortes abiertos</dt>
            <dd>{result.cortes}</dd>
          </div>
          <div>
            <dt>Largo de corte</dt>
            <dd>{(result.cutLengthMm / 1000).toFixed(2)} m</dd>
          </div>
          <div>
            <dt>Area calada</dt>
            <dd>{(result.openRatio * 100).toFixed(1)} %</dd>
          </div>
          <div>
            <dt>Pieza</dt>
            <dd>
              {(result.bounds.maxX - result.bounds.minX).toFixed(0)} x{' '}
              {(result.bounds.maxZ - result.bounds.minZ).toFixed(0)} mm
            </dd>
          </div>
          {result.rejectedByEdge > 0 && (
            <div>
              <dt>Descartados por margen</dt>
              <dd>{result.rejectedByEdge}</dd>
            </div>
          )}
          {result.rejectedByBridge > 0 && (
            <div>
              <dt>Descartados por puente</dt>
              <dd>{result.rejectedByBridge}</dd>
            </div>
          )}
          {result.limitedByBridge > 0 && (
            <div>
              <dt>Recortados al puente</dt>
              <dd>{result.limitedByBridge}</dd>
            </div>
          )}
          {result.skippedBySize > 0 && (
            <div>
              <dt>Bajo el rasgo minimo</dt>
              <dd>{result.skippedBySize}</dd>
            </div>
          )}
        </dl>
        <p className="hint">
          Capas por color: calados azul, cortes verde, contorno rojo — el contorno va al
          final para que la pieza no se suelte antes de tiempo.
        </p>
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={() => downloadLaserSvg(result, filename)}
          >
            SVG (mm)
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => downloadLaserDxf(result, filename)}
          >
            DXF (mm)
          </button>
        </div>
      </section>
    </div>
  )
}

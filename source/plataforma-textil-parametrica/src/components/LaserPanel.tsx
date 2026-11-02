/** Panel del modo Corte laser: cortes y calados parametricos sobre una pieza plana. */
import { useAppStore } from '../state/store'
import { ParamSlider } from './ParamSlider'
import { AttractorEditor } from './AttractorEditor'
import { ModuleEditor } from './ModuleEditor'
import { useAttractorSet } from '../state/attractorSets'
import { BaseShapeImporter } from './BaseShapeImporter'
import {
  CENTER_UI_PARAMS,
  DISTRIBUTION_LABELS,
  ELEMENT_FAMILIES,
  FAMILY_LABELS,
  FAMILY_UI_PARAMS,
  FIELD_LASER_UI_PARAMS,
  hingeAsModule,
  hingeUiParams,
  LASER_MATERIALS,
  LAYOUT_UI_PARAMS,
  MATERIAL_UI_PARAMS,
  MIN_FEATURE_MM,
  RADIAL_UI_PARAMS,
  SHEET_UI_PARAMS,
  SYMMETRY_ORDER_PARAM,
  BED_UI_PARAMS,
  layersUiParams,
} from '../geometry/laserCut'
import type {
  LaserCutResult,
  LaserDistribution,
  LaserFamily,
  LaserParam,
} from '../geometry/laserCut'
import {
  CELL_FLIP_LABELS,
  HINGE_LABELS,
  hingeLatticeKind,
  hingeRowElement,
  LAYOUT_LABELS,
  meanderElement,
  SYMMETRY_LABELS,
  trianglesElement,
  type CellFlip,
  type HingePattern,
  type LaserLayout,
  type LaserSymmetry,
  type Shape,
} from '../geometry/laserPattern'
import {
  buildSwatchSheet,
  SWATCH_SPACINGS_MM,
  type SwatchVariant,
} from '../geometry/laserSwatch'
import {
  downloadBedDxf,
  downloadBedSvg,
  downloadLaserDxf,
  downloadLaserSvg,
  downloadSwatchSvg,
} from '../io/exportLaser'
import type { BedLayout } from '../geometry/laserBed'
import {
  LAYER_EDGE_LABELS,
  LAYER_JOIN_LABELS,
  type LayerEdge,
  type LayerJoin,
} from '../geometry/laserLayers'
import { mmToThree } from '../utils/units'

interface LaserPanelProps {
  result: LaserCutResult
  /** Familia capas: piezas distribuidas en la cama (null en las demas). */
  bed: BedLayout | null
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
  hinge:
    'Bisagra kerf (kerf bending): filas de cortes desfasados que vuelven flexible una ' +
    'plancha rigida. Menos separacion entre filas y menos puente = mas flexible (y mas ' +
    'fragil). El campo pasa del puente "lejos" al "cerca": la pieza se dobla mas donde ' +
    'hay atractores. En radial, las filas se vuelven anillos concentricos.',
  module:
    'Dibuja tu propio modulo en la celda y se repite por toda la pieza (grilla o radial). ' +
    'Trazo abierto = corte, cerrado = calado. El modulo se escala para dejar siempre el ' +
    'puente con las celdas vecinas; el campo lo agranda cerca de los atractores.',
  layers:
    'Capas concentricas, como curvas de nivel: cada capa es una pieza suelta, mas chica ' +
    'que la anterior. Apiladas y unidas desde el centro (agujero comun) o desde una ' +
    'arista (fila de agujeros), sus bordes forman el relieve. Los lobulos ondulan las ' +
    'capas y el giro los desplaza de una a otra; los atractores las empujan. Al exportar, ' +
    'las piezas salen distribuidas en la cama del laser, numeradas al costado.',
  footprint:
    'Un calado circular en la base de cada pua del modo Volumen (mismas posiciones y base). ' +
    'Impreso encima, el filamento atraviesa el calado y se ancla a la tela. Se ajusta ' +
    'desde los atractores y parametros del modo Volumen.',
}

const SYMMETRY_HINT: Record<LaserSymmetry, string> = {
  none: '',
  mirrorX: 'Cada atractor se refleja en el eje vertical que pasa por el centro.',
  mirrorZ: 'Cada atractor se refleja en el eje horizontal que pasa por el centro.',
  mirrorXZ: 'Reflejo en ambos ejes: cuatro copias de cada atractor.',
  rotational: 'N copias de cada atractor giradas alrededor del centro.',
  kaleido: 'N copias giradas y sus reflejos (2N): un caleidoscopio.',
}

export function LaserPanel({ result, bed, spikeCount }: LaserPanelProps) {
  const laser = useAppStore((s) => s.laser)
  const setParam = useAppStore((s) => s.setLaserParam)
  const setOption = useAppStore((s) => s.setLaserOption)
  const setFamily = useAppStore((s) => s.setLaserFamily)
  const setMaterial = useAppStore((s) => s.setLaserMaterial)
  const setCombine = useAppStore((s) => s.setLaserCombine)
  const toggleAlign = useAppStore((s) => s.toggleLaserAlign)
  const previewBed = useAppStore((s) => s.laserPreviewBed)
  const setPreviewBed = useAppStore((s) => s.setLaserPreviewBed)

  const attractorSet = useAttractorSet('laser')
  const baseShape = useAppStore((s) => s.baseShape)

  const family = laser.family
  const usesField = family !== 'footprint'
  const usesElements = ELEMENT_FAMILIES.has(family)
  const usesAlign = family === 'perforation' || family === 'scales' || family === 'module'
  const usesCellFlip = family === 'hinge' || family === 'module'
  const usesCenter =
    (usesElements && laser.layout === 'radial') ||
    (family === 'layers' && laser.layerJoin === 'center') ||
    laser.symmetry !== 'none'
  const editorPlaneSize = mmToThree(baseShape?.widthMm ?? laser.sheetWidthMm)

  const slider = (p: LaserParam) => (
    <ParamSlider
      key={p.key}
      param={p}
      value={laser[p.key]}
      onChange={(v) => setParam(p.key, v)}
    />
  )

  const filename =
    family === 'hinge'
      ? `corte-laser-bisagra-${laser.hingePattern}`
      : `corte-laser-${family}`

  const downloadSwatch = (variant: SwatchVariant) =>
    downloadSwatchSvg(
      buildSwatchSheet(laser, variant),
      variant === 'spacing'
        ? `muestrario-kerf-${laser.hingePattern}`
        : 'muestrario-kerf-patrones',
    )

  return (
    <div className="panel">
      <section>
        <h3>Fabricable por construccion</h3>
        <p className="hint">
          Entre dos cortes vecinos siempre queda al menos el puente minimo de material
          real ({result.bridgeMm.toFixed(1)} mm, ya descontado el kerf): los tamanos se
          recortan a lo que permite la grilla y lo que aun asi no entra se descarta.
          Ningun corte se acerca al borde a menos del margen, y no se generan rasgos
          menores a {MIN_FEATURE_MM} mm. Los calados se compensan kerf/2 hacia adentro y
          el contorno hacia afuera, para que la pieza fisica mida lo disenado.
        </p>
      </section>

      <section>
        <h3>Familia</h3>
        <div className="seg seg-grid seg-grid-3">
          {(Object.keys(FAMILY_LABELS) as LaserFamily[]).map((f) => (
            <button
              key={f}
              type="button"
              className={family === f ? 'active' : ''}
              onClick={() => setFamily(f)}
            >
              {FAMILY_LABELS[f]}
            </button>
          ))}
        </div>
        <p className="hint">{FAMILY_HINTS[family]}</p>
        {family === 'footprint' && spikeCount === 0 && (
          <p className="hint error">
            El modo Volumen no tiene puas: no hay huellas que cortar.
          </p>
        )}

        {family === 'hinge' && (
          <>
            <div className="seg seg-grid seg-grid-3 hinge-patterns">
              {(Object.keys(HINGE_LABELS) as HingePattern[]).map((h) => (
                <button
                  key={h}
                  type="button"
                  className={laser.hingePattern === h ? 'active' : ''}
                  onClick={() => setOption('hingePattern', h)}
                >
                  <HingeIcon pattern={h} />
                  {HINGE_LABELS[h]}
                </button>
              ))}
            </div>
            {hingeUiParams(laser.hingePattern).map(slider)}
          </>
        )}

        {family === 'layers' && (
          <>
            <div className="seg">
              {(Object.keys(LAYER_JOIN_LABELS) as LayerJoin[]).map((j) => (
                <button
                  key={j}
                  type="button"
                  className={laser.layerJoin === j ? 'active' : ''}
                  onClick={() => setOption('layerJoin', j)}
                >
                  {LAYER_JOIN_LABELS[j]}
                </button>
              ))}
            </div>
            {laser.layerJoin === 'edge' && (
              <div className="seg">
                {(Object.keys(LAYER_EDGE_LABELS) as LayerEdge[]).map((e) => (
                  <button
                    key={e}
                    type="button"
                    className={laser.layerEdge === e ? 'active' : ''}
                    onClick={() => setOption('layerEdge', e)}
                  >
                    {LAYER_EDGE_LABELS[e]}
                  </button>
                ))}
              </div>
            )}
            <p className="hint">
              {laser.layerJoin === 'center'
                ? 'Todas las capas rodean el centro (la cruz en la vista, arrastrable) y comparten el agujero central.'
                : 'Todas las capas nacen de la arista elegida, como hojas de un cuaderno, y comparten la fila de agujeros junto a ella.'}
            </p>
            {layersUiParams(laser.layerJoin).map(slider)}
          </>
        )}

        {family === 'module' && (
          <ModuleEditor
            module={laser.module}
            cellW={laser.moduleCellWMm}
            cellH={laser.moduleCellHMm}
            stagger={laser.moduleStagger}
            onChange={(m) => setOption('module', m)}
            onFromHinge={() => setOption('module', hingeAsModule(laser))}
          />
        )}

        {FAMILY_UI_PARAMS[family].map(slider)}
      </section>

      {usesField && (
        <section>
          <h3>Campo</h3>
          <div className="seg">
            {(Object.keys(DISTRIBUTION_LABELS) as LaserDistribution[]).map((d) => (
              <button
                key={d}
                type="button"
                className={laser.distribution === d ? 'active' : ''}
                onClick={() => setOption('distribution', d)}
              >
                {DISTRIBUTION_LABELS[d]}
              </button>
            ))}
          </div>
          {laser.distribution !== 'uniform' && FIELD_LASER_UI_PARAMS.map(slider)}
          {usesAlign && (
            <label className="check">
              <input
                type="checkbox"
                checked={laser.alignToField}
                onChange={toggleAlign}
              />
              Seguir el campo (orientacion)
            </label>
          )}
          {laser.distribution !== 'uniform' && (
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
      )}

      {usesField && (
        <section>
          <h3>Disposicion y simetria</h3>
          {usesElements && (
            <>
              <div className="seg">
                {(Object.keys(LAYOUT_LABELS) as LaserLayout[]).map((l) => (
                  <button
                    key={l}
                    type="button"
                    className={laser.layout === l ? 'active' : ''}
                    onClick={() => setOption('layout', l)}
                  >
                    {LAYOUT_LABELS[l]}
                  </button>
                ))}
              </div>
              {LAYOUT_UI_PARAMS.map(slider)}
              {laser.layout === 'radial' && (
                <>
                  {RADIAL_UI_PARAMS.map(slider)}
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={laser.radialWarp}
                      onChange={() => setOption('radialWarp', !laser.radialWarp)}
                    />
                    Curvar los elementos a lo largo del anillo
                  </label>
                </>
              )}
            </>
          )}
          {usesCellFlip && (
            <>
              <p className="hint">Alternancia de celdas</p>
              <div className="seg seg-grid seg-grid-3">
                {(Object.keys(CELL_FLIP_LABELS) as CellFlip[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={laser.cellFlip === c ? 'active' : ''}
                    onClick={() => setOption('cellFlip', c)}
                  >
                    {CELL_FLIP_LABELS[c]}
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="hint">Simetria del campo (copia los atractores)</p>
          <div className="seg seg-grid seg-grid-3">
            {(Object.keys(SYMMETRY_LABELS) as LaserSymmetry[]).map((s) => (
              <button
                key={s}
                type="button"
                className={laser.symmetry === s ? 'active' : ''}
                onClick={() => setOption('symmetry', s)}
              >
                {SYMMETRY_LABELS[s]}
              </button>
            ))}
          </div>
          {SYMMETRY_HINT[laser.symmetry] && (
            <p className="hint">{SYMMETRY_HINT[laser.symmetry]}</p>
          )}
          {(laser.symmetry === 'rotational' || laser.symmetry === 'kaleido') &&
            slider(SYMMETRY_ORDER_PARAM)}
          {usesCenter && (
            <>
              {CENTER_UI_PARAMS.map(slider)}
              <p className="hint">
                El centro tambien se arrastra en la vista (cruz); doble clic en la cruz lo
                devuelve al centro de la pieza.
              </p>
            </>
          )}
        </section>
      )}

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
        <label className="check">
          <input
            type="checkbox"
            checked={laser.kerfCompensation}
            onChange={() => setOption('kerfCompensation', !laser.kerfCompensation)}
          />
          Compensar kerf en el archivo
        </label>
        {!laser.kerfCompensation && (
          <p className="hint">
            Sin compensar: el archivo trae la geometria disenada (usalo si el software del
            laser aplica el offset). El puente se sigue calculando con el kerf real.
          </p>
        )}
      </section>

      {!baseShape && family !== 'footprint' && (
        <section>
          <h3>Pieza</h3>
          {SHEET_UI_PARAMS.map(slider)}
        </section>
      )}

      <BaseShapeImporter />

      {usesField && laser.distribution !== 'uniform' ? (
        <AttractorEditor
          set={attractorSet}
          planeSize={editorPlaneSize}
          hint={
            'Arrastra un punto en la vista para moverlo. Clic derecho: agrega un punto a ' +
            'la curva seleccionada (o un atractor nuevo si no hay curva seleccionada). ' +
            'Supr borra el punto seleccionado. Circulo = vertice suave (Bezier), cuadrado ' +
            '= esquina. Arrastrar el fondo desplaza, rueda = zoom, doble clic = encuadrar. ' +
            'Las copias por simetria se ven punteadas y no se editan.'
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
        {family === 'layers' ? (
          <>
            <h3>Cama de corte</h3>
            {BED_UI_PARAMS.map(slider)}
            <label className="check">
              <input
                type="checkbox"
                checked={previewBed}
                onChange={() => setPreviewBed(!previewBed)}
              />
              Ver las piezas en la cama
            </label>
            {bed && (
              <dl className="stats">
                <div>
                  <dt>Piezas</dt>
                  <dd>{result.pieces.length}</dd>
                </div>
                <div>
                  <dt>Camas</dt>
                  <dd>{bed.beds}</dd>
                </div>
                <div>
                  <dt>Largo de corte (cama)</dt>
                  <dd>{(bed.cutLengthMm / 1000).toFixed(2)} m</dd>
                </div>
                {bed.oversize > 0 && (
                  <div>
                    <dt>No entran en la cama</dt>
                    <dd>{bed.oversize}</dd>
                  </div>
                )}
              </dl>
            )}
            <p className="hint">
              Cada capa sale como pieza suelta, con su numero grabado al costado (fuera de
              la pieza). El marco de la cama va en su propia capa, solo de referencia: no
              lo cortes.
            </p>
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={!bed}
                onClick={() => bed && downloadBedSvg(bed, 'cama-capas')}
              >
                SVG cama (mm)
              </button>
              <button
                type="button"
                className="primary"
                disabled={!bed}
                onClick={() => bed && downloadBedDxf(bed, 'cama-capas')}
              >
                DXF cama (mm)
              </button>
            </div>
          </>
        ) : (
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
        )}
      </section>

      {family === 'hinge' && (
        <section>
          <h3>Muestrario de prueba</h3>
          <p className="hint">
            Tarjetas de 60 x 90 mm con agujero y rotulo grabado, para probar en el
            material real antes de la pieza: el patron actual con separaciones de{' '}
            {SWATCH_SPACINGS_MM[0]} a {SWATCH_SPACINGS_MM[SWATCH_SPACINGS_MM.length - 1]}{' '}
            mm, o todos los patrones con la separacion actual. Si el software del laser no
            lee texto, conviertelo a trazos.
          </p>
          <div className="row">
            <button type="button" onClick={() => downloadSwatch('spacing')}>
              Separaciones
            </button>
            <button type="button" onClick={() => downloadSwatch('patterns')}>
              Todos los patrones
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

/** Miniatura del elemento de cada patron (como los iconos de la muestra). */
function HingeIcon({ pattern }: { pattern: HingePattern }) {
  const kind = hingeLatticeKind(pattern)
  const shapes: Shape[] =
    kind === 'square'
      ? meanderElement(14, 0, 2.4)
      : kind === 'triangle'
        ? trianglesElement(15, true, 0, 2.2, 2.2)
        : hingeRowElement(pattern, 26, 6, 1)
  const d = shapes
    .map(
      (s) =>
        s.points
          .map(([x, z], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${z.toFixed(2)}`)
          .join('') + (s.closed ? 'Z' : ''),
    )
    .join('')
  const box = kind === 'brick' ? '-15 -5 30 10' : '-8 -8 16 16'
  return (
    <svg className="hinge-icon" viewBox={box} aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

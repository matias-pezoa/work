/** Panel del modo Corte laser: cortes y calados parametricos sobre una pieza plana. */
import { useId, useState, type ReactNode } from 'react'
import { useAppStore } from '../state/store'
import { importImageFile } from '../io/importImage'
import { IMAGE_MODE_LABELS, type ImageMode } from '../geometry/laserImage'
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
  LAYOUT_UI_PARAMS,
  MIN_FEATURE_MM,
  RADIAL_UI_PARAMS,
  SHEET_UI_PARAMS,
  SYMMETRY_ORDER_PARAM,
  BED_UI_PARAMS,
  IMAGE_BITMAP_UI_PARAMS,
  IMAGE_HALFTONE_UI_PARAMS,
  IMAGE_PLACE_UI_PARAMS,
  IMAGE_TONE_UI_PARAMS,
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
  downloadBedAi,
  downloadBedDxf,
  downloadBedSvg,
  downloadLaserAi,
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
import {
  SPECIMEN_SIZE_MM,
  specimenFileName,
  surnameSlug,
} from '../geometry/laserSpecimens'

interface LaserPanelProps {
  result: LaserCutResult
  /** Familia capas: piezas distribuidas en la cama (null en las demas). */
  bed: BedLayout | null
  /** Puas del modo Volumen disponibles para la familia "huella". */
  spikeCount: number
}

/** Que hace cada patron, en lenguaje simple. */
const FAMILY_HINTS: Record<LaserFamily, string> = {
  perforation:
    'Agujeros repetidos por la pieza. Cerca de los atractores crecen; con "Alargamiento" se vuelven ranuras.',
  kirigami:
    'Cortes rectos alternados: al tirar la pieza se estira hacia los dos lados (auxetico).',
  scales: 'Cortes en arco: las lenguetas se levantan como escamas al curvar la pieza.',
  hinge:
    'Filas de cortes que vuelven flexible un material rigido. Filas mas juntas = mas flexible (y mas fragil).',
  module:
    'Dibuja tu propio modulo en la celda y se repite por toda la pieza. Linea abierta = corte; cerrada = calado.',
  layers:
    'Capas concentricas, como curvas de nivel: cada capa es una pieza suelta para apilar. Se exportan repartidas en la cama del laser.',
  image: 'Carga una imagen: las zonas oscuras se vuelven calados.',
  footprint:
    'Un calado en la base de cada pua del modo Volumen, para anclar la impresion 3D a la tela.',
}

/** Que significa cada opcion de "Donde cambia el patron". */
const DISTRIBUTION_HINTS: Record<LaserDistribution, string> = {
  uniform: 'El patron es igual en toda la pieza.',
  full: 'El patron cubre toda la pieza y cambia de tamano cerca de los atractores (puntos y curvas que dibujas en la vista).',
  field:
    'El patron aparece solo cerca de los atractores (puntos y curvas que dibujas en la vista).',
}

const SYMMETRY_HINT: Record<LaserSymmetry, string> = {
  none: '',
  mirrorX: 'Cada atractor se refleja en el eje vertical que pasa por el centro.',
  mirrorZ: 'Cada atractor se refleja en el eje horizontal que pasa por el centro.',
  mirrorXZ: 'Reflejo en ambos ejes: cuatro copias de cada atractor.',
  rotational: 'N copias de cada atractor giradas alrededor del centro.',
  kaleido: 'N copias giradas y sus reflejos (2N): un caleidoscopio.',
}

const SPECIMEN_NUMBER_PARAM = {
  key: 'specimenNumber',
  label: 'Numero de probeta',
  min: 1,
  max: 50,
  step: 1,
  default: 1,
  unit: '-',
} as const

export function LaserPanel({ result, bed, spikeCount }: LaserPanelProps) {
  const laser = useAppStore((s) => s.laser)
  const setParam = useAppStore((s) => s.setLaserParam)
  const setOption = useAppStore((s) => s.setLaserOption)
  const setFamily = useAppStore((s) => s.setLaserFamily)
  const setCombine = useAppStore((s) => s.setLaserCombine)
  const toggleAlign = useAppStore((s) => s.toggleLaserAlign)
  const previewBed = useAppStore((s) => s.laserPreviewBed)
  const setPreviewBed = useAppStore((s) => s.setLaserPreviewBed)
  const piece = useAppStore((s) => s.laserPiece)
  const setPiece = useAppStore((s) => s.setLaserPiece)
  const surname = useAppStore((s) => s.specimenSurname)
  const setSurname = useAppStore((s) => s.setSpecimenSurname)
  const specimenNumber = useAppStore((s) => s.specimenNumber)
  const setSpecimenNumber = useAppStore((s) => s.setSpecimenNumber)

  const attractorSet = useAttractorSet('laser')
  const baseShape = useAppStore((s) => s.baseShape)

  const family = laser.family
  const specimen = piece === 'specimen'
  const laserImage = useAppStore((s) => s.laserImage)
  const imageField = laser.imgAsField && laserImage !== null && family !== 'image'
  const usesField = family !== 'footprint' && family !== 'image'
  const usesElements = ELEMENT_FAMILIES.has(family)
  const usesAlign = family === 'perforation' || family === 'scales' || family === 'module'
  const usesCellFlip = family === 'hinge' || family === 'module'
  const usesCenter =
    (usesElements && laser.layout === 'radial') ||
    (family === 'layers' && laser.layerJoin === 'center') ||
    laser.symmetry !== 'none'
  const editorPlaneSize = mmToThree(
    specimen ? SPECIMEN_SIZE_MM : (baseShape?.widthMm ?? laser.sheetWidthMm),
  )

  const slider = (p: LaserParam) => (
    <ParamSlider
      key={p.key}
      param={p}
      value={laser[p.key]}
      onChange={(v) => setParam(p.key, v)}
    />
  )

  const who = surnameSlug(surname)
  const filename = specimen
    ? specimenFileName(surname, specimenNumber)
    : who
      ? `${who}_pieza`
      : family === 'hinge'
        ? `corte-laser-bisagra-${laser.hingePattern}`
        : `corte-laser-${family}`
  // la probeta se nombra con el apellido: sin el no se exporta.
  const canExport = !specimen || who !== ''
  const empty = result.calados + result.cortes === 0
  // la probeta se exporta sin aire: el archivo mide 200 x 200 mm.
  const pad = specimen ? 0 : undefined

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
        <h3>1 · Pieza</h3>
        <div className="seg">
          <button
            type="button"
            className={specimen ? 'active' : ''}
            onClick={() => setPiece('specimen')}
          >
            Probeta 20 x 20 cm
          </button>
          <button
            type="button"
            className={!specimen ? 'active' : ''}
            onClick={() => setPiece('custom')}
          >
            Otra medida o forma
          </button>
        </div>
        <p className="hint">
          {specimen
            ? 'Un cuadrado de 20 x 20 cm listo para cortar. Disena el patron como en cualquier pieza.'
            : 'Elige el tamano de la pieza o importa su contorno desde un SVG.'}
        </p>
        {!specimen && !baseShape && family !== 'footprint' && SHEET_UI_PARAMS.map(slider)}
        {!specimen && <BaseShapeImporter />}
      </section>

      <section>
        <h3>2 · Patron</h3>
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
                ? 'Las capas rodean el centro (la cruz en la vista) y comparten un agujero central.'
                : 'Las capas nacen de la arista elegida, como hojas de un cuaderno.'}
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

        {family === 'image' && (
          <>
            <div className="seg">
              {(Object.keys(IMAGE_MODE_LABELS) as ImageMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={laser.imgMode === m ? 'active' : ''}
                  onClick={() => setOption('imgMode', m)}
                >
                  {IMAGE_MODE_LABELS[m]}
                </button>
              ))}
            </div>
            {(laser.imgMode === 'halftone'
              ? IMAGE_HALFTONE_UI_PARAMS
              : IMAGE_BITMAP_UI_PARAMS
            ).map(slider)}
            <ImageImporter slider={slider} />
          </>
        )}
      </section>

      {usesField && (
        <section>
          <h3>3 · Donde cambia el patron</h3>
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
          <p className="hint">{DISTRIBUTION_HINTS[laser.distribution]}</p>
          {laser.distribution !== 'uniform' && FIELD_LASER_UI_PARAMS.map(slider)}
          <label className="check">
            <input
              type="checkbox"
              checked={laser.imgAsField}
              onChange={() => setOption('imgAsField', !laser.imgAsField)}
            />
            Usar una imagen en vez de atractores (lo oscuro atrae)
          </label>
          {laser.imgAsField && <ImageImporter slider={slider} />}
          {usesAlign && (
            <label className="check">
              <input
                type="checkbox"
                checked={laser.alignToField}
                onChange={toggleAlign}
              />
              Orientar el patron segun los atractores
            </label>
          )}
        </section>
      )}

      {usesField && !imageField && laser.distribution !== 'uniform' ? (
        <AttractorEditor
          set={attractorSet}
          planeSize={editorPlaneSize}
          hint={
            'Arrastra un punto en la vista para moverlo. Clic derecho: agrega un punto. ' +
            'Supr borra el punto seleccionado. Rueda = zoom, doble clic = encuadrar.'
          }
        />
      ) : null}

      {usesField && (
        <details className="more">
          <summary>Mas opciones: simetria y disposicion</summary>
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
          <p className="hint">Simetria (copia los atractores)</p>
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
                El centro tambien se arrastra en la vista (cruz); doble clic la devuelve
                al centro de la pieza.
              </p>
            </>
          )}
          {laser.distribution !== 'uniform' && (
            <>
              <p className="hint">Varios atractores juntos</p>
              <div className="seg">
                <button
                  type="button"
                  className={laser.combine === 'max' ? 'active' : ''}
                  onClick={() => setCombine('max')}
                >
                  El mas fuerte
                </button>
                <button
                  type="button"
                  className={laser.combine === 'sum' ? 'active' : ''}
                  onClick={() => setCombine('sum')}
                >
                  Se suman
                </button>
              </div>
            </>
          )}
        </details>
      )}

      <section>
        <h3>{usesField ? '4' : '3'} · Exportar</h3>
        <label className="param">
          <span className="param-label">Apellido</span>
          <input
            type="text"
            className="text-input"
            value={surname}
            placeholder="Ej. Pezoa"
            maxLength={40}
            onChange={(e) => setSurname(e.target.value)}
          />
        </label>
        {specimen && (
          <ParamSlider
            param={SPECIMEN_NUMBER_PARAM}
            value={specimenNumber}
            onChange={setSpecimenNumber}
          />
        )}
        {canExport ? (
          <p className="hint">
            Archivo: <code>{filename}</code>
          </p>
        ) : (
          <p className="hint error">
            Escribe tu apellido para exportar: el archivo se llama
            apellido_probeta_numero.
          </p>
        )}
        <dl className="stats">
          <div>
            <dt>Calados</dt>
            <dd>{result.calados}</dd>
          </div>
          {result.cortes > 0 && (
            <div>
              <dt>Cortes</dt>
              <dd>{result.cortes}</dd>
            </div>
          )}
          <div>
            <dt>Largo de corte</dt>
            <dd>{(result.cutLengthMm / 1000).toFixed(2)} m</dd>
          </div>
          <div>
            <dt>Pieza</dt>
            <dd>
              {(result.bounds.maxX - result.bounds.minX).toFixed(0)} x{' '}
              {(result.bounds.maxZ - result.bounds.minZ).toFixed(0)} mm
            </dd>
          </div>
        </dl>
        {empty && family !== 'layers' && (
          <p className="hint error">
            Todavia no hay nada que cortar: revisa el patron o agrega atractores.
          </p>
        )}
        {family === 'layers' ? (
          <>
            {BED_UI_PARAMS.map(slider)}
            <label className="check">
              <input
                type="checkbox"
                checked={previewBed}
                onChange={() => setPreviewBed(!previewBed)}
              />
              Ver las piezas en la cama del laser
            </label>
            {bed && bed.oversize > 0 && (
              <p className="hint error">
                {bed.oversize} pieza(s) no entran en la cama: agrandala.
              </p>
            )}
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={!bed || !canExport}
                onClick={() => bed && downloadBedSvg(bed, filename)}
              >
                SVG
              </button>
              <button
                type="button"
                className="primary"
                disabled={!bed || !canExport}
                onClick={() => bed && downloadBedDxf(bed, filename)}
              >
                DXF
              </button>
              <button
                type="button"
                className="primary"
                disabled={!bed || !canExport}
                onClick={() => bed && downloadBedAi(bed, filename)}
              >
                AI
              </button>
            </div>
          </>
        ) : (
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={!canExport}
              onClick={() => downloadLaserSvg(result, filename, pad)}
            >
              SVG
            </button>
            <button
              type="button"
              className="primary"
              disabled={!canExport}
              onClick={() => downloadLaserDxf(result, filename)}
            >
              DXF
            </button>
            <button
              type="button"
              className="primary"
              disabled={!canExport}
              onClick={() => downloadLaserAi(result, filename, pad)}
            >
              AI
            </button>
          </div>
        )}
        <p className="hint">
          AI = Illustrator 3, el formato que leen RDWorks y LightBurn. Colores: calados
          azul, cortes verde, contorno rojo (se corta al final).
        </p>
        <details className="more nested">
          <summary>Detalle tecnico</summary>
          <dl className="stats">
            <div>
              <dt>Area calada</dt>
              <dd>{(result.openRatio * 100).toFixed(1)} %</dd>
            </div>
            <div>
              <dt>Descartados por margen</dt>
              <dd>{result.rejectedByEdge}</dd>
            </div>
            <div>
              <dt>Descartados por puente</dt>
              <dd>{result.rejectedByBridge}</dd>
            </div>
            <div>
              <dt>Recortados al puente</dt>
              <dd>{result.limitedByBridge}</dd>
            </div>
            <div>
              <dt>Menores a {MIN_FEATURE_MM} mm</dt>
              <dd>{result.skippedBySize}</dd>
            </div>
          </dl>
        </details>
      </section>

      {family === 'hinge' && (
        <details className="more">
          <summary>Muestrario de bisagras</summary>
          <p className="hint">
            Tarjetas de 60 x 90 mm para comparar en el material: el patron actual con
            separaciones de {SWATCH_SPACINGS_MM[0]} a{' '}
            {SWATCH_SPACINGS_MM[SWATCH_SPACINGS_MM.length - 1]} mm, o todos los patrones.
          </p>
          <div className="row">
            <button type="button" onClick={() => downloadSwatch('spacing')}>
              Separaciones
            </button>
            <button type="button" onClick={() => downloadSwatch('patterns')}>
              Todos los patrones
            </button>
          </div>
        </details>
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

/**
 * Carga de imagen (familia imagen o imagen como campo): archivo, miniatura y
 * los ajustes de tono y encuadre compartidos por ambos usos.
 */
function ImageImporter({ slider }: { slider: (p: LaserParam) => ReactNode }) {
  const image = useAppStore((s) => s.laserImage)
  const setImage = useAppStore((s) => s.setLaserImage)
  const laser = useAppStore((s) => s.laser)
  const setOption = useAppStore((s) => s.setLaserOption)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputId = useId()

  const handleFile = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      setImage(await importImageFile(file))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer la imagen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="image-importer">
      <label htmlFor={inputId} className="file-drop">
        {busy
          ? 'Leyendo…'
          : image
            ? `Cambiar imagen (${image.fileName})`
            : '+ Cargar imagen (PNG, JPG, WebP, SVG)'}
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = '' // permite re-subir el mismo archivo
          if (file) void handleFile(file)
        }}
      />
      {error && <p className="hint error">{error}</p>}
      {image ? (
        <>
          <img
            className="image-thumb"
            src={image.previewUrl}
            alt=""
            style={laser.imgInvert ? { filter: 'invert(1)' } : undefined}
          />
          <p className="hint">
            La imagen cubre la pieza: usa zoom y desplazamiento para encuadrarla.
          </p>
          {IMAGE_TONE_UI_PARAMS.map(slider)}
          <label className="check">
            <input
              type="checkbox"
              checked={laser.imgInvert}
              onChange={() => setOption('imgInvert', !laser.imgInvert)}
            />
            Invertir (calar lo claro)
          </label>
          {IMAGE_PLACE_UI_PARAMS.map(slider)}
          <button type="button" className="ghost" onClick={() => setImage(null)}>
            Quitar imagen
          </button>
        </>
      ) : (
        <p className="hint">Sin imagen cargada no se genera ningun calado.</p>
      )}
    </div>
  )
}

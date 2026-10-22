/** Panel del modo Ondas: peine de costillas independientes (contour) desde un plano. */
import * as THREE from 'three'
import { useAppStore } from '../state/store'
import type { WaveNumericKey } from '../state/store'
import { ParamSlider } from './ParamSlider'
import { AttractorEditor } from './AttractorEditor'
import { BaseShapeImporter } from './BaseShapeImporter'
import {
  WAVE_UI_PARAMS,
  MIN_RIB_THICKNESS_MM,
  MIN_SPACING_MM,
  MIN_WAVELENGTH_MM,
} from '../geometry/waveField'
import type { WaveFieldResult } from '../geometry/waveField'
import { downloadStl } from '../io/exportSTL'
import { mmToThree, threeToMm } from '../utils/units'

interface WaveFieldPanelProps {
  result: WaveFieldResult
}

export function WaveFieldPanel({ result }: WaveFieldPanelProps) {
  const wave = useAppStore((s) => s.wave)
  const setWaveParam = useAppStore((s) => s.setWaveParam)
  const setWaveCombine = useAppStore((s) => s.setWaveCombine)

  const attractors = useAppStore((s) => s.waveAttractors)
  const selectedId = useAppStore((s) => s.selectedWaveAttractorId)
  const addAttractor = useAppStore((s) => s.addWaveAttractor)
  const addAttractorCurve = useAppStore((s) => s.addWaveAttractorCurve)
  const selectAttractor = useAppStore((s) => s.selectWaveAttractor)
  const updateAttractor = useAppStore((s) => s.updateWaveAttractor)
  const removeAttractor = useAppStore((s) => s.removeWaveAttractor)
  const baseShape = useAppStore((s) => s.baseShape)

  const set = (key: WaveNumericKey) => (v: number) => setWaveParam(key, v)
  const editorPlaneSize = baseShape ? mmToThree(baseShape.widthMm) : wave.planeSize

  const sizeMm = result.bounds.isEmpty()
    ? [0, 0, 0]
    : new THREE.Vector3()
        .subVectors(result.bounds.max, result.bounds.min)
        .toArray()
        .map(threeToMm)

  return (
    <div className="panel">
      <section>
        <h3>Factibilidad de impresion (FDM)</h3>
        <p className="hint">
          Cada costilla es una pieza solida INDEPENDIENTE (un corte/contour, no un
          calado CNC): nace en y = 0 y no hay ninguna plancha de base que las una —
          la base es la tela que ya esta puesta en la cama de impresion. Espesor de
          costilla minimo {MIN_RIB_THICKNESS_MM}mm (se recorta si no entra en la
          separacion pedida, se avisa abajo); separacion minima entre ejes{' '}
          {MIN_SPACING_MM}mm; longitud de onda minima {MIN_WAVELENGTH_MM}mm. Al no
          tener voladizo real (son paredes casi verticales, el perfil solo sube y
          baja dentro de la pared) no hace falta recortar la amplitud por angulo —
          el riesgo en este modo es la esbeltez (costillas muy altas y finas pueden
          vibrar o desprenderse), reportada abajo. Con "Altura minima (valle)" en 0,
          las zonas sin influencia de ningun atractor quedan directamente vacias (sin
          material) en vez de mostrar una costilla plana.
        </p>
      </section>

      <BaseShapeImporter />

      <section>
        <h3>Panel y ondas</h3>
        {baseShape && (
          <p className="hint">
            Usando la base importada ({baseShape.widthMm.toFixed(0)} x{' '}
            {baseShape.heightMm.toFixed(0)} mm) en vez del panel cuadrado.
          </p>
        )}
        {WAVE_UI_PARAMS.filter((p) => !baseShape || p.key !== 'planeSize').map((p) => (
          <ParamSlider
            key={p.key}
            param={p}
            value={wave[p.key as WaveNumericKey] as number}
            onChange={set(p.key as WaveNumericKey)}
          />
        ))}
        <p className="hint">
          "Muestras por onda" baja (2-4) da un perfil angular, de segmentos rectos
          bien marcados; alta (12+) da una curva suave por costilla.
        </p>
        <div className="seg">
          <button
            type="button"
            className={wave.combine === 'max' ? 'active' : ''}
            onClick={() => setWaveCombine('max')}
          >
            Campo: maximo
          </button>
          <button
            type="button"
            className={wave.combine === 'sum' ? 'active' : ''}
            onClick={() => setWaveCombine('sum')}
          >
            Campo: suma
          </button>
        </div>
      </section>

      <AttractorEditor
        attractors={attractors}
        selectedId={selectedId}
        planeSize={editorPlaneSize}
        onAdd={addAttractor}
        onAddCurve={addAttractorCurve}
        onSelect={selectAttractor}
        onUpdate={updateAttractor}
        onRemove={removeAttractor}
      />

      <section>
        <h3>Exportar</h3>
        <dl className="stats">
          <div>
            <dt>Espesor de costilla aplicado</dt>
            <dd>
              {result.appliedRibThicknessMm.toFixed(2)} mm
              {result.thicknessLimited ? ' (recortado)' : ''}
            </dd>
          </div>
          <div>
            <dt>Costillas</dt>
            <dd>
              {result.ribCount}
              {result.segmentCount !== result.ribCount
                ? ` (${result.segmentCount} piezas: algunas partidas o vacias por el contorno o la altura minima)`
                : ''}
            </dd>
          </div>
          <div>
            <dt>Altura maxima</dt>
            <dd>
              {result.maxHeightMm.toFixed(1)} mm — esbeltez {result.maxAspectRatio.toFixed(1)}:1
              {result.maxAspectRatio > 15 ? ' (alta, cuidado al imprimir)' : ''}
            </dd>
          </div>
          <div>
            <dt>Triangulos</dt>
            <dd>{result.triangleCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Dimensiones</dt>
            <dd>{sizeMm.map((n) => n.toFixed(0)).join(' x ')} mm</dd>
          </div>
        </dl>
        <button
          type="button"
          className="primary"
          onClick={() => downloadStl(result.geometry, { filename: 'panel-de-ondas' })}
        >
          Descargar STL (mm)
        </button>
      </section>
    </div>
  )
}

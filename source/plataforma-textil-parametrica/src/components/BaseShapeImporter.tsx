/**
 * Seccion de panel para importar una base personalizada (p. ej. una pieza de
 * patron) desde un SVG, compartida entre Volumen y Ondas. Reemplaza el panel
 * cuadrado por defecto cuando hay una forma importada.
 */
import { useId, useState } from 'react'
import { useAppStore } from '../state/store'
import { importSvgFile } from '../io/importSvg'

export function BaseShapeImporter() {
  const baseShape = useAppStore((s) => s.baseShape)
  const setBaseShape = useAppStore((s) => s.setBaseShape)
  const setBaseShapeWidthMm = useAppStore((s) => s.setBaseShapeWidthMm)
  const clearBaseShape = useAppStore((s) => s.clearBaseShape)

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputId = useId()

  const handleFile = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const imported = await importSvgFile(file)
      // ancho por defecto: 200mm, o el actual si ya habia una base cargada
      setBaseShape(imported, baseShape?.widthMm ?? 200, file.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el SVG.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h3>Base personalizada</h3>
      <p className="hint">
        Importa un SVG (p. ej. una pieza de patron) para sembrar solo dentro de ese
        contorno, en vez del panel cuadrado. Un segundo contorno cerrado dentro del
        primero se trata como agujero (p. ej. una pinza).
      </p>

      <label htmlFor={inputId} className="file-drop">
        {busy
          ? 'Leyendo…'
          : baseShape
            ? `Cambiar archivo (${baseShape.fileName})`
            : '+ Importar SVG'}
      </label>
      <input
        id={inputId}
        type="file"
        accept=".svg,image/svg+xml"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = '' // permite re-subir el mismo archivo
          if (file) void handleFile(file)
        }}
      />

      {error && <p className="hint error">{error}</p>}

      {baseShape && (
        <>
          <ParamSliderInline
            label="Ancho real"
            unit="mm"
            value={baseShape.widthMm}
            min={20}
            max={1000}
            step={1}
            onChange={setBaseShapeWidthMm}
          />
          <dl className="stats">
            <div>
              <dt>Alto (proporcional)</dt>
              <dd>{baseShape.heightMm.toFixed(0)} mm</dd>
            </div>
            <div>
              <dt>Agujeros detectados</dt>
              <dd>{baseShape.holes.length}</dd>
            </div>
          </dl>
          <button type="button" className="ghost" onClick={clearBaseShape}>
            Quitar base personalizada (volver al panel cuadrado)
          </button>
        </>
      )}
    </section>
  )
}

/** Slider minimo, sin depender de un NumberParam fijo (el rango es dinamico). */
function ParamSliderInline({
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <label className="param">
      <span className="param-label">
        {label}
        <span className="param-value">
          {value.toFixed(0)} {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

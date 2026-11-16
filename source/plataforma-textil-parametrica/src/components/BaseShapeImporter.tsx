/**
 * Seccion de panel para importar una base personalizada (p. ej. una pieza de
 * patron) desde un SVG, DXF o PDF, compartida entre Volumen, Ondas y Corte
 * laser. Reemplaza el panel cuadrado por defecto cuando hay una forma importada.
 * Si el archivo trae varias piezas, se elige con cual trabajar.
 */
import { useId, useState } from 'react'
import { useAppStore } from '../state/store'
import { BASE_FILE_ACCEPT, importBaseFile } from '../io/importBase'
import type { ImportedBoundary } from '../io/importBoundary'
import { polygonBounds, type Vec2 } from '../geometry/polygon'

export function BaseShapeImporter() {
  const baseShape = useAppStore((s) => s.baseShape)
  const setBaseShape = useAppStore((s) => s.setBaseShape)
  const selectBasePiece = useAppStore((s) => s.selectBasePiece)
  const setBaseShapeWidthMm = useAppStore((s) => s.setBaseShapeWidthMm)
  const clearBaseShape = useAppStore((s) => s.clearBaseShape)

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputId = useId()

  const handleFile = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const imported = await importBaseFile(file)
      // ancho: el real si el archivo trae unidades (DXF, PDF); si no, el
      // actual si ya habia una base cargada, o 200 mm.
      setBaseShape(imported, baseShape?.widthMm ?? 200, file.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el archivo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h3>Base personalizada</h3>
      <p className="hint">
        Importa un SVG, DXF o PDF vectorial (p. ej. una pieza de patron) para
        trabajar solo dentro de ese contorno, en vez del panel cuadrado. Un segundo
        contorno cerrado dentro del primero se trata como agujero (p. ej. una
        pinza). Si el archivo trae varias piezas, elige con cual trabajar. DXF y
        PDF conservan su medida real.
      </p>

      <label htmlFor={inputId} className="file-drop">
        {busy
          ? 'Leyendo…'
          : baseShape
            ? `Cambiar archivo (${baseShape.fileName})`
            : '+ Importar SVG, DXF o PDF'}
      </label>
      <input
        id={inputId}
        type="file"
        accept={BASE_FILE_ACCEPT}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = '' // permite re-subir el mismo archivo
          if (file) void handleFile(file)
        }}
      />

      {error && <p className="hint error">{error}</p>}

      {baseShape && baseShape.pieces.length > 1 && (
        <PiecePicker
          pieces={baseShape.pieces}
          active={baseShape.pieceIndex}
          mmPerUnit={baseShape.widthMm / rawWidth(baseShape.pieces[baseShape.pieceIndex])}
          onSelect={selectBasePiece}
        />
      )}

      {baseShape && (
        <>
          <ParamSliderInline
            label="Ancho real"
            unit="mm"
            value={baseShape.widthMm}
            min={20}
            max={Math.max(1000, Math.ceil(baseShape.widthMm))}
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

function rawWidth(piece: ImportedBoundary): number {
  const b = polygonBounds(piece.outer)
  return Math.max(b.maxX - b.minX, 1e-6)
}

/** Miniaturas de las piezas del archivo; la activa queda marcada. */
function PiecePicker({
  pieces,
  active,
  mmPerUnit,
  onSelect,
}: {
  pieces: readonly ImportedBoundary[]
  active: number
  mmPerUnit: number
  onSelect: (index: number) => void
}) {
  return (
    <div className="piece-picker">
      <p className="hint">
        {pieces.length} piezas en el archivo: elige con cual trabajar.
      </p>
      <ul>
        {pieces.map((piece, k) => {
          const b = polygonBounds(piece.outer)
          const w = (b.maxX - b.minX) * mmPerUnit
          const h = (b.maxZ - b.minZ) * mmPerUnit
          return (
            <li key={k}>
              <button
                type="button"
                className={k === active ? 'active' : undefined}
                aria-pressed={k === active}
                onClick={() => onSelect(k)}
                title={`Pieza ${k + 1}: ${w.toFixed(0)} x ${h.toFixed(0)} mm`}
              >
                <PieceThumb piece={piece} />
                <span>
                  {k + 1} · {w.toFixed(0)}×{h.toFixed(0)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function PieceThumb({ piece }: { piece: ImportedBoundary }) {
  const b = polygonBounds(piece.outer)
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 1e-6)
  const pad = size * 0.06
  // Y del archivo hacia arriba -> SVG hacia abajo.
  const ring = (pts: readonly Vec2[]) =>
    'M' + pts.map(([x, z]) => `${(x - b.minX).toFixed(2)} ${(b.maxZ - z).toFixed(2)}`).join('L') + 'Z'
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${b.maxX - b.minX + 2 * pad} ${b.maxZ - b.minZ + 2 * pad}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <path
        d={ring(piece.outer) + piece.holes.map(ring).join('')}
        fillRule="evenodd"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
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

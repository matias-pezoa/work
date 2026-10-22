/** Slider generico a partir de un descriptor NumberParam. */
import type { NumberParam } from '../utils/params'

interface ParamSliderProps {
  param: NumberParam
  value: number
  onChange: (value: number) => void
}

export function ParamSlider({ param, value, onChange }: ParamSliderProps) {
  return (
    <label className="param">
      <span className="param-label">
        {param.label}
        <span className="param-value">
          {formatValue(value)} {param.unit !== '-' ? param.unit : ''}
        </span>
      </span>
      <input
        type="range"
        min={param.min}
        max={param.max}
        step={param.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

function formatValue(v: number): string {
  if (Number.isInteger(v)) return String(v)
  return v.toFixed(2)
}

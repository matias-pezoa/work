/**
 * Descriptor de un parametro numerico expuesto en la UI.
 * Regla del proyecto: todo parametro visible tiene nombre legible, rango
 * min/max razonable, valor por defecto y unidad explicita.
 */
export interface NumberParam {
  readonly key: string
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly default: number
  /** Unidad legible: 'mm', 'cm', 'grados', '-' (adimensional), etc. */
  readonly unit: string
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Remapea x de [inMin,inMax] a [outMin,outMax] con recorte a los extremos. */
export function remap(
  x: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax === inMin) return outMin
  const t = clamp((x - inMin) / (inMax - inMin), 0, 1)
  return lerp(outMin, outMax, t)
}

export const DEG2RAD = Math.PI / 180
export const RAD2DEG = 180 / Math.PI

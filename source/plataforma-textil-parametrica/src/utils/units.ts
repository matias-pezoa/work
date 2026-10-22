/**
 * Conversion de unidades centralizada.
 *
 * Regla del proyecto (CLAUDE.md): todo lo que va a fabricacion se razona en
 * milimetros. El viewport 3D usa "unidades de Three.js" normalizadas para que
 * las escenas sean comodas de orbitar; la conversion a mm debe ser explicita
 * y pasar SIEMPRE por este modulo.
 *
 * Definicion actual: 1 unidad de Three.js = 1 cm = 10 mm.
 * Si cambia, cambia solo aca.
 */

/** Milimetros que representa 1 unidad de Three.js. */
export const MM_PER_THREE_UNIT = 10

/** Unidad de Three.js -> milimetros. */
export function threeToMm(value: number): number {
  return value * MM_PER_THREE_UNIT
}

/** Milimetros -> unidad de Three.js. */
export function mmToThree(value: number): number {
  return value / MM_PER_THREE_UNIT
}

/** Convierte un array plano de posiciones [x,y,z, x,y,z, ...] de Three a mm (copia). */
export function positionsThreeToMm(positions: ArrayLike<number>): Float32Array {
  const out = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i++) out[i] = positions[i] * MM_PER_THREE_UNIT
  return out
}

/** Etiqueta legible para la UI, p. ej. formatMm(12.3456) -> "12.35 mm". */
export function formatMm(valueMm: number, decimals = 2): string {
  return `${valueMm.toFixed(decimals)} mm`
}

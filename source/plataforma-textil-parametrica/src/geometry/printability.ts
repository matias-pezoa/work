/**
 * Constantes de factibilidad de impresion FDM compartidas entre modulos de
 * geometria (spike.ts, waveField.ts, ...). Un solo lugar para no relajar
 * estos limites sin querer al agregar un modulo nuevo.
 */

/**
 * Angulo de vuelo (medido desde la vertical) que FDM imprime sin soporte de
 * forma confiable, independientemente del material. Es un techo defensivo:
 * ningun parametro puede llevar una pieza por encima de esto.
 */
export const SAFE_OVERHANG_DEG = 45

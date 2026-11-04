/**
 * Probeta: el diseno del modo Corte laser sobre una pieza fija de 200 x 200 mm,
 * con todas las herramientas de Diseno. Es lo mismo que fijar la Pieza a mano
 * en 200 x 200, pero en un clic; el archivo se nombra `apellido_probeta_NN`
 * para no confundir las probetas en la mesa del laser. Funciones puras.
 */
import type { LaserParams } from './laserCut'

/** Lado de la probeta (mm). */
export const SPECIMEN_SIZE_MM = 200

/** Parametros con la pieza fijada al formato de la probeta. */
export function specimenParams(laser: LaserParams): LaserParams {
  return { ...laser, sheetWidthMm: SPECIMEN_SIZE_MM, sheetHeightMm: SPECIMEN_SIZE_MM }
}

/** Apellido apto para nombre de archivo: sin tildes, espacios ni simbolos. */
export function surnameSlug(surname: string): string {
  return surname
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Nombre de archivo de una probeta: `apellido_probeta_03` (numero con 2 cifras o mas). */
export function specimenFileName(surname: string, number: number): string {
  const n = String(Math.max(1, Math.round(number))).padStart(2, '0')
  const who = surnameSlug(surname)
  return who ? `${who}_probeta_${n}` : `probeta_${n}`
}

/**
 * Imagen -> mapa de bits -> calados (modo Corte laser).
 *
 * La imagen llega ya reducida a luminancia (ver io/importImage.ts) y se
 * apoya sobre la pieza "cubriendola" (como object-fit: cover), con zoom y
 * desplazamiento. De ahi salen dos usos:
 *   - familia `image`: la imagen se rasteriza a una grilla de `imgPitchMm`
 *     y cada celda oscura se vuelve un calado:
 *       halftone   semitono: el tamano del calado sigue la oscuridad
 *       threshold  mapa de bits 1 bit por umbral: calado lleno o nada
 *       dither     mapa de bits 1 bit con difusion de error (Floyd-Steinberg):
 *                  conserva los grises como densidad de calados
 *   - `imgAsField`: la oscuridad reemplaza al campo de atractores en las
 *     demas familias (calado, bisagra, capas...).
 *
 * El puente sale de la grilla igual que en el calado por campo: el tamano
 * maximo de cada calado es `paso - puente` (ver laserCut.ts, buildImage).
 * Funciones puras.
 */
import { clamp } from '../utils/params'
import type { Bounds2D } from './polygon'

/** Imagen en escala de grises, fila por fila: 0 = negro, 1 = blanco. */
export interface LaserBitmap {
  width: number
  height: number
  lum: ArrayLike<number>
}

export type ImageMode = 'halftone' | 'threshold' | 'dither'

export const IMAGE_MODE_LABELS: Record<ImageMode, string> = {
  halftone: 'Semitono',
  threshold: 'Umbral (1 bit)',
  dither: 'Tramado (1 bit)',
}

export interface ImageMapParams {
  /** Zoom sobre el encuadre "cubrir la pieza" (1 = la imagen cubre justo la pieza). */
  imgScale: number
  imgOffsetXMm: number
  imgOffsetZMm: number
  /** Contraste alrededor del gris medio (1 = sin cambio). */
  imgContrast: number
  /** Brillo sumado a la luminancia (-1..1). */
  imgBrightness: number
  /** Gamma sobre la luminancia (>1 aclara los medios tonos, <1 los oscurece). */
  imgGamma: number
  imgInvert: boolean
}

/** Rectangulo (mm) que ocupa la imagen sobre la pieza. */
export interface ImageRect {
  x: number
  z: number
  w: number
  h: number
}

export function imageRect(
  bitmap: Pick<LaserBitmap, 'width' | 'height'>,
  sheet: Bounds2D,
  p: Pick<ImageMapParams, 'imgScale' | 'imgOffsetXMm' | 'imgOffsetZMm'>,
): ImageRect {
  const sw = sheet.maxX - sheet.minX
  const sh = sheet.maxZ - sheet.minZ
  const mmPerPx =
    Math.max(sw / bitmap.width, sh / bitmap.height) * Math.max(0.05, p.imgScale)
  const w = bitmap.width * mmPerPx
  const h = bitmap.height * mmPerPx
  const cx = (sheet.minX + sheet.maxX) / 2 + p.imgOffsetXMm
  const cz = (sheet.minZ + sheet.maxZ) / 2 + p.imgOffsetZMm
  return { x: cx - w / 2, z: cz - h / 2, w, h }
}

/** Ajustes de tono: luminancia cruda -> oscuridad 0 (blanco) .. 1 (negro). */
export function toneToDarkness(lum: number, p: ImageMapParams): number {
  let v = clamp(lum + p.imgBrightness, 0, 1)
  v = clamp((v - 0.5) * Math.max(0, p.imgContrast) + 0.5, 0, 1)
  v = Math.pow(v, 1 / Math.max(0.05, p.imgGamma))
  const dark = 1 - v
  return p.imgInvert ? 1 - dark : dark
}

/**
 * Muestreador de oscuridad en mm. Fuera de la imagen devuelve 0 (blanco: no
 * se cala). `cell` > 0 promedia una caja de ese lado (filtro de reduccion,
 * para que una celda grande no tome un pixel suelto).
 */
export interface ImageSampler {
  rect: ImageRect
  darkness: (x: number, z: number, cell?: number) => number
}

export function createImageSampler(
  bitmap: LaserBitmap,
  sheet: Bounds2D,
  p: ImageMapParams,
): ImageSampler {
  const rect = imageRect(bitmap, sheet, p)
  const { width: W, height: H, lum } = bitmap
  const pxPerMm = W / rect.w

  // bilineal sobre la luminancia cruda; los ajustes de tono van despues.
  const lumAt = (x: number, z: number): number | null => {
    const u = (x - rect.x) * pxPerMm - 0.5
    const v = (z - rect.z) * pxPerMm - 0.5
    if (u < -0.5 || v < -0.5 || u > W - 0.5 || v > H - 0.5) return null
    const i0 = clamp(Math.floor(u), 0, W - 1)
    const j0 = clamp(Math.floor(v), 0, H - 1)
    const i1 = Math.min(i0 + 1, W - 1)
    const j1 = Math.min(j0 + 1, H - 1)
    const fu = clamp(u - i0, 0, 1)
    const fv = clamp(v - j0, 0, 1)
    const a = lum[j0 * W + i0]
    const b = lum[j0 * W + i1]
    const c = lum[j1 * W + i0]
    const d = lum[j1 * W + i1]
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv
  }

  const darkness = (x: number, z: number, cell = 0): number => {
    // sub-muestras: ~1 por pixel de imagen dentro de la caja, entre 1 y 5 por eje.
    const n = cell > 0 ? clamp(Math.round(cell * pxPerMm), 1, 5) : 1
    let sum = 0
    let count = 0
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        const sx = n === 1 ? x : x + ((a + 0.5) / n - 0.5) * cell
        const sz = n === 1 ? z : z + ((b + 0.5) / n - 0.5) * cell
        const l = lumAt(sx, sz)
        sum += l === null ? 0 : toneToDarkness(l, p)
        count++
      }
    }
    return sum / count
  }

  return { rect, darkness }
}

/**
 * Pasa una grilla de oscuridades (filas) a 1 bit. `threshold`: negro si la
 * oscuridad supera el umbral. `dither`: Floyd-Steinberg en serpentina (el
 * error de cada celda se reparte a las vecinas aun no procesadas), asi un
 * gris medio queda como un tablero de calados en vez de todo o nada.
 */
export function toOneBit(
  grid: readonly (readonly number[])[],
  threshold: number,
  dither: boolean,
): boolean[][] {
  const rows = grid.length
  const cols = rows ? grid[0].length : 0
  const thr = clamp(threshold, 0, 1)
  if (!dither) return grid.map((row) => row.map((v) => v > thr))
  const work = grid.map((row) => [...row])
  const out = grid.map((row) => row.map(() => false))
  for (let j = 0; j < rows; j++) {
    const ltr = j % 2 === 0
    for (let k = 0; k < cols; k++) {
      const i = ltr ? k : cols - 1 - k
      const old = work[j][i]
      const on = old > thr
      out[j][i] = on
      const err = old - (on ? 1 : 0)
      const fwd = ltr ? 1 : -1
      const spread = (di: number, dj: number, w: number) => {
        const ii = i + di
        const jj = j + dj
        if (ii >= 0 && ii < cols && jj < rows) work[jj][ii] += err * w
      }
      spread(fwd, 0, 7 / 16)
      spread(-fwd, 1, 3 / 16)
      spread(0, 1, 5 / 16)
      spread(fwd, 1, 1 / 16)
    }
  }
  return out
}

/**
 * RGBA (como `ImageData.data`) -> luminancia 0..1, con el canal alfa
 * compuesto sobre blanco (un PNG transparente no se vuelve un calado negro).
 */
export function rgbaToLuminance(
  data: ArrayLike<number>,
  width: number,
  height: number,
): Float32Array {
  const out = new Float32Array(width * height)
  for (let k = 0; k < width * height; k++) {
    const r = data[4 * k] / 255
    const g = data[4 * k + 1] / 255
    const b = data[4 * k + 2] / 255
    const a = data[4 * k + 3] / 255
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    out[k] = y * a + (1 - a)
  }
  return out
}

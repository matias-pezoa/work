/**
 * Imagen (PNG, JPG, WebP, SVG...) -> mapa de luminancia para el modo Corte
 * laser. Se decodifica con las APIs del navegador (no hay en jsdom/Node: se
 * verifica a mano en un navegador real, como importSvg) y se reduce a lo
 * sumo `MAX_IMAGE_PX` por lado: la grilla de calados nunca necesita mas
 * resolucion, y el estado queda liviano. La conversion RGBA -> luminancia
 * es pura (laserImage.ts, testeada).
 */
import { rgbaToLuminance } from '../geometry/laserImage'

export const MAX_IMAGE_PX = 400

export interface ImportedImage {
  width: number
  height: number
  lum: Float32Array
  /** Vista previa en grises (data URL) para dibujar bajo los calados. */
  previewUrl: string
  fileName: string
}

export async function importImageFile(file: File): Promise<ImportedImage> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const iw = img.naturalWidth || img.width
    const ih = img.naturalHeight || img.height
    if (!iw || !ih) throw new Error('La imagen no tiene tamano legible.')
    const k = Math.min(1, MAX_IMAGE_PX / Math.max(iw, ih))
    const width = Math.max(1, Math.round(iw * k))
    const height = Math.max(1, Math.round(ih * k))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const g = canvas.getContext('2d', { willReadFrequently: true })
    if (!g) throw new Error('El navegador no permite leer la imagen.')
    g.imageSmoothingQuality = 'high'
    g.drawImage(img, 0, 0, width, height)
    const data = g.getImageData(0, 0, width, height)
    const lum = rgbaToLuminance(data.data, width, height)

    // vista previa: la misma luminancia, en grises opacos.
    for (let p = 0; p < width * height; p++) {
      const v = Math.round(lum[p] * 255)
      data.data[4 * p] = v
      data.data[4 * p + 1] = v
      data.data[4 * p + 2] = v
      data.data[4 * p + 3] = 255
    }
    g.putImageData(data, 0, 0)
    return {
      width,
      height,
      lum,
      previewUrl: canvas.toDataURL('image/png'),
      fileName: file.name,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () =>
      reject(new Error('No se pudo leer la imagen (formato no soportado).'))
    img.src = url
  })
}

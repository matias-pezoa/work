/**
 * Base personalizada: elige el importador segun la extension del archivo.
 * SVG y DXF se leen sin dependencias; PDF carga pdf.js recien al usarlo.
 */
import type { ImportedShapes } from './importBoundary'
import { importDxfFile } from './importDxf'
import { importSvgFile } from './importSvg'

/** Valor de `accept` del selector de archivos. */
export const BASE_FILE_ACCEPT = '.svg,.dxf,.pdf,image/svg+xml,application/pdf'

export async function importBaseFile(file: File): Promise<ImportedShapes> {
  const ext = file.name.toLowerCase().split('.').pop()
  if (ext === 'dxf') return importDxfFile(file)
  if (ext === 'pdf' || file.type === 'application/pdf') {
    const { importPdfFile } = await import('./importPdf')
    return importPdfFile(file)
  }
  if (ext === 'svg' || file.type === 'image/svg+xml') return importSvgFile(file)
  throw new Error('Formato no soportado: usa un archivo SVG, DXF o PDF.')
}

/**
 * Exportador STL.
 *
 * Toma una BufferGeometry en unidades de Three.js, la convierte a milimetros
 * (modulo de unidades del proyecto) y descarga un .stl binario listo para
 * laminar / imprimir en 3D.
 */
import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { MM_PER_THREE_UNIT } from '../utils/units'

export interface StlExportOptions {
  /** Nombre de archivo sin extension. */
  filename?: string
  /** ASCII en vez de binario (archivos mas grandes, legibles). */
  ascii?: boolean
}

/** Genera el contenido STL (mm) como Blob, sin descargarlo. */
export function geometryToStlBlob(
  geometry: THREE.BufferGeometry,
  options: StlExportOptions = {},
): Blob {
  const mmGeometry = geometry.clone()
  mmGeometry.scale(MM_PER_THREE_UNIT, MM_PER_THREE_UNIT, MM_PER_THREE_UNIT)
  mmGeometry.computeVertexNormals()

  const mesh = new THREE.Mesh(mmGeometry, new THREE.MeshBasicMaterial())
  const exporter = new STLExporter()
  const binary = !options.ascii

  const result = exporter.parse(mesh, { binary })
  mmGeometry.dispose()

  if (binary) {
    // STLExporter (binario) devuelve un DataView; copiamos a un Uint8Array
    // con ArrayBuffer concreto para satisfacer el tipo BlobPart.
    const dv = result as unknown as DataView
    const bytes = new Uint8Array(dv.byteLength)
    bytes.set(new Uint8Array(dv.buffer as ArrayBuffer, dv.byteOffset, dv.byteLength))
    return new Blob([bytes], { type: 'model/stl' })
  }
  return new Blob([result as string], { type: 'model/stl' })
}

/** Convierte y dispara la descarga del .stl en el navegador. */
export function downloadStl(
  geometry: THREE.BufferGeometry,
  options: StlExportOptions = {},
): void {
  const blob = geometryToStlBlob(geometry, options)
  const name = `${options.filename ?? 'pieza-parametrica'}.stl`
  triggerDownload(blob, name)
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * ZIP minimo sin compresion (metodo "store"): para bajar varias probetas en
 * una sola descarga sin sumar dependencias. Los archivos de corte son texto
 * chico, la compresion no vale la pena. Funcion pura.
 */

export interface ZipEntry {
  name: string
  content: string | Uint8Array
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  const enc = new TextEncoder()
  const files = entries.map((e) => {
    const data = typeof e.content === 'string' ? enc.encode(e.content) : e.content
    return { name: enc.encode(e.name), data, crc: crc32(data) }
  })
  const localSize = files.reduce((s, f) => s + 30 + f.name.length + f.data.length, 0)
  const centralSize = files.reduce((s, f) => s + 46 + f.name.length, 0)
  const out = new Uint8Array(localSize + centralSize + 22)
  const view = new DataView(out.buffer)
  let pos = 0
  const u16 = (v: number) => {
    view.setUint16(pos, v, true)
    pos += 2
  }
  const u32 = (v: number) => {
    view.setUint32(pos, v >>> 0, true)
    pos += 4
  }
  const bytes = (b: Uint8Array) => {
    out.set(b, pos)
    pos += b.length
  }
  // fecha DOS fija (1/1/2026 00:00): el contenido no depende del reloj.
  const dosTime = 0
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1
  // bit 11: nombres en UTF-8.
  const flags = 0x0800

  const offsets: number[] = []
  for (const f of files) {
    offsets.push(pos)
    u32(0x04034b50)
    u16(20)
    u16(flags)
    u16(0)
    u16(dosTime)
    u16(dosDate)
    u32(f.crc)
    u32(f.data.length)
    u32(f.data.length)
    u16(f.name.length)
    u16(0)
    bytes(f.name)
    bytes(f.data)
  }
  const centralStart = pos
  files.forEach((f, k) => {
    u32(0x02014b50)
    u16(20)
    u16(20)
    u16(flags)
    u16(0)
    u16(dosTime)
    u16(dosDate)
    u32(f.crc)
    u32(f.data.length)
    u32(f.data.length)
    u16(f.name.length)
    u16(0)
    u16(0)
    u16(0)
    u16(0)
    u32(0)
    u32(offsets[k])
    bytes(f.name)
  })
  u32(0x06054b50)
  u16(0)
  u16(0)
  u16(files.length)
  u16(files.length)
  u32(pos - centralStart)
  u32(centralStart)
  u16(0)
  return out
}

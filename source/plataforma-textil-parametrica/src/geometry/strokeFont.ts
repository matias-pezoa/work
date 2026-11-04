/**
 * Tipografia de trazo simple (una linea, sin relleno) para grabar rotulos
 * como vectores: el formato Illustrator 3 no lleva texto que el software del
 * laser lea de forma fiable, asi que los numeros y valores de las probetas
 * salen como polilineas.
 *
 * Cada glifo vive en una caja de 4 x 6 (y hacia abajo, 6 = linea base);
 * minusculas y acentos se pasan a mayusculas sin tilde. Funcion pura.
 */
import type { TextLabel } from './laserCut'
import type { Vec2 } from './polygon'

const O = '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0'
const P = '0,6 0,0 3,0 4,1 4,2 3,3 0,3'

/** Polilineas separadas por `;`, puntos `x,y` separados por espacio. */
const GLYPHS: Record<string, string> = {
  '0': `${O};4,1 0,5`,
  '1': '1,1 2,0 2,6;1,6 3,6',
  '2': '0,1 1,0 3,0 4,1 4,2 0,6 4,6',
  '3': '0,0 4,0 2,2 3,2 4,3 4,5 3,6 1,6 0,5',
  '4': '3,6 3,0 0,4 4,4',
  '5': '4,0 0,0 0,2 3,2 4,3 4,5 3,6 0,6',
  '6': '3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3 3,2 0,2',
  '7': '0,0 4,0 1,6',
  '8': '1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3 1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3',
  '9': '4,4 1,4 0,3 0,1 1,0 3,0 4,1 4,5 3,6 1,6',
  A: '0,6 0,2 2,0 4,2 4,6;0,4 4,4',
  B: '0,3 0,0 3,0 4,1 4,2 3,3 0,3 0,6 3,6 4,5 4,4 3,3',
  C: '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5',
  D: '0,0 0,6 2,6 4,4 4,2 2,0 0,0',
  E: '4,0 0,0 0,6 4,6;0,3 3,3',
  F: '4,0 0,0 0,6;0,3 3,3',
  G: '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3 2,3',
  H: '0,0 0,6;4,0 4,6;0,3 4,3',
  I: '1,0 3,0;2,0 2,6;1,6 3,6',
  J: '4,0 4,5 3,6 1,6 0,5',
  K: '0,0 0,6;4,0 0,4;1,3 4,6',
  L: '0,0 0,6 4,6',
  M: '0,6 0,0 2,3 4,0 4,6',
  N: '0,6 0,0 4,6 4,0',
  O,
  P,
  Q: `${O};2,4 4,6`,
  R: `${P};2,3 4,6`,
  S: '4,1 3,0 1,0 0,1 0,2 1,3 3,3 4,4 4,5 3,6 1,6 0,5',
  T: '0,0 4,0;2,0 2,6',
  U: '0,0 0,5 1,6 3,6 4,5 4,0',
  V: '0,0 2,6 4,0',
  W: '0,0 1,6 2,3 3,6 4,0',
  X: '0,0 4,6;4,0 0,6',
  Y: '0,0 2,3 4,0;2,3 2,6',
  Z: '0,0 4,0 0,6 4,6',
  '.': '1.6,5.4 2.4,5.4 2.4,6 1.6,6 1.6,5.4',
  ',': '2,5 1.4,7',
  '-': '1,3 3,3',
  '+': '2,1.5 2,4.5;0.5,3 3.5,3',
  '=': '0.5,2 3.5,2;0.5,4 3.5,4',
  '/': '0,6 4,0',
  ':': '1.6,1.4 2.4,1.4 2.4,2 1.6,2 1.6,1.4;1.6,4.4 2.4,4.4 2.4,5 1.6,5 1.6,4.4',
  '#': '1,1 1,5;3,1 3,5;0,2 4,2;0,4 4,4',
  '%': '0,6 4,0;0,0 1,0 1,1 0,1 0,0;3,5 4,5 4,6 3,6 3,5',
  '°': '1,0 2.5,0 2.5,1.5 1,1.5 1,0',
  '(': '2.5,0 1.5,1 1.5,5 2.5,6',
  ')': '1.5,0 2.5,1 2.5,5 1.5,6',
  '·': '1.6,2.7 2.4,2.7 2.4,3.3 1.6,3.3 1.6,2.7',
  '×': '0.5,1.5 3.5,4.5;3.5,1.5 0.5,4.5',
}

const PARSED = new Map<string, Vec2[][]>(
  Object.entries(GLYPHS).map(([ch, src]) => [
    ch,
    src.split(';').map((poly) =>
      poly.split(' ').map((pt): Vec2 => {
        const [x, y] = pt.split(',').map(Number)
        return [x, y]
      }),
    ),
  ]),
)

/** Avance horizontal por caracter, en unidades del glifo. */
const ADVANCE = 5.6
/** Alto de mayuscula respecto del tamano de fuente (como una sans: ~0.72 em). */
const CAP_RATIO = 0.72

function normalize(text: string): string {
  // NFD separa la tilde de la letra; se descartan las marcas combinantes (U+0300..U+036F).
  return text.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
}

/** Ancho del texto en mm, a `sizeMm` de tamano de fuente. */
export function strokeTextWidth(text: string, sizeMm: number): number {
  const n = normalize(text).length
  const unit = (sizeMm * CAP_RATIO) / 6
  return n > 0 ? (n * ADVANCE - (ADVANCE - 4)) * unit : 0
}

/**
 * Rotulo -> polilineas en mm. `z` es la linea base (como `<text>` en SVG);
 * `anchor` alinea respecto de `x`. Caracteres sin glifo dejan su espacio.
 */
export function textToStrokes(label: TextLabel): Vec2[][] {
  const text = normalize(label.text)
  const unit = (label.sizeMm * CAP_RATIO) / 6
  const w = strokeTextWidth(label.text, label.sizeMm)
  const x0 =
    label.anchor === 'start'
      ? label.x
      : label.anchor === 'end'
        ? label.x - w
        : label.x - w / 2
  const top = label.z - 6 * unit
  const out: Vec2[][] = []
  ;[...text].forEach((ch, k) => {
    const glyph = PARSED.get(ch)
    if (!glyph) return
    const gx = x0 + k * ADVANCE * unit
    for (const poly of glyph) {
      out.push(poly.map(([x, y]): Vec2 => [gx + x * unit, top + y * unit]))
    }
  })
  return out
}

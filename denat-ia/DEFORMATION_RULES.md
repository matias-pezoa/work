# Facial Deformation System

Sistema de deformación facial en tiempo real basado en color RGB. Lo implementa
`files/main.js` (sección 02c — LICUAR ROSTRO): `EMOCIONES`, `clasificarEmocion`,
`warpVertice`, `aplicarLicuar`. Se activa con el toggle "Licuar rostro" del dock.

## Flujo

`RGB sensor → HSV → emoción → reglas de deformación → rostro`

- `Hue` → emoción.
- `Saturation` → intensidad de deformación.
- `Brightness` → radio / escala de deformación.

Dos sliders en el dock:

- **Magnitud** (1–5). El último nivel es desproporcionado a propósito (deformación
  muy exagerada). Ganancias: `[0.4, 0.75, 1.3, 2.4, 4.6]`.
- **Transición** (120–1800 ms). Tiempo del crossfade entre emociones; cada emoción
  lo modula con su `velMul` (tristeza y calma más lentas, ira/sorpresa/euforia
  más rápidas).

## Emociones

| Emoción | Color | Regla morfológica | Zonas principales |
|---|---|---|---|
| Alegría | Amarillo | Expandir | boca, mejillas, ojos |
| Tristeza | Azul | Caer / derretir | ojos, boca, mandíbula |
| Ira | Rojo | Comprimir | cejas, nariz, boca |
| Miedo | Violeta | Estirar radialmente | ojos, boca, frente |
| Asco | Verde | Torcer lateralmente | nariz, labios, mejillas |
| Sorpresa | Cyan | Abrir radialmente | ojos, boca, cejas |
| Calma | Blanco / baja saturación | Disolver hacia el centro | rostro completo |
| Euforia | Magenta | Explotar / deformación caótica | rostro completo |

## Reglas

### Alegría — EXPAND
- Expandir hacia arriba y afuera.
- Agrandar mejillas y ojos.
- Elevar comisuras.
- Simetría alta.
- Movimiento pulsante.

### Tristeza — FALL
- Desplazar rasgos hacia abajo.
- Elongar mandíbula y mejillas.
- Reducir ancho facial.
- Movimiento lento y viscoso.

### Ira — COMPRESS
- Comprimir hacia el centro.
- Cejas hacia abajo y adentro.
- Boca estirada horizontalmente.
- Mandíbula ensanchada.
- Movimiento rápido y espasmódico.

### Miedo — STRETCH
- Agrandar ojos.
- Estirar boca verticalmente.
- Elevar frente.
- Bajar mandíbula.
- Aplicar temblor de alta frecuencia.

### Asco — TWIST
- Máxima asimetría.
- Torcer nariz y boca lateralmente.
- Comprimir una mejilla y expandir la otra.
- Contracciones irregulares.

### Sorpresa — OPEN
- Apertura radial.
- Agrandar ojos.
- Boca circular y expandida.
- Cejas hacia arriba.
- Ataque rápido y decaimiento lento.

### Calma — DISSOLVE
- Reducir progresivamente los rasgos.
- Llevar ojos, boca y nariz hacia el centro.
- Suavizar el rostro.
- Movimiento muy lento.

### Euforia — EXPLODE
- Expandir y contraer simultáneamente.
- Desplazamientos multidireccionales.
- Alta frecuencia.
- Alta irregularidad.
- Mantener el rostro reconocible cerca del límite de pérdida de identidad
  (tope de desplazamiento por vértice).

## Mapeo RGB

```js
const { h, s, v } = rgbAHsv(r, g, b);
emotion = clasificarEmocion(hex);        // por rango de hue; s < 0.18 -> calma
warpIntensity = 0.35 + 0.65 * s;         // saturación -> intensidad
warpRadius    = 0.65 + 0.85 * v;         // brillo -> radio / escala
```

Clasificación por hue (grados):

```txt
0–18, 340–360  → ira        (rojo)
18–70          → alegría    (amarillo)
70–158         → asco       (verde)
158–200        → sorpresa   (cyan)
200–260        → tristeza   (azul)
260–300        → miedo      (violeta)
300–340        → euforia    (magenta)
s < 0.18       → calma      (baja saturación / casi blanco)
```

## Condiciones

- Cada emoción tiene una deformación formalmente distinta (`warp` propio), no el
  mismo efecto con otra intensidad.
- Las deformaciones deben ser dramáticas y claramente perceptibles (slider de
  magnitud).
- Interpolación entre estados (crossfade `emoAnterior → emoActual`), 120–1800 ms.
- La deformación se calcula siempre desde la geometría facial original: la grilla
  fuente es uniforme y `dst = src + desplazamiento` recalculado cada frame — no
  hay acumulación.
- Tope de desplazamiento por vértice (`maxDisp`) para no perder la identidad ni
  generar basura.
- Los landmarks se re-piden cada frame para que la deformación siga el rostro.

## Principio visual

```txt
JOY       → EXPAND
SADNESS   → FALL
ANGER     → COMPRESS
FEAR      → STRETCH
DISGUST   → TWIST
SURPRISE  → OPEN
CALM      → DISSOLVE
EUPHORIA  → EXPLODE
```

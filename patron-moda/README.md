# Cuerpo Base — patrón de moda paramétrico

Primer módulo de un sistema paramétrico de patrones de moda: a partir de un
set de medidas genera el patrón de cuerpo base (delantero + espalda) y lo
exporta a `.dxf`. HTML/CSS/JS con módulos ES nativos, sin build step.

Método de trazado de referencia: [thecopycat.blog — Cómo hacer un patrón de
cuerpo base](https://thecopycat.blog/2021/03/01/como-hacer-un-patron-de-cuerpo-base/).

## Uso

Los `import` de ES modules no cargan sobre `file://`: hay que servir la
carpeta por HTTP. Con Live Server (VS Code), o con Node:

```bash
npx serve patron-moda
```

- Panel derecho: medidas del cuerpo, menú "Pinzas" (busto, talle delantera y
  talle espalda: todos los modificadores de pinza) y "tabla de patronaje" (ajuste fino,
  colapsada). El patrón se redibuja en vivo; las medidas quedan guardadas en
  `localStorage`.
- "Pieza completa" espeja la mitad trazada sobre el doblez (útil para cortar).
- Menú desplegable "Exportar" (mitad o pieza completa, según el toggle):
  - **PDF** — vectorial, una sola página del tamaño de la lámina a escala 1:1,
    con título, medidas usadas, leyenda y un cuadrado de control de 10 cm.
    Usa jsPDF (cdnjs), que se carga solo al exportar.
  - **PNG** — la misma lámina rasterizada a 40 px/cm (~102 dpi), con la
    resolución escrita en el archivo (chunk `pHYs`) para imprimir a 1:1.
  - **DXF** — `patron-cuerpo-base.dxf`. Capas: `CORTE`, `PINZAS`, `GUIAS`
    (doblez y línea de cintura), `ETIQUETAS`. 1 unidad = 1 cm.
  En los tres formatos las piezas quedan alineadas por la línea de cintura.

## Estructura

- `measurements.js` — catálogo de medidas (clave, etiqueta, rango, defecto).
- `bodice.js` — motor geométrico: medidas -> puntos/curvas de delantero y espalda.
- `render.js` — SVG de las piezas, regla en cm y `fitScale` (escala de pantalla
  que hace que el molde llene la mesa; se recalcula al cambiar el tamaño).
- `dxf.js` — exportador DXF (AC1015).
- `sheet.js` — lámina de impresión 1:1 y su salida a SVG (para el PNG) y PDF.
- `script.js`, `index.html`, `style.css` — interfaz.

## Del artículo al código

El artículo describe el trazado "a mano" (curva suave, curva más pronunciada)
sin coordenadas exactas ni imágenes anotadas. Qué es literal y qué se asumió:

- **Literal:** rectángulo base (busto/4 × largo de talle), caja de sisa
  (ancho de pecho/2 o de espalda/2), cuello `cuello/6 + 0,5` de ancho y
  `cuello/6 + 2` (delantero) / `2 cm` (espalda) de bajada, bajada de hombro 4 cm,
  ápice de busto a `separación/2` y a la altura de busto, pinza lateral de busto
  a `profundidad/2` sobre y bajo esa altura, con profundidad = talle delantero −
  talle espalda (sin pinza si el delantero no es más largo). El menú "Pinzas"
  permite fijar la pinza de busto a mano cuando los talles son iguales por otra causa
  (p. ej. espalda curva) aunque haya busto. Despegue de pinzas 2–3 cm del ápice.
- **Escote:** curva cóncava (scoop), tangente vertical en el hombro y
  horizontal en el centro; el punto de control no es la esquina del trazo.
- **Pinza de talle:** diamante cerrado, ancho máximo sobre la cintura (2 cm en
  el delantero: 1 cm a cada lado de la vertical del busto). Delantero: punta
  superior apuntando al ápice y despegada `dartRelease` (2,5 cm); punta inferior
  9–10 cm hacia la cadera. Espalda: 11–12 cm hacia la cadera. El ancho del panel
  en la cintura es `cintura/4 + ancho de pinza`, de modo que cosida la pinza
  quede `cintura/4`.
- **Pinza de espalda:** centrada en la cintura del panel (entre centro espalda y
  costado), 3 cm de ancho por defecto; el panel mide `cintura/4 + ancho de
  pinza` en la cintura. Ancho y desplazamiento lateral se ajustan en el menú
  "Pinzas". Ambas pinzas de talle (delantero y espalda) se mantienen
  a 2 cm del doblez y del costado en toda su altura: si el desplazamiento o las
  medidas las acercarían más, el eje se corre hasta ese límite. Su largo hacia la escápula (12 cm) es un supuesto ajustable.
- **Curvas** (escote, sisa, cadera): Bézier con controles elegidos para pasar
  cerca de las esquinas de construcción; son una interpretación, no un trazado
  idéntico al del artículo. Se ajustan en `bodice.js`.
- **Sisa:** dos tramos. El fondo sale del bajo sisa perpendicular a la costura
  de costado y sube hasta tocar la vertical del ancho de pecho/espalda; la
  subida llega al hombro perpendicular a la línea de hombro. Como delantero y
  espalda salen perpendiculares a su propio costado, al coser los costados la
  sisa queda continua (forma de gota), sin pico en el bajo sisa.
- **Tramo cintura -> cadera:** una sola curva de costado; las líneas de la pinza
  no se proyectan hasta la línea de cadera como curvas separadas. Ancho de cadera
  `cadera/4` para delantero y espalda por igual. Cuánto se abomba esa curva se
  ajusta en "Forma → Curva de cadera" (0% = recta, 100% = máxima; 35% por
  defecto, ~0,4 cm de separación de la recta con las medidas por defecto).

## Estado de verificación

- Geometría revisada visualmente (modo mitad y pieza completa) y por la
  estructura del DXF generado (secciones balanceadas, sin `NaN`).
- El DXF no se ha abierto en un CAD real: antes de cortar, ábrelo en el programa
  que uses para confirmar escala y capas.
- Los valores por defecto son una talla de referencia (aprox. M), no una
  medición verificada. El patrón no se ha validado contra un cuerpo real.
- Costados balanceados: el bajo sisa delantero no es una medida de entrada; se
  calcula para que el costado delantero, con la pinza de busto cerrada, mida lo
  mismo que el de la espalda (al cambiar la profundidad de la pinza, el bajo
  sisa delantero sube o baja). Si las medidas lo impiden (busto muy alto, talle
  delantero muy corto), la leyenda bajo el trazado lo indica.

# Proyecto: Plataforma de Modelado Parametrico Textil (impresion 3D + corte laser)

## Vision
Herramienta web para diseno de moda experimental. Tres modos, dos fabricaciones:

1. **Volumen (3D):** TODO emerge de un plano 2D (la base de tela). Sobre ese plano
   se siembran "puas": piezas solidas (cono truncado) que crecen desde el plano;
   altura, radios, inclinacion y densidad salen de un mapa de atractores. Se
   exporta un unico STL para imprimir en 3D sobre la tela. NO hay edicion de
   curvas 3D a mano: la forma es 100% parametrica, y esta constrenida por
   construccion a lo que FDM puede imprimir sin soporte (ver mas abajo).
2. **Ondas (3D):** un panel solido con relieve corrugado — costillas radiales
   generadas por funciones trigonometricas (`sin`) alrededor de cada atractor,
   facetadas (malla de baja resolucion + sombreado plano) en vez de una onda
   suavizada. Misma logica de plano-fijo y de recorte de amplitud por
   factibilidad que Volumen, pero geometria y modulo separados. Export STL.
3. **Corte laser (2D):** se trabaja SOLO desde el vector. Cortes parametricos con
   distintas familias de geometria (huella de las puas, retícula auxetica,
   escamas), export SVG/DXF con compensacion de kerf. (En preparacion.)

Ademas (roadmap): extraer datos de imagenes de referencia (contornos, luminancia
como campo de atraccion) y libreria de materiales para el kerf.

Referencia estetica: Iris van Herpen — piezas rigidas que se despliegan desde
una base de malla/tul siguiendo la anatomia, densidad variable. Los modos 3D la
reinterpretan con geometria simple y estructuralmente solida (no una pared
delgada arqueada) para que sea realmente imprimible.

## Factibilidad de impresion (modos 3D) — restriccion de diseno, no detalle de implementacion
El primer intento (Fase "pluma": perfil 2D hueco barrido por una curva que se
arqueaba hasta ~150°) era visualmente interesante pero NO imprimible: vuelo
extremo sin soporte, punta mas fina que una linea de extrusion, base sin area
de contacto para adherirse a la tela. Se reemplazo por una "pua" solida (cono
truncado, ver `geometry/spike.ts`) que es imprimible **por construccion**:
- Vuelo por capa siempre <= `SAFE_OVERHANG_DEG` (45°, el limite generico de
  vuelo autosoportado en FDM). La pua es una linea recta de base a punta con
  angulo CONSTANTE, asi que ningun corte individual vuela mas que el anterior.
- **Estabilidad de la base (segundo limite, independiente del vuelo):** una pua
  alta y angosta puede tener CADA corte dentro del vuelo autosoportado y aun
  asi despegarse de la cama/tela, porque el peso/las fuerzas de impresion hacen
  palanca sobre el punto de apoyo. Por eso la inclinacion tambien se recorta a
  que la punta nunca proyecte, en horizontal, mas de `BASE_STABILITY_FACTOR`
  (=1) veces el radio de la propia base — `atan2(rootRadius, height)`. Esto se
  detecto con impresiones reales (las bases se despegaban) y quedo documentado
  en el codigo para que no se "arregle" subiendo el vuelo de nuevo.
- Radio de punta y de base con piso en mm (`MIN_TIP_RADIUS_MM`,
  `MIN_ROOT_RADIUS_MM`) para que la punta no colapse y la base tenga area de
  adherencia real sobre la tela.
- Las puas nunca se solapan entre si (rechazo por colision en el sampler).
No relajar estos limites sin discutirlo — son la razon de ser de este modulo.

El modo Ondas aplica el mismo principio con su propia geometria (`geometry/waveField.ts`,
`SAFE_OVERHANG_DEG` compartido desde `geometry/printability.ts`): la amplitud de
las costillas se recorta automaticamente para que la pendiente de la onda
(`amplitud * 2*pi/longitudDeOnda` para una senoidal) no supere el vuelo
autosoportado, y la base del panel es siempre plana y de espesor minimo.

## Stack tecnico (decision tomada, no reevaluar sin discutirlo)
- React + Vite + TypeScript estricto
- Three.js via React Three Fiber (@react-three/fiber) + @react-three/drei
- zustand para estado global
- three-mesh-bvh para queries espaciales (se usara al importar mallas reales)
- vitest para tests de los modulos puros de geometry/
- oxlint (viene con la plantilla de Vite) + prettier

### Dependencias previstas por el roadmap, aun NO instaladas
Se agregan en la fase que las necesita, no antes:
- manifold-3d (WASM) -> booleans 3D robustos (si se necesitan mas adelante)
- Paper.js + Clipper2 (WASM) -> paths 2D y offset de kerf (modo Corte laser)
- Maker.js -> generacion de paths de corte / utilidades de kerf (evaluar despues)
- OpenCV.js -> bordes, contornos, luminancia (imagen -> vector/campo)

## Convenciones de codigo
- TypeScript estricto (`strict: true`). No usar `any` sin justificacion en comentario.
- `verbatimModuleSyntax` esta activo: importar tipos con `import type`.
- Unidades: internamente en milimetros (mm) para todo lo fabricable. El viewport
  usa unidades de Three.js; la conversion pasa SIEMPRE por `src/utils/units.ts`
  (definicion actual: 1 unidad Three = 1 cm = 10 mm).
- Cada modulo de geometria (spike, spikeField, waveField, attractionField) es
  una funcion pura, testeable sin React. La logica de geometria no se mezcla
  con UI/render.
- Todo parametro de UI tiene descriptor `NumberParam` (nombre, min/max, step,
  default, unidad) en `src/utils/params.ts` o junto a su modulo.
- Preferir composicion de funciones puras sobre clases.
- La geometria (BufferGeometry) se calcula en `App.tsx` con `useMemo` y se libera
  con `useDisposePrevious`; los componentes de escena solo renderizan.

## Estructura de carpetas
```
src/
  geometry/       # funciones puras (+ __tests__/):
                  #   printability    constantes de factibilidad compartidas (SAFE_OVERHANG_DEG)
                  #   polygon         point-in-polygon, bounds, area, fit/rescale (base personalizada)
                  #   spike           una pua: cono truncado autosoportado
                  #   spikeField      plano/contorno + atractores -> campo de puas sin solape
                  #   waveField       plano/contorno + atractores -> panel corrugado facetado
                  #   attractionField atractores + sampleField
  components/     # SpikeFieldScene/Panel, WaveFieldScene/Panel,
                  #   AttractorGizmos (viewport), AttractorEditor (panel) y
                  #   BaseShapeImporter/BaseShapeGround (base personalizada)
                  #   compartidos entre ambos modos 3D, ParamSlider
  scene/          # Viewport (canvas R3F, luces, grid, OrbitControls)
  io/             # exportSTL, importSvg (SVG -> contorno)
  state/          # store de zustand
  utils/          # units, params, random
```

## Como correr
- `npm install`
- `npm run dev` -> http://localhost:5173
- `npm test` -> tests de geometry/
- `npm run build` -> genera el sitio en `../../plataforma-parametrica/` (raiz del
  repo). Esa carpeta es lo que sirve GitHub Pages: commitearla a `main` + push.
  URL: https://<usuario>.github.io/work/plataforma-parametrica/

## Estado del proyecto

- Modo Volumen: COMPLETO (campo de puas solidas desde el plano, dirigido por
  atractores, imprimible por construccion).
- Modo Ondas: COMPLETO (panel corrugado facetado desde el plano, dirigido por
  atractores, imprimible por construccion).
- Modo Corte laser: PENDIENTE (solo un placeholder en la UI).

### Setup — COMPLETO
- Vite React-TS, estructura de carpetas, tsconfig estricto, prettier, vitest.
- `utils/units.ts` (Three<->mm, 1u=1cm), `utils/params.ts`, `utils/random.ts`.
- `scene/Viewport.tsx`: canvas R3F con luces, grid infinito, OrbitControls.

### Modo Volumen — COMPLETO (2a iteracion: puas solidas, no plumas huecas)
La 1a iteracion (pluma: perfil 2D barrido por una curva arqueada, ver seccion
de factibilidad arriba) se descarto por no ser imprimible. Reemplazada por:

- `geometry/spike.ts`: `buildSpike(base, leanDir, params)` -> `Spike` (base,
  punta, eje, radios YA con piso aplicado, `footprintRadius`, `leanDegApplied`
  YA recortado al MENOR de dos techos — vuelo (`maxOverhangDeg`, tope absoluto
  `SAFE_OVERHANG_DEG`) y estabilidad (`atan2(rootRadius*BASE_STABILITY_FACTOR,
  height)`) — y `limitedByStability` indicando cual gano). `spikeGeometry`
  arma un tronco de cono OBLICUO (no un cono recto rotado): el anillo de la
  base y el de la punta son ambos HORIZONTALES, solo el centro de la punta se
  desplaza — la base nunca se inclina ni se despega del plano en la malla.
  `segments` bajo (3-6) da piramides/prismas; alto da un cono liso.
- `geometry/attractionField.ts`: sin cambios — `Attractor`, `sampleField`.
- `geometry/spikeField.ts`: `buildSpikeField(attractors, params)` — siembra
  puntos en el plano por densidad del campo (grilla + jitter, como antes);
  cada pua toma altura/radios/inclinacion del campo, se inclina ALEJANDOSE del
  atractor, y se **rechaza si su huella se solapa con una ya colocada**
  (`rejectedByOverlap`). Cuenta ademas cuantas quedaron `limitedByStability`
  (`limitedByStabilityCount`). Fusiona todas las puas en una sola malla
  (`geometry`), lista para exportar sin pasos adicionales. Determinista por
  seed, tope `maxCount`.
- UI: `SpikeFieldScene` (base de tela + malla solida + gizmos de atractores;
  **NO hay clic-para-agregar en el plano** — ver nota de interaccion abajo,
  arrastre del gizmo mueve el seleccionado) y `SpikeFieldPanel` (seccion
  "Factibilidad de impresion" explicando AMBOS limites, base y distribucion,
  forma de la pua, boton "+ Agregar atractor", lista de atractores, export
  STL + stats: descartadas por solape y limitadas por estabilidad de base).
- Tests: `spike.test.ts` (angulo constante en toda la longitud, pisos de radio,
  techo `SAFE_OVERHANG_DEG` defensivo, malla solida sin NaN, pua alta/angosta
  se inclina menos que una baja/ancha, deriva horizontal nunca supera
  `rootRadius * BASE_STABILITY_FACTOR`, **anillo de la base siempre horizontal
  y centrado en `spike.base` aunque la pua se incline**), `spikeField.test.ts`
  (determinismo, densidad vs atractor, maxCount, CERO solapes entre pares,
  pisos de fabricacion respetados, `limitedByStabilityCount` coincide con los
  placements marcados), `attractionField.test.ts`. 24 casos.

### Modo Ondas — COMPLETO
Panel solido con costillas trigonometricas. Comparte con Volumen el concepto de
"todo emerge de un plano fijo" y la logica de recorte por factibilidad, pero es
un modulo de geometria totalmente distinto (heightfield extruido, no piezas
discretas).

- `geometry/waveField.ts`: `buildWaveField(attractors, params)` — cada atractor
  emite una ondulacion RADIAL (`0.5+0.5*sin(2*pi*distancia/longitudDeOnda)`),
  con la misma envolvente `falloff()` de attractionField.ts; varios atractores
  se combinan con el mismo `combine` (max/sum) que Volumen. El panel es un
  SOLIDO extruido: base plana en y=0 (espesor minimo, piso
  `MIN_BASE_THICKNESS_MM`), superficie superior ondulada, paredes laterales que
  cierran el volumen. La malla se genera con resolucion BAJA respecto de la
  longitud de onda (`facetsPerWave`, bajo = costillas angulosas) — no hay
  triangulacion manual propensa a errores de winding: cada triangulo se orienta
  comparando su normal contra una direccion "mas o menos hacia afuera" para esa
  cara (`pushOutwardTri`).
  Amplitud recortada automaticamente: la pendiente maxima de una senoidal
  `A*sin(2*pi*d/L)` es `A*(2*pi/L)`, asi que se limita `A` para que esa
  pendiente no supere `maxOverhangDeg` (mismo principio y misma
  `SAFE_OVERHANG_DEG`, ahora en `geometry/printability.ts`, que Volumen).
  `amplitudeLimited` indica si se recorto.
- UI: `WaveFieldScene` + `WaveFieldPanel`, usando los mismos `AttractorGizmos`/
  `AttractorEditor` compartidos que Volumen pero con su PROPIO set de
  atractores (`waveAttractors` en el store, independiente de `attractors`).
- Render: material con `flatShading` (facetas, no onda suavizada) + `<Edges>`
  de drei dibujando las aristas de cada faceta — sin esto ultimo las costillas
  casi no se distinguen a la distancia de camara por defecto. El mesh de este
  modo NO usa `castShadow`: una superficie continua corrugada auto-sombreandose
  genera "shadow acne" (ruido periodico falso) con el mapa de sombras
  compartido del Viewport — se verifico numericamente (sampleando alturas de
  la malla) que la geometria era correcta antes de identificar que el ruido
  visual era de sombreado, no de la malla.
- Tests: `waveField.test.ts` — base siempre plana en y=0, panel liso sin
  atractores, aparecen crestas con atractor, amplitud se recorta sin superar
  el techo (y nunca al reves), techo absoluto respetado, sum >= max en
  solapes, limites de segmentos por eje, malla valida, determinismo. 10 casos.

### Base personalizada (importar SVG) — COMPLETO
Compartida entre Volumen y Ondas: reemplaza el panel cuadrado por un contorno
importado (p. ej. una pieza de patron con pinzas), sin tocar la logica de
atractores/campo de ninguno de los dos modos.

- `geometry/polygon.ts`: `pointInPolygon`/`pointInBoundary` (ray casting, borde
  externo menos agujeros), `polygonBounds`, `polygonArea`, `fitBoundaryToWidth`
  (centra y escala TODOS los contornos con el mismo factor, a partir del ancho
  real en mm que fija el usuario) y `rescaleBoundary` (para cuando el usuario
  cambia ese ancho despues de importar).
- `io/importSvg.ts`: `parseSvgToBoundary(svgText)` / `importSvgFile(file)`. NO
  implementa matematica de curvas Bezier/arcos: monta el SVG oculto en el DOM y
  usa las APIs nativas `getTotalLength()`/`getPointAtLength()` (soportan
  `path`, `polygon`, `polyline`, `rect`, `circle`, `ellipse` con cualquier
  curva) + `getCTM()` para resolver `<g transform>` anidados. El contorno de
  mayor area es el borde externo; los demas (si caen dentro de su caja) son
  agujeros. **Estas APIs no existen en jsdom/Node** — no son testeables con
  vitest; se verificaron una vez a mano con Playwright apuntando al Chrome
  instalado (`playwright-core` como devDependency temporal, desinstalada
  despues — no forma parte del toolchain del proyecto). Si se vuelve a tocar
  este archivo, repetir esa verificacion manual en un navegador real.
- `state/store.ts`: `baseShape: BaseShapeState | null` (outer/holes en mm, YA
  centrados/escalados, compartido — no hay uno por modo) + `setBaseShape`
  (recibe el `ImportedBoundary` crudo y lo ajusta con `fitBoundaryToWidth`),
  `setBaseShapeWidthMm` (reescala en caliente via `rescaleBoundary`),
  `clearBaseShape` (vuelve al panel cuadrado).
- `geometry/spikeField.ts` y `geometry/waveField.ts` reciben un 3er argumento
  opcional `boundary?: Boundary | null`:
  - Volumen: el dominio de muestreo pasa de la caja `[-planeSize/2,planeSize/2]`
    al bounding box del contorno, y cada candidato se filtra con
    `pointInBoundary` antes de gastar RNG en densidad/campo.
  - Ondas: `buildSolidHeightfield` ya NO asume un rectangulo — enmascara CADA
    CELDA de la grilla por su centro (`domain.test`) y, para cada celda
    rellena, agrega una pared en cualquier arista cuyo vecino no este relleno
    (fuera de grilla o fuera del contorno), calculando la direccion "hacia
    afuera" de esa pared como el vector centro-celda -> punto medio de la
    arista (no hace falta triangular el poligono exacto). El contorno queda
    "a escalones" del tamano de la grilla — aceptable dado el estilo ya
    faceteado del modo. Ojo: `geometry.computeBoundingBox()` de Three cuenta
    TODOS los vertices del buffer, incluidos los de celdas fuera del contorno
    (huerfanos, sin triangulo); las `bounds` que se reportan al usuario se
    calculan aparte iterando el INDICE (`computeIndexedBounds`), no
    `geometry.boundingBox`, o las "Dimensiones" mostradas quedarian infladas.
- UI: `BaseShapeImporter` (input file oculto tras un boton, ancho real en mm,
  stats, "Quitar base") en ambos paneles; `BaseShapeGround` (viewport) dibuja
  el plano cuadrado de siempre o, si hay `baseShape`, un `THREE.Shape` (con
  `.holes`) con la MISMA orientacion/escala que usan spikeField/waveField —
  ver la nota de signo en el propio archivo (rotar un `Shape` con
  `rotation=[-PI/2,0,0]` manda su Y local a -Z en mundo; se compensa
  invirtiendo Z al construir el `Shape` para que coincida exacto con el
  dominio de muestreo).
- Tests: `polygon.test.ts` (point-in-polygon con/sin agujeros, bounds, area,
  fit/rescale). `spikeField.test.ts`/`waveField.test.ts` ganaron un bloque
  "con un contorno personalizado" (puas no salen del contorno, menos
  triangulos/puas que el cuadrado completo, agujero reduce aun mas, contorno
  no cuadrado da segmentsU != segmentsV, base sigue plana). 53 casos totales.

### Interaccion: por que no hay "clic en el plano para agregar atractor"
Se probo y se saco: al arrastrar el gizmo de `TransformControls` (drei) para
mover un atractor, el gizmo NO es un objeto de React Three Fiber con su propio
`onPointerDown` — R3F no encuentra un handler en el, sigue el rayo y dispara el
`onPointerDown` del plano que esta detras, sumando un atractor nuevo en cada
intento de arrastre. La solucion no es un `stopPropagation` (no hay donde
ponerlo) sino eliminar el gesto: agregar atractores es SOLO el boton
"+ Agregar atractor" del panel (posicion aleatoria dentro del panel; se ajusta
despues arrastrando el gizmo). Si se reintroduce alguna vez un gesto de clic
en el viewport, verificar primero que no reaparezca este problema.

### Pendiente / notas para retomar
- **Modo Corte laser** (siguiente): 2D puro. Familias parametricas — empezar por
  la huella vectorial del campo de puas (circulo de base + circulo de punta
  proyectados, para que el corte calce con la pieza 3D si se pega por separado),
  luego reticula auxetica y escamas. Render en canvas/SVG aparte del viewport
  3D. Export SVG (grupos por capa) y DXF. Kerf con Clipper2 mas adelante.
- `SAFE_OVERHANG_DEG = 45` y `BASE_STABILITY_FACTOR = 1` son valores genericos
  razonables, no medidos contra una impresora/material especifico. Si el
  usuario calibra con pruebas reales, exponerlos como configuracion en vez de
  constantes — hoy son deliberadamente no editables mas alla del slider
  `maxOverhangDeg` (que nunca puede superar `SAFE_OVERHANG_DEG`).
- Con los defaults actuales, casi todas las puas altas/densas quedan
  `limitedByStability` (es lo esperado: mas alto + base minima = menos
  inclinacion posible). Si se quiere mas inclinacion visible por defecto, subir
  `rootRadiusBaseMm`/`rootRadiusFieldMm` o bajar `heightBase`/`heightField` en
  `DEFAULT_SPIKE_FIELD` — no aflojar `BASE_STABILITY_FACTOR`.
- Los `default` de algunos `NumberParam` no coinciden 1:1 con
  `DEFAULT_SPIKE_FIELD` (la fuente de verdad es la constante; el descriptor solo
  alimenta tooltips). Alinear si se agrega "reset por slider".
- Variedad de formas futura: `segments` ya permite piramide/prisma/cono desde el
  mismo codigo; si se quiere una familia distinta (domo, etc.) evaluar si vale
  la pena antes de agregar mas parametros.
- Los defaults de `DEFAULT_WAVE_FIELD` (planeSize 24, longitud de onda 70mm,
  amplitud pedida 22mm, facetsPerWave 3) se ajustaron a ojo para que las
  costillas se noten con la camara por defecto del Viewport — si se cambia el
  panel o la camara, revisar que las crestas sigan siendo legibles (usar
  `<Edges>` ayuda mucho mas que subir amplitud).
- `AttractorGizmos`/`AttractorEditor` son compartidos entre Volumen y Ondas;
  si se agrega un tercer modo con atractores (p. ej. algo en Corte laser),
  reusarlos en vez de duplicar.
- Base personalizada: el contorno en Ondas queda "a escalones" (resolucion de
  grilla, no el poligono exacto) — es aceptable ahora porque el modo ya es
  faceteado a proposito, pero si algun dia se quiere un borde liso hace falta
  una triangulacion real del poligono (ear clipping o similar), no solo
  enmascarar celdas. En Volumen no aplica (las puas son piezas discretas).
- Base personalizada: solo SVG (no DXF). Si se necesita DXF, lo mas simple es
  pedirle al usuario que lo convierta a SVG primero (Illustrator/Inkscape/
  LibreCAD lo hacen), no agregar un parser de DXF aca.
- Deploy: `npm run build` -> `../../plataforma-parametrica/`; commit + push a `main`.

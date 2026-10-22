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
   escamas, calado por campo), export SVG/DXF con compensacion de kerf.

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
- Modo Corte laser: COMPLETO (cortes y calados 2D dirigidos por atractores,
  fabricables por construccion: puente minimo, margen, kerf).

### Modo Corte laser — COMPLETO
2D puro, en mm, plano XZ con el mismo origen que la base de los modos 3D.

- `geometry/laserCut.ts`: `buildLaserCut(attractors, params, input)` ->
  `LaserCutResult` (`paths` por capa `calado`/`corte`/`contorno`, ya
  compensados por kerf y ordenados con el contorno AL FINAL, + stats).
  Familias: `perforation` (grilla hexagonal, poligono de n lados alargado y
  orientado por el campo), `kirigami` (cuadrados rotantes: cortes alternados
  H/V en grilla cuadrada, el campo achica la bisagra), `scales` (arcos
  abiertos en filas alternadas, punta lejos del atractor), `footprint` (un
  calado en la base de cada pua de `buildSpikeField`; sin base importada usa
  el panel cuadrado de Volumen).
  Restricciones por construccion (no aflojarlas sin discutirlo):
  - Puente: el tamano maximo se deriva de la grilla — `rMax = (paso - puente)/2`
    en la hexagonal (los 6 vecinos a `paso`), bisagra >= `puente + kerf/2` en
    kirigami, `(vecino - puente - kerf)/2` en escamas. Huella: chequeo por pares.
  - Margen: `fits()` exige cada vertice dentro del contorno y a >= margen de
    cualquier borde (externo o agujero). `margen >= puente + kerf/2`.
  - `MIN_FEATURE_MM`, `MIN_BRIDGE_MM`, `MAX_ELEMENTS` (tope anti-congelamiento).
  - Kerf: calados `offsetPolygon(-kerf/2)`, contorno `+kerf/2`, cortes
    abiertos acortados kerf/2 por extremo. `openAreaMm2` es el area DISENADA.
- `geometry/polygon.ts` gano `offsetPolygon` (inglete, offsets chicos — no
  resuelve colapsos ni auto-intersecciones; para eso Clipper2),
  `distanceToSegment`, `distanceToBoundaryEdges`, `polylineLength`,
  `rectBoundary`.
- `io/exportLaser.ts`: `laserToSvg` (mm, `<g>` por capa, azul/verde/rojo) y
  `laserToDxf` (R12 AC1009, POLYLINE+VERTEX, capas CALADO/CORTE/CONTORNO,
  `$INSUNITS`=mm, Z invertida porque DXF tiene Y hacia arriba). Verificado una
  vez con `dxf-parser` (no es dependencia del proyecto). `io/download.ts`
  compartido con exportSTL.
- Estado: `laser`, `laserAttractors` (propios, SIEMPRE en y = 0: las acciones
  del store aplanan cualquier posicion), `selectedLaserAttractorId`;
  `setLaserMaterial` aplica kerf/puente del preset (`LASER_MATERIALS`).
- UI: `LaserView` (SVG; atractores son circulos SVG arrastrables — aca no
  aplica el problema del gizmo de TransformControls), `LaserPanel`.
  `AttractorEditor` se reusa con `hint` propio. El calculo vive en
  `App.tsx` (`useLaserCut`) y solo corre con el modo activo.
- Tests: `laserCut.test.ts` (offset, distancias, por familia: genera cortes,
  sin atractores no corta, puente minimo real entre pares, margen al borde,
  determinismo, contorno al final; kerf achica calados/agranda contorno;
  agujero de la base respetado; huella: margen y puente), y
  `io/__tests__/exportLaser.test.ts` (estructura SVG/DXF).
- Pendiente: Clipper2 para kerf robusto, reticula reentrante / quiral (guia
  Fase 3), nesting, estimacion de tiempo de corte por material.

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

#### Ondas: costillas que fluyen + crestas orientables (reemplaza al peine recto)
- Las costillas ya NO son rectas paralelas fijas: son LINEAS DE FLUJO
  equiespaciadas (Jobard & Lefer 1997, `traceRibLines`) de
  `flowDirection(x, z)`. El campo mezcla en "angulo doble" (una costilla es un
  eje: 0 y 180 son lo mismo) la direccion base `ribAngleDeg` (peso
  `1 - envolvente maxima`, piso `BASE_FLOW_FLOOR`) con, por atractor (peso =
  envolvente * `flowStrength`), el `angleDeg` de un punto o la tangente de una
  curva en su punto mas cercano (`curveFrame2D`). Sin atractores o con
  `flowStrength` 0 = el peine de rectas paralelas de antes (test).
- Factibilidad: una linea se corta si se acerca a otra (o a si misma) a menos
  de `minDist = max(spacing/2, espesor + RIB_GAP_MM)` — entre caras siempre
  queda aire aunque las lineas converjan (test de distancia minima entre
  costillas distintas). Integracion RK2 con paso `spacing/3`; migajas mas
  cortas que `min(1.5 sep, medio panel)` se descartan; `MAX_RIBS` tope.
  Despues de agotar semillas se barre una grilla para cubrir islas / el otro
  lado de un agujero.
- Perfil: la altura se evalua en estaciones cada `wavelength/facets` a lo
  largo de la costilla y se interpola (cresta facetada, planta fina).
  `ribPolylineGeometry` extruye la polilinea con inglete acotado (2x espesor);
  mismo winding que la costilla recta original.
- Crestas: `waveMode` por atractor (`concentric` = como antes; `directional` =
  un punto proyecta sobre su `angleDeg`, una curva usa el largo recorrido `s`
  -> la onda viaja a lo largo del trazo). `angleDeg`/`waveMode` viven en el
  tipo Attractor comun pero solo los usa Ondas.
- UI: barra de direccion en cada punto (handle rotado Y = -angulo);
  `gizmoMode` en el store: tecla R (o el panel) alterna TransformControls entre
  mover y rotar (solo eje Y; el angulo se lee de `-rotation.y`, mod 180).
- Resultado expone `ribLines` y `minRibDistanceMm`. ~70 ms con la escena por
  defecto; a 2 mm de separacion ~200+ ms.
- Tests: `waveFlow.test.ts`.

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

**Clic DERECHO si agrega** (y es seguro): `AttractorGizmos` escucha
`onContextMenu` en un plano invisible de 400x400 en y = 0, no
`onPointerDown`. El gizmo solo se arrastra con el boton izquierdo, asi que no
lo dispara. Un clic derecho CON arrastre es el paneo de OrbitControls: se
ignora si `e.delta > 4px`. En la vista 2D (LaserView) el boton derecho no
inicia paneo ni arrastre (`e.button !== 0`).

### Lineas atractoras Bezier, seleccion de punto y atajos (los tres modos)
- `CurveAttractor.smooth: boolean[]` (uno por punto de control): suave = la
  curva pasa por el punto con manejadores Bezier automaticos (tangente
  Catmull-Rom, a 1/3), esquina = manejadores colapsados. Todo esquina = la
  poligonal recta de antes; `createCurveAttractor` crea rectas por defecto
  (tests viejos intactos), las de la UI y las iniciales nacen suaves.
  `applyAttractorPatch` mantiene `smooth` alineado al largo de `points`.
- `curvePath(a)` tesela (16 muestras por tramo curvo, 1 por tramo recto) y se
  cachea en un WeakMap por objeto (el estado es inmutable). LO MISMO se
  dibuja (gizmos 3D, LaserView) y se usa para la distancia
  (`closestPointOnAttractor`, `closestDistance2D`): lo que se ve es lo que atrae.
- `insertCurvePoint` (tramo mas cercano en XZ o extiende un extremo; y
  interpolada; hereda el tipo del vecino), `removeCurvePoint` (min 2 puntos).
- `selectedPointIndex` en el store, compartido por gizmo/vista, panel y
  teclado; los `select*` reciben `(id, pointIndex)`.
- `state/attractorSets.ts`: `AttractorSet` comun a los 3 modos
  (`useAttractorSet(kind)` con `useShallow`, `attractorSetFrom(state, kind)`
  para snapshots), `deleteSelection` (Supr/Delete/Backspace: punto de curva, o
  el atractor entero si es punto o quedaria < 2 puntos) y `addAtPoint` (clic
  derecho). El atajo vive en `App.tsx` (`useDeleteShortcut`) y se ignora al
  escribir en inputs de texto/numero.
- Marcadores: esfera/circulo = suave, cubo/cuadrado = esquina; el punto activo
  se agranda (3D) o se rellena (2D).
- Tests: `bezierCurve.test.ts`.

### Pendiente / notas para retomar
- **Modo Corte laser** (HECHO, ver arriba; nota original): 2D puro. Familias parametricas — empezar por
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

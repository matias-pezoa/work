# Ejercicio 02 — VRTG SCENT

Computación Avanzada · Magíster en Ciencias del Diseño · Universidad Adolfo Ibáñez

Atlas generativo de perfumes: cada fragancia de `perfume_visualization.json` se traduce en una naturaleza muerta 3D biomórfica y abstracta — un mapa morfológico de su identidad olfativa, inspirado en composiciones de objetos independientes (glossy, cromados, chenille, concreto, vidrio) ensamblados alrededor de una columna central — construida procedimentalmente a partir de sus propios datos, sin geometría decorativa ni valores inventados. Cada nota olfativa aporta su propio elemento a la composición de forma independiente; la combinación de notas de cada perfume es lo que vuelve única a cada pieza.

## Pregunta guía

> ¿Cómo puede el perfil olfativo de un perfume traducirse en un territorio tridimensional único y comparable?

## Dataset

Fuente: [Perfumes_Recommender](https://github.com/rawanalqarni/Perfumes_Recommender) (`perfume_dataset.csv`, ~4.2k filas).

### Pipeline de curado — `build_dataset.py`

`perfume_dataset.csv` + `perfume_visualization.raw.json` → **`perfume_visualization.json`** (lo que consume la app).

```bash
python build_dataset.py
```

Qué hace y por qué:

- **descarta lo que no es una fragancia que se lleva puesta** — velas, difusores, room sprays, bakhoor, hair/body mist, body lotion, sets y bundles (`product_type` + blocklist por nombre).
- **unifica marcas** escritas de varias formas ("Dolce&Gabbana" / "Dolce & Gabbana" tenían `brandid` distinto) a una sola forma canónica — de eso depende el score de "relacionados".
- **limpia `name`**: saca sufijos de tamaño (`- 100 ml`) y de concentración (`EDP`) que ensuciaban las listas.
- **corrige mojibake** (`PoivrÃ©e` → `Poivrée`) por roundtrip CP1252/UTF-8.
- **normaliza `fragrance_family`** (espacios, tokens duplicados como `Woody,Woody`, combos) y descarta el centinela vacío/`unknown`.
- **canonicaliza el vocabulario de notas** (`cedarwood` → `cedar`, plurales, sinónimos) — ~2920 → ~2600 claves, para que el grafo del mapa conecte notas que son la misma.
- **deduplica** (misma marca + nombre + año → 1 registro, se queda el más completo).
- **conserva `price` / `gender` / `concentration` / `size`** — campos completos y comparables que la versión anterior descartaba.

Resultado: ~2.8k perfumes, `price` en el 100%, `year` en el ~99%, `rate` sólo en ~10% (limitación de la fuente, se comunica en la leyenda).

`perfume_visualization.raw.json` se conserva como respaldo de la proyección original.

## Mappings dato → geometría

| Dato | Regla | Propiedad geométrica |
|---|---|---|
| categoría olfativa de la nota (cítrico, floral, madera, almizcle, ámbar…) | keyword sobre el nombre de la nota; si no calza, hash determinístico | **forma** (arquetipo: blob, cromo, pompón, concreto, vidrio) **y sector angular** — los cítricos siempre caen hacia un lado, las maderas hacia otro, así la silueta de la nube cuenta el balance del perfume |
| identidad de la nota (hash del nombre) | HSL determinístico | **color** del elemento — la misma nota es siempre el mismo color, en cualquier perfume y también en el mapa (antes cada vista tenía su criterio) |
| `top` / `middle` / `base` | franja vertical de anclaje a la columna | periferia superior · anillo medio · núcleo inferior · máx. 9 notas por capa |
| cantidad de notas por capa | escala inversa (D3) | tamaño relativo de cada elemento |
| `fragrance_family` | tabla de parámetros por familia | color y material (metalness/roughness/clearcoat) de la **columna central** |
| `year` | escala D3 (recortada en percentil bajo) | profundidad Z + marcador sobre la línea temporal |
| `rate` / `rating_count` | escalas normalizadas y clampeadas (D3) | escala global de los elementos — **inerte para el ~90% sin valoración** |

La geometría es reproducible: el mismo `perfume_id` siempre genera la misma combinación de elementos (forma, orientación y sector de cada nota seedeados por hash del dato, no por `Math.random`); sólo cambia qué notas contiene, y su tamaño/posición fina. La cámara se reencuadra automáticamente a la composición activa — por eso **el tamaño absoluto no es comparable entre perfumes; sí lo son forma, color y disposición**.

## Interacción

- Buscar por nombre/marca, filtrar por familia y por rango de año.
- Seleccionar un perfume → transición suave de entrada/actualización/salida por nota: los elementos de notas compartidas con el perfume anterior se mueven a su nueva posición/color, los nuevos crecen desde la columna central y los que ya no aplican se retraen y desaparecen.
- Rotar (drag) y hacer zoom (scroll) sobre el objeto.
- Activar/desactivar SALIDA / CORAZÓN / FONDO.
- Hover sobre el volumen → tooltip con la nota que generó esa zona.
- Lista de resultados y "relacionados" navegables por teclado (Tab + Enter); `prefers-reduced-motion` desactiva la rotación automática y los tweens; panel de info con `aria-live`.
- "Relacionados" pondera familia compartida + marca + año cercano + **notas en común**.
- **Mapa de notas** (botón superior derecho): **ego-network radial** del perfume activo. El foco va al centro; sus ~12 perfumes con mayor **afinidad de composición** (piso: ≥2 notas reales en común) se disponen en un anillo. Codificación:
  - **distancia al centro** = afinidad de composición (`layeredSimilarity`): una nota compartida pesa `1` si cae en la misma capa (salida/corazón/fondo) en ambos perfumes, `0.5` si es adyacente, `0.25` si es opuesta. Dos "vainilla" en fondo·fondo valen más que fondo·salida.
  - **grosor del rayo** = nº crudo de notas en común (dato concreto, distinto de la distancia): rayo grueso pero lejano = muchas notas mal alineadas; fino y cercano = pocas notas muy alineadas.
  - **sector angular** = agrupa por *nota puente* (la nota compartida más distintiva), rotulada en el borde; dentro de cada grupo se ordena por seriación (vecinos parecidos entre sí).
  - en cada mini-composición sólo resaltan las notas compartidas con el foco.
  - Cada nodo sigue siendo la mini-composición 3D del perfume (mismo lenguaje que la vista principal), con etiqueta siempre visible.
  - Interacción: hover atenúa el resto y lista las notas en común; **click** abre la ficha; **doble-click** re-centra el mapa en ese perfume (botón "‹ volver" para deshacer); "ver composición 3D" abre ese perfume en la vista principal. Cámara frontal fija (zoom + desplazamiento, sin órbita).
- **Infografía** (botón superior derecho): congela la ego-network del perfume activo como **lámina editorial vertical** (SVG). Mismo lenguaje que el mapa —foco al centro, relacionados en un anillo por afinidad de composición, agrupados por nota puente, hilos con grosor según notas en común, cada perfume dibujado con los objetos-arquetipo de sus notas—, más cabecera, leyenda y nº de catálogo. **Exportar como** → SVG vectorial (fuentes incrustadas como data-URI) o PNG 2000 px.

## Estructura

```text
visualizacion_data/
├── README.md
├── build_dataset.py              pipeline de curado
├── index.html
├── style.css
├── script.js
├── perfume_dataset.csv           fuente cruda
├── perfume_visualization.raw.json  proyección original (respaldo)
└── perfume_visualization.json    dataset curado que consume la app
```

## Cómo ejecutarlo

Usa módulos JS (`import`) + `fetch` del JSON, así que necesita un servidor local (no funciona con `file://`).

### Opción recomendada — VS Code + Live Server

1. Abre esta carpeta (o la raíz del repositorio) en VS Code.
2. Click derecho sobre `visualizacion_data/index.html` → **Open with Live Server**.

## Qué mirar en `script.js`

```text
01 — PALETA Y REGLAS DE FAMILIA   ← tabla color/curvatura/elongación/densidad/transmisión por familia
02 — UTILIDADES                  ← hash, PRNG (mulberry32), ruido Perlin; color por identidad de nota; sector angular por categoría olfativa; flag prefers-reduced-motion
03 — CARGA Y LIMPIEZA DE DATOS   ← el grueso de la limpieza ya vive en build_dataset.py; aquí sólo el mapeo a records + price/gender/size
04 — ESCALAS (D3)                ← year, rate, rating_count
05 — ESCENA THREE.JS             ← incluye entorno PMREM (RoomEnvironment) para reflejos PBR
06 — ARQUETIPOS DE NOTA          ← geometría + material por arquetipo: blob, cromo, fuzz/chenille, concreto, vidrio
07 — COLUMNA CENTRAL Y CACHÉ     ← columna que atraviesa las capas, caché persistente de objetos por nota (tendón de anclaje)
08 — OBJETIVO POR NOTA           ← posición/escala/color de cada nota para el perfume activo
09 — TRANSICIÓN                  ← tween de entrada/actualización/salida por nota + reencuadre automático de cámara
10 — RAYCASTING / TOOLTIP        ← hit-test directo contra el objeto de cada nota
11 — ANIMACIÓN
12-13 — ESTADO / UI / INIT
14 — MAPA DE NOTAS            ← ego-network radial 2D: layeredSimilarity (afinidad por capa), buildEgoNetwork (nota puente + seriación), stepMap (transición a layout), rayos foco→nodo, etiquetas con de-colisión
15 — INFOGRAFÍA / LÁMINA       ← renderPoster: la misma ego-network en SVG editorial vertical; pArch/pDrawObject/pDrawComposition (arquetipos en 2D); exportPoster (SVG con @font-face data-URI, PNG por canvas)
```

Esta carpeta es la versión definitiva del ejercicio. Las carpetas de iteración
previas (`exercise-02/` en el repo, y los directorios de trabajo `PERFUME/` /
`PERFUME_v2/`) quedan superadas; su único aporte rescatable —la métrica
`layeredSimilarity` para el mapa— ya está integrado acá.

## GitHub Pages

Rutas relativas, sin build step; se publica en `/visualizacion_data/` dentro del
sitio del curso. `build_dataset.py` se corre localmente y se commitea el `.json`
resultante (la app carga sólo `perfume_visualization.json`; la fuente cruda y el
respaldo se versionan para reproducir el pipeline).

## Pendiente (próxima iteración)

- **Modo comparar**: fijar 2–4 perfumes lado a lado a escala fija (sin reencuadre) — es lo que responde de lleno la pregunta guía.
- **Eje temporal legible**: ticks y etiquetas de año sobre la línea; hoy el marcador no se lee.
- **Arquetipos 1:1 con la categoría**: hoy `glass` cubre a la vez cítricos y ámbar/gourmand; separar en 7 formas.
- **Consolidar los 5 renderers de la leyenda** en uno (scissor).
- **Mapa**: de-colisión de etiquetas 100% (aún se pisan un par en zonas densas); leyenda propia del mapa (hoy reusa la de arquetipos).
- **Infografía**: variante "atlas de notas" del dataset completo (una sola lámina de síntesis); afinar formas de arquetipo en 2D (el vidrio y el gel se distinguen poco a tamaño chico).
- **Mobile**: repensar como bottom-sheet + canvas fullscreen en vez de 6 paneles fijos; recuperar "relacionados".

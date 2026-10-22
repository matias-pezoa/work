# Plataforma parametrica textil — impresion 3D + corte laser

Herramienta web para diseno de moda experimental: modelado de volumenes
parametricos, distribucion de elementos por mapas de atraccion, geometria
auxetica y exportacion para fabricacion digital (STL / SVG / DXF).

Construida siguiendo una guia por fases (`docs/guia-fases.md`). Ver `CLAUDE.md`
para la vision completa, el stack y el estado por fases.

## Estado

| Modo | Que | Estado |
|---|---|---|
| Volumen (3D) | Puas solidas y autosoportadas que emergen de un plano, dirigidas por un mapa de atractores. Imprimibles por construccion. Export STL. | ✅ |
| Ondas (3D) | Panel corrugado: costillas trigonometricas radiales desde cada atractor, facetadas. Imprimible por construccion. Export STL. | ✅ |
| Corte laser (2D) | Cortes parametricos solo-vector (huella de puas, auxetico, escamas). Export SVG/DXF. | pendiente |

Roadmap posterior: imagen → vector / campo, kerf por material, importar maniqui.
Ver `docs/guia-fases.md`.

## Requisitos

- Node.js 20+ (probado con Node 24). El resto del repo no tiene build step;
  este subproyecto si, por el stack React/Vite/TS elegido en la guia.

## Uso

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests unitarios de src/geometry/
npm run build      # compila a ../../plataforma-parametrica/ (ver Deploy)
npm run lint       # oxlint
npm run format     # prettier
```

### Modo Volumen (3D)

Todo emerge de un plano (la base de tela). Sobre el se siembran **puas**: piezas
solidas (cono truncado, no una pared delgada) que crecen desde el plano. La
**altura, los radios, la inclinacion y la densidad** salen del **mapa de
atractores**, no de edicion manual — y estan limitados por construccion a lo
que una impresora FDM puede imprimir sin soporte:

- **Vuelo por capa ≤ 45°**: cada pua es una linea recta de base a punta con
  angulo constante, asi que ningun corte individual vuela mas que el anterior.
- **Estabilidad de la base**: ademas del vuelo, la inclinacion se limita segun
  la altura y el ancho de la propia base — una pua alta y angosta hace palanca
  sobre su punto de apoyo y puede despegarlo de la cama/tela aunque cada capa
  sea valida por si sola. Por eso se inclina menos (o nada) automaticamente
  cuanto mas alta y angosta es (el panel cuenta cuantas quedaron asi limitadas).
- **Radio minimo en la punta y en la base**: la punta nunca se afina por debajo
  del ancho de una linea de extrusion; la base nunca baja de un area de
  contacto real para adherirse a la tela.
- **Sin solapes**: una pua candidata se descarta si su huella invade la de una
  ya colocada (el panel muestra cuantas se descartaron por esto).
- **La base nunca se inclina**: la malla es un tronco de cono oblicuo — el
  anillo de la base es siempre horizontal y queda fijo sobre el plano; solo el
  anillo de la punta se desplaza. (Un cono recto simplemente rotado inclinaria
  tambien su disco de base, despegandolo del plano de un lado.)

Los atractores se agregan con el boton **"+ Agregar atractor"** del panel (no
con clic en el viewport: el gizmo de arrastre no admite ese gesto sin
producir un atractor de mas en cada intento de moverlo). Clic en una esfera
roja la selecciona; el gizmo la arrastra.

Ajustando `Caras` (en "Forma de la pua") de 3 a ~32 la pua pasa de piramide a
prisma a cono liso — variedad de forma sin agregar parametros nuevos.

- El panel ajusta la base y distribucion, la forma de la pua y cada atractor
  (radio, intensidad, tipo de caida).
- "Descargar STL (mm)" exporta **todas las puas fusionadas** en un unico
  archivo, convertido a milimetros.

### Modo Ondas (3D)

También todo emerge de un plano. Sobre él se generan **costillas** por
trigonometría: cada atractor emite una ondulación radial (como un círculo
concéntrico que se aleja de una piedra tirada al agua), con crestas cada
"longitud de onda" y una envolvente que las apaga lejos del atractor.

- El panel es un **sólido**: base plana de espesor mínimo (siempre horizontal,
  igual que en Volumen) con las costillas talladas encima — nunca una lámina
  hueca.
- La malla se genera con **resolución baja** respecto de la longitud de onda
  ("Facetas por onda") para que las crestas se vean como facetas — costillas —
  en vez de una onda suavizada; se dibujan además las aristas de cada faceta
  para que se noten sin depender del ángulo de luz.
- **Amplitud recortada por seguridad**: la pendiente de la onda no puede
  superar el vuelo autosoportado (mismo límite que Volumen); si el slider pide
  más amplitud de la que esa longitud de onda permite, se aplica menos (el
  panel avisa "recortada").

Mismo flujo de atractores que Volumen (botón "+ Agregar atractor", gizmo para
arrastrar), pero con su propio set independiente — mover uno no afecta al otro
modo.

### Base personalizada: importar un patrón

En ambos modos 3D, la sección **"Base personalizada"** del panel reemplaza el
panel cuadrado por un **SVG importado** — por ejemplo, una pieza de patrón de
moda (como las que exporta `patronmoda`, convertida a SVG).

- Acepta `path`, `polygon`, `polyline`, `rect`, `circle`, `ellipse` — cualquier
  curva, sin importar cuán compleja (usa las APIs nativas del navegador para
  leerla, no una implementación propia de curvas Bézier).
- El contorno cerrado de **mayor área** es el borde externo; un segundo
  contorno cerrado dentro del primero se trata como **agujero** (p. ej. una
  pinza) — las puas/costillas no se generan ahí.
- El SVG puede estar en cualquier unidad: se recalibra con el campo **"Ancho
  real (mm)"**, que fija el ancho físico de la pieza (el alto se ajusta
  proporcionalmente).
- La base importada es **compartida** entre Volumen y Ondas: se importa una
  vez y se puede probar con cualquiera de los dos tratamientos.
- "Quitar base personalizada" vuelve al panel cuadrado en cualquier momento.

En el modo Ondas el contorno queda "a escalones" (según la resolución de la
grilla, no como un trazo perfectamente liso) — es una limitación conocida y
coherente con la estética ya facetada del modo.

### Modo Corte laser (2D) — en preparacion

Trabajara solo desde el vector: cortes parametricos con distintas familias de
geometria y export SVG/DXF con compensacion de kerf.

## Deploy a GitHub Pages

El Pages del repo sirve la rama `main` desde la raiz, sin build step. Este
subproyecto se publica como carpeta estatica:

- `npm run build` genera el sitio directamente en `../../plataforma-parametrica/`
  (raiz del repo), con `base: './'` (rutas relativas).
- Commitear esa carpeta a `main` y pushear. Queda en
  `https://<usuario>.github.io/work/plataforma-parametrica/`.
- **Rebuild = re-`npm run build` + commit** de `plataforma-parametrica/`.

Alternativa con GitHub Actions: `.github/workflows/deploy-plataforma.yml`
(incluido, inerte). Habria que moverlo a la raiz del repo y cambiaria la fuente
de Pages a "GitHub Actions", desplazando el sitio raiz actual. No recomendado
mientras el repo publique su About desde la raiz.

## Estructura

Ver `CLAUDE.md`. Resumen: `src/geometry/` = funciones puras (con tests),
`src/components/` = escenas y paneles React, `src/scene/` = setup de R3F,
`src/io/` = exportadores, `src/state/` = store zustand, `src/utils/` = unidades
y helpers.

# VRTG

Guía para **Clase 02 — Computación Avanzada**
Magíster en Ciencias del Diseño · Universidad Adolfo Ibáñez

## Objetivo

> **Una imagen no es solo su forma: es un conjunto de datos que se puede fragmentar, distorsionar y hacer reaccionar.**

Este proyecto convierte una imagen — subida como archivo o tomada en vivo
con la cámara — en un campo de partículas, un punto por píxel muestreado,
cuyo color viene del contenido real de la imagen. Un conjunto de reglas de
distorsión y glitch (referenciando la estética del póster *REAL—Real City*,
Arko Art Center) altera esa lectura, y el micrófono dispersa las partículas
en tiempo real según el volumen.

## Parámetros

### Imagen
- Subir imagen
- Usar cámara (tiempo real): mientras está activa, el campo se regenera
  ~15 veces por segundo desde el video en vivo; "Detener cámara" congela
  el último frame como imagen fija
- Resolución (densidad de muestreo — limitada automáticamente a 180 en
  modo cámara para mantener la fluidez)
- Tamaño de partícula
- Profundidad (relieve por brillo)

### Distorsión
- Especularidad (brillo extra en las zonas más claras)
- Cantidad de distorsión (ruido orgánico, no una onda regular)
- Nivel de glitch (bandas desplazadas + separación de canal RGB)
- Nuevo glitch (nueva semilla aleatoria para el patrón de glitch)

### Audio
- Activar micrófono
- Sensibilidad (cuánto dispersa el volumen a las partículas)

## Estructura

```text
lab-02/
├── README.md
├── index.html
├── style.css
├── main.js
└── assets/
    └── models/
```

## Cómo ejecutarlo

Este proyecto utiliza módulos JavaScript y `getUserMedia` (micrófono), por lo
que **debe** abrirse mediante un servidor local — `file://` no funciona.

### Opción recomendada — VS Code + Live Server

1. Abre esta carpeta en VS Code.
2. Instala la extensión **Live Server**.
3. Haz click derecho sobre `index.html`.
4. Selecciona **Open with Live Server**.
5. Sube una imagen desde el panel lateral.

## Qué mirar en `main.js`

```text
01 — PARÁMETROS
02 — ESCENA
03 — SISTEMA DE PARTÍCULAS
04 — CARGA Y MUESTREO DE IMAGEN
05 — REGLAS GENERATIVAS
06 — GENERAR CAMPO
07 — ALEATORIEDAD CONTROLADA
08 — AUDIO: MOVIMIENTO Y DECIBELES
09 — PALETA CROMÁTICA
10 — INTERFAZ
11 — BUCLE DE ANIMACIÓN
```

Las decisiones de diseño están en la sección 05:

```js
function generarDesplazamientosGlitch(filas)                          // Regla A — glitch por bandas
function calcularColorParticula(col, fila, desplazamientoFila)        // Regla B — color + especularidad
function calcularProfundidadYDistorsion(px, py, brillo)               // Regla C — relieve + distorsión
```

## Primeros experimentos

### 1 — Sube una imagen y solo mira

Con "Nivel de glitch" y "Cantidad de distorsión" en 0, la imagen debería
leerse casi tal cual, solo como una nube de puntos de colores reales.

### 2 — Sube el glitch al máximo

`glitch: 1` hace que casi todas las filas se desplacen — compara el
resultado con el póster de referencia (*REAL—Real City*, Arko Art Center,
2019): bandas de color cortadas y corridas, canales RGB separados.

### 3 — Conecta el micrófono y habla o pon música

En silencio la imagen se mantiene nítida; con volumen alto se dispersa en
ruido. El HUD arriba a la derecha muestra el nivel en dB en tiempo real.

### 4 — Cambia la regla de color

Dentro de `calcularColorParticula()`, el boost de especularidad es
`1 + parametros.especularidad * brillo * brillo`. Prueba con `brillo`
sin elevar al cuadrado, o invirtiendo qué zonas brillan (`1 - brillo`).

## Datos en pantalla (HUD)

El overlay sobre el canvas (tipografía monoespaciada, JetBrains Mono) muestra:

- **Autor / curso / universidad** — editables directamente en `index.html`
  (`#hud-autor`, `#hud-curso`, `#hud-universidad`).
- **Nivel de audio** en dB — lectura RMS en tiempo real del micrófono
  (aproximación dBFS, no es un dB SPL calibrado).
- **Paleta cromática** — 5 colores promediados de franjas verticales de la
  imagen, con su código hexadecimal.

## GitHub Pages

El proyecto usa rutas relativas y puede publicarse directamente en GitHub
Pages. El micrófono funcionará porque GitHub Pages sirve por `https://`.

## Pregunta guía

> **¿Qué tan "real" es una imagen cuando se fragmenta en datos que el sonido puede dispersar?**

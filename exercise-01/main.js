import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ======================================================
// 01 — PARÁMETROS
// ======================================================

const valoresIniciales = {
  resolucion: 300,
  tamanioParticula: 0.035,
  espaciado: 1.0,
  profundidad: 2.5,
  especularidad: 0.6,
  saturacion: 1.0,
  coloresPersonalizadosActivo: false,
  distorsion: 0.3,
  glitch: 0.35,
  audioActivo: false,
  audioFuerza: 3.0,
  glitchSemilla: 7, // no tiene slider propio: cambia con el botón "Nuevo glitch"
};

const parametros = { ...valoresIniciales };

// ======================================================
// 02 — ESCENA
// ======================================================

const viewport = document.querySelector("#viewport");

const escena = new THREE.Scene();
escena.background = new THREE.Color(0x000000);

const camara = new THREE.PerspectiveCamera(
  42,
  viewport.clientWidth / viewport.clientHeight,
  0.1,
  200
);

camara.position.set(0, 0, 16);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

viewport.appendChild(renderer.domElement);

const controlesOrbita = new OrbitControls(camara, renderer.domElement);
controlesOrbita.enableDamping = true;
controlesOrbita.target.set(0, 0, 0);

// No hay luces: las partículas se dibujan con su propio color (no lit),
// igual que un póster impreso — el "relieve" se lee por el desplazamiento
// en Z, no por sombreado.

// ======================================================
// 03 — SISTEMA DE PARTÍCULAS
// ======================================================
// Un punto por píxel muestreado de la imagen. Los buffers se reservan una
// sola vez a capacidad máxima (resolución máx. al cuadrado) para no pedir
// memoria nueva a la GPU cada vez que se mueve un slider — solo se dibuja
// el tramo [0, totalParticulasActivas) mediante setDrawRange.

// resolución máxima (700) al cuadrado. No se sube más: 5000×5000 serían 25
// millones de partículas — más de lo que un tab de navegador puede animar
// en tiempo real (el bucle de audio, sección 08, recorre todas cada frame).
// 700×700 = 490.000 partículas ya es un techo exigente para 60fps estables.
const CAPACIDAD_MAXIMA_PARTICULAS = 500000;

const geometriaParticulas = new THREE.BufferGeometry();

geometriaParticulas.setAttribute(
  "position",
  new THREE.BufferAttribute(new Float32Array(CAPACIDAD_MAXIMA_PARTICULAS * 3), 3)
);
geometriaParticulas.setAttribute(
  "color",
  new THREE.BufferAttribute(new Float32Array(CAPACIDAD_MAXIMA_PARTICULAS * 3), 3)
);
geometriaParticulas.setDrawRange(0, 0);

let totalParticulasActivas = 0;

// Posición de reposo (tras distorsión + glitch) y dirección/fase propia
// de cada partícula: el audio la desplaza a partir de estos valores.
const particulasBaseX = new Float32Array(CAPACIDAD_MAXIMA_PARTICULAS);
const particulasBaseY = new Float32Array(CAPACIDAD_MAXIMA_PARTICULAS);
const particulasBaseZ = new Float32Array(CAPACIDAD_MAXIMA_PARTICULAS);
const particulasJitterX = new Float32Array(CAPACIDAD_MAXIMA_PARTICULAS);
const particulasJitterY = new Float32Array(CAPACIDAD_MAXIMA_PARTICULAS);
const particulasJitterZ = new Float32Array(CAPACIDAD_MAXIMA_PARTICULAS);
const particulasFase = new Float32Array(CAPACIDAD_MAXIMA_PARTICULAS);

// Qué tan lejos del punto medio de brillo está cada partícula (0..1):
// las zonas más claras u oscuras tienen más relieve y, por lo tanto,
// más rango de movimiento cuando reacciona al audio.
const particulasProfundidad = new Float32Array(CAPACIDAD_MAXIMA_PARTICULAS);

// Sin textura: puntos cuadrados y opacos, con test/escritura de profundidad
// real, para que se oculten entre sí como vóxeles — no como una nube de
// luces translúcidas.
const materialParticulas = new THREE.PointsMaterial({
  size: parametros.tamanioParticula,
  vertexColors: true,
  transparent: false,
  depthWrite: true,
  depthTest: true,
});

const particulas = new THREE.Points(geometriaParticulas, materialParticulas);
escena.add(particulas);

// Objetos reutilizados en calcularColorParticula() para no crear uno nuevo
// por cada una de las (hasta 500.000) partículas en cada regeneración.
const colorEscratch = new THREE.Color();
const hslEscratch = { h: 0, s: 0, l: 0 };

// Paleta de hasta 4 colores personalizados (modo "Colores personalizados"):
// reemplazan el color real de la imagen por un degradado propio, mapeado
// según el brillo de cada píxel.
const coloresPersonalizadosInicial = ["#1a1a2e", "#e94560", "#f5b642", "#f6f1e7"];
const coloresPersonalizados = coloresPersonalizadosInicial.map((hex) => new THREE.Color(hex));

// ======================================================
// 04 — CARGA Y MUESTREO DE IMAGEN
// ======================================================
// La imagen se dibuja reducida sobre un canvas en memoria: el tamaño de
// destino (columnasImagen × filasImagen) fija cuántos píxeles se leen,
// es decir, la densidad de partículas.

const lienzoMuestreo = document.createElement("canvas");
const contextoMuestreo = lienzoMuestreo.getContext("2d", { willReadFrequently: true });

let imagenActual = null;
let datosImagenActual = null;
let columnasImagen = 0;
let filasImagen = 0;

// espejo=true invierte horizontalmente (la cámara frontal se ve mejor en
// espejo, como un espejo real); las imágenes subidas nunca lo usan.
function muestrearFuente(fuente, ancho, alto, resolucion, espejo = false) {
  const aspecto = ancho / alto;

  if (aspecto >= 1) {
    columnasImagen = resolucion;
    filasImagen = Math.max(1, Math.round(resolucion / aspecto));
  } else {
    filasImagen = resolucion;
    columnasImagen = Math.max(1, Math.round(resolucion * aspecto));
  }

  lienzoMuestreo.width = columnasImagen;
  lienzoMuestreo.height = filasImagen;
  contextoMuestreo.clearRect(0, 0, columnasImagen, filasImagen);

  if (espejo) {
    contextoMuestreo.save();
    contextoMuestreo.scale(-1, 1);
    contextoMuestreo.drawImage(fuente, -columnasImagen, 0, columnasImagen, filasImagen);
    contextoMuestreo.restore();
  } else {
    contextoMuestreo.drawImage(fuente, 0, 0, columnasImagen, filasImagen);
  }

  datosImagenActual = contextoMuestreo.getImageData(0, 0, columnasImagen, filasImagen).data;
}

function procesarImagen(imagenElement) {
  muestrearFuente(imagenElement, imagenElement.width, imagenElement.height, parametros.resolucion);
}

// Punto de entrada común: tanto el archivo subido como la foto capturada
// desde la cámara terminan aquí como un <img> ya cargado.
function usarImagenLista(imagen) {
  imagenActual = imagen;
  procesarImagen(imagenActual);
  generarCampo();
  mensajeInicial.classList.add("oculto");
}

function cargarImagen(archivo) {
  const lector = new FileReader();

  lector.onload = () => {
    const imagen = new Image();
    imagen.onload = () => usarImagenLista(imagen);
    imagen.src = lector.result;
  };

  lector.readAsDataURL(archivo);
}

// ======================================================
// 04B — ENTRADA DE CÁMARA EN TIEMPO REAL
// ======================================================
// Segunda fuente de imagen, alternativa al archivo subido: mientras la
// cámara está activa, cada tick (sección 11, throttleado a ~15fps) vuelve
// a muestrear el frame actual del <video> y regenera el campo — como si
// se "subiera una imagen nueva" varias veces por segundo.
//
// Regenerar el campo completo recalcula ruido orgánico + glitch por cada
// partícula (secciones 05-06), así que a resoluciones altas no alcanza a
// hacerse a tiempo real. Por eso, mientras la cámara esté en vivo, se usa
// como techo RESOLUCION_MAXIMA_TIEMPO_REAL en vez del valor del slider
// (que sigue aplicándose tal cual a imágenes fijas y al cerrar la cámara).

const RESOLUCION_MAXIMA_TIEMPO_REAL = 180; // 180×180 = 32.400 partículas
const INTERVALO_VIDEO_EN_VIVO = 1 / 15; // segundos entre actualizaciones (~15fps)

let flujoCamara = null;
let camaraEnVivo = false;
let ultimoMuestreoVideo = 0;

async function activarCamara() {
  mensajeInicial.classList.add("oculto"); // se elige la opción: el aviso ya no aplica

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    salidaCamaraEstado.textContent =
      "El navegador bloqueó la cámara: abre el proyecto con un servidor local (http://localhost), no con file://";
    panelCamara.classList.remove("oculto");
    mensajeInicial.classList.remove("oculto"); // no hay fuente de imagen: vuelve a mostrarlo
    return;
  }

  try {
    flujoCamara = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
    });

    videoCamara.srcObject = flujoCamara;
    await videoCamara.play();

    camaraEnVivo = true;
    ultimoMuestreoVideo = 0; // fuerza un muestreo inmediato en el próximo tick

    salidaCamaraEstado.textContent =
      parametros.resolucion > RESOLUCION_MAXIMA_TIEMPO_REAL
        ? `Tiempo real: resolución limitada a ${RESOLUCION_MAXIMA_TIEMPO_REAL} para mantener fluidez.`
        : "";
    panelCamara.classList.remove("oculto");
  } catch (error) {
    console.error("Error al activar la cámara:", error);

    const mensajes = {
      NotAllowedError: "Permiso denegado. Habilita la cámara para este sitio en el navegador.",
      NotFoundError: "No se encontró ninguna cámara conectada.",
      NotReadableError: "La cámara está siendo usada por otra aplicación.",
    };

    salidaCamaraEstado.textContent =
      mensajes[error.name] || `No se pudo acceder a la cámara (${error.name || error.message})`;
    panelCamara.classList.remove("oculto");
    mensajeInicial.classList.remove("oculto"); // no hay fuente de imagen: vuelve a mostrarlo
  }
}

// Al detener, el último frame en pantalla queda como imagen fija: se
// congela como <img> para que sliders y "Restablecer" sigan funcionando
// igual que con una imagen subida.
function detenerCamara() {
  camaraEnVivo = false;

  if (videoCamara.videoWidth) {
    const lienzoCaptura = document.createElement("canvas");
    lienzoCaptura.width = videoCamara.videoWidth;
    lienzoCaptura.height = videoCamara.videoHeight;

    const contextoCaptura = lienzoCaptura.getContext("2d");
    contextoCaptura.translate(lienzoCaptura.width, 0);
    contextoCaptura.scale(-1, 1);
    contextoCaptura.drawImage(videoCamara, 0, 0);

    const imagen = new Image();
    imagen.onload = () => {
      imagenActual = imagen;
    };
    imagen.src = lienzoCaptura.toDataURL("image/png");
  }

  if (flujoCamara) {
    flujoCamara.getTracks().forEach((pista) => pista.stop());
    flujoCamara = null;
  }

  videoCamara.srcObject = null;
  panelCamara.classList.add("oculto");
}

function actualizarCampoEnVivo(tiempo) {
  if (!camaraEnVivo) return;
  if (tiempo - ultimoMuestreoVideo < INTERVALO_VIDEO_EN_VIVO) return;
  if (!videoCamara.videoWidth) return; // el video todavía no tiene un frame listo

  ultimoMuestreoVideo = tiempo;

  const resolucionEnVivo = Math.min(parametros.resolucion, RESOLUCION_MAXIMA_TIEMPO_REAL);
  muestrearFuente(videoCamara, videoCamara.videoWidth, videoCamara.videoHeight, resolucionEnVivo, true);
  generarCampo();
}

// ======================================================
// 05 — REGLAS GENERATIVAS
// ======================================================
// Estas funciones representan decisiones de diseño.
// Si cambian estas reglas, cambia la familia de resultados.

// Regla A:
// una fracción de las filas (proporcional al nivel de glitch) se
// desplaza en X como bloque completo, referenciando el póster —
// bandas de imagen "cortadas" y corridas.
function generarDesplazamientosGlitch(filas) {
  const desplazamientos = new Float32Array(filas);

  for (let fila = 0; fila < filas; fila++) {
    const activador = (aleatoriedadConSemilla(fila, 0, parametros.glitchSemilla) + 1) / 2;
    if (activador > parametros.glitch) continue; // esta fila no glitchea

    const magnitud = (aleatoriedadConSemilla(fila, 1, parametros.glitchSemilla) + 1) / 2;
    const signo = aleatoriedadConSemilla(fila, 2, parametros.glitchSemilla) < 0 ? -1 : 1;

    desplazamientos[fila] = signo * magnitud * parametros.glitch * columnasImagen * 0.25;
  }

  return desplazamientos;
}

// Regla B:
// color = contenido real de píxeles de la imagen (o, en modo "Colores
// personalizados", un degradado propio mapeado por brillo), con el canal
// rojo y azul muestreados desde columnas ligeramente distintas (separación
// de canal / aberración cromática) cuando la fila está en glitch.
//
// La especularidad y la saturación se aplican en espacio HSL, tocando solo
// luminosidad/saturación — nunca cada canal RGB por separado. Multiplicar
// r, g y b de forma independiente y recortar a 1 (como hacía antes) empuja
// cualquier tono claro hacia blanco puro, y ese efecto se nota mucho más
// al agrandar las partículas: cada una pasa de ser un punto casi invisible
// a un bloque visible sin color. Por eso la luminosidad nunca llega a 1.
function calcularColorParticula(col, fila, desplazamientoFila) {
  const desplazamientoCanal = Math.round(desplazamientoFila * 0.4);

  const colR = THREE.MathUtils.clamp(col + desplazamientoCanal, 0, columnasImagen - 1);
  const colB = THREE.MathUtils.clamp(col - desplazamientoCanal, 0, columnasImagen - 1);

  const r = datosImagenActual[(fila * columnasImagen + colR) * 4] / 255;
  const g = datosImagenActual[(fila * columnasImagen + col) * 4 + 1] / 255;
  const b = datosImagenActual[(fila * columnasImagen + colB) * 4 + 2] / 255;

  const brillo = (r + g + b) / 3;

  if (parametros.coloresPersonalizadosActivo) {
    aplicarGradientePersonalizado(brillo);
  } else {
    colorEscratch.setRGB(r, g, b);
  }

  const hsl = colorEscratch.getHSL(hslEscratch);
  const saturacion = THREE.MathUtils.clamp(hsl.s * parametros.saturacion, 0, 1);

  // El degradado personalizado ya define su propia luminosidad a propósito;
  // la especularidad solo potencia el brillo real de la imagen.
  const luminosidad = parametros.coloresPersonalizadosActivo
    ? hsl.l
    : THREE.MathUtils.clamp(hsl.l * (1 + parametros.especularidad * brillo * brillo), 0, 0.92);

  colorEscratch.setHSL(hsl.h, saturacion, luminosidad);

  return { r: colorEscratch.r, g: colorEscratch.g, b: colorEscratch.b, brillo };
}

// Interpola brillo (0..1) a lo largo de hasta 4 colores elegidos por el
// usuario, como un degradado duotono/quadtono. Escribe en colorEscratch.
function aplicarGradientePersonalizado(brillo) {
  const escala = brillo * (coloresPersonalizados.length - 1);
  const indiceInferior = Math.floor(escala);
  const indiceSuperior = Math.min(coloresPersonalizados.length - 1, indiceInferior + 1);
  const mezcla = escala - indiceInferior;

  colorEscratch.copy(coloresPersonalizados[indiceInferior]);
  colorEscratch.lerp(coloresPersonalizados[indiceSuperior], mezcla);
}

// Ruido de valor suavizado (interpolación bilineal + smoothstep) sobre el
// mismo generador con semilla que el resto del sistema: continuo en vez
// de aleatorio punto a punto, para que la distorsión fluya como tela en
// vez de saltar como estática. Lo usa la Regla C, más abajo.
function suavizar(t) {
  return t * t * (3 - 2 * t);
}

function ruidoValor2D(x, y, semilla) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);

  const sx = suavizar(x - x0);
  const sy = suavizar(y - y0);

  const n00 = aleatoriedadConSemilla(x0, y0, semilla);
  const n10 = aleatoriedadConSemilla(x0 + 1, y0, semilla);
  const n01 = aleatoriedadConSemilla(x0, y0 + 1, semilla);
  const n11 = aleatoriedadConSemilla(x0 + 1, y0 + 1, semilla);

  const nx0 = THREE.MathUtils.lerp(n00, n10, sx);
  const nx1 = THREE.MathUtils.lerp(n01, n11, sx);

  return THREE.MathUtils.lerp(nx0, nx1, sy);
}

// Tres octavas sumadas: un patrón orgánico con detalle grueso y fino a
// la vez, en vez de una sola onda regular.
function ruidoOrganico(x, y, semilla) {
  let total = 0;
  let amplitud = 1;
  let frecuencia = 1;
  let normalizador = 0;

  for (let octava = 0; octava < 3; octava++) {
    total += ruidoValor2D(x * frecuencia, y * frecuencia, semilla + octava * 101) * amplitud;
    normalizador += amplitud;
    amplitud *= 0.5;
    frecuencia *= 2;
  }

  return total / normalizador; // -1..1
}

// Regla C:
// brillo del píxel → profundidad (relieve); posición en el plano → ruido
// orgánico en X, Y y Z — pliegues y desgarros continuos, no bandas rectas.
function calcularProfundidadYDistorsion(px, py, brillo) {
  let z = (0.5 - brillo) * parametros.profundidad; // invertido: lo oscuro sobresale, lo claro se hunde

  const escalaRuido = 0.35;
  const semilla = parametros.glitchSemilla;

  const ruidoX = ruidoOrganico(px * escalaRuido, py * escalaRuido, semilla);
  const ruidoY = ruidoOrganico(px * escalaRuido + 71, py * escalaRuido + 71, semilla + 300);
  const ruidoZ = ruidoOrganico(px * escalaRuido + 149, py * escalaRuido + 149, semilla + 700);

  px += ruidoX * parametros.distorsion * 2;
  py += ruidoY * parametros.distorsion; // menor peso: mantiene legible la silueta
  z += ruidoZ * parametros.distorsion * 2;

  return { px, py, z };
}

// ======================================================
// 06 — GENERAR CAMPO
// ======================================================

function generarCampo() {
  if (!datosImagenActual) return;

  const anchoEscena = 12; // unidades de escena que ocupa el eje mayor de la imagen
  const escala = (anchoEscena / Math.max(columnasImagen, filasImagen)) * parametros.espaciado;

  const desplazamientosGlitch = generarDesplazamientosGlitch(filasImagen);

  const posiciones = geometriaParticulas.attributes.position.array;
  const colores = geometriaParticulas.attributes.color.array;

  // Paleta HUD: se acumula con los mismos colores ya procesados (Regla B) que
  // terminan en cada partícula, así siempre refleja la composición real en
  // pantalla — modo "Colores personalizados", saturación, especularidad y
  // separación de canal por glitch incluidos — y no el archivo original.
  const acumuladorPaleta = crearAcumuladorPaleta();

  let indiceParticula = 0;

  bucleFilas:
  for (let fila = 0; fila < filasImagen; fila++) {
    const desplazamientoFila = desplazamientosGlitch[fila];

    for (let col = 0; col < columnasImagen; col++) {
      if (indiceParticula >= CAPACIDAD_MAXIMA_PARTICULAS) break bucleFilas;

      const alfa = datosImagenActual[(fila * columnasImagen + col) * 4 + 3];
      if (alfa < 10) continue; // píxeles casi transparentes no generan partícula

      const color = calcularColorParticula(col, fila, desplazamientoFila);

      let px = (col - columnasImagen / 2) * escala + desplazamientoFila * escala;
      let py = (filasImagen / 2 - fila) * escala;

      const distorsionado = calcularProfundidadYDistorsion(px, py, color.brillo);
      px = distorsionado.px;
      py = distorsionado.py;
      const z = distorsionado.z;

      const i3 = indiceParticula * 3;
      posiciones[i3] = px;
      posiciones[i3 + 1] = py;
      posiciones[i3 + 2] = z;

      particulasBaseX[indiceParticula] = px;
      particulasBaseY[indiceParticula] = py;
      particulasBaseZ[indiceParticula] = z;
      particulasProfundidad[indiceParticula] = Math.abs(color.brillo - 0.5) * 2;

      const anguloJitter =
        ((aleatoriedadConSemilla(indiceParticula, 4, parametros.glitchSemilla) + 1) / 2) *
        Math.PI * 2;
      const magnitudJitter =
        (aleatoriedadConSemilla(indiceParticula, 5, parametros.glitchSemilla) + 1) / 2;

      particulasJitterX[indiceParticula] = Math.cos(anguloJitter) * magnitudJitter;
      particulasJitterY[indiceParticula] = Math.sin(anguloJitter) * magnitudJitter;
      particulasJitterZ[indiceParticula] =
        aleatoriedadConSemilla(indiceParticula, 6, parametros.glitchSemilla);

      particulasFase[indiceParticula] = (px + py) * 0.5 + indiceParticula * 0.013;

      colores[i3] = color.r;
      colores[i3 + 1] = color.g;
      colores[i3 + 2] = color.b;

      acumularColorPaleta(acumuladorPaleta, col, color);

      indiceParticula++;
    }
  }

  totalParticulasActivas = indiceParticula;

  geometriaParticulas.attributes.position.needsUpdate = true;
  geometriaParticulas.attributes.color.needsUpdate = true;
  geometriaParticulas.setDrawRange(0, totalParticulasActivas);

  materialParticulas.size = parametros.tamanioParticula;

  actualizarPaletaUI(resolverPaleta(acumuladorPaleta));
}

// ======================================================
// 07 — ALEATORIEDAD CONTROLADA
// ======================================================
// Devuelve un valor repetible entre -1 y 1.
// La misma semilla produce siempre el mismo patrón.

function aleatoriedadConSemilla(x, z, semilla) {
  const valor =
    Math.sin(
      x * 12.9898 +
      z * 78.233 +
      semilla * 37.719
    ) * 43758.5453;

  const normalizado = valor - Math.floor(valor);

  return normalizado * 2 - 1;
}

// ======================================================
// 08 — AUDIO: MOVIMIENTO Y DECIBELES
// ======================================================
// El volumen del micrófono controla cuánto se dispersan las partículas
// desde su posición de reposo: en silencio, la imagen se lee nítida;
// con volumen alto, se fragmenta en ruido. Cada partícula tiene su
// propia dirección y fase, así el movimiento no es un salto rígido.

let flujoAudio = null;
let contextoAudioGlobal = null;
let analizadorAudio = null;
let datosAudio = null;
let nivelAudio = 0;
let nivelDecibeles = -60;

async function activarAudio() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    // Ocurre en contextos no seguros: abrir index.html con file:// en vez
    // de servirlo desde http://localhost (Live Server u otro servidor).
    salidaAudioEstado.textContent =
      "El navegador bloqueó el micrófono: abre el proyecto con un servidor local (http://localhost), no con file://";
    return;
  }

  try {
    flujoAudio = await navigator.mediaDevices.getUserMedia({ audio: true });

    contextoAudioGlobal = new (window.AudioContext || window.webkitAudioContext)();
    if (contextoAudioGlobal.state === "suspended") await contextoAudioGlobal.resume();

    const fuente = contextoAudioGlobal.createMediaStreamSource(flujoAudio);

    analizadorAudio = contextoAudioGlobal.createAnalyser();
    analizadorAudio.fftSize = 512;
    datosAudio = new Uint8Array(analizadorAudio.fftSize);

    fuente.connect(analizadorAudio);

    parametros.audioActivo = true;
    controlAudioActivar.textContent = "Detener micrófono";
    salidaAudioEstado.textContent = "Escuchando…";
  } catch (error) {
    console.error("Error al activar el micrófono:", error);

    const mensajes = {
      NotAllowedError: "Permiso denegado. Habilita el micrófono para este sitio en el navegador.",
      NotFoundError: "No se encontró ningún micrófono conectado.",
      NotReadableError: "El micrófono está siendo usado por otra aplicación.",
    };

    salidaAudioEstado.textContent =
      mensajes[error.name] || `No se pudo acceder al micrófono (${error.name || error.message})`;
  }
}

function detenerAudio() {
  parametros.audioActivo = false;
  nivelAudio = 0;
  nivelDecibeles = -60;

  if (flujoAudio) {
    flujoAudio.getTracks().forEach((pista) => pista.stop());
    flujoAudio = null;
  }

  analizadorAudio = null;
  datosAudio = null;

  controlAudioActivar.textContent = "Activar micrófono";
  salidaAudioEstado.textContent = "Micrófono apagado";
  salidaAudioNivel.value = "0%";
  salidaDecibeles.textContent = "-60.0 dB";
}

// RMS del dominio temporal → aproximación de decibeles relativos a
// full-scale (dBFS). No es un dB SPL calibrado, pero es una lectura
// en tiempo real consistente con el volumen percibido.
function actualizarNivelAudio() {
  if (!parametros.audioActivo || !analizadorAudio) return;

  analizadorAudio.getByteTimeDomainData(datosAudio);

  let sumaCuadrados = 0;
  for (let i = 0; i < datosAudio.length; i++) {
    const muestra = (datosAudio[i] - 128) / 128;
    sumaCuadrados += muestra * muestra;
  }

  const rms = Math.sqrt(sumaCuadrados / datosAudio.length);

  nivelAudio = Math.min(1, rms * 4);
  nivelDecibeles = rms > 0.0001 ? Math.max(-60, 20 * Math.log10(rms)) : -60;

  salidaAudioNivel.value = `${Math.round(nivelAudio * 100)}%`;
  salidaDecibeles.textContent = `${nivelDecibeles.toFixed(1)} dB`;
}

// El rango de movimiento de cada partícula parte de su propia profundidad:
// las más alejadas del punto medio de brillo (más relieve) tienen hasta el
// doble de rango que las que casi no sobresalen. El slider "Profundidad"
// también sube el techo general, así el relieve y el movimiento crecen
// juntos.
function aplicarMovimientoAudio(tiempo) {
  if (totalParticulasActivas === 0) return;

  const posicionesAttr = geometriaParticulas.attributes.position;
  const arreglo = posicionesAttr.array;
  const techoProfundidad = 1 + parametros.profundidad * 0.2;

  for (let i = 0; i < totalParticulasActivas; i++) {
    const oscilacion = Math.sin(tiempo * 5 + particulasFase[i]);
    const rango = parametros.audioFuerza * (0.5 + particulasProfundidad[i] * 1.5) * techoProfundidad;
    const empuje = nivelAudio * rango * oscilacion;

    const i3 = i * 3;
    arreglo[i3] = particulasBaseX[i] + particulasJitterX[i] * empuje;
    arreglo[i3 + 1] = particulasBaseY[i] + particulasJitterY[i] * empuje;
    arreglo[i3 + 2] = particulasBaseZ[i] + particulasJitterZ[i] * empuje;
  }

  posicionesAttr.needsUpdate = true;
}

// ======================================================
// 09 — PALETA CROMÁTICA
// ======================================================
// Promedia, en cinco franjas verticales, el color que cada partícula
// termina teniendo en pantalla (Regla B ya aplicada) — no el píxel crudo
// del archivo — para que el HUD siempre muestre la paleta real de la
// composición: modo "Colores personalizados", saturación, especularidad
// y separación de canal por glitch quedan reflejados ahí también.

const CANTIDAD_COLORES_PALETA = 5;

function crearAcumuladorPaleta() {
  return {
    r: new Float64Array(CANTIDAD_COLORES_PALETA),
    g: new Float64Array(CANTIDAD_COLORES_PALETA),
    b: new Float64Array(CANTIDAD_COLORES_PALETA),
    contador: new Uint32Array(CANTIDAD_COLORES_PALETA),
  };
}

function acumularColorPaleta(acumulador, col, color) {
  const franja = Math.min(
    CANTIDAD_COLORES_PALETA - 1,
    Math.floor((col / columnasImagen) * CANTIDAD_COLORES_PALETA)
  );

  acumulador.r[franja] += color.r;
  acumulador.g[franja] += color.g;
  acumulador.b[franja] += color.b;
  acumulador.contador[franja]++;
}

function resolverPaleta(acumulador) {
  const paleta = [];

  for (let i = 0; i < CANTIDAD_COLORES_PALETA; i++) {
    const contador = acumulador.contador[i];
    if (contador === 0) continue; // franja sin partículas (p. ej. imagen muy angosta)

    paleta.push({
      r: Math.round((acumulador.r[i] / contador) * 255),
      g: Math.round((acumulador.g[i] / contador) * 255),
      b: Math.round((acumulador.b[i] / contador) * 255),
    });
  }

  return paleta;
}

function rgbAHex(r, g, b) {
  const componente = (valor) => valor.toString(16).padStart(2, "0");
  return `#${componente(r)}${componente(g)}${componente(b)}`.toUpperCase();
}

function actualizarPaletaUI(paleta) {
  hudPaleta.innerHTML = "";

  paleta.forEach(({ r, g, b }) => {
    const hex = rgbAHex(r, g, b);

    const item = document.createElement("div");
    item.className = "hud-swatch-item";

    const chip = document.createElement("span");
    chip.className = "hud-swatch";
    chip.style.background = hex;

    const etiqueta = document.createElement("span");
    etiqueta.textContent = hex;

    item.appendChild(chip);
    item.appendChild(etiqueta);
    hudPaleta.appendChild(item);
  });
}

// ======================================================
// 10 — INTERFAZ
// ======================================================

const parametrosEnteros = ["resolucion"];

const controles = {
  resolucion: document.querySelector("#resolucion"),
  tamanioParticula: document.querySelector("#tamanio-particula"),
  espaciado: document.querySelector("#espaciado"),
  profundidad: document.querySelector("#profundidad"),
  especularidad: document.querySelector("#especularidad"),
  saturacion: document.querySelector("#saturacion"),
  distorsion: document.querySelector("#distorsion"),
  glitch: document.querySelector("#glitch"),
  audioFuerza: document.querySelector("#audio-fuerza"),
};

const valoresVisibles = {
  resolucion: document.querySelector("#resolucion-valor"),
  tamanioParticula: document.querySelector("#tamanio-particula-valor"),
  espaciado: document.querySelector("#espaciado-valor"),
  profundidad: document.querySelector("#profundidad-valor"),
  especularidad: document.querySelector("#especularidad-valor"),
  saturacion: document.querySelector("#saturacion-valor"),
  distorsion: document.querySelector("#distorsion-valor"),
  glitch: document.querySelector("#glitch-valor"),
  audioFuerza: document.querySelector("#audio-fuerza-valor"),
};

const controlImagenInput = document.querySelector("#imagen-input");
const mensajeInicial = document.querySelector("#mensaje-inicial");

const controlColoresPersonalizadosActivo = document.querySelector("#colores-personalizados-activo");
const panelColoresPersonalizados = document.querySelector("#paleta-personalizada");
const controlesColoresPersonalizados = [
  document.querySelector("#color-personalizado-1"),
  document.querySelector("#color-personalizado-2"),
  document.querySelector("#color-personalizado-3"),
  document.querySelector("#color-personalizado-4"),
];

const controlCamaraActivar = document.querySelector("#camara-activar");
const controlCamaraDetener = document.querySelector("#camara-detener");
const panelCamara = document.querySelector("#panel-camara");
const videoCamara = document.querySelector("#camara-video");
const salidaCamaraEstado = document.querySelector("#camara-estado");

const controlAudioActivar = document.querySelector("#audio-activar");
const salidaAudioEstado = document.querySelector("#audio-estado");
const salidaAudioNivel = document.querySelector("#audio-nivel");

const hudPaleta = document.querySelector("#hud-paleta");
const salidaDecibeles = document.querySelector("#hud-decibeles");

function actualizarParametro(nombre, valor) {
  parametros[nombre] = parametrosEnteros.includes(nombre)
    ? Number.parseInt(valor, 10)
    : Number.parseFloat(valor);

  valoresVisibles[nombre].value = parametrosEnteros.includes(nombre)
    ? parametros[nombre]
    : parametros[nombre].toFixed(2);

  if (nombre === "resolucion" && imagenActual) {
    procesarImagen(imagenActual);
  }

  generarCampo();
}

Object.entries(controles).forEach(([nombre, control]) => {
  control.addEventListener("input", (event) => {
    actualizarParametro(nombre, event.target.value);
  });
});

controlImagenInput.addEventListener("change", (evento) => {
  const archivo = evento.target.files[0];
  if (!archivo) return;

  mensajeInicial.classList.add("oculto"); // se elige la opción: el aviso ya no aplica
  cargarImagen(archivo);
});

controlColoresPersonalizadosActivo.addEventListener("change", (evento) => {
  parametros.coloresPersonalizadosActivo = evento.target.checked;
  panelColoresPersonalizados.classList.toggle("oculto", !evento.target.checked);
  generarCampo();
});

controlesColoresPersonalizados.forEach((control, indice) => {
  control.addEventListener("input", (evento) => {
    coloresPersonalizados[indice].set(evento.target.value);
    generarCampo();
  });
});

controlCamaraActivar.addEventListener("click", () => activarCamara());
controlCamaraDetener.addEventListener("click", () => detenerCamara());

controlAudioActivar.addEventListener("click", () => {
  if (parametros.audioActivo) {
    detenerAudio();
  } else {
    activarAudio();
  }
});

document.querySelector("#nuevo-glitch").addEventListener("click", () => {
  parametros.glitchSemilla = Math.floor(Math.random() * 1000) + 1;
  generarCampo();
});

document.querySelector("#restablecer").addEventListener("click", () => {
  Object.assign(parametros, valoresIniciales);

  Object.entries(controles).forEach(([nombre, control]) => {
    control.value = parametros[nombre];

    valoresVisibles[nombre].value = parametrosEnteros.includes(nombre)
      ? parametros[nombre]
      : parametros[nombre].toFixed(2);
  });

  controlColoresPersonalizadosActivo.checked = parametros.coloresPersonalizadosActivo;
  panelColoresPersonalizados.classList.add("oculto");

  coloresPersonalizadosInicial.forEach((hex, indice) => {
    coloresPersonalizados[indice].set(hex);
    controlesColoresPersonalizados[indice].value = hex;
  });

  detenerAudio();
  detenerCamara();

  if (imagenActual) {
    procesarImagen(imagenActual);
  }

  generarCampo();
});

// ======================================================
// 11 — BUCLE DE ANIMACIÓN
// ======================================================

const reloj = new THREE.Clock();

function animar() {
  requestAnimationFrame(animar);

  const tiempo = reloj.getElapsedTime();

  actualizarCampoEnVivo(tiempo);
  actualizarNivelAudio();
  aplicarMovimientoAudio(tiempo);

  controlesOrbita.update();
  renderer.render(escena, camara);
}

function ajustarVentana() {
  const ancho = viewport.clientWidth;
  const altura = viewport.clientHeight;

  camara.aspect = ancho / altura;
  camara.updateProjectionMatrix();

  renderer.setSize(ancho, altura);
}

window.addEventListener("resize", ajustarVentana);

animar();

/* ============================================================
   Desnaturalización IA — DECART
   Hibridación: sensores del instrumento ESP32 (MQTT / USB / demo)
   -> triangulación afectiva (valencia × activación)
   -> prompt -> Decart realtime video restyle.

   Sin API key de Decart el sistema corre en MODO SIMULACIÓN: muestra
   la cámara cruda y el prompt que se enviaría, sin transformar la imagen.

   Estructura:
   01 — CONFIGURACIÓN
   02 — ESCENA (cámara + video de salida)
   03 — CONEXIÓN MQTT (sensores)
   03b — CONEXIÓN USB / Web Serial (sensores, sin MQTT)
   04 — MAPA AFECTIVO (carga del JSON + triangulación)
   05 — PROCESAR MENSAJE (sensor -> estado afectivo -> prompt deseado)
   06 — MODO DEMOSTRACIÓN (rango completo de movimiento)
   07 — DECART (cliente realtime + envío de prompt con rate-limit)
   08 — INTERFAZ + LOG + circumplejo
   09 — CAPTURA DE SECUENCIA (30 s)
   10 — LOOP (título + scheduler de prompt + render del plot)
   ============================================================ */

/* ---------------------------------------------------------- */
/* 01 — CONFIGURACIÓN                                          */
/* ---------------------------------------------------------- */

const CONFIG = {
  // Ventana (ms) sobre la que se promedia la frecuencia de cambios bruscos
  // para alimentar la activación.
  ventanaBruscoMs: 5000,
  bruscoRateSaturacion: 4, // nº de bruscos en la ventana que ya cuenta como "1.0"
  // Suavizado exponencial de valencia/activación (0-1; más bajo = más inercia).
  suavizadoAfectivo: 0.12,
  // Modelo realtime de Decart.
  modeloDecart: "lucy-latest",
};

const estado = {
  // conexión de sensores
  mqttClient: null,
  serialPort: null,
  conectado: false,
  modoDemo: false,

  // vector de movimiento (rango completo, con signo en los dos ejes)
  inclinacion: 0,   // eje Y del ADXL345 (-90 a 90). + = atrás, - = adelante
  inclinacionX: 0,  // eje X del ADXL345 (-90 a 90). + = derecha, - = izquierda
  movMagnitud: 0,   // 0-90, |vector (X,Y)|
  movAngulo: 0,     // 0-360°, dirección del vector

  cambioBrusco: false,
  bruscoTimestamps: [], // performance.now() de cada cambio brusco reciente

  controlValor: 0,  // potenciómetro/SoftPot 0-100
  colorHex: null,
  colorDominante: "—",

  // punto afectivo (suavizado)
  valencia: 0,      // -1 a 1
  activacion: 0,    // 0 a 1
  estadoAfectivo: null, // objeto del mapa_afectivo.json

  // Decart
  decartClient: null,
  decartConectado: false,
  promptDeseado: "",
  promptEnviado: "",
  ultimoEnvioPrompt: 0,
};

/* ---------------------------------------------------------- */
/* 02 — ESCENA (cámara + video de salida)                      */
/* ---------------------------------------------------------- */

const videoCam = document.getElementById("video-cam");
const videoOut = document.getElementById("video-out");
const stageTitle = document.getElementById("stage-title");

let camStream = null;

async function activarCamara() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, frameRate: 25 },
      audio: false,
    });
    camStream = stream;
    videoCam.srcObject = stream;
    await videoCam.play().catch(() => {});
    // Mientras Decart no esté conectado, la salida ES la cámara cruda (espejada).
    if (!estado.decartConectado) {
      videoOut.srcObject = stream;
      videoOut.classList.add("espejo");
      videoOut.play().catch(() => {});
    }
    log("Cámara activada.");
  } catch (err) {
    log("No se pudo acceder a la cámara: " + err.message, true);
  }
}

document.getElementById("btn-webcam").addEventListener("click", activarCamara);

/* ---------------------------------------------------------- */
/* 03 — CONEXIÓN MQTT (sensores)                               */
/* ---------------------------------------------------------- */

function conectarMQTT() {
  const host = document.getElementById("in-host").value.trim();
  const port = document.getElementById("in-port").value.trim() || "8084";
  const user = document.getElementById("in-user").value.trim();
  const pass = document.getElementById("in-pass").value;
  const topic = document.getElementById("in-topic").value.trim();

  if (!host || !topic) {
    log("Falta host o topic para conectar.", true);
    return;
  }

  const url = `wss://${host}:${port}/mqtt`;
  const clientId = "web-decart-" + Math.random().toString(16).slice(2, 8);

  setEstadoConexion("conectando");
  log(`Conectando a ${url} como ${clientId}…`);

  const client = mqtt.connect(url, {
    clientId,
    username: user || undefined,
    password: pass || undefined,
    reconnectPeriod: 4000,
    connectTimeout: 8000,
  });

  client.on("connect", () => {
    estado.conectado = true;
    setEstadoConexion("conectado");
    log("Conectado. Suscribiendo a: " + topic);
    client.subscribe(topic, (err) => {
      if (err) log("Error al suscribirse: " + err.message, true);
    });
  });

  client.on("reconnect", () => setEstadoConexion("conectando"));
  client.on("close", () => { estado.conectado = false; setEstadoConexion("desconectado"); });
  client.on("error", (err) => {
    log("Error MQTT: " + err.message, true);
    setEstadoConexion("error");
  });
  client.on("message", (_topic, payload) => {
    try {
      procesarMensaje(JSON.parse(payload.toString()));
    } catch (err) {
      log("Mensaje no interpretable como JSON: " + payload.toString(), true);
    }
  });

  estado.mqttClient = client;
}

document.getElementById("btn-connect").addEventListener("click", () => {
  estado.modoDemo = false;
  detenerDemo();
  conectarMQTT();
});

/* ---------------------------------------------------------- */
/* 03b — CONEXIÓN USB / Web Serial (sensores, sin MQTT)         */
/* ---------------------------------------------------------- */

async function conectarSerial() {
  if (!("serial" in navigator)) {
    log("Este navegador no soporta Web Serial. Usa Chrome o Edge en computador.", true);
    return;
  }
  if (estado.mqttClient) { estado.mqttClient.end(true); estado.mqttClient = null; }
  estado.modoDemo = false;
  detenerDemo();

  try {
    estado.serialPort = await navigator.serial.requestPort();
    await estado.serialPort.open({ baudRate: 115200 });
    estado.conectado = true;
    setEstadoConexion("conectado");
    log("Conectado por USB/Serial. Si no llegan datos, cierra el Monitor Serie de Arduino IDE.");
    leerSerial();
  } catch (err) {
    log("No se pudo abrir el puerto serial: " + err.message, true);
  }
}

async function leerSerial() {
  const textDecoder = new TextDecoderStream();
  estado.serialPort.readable.pipeTo(textDecoder.writable);
  const reader = textDecoder.readable.getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const linea = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!linea) continue;
        try { procesarMensaje(JSON.parse(linea)); } catch (e) { /* línea de debug del ESP32, no JSON */ }
      }
    }
  } catch (err) {
    log("Conexión serial perdida: " + err.message, true);
    estado.conectado = false;
    setEstadoConexion("desconectado");
  } finally {
    reader.releaseLock();
  }
}

document.getElementById("btn-serial").addEventListener("click", conectarSerial);

function setEstadoConexion(estadoTexto) {
  const el = document.getElementById("estado-conexion");
  el.classList.remove("badge-off", "badge-on", "badge-error");
  const textos = {
    desconectado: ["Desconectado", "badge-off"],
    conectando: ["Conectando…", "badge-off"],
    conectado: ["Conectado ✓", "badge-on"],
    error: ["Error de conexión", "badge-error"],
    demo: ["Modo demostración", "badge-on"],
  };
  const [texto, clase] = textos[estadoTexto] || textos.desconectado;
  el.textContent = texto;
  el.classList.add(clase);
  const triggerEstado = document.getElementById("trigger-estado-conexion");
  if (triggerEstado) triggerEstado.textContent = texto.replace(" ✓", "");
}

/* ---------------------------------------------------------- */
/* 04 — MAPA AFECTIVO (carga del JSON + triangulación)          */
/*                                                                */
/* El JSON no clasifica con IA: es una tabla declarativa. Acá se   */
/* proyecta el vector de sensores a un punto (valencia, activación) */
/* y se elige el estado cuyo centro queda más cerca, con histéresis.*/
/* ---------------------------------------------------------- */

let mapa = null;

const MAPA_FALLBACK = {
  ejes: {
    activacion: { pesos: { tiltMag: 0.5, control: 0.3, cambioBruscoRate: 0.2 } },
    valencia: { pesos: { colorHue: 0.7, tiltVertical: 0.3 } },
  },
  color_a_valencia: {
    anclas: [
      { hue: 0, valencia: -0.7 }, { hue: 45, valencia: 0.4 }, { hue: 90, valencia: 0.7 },
      { hue: 180, valencia: 0.2 }, { hue: 240, valencia: -0.4 }, { hue: 300, valencia: -0.2 },
      { hue: 360, valencia: -0.7 },
    ],
    sin_color: 0,
  },
  estados: [
    { id: "calma", etiqueta: "CALMA", centro: { valencia: 0.6, activacion: 0.15 }, region: { valencia: [0.2, 1], activacion: [0, 0.32] }, prompt: "retrato sereno, luz difusa, niebla suave", modificador_intensidad: "contemplativo" },
    { id: "melancolia", etiqueta: "MELANCOLIA", centro: { valencia: -0.55, activacion: 0.2 }, region: { valencia: [-1, -0.15], activacion: [0, 0.38] }, prompt: "retrato pensativo, luz fría, desaturado, azulado", modificador_intensidad: "introspectivo" },
    { id: "disociacion", etiqueta: "DISOCIACION", centro: { valencia: 0, activacion: 0.5 }, region: { valencia: [-0.25, 0.25], activacion: [0.3, 0.7] }, prompt: "retrato fragmentado, doble exposición, desenfoque parcial", modificador_intensidad: "a la deriva" },
    { id: "tension", etiqueta: "TENSION", centro: { valencia: -0.6, activacion: 0.8 }, region: { valencia: [-1, -0.2], activacion: [0.55, 1] }, prompt: "retrato crispado, contraste duro, aberración cromática, rojos saturados", modificador_intensidad: "al límite" },
    { id: "euforia", etiqueta: "EUFORIA", centro: { valencia: 0.6, activacion: 0.85 }, region: { valencia: [0.2, 1], activacion: [0.6, 1] }, prompt: "retrato incandescente, luz que pulsa, colores fundidos, estelas de movimiento", modificador_intensidad: "sin freno" },
  ],
  prompt_base: "video restyle de una persona frente a cámara, encuadre de retrato, {estado}, {intensidad}, coherencia temporal alta",
  transicion: { min_ms_entre_prompts: 1800, histeresis: 0.14 },
};

async function cargarMapa() {
  try {
    const res = await fetch("mapa_afectivo.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    mapa = await res.json();
    log(`Mapa afectivo cargado (${mapa.version || "sin versión"}): ${mapa.estados.length} estados.`);
  } catch (err) {
    mapa = MAPA_FALLBACK;
    log("No se pudo cargar mapa_afectivo.json (" + err.message + "). Uso el mapa por defecto embebido.", true);
  }
  dibujarPlotBase();
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = (v) => clamp(v, 0, 1);

function hexAHsl(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  let r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

function colorAValencia(colorHex) {
  const cfg = mapa.color_a_valencia;
  if (!colorHex) return cfg.sin_color ?? 0;
  const { h, s } = hexAHsl(colorHex);
  if (s < 0.12) return cfg.sin_color ?? 0; // gris: sin carga afectiva de color
  const anclas = cfg.anclas;
  for (let i = 0; i < anclas.length - 1; i++) {
    const a = anclas[i], b = anclas[i + 1];
    if (h >= a.hue && h <= b.hue) {
      const t = (h - a.hue) / (b.hue - a.hue || 1);
      return a.valencia + (b.valencia - a.valencia) * t;
    }
  }
  return anclas[anclas.length - 1].valencia;
}

function bruscoRate() {
  const ahora = performance.now();
  estado.bruscoTimestamps = estado.bruscoTimestamps.filter((t) => ahora - t < CONFIG.ventanaBruscoMs);
  return clamp01(estado.bruscoTimestamps.length / CONFIG.bruscoRateSaturacion);
}

function vectorMovimiento(incX, incY) {
  const mag = Math.min(90, Math.hypot(incX, incY));
  let ang = Math.atan2(incY, incX) * 180 / Math.PI;
  if (ang < 0) ang += 360;
  return { mag, ang };
}

const DIRECCIONES = ["derecha", "der-atrás", "atrás", "izq-atrás", "izquierda", "izq-adelante", "adelante", "der-adelante"];
function etiquetaDireccion(ang, mag) {
  if (mag < 4) return "centro";
  return DIRECCIONES[Math.round(ang / 45) % 8];
}

// Proyecta el estado de sensores actual a (valencia, activación) crudos.
function triangular() {
  const { mag, ang } = vectorMovimiento(estado.inclinacionX, estado.inclinacion);
  estado.movMagnitud = mag;
  estado.movAngulo = ang;

  const wa = mapa.ejes.activacion.pesos;
  const activacionCruda = clamp01(
    (mag / 90) * wa.tiltMag +
    clamp01(estado.controlValor / 100) * wa.control +
    bruscoRate() * wa.cambioBruscoRate
  );

  const wv = mapa.ejes.valencia.pesos;
  const valenciaCruda = clamp(
    colorAValencia(estado.colorHex) * wv.colorHue +
    clamp(estado.inclinacion / 90, -1, 1) * wv.tiltVertical,
    -1, 1
  );

  return { valenciaCruda, activacionCruda };
}

// Elige el estado del mapa por cercanía al centro, con histéresis: no cambia
// hasta que el nuevo candidato quede más cerca que el actual por > histéresis.
// El eje de activación se pondera x2 en la distancia (es el rango 0-1 vs -1..1).
function elegirEstado(valencia, activacion) {
  const dist = (e) => Math.hypot(valencia - e.centro.valencia, (activacion - e.centro.activacion) * 2);
  let mejor = mapa.estados[0], mejorD = dist(mejor);
  for (const e of mapa.estados) {
    const d = dist(e);
    if (d < mejorD) { mejorD = d; mejor = e; }
  }
  if (estado.estadoAfectivo && mejor.id !== estado.estadoAfectivo.id) {
    const dActual = dist(estado.estadoAfectivo);
    if (dActual - mejorD < (mapa.transicion.histeresis || 0.14)) return estado.estadoAfectivo;
  }
  return mejor;
}

function componerPrompt(est, activacion) {
  const intensidad = activacion > 0.66
    ? est.modificador_intensidad
    : activacion > 0.33 ? "presente pero contenido" : "apenas insinuado";
  const userBase = document.getElementById("in-prompt-base").value.trim();
  if (userBase) {
    return `${userBase}, ${est.prompt}, ${intensidad}, coherencia temporal alta`;
  }
  return (mapa.prompt_base || MAPA_FALLBACK.prompt_base)
    .replace("{estado}", est.prompt)
    .replace("{intensidad}", intensidad)
    .replace(/\s+,/g, ",")
    .trim();
}

/* ---------------------------------------------------------- */
/* 05 — PROCESAR MENSAJE                                        */
/*                                                                */
/* Payload esperado (ver DENAT_IA/DENAT_IA.ino):                   */
/*  { "inclinacionX": -12.4, "inclinacion": 42.1, "cambioBrusco": false, */
/*    "colorHex": "#B62821", "colorDominante": "rojo", "controlValor": 63 } */
/* Se usa el rango COMPLETO de inclinación en los dos ejes (con signo),  */
/* no solo su magnitud.                                                  */
/* ---------------------------------------------------------- */

function procesarMensaje(m) {
  estado.inclinacion = Number(m.inclinacion) || 0;
  estado.inclinacionX = Number(m.inclinacionX) || 0;
  estado.cambioBrusco = !!m.cambioBrusco;
  if (estado.cambioBrusco) estado.bruscoTimestamps.push(performance.now());
  estado.controlValor = clamp(Number(m.controlValor) || 0, 0, 100);
  estado.colorHex = typeof m.colorHex === "string" ? m.colorHex : null;
  estado.colorDominante = m.colorDominante || "—";

  const { valenciaCruda, activacionCruda } = triangular();
  // suavizado exponencial: el estilo del video no debe saltar frame a frame
  const k = CONFIG.suavizadoAfectivo;
  estado.valencia += (valenciaCruda - estado.valencia) * k;
  estado.activacion += (activacionCruda - estado.activacion) * k;

  const est = elegirEstado(estado.valencia, estado.activacion);
  const cambioEstado = !estado.estadoAfectivo || est.id !== estado.estadoAfectivo.id;
  estado.estadoAfectivo = est;
  estado.promptDeseado = componerPrompt(est, estado.activacion);

  actualizarReadout();

  if (cambioEstado) {
    log(
      `mov=${estado.movMagnitud.toFixed(0)}° ${etiquetaDireccion(estado.movAngulo, estado.movMagnitud)} · ` +
      `val=${estado.valencia.toFixed(2)} activ=${estado.activacion.toFixed(2)} → ESTADO: ${est.etiqueta}`,
      false, true
    );
  }

  if (captura.activa) {
    captura.muestras.push({
      t: Number(((performance.now() - captura.inicio) / 1000).toFixed(2)),
      mag: Number(estado.movMagnitud.toFixed(1)),
      ang: Number(estado.movAngulo.toFixed(0)),
      valencia: Number(estado.valencia.toFixed(3)),
      activacion: Number(estado.activacion.toFixed(3)),
      estado: est.id,
      cambioBrusco: estado.cambioBrusco,
      colorHex: estado.colorHex,
    });
  }
}

/* ---------------------------------------------------------- */
/* 06 — MODO DEMOSTRACIÓN (rango completo de movimiento)        */
/*                                                                */
/* Camina los dos ejes de inclinación de forma independiente por  */
/* todo el rango -85..85, para ejercitar la triangulación completa */
/* (adelante/atrás/izquierda/derecha), no solo la magnitud.        */
/* ---------------------------------------------------------- */

let demoInterval = null;

const COLORES_DEMO = [
  { hex: "#B62821", dominante: "rojo" },
  { hex: "#C98A22", dominante: "ámbar" },
  { hex: "#2E9E5B", dominante: "verde" },
  { hex: "#2B6FD9", dominante: "azul" },
  { hex: "#9A9A96", dominante: "equilibrado" },
];

function iniciarModoDemo() {
  if (estado.mqttClient) { estado.mqttClient.end(true); estado.mqttClient = null; }
  estado.modoDemo = true;
  setEstadoConexion("demo");
  log("Modo demostración: recorre el rango completo de inclinación en los dos ejes.");

  let incX = 0, incY = 0, control = 40, colorIdx = 0;
  if (demoInterval) clearInterval(demoInterval);
  demoInterval = setInterval(() => {
    incX += (Math.random() - 0.5) * 14;
    incY += (Math.random() - 0.5) * 14;
    incX = clamp(incX, -85, 85);
    incY = clamp(incY, -85, 85);

    const cambioBrusco = Math.random() < 0.06;
    if (cambioBrusco) {
      incX = clamp(incX + (Math.random() - 0.5) * 90, -85, 85);
      incY = clamp(incY + (Math.random() - 0.5) * 90, -85, 85);
    }

    control = clamp(control + (Math.random() - 0.5) * 8, 0, 100);
    if (Math.random() < 0.03) colorIdx = (colorIdx + 1) % COLORES_DEMO.length;
    const color = COLORES_DEMO[colorIdx];

    procesarMensaje({
      inclinacionX: incX,
      inclinacion: incY,
      cambioBrusco,
      colorHex: color.hex,
      colorDominante: color.dominante,
      controlValor: control,
    });
  }, 320);
}

function detenerDemo() {
  if (demoInterval) { clearInterval(demoInterval); demoInterval = null; }
  estado.modoDemo = false;
}

document.getElementById("btn-demo").addEventListener("click", iniciarModoDemo);
document.getElementById("btn-demo-panel").addEventListener("click", iniciarModoDemo);

/* ---------------------------------------------------------- */
/* 07 — DECART (cliente realtime + envío de prompt)             */
/*                                                                */
/* Igual que prueba_decart: import ESM por CDN (nunca probado de  */
/* punta a punta). Si algo falla, el sistema sigue en simulación.  */
/* ---------------------------------------------------------- */

function setEstadoDecart(texto, clase) {
  const el = document.getElementById("estado-decart");
  el.classList.remove("badge-off", "badge-on", "badge-error");
  el.classList.add(clase);
  el.textContent = texto;
  const trig = document.getElementById("trigger-estado-decart");
  if (trig) trig.textContent = clase === "badge-on" ? "En vivo" : clase === "badge-error" ? "Error" : "Simulación";
}

async function conectarDecart() {
  const apiKey = document.getElementById("in-apikey").value.trim();
  if (!apiKey) { log("Falta la API key de Decart. El sistema sigue en simulación.", true); return; }
  if (!camStream) { log("Activa la cámara (02) antes de conectar Decart.", true); return; }

  setEstadoDecart("Conectando…", "badge-off");
  log("Cargando SDK de Decart desde CDN…");

  let createDecartClient, models;
  try {
    ({ createDecartClient, models } = await import("https://cdn.jsdelivr.net/npm/@decartai/sdk/+esm"));
  } catch (err) {
    setEstadoDecart("SDK no disponible", "badge-error");
    log("No se pudo cargar @decartai/sdk desde CDN: " + err.message + ". El sistema sigue en simulación.", true);
    return;
  }

  try {
    const model = models.realtime(CONFIG.modeloDecart);
    const client = createDecartClient({ apiKey });
    const inicial = estado.promptDeseado || document.getElementById("in-prompt-base").value.trim() || "retrato, luz neutra";

    estado.decartClient = await client.realtime.connect(camStream, {
      model,
      onRemoteStream: (remoteStream) => {
        videoOut.srcObject = remoteStream;
        videoOut.classList.remove("espejo");
        videoOut.play().catch(() => {});
        log("Llegó el stream transformado de Decart.");
      },
      initialState: { prompt: { text: inicial } },
    });

    estado.decartConectado = true;
    estado.promptEnviado = inicial;
    estado.ultimoEnvioPrompt = performance.now();
    setEstadoDecart("En vivo ✓", "badge-on");
    log(`Decart conectado. Prompt inicial: "${inicial}"`);
  } catch (err) {
    setEstadoDecart("Error de conexión", "badge-error");
    log("Error al conectar con Decart: " + err.message + ". El sistema sigue en simulación.", true);
  }
}

document.getElementById("btn-decart").addEventListener("click", conectarDecart);

// Rate-limit: manda el prompt deseado a Decart (o solo lo "confirma" en
// simulación) como mucho 1 vez cada min_ms_entre_prompts, y solo si cambió.
async function tickPrompt() {
  if (!mapa || !estado.promptDeseado) return;
  const ahora = performance.now();
  const minMs = (mapa.transicion && mapa.transicion.min_ms_entre_prompts) || 1800;
  if (ahora - estado.ultimoEnvioPrompt < minMs) return;
  if (estado.promptDeseado === estado.promptEnviado) return;

  estado.ultimoEnvioPrompt = ahora;
  const prompt = estado.promptDeseado;

  if (estado.decartConectado && estado.decartClient) {
    try {
      await estado.decartClient.setPrompt(prompt);
      estado.promptEnviado = prompt;
      log(`→ Decart: "${prompt}"`);
    } catch (err) {
      log("Error al actualizar el prompt en Decart: " + err.message, true);
    }
  } else {
    // simulación: solo se registra lo que se enviaría
    estado.promptEnviado = prompt;
    log(`→ (simulación) "${prompt}"`);
  }
}

/* ---------------------------------------------------------- */
/* 08 — INTERFAZ + LOG + circumplejo                            */
/* ---------------------------------------------------------- */

const SVG_NS = "http://www.w3.org/2000/svg";
const plot = document.getElementById("plot-afectivo");
let plotPunto = null, plotHalo = null, plotRegiones = [];

// valencia -1..1 -> x 0..200 ; activacion 0..1 -> y 200..0 (activación alta arriba)
const px = (v) => (v + 1) * 100;
const py = (a) => 200 - a * 200;

function crearSvg(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function dibujarPlotBase() {
  plot.innerHTML = "";
  plotRegiones = [];

  // regiones de cada estado (rectángulos)
  (mapa.estados || []).forEach((e) => {
    if (!e.region) return;
    const x0 = px(e.region.valencia[0]);
    const x1 = px(e.region.valencia[1]);
    const y0 = py(e.region.activacion[1]);
    const y1 = py(e.region.activacion[0]);
    const rect = crearSvg("rect", {
      x: Math.min(x0, x1), y: Math.min(y0, y1),
      width: Math.abs(x1 - x0), height: Math.abs(y1 - y0),
      class: "plot-region", "data-estado": e.id,
    });
    plot.appendChild(rect);
    plotRegiones.push(rect);
    plot.appendChild(crearSvg("text", {
      x: px(e.centro.valencia), y: py(e.centro.activacion) - 2,
      "text-anchor": "middle", class: "plot-region-label",
    })).textContent = e.etiqueta;
  });

  // ejes
  plot.appendChild(crearSvg("line", { x1: 100, y1: 0, x2: 100, y2: 200, class: "plot-eje" }));
  plot.appendChild(crearSvg("line", { x1: 0, y1: 100, x2: 200, y2: 100, class: "plot-eje" }));
  plot.appendChild(crearSvg("text", { x: 197, y: 112, "text-anchor": "end", class: "plot-eje-label" })).textContent = "+ valencia";
  plot.appendChild(crearSvg("text", { x: 3, y: 112, class: "plot-eje-label" })).textContent = "− val";
  plot.appendChild(crearSvg("text", { x: 103, y: 9, class: "plot-eje-label" })).textContent = "+ activación";

  plotHalo = crearSvg("circle", { cx: 100, cy: 100, r: 9, class: "plot-punto-halo" });
  plotPunto = crearSvg("circle", { cx: 100, cy: 100, r: 4, class: "plot-punto" });
  plot.appendChild(plotHalo);
  plot.appendChild(plotPunto);
}

function renderPlot() {
  if (!plotPunto) return;
  const x = px(estado.valencia), y = py(estado.activacion);
  plotPunto.setAttribute("cx", x.toFixed(1));
  plotPunto.setAttribute("cy", y.toFixed(1));
  plotHalo.setAttribute("cx", x.toFixed(1));
  plotHalo.setAttribute("cy", y.toFixed(1));

  const activoId = estado.estadoAfectivo && estado.estadoAfectivo.id;
  plotRegiones.forEach((r) => {
    r.classList.toggle("plot-region-activa", r.getAttribute("data-estado") === activoId);
  });

  const label = document.getElementById("plot-estado-label");
  const ref = document.getElementById("plot-prompt-ref");
  const trig = document.getElementById("trigger-estado-afectivo");
  if (estado.estadoAfectivo) {
    label.textContent = "ESTADO — " + estado.estadoAfectivo.etiqueta;
    ref.textContent = estado.promptEnviado || estado.promptDeseado || "…";
    if (trig) trig.textContent = estado.estadoAfectivo.etiqueta;
  }
}

function actualizarReadout() {
  document.getElementById("stat-tilt-mag").textContent = estado.movMagnitud.toFixed(0) + "°";
  document.getElementById("stat-tilt-ang").textContent = etiquetaDireccion(estado.movAngulo, estado.movMagnitud);
  document.getElementById("stat-activacion").textContent = estado.activacion.toFixed(2);
  document.getElementById("stat-valencia").textContent = (estado.valencia >= 0 ? "+" : "") + estado.valencia.toFixed(2);
  document.getElementById("stat-color").textContent = estado.colorDominante;
  const sw = document.getElementById("swatch-color");
  if (sw) sw.style.background = estado.colorHex || "transparent";
  document.getElementById("stat-estado").textContent = estado.estadoAfectivo ? estado.estadoAfectivo.etiqueta : "—";
  document.getElementById("stat-prompt").textContent = estado.promptDeseado || "Sistema listo";
}

/* menús desplegables */
const menuTriggers = Array.from(document.querySelectorAll(".menu-trigger[data-target]"));
const dataWindow = document.getElementById("data-window");

function cerrarMenus(excepto) {
  menuTriggers.forEach((btn) => {
    if (btn === excepto) return;
    btn.setAttribute("aria-expanded", "false");
    const panel = document.getElementById(btn.dataset.target);
    if (panel) panel.hidden = true;
  });
}
function actualizarVisibilidadVentana() {
  if (!dataWindow) return;
  const alguno = menuTriggers.some((b) => b.getAttribute("aria-expanded") === "true");
  dataWindow.classList.toggle("oculta-por-menu", alguno);
}
menuTriggers.forEach((btn) => {
  const panel = document.getElementById(btn.dataset.target);
  if (!panel) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const abierto = btn.getAttribute("aria-expanded") === "true";
    cerrarMenus(btn);
    btn.setAttribute("aria-expanded", String(!abierto));
    panel.hidden = abierto;
    actualizarVisibilidadVentana();
  });
});
document.addEventListener("click", (e) => {
  if (e.target.closest(".menu-item")) return;
  cerrarMenus(null);
  actualizarVisibilidadVentana();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { cerrarMenus(null); actualizarVisibilidadVentana(); }
});

/* ventana de estado: minimizar + posición bajo el dock */
const menuDock = document.querySelector(".menu-dock");
document.getElementById("data-window-toggle").addEventListener("click", () => {
  const min = dataWindow.classList.toggle("minimizado");
  const t = document.getElementById("data-window-toggle");
  t.textContent = min ? "▢" : "–";
  t.setAttribute("aria-label", min ? "Expandir ventana" : "Minimizar ventana");
});
function posicionarVentanaBajoDock() {
  if (!menuDock || !dataWindow) return;
  const barH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bar-h")) || 34;
  const rect = menuDock.getBoundingClientRect();
  dataWindow.style.top = Math.round(rect.bottom + 10) + "px";
  dataWindow.style.maxHeight = Math.max(120, window.innerHeight - rect.bottom - barH - 16) + "px";
}
window.addEventListener("resize", posicionarVentanaBajoDock);

function log(texto, esError = false, esPico = false) {
  const linea = document.createElement("div");
  linea.textContent = `[${new Date().toLocaleTimeString()}] ${texto}`;
  if (esError) linea.classList.add("error");
  if (esPico) linea.classList.add("pico");
  const cont = document.getElementById("log");
  cont.appendChild(linea);
  while (cont.childNodes.length > 200) cont.removeChild(cont.firstChild);
}

/* ---------------------------------------------------------- */
/* 09 — CAPTURA DE SECUENCIA (30 s)                             */
/* ---------------------------------------------------------- */

const CAPTURA_DURACION_MS = 30000;
const captura = { activa: false, inicio: 0, muestras: [], mediaRecorder: null, chunks: [], timeoutId: null, rafId: null };

const btnCapturar = document.getElementById("btn-capturar");
const capturaProgresoMini = document.getElementById("capture-progreso-mini");
const capturaProgresoFill = document.getElementById("captura-progreso-fill");
const capturaTiempoEl = document.getElementById("captura-tiempo");
const capturaResultadoEl = document.getElementById("captura-resultado");
const capturaEstadoEl = document.getElementById("capture-estado");

function fmt(ms) { return "00:" + String(Math.min(30, Math.floor(ms / 1000))).padStart(2, "0"); }

function progresoCaptura() {
  if (!captura.activa) return;
  const t = performance.now() - captura.inicio;
  capturaProgresoFill.style.width = Math.min(100, (t / CAPTURA_DURACION_MS) * 100) + "%";
  capturaTiempoEl.textContent = `${fmt(t)} / 00:30`;
  captura.rafId = requestAnimationFrame(progresoCaptura);
}

function iniciarCaptura() {
  if (captura.activa) return;
  const stream = videoOut.srcObject;
  if (!stream || typeof MediaRecorder === "undefined") {
    log("No hay video de salida para grabar (activa la cámara).", true);
    return;
  }
  captura.activa = true;
  captura.inicio = performance.now();
  captura.muestras = [];
  captura.chunks = [];
  btnCapturar.disabled = true;
  btnCapturar.classList.add("grabando");
  capturaEstadoEl.textContent = "grabando";
  capturaResultadoEl.hidden = true;
  capturaProgresoMini.hidden = false;

  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
    .find((m) => window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m));
  try {
    captura.mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  } catch (err) {
    log("No se pudo iniciar la grabación: " + err.message, true);
    captura.activa = false;
    btnCapturar.disabled = false;
    btnCapturar.classList.remove("grabando");
    capturaProgresoMini.hidden = true;
    capturaEstadoEl.textContent = "inactivo";
    return;
  }
  captura.mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) captura.chunks.push(e.data); };
  captura.mediaRecorder.onstop = finalizarCaptura;
  captura.mediaRecorder.start();
  log("Captura iniciada: 30 s del video de salida + muestras del estado afectivo.");
  progresoCaptura();
  captura.timeoutId = setTimeout(detenerCaptura, CAPTURA_DURACION_MS);
}

function detenerCaptura() {
  if (!captura.activa) return;
  clearTimeout(captura.timeoutId);
  cancelAnimationFrame(captura.rafId);
  captura.activa = false;
  if (captura.mediaRecorder && captura.mediaRecorder.state !== "inactive") captura.mediaRecorder.stop();
}

function descargar(url, nombre) {
  const a = document.createElement("a");
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
}

function finalizarCaptura() {
  btnCapturar.disabled = false;
  btnCapturar.classList.remove("grabando");
  capturaProgresoFill.style.width = "0%";
  capturaTiempoEl.textContent = "00:00 / 00:30";
  capturaProgresoMini.hidden = true;
  capturaEstadoEl.textContent = `${captura.muestras.length} muestras`;

  const tipo = (captura.mediaRecorder && captura.mediaRecorder.mimeType) || "video/webm";
  const blobVideo = new Blob(captura.chunks, { type: tipo });
  const urlVideo = URL.createObjectURL(blobVideo);
  const ext = tipo.includes("webm") ? "webm" : "mp4";

  document.getElementById("btn-descargar-video").onclick = () => descargar(urlVideo, `denat-decart_${Date.now()}.${ext}`);
  document.getElementById("btn-descargar-datos").onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(captura.muestras, null, 2)], { type: "application/json" }));
    descargar(url, `denat-decart_${Date.now()}.json`);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  dibujarChartCaptura(captura.muestras);
  capturaResultadoEl.hidden = false;
  log(`Captura finalizada: ${captura.muestras.length} muestras, video ${(blobVideo.size / 1024).toFixed(0)} KB.`);
}

btnCapturar.addEventListener("click", iniciarCaptura);

function dibujarChartCaptura(muestras) {
  const svg = document.getElementById("captura-chart");
  svg.innerHTML = "";
  if (!muestras.length) return;
  const W = 220, DUR = 30;
  const xDe = (t) => (t / DUR) * W;
  const yDe = (a) => 26 - clamp01(a) * 24;
  const d = muestras.map((m, i) => `${i === 0 ? "M" : "L"} ${xDe(m.t).toFixed(1)} ${yDe(m.activacion).toFixed(1)}`).join(" ");
  svg.appendChild(crearSvg("path", { d, class: "chart-line" }));
  muestras.filter((m) => m.cambioBrusco).forEach((m) => {
    svg.appendChild(crearSvg("line", { x1: xDe(m.t), y1: 2, x2: xDe(m.t), y2: 26, class: "chart-tick" }));
  });
  for (let s = 0; s < DUR; s++) {
    let ultimo = muestras[0];
    for (const m of muestras) { if (m.t > s) break; ultimo = m; }
    svg.appendChild(crearSvg("rect", { x: xDe(s), y: 30, width: xDe(s + 1) - xDe(s), height: 8, fill: ultimo.colorHex || "#2a2a28" }));
  }
}

/* ---------------------------------------------------------- */
/* 10 — LOOP                                                    */
/* ---------------------------------------------------------- */

function loop() {
  const listo = (videoOut.srcObject || videoOut.src) &&
    videoOut.readyState >= 2 && videoOut.videoWidth > 0;
  if (stageTitle) stageTitle.hidden = !!listo;

  tickPrompt();
  renderPlot();

  requestAnimationFrame(loop);
}

cargarMapa();
posicionarVentanaBajoDock();
requestAnimationFrame(loop);
log("Sistema listo. Conecta los sensores (01), la cámara (02) y — opcional — Decart (03). Sin Decart corre en simulación.");

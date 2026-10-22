/* ============================================================
   Prueba aislada — Decart (restyle de video en vivo)
   -----------------------------------------------------------
   NO PROBADO DE PUNTA A PUNTA. Escrito siguiendo la documentación
   oficial (docs.platform.decart.ai), pero el entorno donde se
   construyó este código no tiene acceso de red hacia
   platform.decart.ai / api3.decart.ai, así que la conexión real
   nunca se pudo verificar. Corre esto con tu propia API key y
   avisa qué error aparece en el panel de registro si algo falla.

   Paquete: @decartai/sdk, cargado por CDN (jsdelivr, build ESM)
   ya que no requiere backend propio para esta prueba mínima.
   ============================================================ */

const estado = {
  localStream: null,
  realtimeClient: null,
};

function log(texto, esError = false) {
  const linea = document.createElement("div");
  const hora = new Date().toLocaleTimeString();
  linea.textContent = `[${hora}] ${texto}`;
  if (esError) linea.style.color = "#e05a5a";
  document.getElementById("log").appendChild(linea);
}

function setBadge(id, texto, ok) {
  const el = document.getElementById(id);
  el.textContent = texto;
  el.classList.remove("badge-off", "badge-on", "badge-error");
  el.classList.add(ok === true ? "badge-on" : ok === false ? "badge-error" : "badge-off");
}

document.getElementById("btn-camara").addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 704, frameRate: 25 },
      audio: false,
    });
    estado.localStream = stream;
    document.getElementById("video-local").srcObject = stream;
    setBadge("estado-camara", "Cámara activa", true);
    document.getElementById("btn-conectar").disabled = false;
    log("Cámara activada.");
  } catch (err) {
    setBadge("estado-camara", "Error de cámara", false);
    log("No se pudo activar la cámara: " + err.message, true);
  }
});

document.getElementById("btn-conectar").addEventListener("click", async () => {
  const apiKey = document.getElementById("in-apikey").value.trim();
  const prompt = document.getElementById("in-prompt").value.trim() || "paisaje calmo, niebla suave";

  if (!apiKey) {
    log("Falta la API key.", true);
    return;
  }
  if (!estado.localStream) {
    log("Activa la cámara primero.", true);
    return;
  }

  setBadge("estado-conexion", "Conectando…");
  log("Cargando SDK de Decart desde CDN…");

  let createDecartClient, models;
  try {
    // Import dinámico vía CDN (build ESM auto-generado por jsdelivr para paquetes npm).
    // No confirmado que este paquete específico exponga un build ESM compatible con
    // navegador sin bundler — si esto falla, es el primer punto a revisar.
    ({ createDecartClient, models } = await import(
      "https://cdn.jsdelivr.net/npm/@decartai/sdk/+esm"
    ));
  } catch (err) {
    setBadge("estado-conexion", "Error cargando SDK", false);
    log("No se pudo cargar @decartai/sdk desde CDN: " + err.message, true);
    log("Puede que este paquete necesite un bundler (Vite/esbuild) en vez de <script type=module> directo. Avísame y armamos un mini-build local.", true);
    return;
  }

  try {
    const model = models.realtime("lucy-latest");
    const client = createDecartClient({ apiKey });

    estado.realtimeClient = await client.realtime.connect(estado.localStream, {
      model,
      onRemoteStream: (remoteStream) => {
        document.getElementById("video-remoto").srcObject = remoteStream;
        log("Llegó el stream transformado — debería verse en el panel derecho.");
      },
      initialState: { prompt: { text: prompt } },
    });

    setBadge("estado-conexion", "Conectado ✓", true);
    document.getElementById("btn-actualizar").disabled = false;
    log(`Conectado. Prompt inicial: "${prompt}"`);
  } catch (err) {
    setBadge("estado-conexion", "Error de conexión", false);
    log("Error al conectar con Decart: " + err.message, true);
  }
});

document.getElementById("btn-actualizar").addEventListener("click", async () => {
  const prompt = document.getElementById("in-prompt").value.trim();
  if (!estado.realtimeClient) {
    log("Conéctate primero.", true);
    return;
  }
  if (!prompt) {
    log("Escribe un prompt antes de actualizar.", true);
    return;
  }
  try {
    await estado.realtimeClient.setPrompt(prompt);
    log(`Prompt actualizado en vivo: "${prompt}"`);
  } catch (err) {
    log("Error al actualizar el prompt: " + err.message, true);
  }
});

log("Prueba lista. Activa la cámara, pon tu API key y un prompt, y presiona Conectar.");

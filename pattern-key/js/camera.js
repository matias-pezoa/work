/* ==========================================================
   camera.js — fuentes de video
   - Cámara vía getUserMedia (prefiere cámara trasera en móvil)
   - Archivo de video local (útil para probar sin cámara)
   Todas las fuentes terminan en el mismo <video>, que el render
   loop dibuja en el canvas.
   ========================================================== */

let currentStream = null;

/** Detiene cualquier stream de cámara activo. */
export function stopCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
    currentStream = null;
  }
}

/**
 * Abre la cámara y la conecta al elemento <video>.
 * @param {HTMLVideoElement} video
 * @param {string} [deviceId] cámara concreta (si el usuario eligió una)
 */
export async function startCamera(video, deviceId) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "Este navegador no permite acceder a la cámara. Usa Chrome/Edge/Safari y abre la página desde https:// o localhost."
    );
  }
  stopCamera();

  // 1280×720 es suficiente: la visión por computador trabaja a menor
  // resolución y el render final no necesita más para un MVP.
  const constraints = {
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
  };

  currentStream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = currentStream;
  video.removeAttribute("src");
  video.muted = true;
  video.playsInline = true; // imprescindible en iOS Safari
  await video.play();
  await waitForDimensions(video);
  return currentStream;
}

/** Lista las cámaras disponibles (las etiquetas solo aparecen tras dar permiso). */
export async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput");
}

/** Usa un archivo de video local como fuente (en bucle). */
export async function startVideoFile(video, file) {
  stopCamera();
  video.srcObject = null;
  video.src = URL.createObjectURL(file);
  video.loop = true;
  video.muted = true;
  await video.play();
  await waitForDimensions(video);
}

/** Espera a que el video tenga ancho/alto reales (Safari tarda un poco). */
function waitForDimensions(video) {
  return new Promise((resolve) => {
    const check = () => (video.videoWidth > 0 ? resolve() : requestAnimationFrame(check));
    check();
  });
}

/** Traduce los errores de getUserMedia a mensajes comprensibles. */
export function cameraErrorMessage(err) {
  switch (err?.name) {
    case "NotAllowedError":
      return "Permiso de cámara denegado. Actívalo en la barra de dirección del navegador.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No se encontró una cámara compatible.";
    case "NotReadableError":
      return "La cámara está siendo usada por otra aplicación.";
    case "SecurityError":
      return "La cámara solo funciona en https:// o localhost.";
    default:
      return err?.message || "No se pudo abrir la cámara.";
  }
}

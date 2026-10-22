# Uso de IA en este repositorio

## 2026-09-26 — Construcción inicial del pipeline

- **Herramienta:** Claude (Anthropic), en una sesión de trabajo agéntica.
- **Encargo:** diseñar y programar un sistema que, a partir de la grabación de
  una sesión (p. ej. del Senado), distinga qué dice cada persona, qué palabras
  repite y cómo se expresa con el rostro, el cuerpo y la voz. La generación de
  imágenes quedó fuera de esta etapa por decisión del autor.
- **Qué hizo la IA:** propuso la arquitectura por etapas y escribió el código,
  los léxicos iniciales de marcadores retóricos, las pruebas con una sesión
  sintética y la documentación.
- **Decisiones del autor:** alcance (solo análisis verbal y no verbal, sin
  imágenes generativas por ahora), foco en sesiones del Senado de Chile y
  publicación como repositorio.
- **Verificado:** las pruebas (`pytest`) pasan con la sesión sintética. Eso
  cubre turnos, ventanas, nombres de oradores, análisis verbal, prosodia,
  resumen no verbal, línea de tiempo y reporte.
- **No verificado en esa sesión:** transcripción con Whisper, diarización con
  pyannote, sentimiento con pysentimiento y detección real de rostro y pose con
  MediaPipe. El entorno de la IA no tenía GPU ni acceso de red para descargar
  esos modelos. Hay que probarlo con una sesión real.
- **Pendiente de revisión del autor:** los léxicos de `etapas/lexicos.py` y los
  índices compuestos de `etapas/linea_tiempo.py` son una operacionalización
  inicial que hay que discutir y justificar en la tesis.

## 2026-09-27 — Versión web en el navegador

- **Herramienta:** Claude Code (Anthropic).
- **Encargo:** que la página del proyecto en GitHub Pages funcione, no solo
  lo describa. El autor eligió una versión que corre en el navegador.
- **Qué hizo la IA:** portó a JavaScript las etapas de turnos, oradores,
  análisis verbal, prosodia, no verbal y línea de tiempo (`web/analisis.js`);
  integró Whisper y WeSpeaker con transformers.js y MediaPipe web; armó la
  interfaz y el reporte interactivo.
- **Verificado:** en Chrome, con un diálogo sintético (voz TTS) y con una
  entrevista real de Wikimedia Commons (CC BY-SA 4.0, 1:40 min): transcripción,
  separación de 2 oradores, rostro/pose, reporte, sesión guardada, cambio de
  nombres y de número de oradores, vista móvil.
- **Decisiones tomadas en las pruebas:** Whisper en fp32 (las versiones
  cuantizadas devolvían marcas de tiempo por palabra degeneradas); WeSpeaker en
  vez de WavLM (separaba mucho mejor las voces y es 4 veces más rápido).
- **No verificado:** sesiones largas (1 h o más) del Senado, Firefox y Safari.

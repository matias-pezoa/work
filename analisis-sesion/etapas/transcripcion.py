"""
Etapa 2 — Transcripción con faster-whisper.

Produce transcripcion.json con segmentos y marcas de tiempo por palabra:
  {"segmentos": [{"inicio", "fin", "texto", "palabras": [{"inicio","fin","palabra","prob"}]}]}

Las marcas por palabra son las que permiten después asignar cada palabra a un
hablante (diarización) y medir la velocidad del habla.
"""

import config
from etapas.util import Sesion, aviso, guardar_json, leer_json


def _dispositivo():
    disp, comp = config.WHISPER_DISPOSITIVO, config.WHISPER_COMPUTE
    if disp == "auto":
        try:
            import ctranslate2
            disp = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        except Exception:
            disp = "cpu"
    if comp == "auto":
        comp = "float16" if disp == "cuda" else "int8"
    return disp, comp


def ejecutar(sesion: Sesion, modelo: str | None = None) -> None:
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise SystemExit("Falta faster-whisper: pip install faster-whisper")

    modelo = modelo or config.WHISPER_MODELO
    disp, comp = _dispositivo()
    aviso(f"Cargando Whisper '{modelo}' en {disp} ({comp}). "
          "La primera vez descarga el modelo...")
    wm = WhisperModel(modelo, device=disp, compute_type=comp)

    duracion = leer_json(sesion.meta)["duracion_s"] if sesion.meta.exists() else None
    segmentos_iter, info = wm.transcribe(
        str(sesion.audio),
        language=config.WHISPER_IDIOMA,
        word_timestamps=True,
        vad_filter=True,                       # salta silencios y ruido de sala
        vad_parameters={"min_silence_duration_ms": 500},
        initial_prompt=config.WHISPER_PROMPT_INICIAL,
        condition_on_previous_text=False,      # evita que repita frases en bucle
        beam_size=5,
    )

    segmentos = []
    ultimo_aviso = 0.0
    for s in segmentos_iter:
        palabras = [
            {"inicio": round(w.start, 3), "fin": round(w.end, 3),
             "palabra": w.word.strip(), "prob": round(w.probability, 3)}
            for w in (s.words or []) if w.word.strip()
        ]
        segmentos.append({
            "inicio": round(s.start, 3), "fin": round(s.end, 3),
            "texto": s.text.strip(), "palabras": palabras,
        })
        if duracion and s.end - ultimo_aviso > 60:
            ultimo_aviso = s.end
            aviso(f"  transcrito {s.end/60:.1f} / {duracion/60:.1f} min")

    guardar_json(sesion.transcripcion, {
        "modelo": modelo, "idioma": info.language,
        "segmentos": segmentos,
    })
    n_pal = sum(len(s["palabras"]) for s in segmentos)
    aviso(f"Transcripción lista: {len(segmentos)} segmentos, {n_pal} palabras.")

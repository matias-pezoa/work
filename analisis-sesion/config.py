"""
Configuración del pipeline de análisis de sesiones.

Todo lo ajustable está aquí. Cada valor se puede cambiar editando este archivo;
los más usados también se pueden pasar por línea de comandos (ver pipeline.py).
"""

from pathlib import Path

RAIZ = Path(__file__).resolve().parent

# Carpeta donde se guarda cada sesión analizada (una subcarpeta por sesión)
CARPETA_SESIONES = RAIZ / "sesiones"

# Carpeta donde se descargan los modelos de MediaPipe
CARPETA_MODELOS = RAIZ / "modelos"

# ---------------------------------------------------------------------------
# Ingesta
# ---------------------------------------------------------------------------
AUDIO_SAMPLE_RATE = 16000          # Whisper y pyannote trabajan a 16 kHz mono
VIDEO_MAX_ALTURA = 720             # se reescala el video para análisis (ahorra tiempo)

# ---------------------------------------------------------------------------
# Transcripción (faster-whisper)
# ---------------------------------------------------------------------------
# Modelos: tiny, base, small, medium, large-v3, large-v3-turbo
#  - Sin GPU: "small" (rápido) o "medium" (mejor, ~1x tiempo real o más lento)
#  - Con GPU NVIDIA: "large-v3" o "large-v3-turbo"
WHISPER_MODELO = "medium"
WHISPER_IDIOMA = "es"
WHISPER_DISPOSITIVO = "auto"       # "auto", "cpu" o "cuda"
WHISPER_COMPUTE = "auto"           # "auto" usa int8 en CPU y float16 en GPU
# Texto que orienta a Whisper sobre el vocabulario (mejora nombres propios)
WHISPER_PROMPT_INICIAL = (
    "Sesión del Senado de Chile. Señor Presidente, Honorable Senado, "
    "senadora, senador, ministra, ministro, proyecto de ley, votación."
)

# ---------------------------------------------------------------------------
# Diarización (pyannote) — separar quién habla
# ---------------------------------------------------------------------------
# Requiere un token gratuito de Hugging Face y aceptar las condiciones del modelo
# en https://huggingface.co/pyannote/speaker-diarization-3.1
# El token se lee de la variable de entorno HF_TOKEN (o se escribe aquí).
PYANNOTE_MODELO = "pyannote/speaker-diarization-3.1"
HF_TOKEN = None                    # None = leer de la variable de entorno HF_TOKEN
DIARIZACION_MIN_HABLANTES = None   # si sabes cuántos hablan, ayuda fijarlo
DIARIZACION_MAX_HABLANTES = None

# Un turno de palabra se corta si hay un silencio mayor a esto (segundos)
TURNO_PAUSA_MAX = 2.0
# Turnos más cortos que esto se consideran interrupciones / ruido
TURNO_DURACION_MIN = 1.0
# Las intervenciones largas (en el Senado duran minutos) se subdividen en
# ventanas de ~N segundos, cortando de preferencia al final de una oración.
# La ventana es la unidad de la línea de tiempo: permite ver cómo cambia el
# discurso, la voz y el cuerpo DENTRO de una misma intervención.
VENTANA_SEG = 20

# ---------------------------------------------------------------------------
# Análisis verbal
# ---------------------------------------------------------------------------
SPACY_MODELO = "es_core_news_md"   # si no está instalado se usa un tokenizador simple
TOP_PALABRAS = 30
TOP_NGRAMAS = 20
# Frases de 3+ palabras repetidas por un mismo orador al menos esta cantidad de veces
CONSIGNA_MIN_REPETICIONES = 2
CONSIGNA_N = (3, 4, 5)
# Sentimiento/emoción con pysentimiento (opcional, descarga modelos de Hugging Face)
USAR_SENTIMIENTO = True

# Palabras vacías propias del contexto parlamentario (se suman a las del español).
# Son fórmulas protocolares que inflan las frecuencias sin decir nada del discurso.
STOPWORDS_CONTEXTO = {
    "señor", "señora", "presidente", "presidenta", "senador", "senadora",
    "senadores", "senadoras", "honorable", "gracias", "palabra", "sala",
    "colega", "colegas", "sesión", "minuto", "minutos", "tiempo",
    "diputado", "diputada", "ministro", "ministra", "bien", "entonces",
    "digamos", "cierto", "bueno", "pues", "ahí", "acá", "aquí", "así",
    "decir", "hacer", "ser", "estar", "haber", "tener", "ir", "poder",
}

# ---------------------------------------------------------------------------
# Análisis no verbal
# ---------------------------------------------------------------------------
VIDEO_FPS_ANALISIS = 5             # cuadros por segundo analizados
# Umbral de cambio de plano (diferencia de histograma, 0-1). Al cambiar de cámara
# se reinicia el cálculo de movimiento para no confundir el corte con un gesto.
UMBRAL_CAMBIO_PLANO = 0.45

# Blendshapes de MediaPipe que se resumen por turno (de los 52 disponibles).
# Se agrupan en índices legibles en etapas/no_verbal.py
BLENDSHAPES_CLAVE = [
    "browDownLeft", "browDownRight", "browInnerUp",
    "browOuterUpLeft", "browOuterUpRight",
    "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight",
    "eyeBlinkLeft", "eyeBlinkRight",
    "jawOpen", "mouthPressLeft", "mouthPressRight",
    "mouthSmileLeft", "mouthSmileRight",
    "mouthFrownLeft", "mouthFrownRight",
    "mouthPucker", "mouthRollLower", "mouthRollUpper",
    "noseSneerLeft", "noseSneerRight",
    "cheekSquintLeft", "cheekSquintRight",
]

MEDIAPIPE_MODELOS = {
    "face": (
        "face_landmarker.task",
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
        "face_landmarker/float16/latest/face_landmarker.task",
    ),
    "pose": (
        "pose_landmarker_full.task",
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
        "pose_landmarker_full/float16/latest/pose_landmarker_full.task",
    ),
}

# ---------------------------------------------------------------------------
# Prosodia (voz)
# ---------------------------------------------------------------------------
PITCH_MIN_HZ = 70
PITCH_MAX_HZ = 400

"""
Etapa 1 — Ingesta.

Recibe un enlace (YouTube, Senado TV, etc.) o un archivo de video local y deja
en la carpeta de la sesión:
  - video.mp4  (reescalado a VIDEO_MAX_ALTURA, para el análisis no verbal)
  - audio.wav  (16 kHz mono, para transcripción, diarización y prosodia)
  - meta.json  (fuente, duración, recorte usado)

Se puede recortar un tramo con desde/hasta (en segundos o "hh:mm:ss"), útil para
probar con 5-10 minutos antes de procesar una sesión completa de varias horas.
"""

import shutil
import subprocess
from pathlib import Path

import config
from etapas.util import Sesion, aviso, guardar_json


def _a_segundos(valor):
    if valor is None or valor == "":
        return None
    if isinstance(valor, (int, float)):
        return float(valor)
    partes = [float(p) for p in str(valor).split(":")]
    seg = 0.0
    for p in partes:
        seg = seg * 60 + p
    return seg


def _verificar_ffmpeg():
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise SystemExit(
            "No se encontró ffmpeg. En Windows instálalo con:\n"
            "    winget install Gyan.FFmpeg\n"
            "y abre una terminal nueva."
        )


def _duracion(ruta: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(ruta)],
        capture_output=True, text=True, check=True,
    )
    return float(r.stdout.strip())


def _descargar(url: str, destino_dir: Path) -> Path:
    try:
        import yt_dlp
    except ImportError:
        raise SystemExit("Falta yt-dlp: pip install yt-dlp")
    aviso(f"Descargando {url} ...")
    plantilla = str(destino_dir / "original.%(ext)s")
    opciones = {
        # Hasta 720p basta para expresión facial/corporal y pesa mucho menos
        "format": "bv*[height<=720]+ba/b[height<=720]/b",
        "outtmpl": plantilla,
        "merge_output_format": "mp4",
        "quiet": False,
        "noprogress": False,
    }
    with yt_dlp.YoutubeDL(opciones) as ydl:
        info = ydl.extract_info(url, download=True)
        ruta = Path(ydl.prepare_filename(info))
    if not ruta.exists():  # tras el merge la extensión puede cambiar
        candidatos = sorted(destino_dir.glob("original.*"))
        if not candidatos:
            raise SystemExit("La descarga no produjo ningún archivo.")
        ruta = candidatos[0]
    return ruta


def ejecutar(sesion: Sesion, fuente: str, desde=None, hasta=None) -> None:
    _verificar_ffmpeg()
    desde_s, hasta_s = _a_segundos(desde), _a_segundos(hasta)

    if fuente.startswith(("http://", "https://")):
        original = _descargar(fuente, sesion.dir)
    else:
        original = Path(fuente).expanduser().resolve()
        if not original.exists():
            raise SystemExit(f"No existe el archivo: {original}")

    recorte = []
    if desde_s is not None:
        recorte += ["-ss", str(desde_s)]
    if hasta_s is not None:
        recorte += ["-to", str(hasta_s)]

    aviso("Extrayendo audio (16 kHz mono)...")
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", *recorte, "-i", str(original),
         "-vn", "-ac", "1", "-ar", str(config.AUDIO_SAMPLE_RATE),
         "-c:a", "pcm_s16le", str(sesion.audio)],
        check=True,
    )

    aviso("Preparando video para análisis...")
    tiene_video = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries",
         "stream=index", "-of", "csv=p=0", str(original)],
        capture_output=True, text=True,
    ).stdout.strip() != ""
    if tiene_video:
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", *recorte, "-i", str(original),
             "-vf", f"scale=-2:'min({config.VIDEO_MAX_ALTURA},ih)'",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
             "-an", str(sesion.video)],
            check=True,
        )
    else:
        aviso("La fuente no tiene video: se omitirá el análisis facial/corporal.")

    meta = {
        "fuente": fuente,
        "archivo_original": str(original),
        "desde_s": desde_s or 0.0,
        "hasta_s": hasta_s,
        "duracion_s": _duracion(sesion.audio),
        "tiene_video": tiene_video,
    }
    guardar_json(sesion.meta, meta)
    aviso(f"Ingesta lista: {meta['duracion_s']:.0f} s de audio.")

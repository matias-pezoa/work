"""
Análisis verbal y no verbal de sesiones (Senado u otras sesiones grabadas).

Uso básico (una sesión completa):
    python pipeline.py --sesion senado_2026_09_23 --fuente "https://www.youtube.com/watch?v=..."

Probar primero con un tramo de 10 minutos:
    python pipeline.py --sesion prueba --fuente video.mp4 --desde 0:30:00 --hasta 0:40:00

Después de corregir los nombres en sesiones/<sesion>/oradores.csv, recalcular
solo el análisis (sin volver a transcribir):
    python pipeline.py --sesion senado_2026_09_23 --desde-etapa verbal

Etapas, en orden:
    ingesta → transcripcion → diarizacion → oradores → verbal →
    no_verbal → prosodia → linea_tiempo → reporte
"""

import argparse
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import config  # noqa: E402
from etapas.util import Sesion, aviso  # noqa: E402

ETAPAS = ["ingesta", "transcripcion", "diarizacion", "oradores", "verbal",
          "no_verbal", "prosodia", "linea_tiempo", "reporte"]


def _cargar_env():
    """Lee variables desde un archivo .env junto a este script (p. ej. HF_TOKEN),
    para no escribir el token en el código ni en la terminal. El .env está en
    .gitignore y nunca se sube al repositorio."""
    ruta = Path(__file__).resolve().parent / ".env"
    if not ruta.exists():
        return
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, valor = linea.split("=", 1)
        os.environ.setdefault(clave.strip(), valor.strip().strip('"').strip("'"))


def main():
    _cargar_env()
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sesion", required=True,
                    help="nombre de la sesión (carpeta dentro de sesiones/)")
    ap.add_argument("--fuente", help="enlace (YouTube, etc.) o ruta a un video/audio local")
    ap.add_argument("--desde", help="inicio del tramo a analizar (s o hh:mm:ss)")
    ap.add_argument("--hasta", help="fin del tramo a analizar (s o hh:mm:ss)")
    ap.add_argument("--etapas", help="lista separada por comas, p. ej. verbal,reporte")
    ap.add_argument("--desde-etapa", choices=ETAPAS,
                    help="ejecuta desde esta etapa hasta el final")
    ap.add_argument("--modelo-whisper", help=f"por defecto {config.WHISPER_MODELO}")
    ap.add_argument("--hf-token", help="token de Hugging Face para la diarización")
    ap.add_argument("--hablantes", type=int,
                    help="número de hablantes, si se conoce (mejora la diarización)")
    ap.add_argument("--sin-video", action="store_true", help="omite rostro y cuerpo")
    ap.add_argument("--sin-sentimiento", action="store_true", help="omite pysentimiento")
    ap.add_argument("--recalcular-video", action="store_true",
                    help="vuelve a analizar el video aunque exista el CSV de cuadros")
    a = ap.parse_args()

    if a.hf_token:
        os.environ["HF_TOKEN"] = a.hf_token
    if a.hablantes:
        config.DIARIZACION_MIN_HABLANTES = config.DIARIZACION_MAX_HABLANTES = a.hablantes
    if a.sin_sentimiento:
        config.USAR_SENTIMIENTO = False

    sesion = Sesion(a.sesion)

    if a.etapas:
        etapas = [x.strip() for x in a.etapas.split(",") if x.strip()]
        malas = [x for x in etapas if x not in ETAPAS]
        if malas:
            ap.error(f"etapas desconocidas: {malas}. Válidas: {ETAPAS}")
    elif a.desde_etapa:
        etapas = ETAPAS[ETAPAS.index(a.desde_etapa):]
    elif a.fuente:
        etapas = ETAPAS
    elif sesion.audio.exists():
        etapas = ETAPAS[1:]
    else:
        ap.error("indica --fuente para una sesión nueva")

    if "ingesta" in etapas and not a.fuente:
        ap.error("la etapa 'ingesta' necesita --fuente")
    if a.sin_video and "no_verbal" in etapas:
        etapas.remove("no_verbal")

    aviso(f"Sesión '{a.sesion}' → {sesion.dir}")
    aviso(f"Etapas: {', '.join(etapas)}")
    t0 = time.time()
    for nombre in etapas:
        aviso(f"── {nombre} ──")
        if nombre == "ingesta":
            from etapas import ingesta
            ingesta.ejecutar(sesion, a.fuente, a.desde, a.hasta)
        elif nombre == "transcripcion":
            from etapas import transcripcion
            transcripcion.ejecutar(sesion, a.modelo_whisper)
        elif nombre == "diarizacion":
            from etapas import diarizacion
            diarizacion.ejecutar(sesion)
        elif nombre == "oradores":
            from etapas import oradores
            oradores.ejecutar(sesion)
        elif nombre == "verbal":
            from etapas import verbal
            verbal.ejecutar(sesion)
        elif nombre == "no_verbal":
            from etapas import no_verbal
            no_verbal.ejecutar(sesion, reusar_cuadros=not a.recalcular_video)
        elif nombre == "prosodia":
            from etapas import prosodia
            prosodia.ejecutar(sesion)
        elif nombre == "linea_tiempo":
            from etapas import linea_tiempo
            linea_tiempo.ejecutar(sesion)
        elif nombre == "reporte":
            from etapas import reporte
            reporte.ejecutar(sesion)
    aviso(f"Terminado en {(time.time() - t0) / 60:.1f} min. Resultados en {sesion.dir}")
    if "oradores" in etapas:
        aviso("Revisa oradores.csv, completa la columna 'nombre' y vuelve a correr "
              f"con: --sesion {a.sesion} --desde-etapa verbal")


if __name__ == "__main__":
    main()

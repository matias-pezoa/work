"""Funciones compartidas: rutas de la sesión, lectura/escritura JSON, mensajes."""

import json
import math
import time
from pathlib import Path

import config


class Sesion:
    """Rutas de todos los archivos que produce el pipeline para una sesión."""

    def __init__(self, nombre: str):
        self.nombre = nombre
        self.dir = config.CARPETA_SESIONES / nombre
        self.dir.mkdir(parents=True, exist_ok=True)

    def ruta(self, archivo: str) -> Path:
        return self.dir / archivo

    # Archivos del pipeline, en orden de producción
    @property
    def video(self): return self.ruta("video.mp4")
    @property
    def audio(self): return self.ruta("audio.wav")
    @property
    def meta(self): return self.ruta("meta.json")
    @property
    def transcripcion(self): return self.ruta("transcripcion.json")
    @property
    def diarizacion(self): return self.ruta("diarizacion.json")
    @property
    def turnos(self): return self.ruta("turnos.json")
    @property
    def oradores_csv(self): return self.ruta("oradores.csv")
    @property
    def verbal(self): return self.ruta("verbal.json")
    @property
    def cuadros_csv(self): return self.ruta("no_verbal_cuadros.csv")
    @property
    def no_verbal(self): return self.ruta("no_verbal.json")
    @property
    def prosodia(self): return self.ruta("prosodia.json")
    @property
    def linea_tiempo_json(self): return self.ruta("linea_tiempo.json")
    @property
    def linea_tiempo_csv(self): return self.ruta("linea_tiempo.csv")
    @property
    def reporte(self): return self.ruta("reporte.html")


def _limpiar(obj):
    """Convierte NaN/inf en None y tipos numpy en tipos nativos para JSON."""
    if isinstance(obj, dict):
        return {str(k): _limpiar(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_limpiar(v) for v in obj]
    if hasattr(obj, "item") and not isinstance(obj, (str, bytes)):
        try:
            obj = obj.item()
        except Exception:
            pass
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    return obj


def guardar_json(ruta: Path, datos) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with open(ruta, "w", encoding="utf-8") as f:
        json.dump(_limpiar(datos), f, ensure_ascii=False, indent=2)


def leer_json(ruta: Path):
    with open(ruta, encoding="utf-8") as f:
        return json.load(f)


def aviso(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def fmt_tiempo(seg: float) -> str:
    seg = max(0, int(seg))
    h, r = divmod(seg, 3600)
    m, s = divmod(r, 60)
    return f"{h:d}:{m:02d}:{s:02d}" if h else f"{m:d}:{s:02d}"


def nombres_oradores(sesion: Sesion) -> dict:
    """Lee oradores.csv y devuelve {speaker_id: nombre}. Si la columna 'nombre'
    está vacía usa la sugerencia automática, y si no hay, el id."""
    import csv
    mapa = {}
    if not sesion.oradores_csv.exists():
        return mapa
    with open(sesion.oradores_csv, encoding="utf-8-sig", newline="") as f:
        for fila in csv.DictReader(f):
            sid = fila.get("speaker_id", "").strip()
            if not sid:
                continue
            nombre = (fila.get("nombre") or "").strip() \
                or (fila.get("nombre_sugerido") or "").strip() or sid
            mapa[sid] = nombre
    return mapa

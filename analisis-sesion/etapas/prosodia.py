"""
Etapa 7 — Prosodia: cómo suena la voz en cada turno (Praat vía parselmouth).

Por ventana (~20 s de una intervención):
  - f0_media_hz: tono medio de la voz
  - f0_sd_st / f0_rango_st: variación de tono en semitonos (entonación más
    plana o más expresiva). Los semitonos permiten comparar voces graves y agudas.
  - intensidad_media_db / intensidad_sd_db: volumen y su variación
  - velocidad_articulacion: palabras por segundo descontando pausas
  - pausas_por_min y frac_pausa: silencios > 0,3 s entre palabras

En la línea de tiempo estos valores se comparan con la voz habitual del mismo
orador (puntaje z), porque lo que interesa es cuándo alguien sube el tono o el
volumen respecto de sí mismo, no quién tiene la voz más aguda.

Salida: prosodia.json
"""

import math

import config
from etapas.util import Sesion, aviso, guardar_json, leer_json

PAUSA_MIN = 0.3


def _semitonos(hz, ref):
    return 12 * math.log2(hz / ref)


def _percentil(xs, p):
    xs = sorted(xs)
    return xs[int(p * (len(xs) - 1))]


def _medir(snd, palabras, inicio, fin):
    r = {}
    try:
        pitch = snd.to_pitch_ac(pitch_floor=config.PITCH_MIN_HZ,
                                pitch_ceiling=config.PITCH_MAX_HZ)
        f0 = [v for v in pitch.selected_array["frequency"] if v > 0]
    except Exception:
        f0 = []
    if len(f0) >= 10:
        med = _percentil(f0, 0.5)
        st = [_semitonos(v, med) for v in f0]
        m = sum(st) / len(st)
        r["f0_media_hz"] = round(sum(f0) / len(f0), 1)
        r["f0_mediana_hz"] = round(med, 1)
        r["f0_sd_st"] = round(math.sqrt(sum((x - m) ** 2 for x in st) / len(st)), 2)
        r["f0_rango_st"] = round(_percentil(st, 0.95) - _percentil(st, 0.05), 2)
        r["frac_sonora"] = round(len(f0) / max(1, pitch.get_number_of_frames()), 3)
    try:
        inten = snd.to_intensity(minimum_pitch=config.PITCH_MIN_HZ)
        db = [v for v in inten.values[0] if v > 0]
        if db:
            m = sum(db) / len(db)
            r["intensidad_media_db"] = round(m, 1)
            r["intensidad_sd_db"] = round(math.sqrt(sum((x - m) ** 2 for x in db) / len(db)), 2)
    except Exception:
        pass

    dur = fin - inicio
    pausas = [b["inicio"] - a["fin"] for a, b in zip(palabras, palabras[1:])
              if b["inicio"] - a["fin"] > PAUSA_MIN]
    t_pausa = sum(pausas)
    habla = max(0.1, dur - t_pausa)
    r["pausas_por_min"] = round(60 * len(pausas) / dur, 1) if dur > 0 else None
    r["frac_pausa"] = round(t_pausa / dur, 3) if dur > 0 else None
    r["velocidad_articulacion"] = round(len(palabras) / habla, 2)
    return r


def ejecutar(sesion: Sesion) -> None:
    try:
        import parselmouth
        import soundfile as sf
    except ImportError:
        raise SystemExit("Faltan paquetes: pip install praat-parselmouth soundfile")

    turnos = leer_json(sesion.turnos)["ventanas"]   # unidad: ventana de ~20 s
    info = sf.info(str(sesion.audio))
    sr = info.samplerate
    res = {}
    for i, t in enumerate(turnos):
        if t["breve"]:
            continue
        # se lee solo el tramo del turno: una sesión de horas no cabe entera en memoria
        datos, _ = sf.read(str(sesion.audio), start=int(t["inicio"] * sr),
                           stop=int(t["fin"] * sr), dtype="float64", always_2d=False)
        if datos.ndim > 1:
            datos = datos.mean(axis=1)
        if len(datos) < sr * 0.5:
            continue
        snd = parselmouth.Sound(datos, sampling_frequency=sr)
        res[t["id"]] = _medir(snd, t["palabras"], t["inicio"], t["fin"])
        if i and i % 200 == 0:
            aviso(f"  prosodia {i}/{len(turnos)} ventanas")

    guardar_json(sesion.prosodia, {"por_ventana": res})
    aviso(f"Prosodia lista: {len(res)} ventanas medidas.")

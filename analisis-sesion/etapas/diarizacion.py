"""
Etapa 3 — Diarización (quién habla cuándo) y construcción de turnos de palabra.

1. pyannote separa el audio en tramos por hablante anónimo (SPEAKER_00, 01, ...).
2. Cada palabra de la transcripción se asigna al hablante con el que más se
   superpone en el tiempo.
3. Palabras consecutivas del mismo hablante forman un turno; un silencio mayor a
   TURNO_PAUSA_MAX corta el turno.

Si pyannote no está disponible (o no hay token de Hugging Face), los turnos se
arman solo por pausas y el hablante queda como "SIN_DIARIZAR". El resto del
pipeline funciona igual, pero el análisis por orador no tendrá sentido.

Salida: diarizacion.json (tramos crudos) y turnos.json.
"""

import os
from bisect import bisect_right

import config
from etapas.util import Sesion, aviso, guardar_json, leer_json


def _diarizar(sesion: Sesion):
    token = config.HF_TOKEN or os.environ.get("HF_TOKEN")
    if not token:
        aviso("Sin HF_TOKEN: se omite la diarización (ver README).")
        return None
    try:
        import torch
        import soundfile as sf
        from pyannote.audio import Pipeline
    except ImportError as e:
        aviso(f"pyannote no está instalado ({e}); se omite la diarización.")
        return None

    aviso("Cargando pyannote (la primera vez descarga el modelo)...")
    try:
        pipe = Pipeline.from_pretrained(config.PYANNOTE_MODELO, token=token)
    except TypeError:  # pyannote 3.x usa otro nombre de parámetro
        pipe = Pipeline.from_pretrained(config.PYANNOTE_MODELO, use_auth_token=token)
    if pipe is None:
        raise SystemExit(
            "pyannote no pudo cargar el modelo. Revisa que aceptaste las condiciones "
            f"en https://huggingface.co/{config.PYANNOTE_MODELO} y en "
            "https://huggingface.co/pyannote/segmentation-3.0 con la misma cuenta del token."
        )
    if torch.cuda.is_available():
        pipe.to(torch.device("cuda"))

    # Se pasa la onda ya cargada: evita depender del backend de audio de torchaudio
    datos, sr = sf.read(str(sesion.audio), dtype="float32", always_2d=True)
    onda = torch.from_numpy(datos.T)
    params = {}
    if config.DIARIZACION_MIN_HABLANTES:
        params["min_speakers"] = config.DIARIZACION_MIN_HABLANTES
    if config.DIARIZACION_MAX_HABLANTES:
        params["max_speakers"] = config.DIARIZACION_MAX_HABLANTES

    aviso("Diarizando (en CPU puede tardar tanto como el audio)...")
    salida = pipe({"waveform": onda, "sample_rate": sr}, **params)
    anotacion = getattr(salida, "speaker_diarization", salida)  # pyannote 4.x
    tramos = [
        {"inicio": round(t.start, 3), "fin": round(t.end, 3), "hablante": h}
        for t, _, h in anotacion.itertracks(yield_label=True)
    ]
    tramos.sort(key=lambda x: x["inicio"])
    return tramos


def _asignar_hablantes(palabras, tramos):
    """Hablante con mayor superposición temporal para cada palabra."""
    if not tramos:
        for p in palabras:
            p["hablante"] = "SIN_DIARIZAR"
        return
    inicios = [t["inicio"] for t in tramos]
    previo = tramos[0]["hablante"]
    for p in palabras:
        a, b = p["inicio"], max(p["fin"], p["inicio"] + 0.01)
        i = max(0, bisect_right(inicios, a) - 1)
        mejor, mejor_sup = None, 0.0
        # revisa tramos vecinos (pueden solaparse cuando hablan dos a la vez)
        for t in tramos[max(0, i - 3): i + 4]:
            sup = min(b, t["fin"]) - max(a, t["inicio"])
            if sup > mejor_sup:
                mejor, mejor_sup = t["hablante"], sup
        if mejor is None:
            # palabra en un hueco: el tramo más cercano a menos de 1 s, o el anterior
            cerca = min(tramos, key=lambda t: min(abs(t["inicio"] - b), abs(t["fin"] - a)))
            dist = min(abs(cerca["inicio"] - b), abs(cerca["fin"] - a))
            mejor = cerca["hablante"] if dist < 1.0 else previo
        p["hablante"] = mejor
        previo = mejor


def _armar_turnos(palabras):
    turnos, actual = [], None
    for p in palabras:
        corta = (
            actual is None
            or p["hablante"] != actual["speaker_id"]
            or p["inicio"] - actual["fin"] > config.TURNO_PAUSA_MAX
        )
        if corta:
            if actual:
                turnos.append(actual)
            actual = {"speaker_id": p["hablante"], "inicio": p["inicio"],
                      "fin": p["fin"], "palabras": []}
        actual["palabras"].append(p)
        actual["fin"] = p["fin"]
    if actual:
        turnos.append(actual)

    for i, t in enumerate(turnos):
        t["id"] = i
        t["texto"] = _unir(t["palabras"])
        t["duracion"] = round(t["fin"] - t["inicio"], 3)
        t["n_palabras"] = len(t["palabras"])
        t["breve"] = t["duracion"] < config.TURNO_DURACION_MIN
    return turnos


def _armar_ventanas(turnos):
    """Subdivide cada turno en ventanas de ~VENTANA_SEG segundos. Corta en el
    primer fin de oración después del 75% del largo, o a la fuerza al 150%.
    Un resto muy corto se suma a la ventana anterior del mismo turno."""
    largo = config.VENTANA_SEG
    ventanas = []

    def cerrar(turno, palabras):
        ventanas.append({
            "id": len(ventanas), "turno_id": turno["id"],
            "speaker_id": turno["speaker_id"],
            "inicio": palabras[0]["inicio"], "fin": palabras[-1]["fin"],
            "duracion": round(palabras[-1]["fin"] - palabras[0]["inicio"], 3),
            "palabras": palabras, "texto": _unir(palabras),
            "n_palabras": len(palabras), "breve": turno["breve"],
        })

    for t in turnos:
        actual = []
        for p in t["palabras"]:
            actual.append(p)
            dur = p["fin"] - actual[0]["inicio"]
            fin_oracion = p["palabra"][-1:] in ".?!"
            if (dur >= 0.75 * largo and fin_oracion) or dur >= 1.5 * largo:
                cerrar(t, actual)
                actual = []
        if actual:
            ultima = ventanas[-1] if ventanas else None
            resto = actual[-1]["fin"] - actual[0]["inicio"]
            if ultima and ultima["turno_id"] == t["id"] and resto < 0.4 * largo:
                ventanas.pop()
                cerrar(t, ultima["palabras"] + actual)
            else:
                cerrar(t, actual)
    return ventanas


def _unir(palabras):
    texto = ""
    for p in palabras:
        w = p["palabra"]
        if texto and not w[:1] in ",.;:!?)»":
            texto += " "
        texto += w
    return texto


def ejecutar(sesion: Sesion) -> None:
    trans = leer_json(sesion.transcripcion)
    palabras = [dict(p) for s in trans["segmentos"] for p in s["palabras"]]
    if not palabras:
        raise SystemExit("La transcripción no tiene palabras.")

    if sesion.diarizacion.exists():
        aviso("Usando diarizacion.json existente (bórralo para recalcular).")
        tramos = leer_json(sesion.diarizacion)["tramos"]
    else:
        tramos = _diarizar(sesion)
        if tramos is not None:
            guardar_json(sesion.diarizacion, {"modelo": config.PYANNOTE_MODELO,
                                              "tramos": tramos})
    _asignar_hablantes(palabras, tramos or [])
    turnos = _armar_turnos(palabras)
    ventanas = _armar_ventanas(turnos)
    guardar_json(sesion.turnos, {"turnos": turnos, "ventanas": ventanas})
    hablantes = sorted({t["speaker_id"] for t in turnos})
    aviso(f"Turnos listos: {len(turnos)} turnos ({len(ventanas)} ventanas de "
          f"~{config.VENTANA_SEG} s), {len(hablantes)} hablantes.")

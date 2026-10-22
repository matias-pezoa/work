"""
Genera una sesión sintética para probar el pipeline sin modelos de IA.

Crea en la carpeta de la sesión lo que normalmente producirían las etapas que
necesitan modelos descargados (ingesta, transcripción, diarización y el
recorrido del video con MediaPipe):
  meta.json, audio.wav, transcripcion.json, diarizacion.json, no_verbal_cuadros.csv

El guion tiene una presidencia y tres oradores. El segundo turno de "Ramírez"
es deliberadamente más enfático (más tono, volumen, gestos y ceño), para
verificar que los índices lo detectan.

Uso directo (deja la sesión en sesiones/sintetica):
    python tests/sintetico.py
"""

import csv
import json
import math
import random
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402
from etapas.no_verbal import POSE_PUNTOS  # noqa: E402

GUION = [
    ("SPEAKER_00", "Se abre la sesión. Tiene la palabra el senador Ramírez."),
    ("SPEAKER_01", "Gracias, señor Presidente. Nosotros siempre hemos dicho que la seguridad de las familias es lo primero. "
                   "Hoy vivimos una crisis de inseguridad sin precedentes, la delincuencia avanza y el gobierno no hace nada. "
                   "Todos sabemos que la seguridad de las familias no puede esperar. Nunca vamos a aceptar este caos. "
                   "Los chilenos exigen orden y nosotros vamos a defender la seguridad de las familias."),
    ("SPEAKER_00", "Gracias, senador. Tiene la palabra la senadora Contreras."),
    ("SPEAKER_02", "Gracias, Presidente. Según el informe de la Fiscalía, los delitos violentos bajaron 4,5 por ciento el último año. "
                   "Creo que es posible que existan zonas donde la percepción de temor aumentó, y eso hay que atenderlo. "
                   "Pero los datos muestran otra cosa. Quizás deberíamos mirar las cifras regionales antes de hablar de caos. "
                   "El estudio de la universidad indica 12 comunas prioritarias."),
    ("SPEAKER_00", "Senador Ramírez, tiene la palabra."),
    ("SPEAKER_01", "Presidente, la realidad es que la gente tiene miedo. Las cifras no le importan a una madre que no puede salir de noche. "
                   "Es evidente que ellos no entienden la seguridad de las familias. Absolutamente nadie en este gobierno se hace cargo. "
                   "Es gravísimo. Es una vergüenza."),
    ("SPEAKER_00", "Ofrezco la palabra a la ministra Soto."),
    ("SPEAKER_03", "Muchas gracias. Quiero precisar algunos datos. De acuerdo con las estadísticas oficiales, invertimos 300 millones "
                   "en prevención comunitaria. Probablemente no es suficiente y lo reconocemos. Pienso que debemos trabajar juntos, "
                   "con responsabilidad, porque la seguridad es un derecho de todas las personas."),
    ("SPEAKER_00", "Gracias, ministra. Se levanta la sesión."),
]
F0 = {"SPEAKER_00": 110, "SPEAKER_01": 130, "SPEAKER_02": 210, "SPEAKER_03": 190}
AMP = {"SPEAKER_00": 0.15, "SPEAKER_01": 0.3, "SPEAKER_02": 0.2, "SPEAKER_03": 0.18}
SR = 16000


def _voz(dur, f0, amp, var):
    """Tono armónico con vibrato: suficiente para que Praat mida f0 e intensidad."""
    n = int(dur * SR)
    tt = np.arange(n) / SR
    f = f0 * (1 + var * np.sin(2 * np.pi * 2.3 * tt))
    fase = 2 * np.pi * np.cumsum(f) / SR
    x = sum(np.sin(k * fase) / k for k in range(1, 6))
    env = np.minimum(1, np.minimum(tt / 0.03, (dur - tt) / 0.03))
    return amp * x * env


def crear(sesion) -> None:
    """Escribe los archivos de una sesión sintética en sesion.dir."""
    random.seed(1)
    np.random.seed(1)
    t = 1.0
    segmentos, tramos, turnos_t = [], [], []
    audio = np.zeros(int(200 * SR))

    for i, (spk, texto) in enumerate(GUION):
        ini = t
        enfatico = spk == "SPEAKER_01" and i > 2
        palabras = []
        for w in texto.split():
            dur = 0.18 + 0.03 * len(w.strip(".,"))
            f0 = F0[spk] * (1.12 if enfatico else 1.0) * random.uniform(0.95, 1.05)
            amp = AMP[spk] * (1.5 if enfatico else 1.0)
            x = _voz(dur, f0, amp, 0.08 if enfatico else 0.03)
            a = int(t * SR)
            audio[a:a + len(x)] += x
            palabras.append({"inicio": round(t, 3), "fin": round(t + dur, 3),
                             "palabra": w, "prob": 0.9})
            t += dur + (0.45 if w.endswith(".") else 0.08)
        tramos.append({"inicio": round(ini - 0.1, 3), "fin": round(t, 3), "hablante": spk})
        segmentos.append({"inicio": palabras[0]["inicio"], "fin": palabras[-1]["fin"],
                          "texto": texto, "palabras": palabras})
        turnos_t.append((spk, ini, t, enfatico))
        t += 2.5

    dur_total = t + 1
    n = int(dur_total * SR)
    audio = audio[:n] + np.random.normal(0, 0.002, n)
    sf.write(sesion.audio, audio.astype("float32"), SR, subtype="PCM_16")

    def escribir(ruta, datos):
        with open(ruta, "w", encoding="utf-8") as f:
            json.dump(datos, f, ensure_ascii=False)

    escribir(sesion.transcripcion, {"modelo": "sintetico", "idioma": "es", "segmentos": segmentos})
    escribir(sesion.diarizacion, {"modelo": "sintetico", "tramos": tramos})
    escribir(sesion.meta, {"fuente": "Sesión sintética de prueba", "desde_s": 0.0,
                           "hasta_s": None, "duracion_s": dur_total, "tiene_video": True})
    # video.mp4 vacío: solo para que la etapa no_verbal no se salte (usa el CSV)
    sesion.video.touch()

    cols = (["t", "cambio_plano", "n_rostros", "rostro_area", "yaw", "pitch", "roll"]
            + [f"bs_{b}" for b in config.BLENDSHAPES_CLAVE] + ["pose", "hombros_ancho"]
            + [f"{p}_{e}" for p in POSE_PUNTOS for e in ("x", "y", "v")])
    fps = config.VIDEO_FPS_ANALISIS
    filas, k = [], 0
    while k / fps < dur_total:
        tt = k / fps
        k += 1
        turno = next((x for x in turnos_t if x[1] <= tt <= x[2]), None)
        fila = dict.fromkeys(cols, "")
        fila["t"] = round(tt, 3)
        fila["cambio_plano"] = int(any(abs(tt - x[1]) < 0.5 / fps for x in turnos_t))
        if turno and turno[0] != "SPEAKER_00":   # la presidencia no sale en cámara
            enfatico = turno[3]
            fila.update({"n_rostros": 1, "rostro_area": 0.05,
                         "yaw": round(5 * math.sin(tt * (2 if enfatico else 0.5)), 2),
                         "pitch": 2.0, "roll": 0.5, "pose": 1, "hombros_ancho": 0.25})
            for b in config.BLENDSHAPES_CLAVE:
                fila[f"bs_{b}"] = round(random.uniform(0, 0.05), 4)
            fila["bs_jawOpen"] = round(abs(math.sin(tt * 7)) * 0.4, 4)  # boca que habla
            if enfatico:
                fila["bs_browDownLeft"] = fila["bs_browDownRight"] = 0.45
            amp = 0.06 if enfatico else 0.01
            for p in POSE_PUNTOS:
                fila[f"{p}_x"] = round(0.5 + amp * math.sin(tt * 3 + len(p)), 4)
                fila[f"{p}_y"] = round(0.6 + amp * math.cos(tt * 3), 4)
                fila[f"{p}_v"] = 0.9
        else:
            fila.update({"n_rostros": 0, "pose": 0})
        filas.append(fila)
    with open(sesion.cuadros_csv, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(filas)


if __name__ == "__main__":
    from etapas.util import Sesion
    s = Sesion("sintetica")
    crear(s)
    print(f"Sesión sintética creada en {s.dir}")
    print("Ahora: python pipeline.py --sesion sintetica --desde-etapa diarizacion --sin-sentimiento")

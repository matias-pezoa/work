"""
Etapa 6 — Análisis no verbal (rostro y cuerpo) con MediaPipe.

Recorre el video a VIDEO_FPS_ANALISIS cuadros por segundo y en cada cuadro:
  - detecta cambios de plano (corte de cámara)
  - rostro principal (el más grande): 52 blendshapes, orientación de la cabeza
    (giro, inclinación, ladeo) y tamaño en pantalla (tipo de plano)
  - pose principal: hombros, codos, muñecas y nariz

Guarda un CSV cuadro a cuadro (no_verbal_cuadros.csv) y un resumen por ventana
(~20 s) de cada intervención (no_verbal.json) con índices legibles:
  tension_ceno, cejas_elevadas, presion_labios, sonrisa, desagrado,
  apertura_boca, energia_gestual, movimiento_cabeza, cambios de plano...

LIMITACIONES (importante para interpretar):
  - En la transmisión de TV el rostro en pantalla NO siempre es el de quien
    habla (planos de reacción, plano general de la sala). Por eso cada turno
    lleva 'frac_con_rostro' y 'rostro_parece_hablar' (variación de apertura de
    boca), que indican cuánto confiar en esos valores.
  - Los blendshapes describen movimientos musculares observables, no emociones.
    "tension_ceno" alto significa cejas bajadas, no necesariamente enojo.
"""

import csv
import math
import urllib.request
from collections import defaultdict

import config
from etapas.util import Sesion, aviso, guardar_json, leer_json, nombres_oradores


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------

def _modelo(clave: str):
    nombre, url = config.MEDIAPIPE_MODELOS[clave]
    ruta = config.CARPETA_MODELOS / nombre
    if not ruta.exists():
        config.CARPETA_MODELOS.mkdir(parents=True, exist_ok=True)
        aviso(f"Descargando modelo MediaPipe {nombre}...")
        urllib.request.urlretrieve(url, ruta)
    return str(ruta)


def _crear_detectores():
    from mediapipe.tasks.python import BaseOptions, vision
    face = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=_modelo("face")),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=4,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=True,
    ))
    pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=_modelo("pose")),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=2,
    ))
    return face, pose


# ---------------------------------------------------------------------------
# Geometría
# ---------------------------------------------------------------------------

def _angulos(matriz):
    """Giro (yaw), inclinación (pitch) y ladeo (roll) en grados desde la matriz
    de transformación facial 4x4 de MediaPipe."""
    r = [[matriz[i][j] for j in range(3)] for i in range(3)]
    sy = math.sqrt(r[0][0] ** 2 + r[1][0] ** 2)
    if sy > 1e-6:
        pitch = math.atan2(r[2][1], r[2][2])
        yaw = math.atan2(-r[2][0], sy)
        roll = math.atan2(r[1][0], r[0][0])
    else:
        pitch, yaw, roll = math.atan2(-r[1][2], r[1][1]), math.atan2(-r[2][0], sy), 0.0
    return tuple(round(math.degrees(a), 2) for a in (yaw, pitch, roll))


def _bbox_area(landmarks):
    xs = [p.x for p in landmarks]
    ys = [p.y for p in landmarks]
    return max(0.0, (max(xs) - min(xs)) * (max(ys) - min(ys)))


def _diferencia_hist(h1, h2):
    import cv2
    if h1 is None or h2 is None:
        return 0.0
    return 1.0 - float(cv2.compareHist(h1, h2, cv2.HISTCMP_CORREL))


# ---------------------------------------------------------------------------
# Recorrido del video
# ---------------------------------------------------------------------------

POSE_PUNTOS = {"nariz": 0, "hombro_i": 11, "hombro_d": 12, "codo_i": 13,
               "codo_d": 14, "muneca_i": 15, "muneca_d": 16}


def _analizar_cuadros(sesion: Sesion):
    import cv2
    import mediapipe as mp

    cap = cv2.VideoCapture(str(sesion.video))
    if not cap.isOpened():
        raise SystemExit(f"No se pudo abrir {sesion.video}")
    fps_video = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    paso = max(1, round(fps_video / config.VIDEO_FPS_ANALISIS))
    face, pose = _crear_detectores()

    columnas = (["t", "cambio_plano", "n_rostros", "rostro_area", "yaw", "pitch", "roll"]
                + [f"bs_{b}" for b in config.BLENDSHAPES_CLAVE]
                + ["pose", "hombros_ancho"]
                + [f"{p}_{e}" for p in POSE_PUNTOS for e in ("x", "y", "v")])
    filas = []
    hist_prev = None
    idx = 0
    ultimo_aviso = 0
    while True:
        if idx % paso:
            if not cap.grab():
                break
            idx += 1
            continue
        ok, frame = cap.read()
        if not ok:
            break
        t = idx / fps_video
        ts_ms = int(t * 1000)
        idx += 1

        # cambio de plano: histograma de color reducido
        hsv = cv2.cvtColor(cv2.resize(frame, (160, 90)), cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
        cv2.normalize(hist, hist)
        cambio = _diferencia_hist(hist_prev, hist) > config.UMBRAL_CAMBIO_PLANO
        hist_prev = hist

        img = mp.Image(image_format=mp.ImageFormat.SRGB,
                       data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        fila = dict.fromkeys(columnas, "")
        fila.update({"t": round(t, 3), "cambio_plano": int(cambio)})

        rf = face.detect_for_video(img, ts_ms)
        fila["n_rostros"] = len(rf.face_landmarks)
        if rf.face_landmarks:
            areas = [_bbox_area(lm) for lm in rf.face_landmarks]
            i = max(range(len(areas)), key=areas.__getitem__)
            fila["rostro_area"] = round(areas[i], 5)
            if rf.facial_transformation_matrixes:
                fila["yaw"], fila["pitch"], fila["roll"] = _angulos(
                    rf.facial_transformation_matrixes[i])
            if rf.face_blendshapes:
                bs = {c.category_name: c.score for c in rf.face_blendshapes[i]}
                for b in config.BLENDSHAPES_CLAVE:
                    fila[f"bs_{b}"] = round(bs.get(b, 0.0), 4)

        rp = pose.detect_for_video(img, ts_ms)
        if rp.pose_landmarks:
            def ancho(lm):
                return abs(lm[11].x - lm[12].x)
            lm = max(rp.pose_landmarks, key=ancho)
            fila["pose"] = 1
            fila["hombros_ancho"] = round(ancho(lm), 4)
            for nombre, k in POSE_PUNTOS.items():
                fila[f"{nombre}_x"] = round(lm[k].x, 4)
                fila[f"{nombre}_y"] = round(lm[k].y, 4)
                fila[f"{nombre}_v"] = round(getattr(lm[k], "visibility", 1.0) or 0, 3)
        else:
            fila["pose"] = 0
        filas.append(fila)

        if total and idx - ultimo_aviso > fps_video * 120:
            ultimo_aviso = idx
            aviso(f"  video {100 * idx / total:.0f}%")

    cap.release()
    face.close()
    pose.close()

    with open(sesion.cuadros_csv, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columnas)
        w.writeheader()
        w.writerows(filas)
    aviso(f"{len(filas)} cuadros analizados ({config.VIDEO_FPS_ANALISIS} fps).")
    return filas


def _leer_cuadros(sesion: Sesion):
    with open(sesion.cuadros_csv, encoding="utf-8", newline="") as f:
        filas = list(csv.DictReader(f))
    for fila in filas:
        for k, v in fila.items():
            if v == "":
                fila[k] = None
            else:
                try:
                    fila[k] = float(v)
                except ValueError:
                    pass
    return filas


# ---------------------------------------------------------------------------
# Derivados cuadro a cuadro e índices
# ---------------------------------------------------------------------------

def _media(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def _p90(xs):
    xs = sorted(x for x in xs if x is not None)
    return xs[int(0.9 * (len(xs) - 1))] if xs else None


def _std(xs):
    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return None
    m = sum(xs) / len(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def _indices(f):
    """Índices legibles a partir de los blendshapes de un cuadro."""
    g = lambda k: f.get(f"bs_{k}")
    if g("jawOpen") is None:
        return {}
    m = lambda *ks: sum(g(k) or 0 for k in ks) / len(ks)
    return {
        "tension_ceno": m("browDownLeft", "browDownRight"),
        "cejas_elevadas": (g("browInnerUp") + m("browOuterUpLeft", "browOuterUpRight")) / 2,
        "presion_labios": (m("mouthPressLeft", "mouthPressRight")
                           + m("mouthRollLower", "mouthRollUpper")) / 2,
        "sonrisa": m("mouthSmileLeft", "mouthSmileRight"),
        "desagrado": (m("noseSneerLeft", "noseSneerRight")
                      + m("mouthFrownLeft", "mouthFrownRight")) / 2,
        "ojos_entrecerrados": m("eyeSquintLeft", "eyeSquintRight"),
        "apertura_boca": g("jawOpen"),
    }


def _derivar(filas):
    """Añade índices, energía gestual y movimiento de cabeza por cuadro. El
    movimiento se calcula solo entre cuadros consecutivos del mismo plano."""
    dt = 1.0 / config.VIDEO_FPS_ANALISIS
    prev = None
    for f in filas:
        f.update(_indices(f))
        f["energia_gestual"] = None
        f["movimiento_cabeza"] = None
        mismo_plano = prev is not None and not f.get("cambio_plano")
        if mismo_plano and f.get("pose") and prev.get("pose") and f.get("hombros_ancho"):
            escala = max(f["hombros_ancho"], 0.02)
            desp = []
            for p in ("muneca_i", "muneca_d"):
                if (f.get(f"{p}_v") or 0) > 0.5 and (prev.get(f"{p}_v") or 0) > 0.5:
                    desp.append(math.hypot(f[f"{p}_x"] - prev[f"{p}_x"],
                                           f[f"{p}_y"] - prev[f"{p}_y"]))
            if desp:
                # anchos de hombro por segundo: independiente del tamaño del plano
                f["energia_gestual"] = (sum(desp) / len(desp)) / escala / dt
        if mismo_plano and f.get("yaw") is not None and prev.get("yaw") is not None:
            f["movimiento_cabeza"] = math.sqrt(
                (f["yaw"] - prev["yaw"]) ** 2 + (f["pitch"] - prev["pitch"]) ** 2
                + (f["roll"] - prev["roll"]) ** 2) / dt   # grados por segundo
        prev = f
    return filas


INDICES = ["tension_ceno", "cejas_elevadas", "presion_labios", "sonrisa",
           "desagrado", "ojos_entrecerrados", "apertura_boca"]


def _tipo_plano(area):
    if area is None:
        return "sin_rostro"
    if area > 0.06:
        return "primer_plano"
    if area > 0.015:
        return "plano_medio"
    return "plano_general"


def _resumir(cuadros):
    if not cuadros:
        return {"n_cuadros": 0}
    con_rostro = [c for c in cuadros if c.get("apertura_boca") is not None]
    areas = sorted(c["rostro_area"] for c in con_rostro if c.get("rostro_area"))
    area_med = areas[len(areas) // 2] if areas else None
    jaw_std = _std([c["apertura_boca"] for c in con_rostro])
    r = {
        "n_cuadros": len(cuadros),
        "frac_con_rostro": round(len(con_rostro) / len(cuadros), 3),
        "frac_con_pose": round(sum(1 for c in cuadros if c.get("pose")) / len(cuadros), 3),
        "n_cambios_plano": int(sum(c.get("cambio_plano") or 0 for c in cuadros)),
        "tipo_plano": _tipo_plano(area_med),
        "variacion_boca": round(jaw_std, 4) if jaw_std is not None else None,
        # si la boca del rostro en pantalla se mueve, probablemente es quien habla
        "rostro_parece_hablar": bool(jaw_std is not None and jaw_std > 0.05
                                     and len(con_rostro) >= 5),
    }
    for k in INDICES:
        vals = [c.get(k) for c in con_rostro]
        r[k] = round(_media(vals), 4) if _media(vals) is not None else None
        r[f"{k}_p90"] = round(_p90(vals), 4) if _p90(vals) is not None else None
    for k in ("energia_gestual", "movimiento_cabeza"):
        vals = [c.get(k) for c in cuadros]
        r[k] = round(_media(vals), 4) if _media(vals) is not None else None
        r[f"{k}_p90"] = round(_p90(vals), 4) if _p90(vals) is not None else None
    for k in ("yaw", "pitch"):
        r[f"{k}_sd"] = round(_std([c.get(k) for c in con_rostro]) or 0, 2) if con_rostro else None
    return r


# ---------------------------------------------------------------------------

def ejecutar(sesion: Sesion, reusar_cuadros: bool = True) -> None:
    if not sesion.video.exists():
        aviso("No hay video en la sesión: se omite el análisis no verbal.")
        return
    if reusar_cuadros and sesion.cuadros_csv.exists():
        aviso("Usando no_verbal_cuadros.csv existente (bórralo para recalcular).")
        filas = _leer_cuadros(sesion)
    else:
        try:
            _analizar_cuadros(sesion)
        except ImportError:
            raise SystemExit("Faltan mediapipe/opencv: pip install mediapipe opencv-python")
        filas = _leer_cuadros(sesion)
    filas = _derivar(filas)

    turnos = leer_json(sesion.turnos)["ventanas"]   # unidad: ventana de ~20 s
    nombres = nombres_oradores(sesion)
    tiempos = [f["t"] for f in filas]

    from bisect import bisect_left, bisect_right
    por_turno, por_orador_cuadros = {}, defaultdict(list)
    for t in turnos:
        a, b = bisect_left(tiempos, t["inicio"]), bisect_right(tiempos, t["fin"])
        cuadros = filas[a:b]
        res = _resumir(cuadros)
        res["orador"] = nombres.get(t["speaker_id"], t["speaker_id"])
        por_turno[t["id"]] = res
        # para el perfil del orador solo se usan turnos donde su rostro parece estar
        if res.get("rostro_parece_hablar"):
            por_orador_cuadros[res["orador"]].extend(cuadros)

    por_orador = {}
    for orador, cuadros in por_orador_cuadros.items():
        r = _resumir(cuadros)
        r["nota"] = "solo turnos donde el rostro en pantalla parece estar hablando"
        por_orador[orador] = r

    guardar_json(sesion.no_verbal, {
        "fps_analisis": config.VIDEO_FPS_ANALISIS,
        "por_ventana": por_turno,
        "por_orador": por_orador,
    })
    n_conf = sum(1 for r in por_turno.values() if r.get("rostro_parece_hablar"))
    aviso(f"Análisis no verbal listo: {n_conf}/{len(por_turno)} ventanas con rostro "
          "que parece ser el del orador.")

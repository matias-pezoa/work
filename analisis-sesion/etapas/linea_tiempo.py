"""
Etapa 8 — Línea de tiempo unificada.

Une por ventana (~20 s de una intervención) todo lo anterior (texto, análisis verbal, prosodia,
rostro y cuerpo) en un solo registro, y calcula puntajes z:

  - Prosodia y no verbal se comparan con el propio orador (¿habla más fuerte,
    más agudo, se mueve más que lo habitual en él/ella?).
  - La carga retórica se compara con toda la sesión.

Índices compuestos EXPLORATORIOS (promedio de puntajes z disponibles):
  activacion_vocal    = tono + volumen + variación de tono
  activacion_corporal = energía gestual + movimiento de cabeza + tensión del ceño
                        (solo si el rostro en pantalla parece ser el del orador)
  activacion_no_verbal = promedio de las dos anteriores
  desfase_verbal_no_verbal = carga_retorica_z − activacion_no_verbal
      > 0: el discurso enfatiza/polariza más de lo que el cuerpo y la voz muestran
      < 0: cuerpo y voz más activados que lo que el texto enfatiza

Estos índices son una propuesta de lectura, no mediciones validadas.

Salida: linea_tiempo.json (completo) y linea_tiempo.csv (para Excel/pandas).
"""

import csv
import math
from collections import defaultdict

from etapas.util import Sesion, aviso, guardar_json, leer_json, nombres_oradores

PROSODIA_Z = ["f0_media_hz", "intensidad_media_db", "f0_sd_st", "velocidad_articulacion"]
NO_VERBAL_Z = ["energia_gestual", "movimiento_cabeza", "tension_ceno",
               "cejas_elevadas", "presion_labios"]


def _leer(ruta):
    return leer_json(ruta) if ruta.exists() else {}


def _z_por_grupo(filas, campo, grupo="orador", filtro=None, min_n=3):
    grupos = defaultdict(list)
    for f in filas:
        v = f.get(campo)
        if v is not None and (filtro is None or filtro(f)):
            grupos[f[grupo] if grupo else "_"].append(v)
    stats = {}
    for g, vs in grupos.items():
        if len(vs) >= min_n:
            m = sum(vs) / len(vs)
            sd = math.sqrt(sum((x - m) ** 2 for x in vs) / (len(vs) - 1))
            if sd > 1e-9:
                stats[g] = (m, sd)
    for f in filas:
        v = f.get(campo)
        g = f[grupo] if grupo else "_"
        ok = v is not None and g in stats and (filtro is None or filtro(f))
        f[f"z_{campo}"] = round((v - stats[g][0]) / stats[g][1], 3) if ok else None


def _media(*xs):
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 3) if xs else None


def ejecutar(sesion: Sesion) -> None:
    turnos = leer_json(sesion.turnos)["ventanas"]   # unidad: ventana de ~20 s
    nombres = nombres_oradores(sesion)
    verbal = _leer(sesion.verbal).get("por_ventana", {})
    pros = _leer(sesion.prosodia).get("por_ventana", {})
    nv = _leer(sesion.no_verbal).get("por_ventana", {})

    filas = []
    for t in turnos:
        k = str(t["id"])
        v, p, n = verbal.get(k, {}), pros.get(k, {}), nv.get(k, {})
        f = {
            "id": t["id"],
            "turno_id": t["turno_id"],
            "orador": nombres.get(t["speaker_id"], t["speaker_id"]),
            "speaker_id": t["speaker_id"],
            "inicio": t["inicio"], "fin": t["fin"], "duracion": t["duracion"],
            "breve": t["breve"],
            "texto": t["texto"],
            "n_palabras": t["n_palabras"],
            "velocidad_ppm": v.get("velocidad_ppm"),
            "carga_retorica": v.get("carga_retorica"),
            "polaridad": v.get("polaridad"),
            "emocion_dominante": v.get("emocion_dominante"),
            "marcadores": v.get("marcadores", {}),
        }
        for c in ("f0_media_hz", "f0_sd_st", "f0_rango_st", "intensidad_media_db",
                  "intensidad_sd_db", "velocidad_articulacion", "pausas_por_min", "frac_pausa"):
            f[c] = p.get(c)
        for c in ("frac_con_rostro", "rostro_parece_hablar", "tipo_plano",
                  "n_cambios_plano", "tension_ceno", "cejas_elevadas", "presion_labios",
                  "sonrisa", "desagrado", "apertura_boca", "energia_gestual",
                  "movimiento_cabeza"):
            f[c] = n.get(c)
        filas.append(f)

    sustantivo = lambda f: not f["breve"]
    for c in PROSODIA_Z:
        _z_por_grupo(filas, c, filtro=sustantivo)
    # no verbal: solo turnos donde el rostro visible parece ser el del orador
    confiable = lambda f: not f["breve"] and bool(f.get("rostro_parece_hablar"))
    for c in NO_VERBAL_Z:
        _z_por_grupo(filas, c, filtro=confiable)
    _z_por_grupo(filas, "carga_retorica", grupo=None,
                 filtro=lambda f: not f["breve"] and f["n_palabras"] >= 15)

    for f in filas:
        f["activacion_vocal"] = _media(f.get("z_f0_media_hz"),
                                       f.get("z_intensidad_media_db"), f.get("z_f0_sd_st"))
        f["activacion_corporal"] = _media(f.get("z_energia_gestual"),
                                          f.get("z_movimiento_cabeza"), f.get("z_tension_ceno"))
        f["activacion_no_verbal"] = _media(f["activacion_vocal"], f["activacion_corporal"])
        cz = f.get("z_carga_retorica")
        anv = f["activacion_no_verbal"]
        f["desfase_verbal_no_verbal"] = round(cz - anv, 3) if cz is not None and anv is not None else None

    guardar_json(sesion.linea_tiempo_json, {"ventanas": filas})

    # CSV plano (sin el texto completo de marcadores anidado)
    categorias = sorted({k for f in filas for k in f["marcadores"]})
    cols = [c for c in filas[0].keys() if c != "marcadores"] + [f"m_{c}" for c in categorias]
    with open(sesion.linea_tiempo_csv, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for f in filas:
            fila = {c: f.get(c) for c in cols if not c.startswith("m_")}
            fila.update({f"m_{c}": f["marcadores"].get(c, 0) for c in categorias})
            w.writerow(fila)
    aviso(f"Línea de tiempo lista: {len(filas)} ventanas → linea_tiempo.csv")

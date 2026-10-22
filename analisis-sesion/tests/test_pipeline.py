"""
Pruebas del pipeline con una sesión sintética (no necesitan GPU ni descargar
modelos de Whisper, pyannote o MediaPipe).

    pytest -q
"""

import csv
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import config  # noqa: E402
from etapas import (diarizacion, linea_tiempo, no_verbal, oradores,  # noqa: E402
                    prosodia, reporte, verbal)
from etapas.util import Sesion, leer_json  # noqa: E402
import sintetico  # noqa: E402


@pytest.fixture(scope="module")
def sesion(tmp_path_factory):
    config.CARPETA_SESIONES = tmp_path_factory.mktemp("sesiones")
    config.USAR_SENTIMIENTO = False
    s = Sesion("sintetica")
    sintetico.crear(s)
    for etapa in (diarizacion, oradores, verbal):
        etapa.ejecutar(s)
    no_verbal.ejecutar(s, reusar_cuadros=True)
    for etapa in (prosodia, linea_tiempo, reporte):
        etapa.ejecutar(s)
    return s


def _oradores(s):
    with open(s.oradores_csv, encoding="utf-8-sig") as f:
        return {r["speaker_id"]: r for r in csv.DictReader(f)}


# --- turnos y ventanas -------------------------------------------------------

def test_turnos_y_ventanas(sesion):
    d = leer_json(sesion.turnos)
    assert len(d["turnos"]) == len(sintetico.GUION)
    assert [t["speaker_id"] for t in d["turnos"]] == [g[0] for g in sintetico.GUION]
    # ninguna ventana supera 1,5 veces el largo configurado
    assert all(v["duracion"] <= 1.5 * config.VENTANA_SEG + 1 for v in d["ventanas"])
    # las ventanas conservan todas las palabras
    n_t = sum(t["n_palabras"] for t in d["turnos"])
    n_v = sum(v["n_palabras"] for v in d["ventanas"])
    assert n_t == n_v


# --- nombres de oradores -----------------------------------------------------

def test_sugerencia_de_nombres(sesion):
    o = _oradores(sesion)
    assert o["SPEAKER_01"]["nombre_sugerido"] == "Senador Ramírez"
    assert o["SPEAKER_02"]["nombre_sugerido"] == "Senadora Contreras"
    assert o["SPEAKER_03"]["nombre_sugerido"] == "Ministra Soto"
    assert o["SPEAKER_00"]["nombre_sugerido"] == "Presidencia de la sesión"


def test_regex_no_captura_palabras_siguientes():
    turnos = [
        {"speaker_id": "A", "texto": "Tiene la palabra el senador Núñez para su intervención.",
         "inicio": 0, "breve": False},
        {"speaker_id": "B", "texto": "Gracias.", "inicio": 5, "breve": False},
    ]
    assert oradores.sugerir(turnos)["B"][0] == "Senador Núñez"


def test_nombres_manuales_se_conservan(sesion):
    filas = list(_oradores(sesion).values())
    filas[0]["nombre"] = "Nombre Corregido"
    with open(sesion.oradores_csv, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(filas[0].keys()))
        w.writeheader()
        w.writerows(filas)
    oradores.ejecutar(sesion)  # volver a correr no debe borrar la corrección
    assert _oradores(sesion)[filas[0]["speaker_id"]]["nombre"] == "Nombre Corregido"
    filas[0]["nombre"] = ""   # dejar como estaba para las demás pruebas
    with open(sesion.oradores_csv, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(filas[0].keys()))
        w.writeheader()
        w.writerows(filas)


# --- análisis verbal ---------------------------------------------------------

def test_consigna_repetida(sesion):
    r = leer_json(sesion.verbal)["por_orador"]["Senador Ramírez"]
    frases = dict((g, c) for g, c in r["consignas"])
    assert frases.get("la seguridad de las familias", 0) >= 3


def test_marcadores_distinguen_oradores(sesion):
    po = leer_json(sesion.verbal)["por_orador"]
    ram = po["Senador Ramírez"]["marcadores_por_mil"]
    con = po["Senadora Contreras"]["marcadores_por_mil"]
    assert ram["absolutos"] > con["absolutos"]
    assert con["datos_fuentes"] > ram["datos_fuentes"]
    assert con["cifras"] > 0


def test_keyness():
    from collections import Counter
    res = verbal._keyness(Counter({"familia": 10, "casa": 3}),
                          Counter({"casa": 30, "calle": 30}))
    assert res[0]["palabra"] == "familia" and res[0]["significativa"]


# --- no verbal, prosodia y línea de tiempo ----------------------------------

def test_no_verbal_filtra_rostro(sesion):
    nv = leer_json(sesion.no_verbal)
    lt = leer_json(sesion.linea_tiempo_json)["ventanas"]
    pres = [v for v in lt if v["orador"] == "Presidencia de la sesión"]
    assert all(not nv["por_ventana"][str(v["id"])]["rostro_parece_hablar"] for v in pres)
    assert "Presidencia de la sesión" not in nv["por_orador"]


def test_turno_enfatico_detectado(sesion):
    """El segundo turno de Ramírez fue generado con más tono, volumen y gestos."""
    lt = leer_json(sesion.linea_tiempo_json)["ventanas"]
    ram = [v for v in lt if v["orador"] == "Senador Ramírez"]
    turnos = sorted({v["turno_id"] for v in ram})
    primero = [v for v in ram if v["turno_id"] == turnos[0]]
    segundo = [v for v in ram if v["turno_id"] == turnos[-1]]
    assert max(v["activacion_vocal"] for v in segundo) > max(v["activacion_vocal"] for v in primero)
    assert max(v["activacion_corporal"] for v in segundo) > max(v["activacion_corporal"] for v in primero)
    assert segundo[0]["f0_media_hz"] > primero[0]["f0_media_hz"]


def test_prosodia_distingue_voces(sesion):
    lt = leer_json(sesion.linea_tiempo_json)["ventanas"]
    f0 = {v["orador"]: v["f0_media_hz"] for v in lt if v["f0_media_hz"]}
    assert f0["Senadora Contreras"] > f0["Senador Ramírez"]


def test_csv_y_reporte(sesion):
    with open(sesion.linea_tiempo_csv, encoding="utf-8-sig") as f:
        filas = list(csv.DictReader(f))
    assert len(filas) == len(leer_json(sesion.turnos)["ventanas"])
    assert "m_absolutos" in filas[0]
    html = sesion.reporte.read_text(encoding="utf-8")
    assert "Senador Ramírez" in html and "<svg" in html

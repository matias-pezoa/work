"""
Etapa 4 — Nombres de los oradores.

La diarización entrega hablantes anónimos (SPEAKER_00...). Esta etapa propone
un nombre para cada uno aprovechando el protocolo de la sala: quien preside
anuncia "Tiene la palabra el senador X" y el siguiente en hablar suele ser X.

Genera oradores.csv con una fila por hablante:
  speaker_id, nombre_sugerido, evidencia, n_turnos, tiempo_total_s,
  primer_turno, muestra_texto, nombre

Revisa el CSV (Excel lo abre) y escribe o corrige la columna "nombre".
Las etapas siguientes usan "nombre" si está llena y, si no, la sugerencia.
Volver a ejecutar esta etapa NO borra lo que escribiste en "nombre".
"""

import csv
import re
from collections import Counter, defaultdict

from etapas.util import Sesion, aviso, fmt_tiempo, leer_json

CARGOS = (r"senador|senadora|ministro|ministra|subsecretario|subsecretaria|"
          r"diputado|diputada|secretario|secretaria|presidente|presidenta|"
          r"prosecretario|prosecretaria")
NOMBRE = r"([A-ZÁÉÍÓÚÑ][a-záéíóúñü]+(?:\s+(?:de\s+la\s+|del\s+|de\s+)?[A-ZÁÉÍÓÚÑ][a-záéíóúñü]+){0,2})"

# Frases con que la presidencia cede la palabra. Las partes fijas ignoran
# mayúsculas (?i:...), pero el nombre exige mayúscula inicial para no capturar
# las palabras que siguen.
CESION = re.compile(
    r"(?i:(?:tiene\s+(?:el\s+uso\s+de\s+)?la\s+palabra|ofrezco\s+la\s+palabra|"
    r"le\s+(?:doy|damos|ofrezco|cedo)\s+la\s+palabra|puede\s+intervenir|"
    r"a\s+continuaci[oó]n|con\s+la\s+palabra)"
    r"[\s,]*(?:a\s+|al\s+)?(?:el\s+|la\s+)?(?:se[ñn]or(?:a)?\s+)?(?:" + CARGOS + r")\s+)" + NOMBRE
)
# "Senador X, tiene la palabra"
CESION_INV = re.compile(
    r"(?i:(?:" + CARGOS + r")\s+)" + NOMBRE + r"(?i:\s*,?\s*(?:tiene\s+(?:usted\s+)?la\s+palabra|puede\s+intervenir|le\s+ofrezco\s+la\s+palabra))"
)


def _cargo_nombre(match_text: str, nombre: str) -> str:
    cargo = re.search(r"\b(?:" + CARGOS + r")\b", match_text, re.IGNORECASE)
    cargo = cargo.group(0).capitalize() if cargo else ""
    return f"{cargo} {nombre}".strip()


def sugerir(turnos):
    votos = defaultdict(Counter)       # speaker -> Counter(nombre)
    cesiones_por_hablante = Counter()  # quién cede la palabra (presidencia)
    evidencia = defaultdict(list)

    for i, t in enumerate(turnos):
        for rx in (CESION, CESION_INV):
            for m in rx.finditer(t["texto"]):
                nombre = m.group(1).strip()
                # los nombres de una palabra que son comunes en minúscula se descartan
                if len(nombre) < 3:
                    continue
                etiqueta = _cargo_nombre(m.group(0), nombre)
                cesiones_por_hablante[t["speaker_id"]] += 1
                # siguiente turno sustantivo de OTRO hablante
                for sig in turnos[i + 1: i + 6]:
                    if sig["speaker_id"] != t["speaker_id"] and not sig["breve"]:
                        votos[sig["speaker_id"]][etiqueta] += 1
                        if len(evidencia[sig["speaker_id"]]) < 3:
                            evidencia[sig["speaker_id"]].append(
                                f"[{fmt_tiempo(t['inicio'])}] «{m.group(0)[:80]}»")
                        break

    sugerencias = {}
    for sid, c in votos.items():
        nombre, n = c.most_common(1)[0]
        total = sum(c.values())
        sugerencias[sid] = (nombre, f"{n}/{total} cesiones; " + " | ".join(evidencia[sid]))

    # El que más cede la palabra probablemente preside la sesión
    if cesiones_por_hablante:
        pres, n = cesiones_por_hablante.most_common(1)[0]
        if n >= 2 and pres not in sugerencias:
            sugerencias[pres] = ("Presidencia de la sesión",
                                 f"cede la palabra {n} veces")
    return sugerencias


def ejecutar(sesion: Sesion) -> None:
    turnos = leer_json(sesion.turnos)["turnos"]
    sug = sugerir(turnos)

    # Conservar nombres escritos a mano en una ejecución anterior
    previos = {}
    if sesion.oradores_csv.exists():
        with open(sesion.oradores_csv, encoding="utf-8-sig", newline="") as f:
            for fila in csv.DictReader(f):
                if (fila.get("nombre") or "").strip():
                    previos[fila["speaker_id"]] = fila["nombre"].strip()

    stats = defaultdict(lambda: {"n": 0, "t": 0.0, "primero": None, "muestra": ""})
    for t in turnos:
        s = stats[t["speaker_id"]]
        s["n"] += 1
        s["t"] += t["duracion"]
        if s["primero"] is None:
            s["primero"] = t["inicio"]
        if len(s["muestra"]) < 200 and not t["breve"]:
            s["muestra"] = (s["muestra"] + " " + t["texto"]).strip()[:240]

    filas = []
    for sid, s in sorted(stats.items(), key=lambda kv: -kv[1]["t"]):
        nombre_sug, evid = sug.get(sid, ("", ""))
        filas.append({
            "speaker_id": sid,
            "nombre_sugerido": nombre_sug,
            "evidencia": evid,
            "n_turnos": s["n"],
            "tiempo_total_s": round(s["t"], 1),
            "primer_turno": fmt_tiempo(s["primero"] or 0),
            "muestra_texto": s["muestra"],
            "nombre": previos.get(sid, ""),
        })

    # utf-8-sig para que Excel en Windows muestre bien los acentos
    with open(sesion.oradores_csv, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(filas[0].keys()))
        w.writeheader()
        w.writerows(filas)

    con_sug = sum(1 for f in filas if f["nombre_sugerido"] or f["nombre"])
    aviso(f"oradores.csv listo: {len(filas)} hablantes, {con_sug} con nombre "
          "sugerido o asignado. Revísalo y completa la columna 'nombre'.")

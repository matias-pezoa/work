"""
Etapa 9 — Reporte HTML autocontenido (se abre con doble clic en el navegador).

Secciones: resumen, tiempo de palabra, línea de tiempo, comparación de
marcadores retóricos, ficha por orador y transcripción anotada.
"""

import html
from collections import defaultdict

from etapas.util import Sesion, aviso, fmt_tiempo, leer_json

PALETA = ["#2f6fdf", "#d9542c", "#1f9e74", "#b8467f", "#c79a1a", "#6a55c9",
          "#2a9bb5", "#8a6b4a", "#5b8c2a", "#c0392b", "#4f6d8f", "#9c5bb5"]

ETIQUETAS = {
    "absolutos": "Absolutos", "nosotros": "Nosotros", "ellos": "Ellos",
    "amenaza": "Amenaza", "atenuadores": "Atenuadores",
    "intensificadores": "Intensificadores", "verdad_dada": "Verdad dada",
    "moral": "Moral", "datos_fuentes": "Datos/fuentes", "yo": "Yo",
    "negacion": "Negación", "cifras": "Cifras", "preguntas": "Preguntas",
}
MOSTRAR_MARCADORES = ["absolutos", "nosotros", "ellos", "amenaza", "verdad_dada",
                      "intensificadores", "atenuadores", "moral", "datos_fuentes",
                      "cifras", "preguntas", "yo"]


def e(x):
    return html.escape(str(x if x is not None else "—"))


def _num(x, dec=1, suf=""):
    return "—" if x is None else f"{x:.{dec}f}{suf}"


CSS = """
:root{--bg:#f7f6f3;--panel:#fff;--tx:#1d1d1f;--tx2:#5f5f66;--linea:#e3e1dc;--acento:#2f6fdf;
--suave:#f0eee9;--calor:#d9542c}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--panel:#1d1d21;--tx:#ececef;--tx2:#a0a0aa;
--linea:#2e2e34;--acento:#6b9bff;--suave:#26262b;--calor:#ff8a5c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);
font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 16px 80px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:40px 0 12px}
h3{font-size:16px;margin:0 0 8px}.sub{color:var(--tx2);margin:0 0 20px}
.panel{background:var(--panel);border:1px solid var(--linea);border-radius:12px;padding:18px;margin-bottom:14px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.kpi{background:var(--panel);border:1px solid var(--linea);border-radius:10px;padding:12px}
.kpi b{display:block;font-size:22px}.kpi span{color:var(--tx2);font-size:13px}
.nota{font-size:13px;color:var(--tx2);background:var(--suave);border-radius:8px;padding:10px 12px;margin:8px 0}
.barra{display:flex;align-items:center;gap:10px;margin:5px 0;font-size:14px}
.barra .n{width:200px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.barra .b{height:14px;border-radius:4px}.barra .v{color:var(--tx2);font-size:13px;white-space:nowrap}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:6px 8px;border-bottom:1px solid var(--linea);text-align:left;vertical-align:top}
th{color:var(--tx2);font-weight:600}td.c{text-align:center}
.tabla-scroll{overflow-x:auto}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media (max-width:720px){.grid2{grid-template-columns:1fr}.barra .n{width:120px}}
.nube span{display:inline-block;margin:2px 8px 2px 0;line-height:1.2}
.chip{display:inline-block;font-size:12px;padding:1px 8px;border-radius:99px;background:var(--suave);
color:var(--tx2);margin:2px 4px 2px 0}
.ficha{border-left:4px solid var(--c);}
.ficha .cab{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:baseline}
.mini{font-size:13px;color:var(--tx2)}
.turno{padding:10px 0;border-bottom:1px solid var(--linea);display:grid;grid-template-columns:70px 1fr;gap:10px}
.turno .t{color:var(--tx2);font-size:12px;font-variant-numeric:tabular-nums}
.turno .o{font-weight:600;font-size:13px}.turno.breve{opacity:.55}
svg text{fill:var(--tx2);font-size:11px}
details summary{cursor:pointer;color:var(--acento)}
"""


def _barras(items, maximo, color_fn, fmt):
    out = []
    for nombre, valor in items:
        ancho = 0 if not maximo else max(2, 100 * valor / maximo)
        out.append(
            f'<div class="barra"><div class="n" title="{e(nombre)}">{e(nombre)}</div>'
            f'<div style="flex:1"><div class="b" style="width:{ancho:.1f}%;background:{color_fn(nombre)}"></div></div>'
            f'<div class="v">{fmt(valor)}</div></div>')
    return "\n".join(out)


def _timeline_svg(turnos, oradores, color, duracion):
    """Una fila por orador; cada turno es un rectángulo. La opacidad indica la
    activación no verbal y un borde naranjo marca carga retórica alta."""
    filas = oradores[:14]
    alto_fila, izq, ancho = 22, 150, 900
    h = alto_fila * len(filas) + 30
    partes = [f'<svg viewBox="0 0 {izq + ancho + 10} {h}" width="100%" role="img" '
              f'aria-label="Línea de tiempo de turnos por orador">']
    for i, o in enumerate(filas):
        y = i * alto_fila
        partes.append(f'<text x="{izq - 8}" y="{y + 15}" text-anchor="end">{e(o[:22])}</text>')
        partes.append(f'<line x1="{izq}" x2="{izq + ancho}" y1="{y + 11}" y2="{y + 11}" '
                      f'stroke="currentColor" stroke-opacity=".08"/>')
    idx = {o: i for i, o in enumerate(filas)}
    for t in turnos:
        if t["orador"] not in idx:
            continue
        x = izq + ancho * t["inicio"] / duracion
        w = max(1.0, ancho * t["duracion"] / duracion)
        y = idx[t["orador"]] * alto_fila + 3
        act = t.get("activacion_no_verbal")
        op = 0.35 if act is None else min(1.0, max(0.25, 0.6 + 0.2 * act))
        borde = ""
        if (t.get("z_carga_retorica") or 0) > 1.0:
            borde = 'stroke="#ff7a45" stroke-width="1.5"'
        tip = (f"{fmt_tiempo(t['inicio'])} · {t['orador']} · carga {_num(t.get('carga_retorica'))}"
               f" · activación {_num(act, 2)}\n{t['texto'][:160]}")
        partes.append(f'<rect x="{x:.1f}" y="{y}" width="{w:.1f}" height="16" rx="2" '
                      f'fill="{color(t["orador"])}" fill-opacity="{op:.2f}" {borde}>'
                      f'<title>{e(tip)}</title></rect>')
    # eje de tiempo
    pasos = 6
    for k in range(pasos + 1):
        x = izq + ancho * k / pasos
        partes.append(f'<text x="{x:.0f}" y="{h - 6}" text-anchor="middle">'
                      f'{fmt_tiempo(duracion * k / pasos)}</text>')
    partes.append("</svg>")
    return "".join(partes)


def _tabla_marcadores(por_orador, oradores):
    cats = MOSTRAR_MARCADORES
    maximos = {c: max((por_orador[o]["marcadores_por_mil"].get(c, 0) for o in oradores), default=0)
               for c in cats}
    cab = "".join(f"<th class='c'>{ETIQUETAS.get(c, c)}</th>" for c in cats)
    filas = []
    for o in oradores:
        m = por_orador[o]["marcadores_por_mil"]
        celdas = []
        for c in cats:
            v = m.get(c, 0)
            a = 0 if not maximos[c] else v / maximos[c]
            celdas.append(f"<td class='c' style='background:rgba(217,84,44,{0.08 + 0.5 * a:.2f})'>{v:.1f}</td>")
        filas.append(f"<tr><td>{e(o)}</td>{''.join(celdas)}</tr>")
    return (f"<div class='tabla-scroll'><table><thead><tr><th>Orador</th>{cab}</tr></thead>"
            f"<tbody>{''.join(filas)}</tbody></table></div>")


def _nube(pares, color):
    if not pares:
        return "<span class='mini'>—</span>"
    mx = pares[0][1]
    return "<div class='nube'>" + "".join(
        f"<span style='font-size:{12 + 14 * c / mx:.0f}px;color:{color}' title='{c} veces'>{e(w)}</span>"
        for w, c in pares[:25]) + "</div>"


def _ficha(o, d, nv, pros_media, color):
    dist = d.get("palabras_distintivas", [])
    dist_html = " ".join(
        f"<span class='chip' title='LL {k['ll']} · {k['frec']} veces vs {k['frec_resto']} en el resto'>"
        f"{e(k['palabra'])}{' *' if k['significativa'] else ''}</span>" for k in dist[:15]) or "—"
    cons = "".join(f"<li>«{e(g)}» <span class='mini'>×{c}</span></li>"
                   for g, c in d.get("consignas", [])[:10]) or "<li class='mini'>Sin frases repetidas</li>"
    bi = ", ".join(f"{e(g)} ({c})" for g, c in d.get("top_bigramas", [])[:8]) or "—"
    emo = d.get("emociones") or {}
    emo_txt = ", ".join(f"{k} {100 * v:.0f}%" for k, v in sorted(emo.items(), key=lambda kv: -kv[1])
                        if k != "others" and v >= 0.05) or "—"

    nv_html = "<p class='mini'>Sin turnos donde su rostro aparezca hablando en pantalla.</p>"
    if nv:
        nv_html = (
            "<table><tbody>"
            f"<tr><td>Cuadros con su rostro</td><td>{nv.get('n_cuadros', 0)} cuadros · plano típico: {e(nv.get('tipo_plano'))}</td></tr>"
            f"<tr><td>Tensión del ceño</td><td>{_num(nv.get('tension_ceno'), 3)}</td></tr>"
            f"<tr><td>Cejas elevadas</td><td>{_num(nv.get('cejas_elevadas'), 3)}</td></tr>"
            f"<tr><td>Presión de labios</td><td>{_num(nv.get('presion_labios'), 3)}</td></tr>"
            f"<tr><td>Sonrisa</td><td>{_num(nv.get('sonrisa'), 3)}</td></tr>"
            f"<tr><td>Energía gestual (manos)</td><td>{_num(nv.get('energia_gestual'), 2)} anchos de hombro/s</td></tr>"
            f"<tr><td>Movimiento de cabeza</td><td>{_num(nv.get('movimiento_cabeza'), 1)} °/s</td></tr>"
            "</tbody></table>")

    pr = pros_media or {}
    return f"""
<div class="panel ficha" style="--c:{color}">
  <div class="cab"><h3>{e(o)}</h3>
  <span class="mini">{fmt_tiempo(d['tiempo_s'])} de palabra ({d['pct_tiempo']}%) · {d['n_turnos_sustantivos']} intervenciones ·
  {d['n_palabras']} palabras · {_num(d.get('velocidad_ppm'), 0)} pal/min · diversidad {_num(d.get('diversidad_mattr'), 2)}</span></div>
  <div class="grid2">
    <div>
      <p class="mini">Palabras más repetidas</p>{_nube(d.get('top_palabras', []), color)}
      <p class="mini" style="margin-top:12px">Palabras distintivas (más que el resto de la sesión; * = significativa p&lt;0,01)</p>
      <div>{dist_html}</div>
      <p class="mini" style="margin-top:12px">Expresiones de dos palabras</p><div style="font-size:13px">{bi}</div>
      <p class="mini" style="margin-top:12px">Frases que repite</p><ul style="margin:4px 0;padding-left:18px;font-size:13px">{cons}</ul>
    </div>
    <div>
      <p class="mini">Voz (promedio de sus turnos)</p>
      <table><tbody>
        <tr><td>Tono medio</td><td>{_num(pr.get('f0_media_hz'), 0, ' Hz')}</td></tr>
        <tr><td>Variación de tono</td><td>{_num(pr.get('f0_sd_st'), 2, ' semitonos')}</td></tr>
        <tr><td>Volumen medio</td><td>{_num(pr.get('intensidad_media_db'), 1, ' dB')}</td></tr>
        <tr><td>Velocidad de articulación</td><td>{_num(pr.get('velocidad_articulacion'), 2, ' pal/s')}</td></tr>
        <tr><td>Pausas</td><td>{_num(pr.get('pausas_por_min'), 1, ' /min')}</td></tr>
      </tbody></table>
      <p class="mini" style="margin-top:12px">Texto: polaridad {_num(d.get('polaridad_media'), 2)} (−1 negativa, +1 positiva) · emociones: {e(emo_txt)}</p>
      <p class="mini" style="margin-top:12px">Rostro y cuerpo</p>{nv_html}
    </div>
  </div>
</div>"""


def ejecutar(sesion: Sesion) -> None:
    lt = leer_json(sesion.linea_tiempo_json)["ventanas"]
    verbal = leer_json(sesion.verbal)
    nv = leer_json(sesion.no_verbal) if sesion.no_verbal.exists() else {}
    meta = leer_json(sesion.meta) if sesion.meta.exists() else {}
    por_orador = verbal["por_orador"]
    oradores = sorted(por_orador, key=lambda o: -por_orador[o]["tiempo_s"])
    colores = {o: PALETA[i % len(PALETA)] for i, o in enumerate(oradores)}
    color = lambda o: colores.get(o, "#888")
    duracion = meta.get("duracion_s") or max((t["fin"] for t in lt), default=1)

    # promedios de prosodia por orador
    acum = defaultdict(lambda: defaultdict(list))
    for t in lt:
        if t["breve"]:
            continue
        for c in ("f0_media_hz", "f0_sd_st", "intensidad_media_db",
                  "velocidad_articulacion", "pausas_por_min"):
            if t.get(c) is not None:
                acum[t["orador"]][c].append(t[c])
    pros_media = {o: {c: sum(v) / len(v) for c, v in d.items()} for o, d in acum.items()}

    diarizado = not all(t["speaker_id"] == "SIN_DIARIZAR" for t in lt)
    notas = []
    if not diarizado:
        notas.append("La sesión no se diarizó: todos los turnos aparecen como un solo hablante.")
    if not verbal["global"].get("lematizado"):
        notas.append("Sin spaCy: las palabras no se agruparon por lema (\"votar\" y \"votamos\" cuentan aparte).")
    if not verbal["global"].get("sentimiento"):
        notas.append("Sin pysentimiento: no hay polaridad ni emociones del texto.")
    if not nv:
        notas.append("Sin análisis de video (rostro y cuerpo).")

    tiempo_html = _barras([(o, por_orador[o]["tiempo_s"]) for o in oradores],
                          max((por_orador[o]["tiempo_s"] for o in oradores), default=0),
                          color, lambda v: fmt_tiempo(v))

    fichas = "\n".join(
        _ficha(o, por_orador[o], nv.get("por_orador", {}).get(o), pros_media.get(o), color(o))
        for o in oradores if por_orador[o]["n_palabras"] >= 30)

    # transcripción: una entrada por intervención; dentro, un párrafo por ventana
    por_turno = defaultdict(list)
    for t in lt:
        por_turno[t["turno_id"]].append(t)
    trans = []
    for _, vs in sorted(por_turno.items()):
        t0 = vs[0]
        parrafos = []
        for t in vs:
            chips = []
            if t.get("z_carga_retorica") is not None and t["z_carga_retorica"] > 1:
                chips.append("<span class='chip' style='color:var(--calor)'>carga retórica alta</span>")
            if t.get("activacion_no_verbal") is not None and t["activacion_no_verbal"] > 1:
                chips.append("<span class='chip'>activación no verbal alta</span>")
            if t.get("emocion_dominante"):
                chips.append(f"<span class='chip'>{e(t['emocion_dominante'])}</span>")
            pref = f"<span class='t'>{fmt_tiempo(t['inicio'])}</span> " if len(vs) > 1 else ""
            parrafos.append(f"<p style='margin:4px 0'>{pref}{''.join(chips)}{e(t['texto'])}</p>")
        trans.append(
            f"<div class='turno{' breve' if t0['breve'] else ''}'><div class='t'>{fmt_tiempo(t0['inicio'])}</div>"
            f"<div><span class='o' style='color:{color(t0['orador'])}'>{e(t0['orador'])}</span>"
            f"{''.join(parrafos)}</div></div>")
    n_interv = len({t["turno_id"] for t in lt if not t["breve"]})

    g = verbal["global"]
    doc = f"""<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Análisis de sesión · {e(sesion.nombre)}</title><style>{CSS}</style></head><body><main>
<h1>Análisis de sesión: {e(sesion.nombre)}</h1>
<p class="sub">{e(meta.get('fuente', ''))}</p>
<div class="kpis">
  <div class="kpi"><b>{fmt_tiempo(duracion)}</b><span>duración analizada</span></div>
  <div class="kpi"><b>{len(oradores)}</b><span>oradores</span></div>
  <div class="kpi"><b>{n_interv}</b><span>intervenciones</span></div>
  <div class="kpi"><b>{g['n_palabras']:,}</b><span>palabras</span></div>
</div>
{''.join(f'<div class="nota">{e(n)}</div>' for n in notas)}

<h2>Tiempo de palabra</h2><div class="panel">{tiempo_html}</div>

<h2>Línea de tiempo</h2>
<div class="panel">{_timeline_svg(lt, oradores, color, duracion)}
<p class="mini">Cada rectángulo es un tramo de ~20 s de una intervención. Más opaco = mayor activación no verbal (voz y cuerpo, respecto del propio orador).
Borde naranjo = carga retórica alta respecto de la sesión. Pasa el cursor sobre un tramo para ver el texto.</p></div>

<h2>Marcadores retóricos (por cada 1.000 palabras)</h2>
<div class="panel">{_tabla_marcadores(por_orador, oradores)}
<p class="mini">Léxicos editables en <code>etapas/lexicos.py</code>. Son una operacionalización de autor: describen rasgos del discurso, no prueban intención.</p></div>

<h2>Palabras más usadas en la sesión</h2>
<div class="panel">{_nube(g.get('top_palabras', []), 'var(--acento)')}</div>

<h2>Oradores</h2>
{fichas}

<h2>Transcripción anotada</h2>
<div class="panel"><details><summary>Mostrar transcripción completa ({len(por_turno)} intervenciones)</summary>
{''.join(trans)}</details></div>

<p class="mini" style="margin-top:40px">Transcripción automática: puede contener errores, sobre todo en nombres propios y cuando hablan varias personas a la vez.
Los índices de expresión facial describen movimientos observables (blendshapes de MediaPipe), no emociones internas.</p>
</main></body></html>"""
    with open(sesion.reporte, "w", encoding="utf-8") as f:
        f.write(doc)
    aviso(f"Reporte listo: {sesion.reporte}")

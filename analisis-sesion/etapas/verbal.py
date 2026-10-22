"""
Etapa 5 — Análisis verbal.

Por orador:
  - tiempo de palabra, n.º de palabras, velocidad (palabras/min)
  - diversidad léxica (MATTR: proporción de palabras distintas en ventanas de 100)
  - palabras más repetidas (lemas de contenido, sin palabras vacías)
  - bigramas y trigramas más frecuentes
  - palabras distintivas (keyness): las que un orador usa mucho más que el resto
    de la sesión, medidas con log-likelihood de Dunning
  - "consignas": frases de 3-5 palabras que el mismo orador repite
  - marcadores retóricos por cada 1.000 palabras (ver lexicos.py)
  - sentimiento y emoción del texto (pysentimiento, opcional)

Por ventana (~20 s): marcadores, cifras, preguntas y sentimiento, para la
línea de tiempo.

Salida: verbal.json
"""

import math
import re
from collections import Counter, defaultdict

import config
from etapas.lexicos import MARCADORES
from etapas.util import Sesion, aviso, guardar_json, leer_json, nombres_oradores

POS_CONTENIDO = {"NOUN", "PROPN", "VERB", "ADJ", "ADV"}
RX_PALABRA = re.compile(r"[a-záéíóúüñ]+(?:['-][a-záéíóúüñ]+)*", re.IGNORECASE)
RX_CIFRA = re.compile(r"\d")


# ---------------------------------------------------------------------------
# Procesamiento lingüístico
# ---------------------------------------------------------------------------

def _stopwords():
    try:
        from spacy.lang.es.stop_words import STOP_WORDS
        base = set(STOP_WORDS)
    except Exception:
        base = set("""a al algo algunas algunos ante antes como con contra cual cuando de del
        desde donde durante e el ella ellas ellos en entre era es esa esas ese eso esos esta
        estas este esto estos fue ha hay la las le les lo los mas me mi muy nada ni no nos o
        otra otro para pero por porque que quien se sea ser si sin sobre son su sus también
        te tiene todo un una uno unos y ya yo""".split())
    return base | config.STOPWORDS_CONTEXTO


def _cargar_nlp():
    try:
        import spacy
        nlp = spacy.load(config.SPACY_MODELO, disable=["parser", "ner"])
        aviso(f"spaCy '{config.SPACY_MODELO}' cargado.")
        return nlp
    except Exception as e:
        aviso(f"spaCy no disponible ({e.__class__.__name__}); "
              "uso tokenizador simple (sin lematizar).")
        return None


def _tokenizar(textos, nlp):
    """Devuelve por texto una lista de tokens {t: forma, l: lema, pos}."""
    salida = []
    if nlp is not None:
        for doc in nlp.pipe(textos, batch_size=64):
            salida.append([
                {"t": tok.text.lower(), "l": tok.lemma_.lower(), "pos": tok.pos_}
                for tok in doc if RX_PALABRA.fullmatch(tok.text)
            ])
    else:
        for tx in textos:
            salida.append([{"t": w.lower(), "l": w.lower(), "pos": None}
                           for w in RX_PALABRA.findall(tx)])
    return salida


def _es_contenido(tok, stop):
    if tok["l"] in stop or tok["t"] in stop or len(tok["t"]) < 3:
        return False
    return tok["pos"] is None or tok["pos"] in POS_CONTENIDO


# ---------------------------------------------------------------------------
# Métricas
# ---------------------------------------------------------------------------

def _mattr(tokens, ventana=100):
    if not tokens:
        return None
    if len(tokens) <= ventana:
        return len(set(tokens)) / len(tokens)
    cuenta = Counter(tokens[:ventana])
    valores = [len(cuenta) / ventana]
    for i in range(ventana, len(tokens)):
        cuenta[tokens[i]] += 1
        sale = tokens[i - ventana]
        cuenta[sale] -= 1
        if cuenta[sale] == 0:
            del cuenta[sale]
        valores.append(len(cuenta) / ventana)
    return sum(valores) / len(valores)


def _ngramas(tokens_forma, n, stop):
    out = Counter()
    for i in range(len(tokens_forma) - n + 1):
        g = tokens_forma[i:i + n]
        # descarta n-gramas que empiezan o terminan en palabra vacía
        if g[0] in stop or g[-1] in stop:
            continue
        out[" ".join(g)] += 1
    return out


def _consignas(turnos_tokens, stop):
    """Frases de 3-5 palabras repetidas por el mismo orador. Se cuentan dentro de
    cada turno (no cruzan de un turno a otro) y se eliminan las que están
    contenidas en una más larga con la misma frecuencia."""
    conteo = Counter()
    for toks in turnos_tokens:
        formas = [t["t"] for t in toks]
        for n in config.CONSIGNA_N:
            for i in range(len(formas) - n + 1):
                g = formas[i:i + n]
                if sum(1 for w in g if w not in stop) < 2:
                    continue
                conteo[" ".join(g)] += 1
    rep = {g: c for g, c in conteo.items() if c >= config.CONSIGNA_MIN_REPETICIONES}
    finales = {}
    for g, c in sorted(rep.items(), key=lambda kv: -len(kv[0])):
        if any(g in h and finales[h] >= c for h in finales):
            continue
        finales[g] = c
    return sorted(finales.items(), key=lambda kv: (-kv[1], -len(kv[0])))[:config.TOP_NGRAMAS]


def _keyness(frec_obj: Counter, frec_resto: Counter, min_frec=3, top=25):
    c, d = sum(frec_obj.values()), sum(frec_resto.values())
    if c == 0 or d == 0:
        return []
    res = []
    for w, a in frec_obj.items():
        if a < min_frec:
            continue
        b = frec_resto.get(w, 0)
        if a / c <= b / d:
            continue  # solo palabras sobreusadas por este orador
        e1 = c * (a + b) / (c + d)
        e2 = d * (a + b) / (c + d)
        ll = 2 * (a * math.log(a / e1) + (b * math.log(b / e2) if b else 0))
        log_ratio = math.log2(((a + 0.5) / c) / ((b + 0.5) / d))
        res.append({"palabra": w, "frec": a, "frec_resto": b,
                    "ll": round(ll, 2), "log_ratio": round(log_ratio, 2),
                    "significativa": ll >= 6.63})  # p < 0,01
    res.sort(key=lambda r: -r["ll"])
    return res[:top]


def _marcadores(texto: str, n_palabras: int):
    t = " " + texto.lower() + " "
    cuentas = {}
    for cat, lista in MARCADORES.items():
        n = 0
        for expr in lista:
            n += len(re.findall(r"(?<![\wáéíóúüñ])" + re.escape(expr) + r"(?![\wáéíóúüñ])", t))
        cuentas[cat] = n
    cuentas["cifras"] = len(re.findall(r"\d+(?:[.,]\d+)*", texto))
    cuentas["preguntas"] = texto.count("?")
    return cuentas


def _por_mil(cuentas: dict, n: int):
    return {k: round(1000 * v / n, 2) if n else 0.0 for k, v in cuentas.items()}


# ---------------------------------------------------------------------------
# Sentimiento (opcional)
# ---------------------------------------------------------------------------

def _sentimiento(turnos):
    if not config.USAR_SENTIMIENTO:
        return {}
    try:
        from pysentimiento import create_analyzer
    except ImportError:
        aviso("pysentimiento no instalado: se omite sentimiento/emoción.")
        return {}
    try:
        aviso("Cargando pysentimiento (la primera vez descarga modelos)...")
        an_sent = create_analyzer(task="sentiment", lang="es")
        an_emo = create_analyzer(task="emotion", lang="es")
    except Exception as e:
        aviso(f"No se pudo cargar pysentimiento ({e}); se omite.")
        return {}

    res = {}
    for t in turnos:
        if t["n_palabras"] < 4:
            continue
        # el modelo acepta ~128 tokens: se trocea por oraciones y se promedia
        trozos, actual = [], ""
        for frase in re.split(r"(?<=[.!?])\s+", t["texto"]):
            if len((actual + " " + frase).split()) > 90 and actual:
                trozos.append(actual)
                actual = frase
            else:
                actual = (actual + " " + frase).strip()
        if actual:
            trozos.append(actual)
        s_acum, e_acum, pesos = Counter(), Counter(), 0
        for tr in trozos:
            w = len(tr.split())
            for k, v in an_sent.predict(tr).probas.items():
                s_acum[k] += v * w
            for k, v in an_emo.predict(tr).probas.items():
                e_acum[k] += v * w
            pesos += w
        sent = {k: round(v / pesos, 3) for k, v in s_acum.items()}
        emo = {k: round(v / pesos, 3) for k, v in e_acum.items()}
        res[t["id"]] = {
            "sentimiento": sent,
            "polaridad": round(sent.get("POS", 0) - sent.get("NEG", 0), 3),
            "emocion": emo,
            "emocion_dominante": max(
                (k for k in emo if k != "others"), key=lambda k: emo[k], default=None),
        }
    return res


# ---------------------------------------------------------------------------

def ejecutar(sesion: Sesion) -> None:
    datos = leer_json(sesion.turnos)
    ventanas = datos["ventanas"]
    nombres = nombres_oradores(sesion)
    stop = _stopwords()
    nlp = _cargar_nlp()

    aviso("Tokenizando y lematizando...")
    toks_v = _tokenizar([v["texto"] for v in ventanas], nlp)
    sent = _sentimiento(ventanas)

    duracion_total = sum(v["duracion"] for v in ventanas) or 1.0

    # --- por ventana (unidad de la línea de tiempo) ---
    por_ventana = {}
    for v, toks in zip(ventanas, toks_v):
        n = len(toks)
        m = _marcadores(v["texto"], n)
        carga = sum(m[k] for k in ("absolutos", "amenaza", "intensificadores",
                                   "verdad_dada", "ellos"))
        fila = {
            "orador": nombres.get(v["speaker_id"], v["speaker_id"]),
            "n_palabras": n,
            "velocidad_ppm": round(60 * n / v["duracion"], 1) if v["duracion"] > 0 else None,
            "marcadores": m,
            # índice exploratorio: marcadores de énfasis/polarización por 100 palabras
            "carga_retorica": round(100 * carga / n, 2) if n else 0.0,
        }
        fila.update(sent.get(v["id"], {}))
        por_ventana[v["id"]] = fila

    # --- agrupar por orador (por nombre: dos ids con el mismo nombre se funden) ---
    grupos = defaultdict(list)
    for v, toks in zip(ventanas, toks_v):
        grupos[nombres.get(v["speaker_id"], v["speaker_id"])].append((v, toks))

    lemas_orador = {o: Counter(tk["l"] for _, toks in g for tk in toks if _es_contenido(tk, stop))
                    for o, g in grupos.items()}
    lemas_total = Counter()
    for c in lemas_orador.values():
        lemas_total.update(c)

    por_orador = {}
    for orador, g in grupos.items():
        formas = [tk["t"] for _, toks in g for tk in toks]
        n = len(formas)
        dur = sum(v["duracion"] for v, _ in g)
        texto = " ".join(v["texto"] for v, _ in g)
        cuentas = _marcadores(texto, n)
        resto = lemas_total - lemas_orador[orador]

        # tokens reunidos por turno: n-gramas y consignas no cruzan de un turno a otro
        por_turno = defaultdict(list)
        for v, toks in g:
            por_turno[v["turno_id"]].extend(toks)
        bigr, trig = Counter(), Counter()
        for toks in por_turno.values():
            f = [tk["t"] for tk in toks]
            bigr.update(_ngramas(f, 2, stop))
            trig.update(_ngramas(f, 3, stop))

        pols = [por_ventana[v["id"]].get("polaridad") for v, _ in g
                if por_ventana[v["id"]].get("polaridad") is not None]
        emos = Counter()
        for v, _ in g:
            for k, x in (por_ventana[v["id"]].get("emocion") or {}).items():
                emos[k] += x * por_ventana[v["id"]]["n_palabras"]
        tot_emo = sum(emos.values())

        por_orador[orador] = {
            "speaker_ids": sorted({v["speaker_id"] for v, _ in g}),
            "n_turnos": len(por_turno),
            "n_turnos_sustantivos": len({v["turno_id"] for v, _ in g if not v["breve"]}),
            "tiempo_s": round(dur, 1),
            "pct_tiempo": round(100 * dur / duracion_total, 1),
            "n_palabras": n,
            "velocidad_ppm": round(60 * n / dur, 1) if dur else None,
            "diversidad_mattr": round(_mattr(formas) or 0, 3),
            "top_palabras": lemas_orador[orador].most_common(config.TOP_PALABRAS),
            "top_bigramas": bigr.most_common(config.TOP_NGRAMAS),
            "top_trigramas": trig.most_common(config.TOP_NGRAMAS),
            "palabras_distintivas": _keyness(lemas_orador[orador], resto),
            "consignas": _consignas(list(por_turno.values()), stop),
            "marcadores": cuentas,
            "marcadores_por_mil": _por_mil(cuentas, n),
            "polaridad_media": round(sum(pols) / len(pols), 3) if pols else None,
            "emociones": {k: round(x / tot_emo, 3) for k, x in emos.items()} if tot_emo else None,
        }

    total_palabras = sum(len(t) for t in toks_v)
    guardar_json(sesion.verbal, {
        "global": {
            "n_palabras": total_palabras,
            "n_oradores": len(por_orador),
            "top_palabras": lemas_total.most_common(config.TOP_PALABRAS),
            "lematizado": nlp is not None,
            "sentimiento": bool(sent),
        },
        "por_orador": por_orador,
        "por_ventana": por_ventana,
    })
    aviso(f"Análisis verbal listo: {total_palabras} palabras, {len(por_orador)} oradores.")

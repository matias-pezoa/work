# -*- coding: utf-8 -*-
"""
build_dataset.py — pipeline de curado del dataset de perfumes.

Entrada:
  perfume_dataset.csv        fuente cruda (Perfumes_Recommender / goldenscent)
  perfume_visualization.raw.json  proyeccion previa (arrays de notas ya parseados)

Salida:
  perfume_visualization.json  dataset curado que consume index.html

Que hace, y por que:
  - descarta product_type no vestibles (velas, difusores, bakhoor, hair mist...)
  - unifica marcas escritas de varias formas ("Dolce&Gabbana" / "Dolce & Gabbana")
  - limpia el campo name (saca sufijos de tamano y concentracion)
  - normaliza fragrance_family (espacios, tokens duplicados, combos)
  - canonicaliza el vocabulario de notas (cedarwood -> cedar, etc.)
  - deduplica (misma marca + mismo nombre + mismo anio -> 1 registro)
  - conserva price / gender / concentration / size / product_type
"""

import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).parent
CSV_IN = HERE / "perfume_dataset.csv"
RAW_JSON = HERE / "perfume_visualization.raw.json"
JSON_OUT = HERE / "perfume_visualization.json"

# product_type que SI son una fragancia que se lleva puesta (piramide olfativa real).
# se descartan sets/bundles (varios productos, nombre basura) y todo lo no vestible
# (candle, diffuser, room spray, bakhoor, hair mist, body mist, body lotion...)
KEEP_PRODUCT_TYPES = {
    "perfume", "perfume oil", "oud", "", "extrait de parfum",
}

# el source etiqueta mal algunos: bakhoor/difusores/velas/brumas vienen como
# "Perfume". se cazan por el propio nombre, sin importar el product_type.
NAME_BLOCKLIST = re.compile(
    r"\b(bakhoor|incense stick|scented candle|candle jar|diffuser|room spray|"
    r"hair mist|hair fragrance|body mist|body lotion|shower gel|shaving gel|"
    r"after ?shave|deodorant|gift set|travel set|\bset\b|refill|bouquet)\b",
    re.I,
)

# ------------------------------------------------------------------ notas

# reescrituras de alta confianza: variantes que son el mismo material.
# clave = forma normalizada (minuscula, sin puntuacion final) -> etiqueta canonica
NOTE_SYNONYMS = {
    "cedarwood": "Cedar",
    "cedar wood": "Cedar",
    "virginia cedar": "Cedar",
    "atlas cedar": "Cedar",
    "mandarin orange": "Mandarin",
    "blood mandarin": "Mandarin",
    "cassis": "Blackcurrant",
    "black currant": "Blackcurrant",
    "blackcurrant (cassis)": "Blackcurrant",
    "ylang ylang": "Ylang-ylang",
    "ylang-ylang": "Ylang-ylang",
    "guaiacwood": "Guaiac wood",
    "guaiac": "Guaiac wood",
    "guaiac-wood": "Guaiac wood",
    "woods": "Woody notes",
    "wood": "Woody notes",
    "woody note": "Woody notes",
    "sweet notes": "Sweet notes",
    "sandal": "Sandalwood",
    "sandalwoods": "Sandalwood",
    "tonka": "Tonka bean",
    "tonka beans": "Tonka bean",
    "orange blossoms": "Orange blossom",
    "lily-of-the-valley": "Lily of the valley",
    "muguet": "Lily of the valley",
    "rose absolute": "Rose",
    "roses": "Rose",
    "bulgarian rose": "Rose",
    "damask rose": "Rose",
    "turkish rose": "Rose",
    "may rose": "Rose",
    "centifolia rose": "Rose",
    "jasmine sambac": "Jasmine",
    "sambac jasmine": "Jasmine",
    "jasmin": "Jasmine",
    "egyptian jasmine": "Jasmine",
    "citruses": "Citrus",
    "citrus notes": "Citrus",
    "citrus oils": "Citrus",
    "bergamote": "Bergamot",
    "calabrian bergamot": "Bergamot",
    "sicilian lemon": "Lemon",
    "lemons": "Lemon",
    "amber notes": "Amber",
    "ambergris": "Ambergris",
    "white amber": "Amber",
    "musks": "Musk",
    "musk notes": "Musk",
    "patchouli leaf": "Patchouli",
    "indonesian patchouli": "Patchouli",
    "vanilla orchid": "Vanilla",
    "vanilla bean": "Vanilla",
    "bourbon vanilla": "Vanilla",
    "madagascar vanilla": "Vanilla",
    "vetyver": "Vetiver",
    "haitian vetiver": "Vetiver",
    "leathers": "Leather",
    "leather accord": "Leather",
    "iso e super": "Iso E Super",
    "pink peppercorn": "Pink pepper",
    "pink peppercorns": "Pink pepper",
    "peppercorn": "Black pepper",
    "black peppercorn": "Black pepper",
    "grapefruits": "Grapefruit",
    "pink grapefruit": "Grapefruit",
    "tangerines": "Tangerine",
    "mandarine": "Mandarin",
}

SENTINEL_NOTES = {"unknown", "n/a", "na", "none", "-", "other", "others", "notes"}


_MOJI_CHARS = chr(0xC3) + chr(0xC2) + chr(0xE2) + chr(0x20AC) + chr(0x2122) + chr(0x0192)


def _weirdness(s):
    return sum(1 for c in s if c in _MOJI_CHARS)


def fix_mojibake(s):
    """el CSV trae UTF-8 mal decodificado como CP1252, a veces dos o tres veces
    (LancÃƒÂ´me -> Lancôme, Lâ€™Ambre -> L'Ambre). se reaplica el roundtrip
    cp1252/utf-8 mientras el ruido siga bajando."""
    if not s or _weirdness(s) == 0:
        return s
    best, cur = s, s
    for _ in range(4):
        try:
            cur = cur.encode("cp1252").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            break
        if _weirdness(cur) < _weirdness(best):
            best = cur
        if _weirdness(cur) == 0:
            break
    return (best.replace(chr(0x2019), "'").replace(chr(0x2018), "'")
            .replace(chr(0xFFFD), "").replace("  ", " ").strip())


def norm_note(tok):
    return re.sub(r"\s+", " ", (tok or "").strip()).strip(" .").lower()


def canon_note(tok):
    raw = fix_mojibake(re.sub(r"\s+", " ", (tok or "").strip()).strip(" ."))
    if not raw:
        return None
    key = raw.lower()
    if key in SENTINEL_NOTES:
        return None
    if key in NOTE_SYNONYMS:
        return NOTE_SYNONYMS[key]
    return raw


def clean_note_list(raw_list):
    out, seen = [], set()
    for tok in raw_list or []:
        c = canon_note(tok)
        if not c:
            continue
        k = c.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(c)
    return out


# ------------------------------------------------------------------ marca

def brand_key(b):
    return re.sub(r"[^a-z0-9]", "", (b or "").lower())


def build_brand_canon(rows):
    """key normalizada -> forma de display preferida (la mas frecuente;
    a igualdad, la que tiene espacios / la mas larga)."""
    variants = defaultdict(Counter)
    for r in rows:
        b = (r.get("brand") or "").strip()
        if b:
            variants[brand_key(b)][b] += 1
    canon = {}
    for k, counter in variants.items():
        best = sorted(counter.items(), key=lambda kv: (-kv[1], -(" " in kv[0]), -len(kv[0])))[0][0]
        canon[k] = best
    return canon


# ------------------------------------------------------------------ nombre

CONC_TOKENS = [
    "eau de parfum intense", "eau de parfum", "eau de toilette", "eau de cologne",
    "extrait de parfum", "eau fraiche", "parfum", "edp", "edt", "edc",
]


def clean_name(name, brand):
    n = fix_mojibake(re.sub(r"\s+", " ", (name or "").strip()))
    # sufijo de tamano:  " - 100 ml" / "- 60 gm" / "- 130 g" / "100ml"
    n = re.sub(r"\s*[-–]\s*\d+(\.\d+)?\s*(ml|gm|g|oz)\b.*$", "", n, flags=re.I)
    n = re.sub(r"\s+\d+(\.\d+)?\s*(ml|gm|g|oz)\b\s*$", "", n, flags=re.I)
    # sufijo de concentracion pegado al final del nombre
    low = n.lower()
    for t in CONC_TOKENS:
        if low.endswith(" " + t):
            n = n[: -(len(t) + 1)].rstrip(" -–")
            low = n.lower()
    # marca repetida dos veces:  "Roberto Cavalli Uomo Roberto Cavalli"
    if brand:
        b = brand.strip()
        if n.lower().startswith(b.lower()) and n.lower().rstrip().endswith(b.lower()) and len(n) > 2 * len(b):
            n = n[: -len(b)].rstrip(" -–")
    return n.strip() or (name or "").strip()


def name_dedupe_key(name):
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


# ------------------------------------------------------------------ familia

def clean_family(raw):
    if not raw:
        return ""
    toks, seen = [], set()
    for part in str(raw).split(","):
        p = re.sub(r"\s+", " ", part.strip())
        if not p:
            continue
        k = p.lower()
        if k in ("unknown", "n/a", "none"):
            continue
        if k in seen:
            continue
        seen.add(k)
        toks.append(p.title())
    # se separa con coma: index.html divide fragrance_family por coma
    return ", ".join(toks)


# ------------------------------------------------------------------ carga

def load_csv_index():
    idx = {}
    with open(CSV_IN, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            idx[row["perfume_id"]] = row
    return idx


def to_float(v):
    try:
        f = float(str(v).strip())
        return f if f == f else None  # descarta NaN
    except (TypeError, ValueError):
        return None


def to_int(v):
    f = to_float(v)
    return int(round(f)) if f is not None else None


def main():
    if not RAW_JSON.exists():
        if JSON_OUT.exists():
            print(f"-> respaldo {JSON_OUT.name} como {RAW_JSON.name}")
            RAW_JSON.write_bytes(JSON_OUT.read_bytes())
        else:
            sys.exit("falta perfume_visualization.raw.json (o el .json original)")

    raw = json.loads(RAW_JSON.read_text(encoding="utf-8"))
    csv_idx = load_csv_index()
    brand_canon = build_brand_canon(raw)

    kept, dropped_type, dropped_name = [], 0, 0
    for r in raw:
        meta = csv_idx.get(r.get("perfume_id"), {})
        ptype = (meta.get("product_type") or "").strip().lower()
        if ptype and ptype not in KEEP_PRODUCT_TYPES:
            dropped_type += 1
            continue

        brand = fix_mojibake(brand_canon.get(brand_key(r.get("brand")), (r.get("brand") or "").strip()))
        name = clean_name(r.get("name"), brand)
        if NAME_BLOCKLIST.search(name):
            dropped_name += 1
            continue

        gender = (r.get("gender") or "").strip()
        if gender == "Home":
            gender = "Unisex"

        top = clean_note_list(r.get("top_notes"))
        mid = clean_note_list(r.get("middle_notes"))
        base = clean_note_list(r.get("base_notes"))

        rec = {
            "perfume_id": r.get("perfume_id"),
            "name": name,
            "brand": brand,
            "year": to_int(r.get("year")),
            "gender": gender,
            "product_type": (meta.get("product_type") or "").strip(),
            "fragrance_family": clean_family(r.get("fragrance_family")),
            "concentration": (r.get("concentration") or meta.get("concentration") or "").strip(),
            "size": (meta.get("size") or "").strip(),
            "price": to_float(r.get("price") if r.get("price") is not None else meta.get("price")),
            "rate": to_float(r.get("rate")),
            "rating_count": to_int(r.get("rating_count")),
            "top_notes": top,
            "middle_notes": mid,
            "base_notes": base,
        }
        rec["_notes_total"] = len(top) + len(mid) + len(base)
        kept.append(rec)

    # dedupe: misma marca + nombre + anio
    groups = defaultdict(list)
    for rec in kept:
        key = (brand_key(rec["brand"]), name_dedupe_key(rec["name"]), rec["year"])
        groups[key].append(rec)

    deduped, dropped_dupes = [], 0
    for recs in groups.values():
        if len(recs) == 1:
            deduped.append(recs[0])
            continue
        # se queda el mas completo: con rate > mas notas > concentracion definida
        recs.sort(key=lambda x: (
            x["rate"] is not None,
            x["_notes_total"],
            bool(x["concentration"]),
            bool(x["price"]),
        ), reverse=True)
        deduped.append(recs[0])
        dropped_dupes += len(recs) - 1

    # descarta registros sin ninguna nota (no aportan composicion)
    final = [r for r in deduped if r["_notes_total"] > 0]
    dropped_empty = len(deduped) - len(final)
    for r in final:
        del r["_notes_total"]

    final.sort(key=lambda r: (-(r["rating_count"] or 0), r["name"]))
    JSON_OUT.write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")

    note_keys = {n.lower() for r in final for n in r["top_notes"] + r["middle_notes"] + r["base_notes"]}
    with_price = sum(1 for r in final if r["price"] is not None)
    with_rate = sum(1 for r in final if r["rate"] is not None)
    with_year = sum(1 for r in final if r["year"] is not None)

    print(f"""
  entrada cruda .............. {len(raw)}
  - product_type no vestible . {dropped_type}
  - nombre no-perfume ....... {dropped_name}
  - duplicados .............. {dropped_dupes}
  - sin notas ............... {dropped_empty}
  = dataset curado ......... {len(final)}

  marcas canonicas ......... {len({brand_key(r['brand']) for r in final})}
  vocabulario de notas ..... {len(note_keys)}  (antes ~2920)
  con price ................ {with_price}/{len(final)}
  con rate ................. {with_rate}/{len(final)}
  con year ................. {with_year}/{len(final)}
  -> {JSON_OUT.name}
""")


if __name__ == "__main__":
    main()

// Núcleo del análisis en el navegador: port de etapas/*.py a JavaScript.
// Funciones puras (sin DOM), para poder recalcular todo al instante cuando se
// cambia el número de oradores o sus nombres, y para probarlas con Node.

export const CONFIG = {
  TURNO_PAUSA_MAX: 2.0,
  TURNO_DURACION_MIN: 1.0,
  VENTANA_SEG: 20,
  TOP_PALABRAS: 30,
  TOP_NGRAMAS: 20,
  CONSIGNA_MIN_REPETICIONES: 2,
  CONSIGNA_N: [3, 4, 5],
  PITCH_MIN_HZ: 70,
  PITCH_MAX_HZ: 400,
  UMBRAL_CAMBIO_PLANO: 0.45,
  // diarización en el navegador
  SEGMENTO_PAUSA: 0.4,     // un silencio mayor corta el segmento de voz
  SEGMENTO_MAX: 6.0,       // largo máximo de un segmento (s)
};

export const MARCADORES = {
  absolutos: ["siempre", "nunca", "jamás", "todos", "todas", "nadie", "nada",
    "ninguno", "ninguna", "ningún", "totalmente", "absolutamente",
    "completamente", "sin excepción", "de ninguna manera", "en ningún caso",
    "cien por ciento"],
  nosotros: ["nosotros", "nosotras", "nuestro", "nuestra", "nuestros", "nuestras",
    "los chilenos", "las chilenas", "chilenos y chilenas", "el pueblo",
    "la gente", "las familias", "la ciudadanía", "los vecinos",
    "el país", "la patria"],
  ellos: ["ellos", "ellas", "el gobierno", "la oposición", "la izquierda",
    "la derecha", "el oficialismo", "algunos", "esos", "aquellos",
    "los mismos de siempre", "la élite", "los poderosos", "los de siempre"],
  amenaza: ["crisis", "amenaza", "amenazas", "peligro", "peligroso", "riesgo",
    "miedo", "temor", "inseguridad", "delincuencia", "delincuentes",
    "crimen", "criminales", "violencia", "caos", "colapso", "destrucción",
    "emergencia", "catástrofe", "terror", "terrorismo", "terroristas",
    "narcotráfico", "desastre", "abismo", "alarma", "alarmante", "grave",
    "gravísimo", "invasión", "descontrol"],
  atenuadores: ["quizás", "quizá", "tal vez", "posiblemente", "probablemente",
    "parece", "pareciera", "podría", "podríamos", "creo", "pienso",
    "entiendo", "eventualmente", "en cierta medida", "de alguna manera",
    "aparentemente", "me parece", "a mi juicio"],
  intensificadores: ["muy", "realmente", "verdaderamente", "extremadamente", "enormemente",
    "profundamente", "tremendamente", "sumamente", "clarísimo",
    "evidentemente", "obviamente", "sin duda", "sin lugar a dudas",
    "indudablemente", "claramente", "absolutamente"],
  verdad_dada: ["está demostrado", "es un hecho", "la realidad es", "lo cierto es",
    "la verdad es", "todos sabemos", "es evidente", "como todos saben",
    "nadie puede negar", "no hay duda", "es obvio", "lo que está claro"],
  moral: ["justicia", "injusticia", "injusto", "dignidad", "vergüenza",
    "vergonzoso", "abuso", "abusos", "derechos", "libertad", "corrupción",
    "honestidad", "responsabilidad", "irresponsable", "traición", "deber",
    "ética", "inmoral"],
  datos_fuentes: ["según", "de acuerdo con", "de acuerdo a", "cifras", "datos",
    "estudio", "estudios", "informe", "estadística", "estadísticas",
    "por ciento", "millones", "encuesta", "fuente"],
  yo: ["yo", "mí", "mi", "mis", "me"],
  negacion: ["no", "ni", "tampoco"],
};

// Palabras vacías del español (lista base de spaCy, abreviada) + contexto parlamentario
const STOP_ES = `a acá ahí ahora al algo algún alguna algunas alguno algunos allá allí ambos ante
antes aquel aquella aquellas aquello aquellos aquí así aun aunque bajo bastante cada casi
cierta ciertas cierto ciertos como cómo con conmigo consigo contigo contra cual cuales cualquier
cuando cuándo cuanto cuánto de del demás dentro desde donde dónde dos durante e el él ella
ellas ello ellos en entre era erais éramos eran eras eres es esa esas ese eso esos esta está
estaba estaban estado estamos están estar estas éstas este esto estos estoy fue fuera fueron
fui fuimos ha había habían haber habrá han has hasta hay he hemos hubo la las le les lo los
más me mi mí mía mías mío míos mis mismo misma mismos mismas mucho mucha muchos muchas muy
nada ni ningún ninguna ninguno no nos nosotras nosotros nuestra nuestras nuestro nuestros
nunca o os otra otras otro otros para pero poco poca pocos pocas por porque qué que quien
quién quienes se sea sean según ser será serán si sí sido siempre siendo sin sino sobre
sois solamente solo sólo somos son soy su sus suya suyas suyo suyos tal también tampoco tan
tanto tanta tantos tantas te tenemos tener tengo ti tiene tienen toda todas todo todos tras
tu tú tus tuya tuyo un una unas uno unos usted ustedes va vamos van varios varias vaya vez
vosotros vuestra vuestro y ya yo
señor señora presidente presidenta senador senadora senadores senadoras honorable gracias
palabra sala colega colegas sesión minuto minutos tiempo diputado diputada ministro ministra
bien entonces digamos cierto bueno pues decir hacer estar tener ir poder`;
export const STOP = new Set(STOP_ES.split(/\s+/).filter(Boolean));

const LETRA = "a-záéíóúüñ";
const RX_PALABRA = new RegExp(`[${LETRA}]+(?:['-][${LETRA}]+)*`, "giu");

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

export function fmtTiempo(seg) {
  seg = Math.max(0, Math.floor(seg || 0));
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const r = (x, d = 3) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const media = (xs) => { xs = xs.filter((x) => x != null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
const sd = (xs) => {
  xs = xs.filter((x) => x != null);
  if (xs.length < 2) return null;
  const m = media(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const p90 = (xs) => { xs = xs.filter((x) => x != null).sort((a, b) => a - b); return xs.length ? xs[Math.floor(0.9 * (xs.length - 1))] : null; };

class Contador extends Map {
  sumar(k, n = 1) { this.set(k, (this.get(k) || 0) + n); }
  top(n) { return [...this.entries()].sort((a, b) => b[1] - a[1]).slice(0, n); }
  total() { let t = 0; for (const v of this.values()) t += v; return t; }
}

// ---------------------------------------------------------------------------
// Diarización: segmentos de voz → grupos de hablante
// ---------------------------------------------------------------------------

/** Agrupa palabras consecutivas en segmentos cortos de voz (para calcular la
 *  huella de voz de cada uno). Cortan en pausas, al llegar a SEGMENTO_MAX o
 *  cuando Whisper marca un cambio de hablante con un guion ("-Buenos días"). */
export function segmentosDeVoz(palabras, cfg = CONFIG) {
  const segs = [];
  let actual = null;
  palabras.forEach((p, i) => {
    const corta = !actual || p.inicio - actual.fin > cfg.SEGMENTO_PAUSA
      || p.fin - actual.inicio > cfg.SEGMENTO_MAX || /^[-–—]/.test(p.palabra);
    if (corta) {
      if (actual) segs.push(actual);
      actual = { inicio: p.inicio, fin: p.fin, desde: i, hasta: i };
    }
    actual.fin = p.fin;
    actual.hasta = i;
  });
  if (actual) segs.push(actual);
  return segs;
}

function normalizar(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, (x) => x / n);
}

/** Resta la huella media de la sesión: quita lo que comparten todas las voces
 *  (micrófono, sala, compresión) y deja lo que distingue a cada persona. */
function centrar(embeddings) {
  const E = embeddings.map(normalizar);
  if (E.length < 3) return E;
  const d = E[0].length, m = new Float32Array(d);
  for (const e of E) for (let t = 0; t < d; t++) m[t] += e[t] / E.length;
  return E.map((e) => normalizar(e.map((x, t) => x - m[t])));
}

const K_MAX = 12;

/** Agrupamiento aglomerativo por centroides (similitud coseno, ponderado por
 *  duración). Se une todo hasta un solo grupo y se guarda la partición para
 *  cada número de grupos ≤ K_MAX: así cambiar el número de oradores no
 *  requiere volver a calcular. */
function dendrograma(E, pesos) {
  const n = E.length, d = E[0].length;
  const suma = E.map((e, i) => Float32Array.from(e, (x) => x * (pesos[i] || 1)));
  const cent = suma.map(normalizar);
  const vivo = new Uint8Array(n).fill(1);
  const miembros = Array.from({ length: n }, (_, i) => [i]);
  const sim = new Float32Array(n * n);
  const dot = (a, b) => { let s = 0; for (let t = 0; t < d; t++) s += a[t] * b[t]; return s; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) sim[i * n + j] = sim[j * n + i] = dot(cent[i], cent[j]);
  const mejor = new Int32Array(n).fill(-1);
  const calcMejor = (i) => {
    let b = -1, bv = -Infinity;
    for (let j = 0; j < n; j++) if (j !== i && vivo[j] && sim[i * n + j] > bv) { bv = sim[i * n + j]; b = j; }
    mejor[i] = b;
  };
  for (let i = 0; i < n; i++) calcMejor(i);
  const cortes = new Map();
  const guardar = (g) => cortes.set(g, miembros.filter((_, i) => vivo[i]).map((m) => m.slice()));
  let grupos = n;
  if (grupos <= K_MAX) guardar(grupos);
  while (grupos > 1) {
    let bi = -1, bv = -Infinity;
    for (let i = 0; i < n; i++) if (vivo[i] && mejor[i] >= 0 && sim[i * n + mejor[i]] > bv) { bv = sim[i * n + mejor[i]]; bi = i; }
    if (bi < 0) break;
    const bj = mejor[bi];
    for (let t = 0; t < d; t++) suma[bi][t] += suma[bj][t];
    cent[bi] = normalizar(suma[bi]);
    miembros[bi].push(...miembros[bj]);
    vivo[bj] = 0;
    grupos--;
    for (let j = 0; j < n; j++) if (vivo[j] && j !== bi) sim[bi * n + j] = sim[j * n + bi] = dot(cent[bi], cent[j]);
    for (let j = 0; j < n; j++) {
      if (!vivo[j]) continue;
      if (j === bi || mejor[j] === bi || mejor[j] === bj) calcMejor(j);
      else if (sim[j * n + bi] > sim[j * n + mejor[j]]) mejor[j] = bi;
    }
    if (grupos <= K_MAX) guardar(grupos);
  }
  return cortes;
}

/** Grupos con muy poca voz (una tos, una palabra suelta) no son un orador: se
 *  suman al grupo grande más parecido. Devuelve una etiqueta por segmento. */
function absorber(grupos, E, pesos, minPeso) {
  const peso = (g) => g.reduce((a, i) => a + (pesos[i] || 1), 0);
  const centro = (g) => normalizar(Array.from(E[0], (_, t) => g.reduce((a, i) => a + E[i][t] * (pesos[i] || 1), 0)));
  const grandes = grupos.filter((g) => peso(g) >= minPeso).map((g) => g.slice());
  const final = grandes.length ? grandes : [grupos.flat()];
  const centros = final.map(centro);
  for (const g of grupos) {
    if (!grandes.length || peso(g) >= minPeso) continue;
    const c = centro(g);
    let mejor = 0, mv = -Infinity;
    centros.forEach((x, i) => { let s = 0; for (let t = 0; t < c.length; t++) s += c[t] * x[t]; if (s > mv) { mv = s; mejor = i; } });
    final[mejor].push(...g);
  }
  const et = new Array(E.length).fill(0);
  final.forEach((g, gi) => { for (const i of g) et[i] = gi; });
  return et;
}

/** Silueta media (distancia coseno): qué tan bien separados quedan los grupos. */
function silueta(E, et) {
  const n = E.length;
  if (new Set(et).size < 2) return -1;
  const dist = (a, b) => { let s = 0; for (let t = 0; t < E[a].length; t++) s += E[a][t] * E[b][t]; return 1 - s; };
  let total = 0;
  for (let i = 0; i < n; i++) {
    const suma = new Map(), cuenta = new Map();
    for (let j = 0; j < n; j++) if (j !== i) { suma.set(et[j], (suma.get(et[j]) || 0) + dist(i, j)); cuenta.set(et[j], (cuenta.get(et[j]) || 0) + 1); }
    if (!cuenta.get(et[i])) continue; // grupo de un solo segmento: silueta 0
    const a = suma.get(et[i]) / cuenta.get(et[i]);
    let b = Infinity;
    for (const [g, s] of suma) if (g !== et[i]) b = Math.min(b, s / cuenta.get(g));
    total += (b - a) / Math.max(a, b);
  }
  return total / n;
}

const CACHE_GRUPOS = new WeakMap();

/** Etiqueta de hablante por segmento. Con k fijo corta el dendrograma en k
 *  grupos; en modo automático elige el k (2–8) con mejor silueta, o 1 si
 *  ninguna partición separa bien las voces. */
export function agrupar(embeddings, pesos, { k = null, minPeso = 3, siluetaMin = 0.08 } = {}) {
  const n = embeddings.length;
  if (!n) return [];
  if (k === 1 || n < 2) return new Array(n).fill(0);
  let c = CACHE_GRUPOS.get(embeddings);
  if (!c) {
    const E = centrar(embeddings);
    c = { E, cortes: dendrograma(E, pesos), porK: new Map(), auto: null };
    CACHE_GRUPOS.set(embeddings, c);
  }
  const cortar = (kk) => {
    if (!c.porK.has(kk)) {
      const kReal = Math.max(1, ...[...c.cortes.keys()].filter((x) => x <= kk));
      c.porK.set(kk, absorber(c.cortes.get(kReal) || [[...Array(n).keys()]], c.E, pesos, minPeso));
    }
    return c.porK.get(kk);
  };
  if (k) return cortar(Math.min(k, K_MAX));
  if (c.auto == null) {
    let mejor = 1, mv = siluetaMin;
    for (let kk = 2; kk <= Math.min(8, n - 1); kk++) {
      const s = silueta(c.E, cortar(kk));
      if (s > mv + 1e-9) { mv = s; mejor = kk; }
    }
    c.auto = mejor;
  }
  return c.auto === 1 ? new Array(n).fill(0) : cortar(c.auto);
}

/** Etiquetas por segmento → hablante por palabra. Suaviza segmentos cortos
 *  aislados y nombra los grupos SPEAKER_00, 01... por orden de aparición. */
export function asignarHablantes(palabras, segmentos, etiquetas) {
  const et = etiquetas.slice();
  for (let i = 1; i < et.length - 1; i++) {
    const s = segmentos[i];
    if (s.fin - s.inicio < 1.0 && et[i - 1] === et[i + 1] && et[i] !== et[i - 1]) et[i] = et[i - 1];
  }
  const nombre = new Map();
  et.forEach((g) => { if (!nombre.has(g)) nombre.set(g, `SPEAKER_${String(nombre.size).padStart(2, "0")}`); });
  const out = palabras.map((p) => ({ ...p, hablante: "SIN_DIARIZAR" }));
  segmentos.forEach((s, i) => { for (let j = s.desde; j <= s.hasta; j++) out[j].hablante = nombre.get(et[i]); });
  return out;
}

// ---------------------------------------------------------------------------
// Turnos y ventanas (etapas/diarizacion.py)
// ---------------------------------------------------------------------------

export function unir(palabras) {
  let texto = "";
  for (const p of palabras) {
    const w = p.palabra;
    if (texto && !",.;:!?)»".includes(w[0])) texto += " ";
    texto += w;
  }
  return texto;
}

export function armarTurnos(palabras, cfg = CONFIG) {
  const turnos = [];
  let actual = null;
  for (const p of palabras) {
    if (!actual || p.hablante !== actual.speaker_id || p.inicio - actual.fin > cfg.TURNO_PAUSA_MAX) {
      if (actual) turnos.push(actual);
      actual = { speaker_id: p.hablante, inicio: p.inicio, fin: p.fin, palabras: [] };
    }
    actual.palabras.push(p);
    actual.fin = p.fin;
  }
  if (actual) turnos.push(actual);
  turnos.forEach((t, i) => {
    t.id = i;
    t.texto = unir(t.palabras);
    t.duracion = r(t.fin - t.inicio);
    t.n_palabras = t.palabras.length;
    t.breve = t.duracion < cfg.TURNO_DURACION_MIN;
  });
  return turnos;
}

export function armarVentanas(turnos, cfg = CONFIG) {
  const largo = cfg.VENTANA_SEG;
  const ventanas = [];
  const cerrar = (t, pal) => ventanas.push({
    id: ventanas.length, turno_id: t.id, speaker_id: t.speaker_id,
    inicio: pal[0].inicio, fin: pal[pal.length - 1].fin,
    duracion: r(pal[pal.length - 1].fin - pal[0].inicio),
    palabras: pal, texto: unir(pal), n_palabras: pal.length, breve: t.breve,
  });
  for (const t of turnos) {
    let actual = [];
    for (const p of t.palabras) {
      actual.push(p);
      const dur = p.fin - actual[0].inicio;
      const finOracion = ".?!".includes(p.palabra.slice(-1));
      if ((dur >= 0.75 * largo && finOracion) || dur >= 1.5 * largo) { cerrar(t, actual); actual = []; }
    }
    if (actual.length) {
      const ultima = ventanas[ventanas.length - 1];
      const resto = actual[actual.length - 1].fin - actual[0].inicio;
      if (ultima && ultima.turno_id === t.id && resto < 0.4 * largo) {
        ventanas.pop();
        cerrar(t, ultima.palabras.concat(actual));
      } else cerrar(t, actual);
    }
  }
  return ventanas;
}

// ---------------------------------------------------------------------------
// Nombres de oradores (etapas/oradores.py)
// ---------------------------------------------------------------------------

// JavaScript no tiene (?i:...) en todos los navegadores: vuelve insensible a
// mayúsculas solo las partes fijas, para que el nombre siga exigiendo mayúscula.
function ci(patron) {
  let out = "", enClase = false;
  for (let i = 0; i < patron.length; i++) {
    const c = patron[i];
    if (c === "\\") { out += c + patron[++i]; continue; }
    if (c === "[") enClase = true;
    if (c === "]") enClase = false;
    if (/[a-zñ]/.test(c)) out += enClase ? c + c.toUpperCase() : `[${c}${c.toUpperCase()}]`;
    else out += c;
  }
  return out;
}
const CARGOS = "senador|senadora|ministro|ministra|subsecretario|subsecretaria|diputado|diputada|secretario|secretaria|presidente|presidenta|prosecretario|prosecretaria";
const NOMBRE = "([A-ZÁÉÍÓÚÑ][a-záéíóúñü]+(?:\\s+(?:de\\s+la\\s+|del\\s+|de\\s+)?[A-ZÁÉÍÓÚÑ][a-záéíóúñü]+){0,2})";
const CESION = new RegExp(ci(
  "(?:tiene\\s+(?:el\\s+uso\\s+de\\s+)?la\\s+palabra|ofrezco\\s+la\\s+palabra|" +
  "le\\s+(?:doy|damos|ofrezco|cedo)\\s+la\\s+palabra|puede\\s+intervenir|" +
  "a\\s+continuaci[oó]n|con\\s+la\\s+palabra)" +
  "[\\s,]*(?:a\\s+|al\\s+)?(?:el\\s+|la\\s+)?(?:se[ñn]or(?:a)?\\s+)?(?:" + CARGOS + ")\\s+") + NOMBRE, "gu");
const CESION_INV = new RegExp(ci("(?:" + CARGOS + ")\\s+") + NOMBRE +
  ci("\\s*,?\\s*(?:tiene\\s+(?:usted\\s+)?la\\s+palabra|puede\\s+intervenir|le\\s+ofrezco\\s+la\\s+palabra)"), "gu");
const RX_CARGO = new RegExp(`(?<![${LETRA}])(?:${CARGOS})(?![${LETRA}])`, "iu");

export function sugerirOradores(turnos) {
  const votos = new Map(), cesiones = new Contador(), evidencia = new Map();
  turnos.forEach((t, i) => {
    for (const rx of [CESION, CESION_INV]) {
      for (const m of t.texto.matchAll(rx)) {
        const nombre = m[1].trim();
        if (nombre.length < 3) continue;
        const cargo = (m[0].match(RX_CARGO) || [""])[0];
        const etiqueta = `${cargo ? cargo[0].toUpperCase() + cargo.slice(1).toLowerCase() : ""} ${nombre}`.trim();
        cesiones.sumar(t.speaker_id);
        for (const sig of turnos.slice(i + 1, i + 6)) {
          if (sig.speaker_id !== t.speaker_id && !sig.breve) {
            if (!votos.has(sig.speaker_id)) votos.set(sig.speaker_id, new Contador());
            votos.get(sig.speaker_id).sumar(etiqueta);
            const ev = evidencia.get(sig.speaker_id) || [];
            if (ev.length < 3) ev.push(`[${fmtTiempo(t.inicio)}] «${m[0].slice(0, 80)}»`);
            evidencia.set(sig.speaker_id, ev);
            break;
          }
        }
      }
    }
  });
  const sug = {};
  for (const [sid, c] of votos) {
    const [nombre, n] = c.top(1)[0];
    sug[sid] = [nombre, `${n}/${c.total()} cesiones; ` + evidencia.get(sid).join(" | ")];
  }
  const [pres] = cesiones.top(1);
  if (pres && pres[1] >= 2 && !sug[pres[0]]) sug[pres[0]] = ["Presidencia de la sesión", `cede la palabra ${pres[1]} veces`];
  return sug;
}

export function tablaOradores(turnos, nombresManual = {}) {
  const sug = sugerirOradores(turnos);
  const stats = new Map();
  for (const t of turnos) {
    const s = stats.get(t.speaker_id) || { n: 0, t: 0, primero: null, muestra: "" };
    s.n++; s.t += t.duracion;
    if (s.primero == null) s.primero = t.inicio;
    if (s.muestra.length < 200 && !t.breve) s.muestra = (s.muestra + " " + t.texto).trim().slice(0, 240);
    stats.set(t.speaker_id, s);
  }
  return [...stats.entries()].sort((a, b) => b[1].t - a[1].t).map(([sid, s]) => ({
    speaker_id: sid,
    nombre_sugerido: sug[sid]?.[0] || "",
    evidencia: sug[sid]?.[1] || "",
    n_turnos: s.n,
    tiempo_total_s: r(s.t, 1),
    primer_turno: fmtTiempo(s.primero || 0),
    muestra_texto: s.muestra,
    nombre: nombresManual[sid] || "",
  }));
}

export function mapaNombres(tabla) {
  const m = {};
  for (const f of tabla) m[f.speaker_id] = (f.nombre || "").trim() || f.nombre_sugerido || f.speaker_id;
  return m;
}

// ---------------------------------------------------------------------------
// Análisis verbal (etapas/verbal.py, sin lematizar ni sentimiento)
// ---------------------------------------------------------------------------

export function tokenizar(texto) {
  return (texto.toLowerCase().match(RX_PALABRA) || []);
}
const esContenido = (w) => w.length >= 3 && !STOP.has(w);

function mattr(tokens, ventana = 100) {
  if (!tokens.length) return null;
  if (tokens.length <= ventana) return new Set(tokens).size / tokens.length;
  const c = new Contador();
  tokens.slice(0, ventana).forEach((t) => c.sumar(t));
  let suma = c.size / ventana, n = 1;
  for (let i = ventana; i < tokens.length; i++) {
    c.sumar(tokens[i]);
    const sale = tokens[i - ventana];
    c.sumar(sale, -1);
    if (!c.get(sale)) c.delete(sale);
    suma += c.size / ventana; n++;
  }
  return suma / n;
}

function ngramas(formas, n, c) {
  for (let i = 0; i + n <= formas.length; i++) {
    const g = formas.slice(i, i + n);
    if (STOP.has(g[0]) || STOP.has(g[n - 1])) continue;
    c.sumar(g.join(" "));
  }
}

function consignas(turnosTokens, cfg = CONFIG) {
  const conteo = new Contador();
  for (const formas of turnosTokens) {
    for (const n of cfg.CONSIGNA_N) {
      for (let i = 0; i + n <= formas.length; i++) {
        const g = formas.slice(i, i + n);
        if (g.filter((w) => !STOP.has(w)).length < 2) continue;
        conteo.sumar(g.join(" "));
      }
    }
  }
  const rep = [...conteo.entries()].filter(([, c]) => c >= cfg.CONSIGNA_MIN_REPETICIONES)
    .sort((a, b) => b[0].length - a[0].length);
  const finales = new Map();
  for (const [g, c] of rep) {
    let contenida = false;
    for (const [h, ch] of finales) if (h.includes(g) && ch >= c) { contenida = true; break; }
    if (!contenida) finales.set(g, c);
  }
  return [...finales.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, cfg.TOP_NGRAMAS);
}

function keyness(obj, resto, minFrec = 3, top = 25) {
  const c = obj.total(), d = resto.total();
  if (!c || !d) return [];
  const res = [];
  for (const [w, a] of obj) {
    if (a < minFrec) continue;
    const b = resto.get(w) || 0;
    if (a / c <= b / d) continue;
    const e1 = (c * (a + b)) / (c + d), e2 = (d * (a + b)) / (c + d);
    const ll = 2 * (a * Math.log(a / e1) + (b ? b * Math.log(b / e2) : 0));
    const lr = Math.log2(((a + 0.5) / c) / ((b + 0.5) / d));
    res.push({ palabra: w, frec: a, frec_resto: b, ll: r(ll, 2), log_ratio: r(lr, 2), significativa: ll >= 6.63 });
  }
  return res.sort((x, y) => y.ll - x.ll).slice(0, top);
}

const escRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RX_MARC = Object.fromEntries(Object.entries(MARCADORES).map(([cat, lista]) => [cat,
  lista.map((e) => new RegExp(`(?<![\\w${LETRA}])${escRx(e)}(?![\\w${LETRA}])`, "gu"))]));

export function contarMarcadores(texto) {
  const t = " " + texto.toLowerCase() + " ";
  const c = {};
  for (const [cat, rxs] of Object.entries(RX_MARC)) c[cat] = rxs.reduce((n, rx) => n + (t.match(rx) || []).length, 0);
  c.cifras = (texto.match(/\d+(?:[.,]\d+)*/g) || []).length;
  c.preguntas = (texto.match(/\?/g) || []).length;
  return c;
}

const CARGA = ["absolutos", "amenaza", "intensificadores", "verdad_dada", "ellos"];

export function analisisVerbal(ventanas, nombres, cfg = CONFIG) {
  const toks = ventanas.map((v) => tokenizar(v.texto));
  const durTotal = ventanas.reduce((a, v) => a + v.duracion, 0) || 1;
  const porVentana = {};
  ventanas.forEach((v, i) => {
    const n = toks[i].length;
    const m = contarMarcadores(v.texto);
    const carga = CARGA.reduce((a, k) => a + m[k], 0);
    porVentana[v.id] = {
      orador: nombres[v.speaker_id] || v.speaker_id,
      n_palabras: n,
      velocidad_ppm: v.duracion > 0 ? r((60 * n) / v.duracion, 1) : null,
      marcadores: m,
      carga_retorica: n ? r((100 * carga) / n, 2) : 0,
    };
  });

  const grupos = new Map();
  ventanas.forEach((v, i) => {
    const o = nombres[v.speaker_id] || v.speaker_id;
    if (!grupos.has(o)) grupos.set(o, []);
    grupos.get(o).push([v, toks[i]]);
  });
  const lemas = new Map(), total = new Contador();
  for (const [o, g] of grupos) {
    const c = new Contador();
    for (const [, tk] of g) for (const w of tk) if (esContenido(w)) { c.sumar(w); total.sumar(w); }
    lemas.set(o, c);
  }

  const porOrador = {};
  for (const [o, g] of grupos) {
    const formas = g.flatMap(([, tk]) => tk);
    const n = formas.length;
    const dur = g.reduce((a, [v]) => a + v.duracion, 0);
    const cuentas = contarMarcadores(g.map(([v]) => v.texto).join(" "));
    const resto = new Contador();
    for (const [w, c] of total) { const x = c - (lemas.get(o).get(w) || 0); if (x > 0) resto.set(w, x); }
    const porTurno = new Map();
    for (const [v, tk] of g) porTurno.set(v.turno_id, (porTurno.get(v.turno_id) || []).concat(tk));
    const bigr = new Contador(), trig = new Contador();
    for (const f of porTurno.values()) { ngramas(f, 2, bigr); ngramas(f, 3, trig); }
    porOrador[o] = {
      speaker_ids: [...new Set(g.map(([v]) => v.speaker_id))].sort(),
      n_turnos: porTurno.size,
      n_turnos_sustantivos: new Set(g.filter(([v]) => !v.breve).map(([v]) => v.turno_id)).size,
      tiempo_s: r(dur, 1),
      pct_tiempo: r((100 * dur) / durTotal, 1),
      n_palabras: n,
      velocidad_ppm: dur ? r((60 * n) / dur, 1) : null,
      diversidad_mattr: r(mattr(formas) || 0),
      top_palabras: lemas.get(o).top(cfg.TOP_PALABRAS),
      top_bigramas: bigr.top(cfg.TOP_NGRAMAS),
      top_trigramas: trig.top(cfg.TOP_NGRAMAS),
      palabras_distintivas: keyness(lemas.get(o), resto),
      consignas: consignas([...porTurno.values()], cfg),
      marcadores: cuentas,
      marcadores_por_mil: Object.fromEntries(Object.entries(cuentas).map(([k, v]) => [k, n ? r((1000 * v) / n, 2) : 0])),
    };
  }
  return {
    global: {
      n_palabras: toks.reduce((a, t) => a + t.length, 0),
      n_oradores: grupos.size,
      top_palabras: total.top(cfg.TOP_PALABRAS),
      lematizado: false,
      sentimiento: false,
    },
    por_orador: porOrador,
    por_ventana: porVentana,
  };
}

// ---------------------------------------------------------------------------
// Prosodia (etapas/prosodia.py). La pista de tono se calcula una sola vez para
// todo el audio (YIN simplificado); las métricas por ventana salen de ella.
// ---------------------------------------------------------------------------

export const PISTA_PASO = 0.02; // s

/** Tono (Hz, 0 = sordo) e intensidad (dB, referencia 2e-5 como Praat) cada 20 ms. */
export function pistaVoz(audio, sr, cfg = CONFIG, progreso = null) {
  const paso = Math.round(sr * PISTA_PASO);
  const W = Math.round(sr * 0.03);
  const tMin = Math.floor(sr / cfg.PITCH_MAX_HZ), tMax = Math.ceil(sr / cfg.PITCH_MIN_HZ);
  const nF = Math.max(0, Math.floor((audio.length - W - tMax) / paso));
  const f0 = new Float32Array(nF), db = new Float32Array(nF);
  const dif = new Float32Array(tMax + 1);
  for (let f = 0; f < nF; f++) {
    const o = f * paso;
    let e = 0;
    for (let j = 0; j < W; j++) e += audio[o + j] * audio[o + j];
    const rms = Math.sqrt(e / W);
    db[f] = rms > 2e-5 ? 20 * Math.log10(rms / 2e-5) : 0;
    if (rms < 0.005) continue; // silencio: no se busca tono
    // YIN: diferencia acumulada normalizada
    let acum = 0;
    dif[0] = 1;
    let tau = -1;
    for (let t = 1; t <= tMax; t++) {
      let s = 0;
      for (let j = 0; j < W; j++) { const x = audio[o + j] - audio[o + j + t]; s += x * x; }
      acum += s;
      dif[t] = acum ? (s * t) / acum : 1;
      if (t >= tMin && tau < 0 && dif[t] < 0.15) tau = t;
      if (tau > 0 && t > tau && dif[t] > dif[t - 1]) break;
    }
    if (tau < 0) continue;
    while (tau + 1 <= tMax && dif[tau + 1] < dif[tau]) tau++;
    const a = dif[tau - 1], b = dif[tau], c = tau + 1 <= tMax ? dif[tau + 1] : b;
    const den = a - 2 * b + c;
    const tf = den ? tau + (0.5 * (a - c)) / den : tau;
    const hz = sr / tf;
    if (hz >= cfg.PITCH_MIN_HZ && hz <= cfg.PITCH_MAX_HZ) f0[f] = hz;
    if (progreso && f % 5000 === 0) progreso(f / nF);
  }
  return { paso: PISTA_PASO, f0: Array.from(f0, (x) => r(x, 1)), db: Array.from(db, (x) => r(x, 1)) };
}

const PAUSA_MIN = 0.3;
const percentil = (xs, p) => xs[Math.floor(p * (xs.length - 1))];

export function prosodiaVentana(pista, v) {
  const res = {};
  const a = Math.max(0, Math.floor(v.inicio / pista.paso)), b = Math.min(pista.f0.length, Math.ceil(v.fin / pista.paso));
  const f0 = [], db = [];
  for (let i = a; i < b; i++) { if (pista.f0[i] > 0) f0.push(pista.f0[i]); if (pista.db[i] > 0) db.push(pista.db[i]); }
  if (f0.length >= 10) {
    const orden = f0.slice().sort((x, y) => x - y);
    const med = percentil(orden, 0.5);
    const st = f0.map((x) => 12 * Math.log2(x / med));
    const m = media(st);
    const sto = st.slice().sort((x, y) => x - y);
    res.f0_media_hz = r(media(f0), 1);
    res.f0_mediana_hz = r(med, 1);
    res.f0_sd_st = r(Math.sqrt(st.reduce((s, x) => s + (x - m) ** 2, 0) / st.length), 2);
    res.f0_rango_st = r(percentil(sto, 0.95) - percentil(sto, 0.05), 2);
    res.frac_sonora = r(f0.length / Math.max(1, b - a));
  }
  if (db.length) {
    const m = media(db);
    res.intensidad_media_db = r(m, 1);
    res.intensidad_sd_db = r(Math.sqrt(db.reduce((s, x) => s + (x - m) ** 2, 0) / db.length), 2);
  }
  const dur = v.fin - v.inicio;
  const pal = v.palabras;
  const pausas = [];
  for (let i = 1; i < pal.length; i++) { const g = pal[i].inicio - pal[i - 1].fin; if (g > PAUSA_MIN) pausas.push(g); }
  const tp = pausas.reduce((x, y) => x + y, 0);
  res.pausas_por_min = dur > 0 ? r((60 * pausas.length) / dur, 1) : null;
  res.frac_pausa = dur > 0 ? r(tp / dur) : null;
  res.velocidad_articulacion = r(pal.length / Math.max(0.1, dur - tp), 2);
  return res;
}

export function prosodia(pista, ventanas) {
  const out = {};
  if (!pista) return out;
  for (const v of ventanas) if (!v.breve && v.duracion >= 0.5) out[v.id] = prosodiaVentana(pista, v);
  return out;
}

// ---------------------------------------------------------------------------
// No verbal (etapas/no_verbal.py): cuadros crudos → índices por ventana
// ---------------------------------------------------------------------------

export const INDICES = ["tension_ceno", "cejas_elevadas", "presion_labios", "sonrisa",
  "desagrado", "ojos_entrecerrados", "apertura_boca"];

function indicesCuadro(bs) {
  if (!bs || bs.jawOpen == null) return {};
  const m = (...ks) => ks.reduce((a, k) => a + (bs[k] || 0), 0) / ks.length;
  return {
    tension_ceno: m("browDownLeft", "browDownRight"),
    cejas_elevadas: ((bs.browInnerUp || 0) + m("browOuterUpLeft", "browOuterUpRight")) / 2,
    presion_labios: (m("mouthPressLeft", "mouthPressRight") + m("mouthRollLower", "mouthRollUpper")) / 2,
    sonrisa: m("mouthSmileLeft", "mouthSmileRight"),
    desagrado: (m("noseSneerLeft", "noseSneerRight") + m("mouthFrownLeft", "mouthFrownRight")) / 2,
    ojos_entrecerrados: m("eyeSquintLeft", "eyeSquintRight"),
    apertura_boca: bs.jawOpen,
  };
}

/** Añade índices, energía gestual y movimiento de cabeza a cada cuadro. */
export function derivarCuadros(cuadros, fps) {
  const dt = 1 / fps;
  let prev = null;
  return cuadros.map((c) => {
    const f = { ...c, ...indicesCuadro(c.bs), energia_gestual: null, movimiento_cabeza: null };
    const mismo = prev && !f.cambio_plano;
    if (mismo && f.pose && prev.pose && f.hombros_ancho) {
      const esc = Math.max(f.hombros_ancho, 0.02);
      const desp = [];
      for (const p of ["muneca_i", "muneca_d"]) {
        const a = f.puntos?.[p], b = prev.puntos?.[p];
        if (a && b && a[2] > 0.5 && b[2] > 0.5) desp.push(Math.hypot(a[0] - b[0], a[1] - b[1]));
      }
      if (desp.length) f.energia_gestual = media(desp) / esc / dt;
    }
    if (mismo && f.yaw != null && prev.yaw != null) {
      f.movimiento_cabeza = Math.sqrt((f.yaw - prev.yaw) ** 2 + (f.pitch - prev.pitch) ** 2 + (f.roll - prev.roll) ** 2) / dt;
    }
    prev = f;
    return f;
  });
}

function tipoPlano(area) {
  if (area == null) return "sin_rostro";
  if (area > 0.06) return "primer_plano";
  if (area > 0.015) return "plano_medio";
  return "plano_general";
}

export function resumirCuadros(cuadros) {
  if (!cuadros.length) return { n_cuadros: 0 };
  const cr = cuadros.filter((c) => c.apertura_boca != null);
  const areas = cr.map((c) => c.rostro_area).filter(Boolean).sort((a, b) => a - b);
  const jaw = sd(cr.map((c) => c.apertura_boca));
  const res = {
    n_cuadros: cuadros.length,
    frac_con_rostro: r(cr.length / cuadros.length),
    frac_con_pose: r(cuadros.filter((c) => c.pose).length / cuadros.length),
    n_cambios_plano: cuadros.filter((c) => c.cambio_plano).length,
    tipo_plano: tipoPlano(areas.length ? areas[Math.floor(areas.length / 2)] : null),
    variacion_boca: r(jaw, 4),
    rostro_parece_hablar: jaw != null && jaw > 0.05 && cr.length >= 5,
  };
  for (const k of INDICES) { const v = cr.map((c) => c[k]); res[k] = r(media(v), 4); res[`${k}_p90`] = r(p90(v), 4); }
  for (const k of ["energia_gestual", "movimiento_cabeza"]) { const v = cuadros.map((c) => c[k]); res[k] = r(media(v), 4); res[`${k}_p90`] = r(p90(v), 4); }
  for (const k of ["yaw", "pitch"]) res[`${k}_sd`] = cr.length ? r(sd(cr.map((c) => c[k])) || 0, 2) : null;
  return res;
}

export function noVerbal(cuadrosDerivados, ventanas, nombres) {
  if (!cuadrosDerivados?.length) return { por_ventana: {}, por_orador: {} };
  const ts = cuadrosDerivados.map((c) => c.t);
  const bisect = (x, der) => { let lo = 0, hi = ts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (der ? ts[m] <= x : ts[m] < x) lo = m + 1; else hi = m; } return lo; };
  const porVentana = {}, porOradorC = new Map();
  for (const v of ventanas) {
    const cs = cuadrosDerivados.slice(bisect(v.inicio, false), bisect(v.fin, true));
    const res = resumirCuadros(cs);
    res.orador = nombres[v.speaker_id] || v.speaker_id;
    porVentana[v.id] = res;
    if (res.rostro_parece_hablar) porOradorC.set(res.orador, (porOradorC.get(res.orador) || []).concat(cs));
  }
  const porOrador = {};
  for (const [o, cs] of porOradorC) porOrador[o] = resumirCuadros(cs);
  return { por_ventana: porVentana, por_orador: porOrador };
}

// ---------------------------------------------------------------------------
// Línea de tiempo (etapas/linea_tiempo.py)
// ---------------------------------------------------------------------------

const PROSODIA_Z = ["f0_media_hz", "intensidad_media_db", "f0_sd_st", "velocidad_articulacion"];
const NO_VERBAL_Z = ["energia_gestual", "movimiento_cabeza", "tension_ceno", "cejas_elevadas", "presion_labios"];

function zPorGrupo(filas, campo, porOrador, filtro, minN = 3) {
  const grupos = new Map();
  for (const f of filas) {
    const v = f[campo];
    if (v != null && filtro(f)) { const g = porOrador ? f.orador : "_"; grupos.set(g, (grupos.get(g) || []).concat(v)); }
  }
  const stats = new Map();
  for (const [g, vs] of grupos) if (vs.length >= minN) { const s = sd(vs); if (s > 1e-9) stats.set(g, [media(vs), s]); }
  for (const f of filas) {
    const v = f[campo], g = porOrador ? f.orador : "_";
    f[`z_${campo}`] = v != null && stats.has(g) && filtro(f) ? r((v - stats.get(g)[0]) / stats.get(g)[1]) : null;
  }
}
const mediaR = (...xs) => r(media(xs));

export function lineaTiempo(ventanas, nombres, verbal, pros, nv) {
  const filas = ventanas.map((t) => {
    const v = verbal.por_ventana[t.id] || {}, p = pros[t.id] || {}, n = nv.por_ventana[t.id] || {};
    const f = {
      id: t.id, turno_id: t.turno_id, orador: nombres[t.speaker_id] || t.speaker_id, speaker_id: t.speaker_id,
      inicio: t.inicio, fin: t.fin, duracion: t.duracion, breve: t.breve, texto: t.texto, n_palabras: t.n_palabras,
      velocidad_ppm: v.velocidad_ppm ?? null, carga_retorica: v.carga_retorica ?? null,
      polaridad: null, emocion_dominante: null, marcadores: v.marcadores || {},
    };
    for (const c of ["f0_media_hz", "f0_sd_st", "f0_rango_st", "intensidad_media_db", "intensidad_sd_db",
      "velocidad_articulacion", "pausas_por_min", "frac_pausa"]) f[c] = p[c] ?? null;
    for (const c of ["frac_con_rostro", "rostro_parece_hablar", "tipo_plano", "n_cambios_plano", "tension_ceno",
      "cejas_elevadas", "presion_labios", "sonrisa", "desagrado", "apertura_boca", "energia_gestual",
      "movimiento_cabeza"]) f[c] = n[c] ?? null;
    return f;
  });
  const sustantivo = (f) => !f.breve;
  for (const c of PROSODIA_Z) zPorGrupo(filas, c, true, sustantivo);
  const confiable = (f) => !f.breve && !!f.rostro_parece_hablar;
  for (const c of NO_VERBAL_Z) zPorGrupo(filas, c, true, confiable);
  zPorGrupo(filas, "carga_retorica", false, (f) => !f.breve && f.n_palabras >= 15);
  for (const f of filas) {
    f.activacion_vocal = mediaR(f.z_f0_media_hz, f.z_intensidad_media_db, f.z_f0_sd_st);
    f.activacion_corporal = mediaR(f.z_energia_gestual, f.z_movimiento_cabeza, f.z_tension_ceno);
    f.activacion_no_verbal = mediaR(f.activacion_vocal, f.activacion_corporal);
    const cz = f.z_carga_retorica, a = f.activacion_no_verbal;
    f.desfase_verbal_no_verbal = cz != null && a != null ? r(cz - a) : null;
  }
  return filas;
}

// ---------------------------------------------------------------------------
// Todo junto: datos crudos → resultados. Rápido: se vuelve a llamar cuando el
// usuario cambia el número de oradores o corrige un nombre.
// ---------------------------------------------------------------------------

export function derivar(crudo, { k = null, nombresManual = {} } = {}) {
  let palabras;
  const segs = crudo.segmentos || [];
  if (segs.length && segs[0].emb) {
    // se guardan en el objeto (no enumerables) para que agrupar() los cachee
    if (!crudo._embs) {
      Object.defineProperty(crudo, "_embs", { value: segs.map((s) => s.emb), writable: true });
      Object.defineProperty(crudo, "_pesos", { value: segs.map((s) => Math.max(0.5, s.fin - s.inicio)), writable: true });
    }
    const etiquetas = agrupar(crudo._embs, crudo._pesos, { k });
    palabras = asignarHablantes(crudo.palabras, segs, etiquetas);
  } else {
    palabras = crudo.palabras.map((p) => ({ ...p, hablante: "SIN_DIARIZAR" }));
  }
  const turnos = armarTurnos(palabras);
  const ventanas = armarVentanas(turnos);
  const oradores = tablaOradores(turnos, nombresManual);
  const nombres = mapaNombres(oradores);
  const verbal = analisisVerbal(ventanas, nombres);
  const pros = prosodia(crudo.pista, ventanas);
  const cuadros = crudo.cuadros?.length ? derivarCuadros(crudo.cuadros, crudo.fps || 3) : [];
  const nv = noVerbal(cuadros, ventanas, nombres);
  const linea = lineaTiempo(ventanas, nombres, verbal, pros, nv);
  return { turnos, ventanas, oradores, nombres, verbal, prosodia: pros, no_verbal: nv, linea, cuadros };
}

// ---------------------------------------------------------------------------
// Exportación CSV (utf-8 con BOM para Excel)
// ---------------------------------------------------------------------------

function celda(v) {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function aCSV(filas, cols) {
  cols = cols || Object.keys(filas[0] || {});
  return "﻿" + [cols.join(","), ...filas.map((f) => cols.map((c) => celda(f[c])).join(","))].join("\n");
}

export function csvLineaTiempo(linea) {
  if (!linea.length) return "";
  const cats = [...new Set(linea.flatMap((f) => Object.keys(f.marcadores)))].sort();
  const cols = Object.keys(linea[0]).filter((c) => c !== "marcadores").concat(cats.map((c) => `m_${c}`));
  const filas = linea.map((f) => { const o = { ...f }; for (const c of cats) o[`m_${c}`] = f.marcadores[c] || 0; return o; });
  return aCSV(filas, cols);
}

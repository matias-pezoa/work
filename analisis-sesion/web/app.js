// Interfaz de la versión web del pipeline: carga, progreso y reporte.
import * as A from "./analisis.js";
import { analizarVideo, csvCuadros } from "./video.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (x) => String(x ?? "—").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (x, d = 1, suf = "") => (x == null || !isFinite(x) ? "—" : x.toFixed(d) + suf);
const SR = 16000;

// Paleta categórica (pasos para fondo oscuro, validada en orden fijo). Desde el
// 9.º orador se usa gris: se agrupan como "otros".
const PALETA = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const GRIS = "#8c8c87";

const ETIQUETAS = {
  absolutos: "Absolutos", nosotros: "Nosotros", ellos: "Ellos", amenaza: "Amenaza",
  atenuadores: "Atenuadores", intensificadores: "Intensificadores", verdad_dada: "Verdad dada",
  moral: "Moral", datos_fuentes: "Datos/fuentes", yo: "Yo", negacion: "Negación",
  cifras: "Cifras", preguntas: "Preguntas",
};
const MOSTRAR = ["absolutos", "nosotros", "ellos", "amenaza", "verdad_dada", "intensificadores",
  "atenuadores", "moral", "datos_fuentes", "cifras", "preguntas", "yo"];

const METRICAS = {
  carga_retorica: ["Carga retórica (por 100 palabras)", "Marcadores de énfasis y polarización por cada 100 palabras."],
  z_carga_retorica: ["Carga retórica (z)", "Carga retórica comparada con toda la sesión."],
  activacion_vocal: ["Activación vocal (z)", "Tono, volumen y variación de tono respecto de la voz habitual del mismo orador."],
  activacion_corporal: ["Activación corporal (z)", "Energía gestual, movimiento de cabeza y ceño respecto del mismo orador. Solo tramos donde el rostro en pantalla parece ser el de quien habla."],
  desfase_verbal_no_verbal: ["Desfase verbal / no verbal", "Positivo: el texto enfatiza más de lo que muestran cuerpo y voz. Negativo: cuerpo y voz más activados que el texto."],
  f0_media_hz: ["Tono medio (Hz)", "Frecuencia fundamental media de la voz en el tramo."],
  intensidad_media_db: ["Volumen medio (dB)", "Intensidad media; útil solo para comparar dentro de una misma grabación."],
  velocidad_ppm: ["Velocidad (palabras/min)", "Palabras por minuto en el tramo."],
};

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
const estado = {
  archivo: null,     // File original (para el reproductor)
  crudo: null,       // datos crudos (lo que se guarda en sesion.json)
  R: null,           // resultados derivados
  metrica: "z_carga_retorica",
  cancelar: false,
};

// ---------------------------------------------------------------------------
// Utilidades de interfaz
// ---------------------------------------------------------------------------
function parseTiempo(s) {
  s = (s || "").trim();
  if (!s) return null;
  const partes = s.split(":").map(Number);
  if (partes.some((x) => !isFinite(x))) throw new Error(`Tiempo no válido: "${s}" (usa h:mm:ss o mm:ss)`);
  return partes.reduce((a, x) => a * 60 + x, 0);
}

function descargar(nombre, contenido, tipo = "text/plain") {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo + ";charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const log = (t) => {
  const el = $("#log");
  el.textContent += `[${new Date().toLocaleTimeString()}] ${t}\n`;
  el.scrollTop = el.scrollHeight;
};

function etapa(id, estadoEtapa, avance = null, detalle = "") {
  const li = $(`#etapas [data-etapa="${id}"]`);
  if (!li) return;
  li.dataset.estado = estadoEtapa;
  if (avance != null) li.querySelector(".barra-av i").style.width = `${Math.round(avance * 100)}%`;
  if (detalle !== null) li.querySelector(".det").textContent = detalle;
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------
async function decodificarAudio(archivo) {
  const buf = await archivo.arrayBuffer();
  let ctx;
  try { ctx = new AudioContext({ sampleRate: SR }); } catch { ctx = new AudioContext(); }
  let ab;
  try { ab = await ctx.decodeAudioData(buf); }
  catch { throw new Error("El navegador no pudo leer el audio de este archivo. Prueba con MP4 (H.264/AAC), WebM, MP3 o WAV."); }
  finally { ctx.close(); }
  if (ab.sampleRate !== SR) {
    const off = new OfflineAudioContext(1, Math.ceil(ab.duration * SR), SR);
    const src = off.createBufferSource();
    src.buffer = ab; src.connect(off.destination); src.start();
    ab = await off.startRendering();
  }
  const n = ab.length, mono = new Float32Array(n);
  for (let c = 0; c < ab.numberOfChannels; c++) {
    const d = ab.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / ab.numberOfChannels;
  }
  return mono;
}

/** Trozos de ≤28 s cortados en el punto más silencioso entre los 15 y 28 s,
 *  para que Whisper no parta palabras. */
function trozosPorSilencio(audio, sr, max = 28, min = 15) {
  const paso = Math.round(sr * 0.05), nF = Math.floor(audio.length / paso);
  const e = new Float32Array(nF);
  for (let f = 0; f < nF; f++) { let s = 0; for (let j = 0; j < paso; j++) s += audio[f * paso + j] ** 2; e[f] = s; }
  const dur = audio.length / sr, out = [];
  let t = 0;
  while (t < dur - 0.2) {
    if (dur - t <= max) { out.push([t, dur]); break; }
    const f0 = Math.floor((t + min) / 0.05), f1 = Math.floor((t + max) / 0.05);
    let mejor = f1, mv = Infinity;
    for (let f = f0; f < f1 - 6; f++) { let s = 0; for (let j = 0; j < 6; j++) s += e[f + j]; if (s < mv) { mv = s; mejor = f + 3; } }
    const c = mejor * 0.05;
    out.push([t, c]); t = c;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Proceso completo
// ---------------------------------------------------------------------------
async function analizar() {
  const archivo = $("#archivo").files[0];
  if (!archivo) { alertaForm("Elige primero un archivo de video o audio."); return; }
  let desde, hasta;
  try { desde = parseTiempo($("#desde").value) || 0; hasta = parseTiempo($("#hasta").value); }
  catch (e) { alertaForm(e.message); return; }
  if (hasta != null && hasta <= desde) { alertaForm("«Hasta» debe ser mayor que «Desde»."); return; }
  alertaForm("");
  const modelo = $("#modelo").value;
  const separar = $("#separar").checked;
  const kSel = $("#n-oradores").value;
  const conVideo = $("#con-video").checked && archivo.type.startsWith("video");
  const fps = Number($("#fps").value);

  estado.archivo = archivo;
  estado.cancelar = false;
  $("#progreso").hidden = false;
  $("#resultados").hidden = true;
  $("#log").textContent = "";
  $("#btn-analizar").disabled = true;
  $("#btn-cancelar").hidden = false;
  document.querySelectorAll("#etapas li").forEach((li) => { li.dataset.estado = "pendiente"; li.querySelector(".barra-av i").style.width = "0"; li.querySelector(".det").textContent = ""; });
  if (!conVideo) etapa("video", "omitida", null, archivo.type.startsWith("video") ? "desactivado" : "el archivo no tiene video");
  if (!separar) etapa("oradores", "omitida", null, "desactivado");
  $("#progreso").scrollIntoView({ behavior: "smooth", block: "start" });

  const workerASR = new Worker(new URL("./asr-worker.js", import.meta.url), { type: "module" });
  const workerVoz = new Worker(new URL("./voz-worker.js", import.meta.url), { type: "module" });
  const t0 = performance.now();
  try {
    // 1. audio
    etapa("audio", "activa", 0.1, archivo.name);
    let audio = await decodificarAudio(archivo);
    const i0 = Math.floor(desde * SR), i1 = hasta != null ? Math.min(audio.length, Math.floor(hasta * SR)) : audio.length;
    audio = audio.slice(i0, i1);
    const dur = audio.length / SR;
    if (dur < 2) throw new Error("El tramo de audio es demasiado corto.");
    etapa("audio", "hecha", 1, `${A.fmtTiempo(dur)} de audio`);
    log(`Audio listo: ${A.fmtTiempo(dur)} (desde ${A.fmtTiempo(desde)}).`);

    // 2. voz (tono/volumen) en paralelo
    const pistaP = new Promise((ok, mal) => {
      workerVoz.onmessage = ({ data }) => { if (data.tipo === "pista") ok(data.pista); };
      workerVoz.onerror = (e) => mal(new Error("Pista de voz: " + e.message));
      workerVoz.postMessage({ audio, sr: SR });
    });
    etapa("voz", "activa", null, "en paralelo");
    pistaP.then(() => etapa("voz", "hecha", 1, "tono e intensidad"));

    // 3. transcripción
    const trozos = trozosPorSilencio(audio, SR);
    etapa("transcripcion", "activa", 0, "cargando modelo…");
    workerASR.postMessage({ tipo: "audio", audio, sr: SR });
    const palabras = [];
    const descargas = {};
    await new Promise((ok, mal) => {
      workerASR.onmessage = ({ data }) => {
        if (data.tipo === "descarga") {
          descargas[data.archivo] = [data.cargado, data.total];
          const [c, t] = Object.values(descargas).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
          etapa("transcripcion", "activa", c / t, `descargando ${data.etiqueta}: ${(c / 1e6).toFixed(0)} / ${(t / 1e6).toFixed(0)} MB`);
        } else if (data.tipo === "info") log(data.texto);
        else if (data.tipo === "palabras") {
          palabras.push(...data.palabras);
          const s = (performance.now() - t0) / 1000;
          etapa("transcripcion", "activa", data.hechos / data.total, `${data.hechos}/${data.total} trozos · ${palabras.length} palabras`);
          if (data.hechos === 1 || data.hechos % 10 === 0) log(`Transcritos ${data.hechos}/${data.total} trozos (${s.toFixed(0)} s).`);
          if (estado.cancelar) mal(new Error("Cancelado."));
        } else if (data.tipo === "error") mal(new Error(data.texto));
        else if (data.tipo === "listo") ok();
      };
      workerASR.onerror = (e) => mal(new Error("Worker de transcripción: " + (e.message || "error al cargar")));
      workerASR.postMessage({ tipo: "transcribir", trozos, modelo, forzarCPU: false });
    });
    palabras.sort((a, b) => a.inicio - b.inicio);
    if (!palabras.length) throw new Error("No se detectó habla en el audio.");
    etapa("transcripcion", "hecha", 1, `${palabras.length} palabras`);

    // 4. huellas de voz → oradores
    let segmentos = A.segmentosDeVoz(palabras);
    if (separar) {
      etapa("oradores", "activa", 0, "cargando modelo…");
      const descV = {};
      const embs = await new Promise((ok, mal) => {
        workerASR.onmessage = ({ data }) => {
          if (data.tipo === "descarga") {
            descV[data.archivo] = [data.cargado, data.total];
            const [c, t] = Object.values(descV).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
            etapa("oradores", "activa", c / t, `descargando modelo de voz: ${(c / 1e6).toFixed(0)} / ${(t / 1e6).toFixed(0)} MB`);
          } else if (data.tipo === "avance") {
            etapa("oradores", "activa", data.hechos / data.total, `${data.hechos}/${data.total} segmentos de voz`);
            if (estado.cancelar) mal(new Error("Cancelado."));
          } else if (data.tipo === "info") log(data.texto);
          else if (data.tipo === "huellas") ok(data.embeddings);
          else if (data.tipo === "error") mal(new Error(data.texto));
        };
        workerASR.postMessage({ tipo: "huellas", segmentos: segmentos.map(({ inicio, fin }) => ({ inicio, fin })) });
      });
      segmentos = segmentos.map((s, i) => ({ ...s, emb: embs[i] }));
      etapa("oradores", "hecha", 1, `${segmentos.length} segmentos`);
    }
    workerASR.terminate();

    // 5. video
    let cuadros = [];
    if (conVideo) {
      etapa("video", "activa", 0, "cargando MediaPipe…");
      let ult = 0;
      cuadros = await analizarVideo(archivo, {
        desde, hasta: hasta ?? desde + dur, fps,
        cancelado: () => estado.cancelar,
        progreso: (x) => {
          const ahora = performance.now();
          if (ahora - ult > 250) { ult = ahora; etapa("video", "activa", x, `${Math.round(x * 100)}% · ${fps} cuadros/s`); }
        },
      });
      if (estado.cancelar) throw new Error("Cancelado.");
      const conRostro = cuadros.filter((c) => c.bs).length;
      etapa("video", "hecha", 1, `${cuadros.length} cuadros, ${conRostro} con rostro`);
      log(`Video: ${cuadros.length} cuadros analizados, ${conRostro} con rostro.`);
    }

    const pista = await pistaP;
    workerVoz.terminate();

    estado.crudo = {
      version: 1, archivo: archivo.name, desde, hasta: desde + dur, duracion: dur,
      modelo, fps: conVideo ? fps : null, creado: new Date().toISOString(),
      palabras, segmentos, pista, cuadros,
      k: separar ? (kSel === "auto" ? null : Number(kSel)) : 1,
      nombresManual: {},
    };
    etapa("reporte", "hecha", 1, `listo en ${A.fmtTiempo((performance.now() - t0) / 1000)}`);
    log("Análisis terminado.");
    mostrarResultados();
  } catch (e) {
    log("ERROR: " + e.message);
    const activa = $('#etapas li[data-estado="activa"]');
    if (activa) etapa(activa.dataset.etapa, "error", null, e.message);
    console.error(e);
  } finally {
    workerASR.terminate(); workerVoz.terminate();
    $("#btn-analizar").disabled = false;
    $("#btn-cancelar").hidden = true;
  }
}

function alertaForm(t) { $("#aviso-form").textContent = t; $("#aviso-form").hidden = !t; }

// ---------------------------------------------------------------------------
// Resultados
// ---------------------------------------------------------------------------
function recalcular() {
  const c = estado.crudo;
  estado.R = A.derivar(c, { k: c.k, nombresManual: c.nombresManual });
  // colores fijos por speaker_id (no por rango): renombrar no repinta
  const ids = [...new Set(estado.R.turnos.map((t) => t.speaker_id))].sort();
  estado.colorId = Object.fromEntries(ids.map((id, i) => [id, PALETA[i] || GRIS]));
  estado.colorOrador = {};
  for (const f of estado.R.oradores) {
    const n = estado.R.nombres[f.speaker_id];
    if (!estado.colorOrador[n]) estado.colorOrador[n] = estado.colorId[f.speaker_id];
  }
}
const colorDe = (orador) => estado.colorOrador[orador] || GRIS;

function mostrarResultados() {
  recalcular();
  $("#resultados").hidden = false;
  const reproductor = $("#reproductor");
  if (estado.archivo) {
    if (reproductor.dataset.url) URL.revokeObjectURL(reproductor.dataset.url);
    const url = URL.createObjectURL(estado.archivo);
    reproductor.dataset.url = url;
    reproductor.src = url;
    reproductor.hidden = false;
    $("#sin-medio").hidden = true;
  } else {
    reproductor.hidden = true;
    $("#sin-medio").hidden = false;
  }
  $("#k-oradores").value = estado.crudo.k == null ? "auto" : String(estado.crudo.k);
  $("#k-oradores").disabled = !estado.crudo.segmentos?.[0]?.emb;
  renderTodo();
  $("#resultados").scrollIntoView({ behavior: "smooth", block: "start" });
}

function irA(t) {
  const v = $("#reproductor");
  if (v.hidden || !v.src) return;
  v.currentTime = (estado.crudo.desde || 0) + t;
  v.play().catch(() => {});
  v.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderTodo() {
  const { R, crudo } = estado;
  const oradores = Object.entries(R.verbal.por_orador).sort((a, b) => b[1].tiempo_s - a[1].tiempo_s);
  const confiables = R.linea.filter((f) => f.rostro_parece_hablar).length;
  $("#titulo-sesion").textContent = crudo.archivo;
  $("#kpis").innerHTML = [
    [A.fmtTiempo(crudo.duracion), "duración analizada"],
    [R.verbal.global.n_palabras.toLocaleString("es-CL"), "palabras"],
    [oradores.length, "oradores"],
    [R.ventanas.length, "tramos de ~20 s"],
    [crudo.cuadros?.length ? `${confiables}/${R.ventanas.length}` : "—", "tramos con rostro confiable"],
  ].map(([v, t]) => `<div class="kpi"><b>${esc(v)}</b><span>${esc(t)}</span></div>`).join("");

  renderOradores();
  renderTiempo(oradores);
  renderLinea();
  renderMarcadores(oradores);
  renderFichas(oradores);
  renderTranscripcion();
}

function renderOradores() {
  const { R } = estado;
  $("#tabla-oradores tbody").innerHTML = R.oradores.map((f) => `
    <tr>
      <td><span class="punto" style="background:${estado.colorId[f.speaker_id]}"></span><code>${esc(f.speaker_id)}</code></td>
      <td><input class="nombre" data-sid="${esc(f.speaker_id)}" value="${esc(f.nombre)}" placeholder="${esc(f.nombre_sugerido || f.speaker_id)}" aria-label="Nombre de ${esc(f.speaker_id)}"></td>
      <td class="num">${esc(A.fmtTiempo(f.tiempo_total_s))}</td>
      <td class="num">${f.n_turnos}</td>
      <td class="muestra">${esc(f.muestra_texto)}${f.evidencia ? `<div class="evid">${esc(f.evidencia)}</div>` : ""}</td>
      <td><button type="button" class="btn-mini" data-ir="${R.turnos.find((t) => t.speaker_id === f.speaker_id)?.inicio ?? 0}">▶ Escuchar</button></td>
    </tr>`).join("");
}

function barras(items, maximo, fmt) {
  return items.map(([n, v]) => `
    <div class="barra"><span class="n" title="${esc(n)}"><span class="punto" style="background:${colorDe(n)}"></span>${esc(n)}</span>
      <span class="pista"><i style="width:${maximo ? Math.max(1, (100 * v) / maximo) : 0}%;background:${colorDe(n)}"></i></span>
      <span class="v">${fmt(v, n)}</span></div>`).join("");
}

function renderTiempo(oradores) {
  const max = Math.max(...oradores.map(([, o]) => o.tiempo_s), 0);
  $("#tiempo-palabra").innerHTML = barras(oradores.map(([n, o]) => [n, o.tiempo_s]), max,
    (v, n) => `${A.fmtTiempo(v)} · ${num(estado.R.verbal.por_orador[n].pct_tiempo, 0, "%")}`);
}

// --- línea de tiempo ---
function renderLinea() {
  const { R } = estado;
  const campo = estado.metrica;
  const [titulo, ayuda] = METRICAS[campo];
  $("#metrica-ayuda").textContent = ayuda;
  const puntos = R.linea.filter((f) => f[campo] != null).map((f) => ({ f, x: (f.inicio + f.fin) / 2, y: f[campo] }));
  const svg = $("#grafico");
  const W = svg.clientWidth || 900, H = 280, m = { l: 48, r: 12, t: 12, b: 58 };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const dur = estado.crudo.duracion || 1;
  const X = (t) => m.l + (t / dur) * (W - m.l - m.r);
  if (!puntos.length) {
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="vacio">Sin datos para «${esc(titulo)}» (¿se analizó el video? ¿hay tramos suficientes por orador?)</text>`;
    $("#tabla-linea").innerHTML = "";
    return;
  }
  let y0 = Math.min(...puntos.map((p) => p.y)), y1 = Math.max(...puntos.map((p) => p.y));
  if (campo.startsWith("z_") || campo.startsWith("activ") || campo.startsWith("desfase")) { const a = Math.max(Math.abs(y0), Math.abs(y1), 1); y0 = -a; y1 = a; }
  if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
  const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b - 22);
  const baseY = H - m.b - 22;

  const ticks = 4, grid = [];
  for (let i = 0; i <= ticks; i++) {
    const v = y0 + ((y1 - y0) * i) / ticks;
    grid.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(Math.abs(y1 - y0) < 10 ? 1 : 0)}</text>`);
  }
  if (y0 < 0 && y1 > 0) grid.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}" class="cero"/>`);
  const nT = Math.min(8, Math.max(2, Math.floor((W - m.l) / 110)));
  for (let i = 0; i <= nT; i++) { const t = (dur * i) / nT; grid.push(`<text x="${X(t)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === nT ? "end" : "middle"}">${A.fmtTiempo(t)}</text>`); }

  // banda de quién habla
  const banda = R.linea.map((f) => `<rect x="${X(f.inicio)}" y="${baseY + 10}" width="${Math.max(1, X(f.fin) - X(f.inicio) - 1)}" height="10" rx="2" fill="${colorDe(f.orador)}"/>`).join("");
  const linea = `<polyline class="serie" points="${puntos.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ")}"/>`;
  const marcas = puntos.map((p, i) => `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="4.5" fill="${colorDe(p.f.orador)}" class="marca" data-i="${i}"/>`).join("");
  svg.innerHTML = `${grid.join("")}${banda}<text x="${m.l}" y="${baseY + 36}" class="eti-banda">quién habla</text>${linea}${marcas}<line class="cursor-v" y1="${m.t}" y2="${baseY}" hidden/>`;
  svg._puntos = puntos; svg._X = X; svg._Y = Y;

  $("#leyenda").innerHTML = Object.keys(R.verbal.por_orador).map((o) => `<span><i style="background:${colorDe(o)}"></i>${esc(o)}</span>`).join("");
  $("#tabla-linea").innerHTML = `<table><thead><tr><th>Tramo</th><th>Orador</th><th class="num">${esc(titulo)}</th><th>Texto</th></tr></thead><tbody>${
    puntos.map((p) => `<tr><td><button class="btn-t" data-ir="${p.f.inicio}">${A.fmtTiempo(p.f.inicio)}</button></td><td>${esc(p.f.orador)}</td><td class="num">${num(p.y, 2)}</td><td>${esc(p.f.texto.slice(0, 140))}${p.f.texto.length > 140 ? "…" : ""}</td></tr>`).join("")
  }</tbody></table>`;
}

function hoverLinea(ev) {
  const svg = $("#grafico"), tip = $("#tip");
  const P = svg._puntos;
  if (!P?.length) return;
  const rect = svg.getBoundingClientRect();
  const escala = (svg.viewBox.baseVal.width || rect.width) / rect.width;
  const x = (ev.clientX - rect.left) * escala;
  let mejor = P[0], md = Infinity;
  for (const p of P) { const d = Math.abs(svg._X(p.x) - x); if (d < md) { md = d; mejor = p; } }
  const cx = svg._X(mejor.x);
  const cur = svg.querySelector(".cursor-v");
  cur.setAttribute("x1", cx); cur.setAttribute("x2", cx); cur.removeAttribute("hidden");
  svg.querySelectorAll(".marca.on").forEach((c) => c.classList.remove("on"));
  svg.querySelector(`.marca[data-i="${P.indexOf(mejor)}"]`)?.classList.add("on");
  const f = mejor.f;
  tip.innerHTML = `<div class="tip-h"><span class="punto" style="background:${colorDe(f.orador)}"></span>${esc(f.orador)} · ${A.fmtTiempo(f.inicio)}–${A.fmtTiempo(f.fin)}</div>
    <div class="tip-v"><b>${num(mejor.y, 2)}</b> ${esc(METRICAS[estado.metrica][0])}</div>
    <div class="tip-t">${esc(f.texto.slice(0, 180))}${f.texto.length > 180 ? "…" : ""}</div><div class="tip-a">clic para reproducir</div>`;
  tip.hidden = false;
  const caja = svg.parentElement.getBoundingClientRect();
  const px = ev.clientX - caja.left;
  tip.style.left = `${Math.min(Math.max(8, px + 14), caja.width - tip.offsetWidth - 8)}px`;
  tip.style.top = `${ev.clientY - caja.top + 14}px`;
  svg._actual = mejor;
}

// --- marcadores ---
function renderMarcadores(oradores) {
  const max = {};
  for (const k of MOSTRAR) max[k] = Math.max(...oradores.map(([, o]) => o.marcadores_por_mil[k] || 0), 0);
  $("#tabla-marcadores").innerHTML = `<table><thead><tr><th>Orador</th>${MOSTRAR.map((k) => `<th class="num">${ETIQUETAS[k]}</th>`).join("")}</tr></thead><tbody>${
    oradores.map(([n, o]) => `<tr><td><span class="punto" style="background:${colorDe(n)}"></span>${esc(n)}</td>${MOSTRAR.map((k) => {
      const v = o.marcadores_por_mil[k] || 0;
      const a = max[k] ? (0.08 + 0.5 * v / max[k]).toFixed(2) : 0;
      return `<td class="num calor" style="--a:${a}" title="${o.marcadores[k] || 0} apariciones">${num(v, 1)}</td>`;
    }).join("")}</tr>`).join("")
  }</tbody></table>`;
}

// --- fichas ---
function renderFichas(oradores) {
  const { R } = estado;
  const perfilVoz = (n) => {
    const fs = R.linea.filter((f) => f.orador === n && f.f0_media_hz != null);
    if (!fs.length) return null;
    const m = (k) => fs.reduce((a, f) => a + (f[k] || 0), 0) / fs.length;
    return { f0: m("f0_media_hz"), var: m("f0_sd_st"), db: m("intensidad_media_db"), art: m("velocidad_articulacion"), pausas: m("pausas_por_min") };
  };
  $("#fichas").innerHTML = oradores.map(([n, o]) => {
    const nv = R.no_verbal.por_orador[n];
    const pv = perfilVoz(n);
    const maxP = o.top_palabras[0]?.[1] || 1;
    const nube = o.top_palabras.map(([w, c]) => `<span style="font-size:${(12 + 12 * (c / maxP)).toFixed(0)}px" title="${c} veces">${esc(w)}</span>`).join(" ");
    const chips = (xs, f) => xs.length ? xs.map(f).join("") : `<span class="mini">—</span>`;
    return `<article class="ficha" style="--c:${colorDe(n)}">
      <header><h3>${esc(n)}</h3><span class="mini">${esc(o.speaker_ids.join(", "))}</span></header>
      <dl class="datos">
        <div><dt>Tiempo</dt><dd>${A.fmtTiempo(o.tiempo_s)} (${num(o.pct_tiempo, 0, "%")})</dd></div>
        <div><dt>Palabras</dt><dd>${o.n_palabras}</dd></div>
        <div><dt>Velocidad</dt><dd>${num(o.velocidad_ppm, 0)} p/min</dd></div>
        <div><dt>Diversidad (MATTR)</dt><dd>${num(o.diversidad_mattr, 2)}</dd></div>
        <div><dt>Tono medio</dt><dd>${pv ? num(pv.f0, 0, " Hz") : "—"}</dd></div>
        <div><dt>Variación de tono</dt><dd>${pv ? num(pv.var, 1, " st") : "—"}</dd></div>
        <div><dt>Pausas</dt><dd>${pv ? num(pv.pausas, 1, "/min") : "—"}</dd></div>
        <div><dt>Articulación</dt><dd>${pv ? num(pv.art, 1, " pal/s") : "—"}</dd></div>
      </dl>
      <h4>Palabras más repetidas</h4><div class="nube">${nube || '<span class="mini">—</span>'}</div>
      <h4>Palabras distintivas <span class="mini">(keyness frente al resto)</span></h4>
      <div>${chips(o.palabras_distintivas.slice(0, 15), (k) => `<span class="chip${k.significativa ? " sig" : ""}" title="LL ${k.ll} · ${k.frec} vs ${k.frec_resto}">${esc(k.palabra)}</span>`)}</div>
      <h4>Frases que repite</h4>
      <div>${chips(o.consignas.slice(0, 10), ([g, c]) => `<span class="chip">«${esc(g)}» ×${c}</span>`)}</div>
      <h4>Expresiones frecuentes</h4>
      <div>${chips(o.top_bigramas.slice(0, 10), ([g, c]) => `<span class="chip">${esc(g)} ×${c}</span>`)}</div>
      ${nv ? `<h4>Rostro y cuerpo <span class="mini">(${nv.n_cuadros} cuadros donde su rostro parece estar hablando)</span></h4>
      <dl class="datos">
        <div><dt>Tensión del ceño</dt><dd>${num(nv.tension_ceno, 2)}</dd></div>
        <div><dt>Cejas elevadas</dt><dd>${num(nv.cejas_elevadas, 2)}</dd></div>
        <div><dt>Presión de labios</dt><dd>${num(nv.presion_labios, 2)}</dd></div>
        <div><dt>Sonrisa</dt><dd>${num(nv.sonrisa, 2)}</dd></div>
        <div><dt>Desagrado</dt><dd>${num(nv.desagrado, 2)}</dd></div>
        <div><dt>Energía gestual</dt><dd>${num(nv.energia_gestual, 2)}</dd></div>
        <div><dt>Mov. de cabeza</dt><dd>${num(nv.movimiento_cabeza, 1, "°/s")}</dd></div>
        <div><dt>Plano típico</dt><dd>${esc((nv.tipo_plano || "").replace("_", " "))}</dd></div>
      </dl>` : estado.crudo.cuadros?.length ? `<p class="mini">Sin tramos donde su rostro aparezca hablando en pantalla.</p>` : ""}
    </article>`;
  }).join("");
}

// --- transcripción ---
function renderTranscripcion() {
  const filtro = $("#buscar").value.trim().toLowerCase();
  const ts = estado.R.ventanas.filter((v) => !filtro || v.texto.toLowerCase().includes(filtro));
  const n = estado.R.nombres;
  $("#transcripcion").innerHTML = ts.map((v) => `
    <div class="turno${v.breve ? " breve" : ""}">
      <button class="btn-t" data-ir="${v.inicio}">${A.fmtTiempo(v.inicio)}</button>
      <div><div class="o"><span class="punto" style="background:${colorDe(n[v.speaker_id])}"></span>${esc(n[v.speaker_id])}</div><p>${resaltar(v.texto, filtro)}</p></div>
    </div>`).join("") || `<p class="mini">Sin coincidencias.</p>`;
}
function resaltar(texto, q) {
  const t = esc(texto);
  if (!q) return t;
  const qe = esc(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return t.replace(new RegExp(qe, "gi"), (m) => `<mark>${m}</mark>`);
}

// ---------------------------------------------------------------------------
// Descargas y sesión guardada
// ---------------------------------------------------------------------------
function base() { return (estado.crudo.archivo || "sesion").replace(/\.[^.]+$/, ""); }
const DESCARGAS = {
  linea: () => descargar(`${base()}_linea_tiempo.csv`, A.csvLineaTiempo(estado.R.linea), "text/csv"),
  oradores: () => descargar(`${base()}_oradores.csv`, A.aCSV(estado.R.oradores), "text/csv"),
  verbal: () => descargar(`${base()}_verbal.json`, JSON.stringify(estado.R.verbal, null, 2), "application/json"),
  transcripcion: () => descargar(`${base()}_transcripcion.txt`, estado.R.turnos.map((t) =>
    `[${A.fmtTiempo(t.inicio)}] ${estado.R.nombres[t.speaker_id]}: ${t.texto}`).join("\n\n"), "text/plain"),
  cuadros: () => estado.crudo.cuadros?.length ? descargar(`${base()}_no_verbal_cuadros.csv`, csvCuadros(estado.crudo.cuadros), "text/csv") : null,
  sesion: () => descargar(`${base()}_sesion.json`, JSON.stringify(estado.crudo), "application/json"),
};

async function cargarSesion(archivo) {
  try {
    const c = JSON.parse(await archivo.text());
    if (!c.palabras || c.version !== 1) throw new Error("No parece un archivo de sesión de esta herramienta.");
    estado.crudo = c;
    estado.archivo = null;
    log(`Sesión cargada: ${c.archivo}`);
    mostrarResultados();
  } catch (e) { alertaForm("No se pudo cargar la sesión: " + e.message); }
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------
function init() {
  const zona = $("#zona"), input = $("#archivo");
  const mostrarArchivo = () => {
    const f = input.files[0];
    $("#nombre-archivo").textContent = f ? `${f.name} · ${(f.size / 1e6).toFixed(1)} MB` : "Ningún archivo elegido";
    zona.classList.toggle("con-archivo", !!f);
    if (f && f.size > 600e6) alertaForm("Archivo grande: el navegador podría quedarse sin memoria. Si falla, analiza por tramos (Desde / Hasta).");
    else alertaForm("");
  };
  input.addEventListener("change", mostrarArchivo);
  zona.addEventListener("dragover", (e) => { e.preventDefault(); zona.classList.add("sobre"); });
  zona.addEventListener("dragleave", () => zona.classList.remove("sobre"));
  zona.addEventListener("drop", (e) => {
    e.preventDefault(); zona.classList.remove("sobre");
    if (e.dataTransfer.files[0]) { input.files = e.dataTransfer.files; mostrarArchivo(); }
  });
  $("#con-video").addEventListener("change", () => { $("#fps").disabled = !$("#con-video").checked; });
  $("#separar").addEventListener("change", () => { $("#n-oradores").disabled = !$("#separar").checked; });
  $("#form").addEventListener("submit", (e) => { e.preventDefault(); analizar(); });
  $("#btn-cancelar").addEventListener("click", () => { estado.cancelar = true; log("Cancelando…"); });
  $("#cargar-sesion").addEventListener("change", (e) => { if (e.target.files[0]) cargarSesion(e.target.files[0]); e.target.value = ""; });
  $("#asociar-medio").addEventListener("change", (e) => {
    if (!e.target.files[0]) return;
    estado.archivo = e.target.files[0];
    const v = $("#reproductor");
    v.src = URL.createObjectURL(estado.archivo); v.hidden = false; $("#sin-medio").hidden = true;
  });

  // clics para reproducir
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ir]");
    if (b) irA(Number(b.dataset.ir));
    const d = e.target.closest("[data-descarga]");
    if (d) DESCARGAS[d.dataset.descarga]();
  });

  // nombres y número de oradores → recalcular
  $("#tabla-oradores").addEventListener("change", (e) => {
    const i = e.target.closest("input.nombre");
    if (!i) return;
    estado.crudo.nombresManual[i.dataset.sid] = i.value.trim();
    recalcular(); renderTodo();
  });
  $("#k-oradores").addEventListener("change", (e) => {
    estado.crudo.k = e.target.value === "auto" ? null : Number(e.target.value);
    estado.crudo.nombresManual = {}; // los ids cambian al reagrupar
    recalcular(); renderTodo();
  });

  $("#metrica").innerHTML = Object.entries(METRICAS).map(([k, [t]]) => `<option value="${k}">${t}</option>`).join("");
  $("#metrica").value = estado.metrica;
  $("#metrica").addEventListener("change", (e) => { estado.metrica = e.target.value; renderLinea(); });
  const svg = $("#grafico");
  svg.addEventListener("pointermove", hoverLinea);
  svg.addEventListener("pointerleave", () => { $("#tip").hidden = true; svg.querySelector(".cursor-v")?.setAttribute("hidden", ""); svg.querySelectorAll(".marca.on").forEach((c) => c.classList.remove("on")); });
  svg.addEventListener("click", () => { if (svg._actual) irA(svg._actual.f.inicio); });
  let tm;
  window.addEventListener("resize", () => { clearTimeout(tm); tm = setTimeout(() => estado.R && renderLinea(), 150); });
  $("#buscar").addEventListener("input", () => estado.R && renderTranscripcion());

  // aviso de capacidades
  const gpu = "gpu" in navigator;
  $("#aviso-equipo").textContent = gpu
    ? "Tu navegador tiene WebGPU: la transcripción usará la tarjeta gráfica."
    : "Tu navegador no tiene WebGPU: la transcripción usará solo el procesador (más lento). Chrome o Edge recientes suelen tenerlo.";
}

// para pruebas automatizadas
window.__analisis = { estado, A };
init();

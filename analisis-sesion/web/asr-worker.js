// Worker de modelos de voz (transformers.js): transcripción con Whisper y
// huellas de voz con WeSpeaker ResNet34 (el mismo modelo que usa pyannote)
// para separar hablantes. Corre fuera del hilo de la
// página para que la interfaz no se congele.

import {
  pipeline, AutoProcessor, AutoModel, env,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";

env.allowLocalModels = false;

const MODELOS_WHISPER = {
  tiny: "onnx-community/whisper-tiny_timestamped",
  base: "onnx-community/whisper-base_timestamped",
  small: "onnx-community/whisper-small_timestamped",
};
const MODELO_VOZ = "onnx-community/wespeaker-voxceleb-resnet34-LM";

let asr = null, asrClave = null, voz = null, vozProc = null;
// el audio se recibe una sola vez (una sesión larga pesa cientos de MB)
let audio = null, sr = 16000;

const enviar = (msg) => self.postMessage(msg);
const progreso = (etiqueta) => (p) => {
  if (p.status === "progress" && p.total) enviar({ tipo: "descarga", etiqueta, archivo: p.file, cargado: p.loaded, total: p.total });
};

async function tieneWebGPU() {
  try { return !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch { return false; }
}

async function cargarWhisper(modelo, forzarCPU) {
  const clave = `${modelo}-${forzarCPU}`;
  if (asr && asrClave === clave) return;
  const id = MODELOS_WHISPER[modelo] || MODELOS_WHISPER.base;
  const gpu = !forzarCPU && (await tieneWebGPU());
  // Las versiones cuantizadas (q4/q8) a veces devuelven marcas por palabra
  // degeneradas (todas en 29,98 s): se usa fp32 aunque pese más.
  const intentos = gpu
    ? [{ device: "webgpu", dtype: "fp32" }, { device: "wasm", dtype: "fp32" }]
    : [{ device: "wasm", dtype: "fp32" }];
  let error;
  for (const op of intentos) {
    try {
      asr = await pipeline("automatic-speech-recognition", id, { ...op, progress_callback: progreso("Whisper " + modelo) });
      asrClave = clave;
      enviar({ tipo: "info", texto: `Whisper ${modelo} cargado (${op.device === "webgpu" ? "GPU / WebGPU" : "CPU / WASM"}).` });
      return;
    } catch (e) { error = e; enviar({ tipo: "info", texto: `No se pudo usar ${op.device}: ${e.message}` }); }
  }
  throw error;
}

async function cargarVoz() {
  if (voz) return;
  vozProc = await AutoProcessor.from_pretrained(MODELO_VOZ, { progress_callback: progreso("WeSpeaker") });
  voz = await AutoModel.from_pretrained(MODELO_VOZ, { dtype: "fp32", device: "wasm", progress_callback: progreso("WeSpeaker") });
  enviar({ tipo: "info", texto: "Modelo de huellas de voz cargado." });
}

function rms(x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / (x.length || 1)); }

/** ¿Whisper no logró alinear las palabras? (muchas con la misma marca o
 *  fuera del trozo) */
function marcasDegeneradas(palabras, a, b) {
  if (palabras.length < 2) return false;
  const inicios = new Map();
  for (const p of palabras) inicios.set(p.inicio, (inicios.get(p.inicio) || 0) + 1);
  return Math.max(...inicios.values()) > palabras.length / 2
    || palabras.filter((p) => p.inicio < a - 0.5 || p.fin > b + 0.5).length > palabras.length / 4;
}

/** Respaldo: marcas por frase (más robustas) y reparto de las palabras dentro
 *  de cada frase según su largo. */
async function porFrases(trozo, a) {
  const out = await asr(trozo, { language: "spanish", task: "transcribe", return_timestamps: true });
  const palabras = [];
  for (const c of out.chunks || []) {
    const ws = (c.text || "").trim().split(/\s+/).filter(Boolean);
    if (!ws.length) continue;
    const i = a + (c.timestamp?.[0] ?? 0), f = a + (c.timestamp?.[1] ?? (c.timestamp?.[0] ?? 0) + ws.length * 0.35);
    const total = ws.reduce((x, w) => x + w.length + 1, 0);
    let t = i;
    for (const w of ws) {
      const d = ((f - i) * (w.length + 1)) / total;
      palabras.push({ palabra: w, inicio: Math.round(t * 1000) / 1000, fin: Math.round((t + d * 0.9) * 1000) / 1000 });
      t += d;
    }
  }
  return palabras;
}

async function transcribir({ trozos, modelo, forzarCPU }) {
  await cargarWhisper(modelo, forzarCPU);
  let hechos = 0;
  for (const [a, b] of trozos) {
    const trozo = audio.subarray(Math.floor(a * sr), Math.floor(b * sr));
    const palabras = [];
    // un trozo casi en silencio hace que Whisper invente texto: se omite
    if (rms(trozo) > 0.003 && trozo.length > sr * 0.5) {
      const out = await asr(trozo, { language: "spanish", task: "transcribe", return_timestamps: "word" });
      for (const c of out.chunks || []) {
        const w = (c.text || "").trim();
        if (!w) continue;
        const [i, f] = c.timestamp || [];
        const inicio = a + (i ?? 0);
        const fin = a + (f ?? Math.min(b - a, (i ?? 0) + 0.3));
        palabras.push({ palabra: w, inicio: Math.round(inicio * 1000) / 1000, fin: Math.round(Math.max(fin, inicio + 0.01) * 1000) / 1000 });
      }
    }
    if (marcasDegeneradas(palabras, a, b)) {
      palabras.splice(0, palabras.length, ...(await porFrases(trozo, a)));
      enviar({ tipo: "info", texto: `Trozo ${a.toFixed(0)}–${b.toFixed(0)} s: marcas por frase (Whisper no alineó palabra por palabra).` });
    }
    hechos++;
    enviar({ tipo: "palabras", palabras, hechos, total: trozos.length });
  }
}

async function huellas({ segmentos }) {
  await cargarVoz();
  const out = [];
  for (let i = 0; i < segmentos.length; i++) {
    let { inicio, fin } = segmentos[i];
    // la huella necesita al menos ~1 s de voz: los segmentos cortos se amplían
    if (fin - inicio < 1.2) { const c = (inicio + fin) / 2; inicio = Math.max(0, c - 0.6); fin = c + 0.6; }
    const trozo = audio.slice(Math.floor(inicio * sr), Math.min(audio.length, Math.floor(fin * sr)));
    const inputs = await vozProc(trozo);
    const { last_hidden_state: emb } = await voz(inputs);
    out.push(Array.from(emb.data, (x) => Math.round(x * 1e4) / 1e4));
    if (i % 5 === 0 || i === segmentos.length - 1) enviar({ tipo: "avance", hechos: i + 1, total: segmentos.length });
  }
  enviar({ tipo: "huellas", embeddings: out });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.tipo === "audio") { audio = data.audio; sr = data.sr; return; }
    if (data.tipo === "transcribir") await transcribir(data);
    else if (data.tipo === "huellas") await huellas(data);
    enviar({ tipo: "listo", de: data.tipo });
  } catch (e) {
    enviar({ tipo: "error", texto: e?.message || String(e) });
  }
};

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import * as d3 from "d3";

// ======================================================
// 01 — PALETA Y REGLAS DE FAMILIA
// (color, curvatura, elongación, densidad, transmisión)
// ======================================================

const PALETTE = {
  cyan: 0x3fe6d2,
  deepBlue: 0x4f6bff,
  coral: 0xff6a52,
  orange: 0xff9640,
  yellow: 0xffd23f,
  pink: 0xff5fa8,
  violet: 0xa06bff,
  neutral: 0x8a8f96,
};

const FAMILY_TABLE = {
  "floral": { color: PALETTE.pink, curvature: 1.05, elongation: 0.95, density: 0.42, transmission: 0.55 },
  "soft floral": { color: PALETTE.pink, curvature: 1.25, elongation: 0.9, density: 0.3, transmission: 0.68 },
  "oriental": { color: PALETTE.orange, curvature: 0.8, elongation: 1.05, density: 0.62, transmission: 0.32 },
  "soft oriental": { color: PALETTE.orange, curvature: 1.0, elongation: 1.0, density: 0.45, transmission: 0.48 },
  "floral oriental": { color: PALETTE.coral, curvature: 0.95, elongation: 1.0, density: 0.5, transmission: 0.42 },
  "woody oriental": { color: PALETTE.violet, curvature: 0.65, elongation: 1.2, density: 0.68, transmission: 0.28 },
  "woody": { color: PALETTE.deepBlue, curvature: 0.55, elongation: 1.3, density: 0.75, transmission: 0.22 },
  "aromatic": { color: PALETTE.cyan, curvature: 0.9, elongation: 1.0, density: 0.4, transmission: 0.5 },
  "fruity": { color: PALETTE.coral, curvature: 1.35, elongation: 0.85, density: 0.32, transmission: 0.62 },
  "citrus": { color: PALETTE.yellow, curvature: 1.45, elongation: 0.8, density: 0.28, transmission: 0.72 },
  "leather": { color: PALETTE.deepBlue, curvature: 0.45, elongation: 1.2, density: 0.85, transmission: 0.16 },
  "oud": { color: PALETTE.violet, curvature: 0.5, elongation: 1.15, density: 0.88, transmission: 0.18 },
  "aquatic": { color: PALETTE.cyan, curvature: 1.55, elongation: 0.9, density: 0.25, transmission: 0.78 },
  "arabian": { color: PALETTE.violet, curvature: 0.6, elongation: 1.1, density: 0.8, transmission: 0.22 },
  "chypre": { color: PALETTE.deepBlue, curvature: 0.7, elongation: 1.05, density: 0.6, transmission: 0.36 },
  "sweet": { color: PALETTE.pink, curvature: 1.2, elongation: 0.95, density: 0.4, transmission: 0.55 },
};
const FAMILY_FALLBACK = { color: PALETTE.neutral, curvature: 1.0, elongation: 1.0, density: 0.4, transmission: 0.5 };

function familyParams(key) {
  return FAMILY_TABLE[key] || FAMILY_FALLBACK;
}

// ======================================================
// 02 — UTILIDADES: HASH, PRNG, RUIDO 3D (seedeable)
// ======================================================

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise3D(seed) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (t, a, b) => a + t * (b - a);
  const grad = (hash, x, y, z) => {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };

  return function noise3D(x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    return lerp(
      w,
      lerp(
        v,
        lerp(u, grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z)),
        lerp(u, grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z))
      ),
      lerp(
        v,
        lerp(u, grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1)),
        lerp(u, grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1))
      )
    );
  };
}

// respeta la preferencia del sistema: sin rotación automática ni tweens largos
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// color = IDENTIDAD de la nota (hash de su nombre), no su familia: la misma
// nota es siempre el mismo color en cualquier perfume, así dos composiciones
// que comparten notas se leen parecidas de un vistazo. Lo usan por igual la
// escena principal y el mapa de notas (antes cada vista tenía su criterio).
const noteColorCache = new Map();
function noteIdentityColor(key) {
  let c = noteColorCache.get(key);
  if (c) return c;
  const rand = mulberry32(hashString("noteIdentity:" + key));
  const h = rand();
  const s = 0.5 + rand() * 0.28;
  const l = 0.54 + rand() * 0.16;
  c = new THREE.Color().setHSL(h, s, l);
  noteColorCache.set(key, c);
  return c;
}

// sector angular por CATEGORÍA olfativa de la nota (cítrico, floral, madera,
// almizcle…): la nota siempre cae en la misma región de la esfera, así que
// la silueta de la nube ya cuenta el balance del perfume (más volumen a la
// izquierda = más maderas, etc.) en vez de ser ruido hash puro.
const NOTE_SECTOR_COUNT = 9; // 7 categorías + 2 cubos "otros"
const noteDirCache = new Map();

function noteSector(key) {
  for (let i = 0; i < NOTE_CATEGORIES.length; i++) {
    for (const re of NOTE_CATEGORIES[i].regexes) {
      if (re.test(key)) return i;
    }
  }
  return NOTE_CATEGORIES.length + (hashString("sector:" + key) % (NOTE_SECTOR_COUNT - NOTE_CATEGORIES.length));
}

function noteDirection(key) {
  if (noteDirCache.has(key)) return noteDirCache.get(key);
  const h = hashString(key);
  const r1 = mulberry32(h)();
  const r2 = mulberry32(h ^ 0x9e3779b9)();
  const sectorArc = (Math.PI * 2) / NOTE_SECTOR_COUNT;
  const theta = noteSector(key) * sectorArc + (r1 - 0.5) * sectorArc * 0.82;
  const phi = Math.acos(2 * r2 - 1);
  const dir = new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta)
  );
  noteDirCache.set(key, dir);
  return dir;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// ======================================================
// 03 — CARGA Y LIMPIEZA DE DATOS
// ======================================================

function cleanNoteList(raw) {
  if (!raw) return [];
  const seen = new Set();
  const out = [];
  raw.forEach((tok) => {
    let n = (tok || "").trim().replace(/\.+$/, "").trim();
    if (!n) return;
    const key = n.toLowerCase();
    if (key === "unknown") return;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label: n, key });
  });
  return out;
}

function cleanFamilyList(raw) {
  if (!raw) return [];
  const seen = new Set();
  const out = [];
  raw.split(",").forEach((tok) => {
    const n = tok.trim();
    if (!n) return;
    const key = n.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(key);
  });
  return out;
}

async function loadPerfumes() {
  const rows = await d3.json("./perfume_visualization.json");
  const records = rows.map((r, i) => {
    const families = cleanFamilyList(r.fragrance_family);
    return {
      id: r.perfume_id || `row-${i}`,
      name: (r.name || "").trim() || "Sin nombre",
      brand: (r.brand || "").trim() || "—",
      gender: (r.gender || "").trim(),
      year: Number.isFinite(r.year) ? Math.round(r.year) : null,
      family: families,
      familyLabel: families.length ? families.join(" / ") : "sin familia",
      familyPrimary: families[0] || "unknown",
      rate: Number.isFinite(r.rate) ? r.rate : null,
      ratingCount: Number.isFinite(r.rating_count) ? r.rating_count : null,
      concentration: (r.concentration || "").trim(),
      size: (r.size || "").trim(),
      price: Number.isFinite(r.price) ? r.price : null,
      productType: (r.product_type || "").trim(),
      top: cleanNoteList(r.top_notes),
      middle: cleanNoteList(r.middle_notes),
      base: cleanNoteList(r.base_notes),
    };
  });
  return records;
}

// ======================================================
// 04 — ESCALAS (D3)
// ======================================================

function buildScales(records) {
  const years = records.map((r) => r.year).filter((y) => y != null);
  const rates = records.map((r) => r.rate).filter((v) => v != null);
  const counts = records.map((r) => r.ratingCount).filter((v) => v != null);

  const yearDomainFull = d3.extent(years);
  // dominio de despliegue espacial: recortado en el percentil bajo para que
  // un puñado de años muy antiguos (outliers) no compriman el resto de la línea
  const sortedYears = [...years].sort((a, b) => a - b);
  const yearLow = d3.quantileSorted(sortedYears, 0.02) ?? yearDomainFull[0];

  const yearScale = d3.scaleLinear().domain([yearLow, yearDomainFull[1]]).range([-4.2, 4.2]).clamp(true);
  const rateScale = d3.scaleLinear().domain([1, 5]).range([0, 1]).clamp(true);
  const countScale = d3.scaleSqrt().domain(d3.extent(counts)).range([0, 1]).clamp(true);

  return { yearScale, yearDomainFull, rateScale, countScale };
}

// ======================================================
// 05 — ESCENA THREE.JS
// ======================================================

const root = document.getElementById("scene-root");

function getViewSize() {
  const w = root.clientWidth || window.innerWidth || 1;
  const h = root.clientHeight || window.innerHeight || 1;
  return { w, h };
}

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
{
  const { w, h } = getViewSize();
  renderer.setSize(w, h);
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
root.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x000000, 0.052);

// entorno neutro (habitación) para que vidrio/cromo/clearcoat reflejen algo
// coherente en vez de verse planos — estándar en three.js para PBR realista
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(36, getViewSize().w / getViewSize().h, 0.1, 200);
camera.position.set(10.5, 5.2, 11.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 4;
controls.maxDistance = 26;
controls.target.set(0, 0, 0);

scene.add(new THREE.AmbientLight(0x223344, 1.2));
const keyLight = new THREE.PointLight(0xffffff, 55, 60, 1.6);
keyLight.position.set(6, 8, 6);
scene.add(keyLight);
const rimLight = new THREE.PointLight(0x4f6bff, 40, 60, 1.6);
rimLight.position.set(-7, -3, -6);
scene.add(rimLight);
const fillLight = new THREE.PointLight(0xff6a52, 26, 60, 1.6);
fillLight.position.set(-4, 6, -3);
scene.add(fillLight);

function handleResize() {
  const { w, h } = getViewSize();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener("resize", handleResize);
new ResizeObserver(handleResize).observe(root);
// el viewport puede reportar 0px en los primeros frames (layout aún no
// resuelto); se reintenta unos frames hasta que el tamaño se estabiliza.
let resizeRetries = 0;
(function settleInitialSize() {
  handleResize();
  if (resizeRetries++ < 30) requestAnimationFrame(settleInitialSize);
})();

// ---- línea temporal en escena ----
const timelineGroup = new THREE.Group();
const timelineMat = new THREE.LineBasicMaterial({ color: 0x3a3a3a, transparent: true, opacity: 0.5 });
const timelineGeo = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(-4.6, -4.6, 0),
  new THREE.Vector3(4.6, -4.6, 0),
]);
timelineGroup.add(new THREE.Line(timelineGeo, timelineMat));
const timelineMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.07, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0x3fe6d2 })
);
timelineMarker.position.set(0, -4.6, 0);
timelineGroup.add(timelineMarker);
scene.add(timelineGroup);

const perfumeGroup = new THREE.Group();
scene.add(perfumeGroup);

// ======================================================
// 06 — ARQUETIPOS DE NOTA
// cada nota olfativa es un elemento 3D independiente — su forma es un
// hash determinístico de su nombre, así que la misma nota siempre genera
// el mismo objeto base (comparable entre perfumes); sólo su color, tamaño
// y posición relativa cambian según el perfume que la contiene.
// ======================================================

const ARCHETYPES = ["blob", "chrome", "fuzz", "concrete", "glass"];

// el arquetipo remite formalmente al ingrediente: cítricos → facetado
// translúcido, florales → lóbulos glossy, maderas → bloque macizo, almizcle
// → textura fibrosa, acuático/metálico → cromo, resinas → vidrio cálido.
// se resuelve por palabras clave en el propio nombre de la nota (con
// límites de palabra, para no confundir subcadenas sueltas); si no calza
// con ninguna categoría, cae al hash determinístico de siempre.
const NOTE_CATEGORY_DEFS = [
  { archetype: "glass", keywords: ["lemon", "lime", "bergamot", "orange", "grapefruit", "mandarin", "tangerine", "citrus", "yuzu", "clementine", "citron", "kumquat"] },
  { archetype: "blob", keywords: ["rose", "jasmine", "lily", "lilac", "peony", "peonies", "violet", "iris", "lavender", "ylang", "magnolia", "freesia", "gardenia", "tuberose", "orchid", "geranium", "mimosa", "narcissus", "neroli", "blossom", "petal", "flower", "carnation", "hyacinth", "osmanthus"] },
  { archetype: "chrome", keywords: ["aldehyde", "ozone", "ozonic", "marine", "aquatic", "mineral", "metallic", "metal", "steel", "rain", "sea salt", "salt"] },
  { archetype: "fuzz", keywords: ["musk", "powder", "powdery", "ambrette", "talc", "cashmere", "cotton", "green", "grass", "leaf", "mint", "basil", "sage", "thyme", "rosemary", "herbal", "galbanum", "tea"] },
  { archetype: "glass", keywords: ["amber", "vanilla", "tonka", "benzoin", "honey", "caramel", "praline", "resin", "balsam", "myrrh", "frankincense", "labdanum", "opoponax", "sugar", "gourmand"] },
  { archetype: "concrete", keywords: ["cedar", "sandalwood", "oud", "agarwood", "vetiver", "patchouli", "oak", "birch", "pine", "guaiac", "wood", "driftwood", "cypress", "bark", "smoke", "incense", "tobacco", "tar", "moss", "mushroom", "earthy", "leather", "suede", "castoreum", "civet", "animalic", "hay", "pepper", "cinnamon", "clove", "cardamom", "ginger", "nutmeg", "saffron", "spice", "chili", "anise", "cumin"] },
  { archetype: "blob", keywords: ["apple", "pear", "peach", "berry", "cherry", "plum", "fig", "raspberry", "blackcurrant", "apricot", "mango", "pineapple", "coconut", "melon", "grape", "fruit", "fruity", "strawberry"] },
];
const NOTE_CATEGORIES = NOTE_CATEGORY_DEFS.map((cat) => ({
  archetype: cat.archetype,
  regexes: cat.keywords.map((kw) => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i")),
}));

function classifyNoteArchetype(key) {
  for (const cat of NOTE_CATEGORIES) {
    for (const re of cat.regexes) {
      if (re.test(key)) return cat.archetype;
    }
  }
  return null;
}

const archetypeCache = new Map();
function archetypeForNote(key) {
  if (archetypeCache.has(key)) return archetypeCache.get(key);
  const result = classifyNoteArchetype(key) || ARCHETYPES[hashString("archetype:" + key) % ARCHETYPES.length];
  archetypeCache.set(key, result);
  return result;
}

function makeOrganicGeometry(radius, detail, seed, freq, amp) {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.getAttribute("position");
  const noise = makeNoise3D(seed);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r = radius;
    r += noise(v.x * freq + (seed % 13), v.y * freq, v.z * freq - (seed % 7)) * amp * radius;
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  geo.computeVertexNormals();
  return geo;
}

// esfera UV de alta resolución (en vez de icosaedro subdividido) para
// superficies que deben leerse lisas — el cromo pulido, sobre todo
function makeSmoothNoisyGeometry(radius, widthSeg, heightSeg, seed, freq, amp) {
  const geo = new THREE.SphereGeometry(radius, widthSeg, heightSeg);
  const pos = geo.getAttribute("position");
  const noise = makeNoise3D(seed);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r = radius;
    r += noise(v.x * freq + (seed % 13), v.y * freq, v.z * freq - (seed % 7)) * amp * radius;
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  geo.computeVertexNormals();
  return geo;
}

function randomOrientation(seed) {
  const rand = mulberry32(seed ^ 0x2244);
  return new THREE.Euler(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2);
}

// ---- blob: superficie orgánica, glossy, con leve iridiscencia ----
// rango paramétrico amplio: de una gota casi lisa a un lóbulo muy marcado
// y estirado — para que dos notas florales/frutales no se vean clonadas
function buildBlobNote(seed, colorHex) {
  const rand = mulberry32(seed ^ 0x1001);
  const axes = ["x", "y", "z"];
  const axis = axes[Math.floor(rand() * 3)];
  const elong = 0.04 + rand() * 0.58;
  const geo = makeOrganicGeometry(1, 3, seed, 0.9 + rand() * 2.4, 0.12 + rand() * 0.34);
  geo.scale(axis === "x" ? 1 + elong : 1, axis === "y" ? 1 + elong : 1, axis === "z" ? 1 + elong : 1);
  const mat = new THREE.MeshPhysicalMaterial({
    color: colorHex,
    roughness: 0.14,
    metalness: 0.02,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    iridescence: 0.55,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [120, 420],
    transmission: 0.06,
    thickness: 0.6,
    envMapIntensity: 1.3,
  });
  const mesh = new THREE.Mesh(geo, mat);
  return { object: mesh, colorMaterials: [mat] };
}

// ---- chrome: de bola espejo casi perfecta a un metal abollado/alargado ----
function buildChromeNote(seed, colorHex) {
  const rand = mulberry32(seed ^ 0x2002);
  const geo = makeSmoothNoisyGeometry(1, 40, 28, seed, 0.6 + rand() * 2.2, 0.01 + rand() * 0.13);
  const axes = ["x", "y", "z"];
  const axis = axes[Math.floor(rand() * 3)];
  const elong = rand() * 0.4;
  geo.scale(axis === "x" ? 1 + elong : 1, axis === "y" ? 1 + elong : 1, axis === "z" ? 1 + elong : 1);
  const c = new THREE.Color(colorHex).lerp(new THREE.Color(0xffffff), 0.4 + rand() * 0.35);
  const mat = new THREE.MeshPhysicalMaterial({
    color: c,
    roughness: 0.03 + rand() * 0.1,
    metalness: 1,
    clearcoat: 0.3,
    envMapIntensity: 1.6,
  });
  const mesh = new THREE.Mesh(geo, mat);
  return { object: mesh, colorMaterials: [mat] };
}

// ---- fuzz: núcleo + cerdas instanciadas — de pelusa rala y corta a un
// pompón denso y largo, según la nota ----
function buildFuzzNote(seed, colorHex) {
  const rand = mulberry32(seed ^ 0x3003);
  const coreR = 0.4 + rand() * 0.24;
  const group = new THREE.Group();
  const coreGeo = new THREE.SphereGeometry(coreR, 10, 10);
  const coreMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 1, metalness: 0 });
  group.add(new THREE.Mesh(coreGeo, coreMat));

  const count = 55 + Math.round(rand() * 160);
  const bristleLen = 0.35 + rand() * 0.85;
  const bristleGeo = new THREE.CylinderGeometry(0.015 + rand() * 0.02, 0.035 + rand() * 0.04, bristleLen, 5, 1);
  bristleGeo.translate(0, bristleLen / 2, 0);
  const bristleMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.95, metalness: 0 });
  const inst = new THREE.InstancedMesh(bristleGeo, bristleMat, count);
  const dummy = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    const dir = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
    dummy.position.copy(dir).multiplyScalar(coreR);
    dummy.quaternion.setFromUnitVectors(up, dir);
    const s = 0.6 + rand() * 0.75;
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;
  group.add(inst);
  return { object: group, colorMaterials: [coreMat, bristleMat] };
}

// ---- concrete: de bloque cúbico compacto a losa/torre alargada, con
// agregados — la proporción y la porosidad varían con cada nota ----
function buildConcreteNote(seed, colorHex) {
  const rand = mulberry32(seed ^ 0x4004);
  const w = 0.85 + rand() * 0.65;
  const h = 1.0 + rand() * 1.15;
  const noiseAmp = 0.03 + rand() * 0.16;

  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, w, 3, 4, 3);
  const pos = geo.getAttribute("position");
  const noise = makeNoise3D(seed);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise(v.x * 2.6 + (seed % 11), v.y * 2.6, v.z * 2.6 - (seed % 7)) * noiseAmp;
    pos.setXYZ(i, v.x + n, v.y + n * 0.6, v.z + n);
  }
  geo.computeVertexNormals();
  const baseColor = new THREE.Color(0x9a9a95).lerp(new THREE.Color(colorHex), 0.22);
  const mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.95, metalness: 0.05 });
  group.add(new THREE.Mesh(geo, mat));

  const colorMaterials = [mat];
  const pebbleCount = 1 + Math.round(rand() * 4);
  for (let i = 0; i < pebbleCount; i++) {
    const s = 0.07 + rand() * 0.1;
    const dark = rand() > 0.5;
    const pebbleMat = new THREE.MeshStandardMaterial({
      color: dark ? 0x161616 : colorHex,
      roughness: 0.35,
      metalness: 0.3,
    });
    const pebble = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 8), pebbleMat);
    pebble.position.set((rand() - 0.5) * w * 0.8, h / 2 + rand() * 0.25, (rand() - 0.5) * w * 0.8);
    group.add(pebble);
    if (!dark) colorMaterials.push(pebbleMat);
  }
  return { object: group, colorMaterials };
}

// ---- glass: de gota translúcida lisa a un cristal facetado e irregular,
// según cuánto "muerda" la nota ----
function buildGlassNote(seed, colorHex) {
  const rand = mulberry32(seed ^ 0x5005);
  const geo = makeSmoothNoisyGeometry(1, 36, 24, seed, 0.7 + rand() * 2.6, 0.02 + rand() * 0.22);
  const axes = ["x", "y", "z"];
  const axis = axes[Math.floor(rand() * 3)];
  const elong = rand() * 0.35;
  geo.scale(axis === "x" ? 1 + elong : 1, axis === "y" ? 1 + elong : 1, axis === "z" ? 1 + elong : 1);
  const mat = new THREE.MeshPhysicalMaterial({
    color: colorHex,
    transmission: 0.85 + rand() * 0.15,
    thickness: 0.7 + rand() * 0.9,
    roughness: 0.03 + rand() * 0.12,
    ior: 1.25 + rand() * 0.35,
    envMapIntensity: 1.3,
    clearcoat: 0.4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  return { object: mesh, colorMaterials: [mat] };
}

const NOTE_BUILDERS = {
  blob: buildBlobNote,
  chrome: buildChromeNote,
  fuzz: buildFuzzNote,
  concrete: buildConcreteNote,
  glass: buildGlassNote,
};

// (compat) color de nota — ahora delega en la identidad de la nota, sin
// depender de la familia; se conserva la firma por si algún llamador la usa
function noteColor(_baseColorHex, key) {
  return noteIdentityColor(key);
}

// ======================================================
// 07 — COLUMNA CENTRAL Y CACHÉ DE NOTAS
// la columna atraviesa las tres capas y le da coherencia física a la
// composición; cada nota se ancla a ella mediante un tendón (glass tube).
// ======================================================

const LAYER_DEFS = {
  top: { yOffset: 2.4, distance: 2.15, spread: 1.0, objBase: 0.46 },
  middle: { yOffset: 0, distance: 1.6, spread: 0.92, objBase: 0.58 },
  base: { yOffset: -2.1, distance: 1.05, spread: 0.8, objBase: 0.66 },
};
const MAX_NOTES_PER_LAYER = 9;
const LAYER_VISIBLE = { top: true, middle: true, base: true };

function buildSpineGeometry() {
  const height = 5.6;
  const geo = new THREE.CylinderGeometry(0.12, 0.17, height, 14, 10, false);
  const pos = geo.getAttribute("position");
  const noise = makeNoise3D(4242);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise(v.x * 2, v.y * 0.7, v.z * 2) * 0.05;
    const len = Math.hypot(v.x, v.z) || 1;
    pos.setXYZ(i, v.x + (v.x / len) * n, v.y, v.z + (v.z / len) * n);
  }
  geo.computeVertexNormals();
  return geo;
}

const spineMat = new THREE.MeshPhysicalMaterial({
  color: PALETTE.neutral,
  roughness: 0.6,
  metalness: 0.3,
  clearcoat: 0.3,
  clearcoatRoughness: 0.4,
  envMapIntensity: 1,
});
const spineMesh = new THREE.Mesh(buildSpineGeometry(), spineMat);
spineMesh.position.y = (LAYER_DEFS.top.yOffset + LAYER_DEFS.base.yOffset) / 2;
perfumeGroup.add(spineMesh);

["top", "middle", "base"].forEach((role) => {
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 14, 14),
    new THREE.MeshStandardMaterial({ color: 0xf4f4f1, metalness: 0.6, roughness: 0.25, emissive: 0x161616 })
  );
  marker.position.set(0, LAYER_DEFS[role].yOffset, 0);
  perfumeGroup.add(marker);
});

// key -> entry (una entrada persiste durante toda la sesión una vez vista;
// una nota "ausente" simplemente queda con escala 0 y oculta)
const noteCache = new Map();

function rebuildTendrilGeometry(mesh, fromV, toV, seed) {
  if (fromV.distanceToSquared(toV) < 1e-5) {
    mesh.geometry.dispose();
    mesh.geometry = new THREE.BufferGeometry();
    return;
  }
  const rand = mulberry32(seed ^ 0x77);
  const mid = fromV
    .clone()
    .lerp(toV, 0.5)
    .add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.55));
  const curve = new THREE.QuadraticBezierCurve3(fromV, mid, toV);
  const geo = new THREE.TubeGeometry(curve, 10, 0.026, 5, false);
  mesh.geometry.dispose();
  mesh.geometry = geo;
}

function ensureNoteEntry(key, role, label) {
  let entry = noteCache.get(key);
  if (entry) return entry;

  const seed = hashString(key);
  const archetype = archetypeForNote(key);
  const built = NOTE_BUILDERS[archetype](seed, PALETTE.neutral);
  built.object.rotation.copy(randomOrientation(seed));
  built.object.scale.setScalar(0.0001);
  built.object.visible = false;
  built.object.userData.noteKey = key;
  perfumeGroup.add(built.object);

  const tendrilMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transmission: 0.85,
    roughness: 0.25,
    thickness: 0.3,
    ior: 1.3,
    transparent: true,
    opacity: 0,
    envMapIntensity: 1,
  });
  const tendrilMesh = new THREE.Mesh(new THREE.BufferGeometry(), tendrilMat);
  tendrilMesh.visible = false;
  perfumeGroup.add(tendrilMesh);

  entry = {
    key,
    role,
    label,
    archetype,
    object: built.object,
    colorMaterials: built.colorMaterials,
    tendrilMesh,
    tendrilMat,
    spineAnchor: new THREE.Vector3(0, LAYER_DEFS[role].yOffset, 0),
  };
  noteCache.set(key, entry);
  return entry;
}

// la caché de notas crecía sin techo durante una sesión larga de exploración
// (cada nota vista quedaba en la escena a escala 0 con su geometría y
// materiales). Se purga lo que lleva rato invisible y no se necesita para el
// perfume que entra, dejando siempre un colchón de reutilización.
const NOTE_CACHE_CAP = 260;

function pruneNoteCache(keepKeys) {
  if (noteCache.size <= NOTE_CACHE_CAP) return;
  const removable = [];
  noteCache.forEach((entry, key) => {
    if (keepKeys.has(key)) return;
    if (entry.object.scale.x > 0.01) return; // aún visible / animándose
    removable.push(key);
  });
  const drop = noteCache.size - NOTE_CACHE_CAP;
  for (let i = 0; i < removable.length && i < drop; i++) {
    const entry = noteCache.get(removable[i]);
    perfumeGroup.remove(entry.object);
    perfumeGroup.remove(entry.tendrilMesh);
    entry.object.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    entry.tendrilMesh.geometry.dispose();
    entry.tendrilMat.dispose();
    noteCache.delete(removable[i]);
  }
}

// ======================================================
// 08 — OBJETIVO POR NOTA PARA UN PERFUME DADO
// ======================================================

function computeNoteTarget(role, note, family, scales, record, totalInLayer) {
  const layerDef = LAYER_DEFS[role];
  const dir = noteDirection(note.key);
  const seed = hashString(note.key);
  const rand = mulberry32(seed ^ 0x9f);

  const radialJitter = 0.82 + rand() * 0.36;
  const offset = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(layerDef.objBase * 0.7);

  const rateNorm = record.rate != null ? scales.rateScale(record.rate) : 0.35;
  const countNorm = record.ratingCount != null ? scales.countScale(record.ratingCount) : 0.2;
  const globalMul = 1 + 0.2 * rateNorm + 0.12 * countNorm;
  const countFactor = 1 / Math.sqrt(totalInLayer + 1);
  const scale = layerDef.objBase * (0.55 + 0.85 * countFactor) * globalMul;

  // el componente vertical de la dirección-nota se amortigua: cada capa ya
  // fija su propia franja vertical (yOffset), así que dir.y sólo aporta una
  // variación acotada en vez de poder empujar el objeto fuera de cuadro
  const pos = new THREE.Vector3(dir.x, dir.y * 0.42, dir.z).multiplyScalar(layerDef.distance * radialJitter).add(offset);
  pos.x *= layerDef.spread;
  pos.z *= layerDef.spread;
  pos.y += layerDef.yOffset;
  if (role === "base") pos.y -= 0.15;

  return {
    role,
    label: note.label,
    pos,
    scale,
    color: noteColor(family.color, note.key),
  };
}

function buildTargetsForRecord(record, scales) {
  const family = familyParams(record.familyPrimary);
  const targets = new Map();
  ["top", "middle", "base"].forEach((role) => {
    const all = record[role];
    const notes = all.slice(0, MAX_NOTES_PER_LAYER);
    notes.forEach((note) => {
      targets.set(note.key, computeNoteTarget(role, note, family, scales, record, all.length));
    });
  });
  return { family, targets };
}

// ======================================================
// 09 — TRANSICIÓN: entrada / actualización / salida por nota
// ======================================================

let transition = null;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function startTransition(record, scales) {
  const { family, targets } = buildTargetsForRecord(record, scales);

  const touched = new Set(targets.keys());
  noteCache.forEach((entry, key) => {
    if (entry.object.scale.x > 0.01) touched.add(key);
  });

  pruneNoteCache(touched);

  const tendrilColor = new THREE.Color(0xffffff).lerp(new THREE.Color(family.color), 0.3);

  touched.forEach((key) => {
    const target = targets.get(key);
    const entry = ensureNoteEntry(key, target ? target.role : (noteCache.get(key) || {}).role || "middle", target ? target.label : (noteCache.get(key) || {}).label || key);

    entry._fromPos = entry.object.position.clone();
    entry._fromScale = entry.object.scale.x;
    entry._fromColor = entry.colorMaterials[0].color.clone();
    entry._fromTendrilColor = entry.tendrilMat.color.clone();
    entry._fromOpacity = entry.tendrilMat.opacity;

    if (target) {
      entry.role = target.role;
      entry.label = target.label;
      entry._toPos = target.pos;
      entry._toScale = target.scale;
      entry._toColor = target.color;
    } else {
      entry._toPos = entry._fromPos.clone();
      entry._toScale = 0;
      entry._toColor = entry._fromColor.clone();
    }
    entry._toTendrilColor = tendrilColor;
    entry.spineAnchor.set(0, LAYER_DEFS[entry.role].yOffset, 0);
  });

  const targetMetal = clamp01(family.density);
  const targetRough = clamp01(1 - family.transmission);
  const targetClearcoat = clamp01(family.transmission);

  const fromZ = perfumeGroup.position.z;
  const toZ = record.year != null ? scales.yearScale(record.year) : 0;
  const fromScaleY = perfumeGroup.scale.y;
  const toScaleY = family.elongation;
  const fromMarkerX = timelineMarker.position.x;
  const toMarkerX = record.year != null ? (scales.yearScale(record.year) / 4.2) * 4.6 : 0;

  // encuadre automático: cada nota cae en una dirección-hash fija, así que
  // según el perfume el conjunto puede crecer hacia cualquier lado — en vez
  // de una cámara fija que recorta composiciones grandes, se ajusta la
  // distancia (preservando el ángulo de órbita actual del usuario) para
  // que la caja que envuelve al conjunto siempre quepa en cuadro
  // el conjunto vive en el espacio LOCAL de perfumeGroup, que además se
  // rota continuamente en Y y se traslada en Z (profundidad ↔ año) — el
  // radio horizontal debe medirse desde el eje de rotación (no como una
  // caja alineada a ejes, que subestima la barrida real al girar), y el
  // objetivo de cámara debe mirar al desplazamiento en Z del propio grupo,
  // no al centro local (que gira y por tanto no es un punto fijo en mundo)
  let minY = LAYER_DEFS.base.yOffset - 0.8;
  let maxY = LAYER_DEFS.top.yOffset + 0.8;
  let maxRadial = 0.35;
  targets.forEach((t) => {
    const r = t.scale * 2.6; // margen extra: la geometría por nota ahora varía más (formas más extremas)
    minY = Math.min(minY, t.pos.y - r);
    maxY = Math.max(maxY, t.pos.y + r);
    maxRadial = Math.max(maxRadial, Math.hypot(t.pos.x, t.pos.z) + r);
  });
  const centerYLocal = (minY + maxY) / 2;

  const vFovHalf = THREE.MathUtils.degToRad(camera.fov) / 2;
  const hFovHalf = Math.atan(Math.tan(vFovHalf) * camera.aspect);
  const halfHeight = Math.max(((maxY - minY) * toScaleY) / 2, 0.6);
  const halfWidth = Math.max(maxRadial, 0.6);
  const fitDist = THREE.MathUtils.clamp(
    Math.max(halfHeight / Math.tan(vFovHalf), halfWidth / Math.tan(hFovHalf)) * 1.25,
    controls.minDistance,
    controls.maxDistance
  );

  const camFrom = camera.position.clone();
  const targetFrom = controls.target.clone();
  const targetTo = new THREE.Vector3(0, centerYLocal * toScaleY, toZ);
  const offset = camFrom.clone().sub(targetFrom);
  const camDir = offset.lengthSq() > 1e-6 ? offset.normalize() : new THREE.Vector3(0.65, 0.35, 0.75).normalize();
  const camTo = targetTo.clone().addScaledVector(camDir, fitDist);

  transition = {
    start: performance.now(),
    duration: REDUCED_MOTION ? 1 : 900,
    entries: touched,
    spineFromColor: spineMat.color.clone(),
    spineToColor: new THREE.Color(family.color),
    spineFromMetal: spineMat.metalness,
    spineToMetal: targetMetal,
    spineFromRough: spineMat.roughness,
    spineToRough: targetRough,
    spineFromClearcoat: spineMat.clearcoat,
    spineToClearcoat: targetClearcoat,
    fromZ,
    toZ,
    fromScaleY,
    toScaleY,
    fromMarkerX,
    toMarkerX,
    camFrom,
    camTo,
    targetFrom,
    targetTo,
  };
}

function updateTransition() {
  if (!transition) return;
  const t = clamp01((performance.now() - transition.start) / transition.duration);
  const e = easeInOutCubic(t);

  transition.entries.forEach((key) => {
    const entry = noteCache.get(key);
    if (!entry) return;
    const pos = entry._fromPos.clone().lerp(entry._toPos, e);
    const scale = entry._fromScale + (entry._toScale - entry._fromScale) * e;
    const color = entry._fromColor.clone().lerp(entry._toColor, e);
    const tColor = entry._fromTendrilColor.clone().lerp(entry._toTendrilColor, e);
    const visible = scale > 0.006 && LAYER_VISIBLE[entry.role];

    entry.object.position.copy(pos);
    entry.object.scale.setScalar(Math.max(scale, 0.0001));
    entry.object.visible = visible;
    entry.colorMaterials.forEach((m) => m.color.copy(color));

    rebuildTendrilGeometry(entry.tendrilMesh, entry.spineAnchor, pos, hashString(key));
    entry.tendrilMat.color.copy(tColor);
    entry.tendrilMat.opacity = clamp01(scale) * 0.85;
    entry.tendrilMesh.visible = visible;
  });

  spineMat.color.copy(transition.spineFromColor).lerp(transition.spineToColor, e);
  spineMat.metalness = transition.spineFromMetal + (transition.spineToMetal - transition.spineFromMetal) * e;
  spineMat.roughness = transition.spineFromRough + (transition.spineToRough - transition.spineFromRough) * e;
  spineMat.clearcoat = transition.spineFromClearcoat + (transition.spineToClearcoat - transition.spineFromClearcoat) * e;

  perfumeGroup.position.z = transition.fromZ + (transition.toZ - transition.fromZ) * e;
  perfumeGroup.scale.y = transition.fromScaleY + (transition.toScaleY - transition.fromScaleY) * e;
  timelineMarker.position.x = transition.fromMarkerX + (transition.toMarkerX - transition.fromMarkerX) * e;

  camera.position.lerpVectors(transition.camFrom, transition.camTo, e);
  controls.target.lerpVectors(transition.targetFrom, transition.targetTo, e);

  if (t >= 1) transition = null;
}

// ======================================================
// 10 — RAYCASTING / TOOLTIP
// ======================================================

const raycaster = new THREE.Raycaster();
const mouseNdc = new THREE.Vector2();
const tooltip = document.getElementById("tooltip");
let hoverActive = false;

function onPointerMove(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouseNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouseNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouseNdc, camera);
  const targets = [];
  noteCache.forEach((entry) => {
    if (entry.object.visible) targets.push(entry.object);
  });
  const hits = raycaster.intersectObjects(targets, true);

  if (hits.length === 0) {
    hoverActive = false;
    tooltip.hidden = true;
    return;
  }

  let obj = hits[0].object;
  while (obj && !obj.userData.noteKey) obj = obj.parent;
  const entry = obj ? noteCache.get(obj.userData.noteKey) : null;
  if (!entry) {
    tooltip.hidden = true;
    hoverActive = false;
    return;
  }

  hoverActive = true;
  tooltip.hidden = false;
  tooltip.style.left = e.clientX + "px";
  tooltip.style.top = e.clientY + "px";

  const layerLabel = entry.role === "top" ? "SALIDA" : entry.role === "middle" ? "CORAZÓN" : "FONDO";
  tooltip.innerHTML = `<strong>${layerLabel} · ${entry.label}</strong>forma = categoría de la nota · color = identidad de la nota · sector = familia olfativa`;
}
renderer.domElement.addEventListener("pointermove", onPointerMove);
renderer.domElement.addEventListener("pointerleave", () => {
  tooltip.hidden = true;
  hoverActive = false;
});

// ======================================================
// 11 — ANIMACIÓN
// ======================================================

const clock = new THREE.Clock();

let mapOpen = false;    // pausa el render principal mientras el mapa cubre la pantalla
let posterOpen = false; // idem mientras la lámina cubre la pantalla

function animate() {
  requestAnimationFrame(animate);
  if (mapOpen || posterOpen) return;
  const dt = clock.getDelta();
  updateTransition();
  if (!hoverActive && !REDUCED_MOTION) perfumeGroup.rotation.y += dt * 0.06;
  controls.update();
  renderer.render(scene, camera);
}
animate();

// ======================================================
// 12 — ESTADO / UI
// ======================================================

const els = {
  loading: document.getElementById("loading"),
  legendToggle: document.getElementById("legend-toggle"),
  legendPanel: document.getElementById("legend-panel"),
  infoName: document.getElementById("info-name"),
  infoCat: document.getElementById("info-cat"),
  infoBrand: document.getElementById("info-brand"),
  infoYear: document.getElementById("info-year"),
  infoFamily: document.getElementById("info-family"),
  infoTop: document.getElementById("info-top"),
  infoMiddle: document.getElementById("info-middle"),
  infoBase: document.getElementById("info-base"),
  infoPrice: document.getElementById("info-price"),
  infoGender: document.getElementById("info-gender"),
  infoRate: document.getElementById("info-rate"),
  layerBtns: Array.from(document.querySelectorAll(".layer-btn")),
  searchInput: document.getElementById("search-input"),
  familyFilter: document.getElementById("family-filter"),
  yearMin: document.getElementById("year-min"),
  yearMax: document.getElementById("year-max"),
  resultsList: document.getElementById("results-list"),
  resultsCount: document.getElementById("results-count"),
  relatedList: document.getElementById("related-list"),
  mapToggle: document.getElementById("map-toggle"),
  mapPanel: document.getElementById("map-panel"),
  mapClose: document.getElementById("map-close"),
  mapBack: document.getElementById("map-back"),
  mapRoot: document.getElementById("map-root"),
  mapFocusName: document.getElementById("map-focus-name"),
  mapStatus: document.getElementById("map-status"),
  mapInfoCard: document.getElementById("map-info-card"),
  mapInfoName: document.getElementById("map-info-name"),
  mapInfoMeta: document.getElementById("map-info-meta"),
  mapInfoShared: document.getElementById("map-info-shared"),
  mapViewComposition: document.getElementById("map-view-composition"),
  mapLegendToggle: document.getElementById("map-legend-toggle"),
  mapLegendPanel: document.getElementById("map-legend-panel"),
  posterToggle: document.getElementById("poster-toggle"),
  posterPanel: document.getElementById("poster-panel"),
  posterClose: document.getElementById("poster-close"),
  posterStage: document.getElementById("poster-stage"),
  posterFocus: document.getElementById("poster-focus"),
  exportToggle: document.getElementById("export-toggle"),
  exportList: document.getElementById("export-list"),
};

let RECORDS = [];
let SCALES = null;
let current = null;

function selectPerfume(record, opts = {}) {
  if (!record) return;
  current = record;
  startTransition(record, SCALES);
  renderInfoPanel(record);
  renderRelated(record);
  highlightSelected(record.id);
  if (!opts.silent) els.searchInput.value = "";
  renderResults();
}

const priceFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function renderInfoPanel(r) {
  els.infoName.textContent = r.name;
  // nº de catálogo: 4 hex estables derivados del id — un asa corta por perfume
  if (els.infoCat) els.infoCat.textContent = "Nº " + (hashString(r.id).toString(16).slice(-4).toUpperCase());
  els.infoBrand.textContent = r.brand;
  els.infoYear.textContent = r.year != null ? r.year : "—";
  els.infoFamily.textContent = r.familyLabel;
  els.infoTop.textContent = r.top.length ? r.top.map((n) => n.label).join(", ") : "—";
  els.infoMiddle.textContent = r.middle.length ? r.middle.map((n) => n.label).join(", ") : "—";
  els.infoBase.textContent = r.base.length ? r.base.map((n) => n.label).join(", ") : "—";

  // campos del dataset que antes se descartaban — son los más completos y
  // comparables (price está en el 100% de las filas)
  if (els.infoPrice) els.infoPrice.textContent = r.price != null ? priceFmt.format(r.price) : "—";
  if (els.infoGender) {
    const g = { Women: "mujer", Men: "hombre", Unisex: "unisex" }[r.gender] || (r.gender || "—");
    els.infoGender.textContent = r.concentration ? `${g} · ${r.concentration}` : g;
  }

  els.infoRate.textContent =
    r.rate != null
      ? `rate ${r.rate.toFixed(2)} · ${r.ratingCount ?? 0} ratings`
      : "sin calificación registrada";
}

function relatedScore(a, b) {
  let score = 0;
  const sharedFam = a.family.filter((f) => f !== "unknown" && b.family.includes(f)).length;
  score += sharedFam * 3;
  if (a.brand === b.brand && a.brand !== "—") score += 2;
  if (a.year != null && b.year != null) score += Math.max(0, 1 - Math.abs(a.year - b.year) / 15);
  // parentesco olfativo real: notas en común (si el índice ya está listo)
  if (a.noteKeySet && b.noteKeySet) {
    let shared = 0;
    const [small, big] = a.noteKeySet.size <= b.noteKeySet.size ? [a.noteKeySet, b.noteKeySet] : [b.noteKeySet, a.noteKeySet];
    small.forEach((k) => { if (big.has(k)) shared++; });
    score += Math.min(shared, 6) * 0.8;
  }
  return score;
}

function renderRelated(r) {
  const candidates = RECORDS.filter((x) => x.id !== r.id)
    .map((x) => ({ rec: x, score: relatedScore(r, x) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  els.relatedList.innerHTML = "";
  candidates.forEach(({ rec }) => {
    const li = document.createElement("li");
    li.setAttribute("role", "button");
    li.tabIndex = 0;
    li.innerHTML = `<span class="rel-name">${rec.name}</span><span class="rel-meta">${rec.brand} · ${rec.year ?? "s/f"}</span>`;
    const pick = () => selectPerfume(rec);
    li.addEventListener("click", pick);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
    });
    els.relatedList.appendChild(li);
  });
}

function highlightSelected(id) {
  Array.from(els.resultsList.children).forEach((li) => {
    li.classList.toggle("selected", li.dataset.id === id);
  });
}

const DIACRITICS_RE = new RegExp("[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]", "g");
function normalizeText(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS_RE, "");
}

function filteredRecords() {
  const q = normalizeText(els.searchInput.value.trim());
  const fam = els.familyFilter.value;
  const yMin = els.yearMin.value ? parseInt(els.yearMin.value, 10) : null;
  const yMax = els.yearMax.value ? parseInt(els.yearMax.value, 10) : null;

  return RECORDS.filter((r) => {
    if (q && !normalizeText(r.name).includes(q) && !normalizeText(r.brand).includes(q)) return false;
    if (fam && !r.family.includes(fam)) return false;
    if (yMin != null && (r.year == null || r.year < yMin)) return false;
    if (yMax != null && (r.year == null || r.year > yMax)) return false;
    return true;
  });
}

const RESULTS_CAP = 60;

function renderResults() {
  const all = filteredRecords();
  const list = all.slice(0, RESULTS_CAP);
  els.resultsList.innerHTML = "";

  if (els.resultsCount) {
    els.resultsCount.textContent = all.length === 0
      ? "sin resultados"
      : all.length > RESULTS_CAP
        ? `${all.length} perfumes · se muestran ${RESULTS_CAP}`
        : `${all.length} ${all.length === 1 ? "perfume" : "perfumes"}`;
  }

  if (list.length === 0) {
    const li = document.createElement("li");
    li.className = "results-empty";
    li.textContent = "Nada calza con esa búsqueda. Prueba con otra marca, familia o rango de año.";
    els.resultsList.appendChild(li);
    return;
  }

  list.forEach((r) => {
    const li = document.createElement("li");
    li.dataset.id = r.id;
    // ítem accionable por teclado: rol de botón + foco + Enter/Espacio
    li.setAttribute("role", "button");
    li.tabIndex = 0;
    if (current && current.id === r.id) {
      li.classList.add("selected");
      li.setAttribute("aria-current", "true");
    }
    li.innerHTML = `<span class="result-name">${r.name}</span><span class="result-meta">${r.brand} · ${r.year ?? "s/f"} · ${r.familyLabel}</span>`;
    const pick = () => selectPerfume(r);
    li.addEventListener("click", pick);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pick();
      }
    });
    els.resultsList.appendChild(li);
  });
}

function populateFamilyFilter() {
  // se cuenta cada familia que aparece (no solo la primaria) y se descarta el
  // centinela "unknown" — un perfume sin familia no es una categoría navegable
  const counts = new Map();
  RECORDS.forEach((r) => {
    r.family.forEach((fam) => {
      if (fam === "unknown") return;
      counts.set(fam, (counts.get(fam) || 0) + 1);
    });
  });
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  sorted.forEach(([fam, count]) => {
    const opt = document.createElement("option");
    opt.value = fam;
    opt.textContent = `${fam} (${count})`;
    els.familyFilter.appendChild(opt);
  });
}

function wireLayerToggles() {
  els.layerBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const role = btn.dataset.layer;
      LAYER_VISIBLE[role] = !LAYER_VISIBLE[role];
      btn.classList.toggle("active", LAYER_VISIBLE[role]);
      btn.setAttribute("aria-pressed", String(LAYER_VISIBLE[role]));
      noteCache.forEach((entry) => {
        if (entry.role !== role) return;
        const visible = entry.object.scale.x > 0.006 && LAYER_VISIBLE[role];
        entry.object.visible = visible;
        entry.tendrilMesh.visible = visible;
      });
    });
  });
}

function wireLegend() {
  els.legendToggle.addEventListener("click", () => {
    const expanded = els.legendToggle.getAttribute("aria-expanded") === "true";
    els.legendToggle.setAttribute("aria-expanded", String(!expanded));
    els.legendPanel.hidden = expanded;
  });
}

function wireExplore() {
  els.searchInput.addEventListener("input", renderResults);
  els.familyFilter.addEventListener("change", renderResults);
  els.yearMin.addEventListener("change", renderResults);
  els.yearMax.addEventListener("change", renderResults);
}

// ======================================================
// 13 — INIT
// ======================================================

async function init() {
  try {
    RECORDS = await loadPerfumes();
  } catch (err) {
    els.loading.querySelector(".loading-sub").textContent =
      "no se pudo cargar perfume_visualization.json — revisa que el archivo esté junto a index.html";
    console.error(err);
    return;
  }

  SCALES = buildScales(RECORDS);
  buildNoteIndex(RECORDS);

  els.yearMin.placeholder = String(SCALES.yearDomainFull[0]);
  els.yearMax.placeholder = String(SCALES.yearDomainFull[1]);

  populateFamilyFilter();
  wireLayerToggles();
  wireLegend();
  wireExplore();
  wireMapUI();
  wirePosterUI();
  renderResults();

  const rated = RECORDS.filter((r) => r.rate != null && r.ratingCount != null && r.top.length + r.middle.length + r.base.length > 0);
  rated.sort((a, b) => b.ratingCount - a.ratingCount);
  const hero = rated[0] || RECORDS.find((r) => r.top.length + r.middle.length + r.base.length > 0) || RECORDS[0];

  selectPerfume(hero, { silent: true });
  // salta directo al estado final en la primera carga (sin animar desde cero)
  transition.start = performance.now() - transition.duration - 1;
  updateTransition();

  els.loading.classList.add("hidden");
  setTimeout(() => (els.loading.hidden = true), 600);
}

init();

// ======================================================
// 14 — MAPA DE NOTAS: red 3D expandible de perfumes
// vinculados por notas olfativas compartidas. Vive en su propia escena
// three.js (canvas separado), independiente de la composición principal.
// ======================================================

// ---- 14.1 índice invertido nota → perfumes, para encontrar candidatos ----

let NOTE_INDEX = new Map();
let RECORD_BY_ID = new Map();

function buildNoteIndex(records) {
  RECORD_BY_ID = new Map(records.map((r) => [r.id, r]));
  NOTE_INDEX = new Map();
  records.forEach((r) => {
    r.noteKeySet = new Set([...r.top, ...r.middle, ...r.base].map((n) => n.key));
    r.noteKeySet.forEach((key) => {
      if (!NOTE_INDEX.has(key)) NOTE_INDEX.set(key, new Set());
      NOTE_INDEX.get(key).add(r.id);
    });
  });
}

function sharedNoteKeys(a, b) {
  const [small, big] = a.noteKeySet.size <= b.noteKeySet.size ? [a.noteKeySet, b.noteKeySet] : [b.noteKeySet, a.noteKeySet];
  const keys = [];
  small.forEach((k) => {
    if (big.has(k)) keys.push(k);
  });
  return keys;
}

// notas en común expresadas con su forma legible original (para UI)
function sharedNoteLabels(a, b) {
  const keys = sharedNoteKeys(a, b);
  const byKey = new Map();
  [...a.top, ...a.middle, ...a.base].forEach((n) => byKey.set(n.key, n.label));
  return keys.map((k) => byKey.get(k) || k);
}

// AFINIDAD DE COMPOSICIÓN (no simple cruce de conjuntos): una nota compartida
// pesa según en qué tan alineadas están sus capas en ambos perfumes — dos
// "vainilla" en fondo·fondo hablan de una estructura de base común; una en
// fondo de uno y salida del otro es una coincidencia estructuralmente débil.
const LAYER_INDEX = { top: 0, middle: 1, base: 2 };
const LAYER_MATCH_WEIGHT = [1, 0.5, 0.25]; // distancia de capa: misma · adyacente · opuesta

function rolesByNote(rec) {
  const m = new Map();
  ["top", "middle", "base"].forEach((role) => {
    rec[role].forEach((n) => {
      if (!m.has(n.key)) m.set(n.key, new Set());
      m.get(n.key).add(role);
    });
  });
  return m;
}

function layeredSimilarity(a, b) {
  const ra = rolesByNote(a), rb = rolesByNote(b);
  let score = 0;
  ra.forEach((rolesA, key) => {
    const rolesB = rb.get(key);
    if (!rolesB) return;
    let bestDist = 2;
    rolesA.forEach((x) => rolesB.forEach((y) => {
      const d = Math.abs(LAYER_INDEX[x] - LAYER_INDEX[y]);
      if (d < bestDist) bestDist = d;
    }));
    score += LAYER_MATCH_WEIGHT[bestDist];
  });
  return score;
}

const MAP_MIN_SHARED = 2;           // piso: hay que compartir ≥2 notas reales para aparecer
const MAP_RELATED_COUNT = 12;       // foco + hasta N relacionados por ego-network
const MAP_R_INNER = 3.6;            // radio del anillo más cercano (mayor afinidad de composición)
const MAP_R_OUTER = 7.2;            // radio del anillo más lejano

// candidatos que comparten ≥ MAP_MIN_SHARED notas reales con `record`,
// ordenados por AFINIDAD DE COMPOSICIÓN (layeredSimilarity) descendente
function findLinkedCandidates(record, excludeIds, limit) {
  const candidateIds = new Set();
  record.noteKeySet.forEach((key) => {
    const set = NOTE_INDEX.get(key);
    if (set) set.forEach((id) => candidateIds.add(id));
  });
  const scored = [];
  candidateIds.forEach((id) => {
    if (id === record.id || excludeIds.has(id)) return;
    const other = RECORD_BY_ID.get(id);
    const keys = sharedNoteKeys(record, other);
    if (keys.length >= MAP_MIN_SHARED) {
      scored.push({ id, weight: keys.length, lsim: layeredSimilarity(record, other) });
    }
  });
  scored.sort((a, b) => b.lsim - a.lsim || b.weight - a.weight);
  return scored.slice(0, limit);
}

// ---- 14.2 escena three.js propia (se crea una sola vez, se reutiliza) ----

let mapInitialized = false;
let mapScene, mapCamera, mapRenderer, mapControls, mapClock;
let mapEdgeGeometry, mapEdgeMaterial, mapEdgeLines, mapGuideGroup;
let mapAnimId = null;
let mapHandleResize = () => {};

function ensureMapScene() {
  if (mapInitialized) return;
  mapInitialized = true;

  mapScene = new THREE.Scene();
  mapScene.background = new THREE.Color(0x060606);
  mapScene.environment = scene.environment; // mismo entorno PMREM que la escena principal

  // cámara frontal fija: el mapa se lee como un diagrama radial 2D (el foco
  // al centro, los relacionados alrededor). Los nodos siguen siendo objetos
  // 3D, pero sin órbita libre que rompa la lectura del anillo.
  mapCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  mapCamera.position.set(0, 0, 18);

  mapRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  mapRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  mapRenderer.outputColorSpace = THREE.SRGBColorSpace;
  mapRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  mapRenderer.toneMappingExposure = 1.1;
  els.mapRoot.appendChild(mapRenderer.domElement);

  mapControls = new OrbitControls(mapCamera, mapRenderer.domElement);
  mapControls.enableDamping = true;
  mapControls.dampingFactor = 0.1;
  mapControls.enableRotate = false; // sin tumbling: es un plano
  mapControls.screenSpacePanning = true;
  mapControls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  mapControls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
  mapControls.minDistance = 6;
  mapControls.maxDistance = 46;

  // luz frontal: las mini-composiciones se ven de frente
  mapScene.add(new THREE.AmbientLight(0x556070, 1.7));
  const mapKey = new THREE.DirectionalLight(0xffffff, 2.1);
  mapKey.position.set(3, 5, 10);
  mapScene.add(mapKey);
  const mapRim = new THREE.DirectionalLight(0x6f8dff, 1.1);
  mapRim.position.set(-6, -2, 4);
  mapScene.add(mapRim);

  // anillos guía: la distancia al centro codifica cercanía olfativa
  mapGuideGroup = new THREE.Group();
  mapScene.add(mapGuideGroup);
  [MAP_R_INNER, (MAP_R_INNER + MAP_R_OUTER) / 2, MAP_R_OUTER].forEach((r) => {
    const pts = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, -0.6));
    }
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x2b2b2b, transparent: true, opacity: 0.55 })
    );
    mapGuideGroup.add(ring);
  });

  mapEdgeGeometry = new THREE.BufferGeometry();
  mapEdgeMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 });
  mapEdgeLines = new THREE.LineSegments(mapEdgeGeometry, mapEdgeMaterial);
  mapScene.add(mapEdgeLines);

  mapClock = new THREE.Clock();

  mapHandleResize = () => {
    const w = els.mapRoot.clientWidth || els.mapRoot.getBoundingClientRect().width || 1;
    const h = els.mapRoot.clientHeight || els.mapRoot.getBoundingClientRect().height || 1;
    if (w < 2 || h < 2) return;
    if (Math.abs(mapCamera.aspect - w / h) < 1e-4 && mapRenderer.domElement.clientWidth === Math.round(w)) return;
    mapCamera.aspect = w / h;
    mapCamera.updateProjectionMatrix();
    mapRenderer.setSize(w, h);
    if (mapNodes.size) fitMapCamera(); // reencuadrar con el aspect corregido
  };
  window.addEventListener("resize", mapHandleResize);
  new ResizeObserver(mapHandleResize).observe(els.mapRoot);
  mapHandleResize();

  els.mapRoot.addEventListener("pointermove", onMapPointerMove);
  els.mapRoot.addEventListener("pointerleave", () => {
    tooltip.hidden = true;
    setMapHover(null);
  });
  els.mapRoot.addEventListener("click", onMapClick);
  els.mapRoot.addEventListener("dblclick", onMapDblClick);
}

// ---- 14.2b nodo del mapa = la propia composición 3D del perfume, en
// miniatura — reutiliza los mismos arquetipos de nota (blob/cromo/fuzz/
// concreto/vidrio) que la vista principal, así que comparte su lenguaje
// gráfico y textural; sin columna ni tendones (a esta escala no se leen).

const MAP_NODE_NOTE_CAP = 12; // misma lógica que la vista principal (arquetipo/prioridad/columna), tope intermedio para que el mapa siga siendo legible con decenas de nodos
const MAP_NOTES_PER_LAYER = 4;
const MAP_MINI_LAYER_Y = { top: 0.24, middle: 0, base: -0.24 };
const MAP_MINI_RADIUS = 0.85; // margen extra: más notas + columna propia por nodo
const MAP_FOCUS_SCALE = 1.9;

function disposeObject3D(root) {
  root.traverse((obj) => {
    // los Sprite comparten una única BufferGeometry a nivel de módulo en
    // three.js — disponerla aquí rompería el aura de todos los demás nodos
    if (obj.geometry && !obj.isSprite) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose();
    }
  });
}

// noteIdentityColor vive ahora en la sección 02 (utilidades) y lo comparten
// esta vista y la principal.

// textura de brillo radial compartida por todos los halos de familia —
// se construye una sola vez y se reutiliza (sólo cambia el tinte)
let MAP_GLOW_TEXTURE = null;
function getMapGlowTexture() {
  if (MAP_GLOW_TEXTURE) return MAP_GLOW_TEXTURE;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.26)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  MAP_GLOW_TEXTURE = new THREE.CanvasTexture(canvas);
  return MAP_GLOW_TEXTURE;
}

// hasta MAP_NOTES_PER_LAYER notas por capa, capadas a MAP_NODE_NOTE_CAP en
// total — tope intermedio entre las 6 de antes y las ~27 de la vista
// principal, para que el mapa siga siendo legible con decenas de nodos.
// se priorizan las notas que comparte con el foco actual, para que lo que
// conecta a dos perfumes sea justamente lo que se alcanza a ver
function pickMiniNotes(record) {
  const focusNode = mapFocusId != null ? mapNodes.get(mapFocusId) : null;
  const focusKeys = focusNode ? focusNode.record.noteKeySet : null;

  const picks = [];
  ["top", "middle", "base"].forEach((role) => {
    const notes = record[role].slice();
    if (focusKeys) notes.sort((a, b) => Number(focusKeys.has(b.key)) - Number(focusKeys.has(a.key)));
    notes.slice(0, MAP_NOTES_PER_LAYER).forEach((note) => picks.push({ role, note }));
  });
  return picks.slice(0, MAP_NODE_NOTE_CAP);
}

// tendón local (estático — a diferencia del de la vista principal, un nodo
// del mapa nunca cambia de perfume, así que no necesita reconstruirse)
function buildMiniTendril(fromV, toV, seed) {
  const rand = mulberry32(seed ^ 0x77);
  const mid = fromV
    .clone()
    .lerp(toV, 0.5)
    .add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.08));
  const curve = new THREE.QuadraticBezierCurve3(fromV, mid, toV);
  const geo = new THREE.TubeGeometry(curve, 8, 0.006, 5, false);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transmission: 0.85,
    roughness: 0.25,
    thickness: 0.15,
    ior: 1.3,
    transparent: true,
    opacity: 0.55,
    envMapIntensity: 1,
  });
  return new THREE.Mesh(geo, mat);
}

// nodo del mapa = núcleo (color de familia) + halo de familia (aura) +
// hasta 6 elementos-nota (color por identidad de nota, no por familia).
// devuelve también la lista de materiales-color para poder atenuarlos al
// resaltar vecinos, cada uno con su color base guardado para poder volver.
function buildMiniComposition(record) {
  const family = familyParams(record.familyPrimary);
  const group = new THREE.Group();
  const colorMaterials = [];
  const noteElements = [];

  const coreMat = new THREE.MeshPhysicalMaterial({
    color: family.color,
    roughness: 0.3,
    metalness: 0.1,
    clearcoat: 0.5,
    clearcoatRoughness: 0.25,
    emissive: family.color,
    emissiveIntensity: 0.4,
    envMapIntensity: 1,
  });
  group.add(new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), coreMat));
  colorMaterials.push({ material: coreMat, baseColor: coreMat.color.clone() });

  const auraMat = new THREE.SpriteMaterial({
    map: getMapGlowTexture(),
    color: family.color,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const aura = new THREE.Sprite(auraMat);
  aura.scale.setScalar(1.9);
  aura.renderOrder = -1;
  group.add(aura);
  colorMaterials.push({ material: auraMat, baseColor: auraMat.color.clone() });

  // columna central propia del nodo — misma lógica que la vista principal:
  // metalness/roughness/clearcoat por densidad/transmisión de la familia
  const spineHeight = MAP_MINI_LAYER_Y.top - MAP_MINI_LAYER_Y.base + 0.16;
  const spineMat = new THREE.MeshPhysicalMaterial({
    color: family.color,
    roughness: clamp01(1 - family.transmission),
    metalness: clamp01(family.density),
    clearcoat: clamp01(family.transmission),
    envMapIntensity: 1,
  });
  const spineMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, spineHeight, 10, 3, false), spineMat);
  spineMesh.position.y = (MAP_MINI_LAYER_Y.top + MAP_MINI_LAYER_Y.base) / 2;
  group.add(spineMesh);
  colorMaterials.push({ material: spineMat, baseColor: spineMat.color.clone() });

  pickMiniNotes(record).forEach(({ role, note }) => {
    const seed = hashString(note.key);
    const archetype = archetypeForNote(note.key);
    const built = NOTE_BUILDERS[archetype](seed, noteIdentityColor(note.key));

    // cromo y vidrio dependen casi por completo del reflejo/transmisión del
    // entorno para mostrar su color — a la escala minúscula de esta
    // miniatura eso los deja prácticamente negros; se les da un piso
    // emisivo para que su color de identidad siempre se lea
    if (archetype === "chrome" || archetype === "glass") {
      built.colorMaterials.forEach((m) => {
        m.emissive = m.color.clone();
        m.emissiveIntensity = 0.4;
      });
    }

    const rand = mulberry32(seed ^ 0x6f);
    const dir = noteDirection(note.key);

    const baseScale = 0.1 + rand() * 0.045;
    built.object.scale.setScalar(baseScale);
    built.object.position.copy(dir).multiplyScalar(0.42);
    built.object.position.y += MAP_MINI_LAYER_Y[role];
    built.object.rotation.copy(randomOrientation(seed));
    group.add(built.object);

    const spineAnchor = new THREE.Vector3(0, MAP_MINI_LAYER_Y[role], 0);
    const tendril = buildMiniTendril(spineAnchor, built.object.position, seed);
    group.add(tendril);
    colorMaterials.push({ material: tendril.material, baseColor: tendril.material.color.clone() });

    built.colorMaterials.forEach((m) => colorMaterials.push({ material: m, baseColor: m.color.clone() }));

    // se guarda para poder resaltar/atenuar esta nota puntual según
    // comparta o no con el foco actual (independiente del atenuado de
    // todo el nodo por hover)
    noteElements.push({ key: note.key, object: built.object, baseScale, tendril, shared: 1 });
  });

  return { object: group, colorMaterials, noteElements };
}

// ---- 14.3 ego-network radial: foco al centro, relacionados en un anillo ----
//
// distancia al centro  = cercanía olfativa (más notas en común → más cerca)
// sector angular       = agrupa por la "nota puente" (la nota compartida más
//                        distintiva) — así los perfumes que se parecen al foco
//                        *por la misma razón* quedan juntos y rotulados
// cada rayo foco→nodo  = grosor/brillo según cuántas notas comparten
//
// no hay simulación de fuerzas: las posiciones se calculan una vez y los
// nodos hacen una transición suave hacia ellas.

const mapNodes = new Map(); // id -> node
let mapEdges = []; // rayos foco→relacionado: { a, b, weight }
let mapFocusId = null;
let mapSelectedId = null;
let mapHoverId = null;
let mapHoverNeighbors = new Set();
let mapTrail = []; // pila de focos visitados, para "volver"

function noteRarity(key) {
  const s = NOTE_INDEX.get(key);
  return s ? s.size : 1; // menos perfumes con esa nota = más distintiva
}

// nº de notas en común entre dos perfumes cualesquiera (no con el foco)
function pairOverlap(a, b) {
  const [small, big] = a.noteKeySet.size <= b.noteKeySet.size ? [a.noteKeySet, b.noteKeySet] : [b.noteKeySet, a.noteKeySet];
  let c = 0;
  small.forEach((k) => { if (big.has(k)) c++; });
  return c;
}

// ordena la lista de relacionados en una cadena donde cada vecino se parece
// lo más posible al anterior — así el anillo se lee como un gradiente
function seriateBySimilarity(items) {
  if (items.length <= 2) return items;
  const recs = items.map((it) => it.rec);
  const N = items.length;
  let best = [0, 1], bestV = -1;
  for (let i = 0; i < N; i++)
    for (let j = i + 1; j < N; j++) {
      const v = pairOverlap(recs[i], recs[j]);
      if (v > bestV) { bestV = v; best = [i, j]; }
    }
  const used = new Set(best);
  const chain = [best[0], best[1]];
  while (chain.length < N) {
    let pick = -1, pickV = -1, atEnd = true;
    for (let k = 0; k < N; k++) {
      if (used.has(k)) continue;
      const vEnd = pairOverlap(recs[chain[chain.length - 1]], recs[k]);
      const vStart = pairOverlap(recs[chain[0]], recs[k]);
      if (vEnd >= pickV) { pickV = vEnd; pick = k; atEnd = true; }
      if (vStart > pickV) { pickV = vStart; pick = k; atEnd = false; }
    }
    used.add(pick);
    if (atEnd) chain.push(pick); else chain.unshift(pick);
  }
  return chain.map((idx) => items[idx]);
}

function labelForNoteKey(key, related) {
  for (const r of related) {
    for (const n of [...r.rec.top, ...r.rec.middle, ...r.rec.base]) {
      if (n.key === key) return n.label;
    }
  }
  const f = mapFocusId && mapNodes.get(mapFocusId);
  if (f) for (const n of [...f.record.top, ...f.record.middle, ...f.record.base]) if (n.key === key) return n.label;
  return key;
}

function setMapHover(id) {
  if (id === mapHoverId) return;
  mapHoverId = id;
  mapHoverNeighbors = new Set();
  if (id == null) return;
  if (id === mapFocusId) {
    mapNodes.forEach((_, k) => { if (k !== id) mapHoverNeighbors.add(k); });
  } else {
    mapHoverNeighbors.add(mapFocusId);
  }
}

function clearMapNodes() {
  mapNodes.forEach((node) => {
    mapScene.remove(node.mesh);
    disposeObject3D(node.mesh);
  });
  mapNodes.clear();
  mapEdges = [];
  mapSelectedId = null;
  mapHoverId = null;
  mapHoverNeighbors = new Set();
  mapLabelPool.forEach((el) => (el.style.display = "none"));
  mapRimPool.forEach((el) => (el.style.display = "none"));
}

function addMapNode(record, targetX, targetY, grow) {
  if (mapNodes.has(record.id)) return mapNodes.get(record.id);
  const built = buildMiniComposition(record);
  const mesh = built.object;
  const layoutTarget = new THREE.Vector3(targetX, targetY, 0);
  // aparecen desde una posición más cerca del centro y crecen desde cero
  mesh.position.copy(layoutTarget).multiplyScalar(grow ? 0.12 : 1);
  mesh.scale.setScalar(grow ? 0.0001 : 1);
  mesh.userData.perfumeId = record.id;
  mapScene.add(mesh);

  const node = {
    id: record.id,
    record,
    mesh,
    colorMaterials: built.colorMaterials,
    noteElements: built.noteElements,
    layoutTarget,
    pos: mesh.position.clone(),
    baseRadius: MAP_MINI_RADIUS,
    targetScale: 1,
    shared: [],
    sim: 0,
    dim: 0,
    dimTarget: 0,
    wasDimmed: false,
  };
  mapNodes.set(record.id, node);
  return node;
}

// construye la ego-network alrededor de `focusRecord`
function buildEgoNetwork(focusRecord, grow) {
  clearMapNodes();

  const focus = addMapNode(focusRecord, 0, 0, grow);
  mapFocusId = focus.id;
  focus.targetScale = MAP_FOCUS_SCALE;
  focus.shared = null;
  focus.noteElements.forEach((el) => (el.sharedTarget = 1));

  const cands = findLinkedCandidates(focusRecord, new Set([focusRecord.id]), MAP_RELATED_COUNT);
  let related = cands.map((c) => {
    const rec = RECORD_BY_ID.get(c.id);
    const sharedKeys = sharedNoteKeys(focusRecord, rec);
    const denom = Math.max(1, Math.min(focusRecord.noteKeySet.size, rec.noteKeySet.size));
    // radio/tamaño del nodo ← AFINIDAD DE COMPOSICIÓN (capas alineadas), no el
    // conteo crudo. grosor del rayo ← nº de notas en común (dato concreto).
    // que difieran es informativo: rayo grueso lejos = comparten muchas notas
    // pero mal alineadas; rayo fino cerca = pocas notas, muy alineadas.
    const sim = clamp01(c.lsim / denom);
    const bridge = sharedKeys.slice().sort((a, b) => noteRarity(a) - noteRarity(b))[0];
    return { rec, weight: c.weight, lsim: c.lsim, sharedKeys, sharedSet: new Set(sharedKeys), sim, bridge };
  });

  // orden alrededor del anillo: se agrupa por NOTA PUENTE (grupos grandes
  // primero) y dentro de cada grupo se seria por similitud entre sí, para que
  // el anillo se lea como sectores rotulados y contiguos ("los de oud", "los
  // cítricos") en vez de una lista arbitraria.
  const byBridge = new Map();
  related.forEach((r) => {
    if (!byBridge.has(r.bridge)) byBridge.set(r.bridge, []);
    byBridge.get(r.bridge).push(r);
  });
  const bucketList = [...byBridge.entries()].sort(
    (a, b) => b[1].length - a[1].length || noteRarity(a[0]) - noteRarity(b[0])
  );

  const ordered = [];
  const runs = []; // tramos que merecen rótulo de borde (≥2 perfumes)
  bucketList.forEach(([bridge, items]) => {
    const seq = seriateBySimilarity(items);
    if (seq.length >= 2) runs.push({ bridge, start: ordered.length, len: seq.length });
    seq.forEach((x) => ordered.push(x));
  });
  related = ordered;

  const n = Math.max(1, related.length);
  const step = (Math.PI * 2) / n;
  const angle0 = -Math.PI / 2;

  related.forEach((it, i) => {
    const a = angle0 + i * step;
    const radius = MAP_R_INNER + (1 - it.sim) * (MAP_R_OUTER - MAP_R_INNER);
    const node = addMapNode(it.rec, Math.cos(a) * radius, Math.sin(a) * radius, grow);
    node.shared = it.sharedKeys;
    node.sim = it.sim;
    node.bridge = it.bridge;
    node.ringIndex = i;
    node.targetScale = 0.78 + 0.9 * it.sim;
    node.noteElements.forEach((el) => (el.sharedTarget = focusRecord.noteKeySet.has(el.key) ? 1 : 0));
  });

  const rimData = runs.map((run) => {
    const midA = angle0 + (run.start + (run.len - 1) / 2) * step;
    return {
      text: labelForNoteKey(run.bridge, related),
      x: Math.cos(midA) * (MAP_R_OUTER + 1.2),
      y: Math.sin(midA) * (MAP_R_OUTER + 1.2),
    };
  });

  rebuildSpokes();
  buildRimLabels(rimData);
  els.mapFocusName.textContent = `${focusRecord.name} — ${focusRecord.brand}`;
  updateMapBackBtn();
  fitMapCamera();
  updateMapStatus();
}

function rebuildSpokes() {
  mapEdges = [];
  mapNodes.forEach((node) => {
    if (node.id === mapFocusId) return;
    mapEdges.push({ a: mapFocusId, b: node.id, weight: (node.shared || []).length });
  });
  const posArr = new Float32Array(mapEdges.length * 2 * 3);
  const colArr = new Float32Array(mapEdges.length * 2 * 3);
  mapEdgeGeometry.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
  mapEdgeGeometry.setAttribute("color", new THREE.BufferAttribute(colArr, 3));
}

// encuadre frontal: todo el anillo + los rótulos del borde entran en cuadro
function fitMapCamera() {
  let maxR = MAP_R_OUTER + 2.6;
  mapNodes.forEach((node) => {
    const r = Math.hypot(node.layoutTarget.x, node.layoutTarget.y) + node.targetScale * MAP_MINI_RADIUS * 1.5;
    maxR = Math.max(maxR, r);
  });
  const vHalf = THREE.MathUtils.degToRad(mapCamera.fov) / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * mapCamera.aspect);
  const dist = THREE.MathUtils.clamp(maxR / Math.min(Math.tan(vHalf), Math.tan(hHalf)) * 1.08, mapControls.minDistance, mapControls.maxDistance);
  mapControls.target.set(0, 0, 0);
  mapCamera.position.set(0, 0, dist);
  mapCamera.updateProjectionMatrix();
}

function refocusMap(id) {
  const node = mapNodes.get(id);
  if (!node || id === mapFocusId) return;
  mapTrail.push(mapFocusId);
  buildEgoNetwork(node.record, true);
  showMapInfoCard(mapNodes.get(id));
}

function mapBack() {
  if (!mapTrail.length) return;
  const prev = mapTrail.pop();
  const rec = RECORD_BY_ID.get(prev);
  if (rec) buildEgoNetwork(rec, true);
  els.mapInfoCard.hidden = true;
}

function updateMapBackBtn() {
  if (els.mapBack) els.mapBack.hidden = mapTrail.length === 0;
}

function resetMapTo(record) {
  mapTrail = [];
  buildEgoNetwork(record, false);
  els.mapInfoCard.hidden = true;
}

function updateMapStatus() {
  const rel = Math.max(0, mapNodes.size - 1);
  els.mapStatus.textContent = `${rel} ${rel === 1 ? "perfume" : "perfumes"} · por afinidad de composición (≥${MAP_MIN_SHARED} notas)`;
}

// ---- 14.4 animación: los nodos van hacia su posición del layout radial ----

function stepMap(dt) {
  const ease = REDUCED_MOTION ? 1 : Math.min(1, dt * 5);
  const scaleEase = REDUCED_MOTION ? 1 : Math.min(1, dt * 4.5);
  const noteEase = REDUCED_MOTION ? 1 : Math.min(1, dt * 4);

  mapNodes.forEach((node) => {
    node.pos.lerp(node.layoutTarget, ease);
    node.mesh.position.copy(node.pos);

    const s = node.mesh.scale.x + (node.targetScale - node.mesh.scale.x) * scaleEase;
    node.mesh.scale.setScalar(Math.max(s, 0.0001));

    // hover: atenúa todo lo que no sea el nodo bajo el cursor ni su conexión
    node.dimTarget = mapHoverId == null ? 0 : node.id === mapHoverId || mapHoverNeighbors.has(node.id) ? 0 : 1;
    node.dim += (node.dimTarget - node.dim) * Math.min(1, dt * 6);
    const isDimmed = node.dim > 0.003;
    if (isDimmed || node.wasDimmed) {
      node.colorMaterials.forEach(({ material, baseColor }) => {
        material.color.copy(baseColor);
        if (isDimmed) material.color.multiplyScalar(1 - node.dim * 0.82);
      });
      node.wasDimmed = isDimmed;
    }

    // dentro de cada nodo: las notas que NO comparte con el foco se encogen y
    // su tendón se apaga — lo que resalta en la composición es justo el puente
    node.noteElements.forEach((el) => {
      const target = el.sharedTarget != null ? el.sharedTarget : 1;
      el.shared += (target - el.shared) * noteEase;
      const factor = 0.28 + 0.72 * el.shared;
      el.object.scale.setScalar(el.baseScale * factor);
      el.tendril.material.opacity = 0.1 + 0.45 * el.shared;
    });
  });
}

const MAP_SPOKE_LO = new THREE.Color(0x3a4a48); // gris-verde visible: hasta el rayo más débil se lee
const MAP_SPOKE_HI = new THREE.Color(0x6ff2df);
const MAP_SPOKE_DIM = new THREE.Color(0x1a201f);
const mapEdgeScratch = new THREE.Color();

function updateMapEdgeGeometry() {
  const posAttr = mapEdgeGeometry.getAttribute("position");
  if (!posAttr) return;
  const colAttr = mapEdgeGeometry.getAttribute("color");
  const maxWeight = mapEdges.reduce((m, e) => Math.max(m, e.weight), MAP_MIN_SHARED + 1);
  const focus = mapNodes.get(mapFocusId);
  mapEdges.forEach((e, i) => {
    const b = mapNodes.get(e.b);
    if (!focus || !b) return;
    posAttr.setXYZ(i * 2, focus.pos.x, focus.pos.y, focus.pos.z);
    posAttr.setXYZ(i * 2 + 1, b.pos.x, b.pos.y, b.pos.z);
    const t = clamp01((e.weight - MAP_MIN_SHARED) / Math.max(1, maxWeight - MAP_MIN_SHARED));
    mapEdgeScratch.copy(MAP_SPOKE_LO).lerp(MAP_SPOKE_HI, t * t);
    // al hacer hover, sólo el rayo del nodo apuntado (o todos, si el foco) queda vivo
    const involved = mapHoverId == null || e.b === mapHoverId || mapHoverId === mapFocusId;
    if (!involved) mapEdgeScratch.lerp(MAP_SPOKE_DIM, 0.82);
    colAttr.setXYZ(i * 2, mapEdgeScratch.r, mapEdgeScratch.g, mapEdgeScratch.b);
    colAttr.setXYZ(i * 2 + 1, mapEdgeScratch.r, mapEdgeScratch.g, mapEdgeScratch.b);
  });
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
}

function mapAnimate() {
  mapAnimId = requestAnimationFrame(mapAnimate);
  mapHandleResize(); // el canvas siempre igual al box CSS (evita estiramiento)
  const dt = Math.min(mapClock.getDelta(), 0.05);
  stepMap(dt);
  updateMapEdgeGeometry();
  updateMapLabels();
  updateMapStatus();
  mapControls.update();
  mapRenderer.render(mapScene, mapCamera);
}

// ---- 14.5 interacción: hover / click (info) / doble click (enfocar + expandir) ----

const mapRaycaster = new THREE.Raycaster();

function mapNodeAtEvent(e) {
  let rect = mapRenderer.domElement.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) rect = els.mapRoot.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  mapRaycaster.setFromCamera(ndc, mapCamera);
  const meshes = Array.from(mapNodes.values()).map((n) => n.mesh);
  const hits = mapRaycaster.intersectObjects(meshes, true);
  if (!hits.length) return null;
  let obj = hits[0].object;
  while (obj && !obj.userData.perfumeId) obj = obj.parent;
  return obj ? mapNodes.get(obj.userData.perfumeId) : null;
}

// ---- 14.5b etiquetas flotantes: nombre del nodo bajo el cursor + sus
// vecinos resaltados, proyectados a coordenadas de pantalla cada frame.
// una etiqueta HTML SIEMPRE visible por nodo (nombre), proyectada cada frame.
// las etiquetas de borde ("nota puente" de cada grupo) usan su propio pool.

const mapLabelPool = [];
const mapRimPool = [];

function projectToMapRoot(vec3) {
  const v = vec3.clone().project(mapCamera);
  const w = els.mapRoot.clientWidth;
  const h = els.mapRoot.clientHeight;
  return {
    x: (v.x * 0.5 + 0.5) * w,
    y: (-v.y * 0.5 + 0.5) * h,
    behind: v.z > 1 || v.z < -1,
  };
}

function getMapLabelEl(i) {
  let el = mapLabelPool[i];
  if (!el) {
    el = document.createElement("div");
    el.className = "map-label";
    els.mapRoot.appendChild(el);
    mapLabelPool[i] = el;
  }
  return el;
}

function buildRimLabels(rimData) {
  rimData.forEach((d, i) => {
    let el = mapRimPool[i];
    if (!el) {
      el = document.createElement("div");
      el.className = "map-rim-label";
      els.mapRoot.appendChild(el);
      mapRimPool[i] = el;
    }
    el.textContent = d.text;
    el.dataset.wx = d.x;
    el.dataset.wy = d.y;
    el.style.display = "block";
  });
  for (let i = rimData.length; i < mapRimPool.length; i++) mapRimPool[i].style.display = "none";
}

function updateMapLabels() {
  const nodes = Array.from(mapNodes.values());
  const placed = [];
  nodes.forEach((node, i) => {
    const el = getMapLabelEl(i);
    const p = projectToMapRoot(node.mesh.position);
    if (p.behind) { el.style.display = "none"; return; }
    el.style.display = "block";
    el.textContent = node.record.name;
    // la etiqueta se aleja radialmente del centro para no pisar el nodo
    const off = node.id === mapFocusId ? 32 : 15 + node.targetScale * 13;
    const len = Math.hypot(node.layoutTarget.x, node.layoutTarget.y) || 1;
    const dx = node.id === mapFocusId ? 0 : (node.layoutTarget.x / len) * off;
    const dy = node.id === mapFocusId ? off + 6 : (-node.layoutTarget.y / len) * off;
    el.classList.toggle("map-label-focus", node.id === mapFocusId);
    el.classList.toggle("map-label-dim", mapHoverId != null && node.id !== mapHoverId && !mapHoverNeighbors.has(node.id) && node.id !== mapFocusId);
    placed.push({ el, x: p.x + dx, y: p.y + dy, w: el.offsetWidth || 90, h: el.offsetHeight || 14, focus: node.id === mapFocusId });
  });
  for (let i = nodes.length; i < mapLabelPool.length; i++) mapLabelPool[i].style.display = "none";

  // de-colisión: separa verticalmente las etiquetas que se pisan (el foco no se mueve)
  for (let pass = 0; pass < 4; pass++) {
    for (let a = 0; a < placed.length; a++) {
      for (let b = a + 1; b < placed.length; b++) {
        const A = placed[a], B = placed[b];
        const ox = (A.w + B.w) / 2 + 4 - Math.abs(A.x - B.x);
        const oy = (A.h + B.h) / 2 + 2 - Math.abs(A.y - B.y);
        if (ox <= 0 || oy <= 0) continue;
        const push = oy / 2 + 0.5;
        if (A.focus) { B.y += A.y < B.y ? push * 2 : -push * 2; }
        else if (B.focus) { A.y += B.y < A.y ? push * 2 : -push * 2; }
        else if (A.y < B.y) { A.y -= push; B.y += push; }
        else { A.y += push; B.y -= push; }
      }
    }
  }
  placed.forEach((P) => {
    P.el.style.left = P.x + "px";
    P.el.style.top = P.y + "px";
  });

  mapRimPool.forEach((el) => {
    if (el.style.display === "none") return;
    const p = projectToMapRoot(new THREE.Vector3(+el.dataset.wx, +el.dataset.wy, 0));
    el.style.left = p.x + "px";
    el.style.top = p.y + "px";
  });
}

function onMapPointerMove(e) {
  const node = mapNodeAtEvent(e);
  if (!node) {
    tooltip.hidden = true;
    setMapHover(null);
    return;
  }
  setMapHover(node.id);
  tooltip.hidden = false;
  tooltip.style.left = e.clientX + "px";
  tooltip.style.top = e.clientY + "px";
  const focus = mapFocusId ? mapNodes.get(mapFocusId) : null;
  if (focus && focus.id !== node.id) {
    const shared = sharedNoteLabels(focus.record, node.record);
    tooltip.innerHTML = `<strong>${node.record.name}</strong>${node.record.brand} · ${shared.length} en común: ${shared.join(", ")}`;
  } else {
    tooltip.innerHTML = `<strong>${node.record.name}</strong>${node.record.brand} · perfume foco — doble-click en otro para re-centrar`;
  }
}

function showMapInfoCard(node) {
  const focus = mapFocusId ? mapNodes.get(mapFocusId) : null;
  els.mapInfoCard.hidden = false;
  els.mapInfoName.textContent = node.record.name;
  els.mapInfoMeta.textContent = `${node.record.brand} · ${node.record.year ?? "s/f"} · ${node.record.familyLabel}`;
  if (focus && focus.id !== node.id) {
    const shared = sharedNoteLabels(focus.record, node.record);
    els.mapInfoShared.textContent = shared.length ? shared.join(", ") : "—";
  } else {
    els.mapInfoShared.textContent = "es el perfume foco";
  }
}

function onMapClick(e) {
  const node = mapNodeAtEvent(e);
  if (!node) return;
  mapSelectedId = node.id;
  showMapInfoCard(node);
}

function onMapDblClick(e) {
  const node = mapNodeAtEvent(e);
  if (!node) return;
  refocusMap(node.id);
}

// ---- 14.6 abrir / cerrar / wiring ----

function openMap() {
  if (!current) return;
  if (typeof closePoster === "function" && !els.posterPanel.hidden) closePoster();
  els.mapPanel.hidden = false; // el panel debe tener tamaño ANTES de medir el canvas
  els.mapToggle.setAttribute("aria-expanded", "true");
  ensureMapScene();
  mapOpen = true;
  // el ResizeObserver no siempre entrega en el primer frame — se fuerza el
  // ajuste unas cuantas veces hasta que el canvas toma el tamaño del panel
  let tries = 0;
  (function settleMapSize() {
    mapHandleResize();
    if (tries++ < 20 && mapOpen) requestAnimationFrame(settleMapSize);
  })();
  resetMapTo(current);
  if (mapAnimId == null) mapAnimate();
}

function closeMap() {
  els.mapPanel.hidden = true;
  els.mapToggle.setAttribute("aria-expanded", "false");
  mapOpen = false;
  if (mapAnimId != null) {
    cancelAnimationFrame(mapAnimId);
    mapAnimId = null;
  }
  stopLegendPreviews();
  tooltip.hidden = true;
}

// ---- 14.6b leyenda con vista previa 3D real de cada arquetipo — reutiliza
// los mismos NOTE_BUILDERS que arman los nodos, así la miniatura es
// exactamente fiel a lo que se ve en el mapa (no un ícono aparte que se
// puede desincronizar). Cada fila tiene su propio canvas/renderer chico,
// creados una sola vez y sólo animados mientras la leyenda está abierta.
const LEGEND_PREVIEW_SPECS = [
  { archetype: "blob", canvasId: "legend-preview-blob", color: 0xff5fa8 },
  { archetype: "glass", canvasId: "legend-preview-glass", color: 0xffd23f },
  { archetype: "concrete", canvasId: "legend-preview-concrete", color: 0x4f6bff },
  { archetype: "fuzz", canvasId: "legend-preview-fuzz", color: 0x8a8f96 },
  { archetype: "chrome", canvasId: "legend-preview-chrome", color: 0x3fe6d2 },
];
const LEGEND_PREVIEW_SEED = 42;
let legendPreviewsInitialized = false;
let legendPreviewInstances = [];
let legendAnimId = null;

function ensureLegendPreviews() {
  if (legendPreviewsInitialized) return;
  legendPreviewsInitialized = true;

  LEGEND_PREVIEW_SPECS.forEach((spec) => {
    const canvas = document.getElementById(spec.canvasId);
    if (!canvas) return;
    const w = canvas.clientWidth || 44;
    const h = canvas.clientHeight || 44;

    const previewScene = new THREE.Scene();
    previewScene.environment = scene.environment;

    const fovDeg = 35;
    const camera = new THREE.PerspectiveCamera(fovDeg, w / h, 0.1, 20);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    previewScene.add(new THREE.AmbientLight(0x334455, 1.6));
    const key = new THREE.PointLight(0xffffff, 26, 20, 1.6);
    key.position.set(2, 2, 2);
    previewScene.add(key);

    const built = NOTE_BUILDERS[spec.archetype](LEGEND_PREVIEW_SEED, spec.color);
    if (spec.archetype === "chrome" || spec.archetype === "glass") {
      built.colorMaterials.forEach((m) => {
        m.emissive = m.color.clone();
        m.emissiveIntensity = 0.4;
      });
    }
    previewScene.add(built.object);

    // el tamaño real de cada arquetipo varía mucho (el concreto puede medir
    // hasta ~2.2 de alto, blob/vidrio/cromo rondan 1) — se encuadra la
    // cámara a la esfera envolvente real en vez de asumir una distancia
    // fija; se usa la esfera (no el bounding box) porque el objeto sigue
    // rotando después de este cálculo, y el radio no cambia al rotar
    built.object.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(built.object);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    const radius = Math.max(sphere.radius, 0.3);
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(fovDeg) / 2)) * 1.3;
    const dir = new THREE.Vector3(0.35, 0.25, 0.85).normalize();
    camera.position.copy(sphere.center).addScaledVector(dir, dist);
    camera.lookAt(sphere.center);

    legendPreviewInstances.push({ scene: previewScene, camera, renderer, object: built.object });
  });
}

function legendPreviewAnimate() {
  legendAnimId = requestAnimationFrame(legendPreviewAnimate);
  legendPreviewInstances.forEach(({ scene: previewScene, camera, renderer, object }) => {
    if (!REDUCED_MOTION) {
      object.rotation.y += 0.012;
      object.rotation.x += 0.004;
    }
    renderer.render(previewScene, camera);
  });
}

function stopLegendPreviews() {
  if (legendAnimId != null) {
    cancelAnimationFrame(legendAnimId);
    legendAnimId = null;
  }
}

function wireMapUI() {
  els.mapToggle.addEventListener("click", () => openMap());
  els.mapClose.addEventListener("click", () => closeMap());
  if (els.mapBack) els.mapBack.addEventListener("click", () => mapBack());
  els.mapViewComposition.addEventListener("click", () => {
    const id = mapSelectedId || mapFocusId;
    if (!id) return;
    const record = RECORD_BY_ID.get(id);
    if (record) {
      selectPerfume(record);
      closeMap();
    }
  });
  els.mapLegendToggle.addEventListener("click", () => {
    const expanded = els.mapLegendToggle.getAttribute("aria-expanded") === "true";
    els.mapLegendToggle.setAttribute("aria-expanded", String(!expanded));
    els.mapLegendPanel.hidden = expanded;
    if (!expanded) {
      ensureLegendPreviews();
      if (legendAnimId == null) legendPreviewAnimate();
    } else {
      stopLegendPreviews();
    }
  });
}

// ======================================================
// 15 — INFOGRAFÍA: lámina "vecindario olfativo"
// la ego-network del mapa, congelada como pieza editorial vertical.
// SVG vectorial → exportable a SVG o PNG. Reusa las mismas funciones
// (afinidad de composición, arquetipo/identidad de nota, nota puente).
// ======================================================

const P_NS = "http://www.w3.org/2000/svg";
const P_W = 940, P_H = 1340;
const P_CX = 470, P_CY = 802;
const P_RI = 266, P_RO = 348;   // radios del anillo (px)
const P_RELATED = 9;
const P_INK = "#f4f4f1", P_DIM = "#a6a6a0", P_FAINT = "#6c6c67", P_SOLID = "#e8e8e3";
const P_CYAN = "#3fe6d2", P_GROUND = "#060606";
const P_TIER = { top: "#3fe6d2", middle: "#ff6a52", base: "#a06bff" };

function pel(tag, attrs, parent) {
  const n = document.createElementNS(P_NS, tag);
  for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
function ptext(parent, x, y, str, attrs) {
  const t = pel("text", Object.assign({ x, y }, attrs || {}), parent);
  t.textContent = str;
  return t;
}
function pTspans(parent, x, y, lines, attrs) {
  const t = pel("text", Object.assign({ x, y }, attrs || {}), parent);
  lines.forEach(([str, dy]) => {
    const s = pel("tspan", { x, dy: dy || 0 }, t);
    s.textContent = str;
  });
  return t;
}
function noteHex(key) { return "#" + noteIdentityColor(key).getHexString(); }
function catNo(id) { return "Nº " + hashString(id || "").toString(16).slice(-4).toUpperCase(); }
function pSlug(s) {
  return normalizeText(s || "perfume")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "perfume";
}
function bridgeLabelFor(key, related, focus) {
  const scan = (rec) => {
    for (const nn of [...rec.top, ...rec.middle, ...rec.base]) if (nn.key === key) return nn.label;
    return null;
  };
  for (const r of related) { const l = scan(r.rec); if (l) return l; }
  return scan(focus) || key;
}

// ---- 15.1 formas de arquetipo en 2D (mismo vocabulario que la escena 3D) ----
function pArch(arch, s, rnd) {
  if (arch === "blob") {
    const N = 11, pts = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, r = s * (0.8 + rnd() * 0.42);
      pts.push([Math.cos(a) * r, Math.sin(a) * r * (0.9 + rnd() * 0.25)]);
    }
    let d = "M " + ((pts[0][0] + pts[N - 1][0]) / 2).toFixed(1) + " " + ((pts[0][1] + pts[N - 1][1]) / 2).toFixed(1);
    for (let i = 0; i < N; i++) {
      const c = pts[i], x = pts[(i + 1) % N];
      d += " Q " + c[0].toFixed(1) + " " + c[1].toFixed(1) + " " + ((c[0] + x[0]) / 2).toFixed(1) + " " + ((c[1] + x[1]) / 2).toFixed(1);
    }
    return { kind: "path", d: d + " Z" };
  }
  if (arch === "glass") {
    const N = 6, pts = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rnd() * 0.35, r = s * (0.72 + rnd() * 0.5);
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return { kind: "glass", d: "M " + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L ") + " Z", chord: [pts[0], pts[3]] };
  }
  if (arch === "concrete") {
    const w = s * (1.5 + rnd() * 0.7), h = s * (1.7 + rnd() * 0.9);
    return { kind: "concrete", w, h, rot: (rnd() - 0.5) * 22, rx: s * 0.16,
      speck: [[(rnd() - 0.5) * w * 0.55, (rnd() - 0.5) * h * 0.55], [(rnd() - 0.5) * w * 0.55, (rnd() - 0.5) * h * 0.55]] };
  }
  if (arch === "fuzz") {
    const M = 16, lines = [];
    for (let i = 0; i < M; i++) lines.push([(i / M) * Math.PI * 2 + rnd() * 0.2, s * 0.58, s * (1.05 + rnd() * 0.55)]);
    return { kind: "fuzz", core: s * 0.58, lines };
  }
  return { kind: "chrome", r: s };
}

function pDrawObject(g, ox, oy, arch, size, shared, isFocus, key) {
  const rnd = mulberry32(hashString(key + "|pshape"));
  const spec = pArch(arch, size, rnd);
  const n = pel("g", { transform: "translate(" + ox.toFixed(1) + " " + oy.toFixed(1) + ")" }, g);
  const filled = shared || isFocus;
  const stroke = shared ? P_CYAN : (filled ? P_SOLID : P_FAINT);
  const sw = shared ? 1.6 : 1.1;
  const flt = shared ? "url(#pglow)" : null;

  if (spec.kind === "chrome") {
    if (filled) {
      pel("circle", { r: spec.r, fill: "url(#pchrome)", stroke, "stroke-width": sw, filter: flt }, n);
      pel("ellipse", { cx: -spec.r * 0.32, cy: -spec.r * 0.36, rx: spec.r * 0.3, ry: spec.r * 0.2, fill: "#fff", opacity: 0.5 }, n);
    } else {
      pel("circle", { r: spec.r, fill: "none", stroke, "stroke-width": sw }, n);
    }
  } else if (spec.kind === "concrete") {
    pel("rect", { x: -spec.w / 2, y: -spec.h / 2, width: spec.w, height: spec.h, rx: spec.rx,
      transform: "rotate(" + spec.rot.toFixed(1) + ")", fill: filled ? P_SOLID : "none", stroke, "stroke-width": sw, filter: flt }, n);
    if (filled) spec.speck.forEach((p) => pel("circle", { cx: p[0], cy: p[1], r: size * 0.1, fill: P_GROUND, opacity: 0.55 }, n));
  } else if (spec.kind === "fuzz") {
    pel("circle", { r: spec.core, fill: filled ? P_SOLID : "none", stroke, "stroke-width": sw, filter: flt }, n);
    spec.lines.forEach((L) => pel("line", { x1: Math.cos(L[0]) * L[1], y1: Math.sin(L[0]) * L[1], x2: Math.cos(L[0]) * L[2], y2: Math.sin(L[0]) * L[2],
      stroke, "stroke-width": filled ? 1.2 : 0.9, "stroke-linecap": "round" }, n));
  } else if (spec.kind === "glass") {
    pel("path", { d: spec.d, fill: filled ? P_SOLID : "none", "fill-opacity": filled ? 0.4 : 0, stroke, "stroke-width": sw, filter: flt }, n);
    if (filled) pel("line", { x1: spec.chord[0][0], y1: spec.chord[0][1], x2: spec.chord[1][0], y2: spec.chord[1][1], stroke, "stroke-width": 0.9, opacity: 0.65 }, n);
  } else {
    pel("path", { d: spec.d, fill: filled ? P_SOLID : "none", stroke, "stroke-width": sw, filter: flt }, n);
  }
}

function pDrawOutline(g, arch, size, color, sw) {
  const rnd = mulberry32(hashString(arch + "|pmini"));
  const spec = pArch(arch, size, rnd);
  if (spec.kind === "chrome") pel("circle", { r: size, fill: "none", stroke: color, "stroke-width": sw }, g);
  else if (spec.kind === "concrete") pel("rect", { x: -spec.w / 2, y: -spec.h / 2, width: spec.w, height: spec.h, rx: spec.rx,
    transform: "rotate(" + spec.rot.toFixed(1) + ")", fill: "none", stroke: color, "stroke-width": sw }, g);
  else if (spec.kind === "fuzz") {
    pel("circle", { r: spec.core, fill: "none", stroke: color, "stroke-width": sw }, g);
    spec.lines.slice(0, 10).forEach((L) => pel("line", { x1: Math.cos(L[0]) * L[1], y1: Math.sin(L[0]) * L[1], x2: Math.cos(L[0]) * L[2], y2: Math.sin(L[0]) * L[2],
      stroke: color, "stroke-width": sw * 0.8, "stroke-linecap": "round" }, g));
  } else pel("path", { d: spec.d, fill: "none", stroke: color, "stroke-width": sw }, g);
}

function pPickNotes(record, cap, focusKeys) {
  const all = [];
  ["top", "middle", "base"].forEach((role) => {
    record[role].forEach((nn) => all.push({ key: nn.key, label: nn.label, role, arch: archetypeForNote(nn.key) }));
  });
  all.sort((a, b) => Number(focusKeys.has(b.key)) - Number(focusKeys.has(a.key)));
  return all.slice(0, cap);
}

function pDrawComposition(parent, cx, cy, sc, notes, isFocus, focusKeys) {
  const g = pel("g", {}, parent);
  const H = (isFocus ? 250 : 150) * sc;
  const spread = (isFocus ? 60 : 40) * sc;
  const tierY = { top: cy - H * 0.34, middle: cy, base: cy + H * 0.34 };

  const sw2 = mulberry32(hashString(notes.map((n) => n.key).join()));
  let d = "M " + cx + " " + (cy - H / 2);
  for (let t = 1; t <= 4; t++) {
    const yy = cy - H / 2 + (H * t / 4);
    d += " Q " + (cx + (sw2() - 0.5) * 6 * sc).toFixed(1) + " " + (yy - H / 8).toFixed(1) + " " + cx + " " + yy.toFixed(1);
  }
  pel("path", { d, fill: "none", stroke: P_FAINT, "stroke-width": Math.max(0.8, 1.1 * sc), opacity: 0.85 }, g);

  ["top", "middle", "base"].forEach((role) => {
    const list = notes.filter((n) => n.role === role);
    if (!list.length) return;
    pel("circle", { cx, cy: tierY[role], r: Math.max(1.6, 2.4 * sc), fill: P_TIER[role], opacity: 0.9 }, g);
    list.forEach((note, i) => {
      const rnd = mulberry32(hashString(note.key + "|ppos"));
      const dir = (hashString(note.key) & 2) ? 1 : -1;
      const ty = tierY[role] + (i - (list.length - 1) / 2) * (18 * sc) + (rnd() - 0.5) * 7 * sc;
      const ox = cx + dir * spread * (0.55 + rnd() * 0.7);
      const shared = !isFocus && focusKeys.has(note.key);
      const size = (isFocus ? 19 : 13.5) * sc * (shared ? 1.14 : 0.9);
      pel("path", { d: "M " + cx + " " + tierY[role] + " Q " + ((cx + ox) / 2).toFixed(1) + " " + ((tierY[role] + ty) / 2 - 7).toFixed(1) + " " + ox.toFixed(1) + " " + ty.toFixed(1),
        fill: "none", stroke: shared ? P_CYAN : P_FAINT, "stroke-width": shared ? 1 : 0.7, opacity: shared ? 0.7 : 0.5 }, g);
      pel("rect", { x: cx + dir * 3 - 1.6, y: tierY[role] - 1.6, width: 3.2, height: 3.2, fill: noteHex(note.key), opacity: 0.85 }, g);
      pDrawObject(g, ox, ty, note.arch, size, shared, isFocus, note.key);
    });
  });
}

// ---- 15.2 armar la lámina completa ----
function renderPoster(focusRecord) {
  const stage = els.posterStage;
  stage.innerHTML = "";
  els.posterFocus.textContent = `${focusRecord.name} — ${focusRecord.brand}`;

  const focusKeys = focusRecord.noteKeySet;
  const cands = findLinkedCandidates(focusRecord, new Set([focusRecord.id]), P_RELATED);
  const related = cands.map((c) => {
    const rec = RECORD_BY_ID.get(c.id);
    const sharedKeys = sharedNoteKeys(focusRecord, rec);
    const denom = Math.max(1, Math.min(focusRecord.noteKeySet.size, rec.noteKeySet.size));
    const sim = clamp01(c.lsim / denom);
    const bridge = sharedKeys.slice().sort((a, b) => noteRarity(a) - noteRarity(b))[0];
    return { rec, weight: c.weight, sim, bridge };
  });

  const svg = pel("svg", { viewBox: `0 0 ${P_W} ${P_H}`, xmlns: P_NS, "font-family": "'JetBrains Mono', ui-monospace, monospace" }, stage);
  const defs = pel("defs", {}, svg);
  const fontStyle = pel("style", { id: "poster-fonts" }, defs);
  fontStyle.textContent = "";
  pel("filter", { id: "pgrain" }, defs).appendChild(
    (() => { const f = document.createElementNS(P_NS, "feTurbulence");
      f.setAttribute("type", "fractalNoise"); f.setAttribute("baseFrequency", "0.85");
      f.setAttribute("numOctaves", "2"); f.setAttribute("stitchTiles", "stitch"); return f; })()
  );
  const glow = pel("filter", { id: "pglow", x: "-80%", y: "-80%", width: "260%", height: "260%" }, defs);
  pel("feGaussianBlur", { stdDeviation: "2.4", result: "b" }, glow);
  const fm = pel("feMerge", {}, glow);
  pel("feMergeNode", { in: "b" }, fm); pel("feMergeNode", { in: "SourceGraphic" }, fm);
  const grad = pel("radialGradient", { id: "pchrome", cx: "37%", cy: "32%", r: "72%" }, defs);
  pel("stop", { offset: "0", "stop-color": "#f7f7f3" }, grad);
  pel("stop", { offset: "0.5", "stop-color": "#c4c4bf" }, grad);
  pel("stop", { offset: "1", "stop-color": "#565653" }, grad);

  pel("rect", { x: 0, y: 0, width: P_W, height: P_H, fill: P_GROUND }, svg);

  // cabecera
  ptext(svg, 60, 30, "MP · 2026", { "font-size": 10, "letter-spacing": 1.6, fill: P_DIM });
  ptext(svg, 880, 30, "VRTG SCENT · LÁMINA DE VECINDARIO", { "text-anchor": "end", "font-size": 10, "letter-spacing": 1.6, fill: P_DIM });
  pel("line", { x1: 60, y1: 44, x2: 880, y2: 44, stroke: "rgba(244,244,241,.26)" }, svg);
  ptext(svg, 60, 72, "REGISTRO 001 — COMPUTACIÓN AVANZADA / MCD · UAI", { "font-size": 10, "letter-spacing": 1.9, fill: P_DIM });
  ptext(svg, 880, 80, "L · 001", { "text-anchor": "end", "font-size": 11, "letter-spacing": 2, fill: P_CYAN });

  const nm = focusRecord.name.toUpperCase();
  const nmShort = nm.length > 30 ? nm.slice(0, 29).trimEnd() + "…" : nm;
  const titleShort = nm.length > 24 ? nm.slice(0, 23).trimEnd() + "…" : nm;
  ptext(svg, 880, 132, titleShort, { "text-anchor": "end", "font-family": "'Oswald', 'Arial Narrow', sans-serif", "font-weight": 500, "font-size": 44, "letter-spacing": -0.4, fill: P_INK });

  pTspans(svg, 880, 164, [
    [`Vecindario olfativo — los ${related.length || "—"} perfumes más afines`, 0],
    ["por afinidad de composición. Cada perfume es una nube de", 16],
    ["objetos —uno por nota, con la forma de su categoría—;", 16],
    ["se agrupan alrededor de su nota puente.", 16],
  ], { "text-anchor": "end", "font-size": 10.5, fill: P_DIM });

  ptext(svg, 60, 112, "CÓMO LEER", { "font-size": 11, "letter-spacing": 2.4, fill: P_INK });
  pel("line", { x1: 60, y1: 122, x2: 300, y2: 122, stroke: "rgba(244,244,241,.13)" }, svg);
  pTspans(svg, 60, 142, [
    ["Cada objeto es una nota; su forma", 0],
    ["es su categoría olfativa.", 14],
    ["Relleno macizo — nota compartida", 20],
    ["con el foco. Sólo contorno — nota", 14],
    ["propia, latente.", 14],
    ["Distancia al centro = afinidad de", 20],
    ["composición: una nota en la misma", 14],
    ["capa en ambos pesa más.", 14],
    ["Grupos por NOTA PUENTE — la nota", 20],
    ["compartida más distintiva.", 14],
    ["Grosor del hilo = nº de notas en común.", 20],
  ], { "font-size": 9.5, fill: P_DIM });
  pel("line", { x1: 60, y1: 352, x2: 880, y2: 352, stroke: "rgba(244,244,241,.13)" }, svg);

  // plato
  const plate = pel("g", {}, svg);
  [P_RI, P_RO].forEach((rr) => pel("circle", { cx: P_CX, cy: P_CY, r: rr, fill: "none", stroke: "rgba(244,244,241,.12)", "stroke-dasharray": "1 5" }, plate));

  const labels = [];
  if (related.length) {
    const buckets = new Map();
    related.forEach((r) => { if (!buckets.has(r.bridge)) buckets.set(r.bridge, []); buckets.get(r.bridge).push(r); });
    const blist = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length || noteRarity(a[0]) - noteRarity(b[0]));
    const n = related.length, GAP = 0.16;
    const usable = Math.PI * 2 - blist.length * GAP;
    let ang = -Math.PI / 2;
    const nodes = [], rims = [];
    blist.forEach(([bridge, items]) => {
      const arc = Math.max((items.length / n) * usable, 0.5);
      items.sort((a, b) => b.sim - a.sim);
      items.forEach((it, i) => {
        const a = items.length === 1 ? ang + arc / 2 : ang + (i / (items.length - 1)) * arc;
        const rad = P_RI + (1 - it.sim) * (P_RO - P_RI);
        it.a = a; it.rad = rad;
        it.x = P_CX + Math.sin(a) * rad;
        it.y = P_CY - Math.cos(a) * rad;
        nodes.push(it);
      });
      const mid = ang + arc / 2;
      const rx = Math.max(96, Math.min(844, P_CX + Math.sin(mid) * (P_RO + 20)));
      rims.push({ label: bridgeLabelFor(bridge, related, focusRecord),
        x: rx, y: P_CY - Math.cos(mid) * (P_RO + 20),
        anchor: rx <= 210 ? "start" : rx >= 730 ? "end" : "middle" });
      ang += arc + GAP;
    });

    nodes.forEach((it) => {
      const strong = it.weight >= 4;
      const mx = (P_CX + it.x) / 2 + Math.cos(it.a) * 14, my = (P_CY + it.y) / 2 + Math.sin(it.a) * 14;
      pel("path", { d: `M ${P_CX} ${P_CY} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${it.x.toFixed(1)} ${it.y.toFixed(1)}`,
        fill: "none", stroke: strong ? P_CYAN : "rgba(63,230,210,.32)", "stroke-width": strong ? 2.4 : 1.3, "stroke-opacity": strong ? 0.6 : 1 }, plate);
      const bx = P_CX + (it.x - P_CX) * 0.46 + Math.cos(it.a) * 11;
      const by = P_CY + (it.y - P_CY) * 0.46 + Math.sin(it.a) * 11;
      pDrawOutline(pel("g", { transform: `translate(${bx.toFixed(1)} ${by.toFixed(1)})` }, plate), archetypeForNote(it.bridge), 6.5, P_CYAN, 1.2);
    });

    // etiquetas en dos canaletas (izq/der) — así ningún nombre largo se sale
    // del lienzo; la línea guía une el nodo con su canaleta.
    nodes.forEach((it) => {
      const sc = 0.72 + 0.32 * (it.weight / 7);
      pDrawComposition(plate, it.x, it.y, sc, pPickNotes(it.rec, 5, focusKeys), false, focusKeys);
      const left = it.x < P_CX;
      const gx = left ? 62 : 878;
      const anchor = left ? "start" : "end";
      const gy = Math.max(404, Math.min(1150, it.y));
      const lg = pel("g", {}, plate);
      pel("line", { x1: it.x + (left ? -18 : 18), y1: it.y, x2: gx + (left ? 4 : -4), y2: gy, stroke: "rgba(244,244,241,.22)" }, lg);
      ptext(lg, gx, gy - 1, it.rec.name.toUpperCase(), { "text-anchor": anchor, "font-size": 9.5, "letter-spacing": 0.5, fill: P_INK });
      ptext(lg, gx, gy + 12, `${it.rec.year ?? "s/f"} · ${it.weight} EN COMÚN`, { "text-anchor": anchor, "font-size": 8, "letter-spacing": 0.8, fill: P_DIM });
      labels.push({ g: lg });
    });

    rims.forEach((r) => {
      ptext(plate, r.x, r.y, r.label.toUpperCase(), { "text-anchor": r.anchor, "font-size": 10.5, "letter-spacing": 2, fill: P_CYAN });
    });
  }

  pDrawComposition(plate, P_CX, P_CY, 1.32, pPickNotes(focusRecord, 9, focusKeys), true, focusKeys);
  const nmSize = nm.length > 24 ? Math.max(15, 30 - (nm.length - 24) * 0.8) : 30;
  ptext(plate, P_CX, P_CY + 176, nm, { "text-anchor": "middle", "font-family": "'Oswald', 'Arial Narrow', sans-serif", "font-weight": 500, "font-size": nmSize.toFixed(1), "letter-spacing": 0.6, fill: P_INK, textLength: nm.length > 40 ? 800 : null, lengthAdjust: nm.length > 40 ? "spacingAndGlyphs" : null });
  ptext(plate, P_CX, P_CY + 195, `${catNo(focusRecord.id)} · ${focusRecord.brand.toUpperCase()} · ${focusRecord.year ?? "s/f"} · ${(focusRecord.familyLabel || "—").toUpperCase()}`,
    { "text-anchor": "middle", "font-size": 9, "letter-spacing": 1.5, fill: P_DIM });
  if (!related.length) {
    ptext(plate, P_CX, P_CY + 230, "SIN VECINDARIO — COMPARTE MUY POCAS NOTAS CON EL RESTO DEL ATLAS",
      { "text-anchor": "middle", "font-size": 9, "letter-spacing": 1.4, fill: P_FAINT });
  }

  // pie
  pel("line", { x1: 60, y1: 1284, x2: 880, y2: 1284, stroke: "rgba(244,244,241,.26)" }, svg);
  ptext(svg, 60, 1304, "MÉTODO — afinidad de composición (capas alineadas), agrupada por nota puente.", { "font-size": 9, "letter-spacing": 0.4, fill: P_DIM });
  ptext(svg, 880, 1304, "perfume_visualization.json · Perfumes_Recommender", { "text-anchor": "end", "font-size": 9, "letter-spacing": 0.4, fill: P_DIM });
  ptext(svg, 60, 1320, "VRTG SCENT · ATLAS MORFOLÓGICO DE PERFILES OLFATIVOS", { "font-size": 9, "letter-spacing": 2.6, fill: "#4a4a46" });

  const gr = pel("rect", { x: 0, y: 0, width: P_W, height: P_H, filter: "url(#pgrain)", opacity: 0.05, "pointer-events": "none" }, svg);
  gr.setAttribute("style", "mix-blend-mode:soft-light");

  // de-colisión ligera de etiquetas, una vez el SVG está en el DOM
  requestAnimationFrame(() => pDecollide(labels));
}

function pDecollide(labels) {
  // se toma la caja original de cada etiqueta, se separan verticalmente las
  // que se pisan, y se traslada cada grupo la diferencia acumulada.
  const box = labels.map((L) => { try { const b = L.g.getBBox(); return { cx: b.x + b.width / 2, w: b.width, y: b.y, h: b.height }; } catch (e) { return null; } });
  for (let pass = 0; pass < 5; pass++) {
    for (let i = 0; i < box.length; i++) {
      for (let j = i + 1; j < box.length; j++) {
        const A = box[i], B = box[j];
        if (!A || !B) continue;
        if (Math.abs(A.cx - B.cx) >= (A.w + B.w) / 2 + 6) continue;
        const gap = (A.h + B.h) / 2 + 3 - Math.abs((A.y + A.h / 2) - (B.y + B.h / 2));
        if (gap <= 0) continue;
        const push = gap / 2 + 0.5;
        if (A.y <= B.y) { A.y -= push; B.y += push; } else { A.y += push; B.y -= push; }
      }
    }
  }
  labels.forEach((L, k) => {
    const b = box[k];
    if (!b) return;
    const cur = L.g.getBBox();
    L.g.setAttribute("transform", `translate(0 ${(b.y - cur.y).toFixed(1)})`);
  });
}

// ---- 15.3 exportar ----
let _posterFontCSS = null;
async function posterFontCSS() {
  if (_posterFontCSS !== null) return _posterFontCSS;
  _posterFontCSS = "";
  try {
    const url = "https://fonts.googleapis.com/css2?family=Oswald:wght@500&family=JetBrains+Mono:wght@400;500&display=swap";
    let css = await (await fetch(url)).text();
    const faces = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/g)].map((m) => m[1]);
    for (const u of faces) {
      const bytes = new Uint8Array(await (await fetch(u)).arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      css = css.split(u).join("data:font/woff2;base64," + btoa(bin));
    }
    _posterFontCSS = css;
  } catch (e) {
    _posterFontCSS = "";
  }
  return _posterFontCSS;
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

let posterExporting = false;
async function exportPoster(fmt) {
  const svg = els.posterStage.querySelector("svg");
  if (!svg || posterExporting) return;
  posterExporting = true;
  const btn = els.exportList.querySelector(`button[data-fmt="${fmt}"]`);
  const restore = btn ? btn.textContent : "";
  if (btn) btn.textContent = "generando…";
  els.exportList.hidden = true;
  els.exportToggle.setAttribute("aria-expanded", "false");

  try {
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", P_NS);
    const st = clone.querySelector("#poster-fonts");
    if (st) st.textContent = await posterFontCSS();
    const src = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
    const base = "vecindario-" + pSlug(current && current.name);

    if (fmt === "svg") {
      downloadBlob(new Blob([src], { type: "image/svg+xml;charset=utf-8" }), base + ".svg");
    } else {
      const scale = 2000 / P_W;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(P_W * scale);
      canvas.height = Math.round(P_H * scale);
      await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => {
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = P_GROUND;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((b) => { downloadBlob(b, base + ".png"); res(); }, "image/png");
        };
        img.onerror = rej;
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(src);
      });
    }
  } catch (e) {
    console.error("export falló", e);
  } finally {
    if (btn) btn.textContent = restore;
    posterExporting = false;
  }
}

// ---- 15.4 abrir / cerrar / wiring ----
function openPoster() {
  if (!current) return;
  if (typeof closeMap === "function" && !els.mapPanel.hidden) closeMap();
  els.posterPanel.hidden = false;
  els.posterToggle.setAttribute("aria-expanded", "true");
  posterOpen = true;
  renderPoster(current);
}
function closePoster() {
  els.posterPanel.hidden = true;
  els.posterToggle.setAttribute("aria-expanded", "false");
  els.exportList.hidden = true;
  els.exportToggle.setAttribute("aria-expanded", "false");
  posterOpen = false;
}
function wirePosterUI() {
  els.posterToggle.addEventListener("click", () => (els.posterPanel.hidden ? openPoster() : closePoster()));
  els.posterClose.addEventListener("click", closePoster);
  els.exportToggle.addEventListener("click", () => {
    const open = els.exportList.hidden;
    els.exportList.hidden = !open;
    els.exportToggle.setAttribute("aria-expanded", String(open));
  });
  els.exportList.querySelectorAll("button[data-fmt]").forEach((b) =>
    b.addEventListener("click", () => exportPoster(b.dataset.fmt))
  );
  document.addEventListener("click", (e) => {
    if (!els.exportList.hidden && !e.target.closest(".export-menu")) {
      els.exportList.hidden = true;
      els.exportToggle.setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.posterPanel.hidden) closePoster();
  });
}

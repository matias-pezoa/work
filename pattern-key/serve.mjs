// Servidor estático mínimo para probar PATTERN KEY en local (sin dependencias).
// Uso:  node serve.mjs   →  http://localhost:8080
// (getUserMedia exige https o localhost; abrir index.html con doble clic no sirve
//  porque los módulos ES no cargan desde file://)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT) || 8080;
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".mp4": "video/mp4", ".webm": "video/webm", ".wasm": "application/wasm",
};

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(root, path));
  if (!file.startsWith(normalize(root))) return res.writeHead(403).end();
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404).end("404");
  }
}).listen(port, () => console.log(`PATTERN KEY → http://localhost:${port}`));

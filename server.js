// Live Interpreter — Google Gemini Live Translate backend.
//
//   1. Serve the static frontend in ./public
//   2. Mint short-lived EPHEMERAL TOKENS so the browser can open a WebSocket to
//      the Gemini Live API directly — the real GEMINI_API_KEY never leaves here.
//
// Model: gemini-3.5-live-translate-preview — a dedicated real-time speech-to-
// speech translation model (streams as you talk, and only translates).
//
// Run:  GEMINI_API_KEY=AIza... npm start

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile() {
  try {
    const raw = readFileSync(join(__dirname, ".env"), "utf8");
    for (let line of raw.split(/\r?\n/)) {
      line = line.trim();
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("export ")) line = line.slice(7).trim();
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
    console.log("  ✓  Loaded settings from .env file");
  } catch {}
}
loadEnvFile();

const PUBLIC_DIR = join(__dirname, "public");
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-3.5-live-translate-preview";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon", ".svg": "image/svg+xml",
};
function send(res, status, body, headers = {}) { res.writeHead(status, { "Cache-Control": "no-store", ...headers }); res.end(body); }
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { "Content-Type": MIME[".json"] });

// Mint a single-use ephemeral token for the browser's Live API WebSocket.
async function mintToken() {
  const now = Date.now();
  const body = {
    uses: 1,
    expireTime: new Date(now + 30 * 60 * 1000).toISOString(),        // token valid 30 min
    newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(), // 2 min to open the session (survives cold starts)
  };
  // The REST collection name for auth tokens; try both spellings defensively.
  const urls = [
    "https://generativelanguage.googleapis.com/v1alpha/auth_tokens",
    "https://generativelanguage.googleapis.com/v1alpha/authTokens",
  ];
  let lastErr = "unknown";
  for (const u of urls) {
    let r;
    try {
      r = await fetch(u, {
        method: "POST",
        headers: { "x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) { lastErr = String(e); continue; }
    const text = await r.text();
    if (r.ok) {
      const data = JSON.parse(text);
      return data.name || data.token; // token is the resource "name"
    }
    lastErr = r.status + ": " + text.slice(0, 300);
    if (r.status !== 404) break; // only try the alternate spelling on a 404
  }
  throw new Error("token mint failed — " + lastErr);
}

async function tokenHandler(req, res) {
  if (!GEMINI_API_KEY) return json(res, 500, { error: "GEMINI_API_KEY is not set on the server." });
  try {
    const token = await mintToken();
    return json(res, 200, { token, model: MODEL });
  } catch (err) {
    console.error("token error:", err);
    return json(res, 502, { error: String(err.message || err) });
  }
}

// GET /api/health — confirms the key works and a token can be minted.
async function health(req, res) {
  const out = { key_present: !!GEMINI_API_KEY, model: MODEL, token: "not tested" };
  if (!GEMINI_API_KEY) return json(res, 200, out);
  try { await mintToken(); out.token = "OK"; }
  catch (e) { out.token = "ERROR " + String(e.message || e); }
  return json(res, 200, out);
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = normalize(join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden");
  try {
    const data = await readFile(filePath);
    return send(res, 200, data, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
  } catch { return send(res, 404, "Not found"); }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/token" && req.method === "POST") return tokenHandler(req, res);
  if (url.pathname === "/api/health" && req.method === "GET") return health(req, res);
  if (req.method === "GET") return serveStatic(req, res, url);
  return send(res, 405, "Method not allowed");
});

server.listen(PORT, () => {
  console.log(`\n  Live Interpreter (Gemini) running at http://localhost:${PORT}`);
  console.log(`  Model: ${MODEL}`);
  console.log(GEMINI_API_KEY ? "  ✓  GEMINI_API_KEY detected.\n" : "  ⚠  GEMINI_API_KEY is NOT set.\n");
});

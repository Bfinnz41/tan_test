// Live Interpreter — minimal zero-dependency Node server.
//
//   1. Serve the static frontend in ./public
//   2. Mint short-lived OpenAI "client secrets" so the browser can open a
//      WebRTC session WITHOUT ever seeing the real OPENAI_API_KEY.
//
// Uses gpt-realtime-translate: a dedicated speech-to-speech TRANSLATION model.
// Unlike a conversational model, it only ever translates — it never chats,
// narrates, or answers. The output language is locked per session (set by the
// direction toggle), so it can't drift into other languages.
//
// Run:  OPENAI_API_KEY=sk-... npm start

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load a local .env file (if present) so you can keep OPENAI_API_KEY in a file
// instead of typing it into the terminal. Real environment values win.
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
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
    console.log("  ✓  Loaded settings from .env file");
  } catch {
    // No .env file — rely on real environment variables.
  }
}

loadEnvFile();

const PUBLIC_DIR = join(__dirname, "public");
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const MODEL = "gpt-realtime-translate";
const LANG_NAMES = { en: "English", vi: "Vietnamese" };

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...headers });
  res.end(body);
}

// POST /api/session?to=en|vi  ->  { client_secret, output_language }
async function createSession(req, res, url) {
  if (!OPENAI_API_KEY) {
    return send(res, 500, JSON.stringify({
      error: "OPENAI_API_KEY is not set on the server. Export it before starting.",
    }), { "Content-Type": MIME[".json"] });
  }

  const to = (url.searchParams.get("to") || "en").toLowerCase();
  if (!LANG_NAMES[to]) {
    return send(res, 400, JSON.stringify({
      error: `Unsupported output language "${to}". Use "en" or "vi".`,
    }), { "Content-Type": MIME[".json"] });
  }

  const payload = {
    session: {
      model: MODEL,
      audio: {
        input: {
          transcription: { model: "gpt-realtime-whisper" },
          // near_field = clean pickup of a person speaking into the device.
          noise_reduction: { type: "near_field" },
        },
        output: { language: to },
      },
    },
  };

  try {
    const r = await fetch(
      "https://api.openai.com/v1/realtime/translations/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const text = await r.text();
    if (!r.ok) {
      console.error("OpenAI client_secrets error:", r.status, text);
      return send(res, 502, JSON.stringify({
        error: "Failed to create OpenAI session.",
        status: r.status,
        detail: text.slice(0, 500),
      }), { "Content-Type": MIME[".json"] });
    }

    const data = JSON.parse(text);
    const clientSecret =
      data.value ??
      data.client_secret?.value ??
      (typeof data.client_secret === "string" ? data.client_secret : null);

    if (!clientSecret) {
      console.error("Unexpected client_secrets response shape:", text.slice(0, 500));
      return send(res, 502, JSON.stringify({
        error: "Could not find client secret in OpenAI response.",
      }), { "Content-Type": MIME[".json"] });
    }

    return send(res, 200, JSON.stringify({
      client_secret: clientSecret,
      output_language: to,
      expires_at: data.expires_at ?? data.client_secret?.expires_at ?? null,
    }), { "Content-Type": MIME[".json"] });
  } catch (err) {
    console.error("Session creation failed:", err);
    return send(res, 500, JSON.stringify({ error: String(err) }), {
      "Content-Type": MIME[".json"],
    });
  }
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = normalize(join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden");
  try {
    const data = await readFile(filePath);
    const type = MIME[extname(filePath)] || "application/octet-stream";
    return send(res, 200, data, { "Content-Type": type });
  } catch {
    return send(res, 404, "Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/session" && req.method === "POST") return createSession(req, res, url);
  if (req.method === "GET") return serveStatic(req, res, url);
  return send(res, 405, "Method not allowed");
});

server.listen(PORT, () => {
  console.log(`\n  Live Interpreter running at http://localhost:${PORT}`);
  if (!OPENAI_API_KEY) {
    console.log("  ⚠  OPENAI_API_KEY is NOT set — sessions will fail until you export it.\n");
  } else {
    console.log("  ✓  OPENAI_API_KEY detected.\n");
  }
});

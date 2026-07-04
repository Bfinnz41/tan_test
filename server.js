// Live Interpreter — minimal zero-dependency Node server.
//
// Responsibilities:
//   1. Serve the static frontend in ./public
//   2. Mint short-lived OpenAI "client secrets" so the browser can open a
//      WebRTC session with gpt-realtime-translate WITHOUT ever seeing the
//      real OPENAI_API_KEY.
//
// Run:  OPENAI_API_KEY=sk-... npm start   (or put it in a .env-style export)

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// The 13 supported output languages include both of ours.
const SUPPORTED_OUTPUT = new Set(["en", "vi"]);

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

// POST /api/session?to=vi|en  ->  { client_secret, output_language }
async function createSession(req, res, url) {
  if (!OPENAI_API_KEY) {
    return send(res, 500, JSON.stringify({
      error: "OPENAI_API_KEY is not set on the server. Export it before starting.",
    }), { "Content-Type": MIME[".json"] });
  }

  const to = (url.searchParams.get("to") || "vi").toLowerCase();
  if (!SUPPORTED_OUTPUT.has(to)) {
    return send(res, 400, JSON.stringify({
      error: `Unsupported output language "${to}". Use "en" or "vi".`,
    }), { "Content-Type": MIME[".json"] });
  }

  const payload = {
    session: {
      model: "gpt-realtime-translate",
      audio: {
        input: {
          transcription: { model: "gpt-realtime-whisper" },
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
    // Normalize across possible response shapes.
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
  // Prevent path traversal; default to index.html.
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = normalize(join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return send(res, 403, "Forbidden");
  }
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

  if (url.pathname === "/api/session" && req.method === "POST") {
    return createSession(req, res, url);
  }
  if (req.method === "GET") {
    return serveStatic(req, res, url);
  }
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

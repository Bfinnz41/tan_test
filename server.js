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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load a local .env file (if present) so you can keep OPENAI_API_KEY in a file
// instead of typing it into the terminal. Values already set in the real
// environment win, so an explicit `export`/`$env:` still overrides the file.
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
      // Strip surrounding quotes if present.
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
    console.log("  ✓  Loaded settings from .env file");
  } catch {
    // No .env file — that's fine; rely on real environment variables.
  }
}

loadEnvFile();

const PUBLIC_DIR = join(__dirname, "public");
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// The interpreter model + voice. gpt-realtime-2 is promptable (unlike the
// translate model), so we can constrain languages and control Vietnamese
// politeness. Swap MODEL/VOICE here if you want to try others.
const MODEL = "gpt-realtime-2";
const VOICE = "marin";

const LANG_NAMES = { en: "English", vi: "Vietnamese" };

// The instruction is the whole quality lever. It is DIRECTIONAL: the speaker's
// language is fixed by the toggle, which removes all guesswork (and kills the
// "drifts into Thai" problem). It keeps the model a pure translator and enforces
// natural Vietnamese kinship pronouns/register.
function buildInstructions(from, to) {
  const F = LANG_NAMES[from], T = LANG_NAMES[to];
  const viNote = to === "vi"
    ? `\n6. Use correct Vietnamese kinship pronouns and politeness (tôi, con, anh, em, chị, cô, chú, bác, ông, bà) from context; default to polite, respectful forms when unclear.`
    : "";
  return `You are a professional simultaneous interpreter. Your ONLY job is to translate ${F} speech into ${T}. You are a translation machine, NOT a conversation partner. The speaker is speaking ${F}.

STRICT RULES — follow every one, exactly:
1. Output ONLY ${T}. Never speak ${F} or any other language — not a single word of ${F}.
2. TRANSLATE, never respond. Do NOT answer, agree, greet, thank, acknowledge, or add filler ("okay", "yes", "sure", "got it", "cảm ơn"). If the speaker asks a question, translate the QUESTION into ${T} — do NOT answer it.
3. Say nothing except the translation itself. No commentary, no "the speaker said", no explanations.
4. Preserve meaning, tone, emotion, numbers, names, dates, and places exactly.
5. Match the speaker's register (casual vs. formal).${viNote}

You never break character. For every piece of ${F} speech, you speak ONLY its ${T} translation, then wait silently for the next speech.`;
}

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

  const from = (url.searchParams.get("from") || "vi").toLowerCase();
  const to = (url.searchParams.get("to") || "en").toLowerCase();
  if (!LANG_NAMES[from] || !LANG_NAMES[to] || from === to) {
    return send(res, 400, JSON.stringify({
      error: `Invalid direction "${from}->${to}". Use en/vi, and they must differ.`,
    }), { "Content-Type": MIME[".json"] });
  }

  const payload = {
    session: {
      type: "realtime",
      model: MODEL,
      instructions: buildInstructions(from, to),
      audio: {
        input: {
          transcription: { model: "gpt-realtime-whisper" },
          // "far_field" suits audio captured at a distance (e.g. another
          // phone's speaker held near the laptop). "near_field" would treat
          // that as background noise and filter it out.
          noise_reduction: { type: "far_field" },
          // Auto-respond when the speaker finishes a thought.
          turn_detection: { type: "semantic_vad" },
        },
        output: { voice: VOICE },
      },
    },
  };

  try {
    const r = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
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
      model: MODEL,
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

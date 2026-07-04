// Live Interpreter — minimal zero-dependency Node server.
//
//   1. Serve the static frontend in ./public
//   2. Mint short-lived OpenAI "client secrets" so the browser can open a
//      WebRTC session WITHOUT ever seeing the real OPENAI_API_KEY.
//
// Two selectable engines:
//   - "translate": gpt-realtime-translate. A dedicated translator — it can only
//     translate, never chats. More literal, not tunable.
//   - "pro": gpt-realtime-2. A GPT-5-class voice model tuned HARD (few-shot
//     examples + low temperature) to behave as a strict translator. Higher
//     quality, but being a conversational model it may rarely slip.
//
// Run:  OPENAI_API_KEY=sk-... npm start

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
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
    console.log("  ✓  Loaded settings from .env file");
  } catch {}
}

loadEnvFile();

const PUBLIC_DIR = join(__dirname, "public");
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const MODEL_TRANSLATE = "gpt-realtime-translate";
const MODEL_PRO = "gpt-realtime-2";
const VOICE = "marin";
const LANG_NAMES = { en: "English", vi: "Vietnamese" };

// Directional interpreter instruction for the "pro" (conversational) engine.
// Few-shot examples + strict rules do the heavy lifting of keeping it a
// translator instead of an assistant.
function buildInstructions(from, to) {
  const F = LANG_NAMES[from], T = LANG_NAMES[to];
  const viNote = to === "vi"
    ? `\n5. Use correct Vietnamese kinship pronouns/politeness (tôi, con, anh, em, chị, cô, chú, bác, ông, bà) from context; default to polite forms when unclear.`
    : "";
  const examples = from === "vi"
    ? `Speaker: "Em tên là Minh." → You: "My name is Minh."
Speaker: "Bây giờ mấy giờ rồi?" → You: "What time is it now?"   (you TRANSLATE the question — you never answer it)`
    : `Speaker: "My name is Minh." → You: "Tên tôi là Minh."
Speaker: "What time is it now?" → You: "Bây giờ là mấy giờ rồi?"   (you TRANSLATE the question — you never answer it)`;

  return `You are a professional simultaneous interpreter — a TRANSLATION MACHINE, never a conversation partner. The speaker speaks ${F}. Render everything they say into natural, fluent ${T}.

STRICT RULES:
1. Output ONLY ${T}. Never speak ${F} or any other language.
2. TRANSLATE, never respond. Never answer, greet, agree, thank, acknowledge, or add filler ("okay", "sure", "let me translate", "one moment"). If the speaker asks a question, translate the QUESTION into ${T} — do NOT answer it.
3. Output nothing but the translation itself — no commentary, no narration.
4. Preserve meaning, tone, emotion, numbers, names, dates exactly. Match the speaker's register.${viNote}

EXAMPLES — this is the ONLY behavior allowed:
${examples}

You never break character. For each thing said, you speak ONLY its ${T} translation, then wait silently.`;
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

// POST /api/session?engine=translate|pro&from=vi|en&to=en|vi
async function createSession(req, res, url) {
  if (!OPENAI_API_KEY) {
    return send(res, 500, JSON.stringify({
      error: "OPENAI_API_KEY is not set on the server. Export it before starting.",
    }), { "Content-Type": MIME[".json"] });
  }

  const engine = (url.searchParams.get("engine") || "translate").toLowerCase();
  const from = (url.searchParams.get("from") || "vi").toLowerCase();
  const to = (url.searchParams.get("to") || "en").toLowerCase();
  if (!LANG_NAMES[from] || !LANG_NAMES[to] || from === to) {
    return send(res, 400, JSON.stringify({ error: `Invalid direction "${from}->${to}".` }),
      { "Content-Type": MIME[".json"] });
  }

  let endpoint, payload;
  if (engine === "pro") {
    endpoint = "https://api.openai.com/v1/realtime/client_secrets";
    payload = {
      session: {
        type: "realtime",
        model: MODEL_PRO,
        instructions: buildInstructions(from, to),
        temperature: 0.6, // lowest allowed — makes it mechanical, less "chatty"
        audio: {
          input: {
            transcription: { model: "gpt-realtime-whisper" },
            noise_reduction: { type: "near_field" },
            turn_detection: { type: "semantic_vad" },
          },
          output: { voice: VOICE },
        },
      },
    };
  } else {
    endpoint = "https://api.openai.com/v1/realtime/translations/client_secrets";
    payload = {
      session: {
        model: MODEL_TRANSLATE,
        audio: {
          input: {
            transcription: { model: "gpt-realtime-whisper" },
            noise_reduction: { type: "near_field" },
          },
          output: { language: to },
        },
      },
    };
  }

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    if (!r.ok) {
      console.error("OpenAI client_secrets error:", r.status, text);
      return send(res, 502, JSON.stringify({
        error: "Failed to create OpenAI session.", status: r.status, detail: text.slice(0, 500),
      }), { "Content-Type": MIME[".json"] });
    }
    const data = JSON.parse(text);
    const clientSecret =
      data.value ?? data.client_secret?.value ??
      (typeof data.client_secret === "string" ? data.client_secret : null);
    if (!clientSecret) {
      console.error("Unexpected client_secrets response:", text.slice(0, 500));
      return send(res, 502, JSON.stringify({ error: "Could not find client secret in OpenAI response." }),
        { "Content-Type": MIME[".json"] });
    }
    return send(res, 200, JSON.stringify({
      client_secret: clientSecret,
      engine: engine === "pro" ? "pro" : "translate",
      model: engine === "pro" ? MODEL_PRO : MODEL_TRANSLATE,
    }), { "Content-Type": MIME[".json"] });
  } catch (err) {
    console.error("Session creation failed:", err);
    return send(res, 500, JSON.stringify({ error: String(err) }), { "Content-Type": MIME[".json"] });
  }
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = normalize(join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden");
  try {
    const data = await readFile(filePath);
    return send(res, 200, data, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
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
  console.log(OPENAI_API_KEY
    ? "  ✓  OPENAI_API_KEY detected.\n"
    : "  ⚠  OPENAI_API_KEY is NOT set — sessions will fail until you export it.\n");
});

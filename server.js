// Live Interpreter — chained pipeline (highest accuracy).
//
// For each utterance the browser detects (hands-free, by pause):
//   1. STT   — Whisper transcribes the audio  → source text
//   2. TRANSLATE — a GPT-5-class text model translates the full sentence → target text
//   3. TTS   — the translation is synthesized to speech
//
// Each stage uses the best model for its job, and the translate step sees a
// complete, clean sentence with full context — far more accurate than a live
// speech-to-speech model, and fully tunable (Vietnamese pronouns, etc.).
//
// The real OPENAI_API_KEY stays here on the server; the browser only sends audio.
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
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
    console.log("  ✓  Loaded settings from .env file");
  } catch {}
}
loadEnvFile();

const PUBLIC_DIR = join(__dirname, "public");
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- Models (swap any of these in one place if you want to tune) ---
const STT_MODEL = "gpt-4o-transcribe";   // speech -> text (Whisper family)
const TRANSLATE_MODEL = "gpt-5.5";        // text -> translated text (highest quality)
const TTS_MODEL = "gpt-4o-mini-tts";      // translated text -> speech
const TTS_VOICE = "alloy";

// Pick a file extension that matches the audio the browser actually sent.
// iOS Safari sends audio/mp4; Chrome sends audio/webm. OpenAI's transcriber
// rejects a wrong extension, so this must match the real content.
function extForMime(m) {
  m = (m || "").toLowerCase();
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "mp4";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("wav")) return "wav";
  return "webm";
}

const LANG_NAMES = { en: "English", vi: "Vietnamese" };

function translatePrompt(from, to) {
  const F = LANG_NAMES[from], T = LANG_NAMES[to];
  const viNote = to === "vi"
    ? " Use correct Vietnamese kinship pronouns and politeness (tôi, con, anh, em, chị, cô, chú, bác, ông, bà) based on context; default to polite forms when unclear."
    : "";
  return `You are an expert ${F}-to-${T} translator. Translate the user's ${F} text into natural, fluent ${T}. Output ONLY the ${T} translation — no quotes, no notes, no explanations, no commentary. Never answer questions or add anything; if the text is a question, translate the question. Preserve meaning, tone, numbers, names, and dates exactly.${viNote} If the input is empty or clearly not speech, output nothing.`;
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon", ".svg": "image/svg+xml",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...headers });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { "Content-Type": MIME[".json"] });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// --- Pipeline stages ---
async function transcribe(audioBuffer, mimeType, fromLang) {
  const form = new FormData();
  const filename = "audio." + extForMime(mimeType);
  form.append("file", new Blob([audioBuffer], { type: mimeType || "audio/webm" }), filename);
  form.append("model", STT_MODEL);
  form.append("language", fromLang); // strong hint => no wrong-language drift
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`STT ${r.status}: ${text.slice(0, 300)}`);
  return (JSON.parse(text).text || "").trim();
}

async function translate(sourceText, from, to) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TRANSLATE_MODEL,
      messages: [
        { role: "system", content: translatePrompt(from, to) },
        { role: "user", content: sourceText },
      ],
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Translate ${r.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  return (data.choices?.[0]?.message?.content || "").trim();
}

async function synthesize(text) {
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, voice: TTS_VOICE, input: text, response_format: "mp3" }),
  });
  if (!r.ok) throw new Error(`TTS ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.toString("base64");
}

// POST /api/interpret?from=vi&to=en   body = raw audio bytes
async function interpret(req, res, url) {
  if (!OPENAI_API_KEY) return json(res, 500, { error: "OPENAI_API_KEY is not set on the server." });
  const from = (url.searchParams.get("from") || "vi").toLowerCase();
  const to = (url.searchParams.get("to") || "en").toLowerCase();
  if (!LANG_NAMES[from] || !LANG_NAMES[to] || from === to) return json(res, 400, { error: "Invalid direction." });

  try {
    const audio = await readBody(req);
    if (!audio || audio.length < 1200) return json(res, 200, { skip: true }); // too short / silence

    const mimeType = req.headers["content-type"] || "audio/webm";
    const source = await transcribe(audio, mimeType, from);
    if (!source) return json(res, 200, { skip: true });

    const translation = await translate(source, from, to);
    if (!translation) return json(res, 200, { source, translation: "", audio: null });

    const audioB64 = await synthesize(translation);
    return json(res, 200, { source, translation, audio: audioB64 });
  } catch (err) {
    console.error("interpret error:", err);
    return json(res, 502, { error: String(err.message || err) });
  }
}

// GET /api/health — pings each model so you can see which stage (if any) is
// misconfigured, just by opening this URL in a browser.
async function health(req, res) {
  const out = {
    key_present: !!OPENAI_API_KEY,
    models: { stt: STT_MODEL, translate: TRANSLATE_MODEL, tts: TTS_MODEL },
    translate: "not tested", tts: "not tested", stt: "not tested",
  };
  if (!OPENAI_API_KEY) return json(res, 200, out);

  // Translate model check
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: TRANSLATE_MODEL, messages: [{ role: "user", content: "Reply with: ok" }] }),
    });
    out.translate = r.ok ? "OK" : "ERROR " + r.status + ": " + (await r.text()).slice(0, 220);
  } catch (e) { out.translate = "ERROR " + String(e.message || e); }

  // TTS model check
  try {
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: TTS_MODEL, voice: TTS_VOICE, input: "ok" }),
    });
    out.tts = r.ok ? "OK" : "ERROR " + r.status + ": " + (await r.text()).slice(0, 220);
  } catch (e) { out.tts = "ERROR " + String(e.message || e); }

  // STT model check (tiny non-audio; a "model not found" error names the model,
  // any other error means the model itself resolved fine).
  try {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("test-not-audio")], { type: "audio/webm" }), "a.webm");
    form.append("model", STT_MODEL);
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: form,
    });
    out.stt = r.ok ? "OK" : "HTTP " + r.status + ": " + (await r.text()).slice(0, 220);
  } catch (e) { out.stt = "ERROR " + String(e.message || e); }

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
  } catch {
    return send(res, 404, "Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/interpret" && req.method === "POST") return interpret(req, res, url);
  if (url.pathname === "/api/health" && req.method === "GET") return health(req, res);
  if (req.method === "GET") return serveStatic(req, res, url);
  return send(res, 405, "Method not allowed");
});

server.listen(PORT, () => {
  console.log(`\n  Live Interpreter (chained) running at http://localhost:${PORT}`);
  console.log(`  Pipeline: ${STT_MODEL} → ${TRANSLATE_MODEL} → ${TTS_MODEL}`);
  console.log(OPENAI_API_KEY ? "  ✓  OPENAI_API_KEY detected.\n" : "  ⚠  OPENAI_API_KEY is NOT set.\n");
});

# Live Interpreter — English ⇄ Vietnamese

A hands-free English⇄Vietnamese interpreter built as a **3-stage pipeline** for
maximum accuracy. It listens, detects when you pause, and translates each
sentence as a complete thought:

```
🎙️ speech → Whisper (STT) → GPT-5 (translate) → TTS → 🔊 spoken translation
```

- **Sentence-by-sentence, hands-free** — a browser voice-activity detector
  segments your speech by pause; no button-holding.
- **Highest accuracy** — the translation step is a full text model translating a
  complete, clean sentence with context, and it's fully tunable (Vietnamese
  kinship pronouns, etc.). Trade-off: ~1–2s after each sentence.
- **Manual direction toggle** (⇄) and a language hint to the transcriber, so it
  never drifts into the wrong language.
- 🔊/🔇 to mute playback and just read the transcript.

All model IDs are constants at the top of `server.js` (`STT_MODEL`,
`TRANSLATE_MODEL`, `TTS_MODEL`) — swap any of them in one place.

## How it works

```
 🎙️ mic ──▶ browser (WebRTC) ──▶ OpenAI gpt-realtime-translate
                                       │
 🔊 speaker ◀── translated audio ◀─────┘
     + live transcripts over the data channel
```

Your real `OPENAI_API_KEY` **never reaches the browser**. `server.js` exchanges
it for a short-lived *client secret* (`POST /api/session`), and the browser uses
only that secret to open its WebRTC session with OpenAI.

- `server.js` — zero-dependency Node server: static host + token minting.
- `public/index.html` — the interpreter UI (mic, WebRTC, transcripts).

## Run it

Requires **Node 18+** (for built-in `fetch`) and an OpenAI API key with
Realtime access. There are no npm dependencies to install.

```bash
export OPENAI_API_KEY=sk-...        # your key with gpt-realtime-translate access
npm start                           # or: node server.js
```

Then open **http://localhost:3000**, tap **Start interpreting**, allow the
microphone, and speak. Use a headset — playing the translation through open
speakers while the mic is live can create a feedback loop.

> Browsers require a secure context for mic access. `http://localhost` counts as
> secure, so local dev works. If you deploy, serve it over **HTTPS**.

## Cost

Billed per stage (transcription + translation + speech). Roughly a few cents per
sentence. Set a monthly spending cap in your OpenAI dashboard.

## Notes / next steps

- Pause detection is tuned by `START_THRESH` / `SILENCE_MS` / `MIN_UTT_MS` near
  the top of the `<script>` in `public/index.html`.
- If a stage returns an HTTP 400, it's almost always a model ID — check the three
  `*_MODEL` constants in `server.js` against your account's available models.
- Ideas: streaming (live word-by-word) transcript, save/download transcripts,
  or swapping the translate step to a different provider for Vietnamese.

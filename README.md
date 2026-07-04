# Live Interpreter — English ⇄ Vietnamese

A streaming English⇄Vietnamese speech interpreter built on Google's
**`gemini-3.5-live-translate-preview`** — a dedicated real-time speech-to-speech
translation model (Vietnamese is one of its best-supported languages).

```
🎙️ mic → 16kHz PCM → Gemini Live (WebSocket) → 24kHz PCM → 🔊 translated speech
```

- **Streaming** — translates as you talk, with live transcripts of both sides.
- **Direction toggle** (⇄) sets `translationConfig.targetLanguageCode`.
- The browser connects straight to Gemini using a short-lived **ephemeral token**
  minted by the server, so `GEMINI_API_KEY` never reaches the client.
- 🔊/🔇 to mute playback.

Get a key from Google AI Studio (https://aistudio.google.com) and set it as
`GEMINI_API_KEY`. Open `/api/health` to confirm the key works.

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

Requires **Node 18+** (for built-in `fetch`). No npm dependencies.

```bash
export GEMINI_API_KEY=AIza...       # from https://aistudio.google.com
npm start                           # or: node server.js
```

Then open **http://localhost:3000**, tap **Start**, allow the microphone, and
speak. Use headphones to avoid the translated audio looping back into the mic.

> Browsers require a secure context (HTTPS or `http://localhost`) for mic access.
> The included `render.yaml` deploys this to a public HTTPS URL on Render.

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

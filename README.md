# Live Interpreter — English ⇄ Vietnamese

A real-time speech interpreter built on OpenAI's **`gpt-realtime-translate`**
model. Speak into your mic and hear the translation streamed back in the other
language, with live transcripts of both sides.

- **Speech in, speech out**, low latency — translation starts before you finish
  your sentence (no turn-by-turn waiting).
- **Two-way**: tap ⇄ to flip between 🇬🇧→🇻🇳 and 🇻🇳→🇬🇧.
- Source language is auto-detected; only the output language is set per session.

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

`gpt-realtime-translate` is billed per minute of audio (about **$0.034/min** at
launch). Stop the session when you're not speaking.

## Notes / next steps

- Model IDs (`gpt-realtime-translate`, `gpt-realtime-whisper`) are set in
  `server.js` — swap them there if OpenAI renames or you want a different tier.
- Ideas: save/download transcripts, a conversation history log, push-to-talk,
  or a "conference" mode that shows both directions side by side.

# Live Interpreter — English ⇄ Vietnamese

A real-time speech interpreter built on OpenAI's **`gpt-realtime-2`** (GPT-5-class
voice model), driven by a custom interpreter instruction. Speak into your mic and
hear the translation streamed back in the other language, with live transcripts.

- **Speech in, speech out**, low latency.
- **Auto-detect, two-way**: speak English or Vietnamese and it translates into the
  other automatically — one session handles both directions.
- **Tuned for quality**: the prompt locks output to English/Vietnamese only (no
  drifting into other languages) and enforces natural Vietnamese kinship pronouns
  and politeness (anh/em/cô/chú…). Edit `INSTRUCTIONS` in `server.js` to adjust.
- 🔊/🔇 button to mute playback and just read the transcript.

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

`gpt-realtime-2` is billed by audio tokens (roughly **~$0.05–0.15/min** depending
on how much is spoken). Set a monthly spending cap in your OpenAI dashboard and
stop the session when you're not using it.

## Notes / next steps

- `MODEL`, `VOICE`, and the `INSTRUCTIONS` prompt are all at the top of
  `server.js` — the prompt is the main quality lever (tone, formality, languages).
- The model can't be forced to a specific English variant (e.g. US vs UK).
- Ideas: save/download transcripts, a conversation history log, push-to-talk,
  or feeding a phone call's audio in digitally instead of through the mic.

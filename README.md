# Live Interpreter — English ⇄ Vietnamese

A real-time speech interpreter built on OpenAI's **`gpt-realtime-translate`**, a
dedicated speech-to-speech translation model. It only ever translates — it never
chats, narrates, or answers, which makes it reliable as an interpreter. Speak into
your mic and hear the translation in the other language, with live transcripts.

- **Speech in, speech out**, low latency.
- **Manual direction toggle**: tap ⇄ to set 🇻🇳→🇬🇧 or 🇬🇧→🇻🇳. The output language
  is locked per session, so it can't drift into other languages.
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

`gpt-realtime-translate` is billed per minute of audio (about **$0.034/min**).
Set a monthly spending cap in your OpenAI dashboard and stop the session when
you're not using it.

## Notes / next steps

- `MODEL` and the audio settings are at the top of `server.js`.
- This model is not promptable, so it can't be tuned for tone/formality or a
  specific English variant. For that you'd trade up to a conversational model
  (higher quality but it tends to chat instead of translate).
- Ideas: save/download transcripts, push-to-talk, or feeding a phone call's
  audio in digitally instead of through the mic.

# eufy-llm

LLM-controlled Eufy X10 Pro Omni. Type natural-language commands; Claude drives
the robot via tools.

```
you> clean the kitchen and living room
claude> Started cleaning: kitchen, living room.

you> go home and resume cleaning at 3pm tomorrow
claude> Heading home now. Scheduled 'Resume' for 2026-05-25T15:00:00 (job id: 4f2a1c).

you> dance
claude> Danced via the play/pause shuffle (manual control not available on this model).
```

## Architecture

- `robot.py` — async wrapper over the unofficial `eufy-clean` library (Tuya cloud)
- `tools.py` — JSON-schema tool definitions + dispatch table for Claude
- `agent.py` — manual tool-use loop against the Anthropic API
- `scheduler.py` — APScheduler (asyncio) for one-shot and cron jobs
- `dance.py` — fake dance routine (X10 has no native dance mode)
- `main.py` — CLI

## Run locally

This must run on your own machine (or an always-on box like a Raspberry Pi).
A cloud container won't keep scheduled jobs alive.

```sh
git clone <this repo>
cd tan_test
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # fill in ANTHROPIC_API_KEY, EUFY_USERNAME, EUFY_PASSWORD
python -m eufy_llm.main
```

## Caveats

- **Unofficial Eufy API.** `eufy-clean` talks to the same Tuya cloud the mobile
  app uses. Method names shift between versions — `robot.py` probes for the
  most likely names and raises a clear error if none match. If you hit one,
  inspect the library and add the right method name to the probe list.
- **Room cleaning** requires that you've already set up the map and named
  rooms in the Eufy mobile app. Run `list_rooms` (just ask Claude "what
  rooms do you see?") to confirm.
- **Dance mode is fake.** Real dance needs manual joystick control, which
  isn't reliably exposed for the X10. The fallback is a play/pause shuffle.
- **Costs.** Each conversation turn is one or more Anthropic API calls. Set
  `ANTHROPIC_MODEL=claude-sonnet-4-6` in `.env` for ~10x cheaper turns if
  Opus's quality isn't needed.

# eufy-llm

LLM-controlled Eufy X10 Pro Omni. Type natural-language commands; Claude drives
the robot via tools.

```
you> clean the kitchen and living room
claude> Started cleaning: kitchen, living room.

you> go home and resume cleaning at 3pm tomorrow
claude> Heading home now. Scheduled 'Resume' for 2026-05-25T15:00:00 (job id: 4f2a1c).
```

## Architecture

```
You (chat)
   ↓
Claude  (picks tools)
   ↓
Our Python  (calls HA over HTTP)
   ↓
Home Assistant  (eufy-clean integration)
   ↓
Eufy cloud → Your X10
```

- `robot.py` — HTTP client for Home Assistant's REST API
- `tools.py` — JSON-schema tool definitions + dispatch table for Claude
- `agent.py` — manual tool-use loop against the Anthropic API
- `scheduler.py` — APScheduler (asyncio) for one-shot and cron jobs
- `dance.py` — fake dance routine (X10 has no native dance mode)
- `main.py` — CLI

## Prerequisites

You need:

1. **A running Home Assistant instance** with the [Eufy Robovac MQTT](https://github.com/jeppesens/eufy-clean) integration installed and connected to your Eufy account. The vacuum should be visible and controllable from the HA UI before this project will work.
2. **A Long-Lived Access Token** from HA (Profile → Security → Long-lived access tokens → Create token).
3. **Your vacuum's entity ID** (HA → Developer Tools → States → filter `vacuum.` → copy the ID, e.g. `vacuum.eufy_tj_home`).
4. **An Anthropic API key** (`console.anthropic.com` → API Keys).

## Run locally

```sh
git clone https://github.com/Bfinnz41/tan_test.git
cd tan_test
git checkout claude/eufy-x10-robotics-HZzXN
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # fill in the values above
python -m eufy_llm.main
```

## Caveats

- **HA must be reachable.** If `HA_URL` is `http://localhost:8123`, the Python script has to run on the same machine as HA. For remote access, replace with the LAN IP and port, or use Nabu Casa Cloud.
- **Room cleaning** requires that you've set up the map and named rooms in the Eufy mobile app. The integration exposes them as a `select.<vacuum>_clean_room` entity.
- **Dance mode is fake.** The X10 has no native dance mode, and HA doesn't expose joystick control; the fallback is a play/pause shuffle.
- **Scheduled jobs die with the script.** If you close Terminal, the scheduler stops. For 24/7 scheduling, run on an always-on host (Raspberry Pi, NAS, etc.) and use `nohup` or systemd.
- **Costs.** Each conversation turn is one or more Anthropic API calls. Sonnet 4.6 (`claude-sonnet-4-6`) is ~10× cheaper than Opus and plenty smart for vacuum commands.

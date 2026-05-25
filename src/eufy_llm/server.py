"""HTTP server that exposes the chat agent over the LAN.

Used by the iOS Shortcut. POST /chat with {"message": "..."} returns
{"reply": "..."}.

Run with: python -m eufy_llm.server

Listens on 0.0.0.0:8000 so other devices on your home network can reach it.
Prints the Mac's LAN IP at startup so you know what to point the Shortcut at.

Security note: no auth. Anyone on your home wifi can POST to /chat and
command the vacuum. Fine for a home network; do not expose to the internet
without adding auth.
"""

from __future__ import annotations

import asyncio
import os
import socket
import sys
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import time

from fastapi import Header

from . import spotify, stuck_watcher
from .agent import RobotAgent
from .bedroom_watch import run_bedroom_check
from .dance import SEPTEMBER_ROUTINE, WELCOME_ROUTINE, run_routine
from .robot import Robot
from .scheduler import RobotScheduler

GREET_COOLDOWN_S = 600  # 10 min between welcome-dance triggers

_state: dict = {}


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    reply: str


def _require(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        sys.exit(f"Missing required env var: {name}. See .env.example.")
    return val


def _lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_dotenv()
    _require("ANTHROPIC_API_KEY")
    model = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-7")
    robot = Robot(
        ha_url=_require("HA_URL"),
        ha_token=_require("HA_TOKEN"),
        vacuum_entity=_require("HA_VACUUM_ENTITY"),
    )
    scheduler = RobotScheduler()
    scheduler.start()
    try:
        await robot.connect()
    except Exception as e:
        sys.exit(f"HA connection failed: {type(e).__name__}: {e}")
    _state["agent"] = RobotAgent(model=model, robot=robot, scheduler=scheduler)
    _state["robot"] = robot
    _state["scheduler"] = scheduler
    _state["stuck_task"] = asyncio.create_task(stuck_watcher.watch(robot))

    ip = _lan_ip()
    print("\n  ──────────────────────────────────────────────")
    print("  Eufy voice-agent server is running.")
    print(f"  Point your iPhone Shortcut at:  http://{ip}:8000/chat")
    print("  Health check (browser):         http://localhost:8000/health")
    print("  Stuck-watcher:                  running in background")
    print("  ──────────────────────────────────────────────\n")

    yield

    _state["stuck_task"].cancel()
    try:
        await _state["stuck_task"]
    except asyncio.CancelledError:
        pass
    _state["scheduler"].shutdown()
    await _state["robot"].close()


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    agent: RobotAgent | None = _state.get("agent")
    if agent is None:
        raise HTTPException(503, "Agent not initialized")
    try:
        reply = await agent.chat(req.message)
    except Exception as e:
        raise HTTPException(500, f"{type(e).__name__}: {e}")
    return ChatResponse(reply=reply)


@app.post("/greet")
async def greet(authorization: str | None = Header(default=None)):
    """Triggered by the iPhone 'When I Arrive Home' Personal Automation.

    Requires header `Authorization: Bearer <GREET_TOKEN>` matching the
    GREET_TOKEN env var. Cooldown prevents multiple firings within 10 min.
    """
    expected = os.environ.get("GREET_TOKEN", "").strip()
    if not expected:
        raise HTTPException(503, "GREET_TOKEN not configured on the server")
    if authorization != f"Bearer {expected}":
        raise HTTPException(401, "Invalid or missing token")

    now = time.monotonic()
    last = _state.get("last_greet_at", 0.0)
    if now - last < GREET_COOLDOWN_S:
        wait = int(GREET_COOLDOWN_S - (now - last))
        return {"skipped": True, "reason": f"cooldown ({wait}s remaining)"}
    _state["last_greet_at"] = now

    robot: Robot | None = _state.get("robot")
    if robot is None:
        raise HTTPException(503, "Robot not initialized")

    async def _go() -> None:
        try:
            print("[greet] welcome dance starting")
            await run_routine(robot, WELCOME_ROUTINE)
            print("[greet] welcome dance complete")
        except Exception as e:
            print(f"[greet error] {type(e).__name__}: {e}")

    asyncio.create_task(_go())
    return {"started": True, "routine": "welcome"}


@app.post("/check/bedroom")
async def check_bedroom():
    """Run the bedroom anomaly check immediately. Blocks until the clean
    finishes — can take several minutes. Useful for ad-hoc testing."""
    robot: Robot | None = _state.get("robot")
    if robot is None:
        raise HTTPException(503, "Robot not initialized")
    summary = await run_bedroom_check(robot)
    return {"summary": summary}


@app.post("/dance/september")
async def dance_september():
    """Trigger the September routine.

    Plays the song on Spotify (Mac desktop app) and runs the choreography
    in sync. Returns immediately while the routine runs in the background.
    """
    robot: Robot | None = _state.get("robot")
    if robot is None:
        raise HTTPException(503, "Robot not initialized")

    async def _go() -> None:
        try:
            await spotify.play_track(spotify.SEPTEMBER_URI)
            offset = await spotify.wait_for_playback(timeout=8.0)
            print(f"[dance] Spotify reports playing at t={offset:.3f}s")
            await run_routine(robot, SEPTEMBER_ROUTINE, offset=offset)
            print("[dance] Routine complete.")
        except Exception as e:
            print(f"[dance error] {type(e).__name__}: {e}")

    asyncio.create_task(_go())
    return {"started": True, "routine": "september"}


def main() -> None:
    import uvicorn

    uvicorn.run("eufy_llm.server:app", host="0.0.0.0", port=8000, log_level="info")


if __name__ == "__main__":
    main()

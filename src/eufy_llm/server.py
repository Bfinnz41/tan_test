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

import os
import socket
import sys
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .agent import RobotAgent
from .robot import Robot
from .scheduler import RobotScheduler

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

    ip = _lan_ip()
    print("\n  ──────────────────────────────────────────────")
    print("  Eufy voice-agent server is running.")
    print(f"  Point your iPhone Shortcut at:  http://{ip}:8000/chat")
    print("  Health check (browser):         http://localhost:8000/health")
    print("  ──────────────────────────────────────────────\n")

    yield

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


def main() -> None:
    import uvicorn

    uvicorn.run("eufy_llm.server:app", host="0.0.0.0", port=8000, log_level="info")


if __name__ == "__main__":
    main()

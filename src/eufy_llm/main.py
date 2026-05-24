"""Interactive CLI: type natural-language commands, Claude drives the robot."""

from __future__ import annotations

import asyncio
import os
import sys

from dotenv import load_dotenv

from .agent import RobotAgent
from .robot import Robot
from .scheduler import RobotScheduler


def _require(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        sys.exit(f"Missing required env var: {name}. See .env.example.")
    return val


async def amain() -> None:
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

    print(f"Connecting to Home Assistant at {os.environ['HA_URL']}...")
    try:
        await robot.connect()
    except Exception as e:
        sys.exit(f"HA connection failed: {type(e).__name__}: {e}")
    print("Connected. Type a command (or 'quit').\n")

    agent = RobotAgent(model=model, robot=robot, scheduler=scheduler)

    try:
        while True:
            try:
                msg = await asyncio.to_thread(input, "you> ")
            except EOFError:
                break
            msg = msg.strip()
            if not msg:
                continue
            if msg.lower() in {"quit", "exit"}:
                break
            try:
                reply = await agent.chat(msg)
            except Exception as e:
                print(f"[error] {type(e).__name__}: {e}")
                continue
            print(f"claude> {reply}\n")
    finally:
        scheduler.shutdown()
        await robot.close()


def main() -> None:
    try:
        asyncio.run(amain())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

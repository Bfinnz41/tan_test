"""Claude-driven agent loop.

Manual tool-use loop (not the SDK runner) for explicit control flow. Each user turn:
1. Append user message to history.
2. Call the model.
3. If it asked for tools, execute them and append results.
4. Repeat until stop_reason != "tool_use".
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from anthropic import AsyncAnthropic

from .robot import Robot
from .scheduler import RobotScheduler
from .tools import build_tools


SYSTEM_PROMPT = """\
You control a Eufy X10 Pro Omni robot vacuum via tools. The user will give you
natural-language commands like "clean the kitchen", "go home", "resume cleaning
at 3pm", or "dance".

Guidelines:
- Call list_rooms first if you're unsure of an exact room name.
- For scheduling, convert relative times ("in 10 minutes", "tomorrow at 3pm")
  into ISO 8601 before calling schedule_at. The current time is in each turn.
- Confirm what you did in one short sentence. Don't narrate every tool call.
- If a tool errors, explain plainly and suggest a fix.

Choreographing dances:
- The X10 has no joystick. The only movement primitive is `pulse(duration_s)` —
  the robot lurches forward briefly, then pauses. Use `wait(seconds)` between
  pulses to set the rhythm.
- For a bare "dance" request with no details, call the `dance` tool (canned
  default routine) — that's also what gets used for scheduled dances.
- For ANY custom or descriptive dance, compose pulse + wait calls yourself:
  - "fast / quick / snappy"   → short pulses (0.3-0.5s), short waits (0.2-0.3s)
  - "slow / lazy / chill"     → longer pulses (1-2s), longer waits (0.6-1.2s)
  - "shimmy N times"          → N short pulses (0.4s) with very short waits (0.2s)
  - "30-second dance"         → fill the duration; budget your pulses and waits
  - "do a routine to a beat"  → consistent rhythm of pulse+wait pairs
- Limits per call: pulse <= 5s, wait <= 30s. Compose more calls if you need more.
- End custom routines with `return_to_dock` unless the user says otherwise.
- If the user asks for "spin", "back and forth", or "left/right", explain you
  can only pulse forward — and offer a routine that approximates the vibe with
  pulses and waits (e.g. very short pulses for a stutter).
"""


class RobotAgent:
    def __init__(self, model: str, robot: Robot, scheduler: RobotScheduler):
        self._client = AsyncAnthropic()
        self._model = model
        self._tool_defs, self._dispatch = build_tools(robot, scheduler)
        self._history: list[dict[str, Any]] = []

    async def chat(self, user_message: str) -> str:
        now = datetime.now().isoformat(timespec="seconds")
        self._history.append(
            {"role": "user", "content": f"[current time: {now}]\n\n{user_message}"}
        )

        final_text: list[str] = []
        while True:
            response = await self._client.messages.create(
                model=self._model,
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                tools=self._tool_defs,
                messages=self._history,
            )
            self._history.append({"role": "assistant", "content": response.content})

            for block in response.content:
                if block.type == "text" and block.text:
                    final_text.append(block.text)

            if response.stop_reason != "tool_use":
                break

            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    output = await self._dispatch(block.name, block.input)
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": output,
                        }
                    )
            self._history.append({"role": "user", "content": tool_results})

        return "\n".join(final_text).strip() or "(no response)"

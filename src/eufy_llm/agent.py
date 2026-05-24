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

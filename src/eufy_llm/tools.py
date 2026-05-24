"""Tool definitions and dispatch for the agent loop.

Returns:
- `tool_defs`: list of JSON-schema tool definitions to pass to Claude.
- `dispatch`: async callable `(name, args) -> str` that executes a tool by name.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Awaitable, Callable

from .dance import dance as dance_routine
from .robot import Robot
from .scheduler import RobotScheduler


def _parse_when(when: str) -> datetime:
    when = when.strip()
    try:
        return datetime.fromisoformat(when)
    except ValueError:
        pass
    try:
        t = datetime.strptime(when, "%H:%M").time()
    except ValueError as e:
        raise ValueError(
            f"Could not parse time {when!r}. Use ISO 8601 (2026-05-24T15:00:00) "
            f"or 24h HH:MM (15:00)."
        ) from e
    now = datetime.now()
    candidate = now.replace(hour=t.hour, minute=t.minute, second=0, microsecond=0)
    if candidate <= now:
        candidate += timedelta(days=1)
    return candidate


def _resolve_rooms(rooms: list[Any], wanted: list[str]) -> list[str]:
    by_name = {r.name.lower(): r.id for r in rooms}
    by_id = {r.id: r.id for r in rooms}
    resolved: list[str] = []
    missing: list[str] = []
    for w in wanted:
        rid = by_name.get(w.lower()) or by_id.get(w)
        if rid is None:
            missing.append(w)
        else:
            resolved.append(rid)
    if missing:
        available = ", ".join(r.name for r in rooms) or "(none mapped)"
        raise ValueError(f"Unknown rooms: {missing}. Available: {available}")
    return resolved


def build_tools(
    robot: Robot, scheduler: RobotScheduler
) -> tuple[list[dict], Callable[[str, dict], Awaitable[str]]]:
    async def get_status(_: dict) -> str:
        s = await robot.status()
        return f"battery={s['battery']}, work_status={s['work_status']}, raw={s['raw']}"

    async def list_rooms(_: dict) -> str:
        rooms = await robot.list_rooms()
        if not rooms:
            return "No rooms mapped. Set up rooms in the Eufy mobile app first."
        return "\n".join(f"- {r.name} (id={r.id})" for r in rooms)

    async def clean_rooms(args: dict) -> str:
        rooms = await robot.list_rooms()
        room_ids = _resolve_rooms(rooms, args["room_names"])
        await robot.clean_rooms(room_ids)
        return f"Started cleaning: {', '.join(args['room_names'])}"

    async def clean_whole_house(_: dict) -> str:
        await robot.start_cleaning()
        return "Started whole-house cleaning."

    async def pause_cleaning(_: dict) -> str:
        await robot.pause()
        return "Paused."

    async def resume_cleaning(_: dict) -> str:
        await robot.resume()
        return "Resumed."

    async def return_to_dock(_: dict) -> str:
        await robot.return_to_dock()
        return "Heading home to dock."

    async def dance(_: dict) -> str:
        return await dance_routine(robot)

    async def schedule_at(args: dict) -> str:
        run_at = _parse_when(args["when"])
        action = args["action"].strip().lower()
        room_names = args.get("room_names") or []

        async def do_clean_house() -> None:
            await robot.start_cleaning()

        async def do_clean_rooms() -> None:
            rooms = await robot.list_rooms()
            ids = _resolve_rooms(rooms, room_names)
            await robot.clean_rooms(ids)

        actions = {
            "clean_whole_house": (do_clean_house, "Clean whole house"),
            "clean_rooms": (do_clean_rooms, f"Clean rooms: {room_names}"),
            "return_to_dock": (robot.return_to_dock, "Return to dock"),
            "pause": (robot.pause, "Pause"),
            "resume": (robot.resume, "Resume"),
            "dance": (lambda: dance_routine(robot), "Dance"),
        }
        if action not in actions:
            return f"Unknown action {action!r}. Valid: {list(actions)}"
        if action == "clean_rooms" and not room_names:
            return "clean_rooms requires room_names."

        fn, label = actions[action]
        job = scheduler.schedule_once(run_at, fn, label)
        return f"Scheduled '{label}' for {job.next_run} (job id: {job.id})."

    async def list_schedule(_: dict) -> str:
        jobs = scheduler.list_jobs()
        if not jobs:
            return "Nothing scheduled."
        return "\n".join(f"[{j.id}] {j.description} @ {j.next_run}" for j in jobs)

    async def cancel_schedule(args: dict) -> str:
        return (
            f"Cancelled job {args['job_id']}."
            if scheduler.cancel(args["job_id"])
            else f"No job {args['job_id']}."
        )

    dispatch_map: dict[str, Callable[[dict], Awaitable[str]]] = {
        "get_status": get_status,
        "list_rooms": list_rooms,
        "clean_rooms": clean_rooms,
        "clean_whole_house": clean_whole_house,
        "pause_cleaning": pause_cleaning,
        "resume_cleaning": resume_cleaning,
        "return_to_dock": return_to_dock,
        "dance": dance,
        "schedule_at": schedule_at,
        "list_schedule": list_schedule,
        "cancel_schedule": cancel_schedule,
    }

    tool_defs: list[dict] = [
        {
            "name": "get_status",
            "description": "Get the robot's current state: battery level, what it's doing, dock status.",
            "input_schema": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "list_rooms",
            "description": "List rooms the Eufy app has mapped. Use this before cleaning specific rooms by name.",
            "input_schema": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "clean_rooms",
            "description": "Clean specific rooms by name. Names are matched case-insensitively against the room list.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "room_names": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Room names, e.g. ['kitchen', 'living room']",
                    }
                },
                "required": ["room_names"],
            },
        },
        {
            "name": "clean_whole_house",
            "description": "Start a full-house auto clean.",
            "input_schema": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "pause_cleaning",
            "description": "Pause the current cleaning job. Robot stays put.",
            "input_schema": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "resume_cleaning",
            "description": "Resume a paused cleaning job.",
            "input_schema": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "return_to_dock",
            "description": "Send the robot back to its charging dock.",
            "input_schema": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "dance",
            "description": "Make the robot perform a silly dance routine. Best effort — the X10 has no native dance mode.",
            "input_schema": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "schedule_at",
            "description": (
                "Schedule a one-shot action at a future time. Convert relative times like "
                "'in 10 minutes' or 'tomorrow at 3pm' to an ISO 8601 datetime using the "
                "current time provided in the user message."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "when": {
                        "type": "string",
                        "description": "ISO 8601 datetime (2026-05-24T15:00:00) or HH:MM (today/tomorrow, next occurrence).",
                    },
                    "action": {
                        "type": "string",
                        "enum": [
                            "clean_whole_house",
                            "clean_rooms",
                            "return_to_dock",
                            "pause",
                            "resume",
                            "dance",
                        ],
                    },
                    "room_names": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Required when action is clean_rooms.",
                    },
                },
                "required": ["when", "action"],
            },
        },
        {
            "name": "list_schedule",
            "description": "List all scheduled jobs (job id, what, when).",
            "input_schema": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "cancel_schedule",
            "description": "Cancel a scheduled job by its id (from list_schedule).",
            "input_schema": {
                "type": "object",
                "properties": {"job_id": {"type": "string"}},
                "required": ["job_id"],
            },
        },
    ]

    async def dispatch(name: str, args: dict) -> str:
        fn = dispatch_map.get(name)
        if fn is None:
            return f"Unknown tool: {name}"
        try:
            return await fn(args or {})
        except Exception as e:
            return f"ERROR: {type(e).__name__}: {e}"

    return tool_defs, dispatch

"""Tool definitions and dispatch for the agent loop.

Returns:
- `tool_defs`: list of JSON-schema tool definitions to pass to Claude.
- `dispatch`: async callable `(name, args) -> str` that executes a tool by name.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from typing import Any, Awaitable, Callable

from . import spotify
from .bedroom_watch import run_bedroom_check
from .dance import (
    SEPTEMBER_ROUTINE,
    dance as dance_routine,
    run_routine,
    run_welcome_dance,
)
from .notifications import notify_husband
from .robot import Robot
from .scheduler import RobotScheduler

PULSE_MAX_S = 5.0
SPIN_MAX_S = 5.0
WAIT_MAX_S = 30.0

_SONG_LIBRARY: dict[str, tuple[str, list]] = {
    "september": (spotify.SEPTEMBER_URI, SEPTEMBER_ROUTINE),
}


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


def _build_action(
    action: str,
    room_names: list[str],
    robot: Robot,
    scheduler: RobotScheduler,
) -> tuple[Callable[[], Awaitable[Any]] | None, str]:
    """Resolve a scheduled action name to a callable + label.

    Returns (None, error_message) if the action is invalid. Shared by both
    one-shot (schedule_at) and recurring (schedule_daily) scheduling tools.
    """
    async def do_clean_house() -> None:
        await robot.start_cleaning()

    async def do_clean_rooms() -> None:
        rooms = await robot.list_rooms()
        ids = _resolve_rooms(rooms, room_names)
        await robot.clean_rooms(ids)

    async def do_check_bedroom() -> None:
        summary = await run_bedroom_check(robot)
        print(f"[bedroom-check] {summary}")

    actions: dict[str, tuple[Callable[[], Awaitable[Any]], str]] = {
        "clean_whole_house": (do_clean_house, "Clean whole house"),
        "clean_rooms": (do_clean_rooms, f"Clean rooms: {room_names}"),
        "return_to_dock": (robot.return_to_dock, "Return to dock"),
        "pause": (robot.pause, "Pause"),
        "resume": (robot.resume, "Resume"),
        "dance": (lambda: dance_routine(robot), "Dance"),
        "check_bedroom": (do_check_bedroom, "Bedroom anomaly check"),
    }
    if action not in actions:
        return None, f"Unknown action {action!r}. Valid: {list(actions)}"
    if action == "clean_rooms" and not room_names:
        return None, "clean_rooms requires room_names."
    fn, label = actions[action]
    return fn, label


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

    async def pulse(args: dict) -> str:
        duration = float(args["duration_s"])
        if duration <= 0 or duration > PULSE_MAX_S:
            return f"Refused: pulse duration must be between 0 and {PULSE_MAX_S}s."
        await robot.start_cleaning()
        try:
            await asyncio.sleep(duration)
        finally:
            await robot.pause()
        return f"Pulsed forward for {duration}s."

    async def spin(args: dict) -> str:
        duration = float(args["duration_s"])
        if duration <= 0 or duration > SPIN_MAX_S:
            return f"Refused: spin duration must be between 0 and {SPIN_MAX_S}s."
        await robot.spot_clean()
        try:
            await asyncio.sleep(duration)
        finally:
            await robot.pause()
        return f"Spun in place for {duration}s."

    async def beep(_: dict) -> str:
        await robot.locate()
        return "Beeped."

    async def text_husband(args: dict) -> str:
        message = args["message"].strip()
        if not message:
            return "Refused: message is empty."
        sent = await notify_husband(message)
        if sent:
            return f"Sent iMessage: {message!r}"
        return (
            "Couldn't send. Either HUSBAND_IMESSAGE_HANDLE isn't set in .env, "
            "or macOS hasn't granted Messages permission yet. Check the server "
            "terminal for the exact reason."
        )

    async def check_bedroom_now(_: dict) -> str:
        # Fires off the bedroom-anomaly check in the background so the
        # voice/chat response can return immediately (the clean takes minutes).
        async def _go() -> None:
            try:
                summary = await run_bedroom_check(robot)
                print(f"[bedroom-check] {summary}")
            except Exception as e:
                print(f"[bedroom-check error] {type(e).__name__}: {e}")

        asyncio.create_task(_go())
        return "Started bedroom check. I'll text if it looks like clothes are on the floor."

    async def welcome_dance(_: dict) -> str:
        async def _go() -> None:
            try:
                summary = await run_welcome_dance(robot)
                print(f"[welcome] {summary}")
            except Exception as e:
                print(f"[welcome error] {type(e).__name__}: {e}")

        asyncio.create_task(_go())
        return "Driving to the entryway and dancing."

    async def dance_to_song(args: dict) -> str:
        song = args["song"].lower().strip()
        entry = _SONG_LIBRARY.get(song)
        if entry is None:
            available = ", ".join(_SONG_LIBRARY) or "(none)"
            return f"No routine for {song!r}. Available: {available}."
        uri, routine = entry

        async def _go() -> None:
            try:
                await spotify.play_track(uri)
                offset = await spotify.wait_for_playback(timeout=8.0)
                print(f"[dance] Spotify reports playing at t={offset:.3f}s")
                await run_routine(robot, routine, offset=offset)
                print("[dance] Routine complete.")
            except Exception as e:
                print(f"[dance error] {type(e).__name__}: {e}")

        asyncio.create_task(_go())
        return f"Starting {song} routine. Playing on Spotify now."

    async def wait(args: dict) -> str:
        seconds = float(args["seconds"])
        if seconds <= 0 or seconds > WAIT_MAX_S:
            return f"Refused: wait must be between 0 and {WAIT_MAX_S}s."
        await asyncio.sleep(seconds)
        return f"Waited {seconds}s."

    async def schedule_at(args: dict) -> str:
        run_at = _parse_when(args["when"])
        action = args["action"].strip().lower()
        room_names = args.get("room_names") or []

        fn, label = _build_action(action, room_names, robot, scheduler)
        if fn is None:
            return label
        job = scheduler.schedule_once(run_at, fn, label)
        return f"Scheduled '{label}' for {job.next_run} (job id: {job.id})."

    async def schedule_daily(args: dict) -> str:
        # Parse "HH:MM" 24h format.
        time_str = args["time"].strip()
        try:
            t = datetime.strptime(time_str, "%H:%M").time()
        except ValueError:
            return f"Could not parse time {time_str!r}. Use 24h HH:MM (e.g. '20:00')."
        action = args["action"].strip().lower()
        room_names = args.get("room_names") or []

        fn, label = _build_action(action, room_names, robot, scheduler)
        if fn is None:
            return label
        cron_expr = f"{t.minute} {t.hour} * * *"
        job = scheduler.schedule_cron(cron_expr, fn, f"Daily @ {time_str}: {label}")
        return (
            f"Scheduled '{label}' every day at {time_str} (next run: {job.next_run}, "
            f"job id: {job.id})."
        )

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
        "pulse": pulse,
        "spin": spin,
        "beep": beep,
        "dance_to_song": dance_to_song,
        "welcome_dance": welcome_dance,
        "check_bedroom_now": check_bedroom_now,
        "text_husband": text_husband,
        "wait": wait,
        "schedule_at": schedule_at,
        "schedule_daily": schedule_daily,
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
            "description": (
                "Run the default canned dance routine (a few short pulses then dock). "
                "Use this ONLY when the user says 'dance' with no further specification "
                "OR when scheduling a dance for later. For any custom or descriptive dance "
                "('quick', 'long', 'shimmy 5 times', 'slow rhythm', etc.) compose your own "
                "routine using pulse + wait instead."
            ),
            "input_schema": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "pulse",
            "description": (
                "Make the robot scoot forward briefly: start cleaning, wait duration_s seconds, "
                "then pause. The robot picks its own direction. Typical scoot: 0.3-2.0s. "
                "Use as the 'forward' move in custom dance routines."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "duration_s": {
                        "type": "number",
                        "description": f"How long to scoot forward, in seconds. 0-{PULSE_MAX_S}.",
                    }
                },
                "required": ["duration_s"],
            },
        },
        {
            "name": "spin",
            "description": (
                "Make the robot spin/spiral in place for duration_s seconds, then pause. "
                "Uses the X10's spot-clean mode under the hood. Typical spin: 1.5-3.0s. "
                "Use as the 'rotation' move in custom dance routines."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "duration_s": {
                        "type": "number",
                        "description": f"How long to spin in place, in seconds. 0-{SPIN_MAX_S}.",
                    }
                },
                "required": ["duration_s"],
            },
        },
        {
            "name": "beep",
            "description": (
                "Make the robot play its 'locate' sound effect. A short audible chirp. "
                "Use as punctuation in dance routines or to find the robot."
            ),
            "input_schema": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "text_husband",
            "description": (
                "Send an iMessage to the configured husband handle. Use when the user "
                "asks to 'text my husband', 'send my husband a message', 'let my husband "
                "know X', etc. You write the message body yourself based on what the "
                "user wants to convey — keep it natural and concise. Robot-related "
                "context (battery, what it's doing, etc.) is fair game — call get_status "
                "first if the user wants a status update sent."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "The message body to send.",
                    }
                },
                "required": ["message"],
            },
        },
        {
            "name": "check_bedroom_now",
            "description": (
                "Run the bedroom-clutter anomaly check immediately. Starts a "
                "bedroom-only clean, times it, compares to the rolling baseline, "
                "and iMessages the configured handle if it's significantly longer "
                "than usual (suggesting clothes/clutter on the floor). Use when the "
                "user says things like 'check the bedroom', 'is the bedroom messy', "
                "'see if there are clothes on the floor', etc. Returns immediately "
                "while the clean runs in the background."
            ),
            "input_schema": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "welcome_dance",
            "description": (
                "Run the short ~8-second welcome-home routine (beeps + spins + dock). "
                "Use when the user says 'greet me', 'welcome me home', 'say hi', or "
                "wants to test the GPS welcome routine. Runs in the background and "
                "returns immediately. Robot doesn't relocate — it dances where it is."
            ),
            "input_schema": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "dance_to_song",
            "description": (
                "Trigger a pre-choreographed dance routine timed to a specific song. "
                "Plays the song on Spotify (Mac desktop app) and runs the routine in sync. "
                "Returns immediately while the routine runs in the background. "
                "Currently choreographed: 'september'."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "song": {
                        "type": "string",
                        "description": "Song name. Currently supported: 'september'.",
                    }
                },
                "required": ["song"],
            },
        },
        {
            "name": "wait",
            "description": (
                "Sleep for `seconds` seconds without commanding the robot. Use between pulses "
                "to set the rhythm of a dance routine, or to space out other actions."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "seconds": {
                        "type": "number",
                        "description": f"How long to wait, in seconds. 0-{WAIT_MAX_S}.",
                    }
                },
                "required": ["seconds"],
            },
        },
        {
            "name": "schedule_at",
            "description": (
                "Schedule a ONE-SHOT action at a future time (fires exactly once). "
                "Convert relative times like 'in 10 minutes' or 'tomorrow at 3pm' to "
                "an ISO 8601 datetime using the current time provided in the user message. "
                "For recurring schedules, use schedule_daily instead."
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
                            "check_bedroom",
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
            "name": "schedule_daily",
            "description": (
                "Schedule a RECURRING action that fires every day at the given time. "
                "Use for requests like 'check the bedroom every day at 8pm', 'dance every "
                "morning at 9am', etc. Time must be 24-hour HH:MM format — convert any "
                "12-hour or natural-language time to that before calling."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "time": {
                        "type": "string",
                        "description": "24-hour HH:MM, e.g. '20:00' for 8pm, '07:30' for 7:30am.",
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
                            "check_bedroom",
                        ],
                    },
                    "room_names": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Required when action is clean_rooms.",
                    },
                },
                "required": ["time", "action"],
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

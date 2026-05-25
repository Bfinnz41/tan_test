"""Dance routines for the Eufy X10.

Two layers:
- `dance()` — the simple canned routine triggered by a bare "dance" voice
  command. Kept for backwards-compat with the existing chat tools.
- `run_routine()` — the choreography engine. Takes a list of `RoutineStep`s
  with absolute time offsets and executes them in order. Used for the
  song-synced dance routines (e.g. SEPTEMBER_ROUTINE).

Movement vocabulary (all confirmed working on the X10 via Home Assistant):
- "scoot" — start cleaning briefly then pause. Robot lurches forward.
- "spin"  — spot_clean briefly then pause. Robot spirals in place.
- "beep"  — play the locate sound effect.
- "pause" — stop in place.
- "dock"  — return to dock (dramatic exit).
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass

from .robot import Robot


@dataclass(frozen=True)
class RoutineStep:
    """One choreographed beat in a dance routine.

    `t` is seconds from the start of the routine. The engine schedules each
    step to fire at its `t`, then executes the action (which itself takes
    `param` seconds for scoot/spin). Steps should not overlap — the next
    step's `t` should be >= prev step's `t + duration`.
    """

    t: float
    action: str           # "scoot" | "spin" | "beep" | "pause" | "dock"
    param: float = 0.0    # duration in seconds for scoot/spin; ignored otherwise


async def _execute_step(robot: Robot, step: RoutineStep) -> None:
    if step.action == "scoot":
        duration = step.param or 0.5
        await robot.start_cleaning()
        await asyncio.sleep(duration)
        await robot.pause()
    elif step.action == "spin":
        duration = step.param or 2.0
        await robot.spot_clean()
        await asyncio.sleep(duration)
        await robot.pause()
    elif step.action == "beep":
        await robot.locate()
    elif step.action == "pause":
        await robot.pause()
    elif step.action == "dock":
        await robot.return_to_dock()
    else:
        raise ValueError(f"Unknown dance action: {step.action!r}")


async def run_routine(
    robot: Robot,
    steps: list[RoutineStep],
    *,
    offset: float = 0.0,
    log: bool = True,
) -> None:
    """Execute a routine, blocking until done.

    `offset` lets you skip ahead — e.g. if Spotify reports playback started
    at 0.3s into the track, pass offset=0.3 so the first scheduled step
    fires correctly relative to the audio.
    """
    start = time.monotonic() - offset
    for step in steps:
        now = time.monotonic()
        target = start + step.t
        if target > now:
            await asyncio.sleep(target - now)
        if log:
            elapsed = time.monotonic() - start
            print(f"  [+{elapsed:5.2f}s] {step.action:>5} {step.param or ''}")
        try:
            await _execute_step(robot, step)
        except Exception as e:
            # Don't kill the whole routine if one step fails — keep dancing.
            print(f"  [step error] {step.action}: {type(e).__name__}: {e}")


# ---------------------------------------------------------------------------
# September choreography (Earth, Wind & Fire, 126 BPM, ~1.9s per bar)
#
# Structure (approx, from track start):
#   0:00  intro horn riff (8 bars)
#   0:08  verse 1 starts ("Do you remember...")
#   0:32  verse continues
#   0:48  pre-chorus / "Our hearts were ringing..."
#   1:04  CHORUS DROP — "Ba-de-ya, say do you remember..."
#   1:20  dock with dignity
# ---------------------------------------------------------------------------

SEPTEMBER_ROUTINE: list[RoutineStep] = [
    # 0:00–0:08 — Intro horn riff. Robot wakes up.
    RoutineStep(0.5, "beep"),
    RoutineStep(2.0, "spin", 2.5),

    # 0:08–0:32 — Verse 1, mostly downbeat scoots.
    RoutineStep(8.5, "scoot", 0.5),
    RoutineStep(10.5, "scoot", 0.5),
    RoutineStep(12.5, "scoot", 0.4),
    RoutineStep(14.5, "spin", 1.5),
    RoutineStep(17.5, "scoot", 0.5),
    RoutineStep(20.0, "scoot", 0.5),
    RoutineStep(22.5, "scoot", 0.5),
    RoutineStep(25.0, "spin", 2.0),
    RoutineStep(28.5, "scoot", 0.4),
    RoutineStep(30.5, "scoot", 0.4),

    # 0:32–0:48 — Verse continues, build energy.
    RoutineStep(32.5, "spin", 2.0),
    RoutineStep(35.5, "scoot", 0.5),
    RoutineStep(37.5, "scoot", 0.5),
    RoutineStep(39.5, "scoot", 0.5),
    RoutineStep(41.5, "spin", 1.5),
    RoutineStep(44.0, "scoot", 0.4),
    RoutineStep(45.5, "scoot", 0.4),
    RoutineStep(47.0, "scoot", 0.4),

    # 0:48–1:04 — Pre-chorus "Our hearts were ringing..."
    RoutineStep(48.5, "spin", 2.0),
    RoutineStep(51.5, "scoot", 0.5),
    RoutineStep(53.5, "scoot", 0.5),
    RoutineStep(55.5, "spin", 1.5),
    RoutineStep(58.0, "scoot", 0.4),
    RoutineStep(59.5, "scoot", 0.4),
    RoutineStep(61.0, "scoot", 0.3),
    RoutineStep(62.5, "beep"),

    # 1:04 — CHORUS DROP. Maximum effort.
    RoutineStep(64.0, "spin", 2.5),
    RoutineStep(67.5, "scoot", 0.4),    # "Ba-de-ya"
    RoutineStep(69.0, "scoot", 0.4),
    RoutineStep(70.5, "scoot", 0.4),
    RoutineStep(72.5, "spin", 2.0),
    RoutineStep(75.0, "beep"),
    RoutineStep(76.5, "scoot", 0.4),    # "Ba-de-ya"
    RoutineStep(78.0, "scoot", 0.4),
    RoutineStep(79.5, "scoot", 0.4),

    # Big finish + dock.
    RoutineStep(81.5, "spin", 2.5),
    RoutineStep(85.0, "beep"),
    RoutineStep(86.0, "dock"),
]


# ---------------------------------------------------------------------------
# Welcome routine — triggered when the iPhone's "When I Arrive Home"
# automation hits /greet. Drives to the entryway first, then dances there
# before docking. Falls back to dance-in-place if the entryway room isn't
# found in the Eufy map.
# ---------------------------------------------------------------------------

# Just the dance bit (no nav, no dock) — used when we drive there first.
WELCOME_DANCE_BODY: list[RoutineStep] = [
    RoutineStep(0.0, "beep"),
    RoutineStep(0.6, "beep"),
    RoutineStep(1.5, "spin", 2.5),
    RoutineStep(4.5, "beep"),
    RoutineStep(5.0, "spin", 1.5),
]

# Full routine including dock — used as fallback when entryway isn't mapped.
WELCOME_ROUTINE: list[RoutineStep] = WELCOME_DANCE_BODY + [
    RoutineStep(7.5, "dock"),
]


async def run_welcome_dance(robot: Robot) -> str:
    """Drive to the entryway room, dance there, then dock.

    Also starts Spotify playback on the configured Echo device (via Spotify
    Web API), timed to begin a few seconds before the dance so music is
    audible when the robot arrives.

    Configured via env vars:
      ENTRYWAY_ROOM_NAME            — room name in your Eufy map (default 'Entryway')
      WELCOME_TRAVEL_DELAY_SECONDS  — wait time for the robot to arrive (default 60)
      MUSIC_LEAD_SECONDS            — seconds before the dance to start music (default 5)
      ECHO_DEVICE_NAME              — your Echo's Spotify Connect name (optional)
      SPOTIFY_CLIENT_ID/SECRET      — for the Web API (optional)

    Music silently skipped if Spotify isn't configured.

    Returns a short status string describing what happened.
    """
    import os

    room_name = os.environ.get("ENTRYWAY_ROOM_NAME", "Entryway").strip()
    travel_s = float(os.environ.get("WELCOME_TRAVEL_DELAY_SECONDS", "60"))
    music_lead_s = float(os.environ.get("MUSIC_LEAD_SECONDS", "5"))

    async def _start_music() -> None:
        try:
            from . import spotify, spotify_web
            msg = await spotify_web.play_on_echo(spotify.SEPTEMBER_URI)
            print(f"[welcome] music: {msg}")
        except Exception as e:
            # Don't let music failures kill the dance.
            print(f"[welcome] music skipped: {type(e).__name__}: {e}")

    try:
        rooms = await robot.list_rooms()
    except Exception as e:
        print(f"[welcome] couldn't list rooms ({e}); dancing in place.")
        asyncio.create_task(_start_music())
        await run_routine(robot, WELCOME_ROUTINE)
        return "Danced in place (couldn't query rooms)."

    target = next(
        (r for r in rooms if r.name.strip().lower() == room_name.lower()), None
    )
    if target is None:
        available = ", ".join(r.name for r in rooms) or "(none mapped)"
        print(
            f"[welcome] room {room_name!r} not in map. Available: {available}. "
            f"Dancing in place instead."
        )
        asyncio.create_task(_start_music())
        await run_routine(robot, WELCOME_ROUTINE)
        return f"Danced in place ({room_name!r} not mapped)."

    print(f"[welcome] driving to {room_name!r}; waiting {travel_s:.0f}s for arrival.")
    try:
        await robot.clean_rooms([target.id])
    except Exception as e:
        print(f"[welcome] clean_rooms failed ({e}); falling back to in-place.")
        asyncio.create_task(_start_music())
        await run_routine(robot, WELCOME_ROUTINE)
        return "Danced in place (navigation command failed)."

    # Wait until almost there, then start music in the background.
    music_delay = max(0.0, travel_s - music_lead_s)
    await asyncio.sleep(music_delay)
    asyncio.create_task(_start_music())
    await asyncio.sleep(music_lead_s)

    print("[welcome] arrived (probably); dancing.")
    try:
        await robot.pause()
        await asyncio.sleep(0.5)
    except Exception as e:
        print(f"[welcome] pause failed ({e}); proceeding to dance anyway.")

    await run_routine(robot, WELCOME_DANCE_BODY)
    await asyncio.sleep(0.5)
    try:
        await robot.return_to_dock()
    except Exception as e:
        print(f"[welcome] dock command failed: {e}")
    return f"Drove to {room_name}, danced (with music), and headed home."


async def dance(robot: Robot) -> str:
    """The simple canned 'dance' triggered when the user says nothing but
    'dance'. Kept short and self-docking."""
    try:
        await robot.spot_clean()
        await asyncio.sleep(2.0)
        await robot.pause()
        await asyncio.sleep(0.5)
        await robot.start_cleaning()
        await asyncio.sleep(1.0)
        await robot.pause()
        await asyncio.sleep(0.5)
        await robot.spot_clean()
        await asyncio.sleep(1.5)
        await robot.pause()
        await robot.return_to_dock()
        return "Did a quick spin-scoot-spin and headed home."
    except Exception as e:
        return f"Dance interrupted: {type(e).__name__}: {e}"

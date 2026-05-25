"""Bedroom cleanliness anomaly detection.

Runs a bedroom-only clean, times how long the robot takes, and compares
against the rolling history. If today's clean is significantly longer than
usual, send an iMessage to the configured handle — the working hypothesis
being that "longer than usual" correlates with clothes/clutter on the floor.

The threshold is duration-based and uses median (more robust than mean
against the occasional very-long stuck session). The first few cleans
just build a baseline; no notifications fire until we have enough data.
"""

from __future__ import annotations

import asyncio
import json
import statistics
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from .notifications import notify_husband
from .robot import Robot

# Tuning knobs.
BEDROOM_ROOM_NAME = "Bedroom"           # matched case-insensitively against your map
BASELINE_MIN_SAMPLES = 5                # don't notify until we have this many cleans
ANOMALY_THRESHOLD = 1.25                # today > median * this -> notify
MAX_CLEAN_MINUTES = 30                  # safety cap: if the clean doesn't end, give up
POLL_INTERVAL_S = 5.0                   # how often we check the robot state

# Robot states we consider "the clean is done".
TERMINAL_STATES = {"docked", "returning", "charging", "idle", "stopped"}
ACTIVE_STATES = {"cleaning", "spot_cleaning", "auto"}

HISTORY_PATH = Path.home() / "tan_test" / "data" / "bedroom_history.json"


@dataclass
class CleanRecord:
    timestamp: str
    duration_min: float
    notified: bool = False
    note: str = ""


def _load_history() -> list[CleanRecord]:
    if not HISTORY_PATH.exists():
        return []
    try:
        raw = json.loads(HISTORY_PATH.read_text())
        return [CleanRecord(**r) for r in raw]
    except Exception as e:
        print(f"[bedroom-watch] couldn't parse history ({e}); starting fresh.")
        return []


def _save_history(records: list[CleanRecord]) -> None:
    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_PATH.write_text(json.dumps([asdict(r) for r in records], indent=2))


def _resolve_bedroom(rooms: list) -> str | None:
    for r in rooms:
        if r.name.strip().lower() == BEDROOM_ROOM_NAME.lower():
            return r.id
    return None


async def _wait_for_clean_done(robot: Robot, started_at: float) -> str:
    """Block until the robot reports it's finished cleaning. Returns the
    final state. Times out after MAX_CLEAN_MINUTES."""
    saw_active = False
    deadline = started_at + MAX_CLEAN_MINUTES * 60
    last_state = "unknown"
    while time.monotonic() < deadline:
        try:
            s = await robot.status()
            last_state = (s.get("work_status") or "unknown").lower()
        except Exception as e:
            print(f"[bedroom-watch] status error: {e}")
            await asyncio.sleep(POLL_INTERVAL_S)
            continue

        if last_state in ACTIVE_STATES:
            saw_active = True
        elif saw_active and last_state in TERMINAL_STATES:
            return last_state
        await asyncio.sleep(POLL_INTERVAL_S)
    return f"timeout ({last_state})"


def _decide(history: list[CleanRecord], today_min: float) -> tuple[bool, str]:
    """Returns (should_notify, reason)."""
    samples = [r.duration_min for r in history if r.duration_min > 0]
    if len(samples) < BASELINE_MIN_SAMPLES:
        return (
            False,
            f"baseline phase ({len(samples) + 1}/{BASELINE_MIN_SAMPLES} samples collected).",
        )
    median = statistics.median(samples)
    threshold = median * ANOMALY_THRESHOLD
    if today_min > threshold:
        return (
            True,
            f"{today_min:.1f} min vs. usual {median:.1f} min (threshold {threshold:.1f}).",
        )
    return (
        False,
        f"normal: {today_min:.1f} min vs. usual {median:.1f} min.",
    )


async def run_bedroom_check(robot: Robot) -> str:
    """Run one bedroom-only clean, record it, decide whether to notify.

    Returns a short human-readable summary of what happened.
    """
    rooms = await robot.list_rooms()
    bedroom_id = _resolve_bedroom(rooms)
    if bedroom_id is None:
        names = ", ".join(r.name for r in rooms) or "(none mapped)"
        msg = f"Bedroom not found in your map. Available rooms: {names}"
        print(f"[bedroom-watch] {msg}")
        return msg

    pre = await robot.status()
    pre_state = (pre.get("work_status") or "unknown").lower()
    if pre_state in ACTIVE_STATES:
        msg = f"Robot is busy ({pre_state}); skipping today's bedroom check."
        print(f"[bedroom-watch] {msg}")
        return msg

    print(f"[bedroom-watch] starting bedroom clean (state was {pre_state}).")
    start = time.monotonic()
    await robot.clean_rooms([bedroom_id])
    final_state = await _wait_for_clean_done(robot, start)
    duration_min = (time.monotonic() - start) / 60.0
    print(f"[bedroom-watch] done in {duration_min:.1f} min (final state: {final_state}).")

    history = _load_history()
    notify, reason = _decide(history, duration_min)
    today = CleanRecord(
        timestamp=datetime.now().isoformat(timespec="seconds"),
        duration_min=round(duration_min, 2),
        notified=False,
        note=reason,
    )

    if notify:
        message = (
            f"Hey — the bedroom clean took {duration_min:.0f} min today vs. "
            f"the usual. Probably clothes on the floor again \U0001F605"
        )
        sent = await notify_husband(message)
        today.notified = sent

    history.append(today)
    _save_history(history)

    return (
        f"Bedroom check: {duration_min:.1f} min. {reason}"
        + (" [notified]" if today.notified else "")
    )

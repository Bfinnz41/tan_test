"""Auto-dock when stuck.

A long-running background task. Polls the robot's state every 30s. Maintains
a single timer — when the robot first enters a stuck/error state, the timer
starts. If it stays in that state for `STUCK_THRESHOLD_S` seconds, we:

1. Send `return_to_dock` so it stops sitting there draining battery.
2. iMessage USER_IMESSAGE_HANDLE so the human knows.

After firing, a cooldown prevents re-firing during the same recovery attempt.
The timer resets whenever the robot transitions back to a healthy state.
"""

from __future__ import annotations

import asyncio
import os
import time

from .notifications import notify_user
from .robot import Robot

# Tuning knobs (overridable via env vars).
STUCK_THRESHOLD_S = int(os.environ.get("STUCK_THRESHOLD_SECONDS", "300"))    # 5 min
POLL_INTERVAL_S = int(os.environ.get("STUCK_POLL_INTERVAL_SECONDS", "30"))
COOLDOWN_S = int(os.environ.get("STUCK_COOLDOWN_SECONDS", "600"))            # 10 min

# Vacuum work_status values we treat as "stuck / needs help".
STUCK_STATES = {"error", "stuck", "stopped"}

# Substrings in raw.error that count as a real error worth acting on.
# "none", empty, "no error" all mean healthy.
_BENIGN_ERRORS = {"", "none", "no_error", "no error", "ok", "0"}


def _looks_stuck(status: dict) -> bool:
    work_status = (status.get("work_status") or "").strip().lower()
    if work_status in STUCK_STATES:
        return True
    raw = status.get("raw") or {}
    err = raw.get("error") or raw.get("error_code") or raw.get("error_message") or ""
    if isinstance(err, (int, float)):
        return err != 0
    if isinstance(err, str) and err.strip().lower() not in _BENIGN_ERRORS:
        return True
    return False


async def watch(robot: Robot) -> None:
    """Long-running loop. Catches every exception so a transient HA hiccup
    can't kill the watcher."""
    error_started_at: float | None = None
    last_action_at: float = 0.0

    print(
        f"[stuck-watcher] started "
        f"(threshold {STUCK_THRESHOLD_S}s, poll {POLL_INTERVAL_S}s)"
    )

    while True:
        try:
            status = await robot.status()
            stuck = _looks_stuck(status)
            now = time.monotonic()

            if stuck:
                if error_started_at is None:
                    error_started_at = now
                    work_status = status.get("work_status")
                    err = (status.get("raw") or {}).get("error")
                    print(
                        f"[stuck-watcher] entered stuck state "
                        f"(work_status={work_status!r}, error={err!r})"
                    )
                else:
                    stuck_for = now - error_started_at
                    if (
                        stuck_for >= STUCK_THRESHOLD_S
                        and (now - last_action_at) > COOLDOWN_S
                    ):
                        mins = stuck_for / 60.0
                        print(
                            f"[stuck-watcher] stuck for {mins:.1f} min — "
                            f"sending to dock + notifying user."
                        )
                        try:
                            await robot.return_to_dock()
                        except Exception as e:
                            print(f"[stuck-watcher] dock command failed: {e}")
                        await notify_user(
                            f"Vacuum got stuck for {mins:.0f}+ min — sent it "
                            f"back to dock. You may want to check on it."
                        )
                        last_action_at = now
                        error_started_at = None  # re-arm after a recovery
            else:
                if error_started_at is not None:
                    work_status = status.get("work_status")
                    print(f"[stuck-watcher] recovered (work_status={work_status!r})")
                    error_started_at = None

        except asyncio.CancelledError:
            print("[stuck-watcher] stopped.")
            raise
        except Exception as e:
            print(f"[stuck-watcher] poll error: {type(e).__name__}: {e}")

        await asyncio.sleep(POLL_INTERVAL_S)

"""Spotify control on macOS via AppleScript.

Requires the Spotify desktop app to be installed and logged in.
Works on both free and Premium tiers (we only play specific tracks).
"""

from __future__ import annotations

import asyncio
import time

# Track URI = "spotify:track:<id>". Get it by right-clicking a track in
# Spotify → Share → Copy Spotify URI.
SEPTEMBER_URI = "spotify:track:3kxfsdsCpFgN412fpnW85Y"  # September - Earth, Wind & Fire


async def _osascript(script: str) -> str:
    proc = await asyncio.create_subprocess_exec(
        "osascript", "-e", script,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(
            f"osascript failed: {stderr.decode().strip() or '(no stderr)'}"
        )
    return stdout.decode().strip()


async def is_installed() -> bool:
    try:
        await _osascript('tell application "System Events" to (name of every process) contains "Spotify"')
        return True
    except Exception:
        return False


async def play_track(uri: str) -> None:
    """Tell Spotify to play a track URI. Returns immediately; use
    `wait_for_playback` to block until audio actually starts."""
    await _osascript(f'tell application "Spotify" to play track "{uri}"')


async def pause() -> None:
    await _osascript('tell application "Spotify" to pause')


async def player_position() -> float:
    """Current playback position in seconds, or 0 if not playing."""
    try:
        out = await _osascript('tell application "Spotify" to get player position')
        return float(out)
    except (ValueError, RuntimeError):
        return 0.0


async def player_state() -> str:
    """Returns 'playing', 'paused', or 'stopped' (lowercased)."""
    out = await _osascript('tell application "Spotify" to player state as string')
    return out.lower()


async def wait_for_playback(timeout: float = 5.0, poll: float = 0.05) -> float:
    """Block until Spotify reports it's actually playing.

    Returns the player position at the moment we detected playback (seconds
    into the track). Use this as the offset for routine sync.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            state = await player_state()
            if state == "playing":
                pos = await player_position()
                if pos > 0.0:
                    return pos
        except Exception:
            pass
        await asyncio.sleep(poll)
    raise RuntimeError(
        f"Spotify didn't start playing within {timeout}s. "
        "Is the Spotify desktop app open and logged in?"
    )

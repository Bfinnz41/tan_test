"""iMessage sending via AppleScript.

Sends from your Mac's Messages app to a configured iMessage handle. The
recipient must be reachable via iMessage (not green-bubble SMS) since
AppleScript only drives the iMessage service.

Configure via env var `HUSBAND_IMESSAGE_HANDLE` — either a phone number in
+E.164 format ("+15551234567") or an Apple ID email ("foo@example.com").

On first send, macOS will prompt to allow Python to control the Messages
app. Allow it (or fix in System Settings → Privacy & Security → Automation).
"""

from __future__ import annotations

import asyncio
import os


def _escape(s: str) -> str:
    # AppleScript string escaping: backslash and double-quote.
    return s.replace("\\", "\\\\").replace('"', '\\"')


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


async def send_imessage(handle: str, message: str) -> None:
    """Send an iMessage to the given handle (phone or Apple ID)."""
    script = (
        f'tell application "Messages"\n'
        f'  set targetService to 1st service whose service type = iMessage\n'
        f'  set targetBuddy to buddy "{_escape(handle)}" of targetService\n'
        f'  send "{_escape(message)}" to targetBuddy\n'
        f'end tell'
    )
    await _osascript(script)


async def notify_husband(message: str) -> bool:
    """Send a message to the configured husband handle.

    Returns True if sent, False if no handle is configured (logs to stdout
    in that case so you still see what would have been sent).
    """
    handle = os.environ.get("HUSBAND_IMESSAGE_HANDLE", "").strip()
    if not handle:
        print(f"[notify-skipped] HUSBAND_IMESSAGE_HANDLE not set. Would send: {message}")
        return False
    try:
        await send_imessage(handle, message)
        print(f"[notify-sent] -> {handle}: {message}")
        return True
    except Exception as e:
        print(f"[notify-error] {type(e).__name__}: {e}")
        return False

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


_TARGETS = {
    "user": "USER_IMESSAGE_HANDLE",
    "husband": "HUSBAND_IMESSAGE_HANDLE",
}


async def notify(target: str, message: str) -> bool:
    """Send an iMessage to a named target ('user' or 'husband').

    Returns True if sent, False if the target handle isn't configured
    (logs to stdout so you still see what would have been sent).
    """
    env_var = _TARGETS.get(target.lower())
    if env_var is None:
        print(f"[notify-error] Unknown target {target!r}; valid: {list(_TARGETS)}")
        return False
    handle = os.environ.get(env_var, "").strip()
    if not handle:
        print(f"[notify-skipped] {env_var} not set. Would send to {target}: {message}")
        return False
    try:
        await send_imessage(handle, message)
        print(f"[notify-sent] -> {handle} ({target}): {message}")
        return True
    except Exception as e:
        print(f"[notify-error] {type(e).__name__}: {e}")
        return False


async def notify_husband(message: str) -> bool:
    return await notify("husband", message)


async def notify_user(message: str) -> bool:
    return await notify("user", message)

"""Thin async wrapper around the unofficial `eufy-clean` library.

The Eufy X10 Pro Omni has no official public API, so we're talking to it via
the same Tuya cloud the mobile app uses. Method names in `eufy-clean` shift
between versions; this wrapper probes for the most likely method on each call
and raises a clear error if none is found, instead of crashing deep inside
the library.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from EufyClean import EufyClean


@dataclass
class RoomInfo:
    id: str
    name: str


class Robot:
    def __init__(self, username: str, password: str, device_id: str | None = None):
        self._username = username
        self._password = password
        self._device_id = device_id
        self._client: EufyClean | None = None
        self._device: Any = None
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        async with self._lock:
            if self._device is not None:
                return
            self._client = EufyClean(self._username, self._password)
            await self._client.login()

            if not self._device_id:
                devices = await self._call(self._client, ["list_devices", "get_devices"])
                if not devices:
                    raise RuntimeError("No Eufy devices found on this account.")
                first = devices[0]
                self._device_id = first.get("id") or first.get("device_id") or first.get("deviceId")
                if not self._device_id:
                    raise RuntimeError(f"Could not pick a device id from: {first!r}")

            self._device = await self._call(
                self._client, ["init_device", "get_device"], self._device_id
            )

    async def _ensure(self) -> Any:
        if self._device is None:
            await self.connect()
        return self._device

    @staticmethod
    async def _call(obj: Any, names: list[str], *args, **kwargs) -> Any:
        """Call the first matching method name; await if it's a coroutine."""
        for name in names:
            method = getattr(obj, name, None)
            if method is None:
                continue
            result = method(*args, **kwargs)
            if asyncio.iscoroutine(result):
                result = await result
            return result
        raise AttributeError(
            f"None of these methods exist on {type(obj).__name__}: {names}. "
            f"The eufy-clean library may have changed; update src/eufy_llm/robot.py."
        )

    async def status(self) -> dict[str, Any]:
        device = await self._ensure()
        await self._call(device, ["update", "refresh", "get_state"])
        state = getattr(device, "state", None) or getattr(device, "status", None) or {}
        if hasattr(state, "__dict__"):
            state = dict(state.__dict__)
        return {
            "battery": state.get("battery") if isinstance(state, dict) else None,
            "work_status": state.get("work_status") or state.get("status") if isinstance(state, dict) else None,
            "raw": state,
        }

    async def list_rooms(self) -> list[RoomInfo]:
        device = await self._ensure()
        try:
            rooms_raw = await self._call(
                device, ["get_rooms", "list_rooms", "get_map_rooms", "rooms"]
            )
        except AttributeError:
            return []
        rooms: list[RoomInfo] = []
        if isinstance(rooms_raw, dict):
            rooms_raw = rooms_raw.values()
        for r in rooms_raw or []:
            if isinstance(r, dict):
                rid = str(r.get("id") or r.get("room_id") or r.get("name"))
                name = str(r.get("name") or r.get("room_name") or rid)
                rooms.append(RoomInfo(id=rid, name=name))
        return rooms

    async def start_cleaning(self) -> None:
        device = await self._ensure()
        await self._call(
            device, ["play", "auto_clean", "start_auto_cleaning", "start_cleaning", "start"]
        )

    async def pause(self) -> None:
        device = await self._ensure()
        await self._call(device, ["pause"])

    async def resume(self) -> None:
        device = await self._ensure()
        await self._call(device, ["resume", "play"])

    async def stop(self) -> None:
        device = await self._ensure()
        await self._call(device, ["stop"])

    async def return_to_dock(self) -> None:
        device = await self._ensure()
        await self._call(device, ["go_home", "return_home", "return_to_dock", "dock"])

    async def clean_rooms(self, room_ids: list[str]) -> None:
        device = await self._ensure()
        for method in ["clean_rooms", "room_clean", "scene_clean", "start_room_cleaning"]:
            fn = getattr(device, method, None)
            if fn is None:
                continue
            result = fn(room_ids)
            if asyncio.iscoroutine(result):
                await result
            return
        raise AttributeError(
            "No room-clean method on this device. Confirm your X10's map is set up "
            "in the Eufy app and that eufy-clean exposes room cleaning for it."
        )

    async def manual_move(self, direction: str, duration_s: float = 0.6) -> None:
        """Best-effort joystick nudge. Direction: forward|back|left|right."""
        device = await self._ensure()
        for method in ["manual_control", "move", "joystick", "set_direction"]:
            fn = getattr(device, method, None)
            if fn is None:
                continue
            result = fn(direction)
            if asyncio.iscoroutine(result):
                await result
            await asyncio.sleep(duration_s)
            stop = getattr(device, "manual_stop", None) or getattr(device, "stop_move", None)
            if stop:
                r = stop()
                if asyncio.iscoroutine(r):
                    await r
            return
        raise AttributeError("No manual-control method on this device.")

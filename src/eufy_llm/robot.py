"""Robot wrapper backed by Home Assistant's REST API.

Instead of talking to Eufy's cloud directly (no working Python library exists
for the X10 Pro Omni), we go through a Home Assistant instance that already
has the Eufy Robovac MQTT integration installed and connected.

Required env vars:
- HA_URL: e.g. http://localhost:8123
- HA_TOKEN: a long-lived access token from HA
- HA_VACUUM_ENTITY: e.g. vacuum.eufy_tj_home (from HA Developer Tools → States)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx


@dataclass
class RoomInfo:
    id: str
    name: str


class Robot:
    def __init__(self, ha_url: str, ha_token: str, vacuum_entity: str):
        self._base = ha_url.rstrip("/")
        self._entity = vacuum_entity
        self._headers = {
            "Authorization": f"Bearer {ha_token}",
            "Content-Type": "application/json",
        }
        self._client: httpx.AsyncClient | None = None

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(headers=self._headers, timeout=30.0)
        return self._client

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def connect(self) -> None:
        c = await self._http()
        r = await c.get(f"{self._base}/api/states/{self._entity}")
        if r.status_code == 401:
            raise RuntimeError("HA rejected the token. Regenerate HA_TOKEN.")
        if r.status_code == 404:
            raise RuntimeError(
                f"HA does not know entity {self._entity!r}. "
                f"Check HA_VACUUM_ENTITY in your .env (Developer Tools → States in HA)."
            )
        r.raise_for_status()

    async def _call_service(self, domain: str, service: str, data: dict | None = None) -> Any:
        c = await self._http()
        payload: dict[str, Any] = {"entity_id": self._entity}
        if data:
            payload.update(data)
        url = f"{self._base}/api/services/{domain}/{service}"
        r = await c.post(url, json=payload)
        r.raise_for_status()
        return r.json()

    async def _get_state(self, entity_id: str) -> dict | None:
        c = await self._http()
        r = await c.get(f"{self._base}/api/states/{entity_id}")
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()

    async def status(self) -> dict[str, Any]:
        state = await self._get_state(self._entity)
        if state is None:
            return {"battery": None, "work_status": "unknown", "raw": {}}
        attrs = state.get("attributes") or {}
        return {
            "battery": attrs.get("battery_level"),
            "work_status": state.get("state"),
            "raw": attrs,
        }

    async def list_rooms(self) -> list[RoomInfo]:
        # Eufy Robovac MQTT exposes rooms as a `select.<vacuum>_clean_room` entity
        # with the available rooms in its `options` attribute.
        base = self._entity.replace("vacuum.", "select.", 1)
        for suffix in ("_clean_room", "_scene"):
            state = await self._get_state(base + suffix)
            if state is None:
                continue
            options = (state.get("attributes") or {}).get("options") or []
            rooms = [
                RoomInfo(id=o, name=o)
                for o in options
                if isinstance(o, str) and o.strip().lower() not in {"", "unknown"}
            ]
            if rooms:
                return rooms
        return []

    async def start_cleaning(self) -> None:
        await self._call_service("vacuum", "start")

    async def pause(self) -> None:
        await self._call_service("vacuum", "pause")

    async def resume(self) -> None:
        # HA's vacuum.start resumes a paused job.
        await self._call_service("vacuum", "start")

    async def stop(self) -> None:
        await self._call_service("vacuum", "stop")

    async def return_to_dock(self) -> None:
        await self._call_service("vacuum", "return_to_base")

    async def clean_rooms(self, room_ids: list[str]) -> None:
        # Strategy: set the room via the select entity, then trigger a clean.
        # Works with the Eufy Robovac MQTT integration's `select.<vacuum>_clean_room`.
        select_entity = self._entity.replace("vacuum.", "select.", 1) + "_clean_room"
        if await self._get_state(select_entity) is None:
            raise RuntimeError(
                f"Could not find room-select entity {select_entity!r}. "
                f"Confirm your X10's map is set up in the Eufy app."
            )
        for room in room_ids:
            await self._call_service(
                "select",
                "select_option",
                {"entity_id": select_entity, "option": room},
            )
        await self.start_cleaning()

    async def manual_move(self, direction: str, duration_s: float = 0.6) -> None:
        # The Eufy Robovac MQTT integration doesn't expose joystick control.
        raise AttributeError("Manual joystick control isn't exposed through Home Assistant.")

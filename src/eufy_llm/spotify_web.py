"""Spotify Web API client for controlling Spotify Connect devices.

Used to transfer playback to a named Connect device (e.g. your Echo) and
start playing a track on it, regardless of where the user's other Spotify
clients are currently outputting audio.

Setup (one-time):
1. Create a Spotify Developer app at https://developer.spotify.com/dashboard
2. Add redirect URI:  http://127.0.0.1:8888/callback
3. Put SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET in .env
4. Run:  python -m eufy_llm.spotify_auth
5. Set ECHO_DEVICE_NAME in .env to whatever your Echo is named

Refresh tokens are persisted to ~/tan_test/data/spotify_tokens.json and
don't expire, so this is truly a one-time setup.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import time
from pathlib import Path
from typing import Any

import httpx

API_BASE = "https://api.spotify.com/v1"
TOKEN_URL = "https://accounts.spotify.com/api/token"
AUTH_URL = "https://accounts.spotify.com/authorize"
REDIRECT_URI = "http://127.0.0.1:8888/callback"
SCOPES = "user-read-playback-state user-modify-playback-state"

TOKEN_PATH = Path.home() / "tan_test" / "data" / "spotify_tokens.json"


class SpotifyNotConfigured(Exception):
    """Raised when SPOTIFY_* env vars or the saved refresh token are missing."""


def _load_refresh_token() -> str:
    if not TOKEN_PATH.exists():
        raise SpotifyNotConfigured(
            f"No Spotify tokens found at {TOKEN_PATH}. "
            f"Run: python -m eufy_llm.spotify_auth"
        )
    data = json.loads(TOKEN_PATH.read_text())
    token = data.get("refresh_token")
    if not token:
        raise SpotifyNotConfigured("refresh_token missing from saved file.")
    return token


def save_tokens(tokens: dict) -> None:
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_PATH.write_text(json.dumps(tokens, indent=2))


class SpotifyWeb:
    """Async Spotify Web API client. Caches its access token across calls."""

    def __init__(self) -> None:
        self.client_id = os.environ.get("SPOTIFY_CLIENT_ID", "").strip()
        self.client_secret = os.environ.get("SPOTIFY_CLIENT_SECRET", "").strip()
        self._access_token: str | None = None
        self._access_expires_at: float = 0.0
        self._refresh_token: str | None = None

    async def _ensure_access_token(self) -> str:
        if self._access_token and time.time() < self._access_expires_at - 60:
            return self._access_token
        if not self.client_id or not self.client_secret:
            raise SpotifyNotConfigured(
                "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be in .env"
            )
        if self._refresh_token is None:
            self._refresh_token = _load_refresh_token()

        auth = base64.b64encode(
            f"{self.client_id}:{self.client_secret}".encode()
        ).decode()
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                TOKEN_URL,
                headers={"Authorization": f"Basic {auth}"},
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": self._refresh_token,
                },
            )
            r.raise_for_status()
            data = r.json()

        self._access_token = data["access_token"]
        self._access_expires_at = time.time() + data.get("expires_in", 3600)
        # Spotify sometimes rotates the refresh token.
        if "refresh_token" in data:
            self._refresh_token = data["refresh_token"]
            save_tokens({"refresh_token": self._refresh_token})
        return self._access_token

    async def _request(self, method: str, path: str, **kwargs) -> Any:
        token = await self._ensure_access_token()
        headers = kwargs.pop("headers", {})
        headers["Authorization"] = f"Bearer {token}"
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.request(
                method, f"{API_BASE}{path}", headers=headers, **kwargs
            )
        if r.status_code in (200, 201, 202, 204):
            return r.json() if r.content else None
        raise RuntimeError(
            f"Spotify API {method} {path} -> {r.status_code}: {r.text}"
        )

    async def get_devices(self) -> list[dict]:
        data = await self._request("GET", "/me/player/devices")
        return data.get("devices", []) if data else []

    async def find_device(self, name: str) -> dict | None:
        target = name.strip().lower()
        for d in await self.get_devices():
            if (d.get("name") or "").strip().lower() == target:
                return d
        return None

    async def play_track_on_device(self, track_uri: str, device_id: str) -> None:
        await self._request(
            "PUT",
            f"/me/player/play?device_id={device_id}",
            json={"uris": [track_uri]},
        )


async def play_on_echo(track_uri: str, device_name: str | None = None) -> str:
    """Transfer Spotify playback to the named device and start a track.

    Returns a short status message. Raises SpotifyNotConfigured if setup is
    incomplete; RuntimeError if the device can't be found in Spotify Connect.
    """
    if device_name is None:
        device_name = os.environ.get("ECHO_DEVICE_NAME", "").strip()
    if not device_name:
        raise SpotifyNotConfigured("ECHO_DEVICE_NAME not set in .env")

    api = SpotifyWeb()
    device = await api.find_device(device_name)
    if device is None:
        devices = await api.get_devices()
        names = ", ".join(d.get("name", "?") for d in devices) or "(none)"
        raise RuntimeError(
            f"Device {device_name!r} not visible to Spotify Connect. "
            f"Currently visible: {names}. The Echo needs Spotify-on-Alexa "
            f"linked AND to have been used with Spotify recently. Try saying "
            f"'Alexa, play Spotify' then immediately 'Alexa, pause' to make it "
            f"visible."
        )

    await api.play_track_on_device(track_uri, device["id"])
    return f"Playing on {device['name']}"

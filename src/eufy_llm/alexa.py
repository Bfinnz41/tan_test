"""Control Alexa devices via Home Assistant's Alexa Media Player integration.

We use this to make a specific Echo play music. Goes through HA's
`media_player.play_media` service, which Alexa Media Player turns into
a "play X on this Echo" command. The Echo then uses whichever music
service is your default in the Alexa app (we've set up Spotify).

This is more reliable than transferring Spotify Connect playback via the
Spotify Web API because we never have to fight the "Echo is dormant" issue
-- Alexa wakes the Echo by virtue of giving it a command.

Requires:
- HA_URL and HA_TOKEN env vars (same as the vacuum uses)
- Alexa Media Player integration installed in HA
- Echo exposed as a media_player.* entity in HA
- Spotify linked in your Alexa app and set as the default music service
"""

from __future__ import annotations

import os

import httpx


async def play_song(entity_id: str, query: str) -> None:
    """Tell an Echo (via HA's Alexa Media Player integration) to play music
    matching `query`.

    `query` is the same string you'd say to Alexa, e.g.:
      'September by Earth Wind and Fire'
      'classical music'
      'top hits'

    Uses an explicit provider via media_content_type to avoid Amazon's recent
    "Direct music play is not allowed" restriction on the generic 'music' type.
    Override via ALEXA_MEDIA_TYPE env var (e.g. 'AMAZON_MUSIC', 'SPOTIFY').
    """
    ha_url = os.environ.get("HA_URL", "").rstrip("/")
    ha_token = os.environ.get("HA_TOKEN", "")
    if not ha_url or not ha_token:
        raise RuntimeError("HA_URL and HA_TOKEN must be set in .env")

    media_type = os.environ.get("ALEXA_MEDIA_TYPE", "SPOTIFY").strip() or "SPOTIFY"

    headers = {
        "Authorization": f"Bearer {ha_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "entity_id": entity_id,
        "media_content_id": query,
        "media_content_type": media_type,
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(
            f"{ha_url}/api/services/media_player/play_media",
            headers=headers,
            json=payload,
        )
        r.raise_for_status()

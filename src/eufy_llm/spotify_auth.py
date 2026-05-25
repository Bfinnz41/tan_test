"""One-time Spotify OAuth setup.

Run once:  python -m eufy_llm.spotify_auth

Opens a browser for you to authorize the app. Spins up a tiny local HTTP
server on port 8888 to catch Spotify's redirect, exchanges the auth code
for a refresh token, and saves it to disk. After this, the main server
can control your Spotify devices indefinitely.

Prereqs in .env:
  SPOTIFY_CLIENT_ID
  SPOTIFY_CLIENT_SECRET
"""

from __future__ import annotations

import base64
import http.server
import sys
import urllib.parse
import webbrowser

import httpx
from dotenv import load_dotenv

from .spotify_web import REDIRECT_URI, SCOPES, TOKEN_URL, save_tokens

_received: dict = {"code": None, "error": None}


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/callback":
            self.send_response(404)
            self.end_headers()
            return
        params = urllib.parse.parse_qs(parsed.query)
        _received["code"] = (params.get("code") or [None])[0]
        _received["error"] = (params.get("error") or [None])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        if _received["code"]:
            self.wfile.write(
                b"<h1>Authorized.</h1><p>You can close this tab and return "
                b"to the terminal.</p>"
            )
        else:
            err = (_received["error"] or "unknown").encode()
            self.wfile.write(b"<h1>Error: " + err + b"</h1>")

    def log_message(self, *_args, **_kwargs):
        return  # silence default access log


def main() -> None:
    load_dotenv()
    import os

    client_id = os.environ.get("SPOTIFY_CLIENT_ID", "").strip()
    client_secret = os.environ.get("SPOTIFY_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        sys.exit(
            "ERROR: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set "
            "in .env first. Get them from https://developer.spotify.com/dashboard"
        )

    params = urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "scope": SCOPES,
            "redirect_uri": REDIRECT_URI,
        }
    )
    auth_url = f"https://accounts.spotify.com/authorize?{params}"

    print(f"\nOpening browser to authorize Spotify access:\n  {auth_url}\n")
    print("If your browser doesn't open, paste that URL manually.\n")
    webbrowser.open(auth_url)

    print(f"Waiting for Spotify to redirect to {REDIRECT_URI} ...")
    server = http.server.HTTPServer(("localhost", 8888), _Handler)
    while _received["code"] is None and _received["error"] is None:
        server.handle_request()

    if _received["error"]:
        sys.exit(f"Authorization failed: {_received['error']}")

    print("Got auth code. Exchanging for tokens...")
    auth = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    r = httpx.post(
        TOKEN_URL,
        headers={"Authorization": f"Basic {auth}"},
        data={
            "grant_type": "authorization_code",
            "code": _received["code"],
            "redirect_uri": REDIRECT_URI,
        },
        timeout=15.0,
    )
    if r.status_code != 200:
        sys.exit(f"Token exchange failed ({r.status_code}): {r.text}")
    data = r.json()
    refresh_token = data.get("refresh_token")
    if not refresh_token:
        sys.exit(f"No refresh_token in response: {data}")

    save_tokens({"refresh_token": refresh_token})
    print("\nDone. Refresh token saved.")
    print("You can now use the welcome dance with music.")


if __name__ == "__main__":
    main()

"""Google sign-in: ID token verification plus the OAuth redirect flow.

The client (dashboard + extension) holds the raw Google Identity Services
credential JWT from sign-in. We verify it here on every request rather than
trusting a client-supplied user id, which would be trivially spoofable.

Sign-in itself happens via a full-page OAuth redirect (build_login_url +
exchange_code_for_tokens), not a popup — Google's popup/One Tap relay
(accounts.google.com/gsi/transform) depends on third-party storage access
that's unreliable across browsers/profiles; a redirect has no such
dependency. The same redirect requests the Calendar scope so login and
Calendar access are granted together.
"""

import os
import urllib.parse
from pathlib import Path

import requests
from dotenv import load_dotenv
from fastapi import Header, HTTPException
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

GOOGLE_CLIENT_ID = os.environ.get(
    "GOOGLE_OAUTH_CLIENT_ID",
    "499282325321-f5l76ctsmecggcefeunjd45m2meao04g.apps.googleusercontent.com",
)
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")

# Must be registered as an "Authorized redirect URI" on the OAuth client in
# Google Cloud Console — unlike the old popup flow, a real redirect URI is
# required here (not the "postmessage" convention).
#
# This is deliberately the *frontend's* origin, not the backend's. The
# oauth_state cookie set in /api/auth/google/login is scoped to whichever
# origin the browser thinks it talked to — which, via Vite's dev proxy, is
# localhost:5173, not 127.0.0.1:8000. If Google redirected straight back to
# the backend's own origin, that cookie (and any other origin-scoped state)
# would never arrive, since localhost and 127.0.0.1 are different origins to
# a browser even on the same machine. Routing the callback through the
# frontend origin keeps it same-origin end to end; Vite's /api proxy forwards
# it to the real backend route.
FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173")
REDIRECT_URI = f"{FRONTEND_ORIGIN}/api/auth/google/callback"

GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
LOGIN_SCOPE = "openid email profile https://www.googleapis.com/auth/calendar.events"

_request = google_requests.Request()


def verify_google_id_token(token: str) -> dict:
    return id_token.verify_oauth2_token(token, _request, audience=GOOGLE_CLIENT_ID)


def get_current_user(authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header.")

    token = authorization.removeprefix("Bearer ").strip()
    try:
        claims = verify_google_id_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid or expired token: {exc}")

    return {
        "id": claims["sub"],
        "email": claims.get("email", ""),
        "name": claims.get("name", ""),
        "picture": claims.get("picture"),
    }


def build_login_url(state: str) -> str:
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": LOGIN_SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{GOOGLE_AUTH_ENDPOINT}?{urllib.parse.urlencode(params)}"


def exchange_code_for_tokens(code: str) -> dict:
    resp = requests.post(
        GOOGLE_TOKEN_ENDPOINT,
        data={
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": REDIRECT_URI,
            "grant_type": "authorization_code",
        },
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()

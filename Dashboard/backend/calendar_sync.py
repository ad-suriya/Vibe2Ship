"""Google Calendar two-way sync.

Sign-in (auth.py) only verifies an identity token — it carries no Calendar
scope by itself. The login redirect in auth.py requests the Calendar scope
together with sign-in, so the refresh token obtained there (saved via
db.save_calendar_account) is what lets this module push schedule changes
and read busy time without the user being present.

Network calls go straight to Google's REST endpoints via `requests` so we
don't need the full google-api-python-client dependency for two simple
JSON APIs.
"""

import time
from datetime import datetime
from typing import Optional

import requests

from auth import GOOGLE_CLIENT_ID as CLIENT_ID
from auth import GOOGLE_CLIENT_SECRET as CLIENT_SECRET

TOKEN_URI = "https://oauth2.googleapis.com/token"
EVENTS_URI = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
FREEBUSY_URI = "https://www.googleapis.com/calendar/v3/freeBusy"


def configured() -> bool:
    return bool(CLIENT_SECRET)


def _refresh(refresh_token: str) -> dict:
    resp = requests.post(TOKEN_URI, data={
        "refresh_token": refresh_token,
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "grant_type": "refresh_token",
    }, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    return {"access_token": data["access_token"], "expires_at": time.time() + data.get("expires_in", 3600)}


def get_access_token(account: dict, on_refresh=None) -> Optional[str]:
    """Return a valid access token for the stored account, refreshing if needed.

    `on_refresh(access_token, expires_at)` is called so the caller can persist
    the new token; refresh tokens themselves don't expire on their own.
    """
    if not account or not account.get("refresh_token"):
        return None
    if account.get("access_token") and account.get("expires_at", 0) > time.time() + 30:
        return account["access_token"]
    try:
        refreshed = _refresh(account["refresh_token"])
    except requests.RequestException:
        return None
    if on_refresh:
        on_refresh(refreshed["access_token"], refreshed["expires_at"])
    return refreshed["access_token"]


def _event_window(task: dict) -> Optional[tuple[str, str]]:
    start, end = task.get("scheduled_start"), task.get("scheduled_end")
    if start and end:
        return start, end
    return None


def push_event(access_token: str, task: dict) -> Optional[str]:
    """Create or update the calendar event for a scheduled task.

    Returns the Google event id (to store back on the task) or None if the
    task has no schedule yet / the call failed.
    """
    window = _event_window(task)
    if not window:
        return None
    start, end = window
    body = {
        "summary": task["task_name"],
        "description": task.get("next_micro_step") or "",
        "start": {"dateTime": start},
        "end": {"dateTime": end},
    }
    headers = {"Authorization": f"Bearer {access_token}"}
    event_id = task.get("calendar_event_id")
    try:
        if event_id:
            resp = requests.patch(f"{EVENTS_URI}/{event_id}", json=body, headers=headers, timeout=10)
            if resp.status_code == 404:
                event_id = None  # event was deleted on the Google side; fall through to create
            else:
                resp.raise_for_status()
                return event_id
        resp = requests.post(EVENTS_URI, json=body, headers=headers, timeout=10)
        resp.raise_for_status()
        return resp.json()["id"]
    except requests.RequestException:
        return None


def delete_event(access_token: str, event_id: str) -> None:
    if not event_id:
        return
    try:
        requests.delete(f"{EVENTS_URI}/{event_id}", headers={"Authorization": f"Bearer {access_token}"}, timeout=10)
    except requests.RequestException:
        pass


def list_busy(access_token: str, time_min: datetime, time_max: datetime) -> list[tuple[datetime, datetime]]:
    """Read the user's existing primary-calendar busy windows for conflict avoidance."""
    body = {
        "timeMin": time_min.isoformat(),
        "timeMax": time_max.isoformat(),
        "items": [{"id": "primary"}],
    }
    headers = {"Authorization": f"Bearer {access_token}"}
    try:
        resp = requests.post(FREEBUSY_URI, json=body, headers=headers, timeout=10)
        resp.raise_for_status()
        busy = resp.json()["calendars"]["primary"]["busy"]
    except (requests.RequestException, KeyError):
        return []
    out = []
    for slot in busy:
        try:
            out.append((datetime.fromisoformat(slot["start"]), datetime.fromisoformat(slot["end"])))
        except ValueError:
            continue
    return out

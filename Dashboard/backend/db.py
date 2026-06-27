"""Firestore persistence layer (Firebase Admin SDK).

Every public function returns plain dicts with integer ids (auto-increment is
emulated with a transactional `counters` collection), giving the rest of the
backend and the frontend a simple, stable interface.

Credentials: set FIREBASE_CREDENTIALS (or GOOGLE_APPLICATION_CREDENTIALS) to the
path of a Firebase service-account JSON.
"""

import os
from datetime import date, datetime
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

import firebase_admin
from firebase_admin import credentials, firestore as admin_firestore
from google.cloud import firestore as gcf

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

_client = None


def now_iso() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def today_str() -> str:
    return date.today().isoformat()


def _db():
    """Lazy-initialise the Firestore client so the module imports without creds."""
    global _client
    if _client is None:
        if not firebase_admin._apps:
            cred_path = os.environ.get("FIREBASE_CREDENTIALS") or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
            project = os.environ.get("FIREBASE_PROJECT_ID")
            options = {"projectId": project} if project else None
            if cred_path:
                # Resolve a relative path against the repo root so it works
                # regardless of the process working directory.
                p = Path(cred_path)
                if not p.is_absolute():
                    p = Path(__file__).resolve().parent.parent / p
                firebase_admin.initialize_app(credentials.Certificate(str(p)), options)
            else:
                # Falls back to Application Default Credentials.
                firebase_admin.initialize_app(options=options)
        _client = admin_firestore.client()
    return _client


def init_db() -> None:
    """No schema to create in Firestore; just surface credential problems early."""
    try:
        _db()
    except Exception as exc:  # noqa: BLE001
        print(f"[db] Firestore not initialised yet: {exc}")


# --- internal helpers ---------------------------------------------------------
def _col(name: str):
    return _db().collection(name)


def _all(name: str, user_id: Optional[str] = None) -> list[dict]:
    docs = [d.to_dict() for d in _col(name).stream()]
    if user_id is not None:
        docs = [d for d in docs if d.get("user_id") == user_id]
    return docs


def _get(name: str, _id, user_id: Optional[str] = None) -> Optional[dict]:
    snap = _col(name).document(str(_id)).get()
    doc = snap.to_dict() if snap.exists else None
    if doc and user_id is not None and doc.get("user_id") != user_id:
        return None
    return doc


def _next_id(name: str) -> int:
    client = _db()
    ref = client.collection("counters").document(name)

    @gcf.transactional
    def run(transaction):
        snap = ref.get(transaction=transaction)
        value = (snap.to_dict() or {}).get("value", 0) + 1
        transaction.set(ref, {"value": value})
        return value

    return run(client.transaction())


def _save(name: str, doc: dict) -> dict:
    _col(name).document(str(doc["id"])).set(doc)
    return doc


def _patch(name: str, _id, fields: dict, user_id: Optional[str] = None) -> Optional[dict]:
    if not _get(name, _id, user_id):
        return None
    ref = _col(name).document(str(_id))
    ref.set(fields, merge=True)
    return ref.get().to_dict()


def _delete(name: str, _id, user_id: Optional[str] = None) -> bool:
    if not _get(name, _id, user_id):
        return False
    _col(name).document(str(_id)).delete()
    return True


# --- Tasks --------------------------------------------------------------------
def list_tasks(user_id: str) -> list[dict]:
    return sorted(_all("tasks", user_id), key=lambda t: t["id"])


def get_task(task_id: int, user_id: str) -> Optional[dict]:
    return _get("tasks", task_id, user_id)


def create_task(user_id: str, task_name, status="TODO", urgency="MEDIUM", estimated_minutes=30,
                deadline=None, next_micro_step="", goal_id=None, url=None,
                selected_text=None, tags=None) -> dict:
    ts = now_iso()
    return _save("tasks", {
        "id": _next_id("tasks"),
        "user_id": user_id,
        "task_name": task_name,
        "status": status,
        "urgency": urgency,
        "estimated_minutes": estimated_minutes,
        "deadline": deadline,
        "next_micro_step": next_micro_step,
        "scheduled_start": None,
        "scheduled_end": None,
        "goal_id": goal_id,
        "url": url,
        "selected_text": selected_text,
        "tags": tags or [],
        "calendar_event_id": None,
        "created_at": ts,
        "updated_at": ts,
    })


def update_task(task_id: int, user_id: str, **fields) -> Optional[dict]:
    allowed = {"task_name", "status", "urgency", "estimated_minutes", "deadline",
               "next_micro_step", "scheduled_start", "scheduled_end", "goal_id",
               "url", "selected_text", "tags", "calendar_event_id"}
    sets = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not sets:
        return get_task(task_id, user_id)
    sets["updated_at"] = now_iso()
    return _patch("tasks", task_id, sets, user_id)


def set_schedule(task_id: int, user_id: str, start: Optional[str], end: Optional[str]) -> None:
    if _get("tasks", task_id, user_id):
        _col("tasks").document(str(task_id)).set(
            {"scheduled_start": start, "scheduled_end": end, "updated_at": now_iso()}, merge=True)


def delete_task(task_id: int, user_id: str) -> bool:
    return _delete("tasks", task_id, user_id)


def find_active_by_name(name: str, user_id: str) -> Optional[dict]:
    matches = [t for t in _all("tasks", user_id)
               if t.get("status") not in ("COMPLETED", "ARCHIVED") and (t.get("task_name") or "").lower() == name.lower()]
    return max(matches, key=lambda t: t["id"]) if matches else None


def upsert_from_engine(task: dict, user_id: str) -> dict:
    existing = find_active_by_name(task["task_name"], user_id)
    if existing:
        return update_task(existing["id"], user_id, status=task.get("status"), urgency=task.get("urgency_level"),
                           estimated_minutes=task.get("estimated_minutes"), deadline=task.get("deadline"),
                           next_micro_step=task.get("next_micro_step"))  # type: ignore[return-value]
    return create_task(user_id, task_name=task["task_name"], status=task.get("status", "TODO"),
                       urgency=task.get("urgency_level", "MEDIUM"),
                       estimated_minutes=task.get("estimated_minutes", 30),
                       deadline=task.get("deadline"), next_micro_step=task.get("next_micro_step", ""))


# --- Reminders ----------------------------------------------------------------
def list_reminders(user_id: str, include_ack: bool = False) -> list[dict]:
    items = _all("reminders", user_id)
    if not include_ack:
        items = [r for r in items if not r.get("acknowledged")]
    return sorted(items, key=lambda r: r.get("remind_at") or "")


def create_reminder(user_id: str, message: str, remind_at: str, kind: str = "CUSTOM", task_id: Optional[int] = None) -> dict:
    return _save("reminders", {
        "id": _next_id("reminders"),
        "user_id": user_id,
        "task_id": task_id,
        "message": message,
        "remind_at": remind_at,
        "kind": kind,
        "acknowledged": 0,
        "created_at": now_iso(),
    })


def ack_reminder(rid: int, user_id: str) -> bool:
    return _patch("reminders", rid, {"acknowledged": 1}, user_id) is not None


def delete_reminder(rid: int, user_id: str) -> bool:
    return _delete("reminders", rid, user_id)


def clear_auto_reminders(user_id: str) -> None:
    for r in _all("reminders", user_id):
        if r.get("kind") != "CUSTOM":
            _col("reminders").document(str(r["id"])).delete()


# --- Goals --------------------------------------------------------------------
def list_goals(user_id: str) -> list[dict]:
    tasks = _all("tasks", user_id)
    goals = sorted(_all("goals", user_id), key=lambda g: g["id"])
    for g in goals:
        linked = [t for t in tasks if t.get("goal_id") == g["id"]]
        g["linked_total"] = len(linked)
        g["linked_done"] = sum(1 for t in linked if t.get("status") == "COMPLETED")
    return goals


def get_goal(gid: int, user_id: str) -> Optional[dict]:
    return _get("goals", gid, user_id)


def create_goal(user_id: str, title, description="", metric="steps", target_value=1, deadline=None) -> dict:
    ts = now_iso()
    return _save("goals", {
        "id": _next_id("goals"),
        "user_id": user_id,
        "title": title,
        "description": description,
        "metric": metric,
        "target_value": target_value,
        "current_value": 0,
        "deadline": deadline,
        "created_at": ts,
        "updated_at": ts,
    })


def update_goal(gid: int, user_id: str, **fields) -> Optional[dict]:
    allowed = {"title", "description", "metric", "target_value", "current_value", "deadline"}
    sets = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not sets:
        return get_goal(gid, user_id)
    sets["updated_at"] = now_iso()
    return _patch("goals", gid, sets, user_id)


def adjust_goal(gid: int, user_id: str, delta: int) -> Optional[dict]:
    g = get_goal(gid, user_id)
    if not g:
        return None
    return update_goal(gid, user_id, current_value=max(0, g["current_value"] + delta))


def delete_goal(gid: int, user_id: str) -> bool:
    for t in _all("tasks", user_id):
        if t.get("goal_id") == gid:
            _col("tasks").document(str(t["id"])).set({"goal_id": None}, merge=True)
    return _delete("goals", gid, user_id)


# --- Habits -------------------------------------------------------------------
def list_habits_raw(user_id: str) -> list[dict]:
    return sorted(_all("habits", user_id), key=lambda h: h["id"])


def habit_log_dates(habit_id: int) -> list[str]:
    dates = [l["done_date"] for l in _all("habit_logs") if l.get("habit_id") == habit_id]
    return sorted(dates)


def create_habit(user_id: str, name: str, cadence: str = "DAILY") -> dict:
    return _save("habits", {
        "id": _next_id("habits"),
        "user_id": user_id,
        "name": name,
        "cadence": cadence,
        "created_at": now_iso(),
    })


def get_habit(hid: int, user_id: str) -> Optional[dict]:
    return _get("habits", hid, user_id)


def toggle_habit_today(hid: int, user_id: str) -> bool:
    """Toggle today's completion. Returns True if now done, False if unchecked."""
    if not get_habit(hid, user_id):
        return False
    today = today_str()
    doc_id = f"{hid}_{today}"
    ref = _col("habit_logs").document(doc_id)
    if ref.get().exists:
        ref.delete()
        return False
    ref.set({"habit_id": hid, "done_date": today})
    return True


def delete_habit(hid: int, user_id: str) -> bool:
    if not get_habit(hid, user_id):
        return False
    for l in _all("habit_logs"):
        if l.get("habit_id") == hid:
            _col("habit_logs").document(f"{hid}_{l['done_date']}").delete()
    return _delete("habits", hid, user_id)


# --- Sessions -----------------------------------------------------------------
def list_sessions(user_id: str) -> list[dict]:
    return sorted(_all("sessions", user_id), key=lambda s: s["id"])


def get_session(session_id: int, user_id: str) -> Optional[dict]:
    return _get("sessions", session_id, user_id)


def create_session(user_id: str, description: str = "", project_id: Optional[int] = None, duration_minutes: int = 0) -> dict:
    ts = now_iso()
    return _save("sessions", {
        "id": _next_id("sessions"),
        "user_id": user_id,
        "description": description,
        "project_id": project_id,
        "start_time": ts,
        "end_time": None,
        "duration_minutes": duration_minutes,
        "is_paused": False,
        "breaks_taken": 0,
        "total_break_minutes": 0,
        "created_at": ts,
        "updated_at": ts,
    })


def update_session(session_id: int, user_id: str, **fields) -> Optional[dict]:
    allowed = {"description", "project_id", "end_time", "duration_minutes",
               "is_paused", "breaks_taken", "total_break_minutes"}
    sets = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not sets:
        return get_session(session_id, user_id)
    sets["updated_at"] = now_iso()
    return _patch("sessions", session_id, sets, user_id)


def delete_session(session_id: int, user_id: str) -> bool:
    return _delete("sessions", session_id, user_id)


# --- Projects -----------------------------------------------------------------
def list_projects(user_id: str) -> list[dict]:
    return sorted(_all("projects", user_id), key=lambda p: p["id"])


def get_project(project_id: int, user_id: str) -> Optional[dict]:
    return _get("projects", project_id, user_id)


def create_project(user_id: str, name: str, color: str = "#2563eb") -> dict:
    ts = now_iso()
    return _save("projects", {
        "id": _next_id("projects"),
        "user_id": user_id,
        "name": name,
        "color": color,
        "created_at": ts,
        "updated_at": ts,
    })


def update_project(project_id: int, user_id: str, **fields) -> Optional[dict]:
    allowed = {"name", "color"}
    sets = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not sets:
        return get_project(project_id, user_id)
    sets["updated_at"] = now_iso()
    return _patch("projects", project_id, sets, user_id)


def delete_project(project_id: int, user_id: str) -> bool:
    for s in _all("sessions", user_id):
        if s.get("project_id") == project_id:
            _col("sessions").document(str(s["id"])).set({"project_id": None}, merge=True)
    return _delete("projects", project_id, user_id)


# --- Users (Google login identity, persisted instead of staying client-only)
def get_user(user_id: str) -> Optional[dict]:
    return _get("users", user_id)


def upsert_user(user_id: str, email: str = "", name: str = "", picture: Optional[str] = None) -> dict:
    existing = get_user(user_id)
    ts = now_iso()
    return _save("users", {
        "id": user_id,
        "email": email,
        "name": name,
        "picture": picture,
        "created_at": existing["created_at"] if existing else ts,
        "updated_at": ts,
    })


# --- Google Calendar accounts ---------------------------------------------
def get_calendar_account(user_id: str) -> Optional[dict]:
    return _get("calendar_accounts", user_id)


def save_calendar_account(user_id: str, refresh_token: str, access_token: str, expires_at: float) -> dict:
    return _save("calendar_accounts", {
        "id": user_id,
        "refresh_token": refresh_token,
        "access_token": access_token,
        "expires_at": expires_at,
        "updated_at": now_iso(),
    })


def update_calendar_access_token(user_id: str, access_token: str, expires_at: float) -> None:
    _patch("calendar_accounts", user_id, {"access_token": access_token, "expires_at": expires_at})


def delete_calendar_account(user_id: str) -> bool:
    return _delete("calendar_accounts", user_id)

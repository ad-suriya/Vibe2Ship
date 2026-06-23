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


def _all(name: str) -> list[dict]:
    return [d.to_dict() for d in _col(name).stream()]


def _get(name: str, _id) -> Optional[dict]:
    snap = _col(name).document(str(_id)).get()
    return snap.to_dict() if snap.exists else None


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


def _patch(name: str, _id, fields: dict) -> Optional[dict]:
    ref = _col(name).document(str(_id))
    if not ref.get().exists:
        return None
    ref.set(fields, merge=True)
    return ref.get().to_dict()


def _delete(name: str, _id) -> bool:
    ref = _col(name).document(str(_id))
    if not ref.get().exists:
        return False
    ref.delete()
    return True


# --- Tasks --------------------------------------------------------------------
def list_tasks() -> list[dict]:
    return sorted(_all("tasks"), key=lambda t: t["id"])


def get_task(task_id: int) -> Optional[dict]:
    return _get("tasks", task_id)


def create_task(task_name, status="TODO", urgency="MEDIUM", estimated_minutes=30,
                deadline=None, next_micro_step="", goal_id=None) -> dict:
    ts = now_iso()
    return _save("tasks", {
        "id": _next_id("tasks"),
        "task_name": task_name,
        "status": status,
        "urgency": urgency,
        "estimated_minutes": estimated_minutes,
        "deadline": deadline,
        "next_micro_step": next_micro_step,
        "scheduled_start": None,
        "scheduled_end": None,
        "goal_id": goal_id,
        "created_at": ts,
        "updated_at": ts,
    })


def update_task(task_id: int, **fields) -> Optional[dict]:
    allowed = {"task_name", "status", "urgency", "estimated_minutes", "deadline",
               "next_micro_step", "scheduled_start", "scheduled_end", "goal_id"}
    sets = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not sets:
        return get_task(task_id)
    sets["updated_at"] = now_iso()
    return _patch("tasks", task_id, sets)


def set_schedule(task_id: int, start: Optional[str], end: Optional[str]) -> None:
    _col("tasks").document(str(task_id)).set(
        {"scheduled_start": start, "scheduled_end": end, "updated_at": now_iso()}, merge=True)


def delete_task(task_id: int) -> bool:
    return _delete("tasks", task_id)


def find_active_by_name(name: str) -> Optional[dict]:
    matches = [t for t in _all("tasks")
               if t.get("status") != "COMPLETED" and (t.get("task_name") or "").lower() == name.lower()]
    return max(matches, key=lambda t: t["id"]) if matches else None


def upsert_from_engine(task: dict) -> dict:
    existing = find_active_by_name(task["task_name"])
    if existing:
        return update_task(existing["id"], status=task.get("status"), urgency=task.get("urgency_level"),
                           estimated_minutes=task.get("estimated_minutes"), deadline=task.get("deadline"),
                           next_micro_step=task.get("next_micro_step"))  # type: ignore[return-value]
    return create_task(task_name=task["task_name"], status=task.get("status", "TODO"),
                       urgency=task.get("urgency_level", "MEDIUM"),
                       estimated_minutes=task.get("estimated_minutes", 30),
                       deadline=task.get("deadline"), next_micro_step=task.get("next_micro_step", ""))


# --- Reminders ----------------------------------------------------------------
def list_reminders(include_ack: bool = False) -> list[dict]:
    items = _all("reminders")
    if not include_ack:
        items = [r for r in items if not r.get("acknowledged")]
    return sorted(items, key=lambda r: r.get("remind_at") or "")


def create_reminder(message: str, remind_at: str, kind: str = "CUSTOM", task_id: Optional[int] = None) -> dict:
    return _save("reminders", {
        "id": _next_id("reminders"),
        "task_id": task_id,
        "message": message,
        "remind_at": remind_at,
        "kind": kind,
        "acknowledged": 0,
        "created_at": now_iso(),
    })


def ack_reminder(rid: int) -> bool:
    return _patch("reminders", rid, {"acknowledged": 1}) is not None


def delete_reminder(rid: int) -> bool:
    return _delete("reminders", rid)


def clear_auto_reminders() -> None:
    for r in _all("reminders"):
        if r.get("kind") != "CUSTOM":
            _col("reminders").document(str(r["id"])).delete()


# --- Goals --------------------------------------------------------------------
def list_goals() -> list[dict]:
    tasks = _all("tasks")
    goals = sorted(_all("goals"), key=lambda g: g["id"])
    for g in goals:
        linked = [t for t in tasks if t.get("goal_id") == g["id"]]
        g["linked_total"] = len(linked)
        g["linked_done"] = sum(1 for t in linked if t.get("status") == "COMPLETED")
    return goals


def get_goal(gid: int) -> Optional[dict]:
    return _get("goals", gid)


def create_goal(title, description="", metric="steps", target_value=1, deadline=None) -> dict:
    ts = now_iso()
    return _save("goals", {
        "id": _next_id("goals"),
        "title": title,
        "description": description,
        "metric": metric,
        "target_value": target_value,
        "current_value": 0,
        "deadline": deadline,
        "created_at": ts,
        "updated_at": ts,
    })


def update_goal(gid: int, **fields) -> Optional[dict]:
    allowed = {"title", "description", "metric", "target_value", "current_value", "deadline"}
    sets = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not sets:
        return get_goal(gid)
    sets["updated_at"] = now_iso()
    return _patch("goals", gid, sets)


def adjust_goal(gid: int, delta: int) -> Optional[dict]:
    g = get_goal(gid)
    if not g:
        return None
    return update_goal(gid, current_value=max(0, g["current_value"] + delta))


def delete_goal(gid: int) -> bool:
    for t in _all("tasks"):
        if t.get("goal_id") == gid:
            _col("tasks").document(str(t["id"])).set({"goal_id": None}, merge=True)
    return _delete("goals", gid)


# --- Habits -------------------------------------------------------------------
def list_habits_raw() -> list[dict]:
    return sorted(_all("habits"), key=lambda h: h["id"])


def habit_log_dates(habit_id: int) -> list[str]:
    dates = [l["done_date"] for l in _all("habit_logs") if l.get("habit_id") == habit_id]
    return sorted(dates)


def create_habit(name: str, cadence: str = "DAILY") -> dict:
    return _save("habits", {
        "id": _next_id("habits"),
        "name": name,
        "cadence": cadence,
        "created_at": now_iso(),
    })


def get_habit(hid: int) -> Optional[dict]:
    return _get("habits", hid)


def toggle_habit_today(hid: int) -> bool:
    """Toggle today's completion. Returns True if now done, False if unchecked."""
    today = today_str()
    doc_id = f"{hid}_{today}"
    ref = _col("habit_logs").document(doc_id)
    if ref.get().exists:
        ref.delete()
        return False
    ref.set({"habit_id": hid, "done_date": today})
    return True


def delete_habit(hid: int) -> bool:
    for l in _all("habit_logs"):
        if l.get("habit_id") == hid:
            _col("habit_logs").document(f"{hid}_{l['done_date']}").delete()
    return _delete("habits", hid)

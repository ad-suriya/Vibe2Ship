"""Mock in-memory database for testing without Firebase credentials."""

from datetime import date, datetime, timezone
from typing import Optional

_data = {
    "tasks": {},
    "reminders": {},
    "goals": {},
    "habits": {},
    "habit_logs": {},
    "sessions": {},
    "projects": {},
    "users": {},
    "calendar_accounts": {},
    "counters": {},
}

_next_ids = {
    "tasks": 1,
    "reminders": 1,
    "goals": 1,
    "habits": 1,
    "sessions": 1,
    "projects": 1,
}


def _db():
    """Mock DB client (always available)."""
    return None


def now_iso() -> str:
    # Kept timezone-aware to match db.py (see its now_iso for why).
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def today_str() -> str:
    return date.today().isoformat()


def init_db() -> None:
    """No-op for mock DB."""
    pass


# --- Tasks
def list_tasks(user_id: str) -> list[dict]:
    return sorted((t for t in _data["tasks"].values() if t["user_id"] == user_id), key=lambda t: t["id"])


def get_task(task_id: int, user_id: str) -> Optional[dict]:
    task = _data["tasks"].get(task_id)
    return task if task and task["user_id"] == user_id else None


def create_task(user_id: str, task_name, status="TODO", urgency="MEDIUM", estimated_minutes=30,
                deadline=None, next_micro_step="", goal_id=None, url=None,
                selected_text=None, tags=None) -> dict:
    task_id = _next_ids["tasks"]
    _next_ids["tasks"] += 1
    ts = now_iso()
    task = {
        "id": task_id,
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
    }
    _data["tasks"][task_id] = task
    return task


def update_task(task_id: int, user_id: str, **fields) -> Optional[dict]:
    allowed = {"task_name", "status", "urgency", "estimated_minutes", "deadline",
               "next_micro_step", "scheduled_start", "scheduled_end", "goal_id",
               "url", "selected_text", "tags", "calendar_event_id"}
    task = _data["tasks"].get(task_id)
    if not task or task["user_id"] != user_id:
        return None
    for k, v in fields.items():
        if k in allowed and v is not None:
            task[k] = v
    task["updated_at"] = now_iso()
    return task


def set_schedule(task_id: int, user_id: str, start: Optional[str], end: Optional[str]) -> None:
    task = _data["tasks"].get(task_id)
    if task and task["user_id"] == user_id:
        task["scheduled_start"] = start
        task["scheduled_end"] = end
        task["updated_at"] = now_iso()


def delete_task(task_id: int, user_id: str) -> bool:
    task = _data["tasks"].get(task_id)
    if task and task["user_id"] == user_id:
        del _data["tasks"][task_id]
        return True
    return False


def find_active_by_name(name: str, user_id: str) -> Optional[dict]:
    matches = [t for t in _data["tasks"].values()
               if t["user_id"] == user_id and t.get("status") not in ("COMPLETED", "ARCHIVED")
               and (t.get("task_name") or "").lower() == name.lower()]
    return max(matches, key=lambda t: t["id"]) if matches else None


def find_by_calendar_event(event_id: str, user_id: str) -> Optional[dict]:
    matches = [t for t in _data["tasks"].values()
               if t["user_id"] == user_id and t.get("calendar_event_id") == event_id]
    return matches[0] if matches else None


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


# --- Reminders
def list_reminders(user_id: str, include_ack: bool = False) -> list[dict]:
    items = [r for r in _data["reminders"].values() if r["user_id"] == user_id]
    if not include_ack:
        items = [r for r in items if not r.get("acknowledged")]
    return sorted(items, key=lambda r: r.get("remind_at") or "")


def create_reminder(user_id: str, message: str, remind_at: str, kind: str = "CUSTOM", task_id: Optional[int] = None) -> dict:
    reminder_id = _next_ids["reminders"]
    _next_ids["reminders"] += 1
    reminder = {
        "id": reminder_id,
        "user_id": user_id,
        "task_id": task_id,
        "message": message,
        "remind_at": remind_at,
        "kind": kind,
        "acknowledged": 0,
        "created_at": now_iso(),
    }
    _data["reminders"][reminder_id] = reminder
    return reminder


def ack_reminder(rid: int, user_id: str) -> bool:
    reminder = _data["reminders"].get(rid)
    if reminder and reminder["user_id"] == user_id:
        reminder["acknowledged"] = 1
        return True
    return False


def delete_reminder(rid: int, user_id: str) -> bool:
    reminder = _data["reminders"].get(rid)
    if reminder and reminder["user_id"] == user_id:
        del _data["reminders"][rid]
        return True
    return False


def clear_auto_reminders(user_id: str) -> None:
    to_delete = [r["id"] for r in _data["reminders"].values()
                 if r["user_id"] == user_id and r.get("kind") != "CUSTOM"]
    for rid in to_delete:
        del _data["reminders"][rid]


# --- Goals
def list_goals(user_id: str) -> list[dict]:
    tasks = [t for t in _data["tasks"].values() if t["user_id"] == user_id]
    goals = sorted((g for g in _data["goals"].values() if g["user_id"] == user_id), key=lambda g: g["id"])
    for g in goals:
        linked = [t for t in tasks if t.get("goal_id") == g["id"]]
        g["linked_total"] = len(linked)
        g["linked_done"] = sum(1 for t in linked if t.get("status") == "COMPLETED")
    return goals


def get_goal(gid: int, user_id: str) -> Optional[dict]:
    goal = _data["goals"].get(gid)
    return goal if goal and goal["user_id"] == user_id else None


def create_goal(user_id: str, title, description="", metric="steps", target_value=1, deadline=None) -> dict:
    goal_id = _next_ids["goals"]
    _next_ids["goals"] += 1
    ts = now_iso()
    goal = {
        "id": goal_id,
        "user_id": user_id,
        "title": title,
        "description": description,
        "metric": metric,
        "target_value": target_value,
        "current_value": 0,
        "deadline": deadline,
        "created_at": ts,
        "updated_at": ts,
    }
    _data["goals"][goal_id] = goal
    return goal


def update_goal(gid: int, user_id: str, **fields) -> Optional[dict]:
    allowed = {"title", "description", "metric", "target_value", "current_value", "deadline"}
    goal = _data["goals"].get(gid)
    if not goal or goal["user_id"] != user_id:
        return None
    for k, v in fields.items():
        if k in allowed and v is not None:
            goal[k] = v
    goal["updated_at"] = now_iso()
    return goal


def adjust_goal(gid: int, user_id: str, delta: int) -> Optional[dict]:
    g = get_goal(gid, user_id)
    if not g:
        return None
    return update_goal(gid, user_id, current_value=max(0, g["current_value"] + delta))


def delete_goal(gid: int, user_id: str) -> bool:
    goal = _data["goals"].get(gid)
    if goal and goal["user_id"] == user_id:
        for t in _data["tasks"].values():
            if t["user_id"] == user_id and t.get("goal_id") == gid:
                t["goal_id"] = None
        del _data["goals"][gid]
        return True
    return False


# --- Habits
def list_habits_raw(user_id: str) -> list[dict]:
    return sorted((h for h in _data["habits"].values() if h["user_id"] == user_id), key=lambda h: h["id"])


def habit_log_dates(habit_id: int) -> list[str]:
    dates = [l["done_date"] for l in _data["habit_logs"].values() if l.get("habit_id") == habit_id]
    return sorted(dates)


def create_habit(user_id: str, name: str, cadence: str = "DAILY") -> dict:
    habit_id = _next_ids["habits"]
    _next_ids["habits"] += 1
    habit = {
        "id": habit_id,
        "user_id": user_id,
        "name": name,
        "cadence": cadence,
        "created_at": now_iso(),
    }
    _data["habits"][habit_id] = habit
    return habit


def get_habit(hid: int, user_id: str) -> Optional[dict]:
    habit = _data["habits"].get(hid)
    return habit if habit and habit["user_id"] == user_id else None


def toggle_habit_today(hid: int, user_id: str) -> bool:
    """Toggle today's completion."""
    if not get_habit(hid, user_id):
        return False
    today = today_str()
    doc_id = f"{hid}_{today}"
    if doc_id in _data["habit_logs"]:
        del _data["habit_logs"][doc_id]
        return False
    _data["habit_logs"][doc_id] = {"habit_id": hid, "done_date": today}
    return True


def delete_habit(hid: int, user_id: str) -> bool:
    habit = _data["habits"].get(hid)
    if not habit or habit["user_id"] != user_id:
        return False
    to_delete = [k for k, v in _data["habit_logs"].items() if v.get("habit_id") == hid]
    for k in to_delete:
        del _data["habit_logs"][k]
    del _data["habits"][hid]
    return True


# --- Sessions
def list_sessions(user_id: str) -> list[dict]:
    return sorted((s for s in _data["sessions"].values() if s["user_id"] == user_id), key=lambda s: s["id"])


def get_session(session_id: int, user_id: str) -> Optional[dict]:
    session = _data["sessions"].get(session_id)
    return session if session and session["user_id"] == user_id else None


def create_session(user_id: str, description: str = "", project_id: Optional[int] = None, duration_minutes: int = 0) -> dict:
    session_id = _next_ids["sessions"]
    _next_ids["sessions"] += 1
    ts = now_iso()
    session = {
        "id": session_id,
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
    }
    _data["sessions"][session_id] = session
    return session


def update_session(session_id: int, user_id: str, **fields) -> Optional[dict]:
    allowed = {"description", "project_id", "end_time", "duration_minutes",
               "is_paused", "breaks_taken", "total_break_minutes"}
    session = _data["sessions"].get(session_id)
    if not session or session["user_id"] != user_id:
        return None
    for k, v in fields.items():
        if k in allowed and v is not None:
            session[k] = v
    session["updated_at"] = now_iso()
    return session


def delete_session(session_id: int, user_id: str) -> bool:
    session = _data["sessions"].get(session_id)
    if session and session["user_id"] == user_id:
        del _data["sessions"][session_id]
        return True
    return False


# --- Projects
def list_projects(user_id: str) -> list[dict]:
    return sorted((p for p in _data["projects"].values() if p["user_id"] == user_id), key=lambda p: p["id"])


def get_project(project_id: int, user_id: str) -> Optional[dict]:
    project = _data["projects"].get(project_id)
    return project if project and project["user_id"] == user_id else None


def create_project(user_id: str, name: str, color: str = "#2563eb") -> dict:
    project_id = _next_ids["projects"]
    _next_ids["projects"] += 1
    ts = now_iso()
    project = {
        "id": project_id,
        "user_id": user_id,
        "name": name,
        "color": color,
        "created_at": ts,
        "updated_at": ts,
    }
    _data["projects"][project_id] = project
    return project


def update_project(project_id: int, user_id: str, **fields) -> Optional[dict]:
    allowed = {"name", "color"}
    project = _data["projects"].get(project_id)
    if not project or project["user_id"] != user_id:
        return None
    for k, v in fields.items():
        if k in allowed and v is not None:
            project[k] = v
    project["updated_at"] = now_iso()
    return project


def delete_project(project_id: int, user_id: str) -> bool:
    project = _data["projects"].get(project_id)
    if project and project["user_id"] == user_id:
        for s in _data["sessions"].values():
            if s["user_id"] == user_id and s.get("project_id") == project_id:
                s["project_id"] = None
        del _data["projects"][project_id]
        return True
    return False


# --- Users (Google login identity, persisted instead of staying client-only)
def get_user(user_id: str) -> Optional[dict]:
    return _data["users"].get(user_id)


def upsert_user(user_id: str, email: str = "", name: str = "", picture: Optional[str] = None) -> dict:
    existing = _data["users"].get(user_id)
    ts = now_iso()
    user = {
        "id": user_id,
        "email": email,
        "name": name,
        "picture": picture,
        "created_at": existing["created_at"] if existing else ts,
        "updated_at": ts,
    }
    _data["users"][user_id] = user
    return user


# --- Google Calendar accounts
def get_calendar_account(user_id: str) -> Optional[dict]:
    return _data["calendar_accounts"].get(user_id)


def save_calendar_account(user_id: str, refresh_token: str, access_token: str, expires_at: float) -> dict:
    account = {
        "id": user_id,
        "refresh_token": refresh_token,
        "access_token": access_token,
        "expires_at": expires_at,
        "updated_at": now_iso(),
    }
    _data["calendar_accounts"][user_id] = account
    return account


def update_calendar_access_token(user_id: str, access_token: str, expires_at: float) -> None:
    account = _data["calendar_accounts"].get(user_id)
    if account:
        account["access_token"] = access_token
        account["expires_at"] = expires_at


def delete_calendar_account(user_id: str) -> bool:
    if user_id in _data["calendar_accounts"]:
        del _data["calendar_accounts"][user_id]
        return True
    return False

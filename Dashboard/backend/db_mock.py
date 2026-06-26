"""Mock in-memory database for testing without Firebase credentials."""

from datetime import date, datetime
from typing import Optional

_data = {
    "tasks": {},
    "reminders": {},
    "goals": {},
    "habits": {},
    "habit_logs": {},
    "sessions": {},
    "projects": {},
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
    return datetime.now().replace(microsecond=0).isoformat()


def today_str() -> str:
    return date.today().isoformat()


def init_db() -> None:
    """No-op for mock DB."""
    pass


# --- Tasks
def list_tasks() -> list[dict]:
    return sorted(_data["tasks"].values(), key=lambda t: t["id"])


def get_task(task_id: int) -> Optional[dict]:
    return _data["tasks"].get(task_id)


def create_task(task_name, status="TODO", urgency="MEDIUM", estimated_minutes=30,
                deadline=None, next_micro_step="", goal_id=None) -> dict:
    task_id = _next_ids["tasks"]
    _next_ids["tasks"] += 1
    ts = now_iso()
    task = {
        "id": task_id,
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
    }
    _data["tasks"][task_id] = task
    return task


def update_task(task_id: int, **fields) -> Optional[dict]:
    allowed = {"task_name", "status", "urgency", "estimated_minutes", "deadline",
               "next_micro_step", "scheduled_start", "scheduled_end", "goal_id"}
    if task_id not in _data["tasks"]:
        return None
    task = _data["tasks"][task_id]
    for k, v in fields.items():
        if k in allowed and v is not None:
            task[k] = v
    task["updated_at"] = now_iso()
    return task


def set_schedule(task_id: int, start: Optional[str], end: Optional[str]) -> None:
    if task_id in _data["tasks"]:
        _data["tasks"][task_id]["scheduled_start"] = start
        _data["tasks"][task_id]["scheduled_end"] = end
        _data["tasks"][task_id]["updated_at"] = now_iso()


def delete_task(task_id: int) -> bool:
    if task_id in _data["tasks"]:
        del _data["tasks"][task_id]
        return True
    return False


def find_active_by_name(name: str) -> Optional[dict]:
    matches = [t for t in _data["tasks"].values()
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


# --- Reminders
def list_reminders(include_ack: bool = False) -> list[dict]:
    items = list(_data["reminders"].values())
    if not include_ack:
        items = [r for r in items if not r.get("acknowledged")]
    return sorted(items, key=lambda r: r.get("remind_at") or "")


def create_reminder(message: str, remind_at: str, kind: str = "CUSTOM", task_id: Optional[int] = None) -> dict:
    reminder_id = _next_ids["reminders"]
    _next_ids["reminders"] += 1
    reminder = {
        "id": reminder_id,
        "task_id": task_id,
        "message": message,
        "remind_at": remind_at,
        "kind": kind,
        "acknowledged": 0,
        "created_at": now_iso(),
    }
    _data["reminders"][reminder_id] = reminder
    return reminder


def ack_reminder(rid: int) -> bool:
    if rid in _data["reminders"]:
        _data["reminders"][rid]["acknowledged"] = 1
        return True
    return False


def delete_reminder(rid: int) -> bool:
    if rid in _data["reminders"]:
        del _data["reminders"][rid]
        return True
    return False


def clear_auto_reminders() -> None:
    to_delete = [r["id"] for r in _data["reminders"].values() if r.get("kind") != "CUSTOM"]
    for rid in to_delete:
        del _data["reminders"][rid]


# --- Goals
def list_goals() -> list[dict]:
    tasks = _data["tasks"].values()
    goals = sorted(_data["goals"].values(), key=lambda g: g["id"])
    for g in goals:
        linked = [t for t in tasks if t.get("goal_id") == g["id"]]
        g["linked_total"] = len(linked)
        g["linked_done"] = sum(1 for t in linked if t.get("status") == "COMPLETED")
    return goals


def get_goal(gid: int) -> Optional[dict]:
    return _data["goals"].get(gid)


def create_goal(title, description="", metric="steps", target_value=1, deadline=None) -> dict:
    goal_id = _next_ids["goals"]
    _next_ids["goals"] += 1
    ts = now_iso()
    goal = {
        "id": goal_id,
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


def update_goal(gid: int, **fields) -> Optional[dict]:
    allowed = {"title", "description", "metric", "target_value", "current_value", "deadline"}
    if gid not in _data["goals"]:
        return None
    goal = _data["goals"][gid]
    for k, v in fields.items():
        if k in allowed and v is not None:
            goal[k] = v
    goal["updated_at"] = now_iso()
    return goal


def adjust_goal(gid: int, delta: int) -> Optional[dict]:
    g = get_goal(gid)
    if not g:
        return None
    return update_goal(gid, current_value=max(0, g["current_value"] + delta))


def delete_goal(gid: int) -> bool:
    if gid in _data["goals"]:
        for t in _data["tasks"].values():
            if t.get("goal_id") == gid:
                t["goal_id"] = None
        del _data["goals"][gid]
        return True
    return False


# --- Habits
def list_habits_raw() -> list[dict]:
    return sorted(_data["habits"].values(), key=lambda h: h["id"])


def habit_log_dates(habit_id: int) -> list[str]:
    dates = [l["done_date"] for l in _data["habit_logs"].values() if l.get("habit_id") == habit_id]
    return sorted(dates)


def create_habit(name: str, cadence: str = "DAILY") -> dict:
    habit_id = _next_ids["habits"]
    _next_ids["habits"] += 1
    habit = {
        "id": habit_id,
        "name": name,
        "cadence": cadence,
        "created_at": now_iso(),
    }
    _data["habits"][habit_id] = habit
    return habit


def get_habit(hid: int) -> Optional[dict]:
    return _data["habits"].get(hid)


def toggle_habit_today(hid: int) -> bool:
    """Toggle today's completion."""
    today = today_str()
    doc_id = f"{hid}_{today}"
    if doc_id in _data["habit_logs"]:
        del _data["habit_logs"][doc_id]
        return False
    _data["habit_logs"][doc_id] = {"habit_id": hid, "done_date": today}
    return True


def delete_habit(hid: int) -> bool:
    to_delete = [k for k, v in _data["habit_logs"].items() if v.get("habit_id") == hid]
    for k in to_delete:
        del _data["habit_logs"][k]
    if hid in _data["habits"]:
        del _data["habits"][hid]
        return True
    return False


# --- Sessions
def list_sessions() -> list[dict]:
    return sorted(_data["sessions"].values(), key=lambda s: s["id"])


def get_session(session_id: int) -> Optional[dict]:
    return _data["sessions"].get(session_id)


def create_session(description: str = "", project_id: Optional[int] = None) -> dict:
    session_id = _next_ids["sessions"]
    _next_ids["sessions"] += 1
    ts = now_iso()
    session = {
        "id": session_id,
        "description": description,
        "project_id": project_id,
        "start_time": ts,
        "end_time": None,
        "created_at": ts,
        "updated_at": ts,
    }
    _data["sessions"][session_id] = session
    return session


def update_session(session_id: int, **fields) -> Optional[dict]:
    allowed = {"description", "project_id", "end_time"}
    if session_id not in _data["sessions"]:
        return None
    session = _data["sessions"][session_id]
    for k, v in fields.items():
        if k in allowed and v is not None:
            session[k] = v
    session["updated_at"] = now_iso()
    return session


def delete_session(session_id: int) -> bool:
    if session_id in _data["sessions"]:
        del _data["sessions"][session_id]
        return True
    return False


# --- Projects
def list_projects() -> list[dict]:
    return sorted(_data["projects"].values(), key=lambda p: p["id"])


def get_project(project_id: int) -> Optional[dict]:
    return _data["projects"].get(project_id)


def create_project(name: str, color: str = "#2563eb") -> dict:
    project_id = _next_ids["projects"]
    _next_ids["projects"] += 1
    ts = now_iso()
    project = {
        "id": project_id,
        "name": name,
        "color": color,
        "created_at": ts,
        "updated_at": ts,
    }
    _data["projects"][project_id] = project
    return project


def update_project(project_id: int, **fields) -> Optional[dict]:
    allowed = {"name", "color"}
    if project_id not in _data["projects"]:
        return None
    project = _data["projects"][project_id]
    for k, v in fields.items():
        if k in allowed and v is not None:
            project[k] = v
    project["updated_at"] = now_iso()
    return project


def delete_project(project_id: int) -> bool:
    if project_id in _data["projects"]:
        for s in _data["sessions"].values():
            if s.get("project_id") == project_id:
                s["project_id"] = None
        del _data["projects"][project_id]
        return True
    return False

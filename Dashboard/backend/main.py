"""Task Weave — FastAPI app.

Tier 1: task CRUD, AI prioritization (via the Gemini engine), AI scheduling,
autonomous rescheduling, and calendar (.ics) export.
"""

import secrets
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

import auth
from auth import get_current_user

import os
try:
    # On Cloud Run, the attached service account provides Application
    # Default Credentials automatically (no GOOGLE_APPLICATION_CREDENTIALS
    # env var needed), so USE_FIRESTORE is the explicit opt-in we set at
    # deploy time.
    if (
        os.environ.get("FIREBASE_CREDENTIALS")
        or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        or os.environ.get("USE_FIRESTORE")
    ):
        import db
    else:
        import db_mock as db
except Exception:
    import db_mock as db
import calendar_sync
import engine
import habits as habits_mod
import ics
import reminders as reminders_mod
import scheduler

app = FastAPI(title="Task Weave Engine")

# FRONTEND_ORIGIN is also used by auth.py's OAuth redirect; in production
# this is the deployed frontend's Cloud Run URL, set via env var at deploy
# time. Defaults to the local dev origin.
_frontend_origins = {"http://localhost:5173", "http://127.0.0.1:5173", auth.FRONTEND_ORIGIN}

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(_frontend_origins),
    # The Chrome extension's popup/options pages run on a chrome-extension://
    # origin whose id varies per install (different on every unpacked load) —
    # an explicit allowlist entry isn't possible, so allow the scheme instead.
    allow_origin_regex=r"^chrome-extension://.*",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    db.init_db()


# --- API models ---------------------------------------------------------------
class Turn(BaseModel):
    role: str
    text: str


class ChatRequest(BaseModel):
    message: str
    history: List[Turn] = []


class ChatResponse(BaseModel):
    chat_ui: engine.ChatUI
    current_mode: engine.Mode
    agentic_action: engine.AgenticAction
    system_trigger: engine.SystemTrigger
    tasks: List[dict]


class TaskCreate(BaseModel):
    task_name: str
    urgency: engine.Urgency = engine.Urgency.MEDIUM
    estimated_minutes: int = 30
    deadline: Optional[str] = None
    next_micro_step: str = ""
    goal_id: Optional[int] = None
    url: Optional[str] = None
    selected_text: Optional[str] = None
    tags: List[str] = []


class TaskPatch(BaseModel):
    task_name: Optional[str] = None
    status: Optional[engine.Status] = None
    urgency: Optional[engine.Urgency] = None
    estimated_minutes: Optional[int] = None
    deadline: Optional[str] = None
    next_micro_step: Optional[str] = None
    goal_id: Optional[int] = None
    url: Optional[str] = None
    selected_text: Optional[str] = None
    tags: Optional[List[str]] = None


class ReminderCreate(BaseModel):
    message: str
    remind_at: str
    task_id: Optional[int] = None


class GoalCreate(BaseModel):
    title: str
    description: str = ""
    metric: str = "steps"
    target_value: int = 1
    deadline: Optional[str] = None


class GoalPatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    metric: Optional[str] = None
    target_value: Optional[int] = None
    current_value: Optional[int] = None
    deadline: Optional[str] = None


class GoalIncrement(BaseModel):
    delta: int = 1


class HabitCreate(BaseModel):
    name: str
    cadence: str = "DAILY"


class SessionCreate(BaseModel):
    description: str = ""
    project_id: Optional[int] = None
    duration_minutes: int = 0


class SessionPatch(BaseModel):
    description: Optional[str] = None
    project_id: Optional[int] = None
    end_time: Optional[str] = None
    duration_minutes: Optional[int] = None
    is_paused: Optional[bool] = None
    breaks_taken: Optional[int] = None
    total_break_minutes: Optional[int] = None


class ProjectCreate(BaseModel):
    name: str
    color: str = "#2563eb"


class ProjectPatch(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


def regen_reminders(user_id: str) -> None:
    """Refresh system-generated reminders from the current plan (keep CUSTOM ones)."""
    db.clear_auto_reminders(user_id)
    for r in reminders_mod.generate(db.list_tasks(user_id)):
        db.create_reminder(user_id, r["message"], r["remind_at"], r["kind"], r["task_id"])


def _calendar_access_token(user_id: str) -> Optional[str]:
    """Fetch a usable Calendar API access token for the user, if they've connected one."""
    account = db.get_calendar_account(user_id)
    if not account:
        return None
    return calendar_sync.get_access_token(
        account, on_refresh=lambda token, expires_at: db.update_calendar_access_token(user_id, token, expires_at))


def _sync_schedule_to_calendar(user_id: str, tasks: list[dict]) -> None:
    """Best-effort push of every scheduled, non-completed task to Google Calendar."""
    token = _calendar_access_token(user_id)
    if not token:
        return
    for task in tasks:
        if task.get("status") in ("COMPLETED", "ARCHIVED") or not task.get("scheduled_start"):
            continue
        event_id = calendar_sync.push_event(token, task)
        if event_id and event_id != task.get("calendar_event_id"):
            db.update_task(task["id"], user_id, calendar_event_id=event_id)


def _calendar_busy_window(user_id: str, now: datetime) -> list[tuple[datetime, datetime]]:
    """Read existing Google Calendar events for the next 2 weeks to avoid double-booking."""
    token = _calendar_access_token(user_id)
    if not token:
        return []
    return calendar_sync.list_busy(token, now, now + timedelta(days=14))


def _import_calendar_events(user_id: str, now: datetime) -> int:
    """Pull real Google Calendar events (next 2 weeks) in as tasks.

    Events we pushed ourselves are filtered out by calendar_sync.list_events
    (tagged on push); this only picks up things the user put on their
    calendar directly, so the plan reflects commitments made outside the app.
    """
    token = _calendar_access_token(user_id)
    if not token:
        return 0
    events = calendar_sync.list_events(token, now, now + timedelta(days=14))
    imported = 0
    for event in events:
        if db.find_by_calendar_event(event["id"], user_id):
            continue
        try:
            minutes = max(15, int(
                (datetime.fromisoformat(event["end"]) - datetime.fromisoformat(event["start"])).total_seconds() // 60))
        except ValueError:
            minutes = 30
        created = db.create_task(
            user_id,
            task_name=event["summary"],
            estimated_minutes=minutes,
            next_micro_step=event["description"][:200],
        )
        db.update_task(created["id"], user_id, calendar_event_id=event["id"])
        db.set_schedule(created["id"], user_id, event["start"], event["end"])
        imported += 1
    return imported


# --- Health -------------------------------------------------------------------
@app.get("/api/health")
def health() -> dict:
    firestore_ready, firestore_error = True, None
    try:
        db._db()  # triggers credential load + client init
    except Exception as exc:  # noqa: BLE001
        firestore_ready, firestore_error = False, str(exc)
    return {
        "ok": True,
        "model": engine.MODEL,
        "key_configured": engine.configured(),
        "firestore_ready": firestore_ready,
        "firestore_error": firestore_error,
    }


@app.get("/api/me")
def get_current_user_profile(user: dict = Depends(get_current_user)) -> dict:
    """Get the verified, currently-authenticated user's profile."""
    return db.get_user(user["id"]) or user


@app.post("/api/me")
def upsert_current_user(user: dict = Depends(get_current_user)) -> dict:
    """Persist the logged-in Google user to the database. Identity comes from
    the verified token only — never from the request body — so one account
    can't claim to be another."""
    return db.upsert_user(user["id"], email=user["email"], name=user["name"], picture=user["picture"])


# --- Google sign-in (full-page OAuth redirect) ---------------------------------
@app.get("/api/auth/google/login")
def google_login() -> RedirectResponse:
    """Kick off the redirect flow. Used both for first sign-in and for the
    "Connect Calendar" button — both need the same scope, so it's one flow."""
    state = secrets.token_urlsafe(24)
    resp = RedirectResponse(auth.build_login_url(state))
    resp.set_cookie("oauth_state", state, httponly=True, samesite="lax", max_age=600)
    return resp


@app.get("/api/auth/google/callback")
def google_callback(request: Request, code: str = "", state: str = "", error: str = "") -> RedirectResponse:
    def fail(detail: str) -> RedirectResponse:
        return RedirectResponse(f"{auth.FRONTEND_ORIGIN}/?auth_error={urllib.parse.quote(detail)}")

    if error:
        return fail(error)
    if not code or not state or state != request.cookies.get("oauth_state"):
        return fail("invalid_state")

    try:
        tokens = auth.exchange_code_for_tokens(code)
        claims = auth.verify_google_id_token(tokens["id_token"])
    except Exception as exc:  # noqa: BLE001
        print(f"OAuth callback failed: {exc!r}")
        return fail(str(exc))

    db.upsert_user(claims["sub"], email=claims.get("email", ""), name=claims.get("name", ""), picture=claims.get("picture"))

    refresh_token = tokens.get("refresh_token")
    if refresh_token:
        expires_at = time.time() + tokens.get("expires_in", 3600)
        db.save_calendar_account(claims["sub"], refresh_token, tokens["access_token"], expires_at)
        _import_calendar_events(claims["sub"], datetime.now())
        _sync_schedule_to_calendar(claims["sub"], db.list_tasks(claims["sub"]))

    resp = RedirectResponse(f"{auth.FRONTEND_ORIGIN}/#credential={tokens['id_token']}")
    resp.delete_cookie("oauth_state")
    return resp


# --- Chat ---------------------------------------------------------------------
@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest, user: dict = Depends(get_current_user)) -> ChatResponse:
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message must not be empty.")
    if not engine.configured():
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured.")

    now = datetime.now()
    busy = _calendar_busy_window(user["id"], now)
    try:
        result = engine.chat(req.message, [t.model_dump() for t in req.history], now=now, busy=busy)
    except Exception as err:  # noqa: BLE001
        if engine.is_transient(err):
            raise HTTPException(status_code=503, detail="The AI model is busy. Try again in a moment.")
        raise HTTPException(status_code=500, detail=str(err))

    for task in result.app_state.tasks_to_update:
        db.upsert_from_engine(task.model_dump(), user["id"])

    return ChatResponse(
        chat_ui=result.chat_ui,
        current_mode=result.app_state.current_mode,
        agentic_action=result.app_state.agentic_action,
        system_trigger=result.app_state.system_trigger,
        tasks=db.list_tasks(user["id"]),
    )


# --- Task CRUD ----------------------------------------------------------------
@app.get("/api/tasks")
def get_tasks(user: dict = Depends(get_current_user)) -> List[dict]:
    return db.list_tasks(user["id"])


@app.post("/api/tasks")
def add_task(body: TaskCreate, user: dict = Depends(get_current_user)) -> dict:
    return db.create_task(
        user["id"],
        task_name=body.task_name,
        urgency=body.urgency.value,
        estimated_minutes=body.estimated_minutes,
        deadline=body.deadline,
        next_micro_step=body.next_micro_step,
        goal_id=body.goal_id,
        url=body.url,
        selected_text=body.selected_text,
        tags=body.tags,
    )


@app.patch("/api/tasks/{task_id}")
def patch_task(task_id: int, body: TaskPatch, user: dict = Depends(get_current_user)) -> dict:
    before = db.get_task(task_id, user["id"])
    if not before:
        raise HTTPException(status_code=404, detail="Task not found.")
    fields = body.model_dump(exclude_none=True)
    if "status" in fields:
        fields["status"] = body.status.value  # type: ignore[union-attr]
    if "urgency" in fields:
        fields["urgency"] = body.urgency.value  # type: ignore[union-attr]
    updated = db.update_task(task_id, user["id"], **fields)

    # Keep a linked goal's progress in sync when a task is completed/reopened.
    goal_id = updated["goal_id"] if updated else None
    if goal_id:
        was_done = before["status"] == "COMPLETED"
        now_done = updated["status"] == "COMPLETED"  # type: ignore[index]
        if now_done and not was_done:
            db.adjust_goal(goal_id, user["id"], 1)
        elif was_done and not now_done:
            db.adjust_goal(goal_id, user["id"], -1)
    return updated  # type: ignore[return-value]


@app.delete("/api/tasks/{task_id}")
def remove_task(task_id: int, user: dict = Depends(get_current_user)) -> dict:
    task = db.get_task(task_id, user["id"])
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    if task.get("calendar_event_id"):
        token = _calendar_access_token(user["id"])
        if token:
            calendar_sync.delete_event(token, task["calendar_event_id"])
    db.delete_task(task_id, user["id"])
    return {"deleted": task_id}


# --- AI scheduling ------------------------------------------------------------
@app.post("/api/schedule")
def schedule(user: dict = Depends(get_current_user)) -> dict:
    now = datetime.now()
    tasks = db.list_tasks(user["id"])
    busy = _calendar_busy_window(user["id"], now)
    plan = scheduler.build_schedule(tasks, now=now, busy=busy)
    for block in plan["blocks"]:
        db.set_schedule(block["task_id"], user["id"], block["scheduled_start"], block["scheduled_end"])
    regen_reminders(user["id"])
    tasks = db.list_tasks(user["id"])
    _sync_schedule_to_calendar(user["id"], tasks)
    tasks = db.list_tasks(user["id"])
    scheduled = sum(1 for b in plan["blocks"])
    message = engine.plan_message(
        f"I just time-blocked {scheduled} task(s) into the user's day. "
        f"{len(plan['at_risk'])} may finish after their deadline."
    )
    return {"tasks": tasks, "at_risk": plan["at_risk"], "message": message}


# --- Autonomous rescheduling --------------------------------------------------
@app.get("/api/status")
def status(user: dict = Depends(get_current_user)) -> dict:
    return scheduler.analyze(db.list_tasks(user["id"]))


@app.post("/api/reschedule")
def reschedule(user: dict = Depends(get_current_user)) -> dict:
    now = datetime.now()
    before = db.list_tasks(user["id"])
    analysis = scheduler.analyze(before, now=now)
    busy = _calendar_busy_window(user["id"], now)
    plan = scheduler.build_schedule(before, now=now, busy=busy)

    moved: list[int] = []
    by_id = {t["id"]: t for t in before}
    for block in plan["blocks"]:
        prev = by_id.get(block["task_id"], {})
        if prev.get("scheduled_start") != block["scheduled_start"]:
            moved.append(block["task_id"])
        db.set_schedule(block["task_id"], user["id"], block["scheduled_start"], block["scheduled_end"])
    regen_reminders(user["id"])

    tasks = db.list_tasks(user["id"])
    _sync_schedule_to_calendar(user["id"], tasks)
    tasks = db.list_tasks(user["id"])
    message = engine.plan_message(
        f"Autonomous reschedule ran. {len(analysis['slipped'])} task(s) had slipped past "
        f"their planned time and {len(analysis['overdue'])} are overdue. I re-packed "
        f"{len(moved)} task(s) into the next available focus slots."
    )
    return {
        "tasks": tasks,
        "moved": moved,
        "overdue": analysis["overdue"],
        "at_risk": plan["at_risk"],
        "message": message,
    }


# --- Google Calendar sync (two-way) -------------------------------------------
@app.get("/api/calendar/status")
def calendar_status(user: dict = Depends(get_current_user)) -> dict:
    return {"connected": db.get_calendar_account(user["id"]) is not None}


@app.post("/api/calendar/disconnect")
def calendar_disconnect(user: dict = Depends(get_current_user)) -> dict:
    db.delete_calendar_account(user["id"])
    return {"connected": False}


@app.post("/api/calendar/sync")
def calendar_sync_now(user: dict = Depends(get_current_user)) -> dict:
    """Two-way sync: pull events the user added on Google Calendar in as
    tasks, then push every scheduled task back out. Called on a timer from
    the frontend so it stays in sync without the user pressing a button."""
    now = datetime.now()
    imported = _import_calendar_events(user["id"], now)
    tasks = db.list_tasks(user["id"])
    _sync_schedule_to_calendar(user["id"], tasks)
    tasks = db.list_tasks(user["id"])
    return {"tasks": tasks, "imported": imported}


# --- Calendar (.ics) ----------------------------------------------------------
@app.get("/api/calendar.ics")
def calendar_all(user: dict = Depends(get_current_user)) -> Response:
    body = ics.calendar(db.list_tasks(user["id"]))
    return Response(
        content=body,
        media_type="text/calendar",
        headers={"Content-Disposition": "attachment; filename=life-saver-plan.ics"},
    )


@app.get("/api/tasks/{task_id}.ics")
def calendar_one(task_id: int, user: dict = Depends(get_current_user)) -> Response:
    task = db.get_task(task_id, user["id"])
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    body = ics.calendar([task])
    return Response(
        content=body,
        media_type="text/calendar",
        headers={"Content-Disposition": f"attachment; filename=task-{task_id}.ics"},
    )


# --- Reminders (#6 context reminders) -----------------------------------------
@app.get("/api/reminders")
def get_reminders(user: dict = Depends(get_current_user)) -> List[dict]:
    now = datetime.now()
    items = db.list_reminders(user["id"])
    for r in items:
        try:
            r["due"] = datetime.fromisoformat(r["remind_at"]) <= now
        except ValueError:
            r["due"] = False
    return items


@app.post("/api/reminders")
def add_reminder(body: ReminderCreate, user: dict = Depends(get_current_user)) -> dict:
    return db.create_reminder(user["id"], body.message, body.remind_at, "CUSTOM", body.task_id)


@app.post("/api/reminders/{reminder_id}/ack")
def acknowledge_reminder(reminder_id: int, user: dict = Depends(get_current_user)) -> dict:
    if not db.ack_reminder(reminder_id, user["id"]):
        raise HTTPException(status_code=404, detail="Reminder not found.")
    return {"acknowledged": reminder_id}


@app.delete("/api/reminders/{reminder_id}")
def remove_reminder(reminder_id: int, user: dict = Depends(get_current_user)) -> dict:
    if not db.delete_reminder(reminder_id, user["id"]):
        raise HTTPException(status_code=404, detail="Reminder not found.")
    return {"deleted": reminder_id}


# --- Goals (#7 goal tracking) -------------------------------------------------
@app.get("/api/goals")
def get_goals(user: dict = Depends(get_current_user)) -> List[dict]:
    return db.list_goals(user["id"])


@app.post("/api/goals")
def add_goal(body: GoalCreate, user: dict = Depends(get_current_user)) -> dict:
    return db.create_goal(
        user["id"],
        title=body.title, description=body.description, metric=body.metric,
        target_value=body.target_value, deadline=body.deadline,
    )


@app.patch("/api/goals/{goal_id}")
def patch_goal(goal_id: int, body: GoalPatch, user: dict = Depends(get_current_user)) -> dict:
    if not db.get_goal(goal_id, user["id"]):
        raise HTTPException(status_code=404, detail="Goal not found.")
    return db.update_goal(goal_id, user["id"], **body.model_dump(exclude_none=True))  # type: ignore[return-value]


@app.post("/api/goals/{goal_id}/increment")
def increment_goal(goal_id: int, body: GoalIncrement, user: dict = Depends(get_current_user)) -> dict:
    updated = db.adjust_goal(goal_id, user["id"], body.delta)
    if not updated:
        raise HTTPException(status_code=404, detail="Goal not found.")
    return updated


@app.delete("/api/goals/{goal_id}")
def remove_goal(goal_id: int, user: dict = Depends(get_current_user)) -> dict:
    if not db.delete_goal(goal_id, user["id"]):
        raise HTTPException(status_code=404, detail="Goal not found.")
    return {"deleted": goal_id}


# --- Habits (#8 habit tracking) -----------------------------------------------
@app.get("/api/habits")
def get_habits(user: dict = Depends(get_current_user)) -> List[dict]:
    return [habits_mod.present(h, db.habit_log_dates(h["id"])) for h in db.list_habits_raw(user["id"])]


@app.post("/api/habits")
def add_habit(body: HabitCreate, user: dict = Depends(get_current_user)) -> dict:
    cadence = body.cadence if body.cadence in ("DAILY", "WEEKLY") else "DAILY"
    habit = db.create_habit(user["id"], body.name, cadence)
    return habits_mod.present(habit, [])


@app.post("/api/habits/{habit_id}/check")
def check_habit(habit_id: int, user: dict = Depends(get_current_user)) -> dict:
    if not db.get_habit(habit_id, user["id"]):
        raise HTTPException(status_code=404, detail="Habit not found.")
    db.toggle_habit_today(habit_id, user["id"])
    habit = db.get_habit(habit_id, user["id"])
    return habits_mod.present(habit, db.habit_log_dates(habit_id))  # type: ignore[arg-type]


@app.delete("/api/habits/{habit_id}")
def remove_habit(habit_id: int, user: dict = Depends(get_current_user)) -> dict:
    if not db.delete_habit(habit_id, user["id"]):
        raise HTTPException(status_code=404, detail="Habit not found.")
    return {"deleted": habit_id}


# --- Sessions (#9 time tracking) ------------------------------------------------
STALE_SESSION_MINUTES = 240  # no real focus session runs unattended this long


def _as_utc(dt: datetime) -> datetime:
    """Treat a naive datetime as UTC — old records written before now_iso()
    became timezone-aware have no offset, but they were always real UTC
    instants (Cloud Run's local clock is UTC), so this avoids a crash
    comparing them against an aware `now` without silently mis-shifting them."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


@app.get("/api/sessions")
def get_sessions(user: dict = Depends(get_current_user)) -> List[dict]:
    """List sessions, lazily closing out abandoned ones so today/week totals
    (which sum elapsed time across every still-open session) can't be
    inflated by duplicates or a session nobody ever hit Stop on:
    - only one session should ever be open at a time — if several are (e.g.
      popup, dashboard chat, and Execution panel each started one before
      this endpoint enforced that), keep the newest and close the rest;
    - the one that remains gets closed too if it's been open implausibly
      long (browser/tab closed without stopping it).
    """
    now = datetime.now(timezone.utc)
    now_iso = now.replace(microsecond=0).isoformat()
    sessions = db.list_sessions(user["id"])
    open_sessions = sorted((s for s in sessions if not s.get("end_time")), key=lambda s: s["id"])

    for s in open_sessions[:-1]:
        closed = db.update_session(s["id"], user["id"], end_time=now_iso)
        if closed:
            s.update(closed)

    if open_sessions:
        newest = open_sessions[-1]
        start = _as_utc(datetime.fromisoformat(newest["start_time"]))
        elapsed_minutes = (now - start).total_seconds() / 60
        if elapsed_minutes > STALE_SESSION_MINUTES:
            closed = db.update_session(newest["id"], user["id"], end_time=now_iso)
            if closed:
                newest.update(closed)

    return sessions


@app.post("/api/sessions")
def add_session(body: SessionCreate, user: dict = Depends(get_current_user)) -> dict:
    # Only one focus session can be running at a time — popup, dashboard chat
    # ("start a pomodoro"), and the Execution panel's "Start Focus" all hit
    # this endpoint independently with no shared client-side state, so without
    # this an abandoned/forgotten session never gets closed and silently
    # accumulates elapsed time into today/week totals forever.
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    for s in db.list_sessions(user["id"]):
        if not s.get("end_time"):
            db.update_session(s["id"], user["id"], end_time=now)
    return db.create_session(user["id"], description=body.description, project_id=body.project_id, duration_minutes=body.duration_minutes)


@app.patch("/api/sessions/{session_id}")
def patch_session(session_id: int, body: SessionPatch, user: dict = Depends(get_current_user)) -> dict:
    if not db.get_session(session_id, user["id"]):
        raise HTTPException(status_code=404, detail="Session not found.")
    return db.update_session(session_id, user["id"], **body.model_dump(exclude_none=True))  # type: ignore[return-value]


@app.delete("/api/sessions/{session_id}")
def remove_session(session_id: int, user: dict = Depends(get_current_user)) -> dict:
    if not db.delete_session(session_id, user["id"]):
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"deleted": session_id}


# --- Projects (#10 project tracking) --------------------------------------------
@app.get("/api/projects")
def get_projects(user: dict = Depends(get_current_user)) -> List[dict]:
    return db.list_projects(user["id"])


@app.post("/api/projects")
def add_project(body: ProjectCreate, user: dict = Depends(get_current_user)) -> dict:
    return db.create_project(user["id"], name=body.name, color=body.color)


@app.patch("/api/projects/{project_id}")
def patch_project(project_id: int, body: ProjectPatch, user: dict = Depends(get_current_user)) -> dict:
    if not db.get_project(project_id, user["id"]):
        raise HTTPException(status_code=404, detail="Project not found.")
    return db.update_project(project_id, user["id"], **body.model_dump(exclude_none=True))  # type: ignore[return-value]


@app.delete("/api/projects/{project_id}")
def remove_project(project_id: int, user: dict = Depends(get_current_user)) -> dict:
    if not db.delete_project(project_id, user["id"]):
        raise HTTPException(status_code=404, detail="Project not found.")
    return {"deleted": project_id}

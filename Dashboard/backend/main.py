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
import memory
import recovery
import reminders as reminders_mod
import risk
import scheduler
import search as search_mod

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


class ChatMessageCreate(BaseModel):
    role: str
    content: str


class TaskCreate(BaseModel):
    task_name: str
    urgency: engine.Urgency = engine.Urgency.MEDIUM
    estimated_minutes: int = 30
    completed_minutes: int = 0
    deadline: Optional[str] = None
    next_micro_step: str = ""
    goal_id: Optional[int] = None
    url: Optional[str] = None
    selected_text: Optional[str] = None
    tags: List[str] = []
    dependencies: List[int] = []


class TaskPatch(BaseModel):
    task_name: Optional[str] = None
    status: Optional[engine.Status] = None
    urgency: Optional[engine.Urgency] = None
    estimated_minutes: Optional[int] = None
    completed_minutes: Optional[int] = None
    deadline: Optional[str] = None
    next_micro_step: Optional[str] = None
    goal_id: Optional[int] = None
    url: Optional[str] = None
    selected_text: Optional[str] = None
    tags: Optional[List[str]] = None
    dependencies: Optional[List[int]] = None


class RecoverRequest(BaseModel):
    # Specific tasks to recover (explicit skip / inactivity triggers). Empty
    # means "auto-detect" — recover whatever's missed right now.
    task_ids: List[int] = []


class DecomposeRequest(BaseModel):
    goal: str


class SubtaskIn(BaseModel):
    id: str
    title: str
    estimated_hours: float
    priority: engine.Urgency = engine.Urgency.MEDIUM
    depends_on: List[str] = []


class DecomposeCommitRequest(BaseModel):
    goal: str
    subtasks: List[SubtaskIn]


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


class WorkflowGenerateRequest(BaseModel):
    sop_text: str


class WorkflowStepIn(BaseModel):
    task_name: str
    urgency: engine.Urgency = engine.Urgency.MEDIUM
    estimated_minutes: int = 30
    tags: List[str] = []


class WorkflowCreate(BaseModel):
    name: str
    sop_text: str = ""
    trigger_type: engine.WorkflowTriggerType = engine.WorkflowTriggerType.MANUAL
    trigger_match: str = ""
    steps: List[WorkflowStepIn]
    active: bool = True


class WorkflowPatch(BaseModel):
    name: Optional[str] = None
    trigger_type: Optional[engine.WorkflowTriggerType] = None
    trigger_match: Optional[str] = None
    steps: Optional[List[WorkflowStepIn]] = None
    active: Optional[bool] = None


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
    memory_facts = [f["fact"] for f in db.get_memory_facts(user["id"])]
    open_tasks = [_with_risk(t, now) for t in db.list_tasks(user["id"]) if t.get("status") not in ("COMPLETED", "ARCHIVED")]  # noqa: F821 (defined below, same module)
    try:
        result = engine.chat(req.message, [t.model_dump() for t in req.history], now=now, busy=busy,
                              memory_facts=memory_facts, open_tasks=open_tasks)
    except Exception as err:  # noqa: BLE001
        print(f"[chat] Gemini call failed: {err!r}")
        if engine.is_quota_exhausted(err):
            raise HTTPException(status_code=429, detail="Daily AI quota reached for this API key — try again tomorrow, or upgrade the Gemini API plan for a higher limit.")
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


# --- Chat persistence (survives refresh/restart; session id is client-generated
# and lives in localStorage, scoped server-side to the authenticated user) ----
@app.get("/api/chats/{session_id}")
def get_chat_session(session_id: str, user: dict = Depends(get_current_user)) -> dict:
    return db.get_chat(session_id, user["id"]) or {"id": session_id, "messages": []}


@app.post("/api/chats/{session_id}/messages")
def add_chat_message(session_id: str, body: ChatMessageCreate, user: dict = Depends(get_current_user)) -> dict:
    chat = db.append_chat_message(session_id, user["id"], body.role, body.content)
    if chat is None:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return chat


# --- Task CRUD ----------------------------------------------------------------
def _with_risk(task: dict, now: Optional[datetime] = None) -> dict:
    """Attach a live deadline-risk prediction (risk.py) to a task dict — never
    cached, so it's always computed against the current clock and current
    estimated/completed hours."""
    return {**task, "risk": risk.compute(task, now)}


@app.get("/api/tasks")
def get_tasks(user: dict = Depends(get_current_user)) -> List[dict]:
    now = datetime.now()
    return [_with_risk(t, now) for t in db.list_tasks(user["id"])]


@app.post("/api/tasks")
def add_task(body: TaskCreate, user: dict = Depends(get_current_user)) -> dict:
    created = db.create_task(
        user["id"],
        task_name=body.task_name,
        urgency=body.urgency.value,
        estimated_minutes=body.estimated_minutes,
        completed_minutes=body.completed_minutes,
        deadline=body.deadline,
        next_micro_step=body.next_micro_step,
        goal_id=body.goal_id,
        url=body.url,
        selected_text=body.selected_text,
        tags=body.tags,
        dependencies=body.dependencies,
    )
    return _with_risk(created)


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

    was_done = before["status"] == "COMPLETED"
    now_done = bool(updated) and updated["status"] == "COMPLETED"  # type: ignore[index]
    now_started = fields.get("status") == "IN_PROGRESS" and before["status"] != "IN_PROGRESS"

    # Long-term behavioral memory (memory.py): log the planned-vs-actual
    # timing for this lifecycle transition. Raw events only — never chat.
    if updated and now_started:
        db.log_task_event(user["id"], task_id, updated["task_name"], updated.get("tags"), "started",
                           before.get("scheduled_start"), before.get("scheduled_end"))
    if updated and now_done and not was_done:
        db.log_task_event(user["id"], task_id, updated["task_name"], updated.get("tags"), "completed",
                           before.get("scheduled_start"), before.get("scheduled_end"))

    # Keep a linked goal's progress in sync when a task is completed/reopened.
    goal_id = updated["goal_id"] if updated else None
    if goal_id:
        if now_done and not was_done:
            db.adjust_goal(goal_id, user["id"], 1)
        elif was_done and not now_done:
            db.adjust_goal(goal_id, user["id"], -1)

    # AI Workflow Builder: fire any ON_TASK_COMPLETE workflow whose keyword
    # appears in the task that just got completed.
    if now_done and not was_done and updated:
        task_name = updated["task_name"].lower()  # type: ignore[index]
        for wf in db.list_workflows(user["id"]):
            if not wf.get("active") or wf.get("trigger_type") != "ON_TASK_COMPLETE":
                continue
            if (wf.get("trigger_match") or "").lower() in task_name:
                run_workflow_now(wf["id"], user)  # noqa: F821 (defined below, same module)

    return _with_risk(updated) if updated else updated  # type: ignore[return-value]


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


# --- AI Search Assistant --------------------------------------------------------
@app.get("/api/search")
def search(q: str = "", user: dict = Depends(get_current_user)) -> dict:
    query = q.strip()
    if not query:
        return {"tasks": [], "goals": [], "habits": [], "sessions": []}
    candidates = search_mod.build_candidates(
        db.list_tasks(user["id"]), db.list_goals(user["id"]),
        db.list_habits_raw(user["id"]), db.list_sessions(user["id"]),
    )
    matches = search_mod.substring_match(query, candidates)
    if not matches:
        matches = engine.search_rank(query, candidates)
    return search_mod.group(matches)


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
    # Piggyback DAILY/WEEKLY workflow checks on this poll (frontend already
    # hits it every 60s for autonomous rescheduling) rather than standing up
    # a separate cron/worker just for this.
    _run_due_workflows(user["id"])
    now = datetime.now()
    tasks = db.list_tasks(user["id"])
    result = scheduler.analyze(tasks, now=now)
    # Deadline-risk prediction (risk.py) — distinct from the scheduler's
    # at_risk above (which is "would the deterministic pack finish late");
    # this is "is the user's actual pace on track to finish in time."
    result["risks"] = [r for r in (risk.compute(t, now) for t in tasks) if r]
    # Automatic task recovery: the "incomplete after end time" trigger fires
    # here, on the same 60s poll the frontend already runs — anything found
    # missed gets redistributed before the response goes out, and the
    # frontend surfaces `recovery.message` as a system note.
    result["recovery"] = _recover_and_persist(user["id"], [], now)  # noqa: F821 (defined below, same module)
    # Long-term behavioral memory: re-summarize once enough new events have
    # piled up since the last pass — see _run_auto_memory_summary's own gate,
    # this is best-effort and never raises.
    _run_auto_memory_summary(user["id"])  # noqa: F821 (defined below, same module)
    return result


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


# --- Automatic task recovery ---------------------------------------------------
def _recover_and_persist(user_id: str, task_ids: List[int], now: datetime) -> Optional[dict]:
    """Shared by the manual /api/tasks/recover endpoint, the explicit skip
    endpoint, and the auto-trigger piggybacked on /api/status. `task_ids`
    empty means auto-detect whatever's missed right now (scheduler.missed —
    "incomplete after end time"); a non-empty list means "recover exactly
    these tasks" (the explicit-skip / inactivity-detected triggers)."""
    all_tasks = db.list_tasks(user_id)
    by_id = {t["id"]: t for t in all_tasks}

    if task_ids:
        seeds = [by_id[i] for i in task_ids if i in by_id and by_id[i].get("status") not in ("COMPLETED", "ARCHIVED")]
    else:
        seeds = scheduler.missed(all_tasks, now=now)
    if not seeds:
        return None

    busy = _calendar_busy_window(user_id, now)
    moved = recovery.recover(seeds, all_tasks, now=now, busy=busy)
    if not moved:
        return None

    for m in moved:
        db.set_schedule(m["task_id"], user_id, m["new_start"].isoformat(), m["new_end"].isoformat())
    regen_reminders(user_id)

    lead = moved[0]
    summary = recovery.describe(lead["chunks"], now)
    extra = f" and {len(moved) - 1} dependent task(s) shifted to match" if len(moved) > 1 else ""
    message = f'Task moved due to missed session: "{lead["task_name"]}" — {summary}{extra}.'

    return {
        "tasks": db.list_tasks(user_id),
        "moved": [
            {**m, "new_start": m["new_start"].isoformat(), "new_end": m["new_end"].isoformat(),
             "chunks": [{"start": c["start"].isoformat(), "end": c["end"].isoformat()} for c in m["chunks"]]}
            for m in moved
        ],
        "message": message,
    }


@app.get("/api/tasks/free-slots")
def get_free_slots(user: dict = Depends(get_current_user)) -> List[dict]:
    now = datetime.now()
    busy = _calendar_busy_window(user["id"], now)
    occupied = busy + [
        (scheduler._parse(t["scheduled_start"]), scheduler._parse(t["scheduled_end"]))
        for t in db.list_tasks(user["id"])
        if t.get("scheduled_start") and t.get("scheduled_end")
    ]
    return [
        {"start": s["start"].isoformat(), "end": s["end"].isoformat(), "free_hours": s["free_hours"]}
        for s in recovery.find_free_slots(now, occupied)
    ]


@app.post("/api/tasks/recover")
def recover_missed_tasks(body: RecoverRequest, user: dict = Depends(get_current_user)) -> dict:
    result = _recover_and_persist(user["id"], body.task_ids, datetime.now())
    return result or {"tasks": db.list_tasks(user["id"]), "moved": [], "message": "Nothing to recover."}


@app.post("/api/tasks/{task_id}/skip")
def skip_task(task_id: int, user: dict = Depends(get_current_user)) -> dict:
    task = db.get_task(task_id, user["id"])
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    if task.get("status") in ("COMPLETED", "ARCHIVED"):
        raise HTTPException(status_code=400, detail="Task is already done.")
    db.log_task_event(user["id"], task_id, task["task_name"], task.get("tags"), "skipped",
                       task.get("scheduled_start"), task.get("scheduled_end"))
    result = _recover_and_persist(user["id"], [task_id], datetime.now())
    if not result:
        raise HTTPException(status_code=400, detail="Nothing left to move for this task.")
    return result


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


def _push_session_event(user_id: str, session: dict, scheduled_end: str) -> dict:
    """Best-effort create/update of the Google Calendar event mirroring a
    focus session — same push_event() the task scheduler uses, just fed a
    session-shaped dict instead of a task. No-op if Calendar isn't connected."""
    token = _calendar_access_token(user_id)
    if not token:
        return session
    event_id = calendar_sync.push_event(token, {
        "task_name": session.get("description") or "Focus Session",
        "next_micro_step": "",
        "scheduled_start": session["start_time"],
        "scheduled_end": scheduled_end,
        "calendar_event_id": session.get("calendar_event_id"),
    })
    if event_id and event_id != session.get("calendar_event_id"):
        updated = db.update_session(session["id"], user_id, calendar_event_id=event_id)
        if updated:
            return updated
    return session


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
    session = db.create_session(user["id"], description=body.description, project_id=body.project_id, duration_minutes=body.duration_minutes)

    # Auto-add to Google Calendar immediately, sized to the planned duration —
    # corrected to the real end time once the session actually stops.
    start = _as_utc(datetime.fromisoformat(session["start_time"]))
    planned_end = (start + timedelta(minutes=body.duration_minutes or 25)).isoformat()
    return _push_session_event(user["id"], session, planned_end)


@app.patch("/api/sessions/{session_id}")
def patch_session(session_id: int, body: SessionPatch, user: dict = Depends(get_current_user)) -> dict:
    if not db.get_session(session_id, user["id"]):
        raise HTTPException(status_code=404, detail="Session not found.")
    updated = db.update_session(session_id, user["id"], **body.model_dump(exclude_none=True))
    if body.end_time and updated:
        # The session just stopped — true-up the calendar event's end time to
        # when it actually ended instead of the originally planned duration.
        updated = _push_session_event(user["id"], updated, body.end_time)
    return updated  # type: ignore[return-value]


@app.delete("/api/sessions/{session_id}")
def remove_session(session_id: int, user: dict = Depends(get_current_user)) -> dict:
    session = db.get_session(session_id, user["id"])
    if session and session.get("calendar_event_id"):
        token = _calendar_access_token(user["id"])
        if token:
            calendar_sync.delete_event(token, session["calendar_event_id"])
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


# --- AI Workflow Builder ---------------------------------------------------------
@app.post("/api/workflows/generate")
def generate_workflow_draft(body: WorkflowGenerateRequest, user: dict = Depends(get_current_user)) -> dict:
    """Turn a plain-English SOP into a structured draft (trigger + steps) for
    the user to review — not saved yet, see POST /api/workflows for that."""
    if not body.sop_text.strip():
        raise HTTPException(status_code=400, detail="sop_text must not be empty.")
    if not engine.configured():
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured.")
    try:
        plan = engine.generate_workflow(body.sop_text)
    except Exception as err:  # noqa: BLE001
        print(f"[workflows/generate] Gemini call failed: {err!r}")
        if engine.is_quota_exhausted(err):
            raise HTTPException(status_code=429, detail="Daily AI quota reached for this API key — try again tomorrow, or upgrade the Gemini API plan for a higher limit.")
        if engine.is_transient(err):
            raise HTTPException(status_code=503, detail="The AI model is busy. Try again in a moment.")
        raise HTTPException(status_code=500, detail=str(err))
    return plan.model_dump()


@app.get("/api/workflows")
def get_workflows(user: dict = Depends(get_current_user)) -> List[dict]:
    return db.list_workflows(user["id"])


@app.post("/api/workflows")
def add_workflow(body: WorkflowCreate, user: dict = Depends(get_current_user)) -> dict:
    return db.create_workflow(
        user["id"], name=body.name, sop_text=body.sop_text, trigger_type=body.trigger_type.value,
        trigger_match=body.trigger_match, steps=[s.model_dump() for s in body.steps], active=body.active,
    )


@app.patch("/api/workflows/{workflow_id}")
def patch_workflow(workflow_id: int, body: WorkflowPatch, user: dict = Depends(get_current_user)) -> dict:
    if not db.get_workflow(workflow_id, user["id"]):
        raise HTTPException(status_code=404, detail="Workflow not found.")
    fields = body.model_dump(exclude_none=True)
    if "trigger_type" in fields:
        fields["trigger_type"] = body.trigger_type.value  # type: ignore[union-attr]
    if "steps" in fields:
        fields["steps"] = [s.model_dump() if hasattr(s, "model_dump") else s for s in body.steps]  # type: ignore[union-attr]
    return db.update_workflow(workflow_id, user["id"], **fields)  # type: ignore[return-value]


@app.delete("/api/workflows/{workflow_id}")
def remove_workflow(workflow_id: int, user: dict = Depends(get_current_user)) -> dict:
    if not db.delete_workflow(workflow_id, user["id"]):
        raise HTTPException(status_code=404, detail="Workflow not found.")
    return {"deleted": workflow_id}


@app.post("/api/workflows/{workflow_id}/run")
def run_workflow_now(workflow_id: int, user: dict = Depends(get_current_user)) -> dict:
    workflow = db.get_workflow(workflow_id, user["id"])
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found.")
    created = [
        db.create_task(user["id"], task_name=step["task_name"], urgency=step.get("urgency", "MEDIUM"),
                        estimated_minutes=step.get("estimated_minutes", 30), tags=step.get("tags", []))
        for step in workflow.get("steps", [])
    ]
    db.update_workflow(workflow_id, user["id"], last_run=datetime.now(timezone.utc).replace(microsecond=0).isoformat())
    return {"created": created}


def _run_due_workflows(user_id: str) -> None:
    """Run any active DAILY/WEEKLY workflow that hasn't fired in its current
    period yet. Best-effort — a workflow failing to run shouldn't break the
    /api/status poll that triggers this."""
    now = datetime.now(timezone.utc)
    for wf in db.list_workflows(user_id):
        if not wf.get("active") or wf.get("trigger_type") not in ("DAILY", "WEEKLY"):
            continue
        last_run = wf.get("last_run")
        due = True
        if last_run:
            try:
                last = _as_utc(datetime.fromisoformat(last_run))
                due = (last.date() != now.date()) if wf["trigger_type"] == "DAILY" \
                    else (last.isocalendar()[:2] != now.isocalendar()[:2])
            except ValueError:
                due = True
        if due:
            try:
                run_workflow_now(wf["id"], {"id": user_id})
            except Exception:  # noqa: BLE001 — never let a bad workflow break /api/status
                pass


# --- Long-term behavioral memory ---------------------------------------------
def _summarize_memory_now(user_id: str) -> list[dict]:
    events = db.list_task_events(user_id)
    stats = memory.compute_stats(events)
    result = engine.summarize_memory(memory.render_stats(stats))
    facts = db.set_memory_facts(user_id, result.facts)
    db.set_memory_checkpoint(user_id, len(events))
    return facts


def _run_auto_memory_summary(user_id: str) -> None:
    """Best-effort, piggybacked on the same /api/status poll as the other
    auto-triggers (see `status()`) — only actually calls Gemini once enough
    NEW events have piled up since the last pass, not on every 60s poll.
    A failure here (no API key, transient Gemini error) just means the next
    poll tries again — the checkpoint only advances on success."""
    if not engine.configured():
        return
    user = db.get_user(user_id) or {}
    last_count = user.get("memory_event_count", 0)
    event_count = len(db.list_task_events(user_id))
    if event_count - last_count < memory.MIN_EVENTS_TO_SUMMARIZE:
        return
    try:
        _summarize_memory_now(user_id)
    except Exception:  # noqa: BLE001
        pass


@app.get("/api/memory")
def get_memory(user: dict = Depends(get_current_user)) -> List[dict]:
    return db.get_memory_facts(user["id"])


@app.post("/api/memory/summarize")
def summarize_memory_now(user: dict = Depends(get_current_user)) -> List[dict]:
    if not engine.configured():
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured.")
    if not db.list_task_events(user["id"]):
        raise HTTPException(status_code=400, detail="Not enough activity yet to learn from.")
    try:
        return _summarize_memory_now(user["id"])
    except Exception as err:  # noqa: BLE001
        if engine.is_quota_exhausted(err):
            raise HTTPException(status_code=429, detail="Daily AI quota reached for this API key — try again tomorrow, or upgrade the Gemini API plan for a higher limit.")
        if engine.is_transient(err):
            raise HTTPException(status_code=503, detail="The AI model is busy. Try again in a moment.")
        raise HTTPException(status_code=500, detail=str(err))


# --- AI Task Decomposition ---------------------------------------------------
@app.post("/api/tasks/decompose")
def decompose_goal_draft(body: DecomposeRequest, user: dict = Depends(get_current_user)) -> dict:
    """Turn a vague goal into a draft execution graph (subtasks + dependencies)
    for the user to review — not saved yet, see POST /api/tasks/decompose/commit."""
    if not body.goal.strip():
        raise HTTPException(status_code=400, detail="goal must not be empty.")
    if not engine.configured():
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured.")
    try:
        plan = engine.decompose_goal(body.goal)
    except Exception as err:  # noqa: BLE001
        print(f"[tasks/decompose] Gemini call failed: {err!r}")
        if engine.is_quota_exhausted(err):
            raise HTTPException(status_code=429, detail="Daily AI quota reached for this API key — try again tomorrow, or upgrade the Gemini API plan for a higher limit.")
        if engine.is_transient(err):
            raise HTTPException(status_code=503, detail="The AI model is busy. Try again in a moment.")
        raise HTTPException(status_code=500, detail=str(err))
    return plan.model_dump()


@app.post("/api/tasks/decompose/commit")
def commit_decomposition(body: DecomposeCommitRequest, user: dict = Depends(get_current_user)) -> List[dict]:
    """Persist a reviewed decomposition draft as real tasks in the `tasks`
    collection, resolving each subtask's local draft id (only meaningful
    within this one request) to the real Firestore task id it's assigned —
    that remapped id list is what makes `dependencies` an actual execution
    graph other endpoints/UI can walk."""
    if not body.subtasks:
        raise HTTPException(status_code=400, detail="subtasks must not be empty.")

    id_map: dict[str, int] = {}
    created = []
    for s in body.subtasks:
        task = db.create_task(
            user["id"], task_name=s.title, urgency=s.priority.value,
            estimated_minutes=round(s.estimated_hours * 60),
        )
        id_map[s.id] = task["id"]
        created.append(task)

    result = []
    for s, task in zip(body.subtasks, created):
        dep_ids = [id_map[d] for d in s.depends_on if d in id_map and id_map[d] != task["id"]]
        result.append(db.update_task(task["id"], user["id"], dependencies=dep_ids) if dep_ids else task)
    return result

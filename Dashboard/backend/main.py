"""The Last-Minute Life Saver — FastAPI app.

Tier 1: task CRUD, AI prioritization (via the Gemini engine), AI scheduling,
autonomous rescheduling, and calendar (.ics) export.
"""

from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import os
try:
    if not os.environ.get("FIREBASE_CREDENTIALS") and not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        import db_mock as db
    else:
        import db
except Exception:
    import db_mock as db
import engine
import habits as habits_mod
import ics
import reminders as reminders_mod
import scheduler

app = FastAPI(title="Last-Minute Life Saver Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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


class TaskPatch(BaseModel):
    task_name: Optional[str] = None
    status: Optional[engine.Status] = None
    urgency: Optional[engine.Urgency] = None
    estimated_minutes: Optional[int] = None
    deadline: Optional[str] = None
    next_micro_step: Optional[str] = None
    goal_id: Optional[int] = None


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


class SessionPatch(BaseModel):
    description: Optional[str] = None
    project_id: Optional[int] = None
    end_time: Optional[str] = None


class ProjectCreate(BaseModel):
    name: str
    color: str = "#2563eb"


class ProjectPatch(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


def regen_reminders() -> None:
    """Refresh system-generated reminders from the current plan (keep CUSTOM ones)."""
    db.clear_auto_reminders()
    for r in reminders_mod.generate(db.list_tasks()):
        db.create_reminder(r["message"], r["remind_at"], r["kind"], r["task_id"])


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
def get_current_user() -> dict:
    """Get current authenticated user. Used by extension to sync auth state."""
    return {
        "id": "default-user",
        "email": "user@example.com",
        "name": "User",
        "picture": None,
    }


# --- Chat ---------------------------------------------------------------------
@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest) -> ChatResponse:
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message must not be empty.")
    if not engine.configured():
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured.")

    try:
        result = engine.chat(req.message, [t.model_dump() for t in req.history])
    except Exception as err:  # noqa: BLE001
        if engine.is_transient(err):
            raise HTTPException(status_code=503, detail="The AI model is busy. Try again in a moment.")
        raise HTTPException(status_code=500, detail=str(err))

    for task in result.app_state.tasks_to_update:
        db.upsert_from_engine(task.model_dump())

    return ChatResponse(
        chat_ui=result.chat_ui,
        current_mode=result.app_state.current_mode,
        agentic_action=result.app_state.agentic_action,
        system_trigger=result.app_state.system_trigger,
        tasks=db.list_tasks(),
    )


# --- Task CRUD ----------------------------------------------------------------
@app.get("/api/tasks")
def get_tasks() -> List[dict]:
    return db.list_tasks()


@app.post("/api/tasks")
def add_task(body: TaskCreate) -> dict:
    return db.create_task(
        task_name=body.task_name,
        urgency=body.urgency.value,
        estimated_minutes=body.estimated_minutes,
        deadline=body.deadline,
        next_micro_step=body.next_micro_step,
        goal_id=body.goal_id,
    )


@app.patch("/api/tasks/{task_id}")
def patch_task(task_id: int, body: TaskPatch) -> dict:
    before = db.get_task(task_id)
    if not before:
        raise HTTPException(status_code=404, detail="Task not found.")
    fields = body.model_dump(exclude_none=True)
    if "status" in fields:
        fields["status"] = body.status.value  # type: ignore[union-attr]
    if "urgency" in fields:
        fields["urgency"] = body.urgency.value  # type: ignore[union-attr]
    updated = db.update_task(task_id, **fields)

    # Keep a linked goal's progress in sync when a task is completed/reopened.
    goal_id = updated["goal_id"] if updated else None
    if goal_id:
        was_done = before["status"] == "COMPLETED"
        now_done = updated["status"] == "COMPLETED"  # type: ignore[index]
        if now_done and not was_done:
            db.adjust_goal(goal_id, 1)
        elif was_done and not now_done:
            db.adjust_goal(goal_id, -1)
    return updated  # type: ignore[return-value]


@app.delete("/api/tasks/{task_id}")
def remove_task(task_id: int) -> dict:
    if not db.delete_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found.")
    return {"deleted": task_id}


# --- AI scheduling ------------------------------------------------------------
@app.post("/api/schedule")
def schedule() -> dict:
    tasks = db.list_tasks()
    plan = scheduler.build_schedule(tasks)
    for block in plan["blocks"]:
        db.set_schedule(block["task_id"], block["scheduled_start"], block["scheduled_end"])
    regen_reminders()
    tasks = db.list_tasks()
    scheduled = sum(1 for b in plan["blocks"])
    message = engine.plan_message(
        f"I just time-blocked {scheduled} task(s) into the user's day. "
        f"{len(plan['at_risk'])} may finish after their deadline."
    )
    return {"tasks": tasks, "at_risk": plan["at_risk"], "message": message}


# --- Autonomous rescheduling --------------------------------------------------
@app.get("/api/status")
def status() -> dict:
    return scheduler.analyze(db.list_tasks())


@app.post("/api/reschedule")
def reschedule() -> dict:
    before = db.list_tasks()
    analysis = scheduler.analyze(before)
    plan = scheduler.build_schedule(before)

    moved: list[int] = []
    by_id = {t["id"]: t for t in before}
    for block in plan["blocks"]:
        prev = by_id.get(block["task_id"], {})
        if prev.get("scheduled_start") != block["scheduled_start"]:
            moved.append(block["task_id"])
        db.set_schedule(block["task_id"], block["scheduled_start"], block["scheduled_end"])
    regen_reminders()

    tasks = db.list_tasks()
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


# --- Calendar (.ics) ----------------------------------------------------------
@app.get("/api/calendar.ics")
def calendar_all() -> Response:
    body = ics.calendar(db.list_tasks())
    return Response(
        content=body,
        media_type="text/calendar",
        headers={"Content-Disposition": "attachment; filename=life-saver-plan.ics"},
    )


@app.get("/api/tasks/{task_id}.ics")
def calendar_one(task_id: int) -> Response:
    task = db.get_task(task_id)
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
def get_reminders() -> List[dict]:
    now = datetime.now()
    items = db.list_reminders()
    for r in items:
        try:
            r["due"] = datetime.fromisoformat(r["remind_at"]) <= now
        except ValueError:
            r["due"] = False
    return items


@app.post("/api/reminders")
def add_reminder(body: ReminderCreate) -> dict:
    return db.create_reminder(body.message, body.remind_at, "CUSTOM", body.task_id)


@app.post("/api/reminders/{reminder_id}/ack")
def acknowledge_reminder(reminder_id: int) -> dict:
    if not db.ack_reminder(reminder_id):
        raise HTTPException(status_code=404, detail="Reminder not found.")
    return {"acknowledged": reminder_id}


@app.delete("/api/reminders/{reminder_id}")
def remove_reminder(reminder_id: int) -> dict:
    if not db.delete_reminder(reminder_id):
        raise HTTPException(status_code=404, detail="Reminder not found.")
    return {"deleted": reminder_id}


# --- Goals (#7 goal tracking) -------------------------------------------------
@app.get("/api/goals")
def get_goals() -> List[dict]:
    return db.list_goals()


@app.post("/api/goals")
def add_goal(body: GoalCreate) -> dict:
    return db.create_goal(
        title=body.title, description=body.description, metric=body.metric,
        target_value=body.target_value, deadline=body.deadline,
    )


@app.patch("/api/goals/{goal_id}")
def patch_goal(goal_id: int, body: GoalPatch) -> dict:
    if not db.get_goal(goal_id):
        raise HTTPException(status_code=404, detail="Goal not found.")
    return db.update_goal(goal_id, **body.model_dump(exclude_none=True))  # type: ignore[return-value]


@app.post("/api/goals/{goal_id}/increment")
def increment_goal(goal_id: int, body: GoalIncrement) -> dict:
    updated = db.adjust_goal(goal_id, body.delta)
    if not updated:
        raise HTTPException(status_code=404, detail="Goal not found.")
    return updated


@app.delete("/api/goals/{goal_id}")
def remove_goal(goal_id: int) -> dict:
    if not db.delete_goal(goal_id):
        raise HTTPException(status_code=404, detail="Goal not found.")
    return {"deleted": goal_id}


# --- Habits (#8 habit tracking) -----------------------------------------------
@app.get("/api/habits")
def get_habits() -> List[dict]:
    return [habits_mod.present(h, db.habit_log_dates(h["id"])) for h in db.list_habits_raw()]


@app.post("/api/habits")
def add_habit(body: HabitCreate) -> dict:
    cadence = body.cadence if body.cadence in ("DAILY", "WEEKLY") else "DAILY"
    habit = db.create_habit(body.name, cadence)
    return habits_mod.present(habit, [])


@app.post("/api/habits/{habit_id}/check")
def check_habit(habit_id: int) -> dict:
    if not db.get_habit(habit_id):
        raise HTTPException(status_code=404, detail="Habit not found.")
    db.toggle_habit_today(habit_id)
    habit = db.get_habit(habit_id)
    return habits_mod.present(habit, db.habit_log_dates(habit_id))  # type: ignore[arg-type]


@app.delete("/api/habits/{habit_id}")
def remove_habit(habit_id: int) -> dict:
    if not db.delete_habit(habit_id):
        raise HTTPException(status_code=404, detail="Habit not found.")
    return {"deleted": habit_id}


# --- Sessions (#9 time tracking) ------------------------------------------------
@app.get("/api/sessions")
def get_sessions() -> List[dict]:
    return db.list_sessions()


@app.post("/api/sessions")
def add_session(body: SessionCreate) -> dict:
    return db.create_session(description=body.description, project_id=body.project_id)


@app.patch("/api/sessions/{session_id}")
def patch_session(session_id: int, body: SessionPatch) -> dict:
    if not db.get_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found.")
    return db.update_session(session_id, **body.model_dump(exclude_none=True))  # type: ignore[return-value]


@app.delete("/api/sessions/{session_id}")
def remove_session(session_id: int) -> dict:
    if not db.delete_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"deleted": session_id}


# --- Projects (#10 project tracking) --------------------------------------------
@app.get("/api/projects")
def get_projects() -> List[dict]:
    return db.list_projects()


@app.post("/api/projects")
def add_project(body: ProjectCreate) -> dict:
    return db.create_project(name=body.name, color=body.color)


@app.patch("/api/projects/{project_id}")
def patch_project(project_id: int, body: ProjectPatch) -> dict:
    if not db.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found.")
    return db.update_project(project_id, **body.model_dump(exclude_none=True))  # type: ignore[return-value]


@app.delete("/api/projects/{project_id}")
def remove_project(project_id: int) -> dict:
    if not db.delete_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found.")
    return {"deleted": project_id}

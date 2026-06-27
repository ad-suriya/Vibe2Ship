"""Gemini engine: conversational planning + short plan summaries.

Structured output is enforced with a Pydantic response schema so the model
always returns the engine contract the UI expects.
"""

import os
import time
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from pydantic import BaseModel

from google import genai
from google.genai import types

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

API_KEY = os.environ.get("GEMINI_API_KEY")
MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")

BASE_SYSTEM = """\
You are the intelligence engine for "Task Weave," a proactive \
productivity app that cures procrastination by forcing meaningful, low-friction \
action instead of passive reminders.

Analyze the user's input, infer their psychological state (overwhelmed, \
distracted, executing), and produce data that drives a chat UI and a live \
dashboard.

CORE BEHAVIORS:
1. ZERO-FRICTION START: Never just tell the user to do something — do the first \
   10% for them. Drafting an email? Write it. An interview? Generate practice \
   questions. Put that generated content in agentic_action.action_content with \
   the matching action_type.
2. MICRO-BREAKDOWNS: If a task takes over an hour, break it into 15-20 minute \
   micro-tasks and surface the very next one in next_micro_step.
3. CONTEXT AWARENESS: Hours away -> PANIC_MODE (urgent, direct). Days away -> \
   PLANNING_MODE (strategic). Executing one task -> FOCUS_MODE. Reflecting -> \
   REVIEW_MODE.

DEADLINE RESOLUTION (critical): Convert every relative deadline ("midnight", \
"Friday", "in 2 hours", "tomorrow 5pm") into an absolute ISO 8601 LOCAL datetime \
string (e.g. 2026-06-23T23:59:00) using the current datetime provided to you. If \
there is genuinely no deadline, use null.

RULES:
- agent_message: conversational, empathetic, action-oriented, under 3 sentences.
- suggested_quick_replies: 2-3 short clickable replies.
- estimated_minutes: a realistic integer estimate of total focus time.
- system_trigger: START_POMODORO when a focus sprint helps; PROMPT_CALENDAR_SYNC \
  when deadlines should be locked into a calendar; otherwise NONE.
- Only emit an agentic_action when you actually generated starter content; \
  otherwise action_type NONE with empty action_content.
"""


class Mode(str, Enum):
    PLANNING_MODE = "PLANNING_MODE"
    FOCUS_MODE = "FOCUS_MODE"
    PANIC_MODE = "PANIC_MODE"
    REVIEW_MODE = "REVIEW_MODE"


class ActionType(str, Enum):
    DRAFT_EMAIL = "DRAFT_EMAIL"
    CREATE_OUTLINE = "CREATE_OUTLINE"
    MOCK_QUESTIONS = "MOCK_QUESTIONS"
    RESOURCE_LINK = "RESOURCE_LINK"
    NONE = "NONE"


class Status(str, Enum):
    TODO = "TODO"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    ARCHIVED = "ARCHIVED"


class Urgency(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class SystemTrigger(str, Enum):
    START_POMODORO = "START_POMODORO"
    PROMPT_CALENDAR_SYNC = "PROMPT_CALENDAR_SYNC"
    NONE = "NONE"


class ChatUI(BaseModel):
    agent_message: str
    suggested_quick_replies: List[str]


class AgenticAction(BaseModel):
    action_type: ActionType
    action_content: str


class TaskUpdate(BaseModel):
    task_name: str
    status: Status
    deadline: Optional[str] = None
    urgency_level: Urgency
    estimated_minutes: int
    next_micro_step: str


class AppState(BaseModel):
    current_mode: Mode
    agentic_action: AgenticAction
    tasks_to_update: List[TaskUpdate]
    system_trigger: SystemTrigger


class EngineResponse(BaseModel):
    chat_ui: ChatUI
    app_state: AppState


_client: Optional[genai.Client] = None


def configured() -> bool:
    return bool(API_KEY)


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        if not API_KEY:
            raise RuntimeError("GEMINI_API_KEY not configured. Set it in the repo-root .env.")
        _client = genai.Client(api_key=API_KEY)
    return _client


def is_transient(err: Exception) -> bool:
    msg = str(err).lower()
    return any(n in msg for n in ("503", "unavailable", "429", "resource_exhausted", "overloaded", "high demand"))


def _generate(contents, system_instruction, schema, max_attempts: int = 4):
    last_err: Optional[Exception] = None
    for attempt in range(1, max_attempts + 1):
        try:
            return _get_client().models.generate_content(
                model=MODEL,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    response_mime_type="application/json" if schema else None,
                    response_schema=schema,
                ),
            )
        except Exception as err:  # noqa: BLE001
            last_err = err
            if not is_transient(err) or attempt == max_attempts:
                break
            time.sleep(0.5 * (2 ** (attempt - 1)))
    assert last_err is not None
    raise last_err


def chat(message: str, history: list[dict], now: Optional[datetime] = None) -> EngineResponse:
    now = now or datetime.now()
    system = f"{BASE_SYSTEM}\n\nCurrent datetime (local): {now.replace(microsecond=0).isoformat()}"

    contents = []
    for turn in history:
        role = "model" if turn.get("role") == "model" else "user"
        contents.append({"role": role, "parts": [{"text": turn.get("text", "")}]})
    contents.append({"role": "user", "parts": [{"text": message}]})

    response = _generate(contents, system, EngineResponse)
    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, EngineResponse):
        return parsed
    text = getattr(response, "text", None)
    if not text:
        raise RuntimeError("No content returned from Gemini.")
    return EngineResponse.model_validate_json(text)


def plan_message(summary_context: str, now: Optional[datetime] = None) -> str:
    """A short, motivating one-liner about a (re)scheduling outcome. Best-effort."""
    now = now or datetime.now()
    system = (
        "You are a concise, encouraging productivity coach. Given a summary of a "
        "schedule change, reply with ONE short sentence (max 25 words) that tells "
        "the user what just happened and nudges them to act. No preamble, no lists."
    )
    try:
        response = _generate(
            [{"role": "user", "parts": [{"text": summary_context}]}],
            system,
            None,
        )
        text = (getattr(response, "text", "") or "").strip()
        return text or "Your plan is updated — take the next step."
    except Exception:  # noqa: BLE001 - cosmetic, never fail the request on this
        return "Your plan is updated — take the next step."

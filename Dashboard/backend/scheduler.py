"""Deterministic time-blocking scheduler + overdue/at-risk detection.

AI prioritization (urgency) comes from the Gemini engine; this module turns the
prioritized tasks into a concrete, conflict-free day plan with real datetimes,
so we never depend on the model to do date arithmetic.
"""

from datetime import datetime, timedelta
from typing import Optional

WORK_START_HOUR = 8
WORK_END_HOUR = 22
BREAK_MINUTES = 10
MAX_BLOCK_MINUTES = 50  # long tasks are split into focus blocks
URGENCY_RANK = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
FAR_FUTURE = datetime.max


def _parse(dt: Optional[str]) -> Optional[datetime]:
    if not dt:
        return None
    try:
        return datetime.fromisoformat(dt)
    except ValueError:
        return None


def _next_work_slot(cursor: datetime) -> datetime:
    """Advance the cursor to the next moment inside working hours."""
    if cursor.hour < WORK_START_HOUR:
        return cursor.replace(hour=WORK_START_HOUR, minute=0, second=0, microsecond=0)
    if cursor.hour >= WORK_END_HOUR:
        nxt = cursor + timedelta(days=1)
        return nxt.replace(hour=WORK_START_HOUR, minute=0, second=0, microsecond=0)
    return cursor.replace(second=0, microsecond=0)


def _next_free_slot(cursor: datetime, busy: list[tuple[datetime, datetime]]) -> datetime:
    """Push the cursor past any Google Calendar event it would otherwise land in."""
    for start, end in busy:
        if start <= cursor < end:
            return end
    return cursor


def _priority_key(task: dict):
    deadline = _parse(task.get("deadline")) or FAR_FUTURE
    return (URGENCY_RANK.get(task.get("urgency", "MEDIUM"), 1), deadline, task["id"])


def build_schedule(tasks: list[dict], now: Optional[datetime] = None,
                    busy: Optional[list[tuple[datetime, datetime]]] = None) -> dict:
    """Pack non-completed tasks into time blocks starting from `now`.

    `busy` is a list of (start, end) windows already occupied on the user's
    real Google Calendar (read via calendar_sync.list_busy) — blocks are
    routed around them so the plan never double-books an existing event.

    Returns {"blocks": [{task_id, scheduled_start, scheduled_end}], "at_risk": [task_id]}.
    """
    now = now or datetime.now()
    busy = sorted(busy or [])
    open_tasks = [t for t in tasks if t.get("status") not in ("COMPLETED", "ARCHIVED")]
    ordered = sorted(open_tasks, key=_priority_key)

    cursor = _next_work_slot(now.replace(second=0, microsecond=0))
    blocks: list[dict] = []
    at_risk: list[int] = []

    for task in ordered:
        remaining = max(15, int(task.get("estimated_minutes") or 30))
        first_start: Optional[datetime] = None
        last_end: Optional[datetime] = None

        while remaining > 0:
            cursor = _next_work_slot(cursor)
            cursor = _next_free_slot(cursor, busy)
            cursor = _next_work_slot(cursor)
            # Minutes left in the working day from the cursor.
            day_end = cursor.replace(hour=WORK_END_HOUR, minute=0, second=0, microsecond=0)
            minutes_left_today = int((day_end - cursor).total_seconds() // 60)
            chunk = min(remaining, MAX_BLOCK_MINUTES, minutes_left_today)
            # Don't run into a later busy event today.
            upcoming = [b_start for b_start, _ in busy if cursor < b_start < day_end]
            if upcoming:
                chunk = min(chunk, int((min(upcoming) - cursor).total_seconds() // 60))
            if chunk <= 0:
                # No room today; jump to tomorrow's work start.
                cursor = _next_work_slot(day_end)
                continue
            start = cursor
            end = start + timedelta(minutes=chunk)
            if first_start is None:
                first_start = start
            last_end = end
            remaining -= chunk
            cursor = end + timedelta(minutes=BREAK_MINUTES)

        blocks.append({
            "task_id": task["id"],
            "scheduled_start": first_start.isoformat() if first_start else None,
            "scheduled_end": last_end.isoformat() if last_end else None,
        })

        deadline = _parse(task.get("deadline"))
        if deadline and last_end and last_end > deadline:
            at_risk.append(task["id"])

    return {"blocks": blocks, "at_risk": at_risk}


def analyze(tasks: list[dict], now: Optional[datetime] = None) -> dict:
    """Detect overdue / slipped / at-risk tasks and whether a reschedule helps."""
    now = now or datetime.now()
    overdue: list[int] = []   # deadline passed, not completed
    slipped: list[int] = []   # scheduled block started in the past, still TODO
    at_risk: list[int] = []   # scheduled to finish after its deadline

    for t in tasks:
        if t.get("status") in ("COMPLETED", "ARCHIVED"):
            continue
        deadline = _parse(t.get("deadline"))
        sched_start = _parse(t.get("scheduled_start"))
        sched_end = _parse(t.get("scheduled_end"))
        if deadline and deadline < now:
            overdue.append(t["id"])
        if sched_start and sched_start < now and t.get("status") == "TODO":
            slipped.append(t["id"])
        if deadline and sched_end and sched_end > deadline:
            at_risk.append(t["id"])

    recommend = bool(slipped or at_risk)
    return {
        "now": now.replace(microsecond=0).isoformat(),
        "overdue": overdue,
        "slipped": slipped,
        "at_risk": at_risk,
        "recommend_reschedule": recommend,
    }

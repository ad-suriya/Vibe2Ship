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


def _priority_key(task: dict):
    deadline = _parse(task.get("deadline")) or FAR_FUTURE
    return (URGENCY_RANK.get(task.get("urgency", "MEDIUM"), 1), deadline, task["id"])


def build_schedule(tasks: list[dict], now: Optional[datetime] = None) -> dict:
    """Pack non-completed tasks into time blocks starting from `now`.

    Returns {"blocks": [{task_id, scheduled_start, scheduled_end}], "at_risk": [task_id]}.
    """
    now = now or datetime.now()
    open_tasks = [t for t in tasks if t.get("status") != "COMPLETED"]
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
            # Minutes left in the working day from the cursor.
            day_end = cursor.replace(hour=WORK_END_HOUR, minute=0, second=0, microsecond=0)
            minutes_left_today = int((day_end - cursor).total_seconds() // 60)
            chunk = min(remaining, MAX_BLOCK_MINUTES, minutes_left_today)
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
        if t.get("status") == "COMPLETED":
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

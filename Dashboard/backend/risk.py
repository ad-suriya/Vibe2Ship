"""Real-time deadline-risk prediction.

Computed live (not stored) every time a task is read or patched, so it's
always derived from the current clock and current field values — there's no
separate job to "run hourly" or "after inactivity"; those are just how often
the frontend re-fetches and re-renders this calculation (see App.tsx's status
poll + visibility-change refetch).

    remainingWork       = estimatedHours - completedHours
    usableTime          = hours between now and deadline, at a default of
                           PRODUCTIVE_HOURS_PER_DAY productive hours/day
    productivityFactor  = completedHours / plannedHours, where plannedHours
                           is how many hours SHOULD be done by now under a
                           straight-line pace from task creation to deadline
                           (an "earned schedule" baseline — completedHours
                           alone has no scale without it). Defaults to 1.0
                           while a task is too new to judge pace, and is
                           clamped so one data point can't send the score to
                           zero or infinity.
    effectiveTime       = usableTime * productivityFactor
    riskScore           = remainingWork / effectiveTime

    < 0.7  -> safe
    0.7-1  -> medium
    > 1    -> high
"""

from datetime import datetime
from typing import Optional

PRODUCTIVE_HOURS_PER_DAY = 5.0
SAFE_THRESHOLD = 0.7
HIGH_THRESHOLD = 1.0
MIN_PRODUCTIVITY_FACTOR = 0.4
MAX_PRODUCTIVITY_FACTOR = 1.3
OVERRUN_RISK_SCORE = 3.0  # deadline already passed (or zero time left) with work remaining

LEVEL_LABEL = {"safe": "On track", "medium": "Tight", "high": "High risk"}


def _parse(dt: Optional[str]) -> Optional[datetime]:
    """Parses to a naive datetime. created_at/updated_at are stored
    timezone-aware (UTC, see db.now_iso); deadline/scheduled_* are naive
    local-time strings the frontend writes (see scheduler.py). Stripping
    tzinfo here keeps every datetime in this module comparable/subtractable
    without crashing on aware-vs-naive arithmetic."""
    if not dt:
        return None
    try:
        parsed = datetime.fromisoformat(dt)
    except ValueError:
        return None
    # Convert to local-naive (not just strip tzinfo) so an aware UTC
    # created_at lines up with the naive local-time deadline/now it gets
    # subtracted against, instead of silently sitting off by the UTC offset.
    return parsed.astimezone().replace(tzinfo=None) if parsed.tzinfo else parsed


def _fmt_hours(h: float) -> str:
    return f"{h:.1f}".rstrip("0").rstrip(".") or "0"


def compute(task: dict, now: Optional[datetime] = None) -> Optional[dict]:
    """Risk for one task, or None if it can't carry a score (no deadline, or
    already done — there's nothing left to miss)."""
    if task.get("status") in ("COMPLETED", "ARCHIVED"):
        return None
    deadline = _parse(task.get("deadline"))
    if not deadline:
        return None
    now = now or datetime.now()

    estimated_hours = (task.get("estimated_minutes") or 0) / 60
    completed_hours = (task.get("completed_minutes") or 0) / 60
    remaining_hours = max(0.0, estimated_hours - completed_hours)

    days_left = max(0.0, (deadline - now).total_seconds() / 86400)
    usable_hours = days_left * PRODUCTIVE_HOURS_PER_DAY

    created_at = _parse(task.get("created_at")) or now
    total_span_hours = max(1e-6, (deadline - created_at).total_seconds() / 3600)
    elapsed_hours = max(0.0, (now - created_at).total_seconds() / 3600)
    planned_hours = estimated_hours * min(1.0, elapsed_hours / total_span_hours)

    if planned_hours < 0.25:  # too early in the task's life to judge pace
        productivity_factor = 1.0
    else:
        productivity_factor = completed_hours / planned_hours
    productivity_factor = max(MIN_PRODUCTIVITY_FACTOR, min(MAX_PRODUCTIVITY_FACTOR, productivity_factor))

    effective_hours = usable_hours * productivity_factor

    if remaining_hours <= 0:
        risk_score = 0.0
    elif effective_hours <= 0:
        risk_score = OVERRUN_RISK_SCORE
    else:
        risk_score = remaining_hours / effective_hours

    if risk_score < SAFE_THRESHOLD:
        level = "safe"
    elif risk_score <= HIGH_THRESHOLD:
        level = "medium"
    else:
        level = "high"

    if deadline < now and remaining_hours > 0:
        reason = f"Deadline passed with {_fmt_hours(remaining_hours)}h of work still remaining."
    else:
        reason = f"{LEVEL_LABEL[level]}: {_fmt_hours(remaining_hours)}h left, only {_fmt_hours(usable_hours)}h realistically available."

    return {
        "task_id": task["id"],
        "risk_score": round(risk_score, 2),
        "risk_percent": round(risk_score * 100),
        "risk_level": level,
        "remaining_hours": round(remaining_hours, 1),
        "usable_hours": round(usable_hours, 1),
        "productivity_factor": round(productivity_factor, 2),
        "reason": reason,
    }

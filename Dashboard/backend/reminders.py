"""Context-aware reminder generation from the current task plan."""

from datetime import datetime, timedelta
from typing import Optional

DEADLINE_LEAD_MINUTES = 60


def _parse(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def generate(tasks: list[dict], now: Optional[datetime] = None) -> list[dict]:
    """Derive reminders from scheduled focus blocks and approaching deadlines.

    Only future reminders are returned (no point alerting about past moments).
    """
    now = now or datetime.now()
    out: list[dict] = []

    for t in tasks:
        if t.get("status") == "COMPLETED":
            continue

        start = _parse(t.get("scheduled_start"))
        if start and start > now:
            out.append({
                "task_id": t["id"],
                "message": f"Time to start: {t['task_name']}",
                "remind_at": start.replace(microsecond=0).isoformat(),
                "kind": "FOCUS_START",
            })

        deadline = _parse(t.get("deadline"))
        if deadline:
            lead = deadline - timedelta(minutes=DEADLINE_LEAD_MINUTES)
            when = lead if lead > now else now + timedelta(minutes=1)
            if when < deadline:
                out.append({
                    "task_id": t["id"],
                    "message": f"Deadline approaching: {t['task_name']} is due at {deadline.strftime('%H:%M')}",
                    "remind_at": when.replace(microsecond=0).isoformat(),
                    "kind": "DEADLINE",
                })

    return out

"""Minimal iCalendar (.ics) generation — no external dependencies.

Emits floating local datetimes (no trailing Z) so calendars interpret the
times in the user's own timezone.
"""

from datetime import datetime, timedelta
from typing import Optional


def _fmt(dt: datetime) -> str:
    return dt.strftime("%Y%m%dT%H%M%S")


def _parse(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _event_window(task: dict) -> tuple[datetime, datetime]:
    """Pick the best (start, end) for a task: scheduled block, else deadline-anchored."""
    start = _parse(task.get("scheduled_start"))
    end = _parse(task.get("scheduled_end"))
    if start and end:
        return start, end
    deadline = _parse(task.get("deadline"))
    if deadline:
        dur = max(15, int(task.get("estimated_minutes") or 30))
        return deadline - timedelta(minutes=dur), deadline
    # No timing info: a 30-min block starting now.
    now = datetime.now().replace(second=0, microsecond=0)
    return now, now + timedelta(minutes=30)


def _escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _vevent(task: dict) -> list[str]:
    start, end = _event_window(task)
    stamp = datetime.now().strftime("%Y%m%dT%H%M%S")
    desc = task.get("next_micro_step") or ""
    if task.get("deadline"):
        desc = f"{desc}\nDeadline: {task['deadline']}"
    return [
        "BEGIN:VEVENT",
        f"UID:taskweave-task-{task['id']}@task-weave",
        f"DTSTAMP:{stamp}",
        f"DTSTART:{_fmt(start)}",
        f"DTEND:{_fmt(end)}",
        f"SUMMARY:{_escape(task['task_name'])}",
        f"DESCRIPTION:{_escape(desc)}",
        "END:VEVENT",
    ]


def calendar(tasks: list[dict]) -> str:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Task Weave//EN",
        "CALSCALE:GREGORIAN",
    ]
    for task in tasks:
        lines += _vevent(task)
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"

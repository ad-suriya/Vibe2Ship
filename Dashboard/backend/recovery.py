"""Automatic task recovery.

When a task is missed — its scheduled block ended incomplete, the user
explicitly skips it, or they've gone idle on it — this recalculates what's
left (scheduler.remaining_minutes, which already nets out completed_minutes),
finds the nearest real free time, and greedily redistributes the work into
it. Anything that depends on the moved task (db.py's `dependencies`) gets
cascaded automatically, so "backend depends on frontend" means backend's
slot shifts the moment frontend's does.
"""

from datetime import datetime, timedelta
from typing import Optional

import scheduler

FREE_SLOT_HORIZON_DAYS = 7


def _push_past_busy(cursor: datetime, busy: list[tuple[datetime, datetime]]) -> datetime:
    """scheduler._next_free_slot only resolves ONE overlapping busy window
    per call — if two windows are back-to-back (e.g. a just-recovered task's
    new block ends exactly when another task's block begins), a single call
    can land the cursor exactly on the next window's start without seeing
    it. Loop to a fixed point so the cursor is never inside (or sitting on
    the start of) any busy window in the same pass."""
    moved = True
    while moved:
        moved = False
        for start, end in busy:
            if start <= cursor < end:
                cursor = end
                moved = True
    return cursor


def find_free_slots(now: datetime, busy: list[tuple[datetime, datetime]],
                     horizon_days: int = FREE_SLOT_HORIZON_DAYS) -> list[dict]:
    """Working-hours gaps between `busy` windows (calendar events + other
    tasks' scheduled blocks), from `now` out to `horizon_days`:
    [{"start": dt, "end": dt, "free_hours": float}, ...], nearest first."""
    busy = sorted(busy)
    horizon_end = now + timedelta(days=horizon_days)
    cursor = scheduler._next_work_slot(now.replace(second=0, microsecond=0))
    slots: list[dict] = []

    for _ in range(2000):  # generous bound; a real horizon never needs this many hops
        if cursor >= horizon_end:
            break
        cursor = scheduler._next_work_slot(cursor)
        cursor = _push_past_busy(cursor, busy)
        cursor = scheduler._next_work_slot(cursor)
        day_end = cursor.replace(hour=scheduler.WORK_END_HOUR, minute=0, second=0, microsecond=0)
        if cursor >= day_end:
            cursor = scheduler._next_work_slot(day_end)
            continue
        upcoming = [b_start for b_start, _ in busy if cursor < b_start < day_end]
        slot_end = min([day_end, *upcoming])
        if slot_end > cursor:
            slots.append({
                "start": cursor, "end": slot_end,
                "free_hours": round((slot_end - cursor).total_seconds() / 3600, 2),
            })
        cursor = slot_end
    return slots


def _consume_slots(slots: list[dict], minutes_needed: int) -> list[dict]:
    """Greedily eats from the front of `slots` (nearest first) until
    `minutes_needed` is covered — split across slots/days using the same
    MAX_BLOCK_MINUTES focus-block chunking as the main scheduler."""
    chunks: list[dict] = []
    remaining = minutes_needed
    for slot in slots:
        if remaining <= 0:
            break
        cursor, slot_end = slot["start"], slot["end"]
        while remaining > 0 and cursor < slot_end:
            minutes_left = int((slot_end - cursor).total_seconds() // 60)
            chunk = min(remaining, scheduler.MAX_BLOCK_MINUTES, minutes_left)
            if chunk <= 0:
                break
            start = cursor
            end = start + timedelta(minutes=chunk)
            chunks.append({"start": start, "end": end})
            remaining -= chunk
            cursor = end + timedelta(minutes=scheduler.BREAK_MINUTES)
    return chunks


def _day_label(dt: datetime, now: datetime) -> str:
    delta_days = (dt.date() - now.date()).days
    if delta_days == 0:
        return "tonight" if dt.hour >= 17 else "today"
    if delta_days == 1:
        return "tomorrow morning" if dt.hour < 12 else "tomorrow"
    return dt.strftime("%a")


def _fmt_hours(h: float) -> str:
    return f"{h:.1f}".rstrip("0").rstrip(".") or "0"


def describe(chunks: list[dict], now: datetime) -> str:
    """"2h tonight, 1h tomorrow morning" — the human-readable redistribution
    summary from the spec's own example. Chunks are split into ~50min focus
    blocks internally (same convention as the main scheduler), so same-day
    chunks are summed into one total rather than listed block by block."""
    totals: dict[str, float] = {}
    order: list[str] = []
    for c in chunks:
        label = _day_label(c["start"], now)
        if label not in totals:
            totals[label] = 0.0
            order.append(label)
        totals[label] += (c["end"] - c["start"]).total_seconds() / 3600
    return ", ".join(f"{_fmt_hours(totals[label])}h {label}" for label in order)


def recover(seed_tasks: list[dict], all_tasks: list[dict], now: datetime,
            busy: list[tuple[datetime, datetime]]) -> list[dict]:
    """Reschedules each seed task into the nearest free time, cascading to
    every task that depends on it (directly or transitively). `busy` should
    be the user's real Google Calendar busy windows — other tasks' own
    scheduled blocks are added in automatically as recovery proceeds, so two
    recovered tasks in the same batch can never collide.

    Returns a list of moves: [{task_id, task_name, old_start, old_end,
    new_start, new_end, chunks}] with datetimes left as datetimes — the
    caller (main.py) persists them and serializes the response."""
    by_id = {t["id"]: t for t in all_tasks}
    moved: list[dict] = []
    visited: set[int] = set()
    occupied = list(busy)

    def others_occupied() -> list[tuple[datetime, datetime]]:
        out = list(occupied)
        for t in by_id.values():
            if t["id"] in visited:
                continue
            start = scheduler._parse(t.get("scheduled_start"))
            end = scheduler._parse(t.get("scheduled_end"))
            if start and end:
                out.append((start, end))
        return out

    def recover_one(task: dict, earliest: datetime) -> None:
        if task["id"] in visited:
            return
        visited.add(task["id"])

        remaining = scheduler.remaining_minutes(task)
        if remaining <= 0:
            return

        slots = find_free_slots(max(now, earliest), others_occupied())
        chunks = _consume_slots(slots, remaining)
        if not chunks:
            return

        new_start, new_end = chunks[0]["start"], chunks[-1]["end"]
        occupied.append((new_start, new_end))
        moved.append({
            "task_id": task["id"],
            "task_name": task.get("task_name", ""),
            "old_start": task.get("scheduled_start"),
            "old_end": task.get("scheduled_end"),
            "new_start": new_start,
            "new_end": new_end,
            "chunks": chunks,
        })

        # Preserve dependencies: anything blocked on this task can't start
        # before it now finishes, so it shifts automatically.
        for other in by_id.values():
            if task["id"] in (other.get("dependencies") or []):
                recover_one(other, new_end)

    for seed in seed_tasks:
        recover_one(seed, now)

    return moved

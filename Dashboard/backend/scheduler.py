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


def _push_past_busy(cursor: datetime, busy: list[tuple[datetime, datetime]]) -> datetime:
    """_next_free_slot only resolves ONE overlapping window per call — if two
    windows are back-to-back (e.g. one task's block ends exactly when
    another's begins), a single call can land the cursor exactly on the next
    window's start without seeing it. Loop to a fixed point so the cursor is
    never inside (or sitting on the start of) any busy window in one pass."""
    moved = True
    while moved:
        moved = False
        for start, end in busy:
            if start <= cursor < end:
                cursor = end
                moved = True
    return cursor


FREE_SLOT_HORIZON_DAYS = 7


def find_free_slots(now: datetime, busy: list[tuple[datetime, datetime]],
                     horizon_days: int = FREE_SLOT_HORIZON_DAYS) -> list[dict]:
    """Working-hours gaps between `busy` windows (calendar events + other
    tasks' scheduled blocks), from `now` out to `horizon_days`:
    [{"start": dt, "end": dt, "free_hours": float}, ...], nearest first."""
    busy = sorted(busy)
    horizon_end = now + timedelta(days=horizon_days)
    cursor = _next_work_slot(now.replace(second=0, microsecond=0))
    slots: list[dict] = []

    for _ in range(2000):  # generous bound; a real horizon never needs this many hops
        if cursor >= horizon_end:
            break
        cursor = _next_work_slot(cursor)
        cursor = _push_past_busy(cursor, busy)
        cursor = _next_work_slot(cursor)
        day_end = cursor.replace(hour=WORK_END_HOUR, minute=0, second=0, microsecond=0)
        if cursor >= day_end:
            cursor = _next_work_slot(day_end)
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


def pack_chunks(slots: list[dict], minutes_needed: int) -> list[dict]:
    """Greedily eats from the front of `slots` (nearest first) until
    `minutes_needed` is covered, split into MAX_BLOCK_MINUTES focus blocks
    with a BREAK_MINUTES gap between them — the actual time-blocking, once
    `find_free_slots` has already worked out where the gaps are."""
    chunks: list[dict] = []
    remaining = minutes_needed
    for slot in slots:
        if remaining <= 0:
            break
        cursor, slot_end = slot["start"], slot["end"]
        while remaining > 0 and cursor < slot_end:
            minutes_left = int((slot_end - cursor).total_seconds() // 60)
            chunk = min(remaining, MAX_BLOCK_MINUTES, minutes_left)
            if chunk <= 0:
                break
            start = cursor
            end = start + timedelta(minutes=chunk)
            chunks.append({"start": start, "end": end})
            remaining -= chunk
            cursor = end + timedelta(minutes=BREAK_MINUTES)
    return chunks


def _priority_key(task: dict):
    deadline = _parse(task.get("deadline")) or FAR_FUTURE
    return (URGENCY_RANK.get(task.get("urgency", "MEDIUM"), 1), deadline, task["id"])


def remaining_minutes(task: dict) -> int:
    """Work left to do, net of what's already logged (completed_minutes —
    see risk.py) — a task that's half done shouldn't be re-packed as if
    nothing had been logged against it."""
    estimated = int(task.get("estimated_minutes") or 30)
    completed = int(task.get("completed_minutes") or 0)
    return max(0, estimated - completed)


def missed(tasks: list[dict], now: Optional[datetime] = None) -> list[dict]:
    """Tasks whose scheduled block has ENDED while they're still not done —
    "incomplete after end time," distinct from `analyze()`'s `slipped`
    (which only checks the block's start). Returns full task dicts (not just
    ids) since recovery.py needs the rest of the fields to redistribute them."""
    now = now or datetime.now()
    out = []
    for t in tasks:
        if t.get("status") not in ("TODO", "IN_PROGRESS"):
            continue
        sched_end = _parse(t.get("scheduled_end"))
        if sched_end and sched_end < now and remaining_minutes(t) > 0:
            out.append(t)
    return out


def build_schedule(tasks: list[dict], now: Optional[datetime] = None,
                    busy: Optional[list[tuple[datetime, datetime]]] = None) -> dict:
    """Dependency-aware time-blocking engine: place every open task (and any
    AI-decomposed subtask) into the earliest valid free slot.

    1. Sort by priority + deadline (`_priority_key`).
    2. Respect dependencies — a task only becomes eligible once every
       dependency in `tasks` is either COMPLETED or has itself already been
       placed in this same pass; among eligible tasks, priority+deadline
       picks which goes next (a topological sort with priority tie-breaks,
       not a plain sort).
    3. Assign the earliest slot at/after both the real Calendar `busy`
       windows AND the task's own dependency floor (the latest end-time
       among its dependencies placed so far) — every previously-placed
       block in this pass is added to `busy` too, so no two tasks can ever
       overlap regardless of the order dependencies pushed them into.

    Calling this again from the task list's current state (as
    /api/reschedule already does) re-derives the whole plan from scratch,
    so it's reschedulable for free — there's no separate "incremental" path
    to keep in sync.

    Returns {"blocks": [{task_id, scheduled_start, scheduled_end}], "at_risk": [task_id]}.
    """
    now = now or datetime.now()
    by_id = {t["id"]: t for t in tasks}
    pending = {t["id"]: t for t in tasks if t.get("status") not in ("COMPLETED", "ARCHIVED")}

    occupied = sorted(busy or [])
    end_of: dict[int, datetime] = {}
    placed: set[int] = set()
    blocks: list[dict] = []
    at_risk: list[int] = []

    def dependency_satisfied(dep_id: int) -> bool:
        dep = by_id.get(dep_id)
        if dep is None:
            return True  # dangling reference (e.g. dependency deleted) — don't block on it
        return dep.get("status") in ("COMPLETED", "ARCHIVED") or dep_id in placed

    def dependency_floor(task: dict) -> datetime:
        floor = now
        for dep_id in task.get("dependencies") or []:
            if dep_id in end_of:
                floor = max(floor, end_of[dep_id])
        return floor

    while pending:
        ready = [t for t in pending.values() if all(dependency_satisfied(d) for d in (t.get("dependencies") or []))]
        if not ready:
            # Every remaining task is blocked on something that'll never be
            # satisfied (a cycle, or a dependency on a task stuck TODO that
            # never gets placed) — schedule what's left anyway rather than
            # silently dropping tasks; their floor just won't reflect it.
            ready = list(pending.values())
        ready.sort(key=_priority_key)
        task = ready[0]
        del pending[task["id"]]

        floor = dependency_floor(task)
        slots = find_free_slots(max(now, floor), occupied)
        chunks = pack_chunks(slots, max(15, remaining_minutes(task)))

        placed.add(task["id"])  # placed-but-unscheduled (no room found) still satisfies dependents
        if not chunks:
            blocks.append({"task_id": task["id"], "scheduled_start": None, "scheduled_end": None})
            continue

        first_start, last_end = chunks[0]["start"], chunks[-1]["end"]
        end_of[task["id"]] = last_end
        occupied.append((first_start, last_end))
        blocks.append({
            "task_id": task["id"],
            "scheduled_start": first_start.isoformat(),
            "scheduled_end": last_end.isoformat(),
        })

        deadline = _parse(task.get("deadline"))
        if deadline and last_end > deadline:
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

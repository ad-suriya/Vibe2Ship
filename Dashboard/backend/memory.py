"""Long-term behavioral memory.

Turns the raw task_events log (planned vs. actual timing per task lifecycle
transition — see db.log_task_event) into a handful of compact, durable
facts about how the user actually works vs. how they planned to.

Two layers, deliberately kept separate:
- compute_stats(): pure arithmetic over the event log (duration ratios by
  tag, completion/skip rate by time-of-day, average start lateness). Cheap,
  deterministic, no AI, no chat involved at all.
- engine.summarize_memory(): takes only render_stats()'s aggregated numbers
  — never a raw event, a task name, or a chat message — and phrases them
  into short natural-language facts like "Coding tasks take 30% longer."

That separation is what guarantees "do not store raw full chat": the AI
summarizer's input is a handful of percentages, nothing else.
"""

from datetime import datetime
from typing import Optional

TIME_BUCKETS = [
    ("night", 0, 5), ("morning", 5, 12), ("afternoon", 12, 17), ("evening", 17, 22), ("night", 22, 24),
]

MIN_EVENTS_TO_SUMMARIZE = 6


def _parse(dt: Optional[str]) -> Optional[datetime]:
    if not dt:
        return None
    try:
        parsed = datetime.fromisoformat(dt)
    except ValueError:
        return None
    return parsed.astimezone().replace(tzinfo=None) if parsed.tzinfo else parsed


def _bucket(hour: int) -> str:
    for label, start, end in TIME_BUCKETS:
        if start <= hour < end:
            return label
    return "night"


def compute_stats(events: list[dict]) -> dict:
    """Aggregates the raw event log into the numbers memory facts get
    phrased from."""
    duration_by_tag: dict[str, list[float]] = {}
    bucket_totals: dict[str, dict[str, int]] = {}  # bucket -> {"completed": n, "skipped": n}
    lateness_minutes: list[float] = []

    for e in events:
        planned_start = _parse(e.get("planned_start"))
        planned_end = _parse(e.get("planned_end"))
        actual_at = _parse(e.get("actual_at"))

        if e["event"] == "started" and planned_start and actual_at:
            lateness_minutes.append((actual_at - planned_start).total_seconds() / 60)

        if e["event"] == "completed" and planned_start and planned_end and actual_at:
            planned_minutes = (planned_end - planned_start).total_seconds() / 60
            actual_minutes = (actual_at - planned_start).total_seconds() / 60
            if planned_minutes > 1:
                ratio = actual_minutes / planned_minutes
                for tag in (e.get("tags") or ["untagged"]):
                    duration_by_tag.setdefault(tag, []).append(ratio)

        # Bucket by when the work actually happened for completions (that's
        # the productivity signal), but by when it was PLANNED for skips
        # (a skip has no "actual work" timestamp worth bucketing by — what
        # matters is which planned slot tends to get abandoned).
        if e["event"] == "completed" and actual_at:
            slot = bucket_totals.setdefault(_bucket(actual_at.hour), {"completed": 0, "skipped": 0})
            slot["completed"] += 1
        elif e["event"] == "skipped":
            ref = planned_start or actual_at
            if ref:
                slot = bucket_totals.setdefault(_bucket(ref.hour), {"completed": 0, "skipped": 0})
                slot["skipped"] += 1

    avg_ratio_by_tag = {
        tag: round(sum(rs) / len(rs), 2) for tag, rs in duration_by_tag.items() if len(rs) >= 2
    }
    bucket_rates = {
        bucket: {
            "completed": totals["completed"],
            "skipped": totals["skipped"],
            "skip_rate": round(totals["skipped"] / max(1, totals["completed"] + totals["skipped"]), 2),
        }
        for bucket, totals in bucket_totals.items()
    }
    avg_lateness = round(sum(lateness_minutes) / len(lateness_minutes), 1) if lateness_minutes else None

    return {
        "event_count": len(events),
        "duration_ratio_by_tag": avg_ratio_by_tag,
        "bucket_rates": bucket_rates,
        "avg_start_lateness_minutes": avg_lateness,
    }


def render_stats(stats: dict) -> str:
    """Plain-text rendering of compute_stats() for the AI prompt — only
    aggregate numbers, never a task name or raw event."""
    lines = [f"Total tracked events: {stats['event_count']}"]
    if stats["avg_start_lateness_minutes"] is not None:
        lines.append(f"Average minutes late starting a task vs. its planned start: {stats['avg_start_lateness_minutes']}")
    for tag, ratio in stats["duration_ratio_by_tag"].items():
        pct = round((ratio - 1) * 100)
        lines.append(f"Tag '{tag}': actual time spent is {pct:+d}% vs. the estimate (ratio {ratio}).")
    for bucket, rates in stats["bucket_rates"].items():
        total = rates["completed"] + rates["skipped"]
        lines.append(
            f"{bucket.capitalize()}: {rates['completed']} completed, {rates['skipped']} skipped "
            f"out of {total} (skip rate {round(rates['skip_rate'] * 100)}%)."
        )
    return "\n".join(lines)

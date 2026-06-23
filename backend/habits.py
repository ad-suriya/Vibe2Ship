"""Habit streak computation and presentation."""

from datetime import date, timedelta


def _daily_streak(done: set[str]) -> int:
    today = date.today()
    cursor = today if today.isoformat() in done else today - timedelta(days=1)
    count = 0
    while cursor.isoformat() in done:
        count += 1
        cursor -= timedelta(days=1)
    return count


def _week_key(d: date) -> tuple[int, int]:
    iso = d.isocalendar()
    return (iso[0], iso[1])


def _weekly_streak(done: set[str]) -> int:
    weeks = {_week_key(date.fromisoformat(x)) for x in done}
    today = date.today()
    cursor = today if _week_key(today) in weeks else today - timedelta(days=7)
    count = 0
    while _week_key(cursor) in weeks:
        count += 1
        cursor -= timedelta(days=7)
    return count


def streak(done_dates: list[str], cadence: str) -> int:
    done = set(done_dates)
    return _weekly_streak(done) if cadence == "WEEKLY" else _daily_streak(done)


def present(habit: dict, done_dates: list[str]) -> dict:
    done = set(done_dates)
    today = date.today()
    last7 = [(today - timedelta(days=i)) for i in range(6, -1, -1)]
    return {
        **habit,
        "streak": streak(done_dates, habit["cadence"]),
        "done_today": today.isoformat() in done,
        "total_done": len(done),
        "last7": [{"date": d.isoformat(), "done": d.isoformat() in done} for d in last7],
    }

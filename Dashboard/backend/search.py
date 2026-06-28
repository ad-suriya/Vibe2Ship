"""Cross-entity search across tasks, goals, habits, and sessions.

A fast substring prefilter handles the common case for free; when that
finds nothing, main.py falls back to engine.search_rank() so loose
natural-language phrasing still finds the right item.
"""


def build_candidates(tasks: list[dict], goals: list[dict], habits: list[dict], sessions: list[dict]) -> list[dict]:
    items: list[dict] = []
    for t in tasks:
        if t.get("status") == "ARCHIVED":
            continue
        items.append({"type": "task", "id": t["id"], "title": t["task_name"],
                       "detail": t.get("next_micro_step") or "", "data": t})
    for g in goals:
        items.append({"type": "goal", "id": g["id"], "title": g["title"],
                       "detail": g.get("description") or "", "data": g})
    for h in habits:
        items.append({"type": "habit", "id": h["id"], "title": h["name"], "detail": "", "data": h})
    for s in sessions:
        items.append({"type": "session", "id": s["id"], "title": s.get("description") or "Focus session",
                       "detail": "", "data": s})
    return items


def substring_match(query: str, candidates: list[dict]) -> list[dict]:
    q = query.lower()
    return [c for c in candidates if q in c["title"].lower() or q in c["detail"].lower()]


def group(matches: list[dict]) -> dict:
    out: dict = {"tasks": [], "goals": [], "habits": [], "sessions": []}
    key_map = {"task": "tasks", "goal": "goals", "habit": "habits", "session": "sessions"}
    for m in matches:
        out[key_map[m["type"]]].append(m["data"])
    return out

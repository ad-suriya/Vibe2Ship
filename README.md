# The Last-Minute Life Saver

A proactive AI productivity companion that turns a chaotic brain-dump of tasks,
deadlines, and anxieties into a structured execution plan — and does the first
10% of the work for you (drafts the email, builds the outline, writes the
practice questions).

The UI is a two-panel **conversational chat + live dashboard**: the engine reads
your psychological state, picks a mode (Planning / Focus / Panic / Review),
breaks big tasks into 15–20 min micro-steps, and fires system triggers like a
Pomodoro timer or a calendar-sync prompt.

## Architecture

- **Frontend** — React 19 + Vite + Tailwind 4 (`frontend/`). Dev server proxies
  `/api` → the backend.
- **Backend** — Python FastAPI + Google Gemini (`backend/`), exposing
  `POST /api/chat`. Structured output is enforced with a Pydantic response
  schema so the model always returns the exact engine contract.
- **Database** — Cloud **Firestore** via the Firebase Admin SDK
  (`backend/db.py`).

## Project structure

```
last-minute-life-saver/
├── frontend/              # React + Vite app
│   ├── src/
│   │   ├── App.tsx        # chat + dashboard
│   │   ├── api.ts         # typed API client
│   │   ├── types.ts       # shared engine/data types
│   │   └── components/    # RemindersBell, GoalsPanel, HabitsPanel
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts     # /api proxy → :8000
├── backend/               # FastAPI app
│   ├── main.py            # routes
│   ├── engine.py          # Gemini wrapper (structured output)
│   ├── db.py              # Firestore persistence
│   ├── scheduler.py       # time-blocking + drift detection
│   ├── reminders.py       # context-reminder generation
│   ├── habits.py          # streak logic
│   ├── ics.py             # calendar export
│   └── requirements.txt
├── .env.example           # copy to .env (git-ignored)
└── README.md
```

## Firebase setup

1. Create a Firebase project and enable **Firestore Database**.
2. Project Settings → **Service Accounts** → **Generate new private key**.
3. Save the downloaded JSON as `backend/serviceAccount.json` (git-ignored).
4. `.env` already points at it via `FIREBASE_CREDENTIALS="backend/serviceAccount.json"`
   (set `FIREBASE_PROJECT_ID` too if you prefer to be explicit).

Verify with `GET /api/health` → `firestore_ready: true`. Collections
(`tasks`, `reminders`, `goals`, `habits`, `habit_logs`, `counters`) are created
automatically on first write; integer ids are emulated via the `counters`
collection.

## Prerequisites

- Node.js
- Python 3.10+
- A Gemini API key and a Firebase project (see setup above)

Copy `.env.example` to `.env` (at the repo root) and fill in your values.

## Run Locally

Two processes. **Terminal 1 — backend:**

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate     macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000 --reload
```

**Terminal 2 — frontend:**

```bash
cd frontend
npm install
npm run dev
```

Then open the Vite URL (default http://localhost:5173). API calls to `/api/*`
are proxied to the FastAPI server on port 8000.

## Configuration

| Variable         | Where        | Purpose                                            |
| ---------------- | ------------ | -------------------------------------------------- |
| `GEMINI_API_KEY` | root `.env`  | Gemini auth (loaded by the backend).               |
| `GEMINI_MODEL`   | root `.env`  | Optional model override (default `gemini-3.5-flash`). |
| `FIREBASE_CREDENTIALS` | root `.env` | Path to the Firebase service-account JSON. |
| `FIREBASE_PROJECT_ID`  | root `.env` | Optional explicit project id. |

## Features

**Tier 1**
- **Task creation** — via chat or the manual "+ Task" form; persisted in Firestore.
- **AI prioritization** — the Gemini engine assigns urgency, resolves relative
  deadlines ("midnight", "Friday") into absolute ISO datetimes, and estimates
  effort.
- **AI scheduling** — "Plan my day" time-blocks open tasks into a conflict-free
  day plan within working hours, highest priority first.
- **Autonomous rescheduling** — the UI polls task status; when tasks slip past
  their planned slot or risk missing a deadline, it auto-replans and posts a note
  in the chat (or hit "Replan now").
- **Calendar sync** — per-task and whole-plan `.ics` export + Google Calendar
  add-links.

**Tier 2**
- **Context reminders** — reminders auto-generated from focus blocks and
  approaching deadlines, surfaced in the header bell and fired as **browser
  notifications** (opt-in). Custom reminders supported.
- **Goal tracking** — goals with progress bars; tasks can be linked to a goal,
  and completing a linked task advances it automatically (Goals tab).
- **Habit tracking** — daily/weekly habits with check-off, 7-day grid, and
  streak counters (Habits tab).

## API

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `/api/chat` | Conversational engine; creates/updates tasks. |
| `GET` | `/api/tasks` | List persisted tasks. |
| `POST` | `/api/tasks` | Create a task manually. |
| `PATCH` | `/api/tasks/{id}` | Update status/fields. |
| `DELETE` | `/api/tasks/{id}` | Delete a task. |
| `POST` | `/api/schedule` | Time-block tasks into a day plan. |
| `GET` | `/api/status` | Overdue / slipped / at-risk detection. |
| `POST` | `/api/reschedule` | Autonomous re-plan of open tasks. |
| `GET` | `/api/calendar.ics` | Export the whole plan. |
| `GET` | `/api/tasks/{id}.ics` | Export one task. |
| `GET/POST` | `/api/reminders` | List / create reminders. |
| `POST` | `/api/reminders/{id}/ack` | Dismiss a reminder. |
| `GET/POST` | `/api/goals` | List / create goals. |
| `POST` | `/api/goals/{id}/increment` | Adjust goal progress. |
| `GET/POST` | `/api/habits` | List / create habits. |
| `POST` | `/api/habits/{id}/check` | Toggle today's habit completion. |

`POST /api/chat` body: `{ "message": "...", "history": [] }`. Returns
`chat_ui` (agent message + quick replies), `current_mode`, `agentic_action`,
`system_trigger`, and the full `tasks` list. See `backend/` for schemas.

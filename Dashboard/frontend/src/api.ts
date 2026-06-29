import {
  ChatResponse,
  ChatSession,
  DecompositionPlan,
  FreeSlot,
  Goal,
  Habit,
  MemoryFact,
  RecoveryResult,
  Reminder,
  RescheduleResult,
  ScheduleResult,
  SearchResults,
  Session,
  StatusInfo,
  SubtaskDraft,
  Task,
  Urgency,
  Workflow,
  WorkflowPlan,
} from './types';

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  try {
    const auth = JSON.parse(localStorage.getItem('auth') || 'null');
    if (auth?.accessToken) return { ...extra, Authorization: `Bearer ${auth.accessToken}` };
  } catch {
    // ignore malformed localStorage value
  }
  return extra;
}

let loggedOutFor401 = false;

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    // Token missing/expired (Google ID tokens last ~1hr with no refresh in
    // this flow) — drop the stale session and send the user back to login.
    // Several requests can 401 around the same time (e.g. the tasks/goals/
    // habits fetches that all fire together on login) — only act once.
    if (!loggedOutFor401) {
      loggedOutFor401 = true;
      localStorage.removeItem('auth');
      window.location.reload();
    }
    throw new Error('Session expired. Please log in again.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(data.detail || 'Request failed');
  }
  return res.json() as Promise<T>;
}

const jsonHeaders = () => authHeaders({ 'Content-Type': 'application/json' });

export interface NewTask {
  task_name: string;
  urgency?: Urgency;
  estimated_minutes?: number;
  deadline?: string | null;
  next_micro_step?: string;
  goal_id?: number | null;
}

export const api = {
  listTasks: () => fetch('/api/tasks', { headers: authHeaders() }).then(handle<Task[]>),

  chat: (message: string, history: { role: string; text: string }[]) =>
    fetch('/api/chat', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ message, history }),
    }).then(handle<ChatResponse>),

  // Persisted chat session (Firestore-backed), keyed by a client-generated id.
  getChatSession: (sessionId: string) =>
    fetch(`/api/chats/${sessionId}`, { headers: authHeaders() }).then(handle<ChatSession>),
  addChatMessage: (sessionId: string, role: 'user' | 'model', content: string) =>
    fetch(`/api/chats/${sessionId}/messages`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ role, content }),
    }).then(handle<ChatSession>),

  createTask: (body: NewTask) =>
    fetch('/api/tasks', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    }).then(handle<Task>),

  patchTask: (id: number, body: Partial<Task>) =>
    fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    }).then(handle<Task>),

  deleteTask: (id: number) =>
    fetch(`/api/tasks/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handle<{ deleted: number }>),

  schedule: () => fetch('/api/schedule', { method: 'POST', headers: authHeaders() }).then(handle<ScheduleResult>),

  reschedule: () => fetch('/api/reschedule', { method: 'POST', headers: authHeaders() }).then(handle<RescheduleResult>),

  status: () => fetch('/api/status', { headers: authHeaders() }).then(handle<StatusInfo>),

  // Automatic task recovery
  skipTask: (id: number) => fetch(`/api/tasks/${id}/skip`, { method: 'POST', headers: authHeaders() }).then(handle<RecoveryResult>),
  recoverMissedTasks: (taskIds: number[] = []) =>
    fetch('/api/tasks/recover', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ task_ids: taskIds }) }).then(handle<RecoveryResult>),
  freeSlots: () => fetch('/api/tasks/free-slots', { headers: authHeaders() }).then(handle<FreeSlot[]>),

  // Long-term behavioral memory
  getMemory: () => fetch('/api/memory', { headers: authHeaders() }).then(handle<MemoryFact[]>),
  summarizeMemory: () => fetch('/api/memory/summarize', { method: 'POST', headers: authHeaders() }).then(handle<MemoryFact[]>),

  taskIcsUrl: (id: number) => `/api/tasks/${id}.ics`,
  calendarIcsUrl: () => '/api/calendar.ics',

  // Reminders
  listReminders: () => fetch('/api/reminders', { headers: authHeaders() }).then(handle<Reminder[]>),
  createReminder: (message: string, remind_at: string, task_id?: number) =>
    fetch('/api/reminders', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ message, remind_at, task_id }) }).then(handle<Reminder>),
  ackReminder: (id: number) => fetch(`/api/reminders/${id}/ack`, { method: 'POST', headers: authHeaders() }).then(handle<{ acknowledged: number }>),
  deleteReminder: (id: number) => fetch(`/api/reminders/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handle<{ deleted: number }>),

  // Goals
  listGoals: () => fetch('/api/goals', { headers: authHeaders() }).then(handle<Goal[]>),
  createGoal: (body: { title: string; description?: string; metric?: string; target_value?: number; deadline?: string | null }) =>
    fetch('/api/goals', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) }).then(handle<Goal>),
  incrementGoal: (id: number, delta: number) =>
    fetch(`/api/goals/${id}/increment`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ delta }) }).then(handle<Goal>),
  deleteGoal: (id: number) => fetch(`/api/goals/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handle<{ deleted: number }>),

  // Habits
  listHabits: () => fetch('/api/habits', { headers: authHeaders() }).then(handle<Habit[]>),
  createHabit: (name: string, cadence: 'DAILY' | 'WEEKLY') =>
    fetch('/api/habits', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name, cadence }) }).then(handle<Habit>),
  checkHabit: (id: number) => fetch(`/api/habits/${id}/check`, { method: 'POST', headers: authHeaders() }).then(handle<Habit>),
  deleteHabit: (id: number) => fetch(`/api/habits/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handle<{ deleted: number }>),

  // Focus sessions — same /api/sessions resource the extension popup polls,
  // so starting/ending one here shows up there too.
  listSessions: () => fetch('/api/sessions', { headers: authHeaders() }).then(handle<Session[]>),
  startSession: (description = '', durationMinutes = 0) =>
    fetch('/api/sessions', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ description, duration_minutes: durationMinutes }),
    }).then(handle<Session>),
  patchSession: (id: number, body: Partial<Pick<Session, 'is_paused' | 'end_time' | 'duration_minutes'>>) =>
    fetch(`/api/sessions/${id}`, { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(body) }).then(handle<Session>),

  // Google Calendar sync
  calendarStatus: () => fetch('/api/calendar/status', { headers: authHeaders() }).then(handle<{ connected: boolean }>),
  disconnectCalendar: () =>
    fetch('/api/calendar/disconnect', { method: 'POST', headers: authHeaders() }).then(handle<{ connected: boolean }>),
  calendarSync: () =>
    fetch('/api/calendar/sync', { method: 'POST', headers: authHeaders() }).then(handle<{ tasks: Task[]; imported: number }>),

  // AI Search Assistant
  search: (q: string) => fetch(`/api/search?q=${encodeURIComponent(q)}`, { headers: authHeaders() }).then(handle<SearchResults>),

  // AI Workflow Builder
  generateWorkflow: (sop_text: string) =>
    fetch('/api/workflows/generate', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ sop_text }) }).then(handle<WorkflowPlan>),
  listWorkflows: () => fetch('/api/workflows', { headers: authHeaders() }).then(handle<Workflow[]>),
  createWorkflow: (body: WorkflowPlan & { sop_text: string; active?: boolean }) =>
    fetch('/api/workflows', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) }).then(handle<Workflow>),
  patchWorkflow: (id: number, body: Partial<Pick<Workflow, 'active' | 'name'>>) =>
    fetch(`/api/workflows/${id}`, { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(body) }).then(handle<Workflow>),
  deleteWorkflow: (id: number) => fetch(`/api/workflows/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handle<{ deleted: number }>),
  runWorkflow: (id: number) => fetch(`/api/workflows/${id}/run`, { method: 'POST', headers: authHeaders() }).then(handle<{ created: Task[] }>),

  // AI Task Decomposition
  decomposeGoal: (goal: string) =>
    fetch('/api/tasks/decompose', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ goal }) }).then(handle<DecompositionPlan>),
  commitDecomposition: (goal: string, subtasks: SubtaskDraft[]) =>
    fetch('/api/tasks/decompose/commit', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ goal, subtasks }) }).then(handle<Task[]>),
};

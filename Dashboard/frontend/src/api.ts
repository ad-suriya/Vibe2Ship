import {
  ChatResponse,
  Goal,
  Habit,
  Reminder,
  RescheduleResult,
  ScheduleResult,
  StatusInfo,
  Task,
  Urgency,
} from './types';

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(data.detail || 'Request failed');
  }
  return res.json() as Promise<T>;
}

const jsonHeaders = { 'Content-Type': 'application/json' };

export interface NewTask {
  task_name: string;
  urgency?: Urgency;
  estimated_minutes?: number;
  deadline?: string | null;
  next_micro_step?: string;
  goal_id?: number | null;
}

export const api = {
  listTasks: () => fetch('/api/tasks').then(handle<Task[]>),

  chat: (message: string, history: { role: string; text: string }[]) =>
    fetch('/api/chat', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ message, history }),
    }).then(handle<ChatResponse>),

  createTask: (body: NewTask) =>
    fetch('/api/tasks', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    }).then(handle<Task>),

  patchTask: (id: number, body: Partial<Task>) =>
    fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    }).then(handle<Task>),

  deleteTask: (id: number) =>
    fetch(`/api/tasks/${id}`, { method: 'DELETE' }).then(handle<{ deleted: number }>),

  schedule: () => fetch('/api/schedule', { method: 'POST' }).then(handle<ScheduleResult>),

  reschedule: () => fetch('/api/reschedule', { method: 'POST' }).then(handle<RescheduleResult>),

  status: () => fetch('/api/status').then(handle<StatusInfo>),

  taskIcsUrl: (id: number) => `/api/tasks/${id}.ics`,
  calendarIcsUrl: () => '/api/calendar.ics',

  // Reminders
  listReminders: () => fetch('/api/reminders').then(handle<Reminder[]>),
  createReminder: (message: string, remind_at: string, task_id?: number) =>
    fetch('/api/reminders', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ message, remind_at, task_id }) }).then(handle<Reminder>),
  ackReminder: (id: number) => fetch(`/api/reminders/${id}/ack`, { method: 'POST' }).then(handle<{ acknowledged: number }>),
  deleteReminder: (id: number) => fetch(`/api/reminders/${id}`, { method: 'DELETE' }).then(handle<{ deleted: number }>),

  // Goals
  listGoals: () => fetch('/api/goals').then(handle<Goal[]>),
  createGoal: (body: { title: string; description?: string; metric?: string; target_value?: number; deadline?: string | null }) =>
    fetch('/api/goals', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }).then(handle<Goal>),
  incrementGoal: (id: number, delta: number) =>
    fetch(`/api/goals/${id}/increment`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ delta }) }).then(handle<Goal>),
  deleteGoal: (id: number) => fetch(`/api/goals/${id}`, { method: 'DELETE' }).then(handle<{ deleted: number }>),

  // Habits
  listHabits: () => fetch('/api/habits').then(handle<Habit[]>),
  createHabit: (name: string, cadence: 'DAILY' | 'WEEKLY') =>
    fetch('/api/habits', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name, cadence }) }).then(handle<Habit>),
  checkHabit: (id: number) => fetch(`/api/habits/${id}/check`, { method: 'POST' }).then(handle<Habit>),
  deleteHabit: (id: number) => fetch(`/api/habits/${id}`, { method: 'DELETE' }).then(handle<{ deleted: number }>),
};

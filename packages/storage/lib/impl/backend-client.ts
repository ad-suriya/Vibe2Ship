import { authStorage } from './auth-storage.js';

// process.env.CEB_NODE_ENV is inlined at build time (see @extension/env) —
// dev builds (CEB_DEV=true in the root .env) hit the local backend, anything
// else falls back to the deployed Cloud Run service so an unpacked extension
// works out of the box without a local backend running.
export const API_BASE =
  process.env.CEB_NODE_ENV === 'development'
    ? 'http://localhost:8000/api'
    : 'https://task-weave-backend-684807093732.asia-south1.run.app/api';

// Same switch for the dashboard tab the popup opens for login/full editing —
// must match the backend's FRONTEND_ORIGIN so the OAuth redirect lands back
// on a page the extension's dashboard-bridge content script is injected into.
export const FRONTEND_URL =
  process.env.CEB_NODE_ENV === 'development'
    ? 'http://localhost:5173'
    : 'https://task-weave-684807093732.asia-south1.run.app';

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = await authStorage.get();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) };
  if (auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    await authStorage.logout();
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(data.detail || 'Request failed');
  }
  return res.json() as Promise<T>;
}

// --- Projects -------------------------------------------------------------

export interface ApiProject {
  id: number;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export function mapApiProject(p: ApiProject) {
  return {
    id: String(p.id),
    name: p.name,
    color: p.color,
    createdAt: Date.parse(p.created_at),
    lastModified: Date.parse(p.updated_at),
  };
}

// --- Sessions ---------------------------------------------------------------

export interface ApiSession {
  id: number;
  description: string;
  project_id: number | null;
  start_time: string;
  end_time: string | null;
  duration_minutes: number;
  is_paused: boolean;
  breaks_taken: number;
  total_break_minutes: number;
  created_at: string;
  updated_at: string;
}

export function mapApiSession(s: ApiSession) {
  return {
    id: String(s.id),
    startTime: Date.parse(s.start_time),
    endTime: s.end_time ? Date.parse(s.end_time) : undefined,
    durationMinutes: s.duration_minutes,
    mode: 'custom' as const,
    isActive: !s.end_time && !s.is_paused,
    blockedSites: [] as string[],
    breaksTaken: s.breaks_taken,
    totalBreakMinutes: s.total_break_minutes,
    lastModified: Date.parse(s.updated_at),
    syncedToMobile: true,
    description: s.description || undefined,
    projectId: s.project_id != null ? String(s.project_id) : undefined,
  };
}

// --- Tasks --------------------------------------------------------------------

export interface ApiTask {
  id: number;
  task_name: string;
  status: 'TODO' | 'IN_PROGRESS' | 'COMPLETED' | 'ARCHIVED';
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  estimated_minutes: number;
  deadline: string | null;
  next_micro_step: string;
  url: string | null;
  selected_text: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

const STATUS_TO_EXT = {
  TODO: 'todo',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'done',
  ARCHIVED: 'archived',
} as const;

const STATUS_TO_API = {
  inbox: 'TODO',
  todo: 'TODO',
  'in-progress': 'IN_PROGRESS',
  done: 'COMPLETED',
  archived: 'ARCHIVED',
} as const;

const URGENCY_TO_EXT = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' } as const;
const PRIORITY_TO_API = { low: 'LOW', medium: 'MEDIUM', high: 'HIGH' } as const;

export function mapApiTask(t: ApiTask) {
  return {
    id: String(t.id),
    title: t.task_name,
    description: t.next_micro_step || undefined,
    url: t.url || undefined,
    selectedText: t.selected_text || undefined,
    priority: URGENCY_TO_EXT[t.urgency],
    tags: t.tags || [],
    status: STATUS_TO_EXT[t.status],
    createdAt: Date.parse(t.created_at),
    dueDate: t.deadline ? Date.parse(t.deadline) : undefined,
    completedAt: t.status === 'COMPLETED' ? Date.parse(t.updated_at) : undefined,
    estimatedMinutes: t.estimated_minutes,
    lastModified: Date.parse(t.updated_at),
    syncedToMobile: false,
  };
}

export function mapExtTaskToApiCreate(task: {
  title: string;
  description?: string;
  url?: string;
  selectedText?: string;
  priority: 'low' | 'medium' | 'high';
  tags: string[];
  dueDate?: number;
  estimatedMinutes?: number;
}) {
  return {
    task_name: task.title,
    urgency: PRIORITY_TO_API[task.priority],
    estimated_minutes: task.estimatedMinutes ?? 30,
    deadline: task.dueDate ? new Date(task.dueDate).toISOString() : null,
    next_micro_step: task.description || '',
    url: task.url,
    selected_text: task.selectedText,
    tags: task.tags || [],
  };
}

export function mapExtTaskUpdatesToApiPatch(updates: {
  title?: string;
  description?: string;
  url?: string;
  selectedText?: string;
  priority?: 'low' | 'medium' | 'high';
  tags?: string[];
  status?: 'inbox' | 'todo' | 'in-progress' | 'done' | 'archived';
  dueDate?: number;
  estimatedMinutes?: number;
}) {
  const patch: Record<string, unknown> = {};
  if (updates.title !== undefined) patch.task_name = updates.title;
  if (updates.description !== undefined) patch.next_micro_step = updates.description;
  if (updates.url !== undefined) patch.url = updates.url;
  if (updates.selectedText !== undefined) patch.selected_text = updates.selectedText;
  if (updates.priority !== undefined) patch.urgency = PRIORITY_TO_API[updates.priority];
  if (updates.tags !== undefined) patch.tags = updates.tags;
  if (updates.status !== undefined) patch.status = STATUS_TO_API[updates.status];
  if (updates.dueDate !== undefined) patch.deadline = new Date(updates.dueDate).toISOString();
  if (updates.estimatedMinutes !== undefined) patch.estimated_minutes = updates.estimatedMinutes;
  return patch;
}

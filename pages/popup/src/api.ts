import type { Task } from '@extension/types';

const API_BASE = 'http://localhost:8000/api';

interface ApiTask {
  id: number;
  task_name: string;
  status: 'TODO' | 'IN_PROGRESS' | 'COMPLETED';
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  estimated_minutes: number;
  deadline: string | null;
  next_micro_step: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  goal_id: number | null;
  created_at: string;
  updated_at: string;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(data.detail || 'Request failed');
  }
  return res.json() as Promise<T>;
}

export const dashboardApi = {
  async getTasks(): Promise<ApiTask[]> {
    const res = await fetch(`${API_BASE}/tasks`);
    return handleResponse<ApiTask[]>(res);
  },

  async createTask(taskName: string, urgency: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM', estimatedMinutes = 30) {
    const res = await fetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_name: taskName,
        urgency,
        estimated_minutes: estimatedMinutes,
      }),
    });
    return handleResponse<ApiTask>(res);
  },

  async updateTaskStatus(taskId: number, status: 'TODO' | 'IN_PROGRESS' | 'COMPLETED') {
    const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    return handleResponse<ApiTask>(res);
  },

  async deleteTask(taskId: number) {
    const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
      method: 'DELETE',
    });
    return handleResponse<{ deleted: number }>(res);
  },

  async createSession(description: string = '', projectId?: string) {
    const res = await fetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, project_id: projectId }),
    });
    return handleResponse(res);
  },

  async stopSession(sessionId: string) {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ end_time: new Date().toISOString() }),
    });
    return handleResponse(res);
  },

  async listSessions() {
    const res = await fetch(`${API_BASE}/sessions`);
    return handleResponse(res);
  },

  async createProject(name: string, color: string = '#2563eb') {
    const res = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color }),
    });
    return handleResponse(res);
  },

  async listProjects() {
    const res = await fetch(`${API_BASE}/projects`);
    return handleResponse(res);
  },
};

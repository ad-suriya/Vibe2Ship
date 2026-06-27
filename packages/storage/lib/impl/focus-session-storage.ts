import { request, mapApiSession } from './backend-client.js';
import type { ApiSession } from './backend-client.js';
import type { FocusSession, FocusSessionCreateInput } from '@extension/types';

async function fetchCurrent(): Promise<FocusSession | null> {
  const sessions = await request<ApiSession[]>('/sessions');
  const active = sessions.filter(s => !s.end_time).sort((a, b) => b.id - a.id)[0];
  return active ? mapApiSession(active) : null;
}

export const focusSessionStorage = {
  createSession: async (input: FocusSessionCreateInput): Promise<FocusSession> => {
    const created = await request<ApiSession>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ description: '' }),
    });
    if (input.durationMinutes) {
      await request<ApiSession>(`/sessions/${created.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ duration_minutes: input.durationMinutes }),
      });
    }
    return fetchCurrent() as Promise<FocusSession>;
  },

  getActiveSession: fetchCurrent,
  getCurrent: fetchCurrent,

  update: async (id: string, updates: Partial<FocusSession>): Promise<void> => {
    const patch: Record<string, unknown> = {};
    if (updates.durationMinutes !== undefined) patch.duration_minutes = updates.durationMinutes;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.projectId !== undefined) patch.project_id = Number(updates.projectId);
    if (updates.endTime !== undefined) patch.end_time = new Date(updates.endTime).toISOString();
    await request<ApiSession>(`/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },

  pause: async (): Promise<void> => {
    const current = await fetchCurrent();
    if (!current) return;
    await request<ApiSession>(`/sessions/${current.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_paused: true }),
    });
  },

  takeBreak: async (durationMinutes: number = 5): Promise<void> => {
    const current = await fetchCurrent();
    if (!current) return;
    await request<ApiSession>(`/sessions/${current.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        breaks_taken: current.breaksTaken + 1,
        total_break_minutes: current.totalBreakMinutes + durationMinutes,
      }),
    });
  },

  end: async (): Promise<void> => {
    const current = await fetchCurrent();
    if (!current) return;
    await request<ApiSession>(`/sessions/${current.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ end_time: new Date().toISOString() }),
    });
  },

  startTracking: async (input: {
    description?: string;
    projectId?: string;
    projectName?: string;
    projectColor?: string;
    durationMinutes?: number;
  }): Promise<FocusSession> => {
    const created = await request<ApiSession>('/sessions', {
      method: 'POST',
      body: JSON.stringify({
        description: input.description || '',
        project_id: input.projectId ? Number(input.projectId) : undefined,
        duration_minutes: input.durationMinutes ?? 25,
      }),
    });
    return mapApiSession(created);
  },

  stopTracking: async (): Promise<FocusSession | null> => {
    const current = await fetchCurrent();
    if (!current) return null;
    const updated = await request<ApiSession>(`/sessions/${current.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ end_time: new Date().toISOString() }),
    });
    return mapApiSession(updated);
  },

  getSessionsSince: async (timestamp: number): Promise<FocusSession[]> => {
    const sessions = await request<ApiSession[]>('/sessions');
    return sessions
      .filter(s => Date.parse(s.start_time) >= timestamp)
      .map(mapApiSession);
  },
};

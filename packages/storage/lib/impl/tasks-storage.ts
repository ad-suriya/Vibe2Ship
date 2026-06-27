import { request, mapApiTask, mapExtTaskToApiCreate, mapExtTaskUpdatesToApiPatch } from './backend-client.js';
import type { ApiTask } from './backend-client.js';
import type { Task, TaskQueryOptions, TaskUpdatePayload } from '@extension/types';

function applyQuery(tasks: Task[], options?: TaskQueryOptions): Task[] {
  let filtered = tasks;

  if (options?.status) {
    const statuses = Array.isArray(options.status) ? options.status : [options.status];
    filtered = filtered.filter(t => statuses.includes(t.status));
  }

  if (options?.priority) {
    const priorities = Array.isArray(options.priority) ? options.priority : [options.priority];
    filtered = filtered.filter(t => priorities.includes(t.priority));
  }

  if (options?.limit) {
    filtered = filtered.slice(0, options.limit);
  }

  return filtered;
}

async function fetchAll(): Promise<Task[]> {
  const tasks = await request<ApiTask[]>('/tasks');
  return tasks.map(mapApiTask);
}

export const tasksStorage = {
  addTask: async (task: Omit<Task, 'id' | 'createdAt' | 'lastModified'>): Promise<Task> => {
    const created = await request<ApiTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify(mapExtTaskToApiCreate(task)),
    });
    return mapApiTask(created);
  },

  updateTask: async (id: string, updates: TaskUpdatePayload): Promise<void> => {
    await request<ApiTask>(`/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(mapExtTaskUpdatesToApiPatch(updates)),
    });
  },

  getTasks: async (options?: TaskQueryOptions): Promise<Task[]> => applyQuery(await fetchAll(), options),

  query: async (options?: TaskQueryOptions): Promise<Task[]> => applyQuery(await fetchAll(), options),

  update: async (id: string, updates: TaskUpdatePayload): Promise<void> => {
    await request<ApiTask>(`/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(mapExtTaskUpdatesToApiPatch(updates)),
    });
  },
};

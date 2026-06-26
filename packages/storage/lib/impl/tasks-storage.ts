import { createStorage, StorageEnum } from '../base/index.js';
import type { Task, TaskQueryOptions, TaskUpdatePayload } from '@extension/types';

interface TasksStorageState {
  tasks: Task[];
}

const storage = createStorage<TasksStorageState>(
  'tasks-storage-key',
  {
    tasks: [],
  },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

export const tasksStorage = {
  ...storage,
  addTask: async (task: Omit<Task, 'id' | 'createdAt' | 'lastModified'>) => {
    const newTask: Task = {
      ...task,
      id: Date.now().toString(),
      createdAt: Date.now(),
      lastModified: Date.now(),
    };

    await storage.set(currentState => ({
      ...currentState,
      tasks: [...currentState.tasks, newTask],
    }));

    return newTask;
  },
  updateTask: async (id: string, updates: TaskUpdatePayload) => {
    await storage.set(currentState => ({
      ...currentState,
      tasks: currentState.tasks.map(task =>
        task.id === id
          ? { ...task, ...updates, lastModified: Date.now() }
          : task,
      ),
    }));
  },
  getTasks: async (options?: TaskQueryOptions) => {
    const state = await storage.get();
    let filtered = state.tasks;

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
  },
  query: async (options?: TaskQueryOptions) => {
    const state = await storage.get();
    let filtered = state.tasks;

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
  },
  update: async (id: string, updates: TaskUpdatePayload) => {
    await storage.set(currentState => ({
      ...currentState,
      tasks: currentState.tasks.map(task =>
        task.id === id
          ? { ...task, ...updates, lastModified: Date.now() }
          : task,
      ),
    }));
  },
};

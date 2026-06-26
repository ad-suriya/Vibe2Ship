import { createStorage, StorageEnum } from '../base/index.js';
import type { FocusSession, FocusSessionCreateInput } from '@extension/types';

interface FocusSessionStorageState {
  sessions: FocusSession[];
  activeSessionId?: string;
}

const storage = createStorage<FocusSessionStorageState>(
  'focus-session-storage-key',
  {
    sessions: [],
    activeSessionId: undefined,
  },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

export const focusSessionStorage = {
  ...storage,
  createSession: async (input: FocusSessionCreateInput) => {
    const newSession: FocusSession = {
      id: Date.now().toString(),
      startTime: Date.now(),
      durationMinutes: input.durationMinutes,
      mode: input.mode,
      associatedTaskId: input.associatedTaskId,
      isActive: true,
      blockedSites: input.blockedSites || [],
      breaksTaken: 0,
      totalBreakMinutes: 0,
      lastModified: Date.now(),
      syncedToMobile: false,
    };

    await storage.set(currentState => ({
      ...currentState,
      sessions: [...currentState.sessions, newSession],
      activeSessionId: newSession.id,
    }));

    return newSession;
  },
  getActiveSession: async () => {
    const state = await storage.get();
    if (!state.activeSessionId) return null;
    return state.sessions.find(s => s.id === state.activeSessionId) || null;
  },
  getCurrent: async () => {
    const state = await storage.get();
    if (!state.activeSessionId) return null;
    return state.sessions.find(s => s.id === state.activeSessionId) || null;
  },
  update: async (id: string, updates: Partial<FocusSession>) => {
    await storage.set(currentState => ({
      ...currentState,
      sessions: currentState.sessions.map(session =>
        session.id === id
          ? { ...session, ...updates, lastModified: Date.now() }
          : session,
      ),
    }));
  },
  pause: async () => {
    const state = await storage.get();
    if (!state.activeSessionId) return;
    await storage.set(currentState => ({
      ...currentState,
      sessions: currentState.sessions.map(session =>
        session.id === state.activeSessionId
          ? { ...session, isActive: false, lastModified: Date.now() }
          : session,
      ),
    }));
  },
  takeBreak: async (durationMinutes: number = 5) => {
    const state = await storage.get();
    if (!state.activeSessionId) return;
    await storage.set(currentState => ({
      ...currentState,
      sessions: currentState.sessions.map(session =>
        session.id === state.activeSessionId
          ? { ...session, breaksTaken: session.breaksTaken + 1, totalBreakMinutes: session.totalBreakMinutes + durationMinutes, lastModified: Date.now() }
          : session,
      ),
    }));
  },
  end: async () => {
    const state = await storage.get();
    if (!state.activeSessionId) return;
    await storage.set(currentState => ({
      ...currentState,
      sessions: currentState.sessions.map(session =>
        session.id === state.activeSessionId
          ? { ...session, endTime: Date.now(), isActive: false, lastModified: Date.now() }
          : session,
      ),
      activeSessionId: undefined,
    }));
  },
  startTracking: async (input: {
    description?: string;
    projectId?: string;
    projectName?: string;
    projectColor?: string;
  }) => {
    const newSession: FocusSession = {
      id: Date.now().toString(),
      startTime: Date.now(),
      durationMinutes: 0,
      mode: 'custom',
      isActive: true,
      blockedSites: [],
      breaksTaken: 0,
      totalBreakMinutes: 0,
      lastModified: Date.now(),
      syncedToMobile: false,
      description: input.description,
      projectId: input.projectId,
      projectName: input.projectName,
      projectColor: input.projectColor,
    };

    await storage.set(currentState => ({
      ...currentState,
      sessions: [...currentState.sessions, newSession],
      activeSessionId: newSession.id,
    }));

    return newSession;
  },
  stopTracking: async (): Promise<FocusSession | null> => {
    const state = await storage.get();
    if (!state.activeSessionId) return null;

    const endTime = Date.now();
    await storage.set(currentState => ({
      ...currentState,
      sessions: currentState.sessions.map(session =>
        session.id === state.activeSessionId
          ? { ...session, endTime, isActive: false, lastModified: Date.now() }
          : session,
      ),
      activeSessionId: undefined,
    }));

    const updatedState = await storage.get();
    return updatedState.sessions.find(s => s.id === state.activeSessionId) || null;
  },
  getSessionsSince: async (timestamp: number) => {
    const state = await storage.get();
    return state.sessions.filter(s => s.startTime >= timestamp);
  },
};

export type FocusMode = 'pomodoro' | 'long-focus' | 'custom';

export interface FocusSession {
  id: string;
  startTime: number;
  endTime?: number;
  durationMinutes: number;
  mode: FocusMode;
  associatedTaskId?: string;
  isActive: boolean;
  blockedSites: string[];
  breaksTaken: number;
  totalBreakMinutes: number;
  lastModified: number;
  syncedToMobile: boolean;
  syncedAt?: number;
  description?: string;
  projectId?: string;
  projectName?: string;
  projectColor?: string;
}

export interface BreakSession {
  id: string;
  sessionId: string;
  startTime: number;
  endTime?: number;
  durationMinutes: number;
  reason?: string;
  lastModified: number;
}

export interface FocusSessionCreateInput {
  durationMinutes: number;
  mode: FocusMode;
  associatedTaskId?: string;
  blockedSites?: string[];
}

export type FocusSessionUpdatePayload = Partial<
  Omit<FocusSession, 'id' | 'startTime' | 'createdAt'>
>;

import type { Task } from './task.js';
import type { FocusSession } from './session.js';
import type { UserSettings } from './user.js';

export type SyncResource = 'task' | 'session' | 'settings' | 'streak';
export type SyncAction = 'create' | 'update' | 'delete';
export type SyncStatus = 'pending' | 'synced' | 'failed' | 'conflict';

export interface SyncQueueItem {
  id: string;
  action: SyncAction;
  resource: SyncResource;
  resourceId: string;
  data: unknown;
  timestamp: number;
  status: SyncStatus;
  retryCount: number;
  lastError?: string;
}

export interface SyncPullRequest {
  lastSyncTimestamp: number;
  resources: SyncResource[];
}

export interface SyncPullResponse {
  items: SyncChangedItem[];
  timestamp: number;
  hasMore: boolean;
}

export interface SyncChangedItem {
  resource: SyncResource;
  action: 'added' | 'modified' | 'removed';
  data: Task | FocusSession | UserSettings | null;
  timestamp: number;
}

export interface SyncPushRequest {
  items: SyncQueueItem[];
  clientTimestamp: number;
}

export interface SyncPushResponse {
  acknowledged: string[];
  conflicts: SyncConflict[];
  timestamp: number;
}

export interface SyncConflict {
  resourceId: string;
  resource: SyncResource;
  clientVersion: unknown;
  serverVersion: unknown;
  resolvedVersion: unknown;
  strategy: 'client-wins' | 'server-wins' | 'merged';
}

export interface SyncAcknowledgeRequest {
  syncedIds: string[];
}

export interface SyncState {
  lastSyncTimestamp: number;
  isSyncing: boolean;
  pendingChanges: number;
  lastSyncError?: string;
  nextRetryAt?: number;
}

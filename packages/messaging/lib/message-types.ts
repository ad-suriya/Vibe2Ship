import type {
  Task,
  FocusSession,
  SyncQueueItem,
  UserSettings,
  StreakData,
} from '@extension/types';

export type MessageType =
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TASK_DELETED'
  | 'FOCUS_STARTED'
  | 'FOCUS_ENDED'
  | 'FOCUS_PAUSED'
  | 'FOCUS_RESUMED'
  | 'BREAK_STARTED'
  | 'BREAK_ENDED'
  | 'BLOCKING_ENABLED'
  | 'BLOCKING_DISABLED'
  | 'SYNC_REQUESTED'
  | 'SYNC_COMPLETED'
  | 'SETTINGS_UPDATED'
  | 'CONTENT_CAPTURED'
  | 'QUERY_CONTEXT'
  | 'CONTEXT_RESPONSE';

export interface BaseMessage {
  type: MessageType;
  timestamp: number;
  source?: string;
  requestId?: string;
}

export interface TaskMessage extends BaseMessage {
  type: 'TASK_CREATED' | 'TASK_UPDATED' | 'TASK_DELETED';
  payload: Task;
}

export interface FocusMessage extends BaseMessage {
  type:
    | 'FOCUS_STARTED'
    | 'FOCUS_ENDED'
    | 'FOCUS_PAUSED'
    | 'FOCUS_RESUMED'
    | 'BREAK_STARTED'
    | 'BREAK_ENDED';
  payload: FocusSession;
}

export interface BlockingMessage extends BaseMessage {
  type: 'BLOCKING_ENABLED' | 'BLOCKING_DISABLED';
  payload: {
    sites: string[];
    isActive: boolean;
  };
}

export interface SyncMessage extends BaseMessage {
  type: 'SYNC_REQUESTED' | 'SYNC_COMPLETED';
  payload: {
    queue: SyncQueueItem[];
    status: 'pending' | 'completed';
  };
}

export interface SettingsMessage extends BaseMessage {
  type: 'SETTINGS_UPDATED';
  payload: UserSettings;
}

export interface ContentCaptureMessage extends BaseMessage {
  type: 'CONTENT_CAPTURED';
  payload: {
    title: string;
    url: string;
    selectedText?: string;
    favicon?: string;
  };
}

export interface QueryContextMessage extends BaseMessage {
  type: 'QUERY_CONTEXT';
  payload: {
    query: 'context' | 'focus-active' | 'blocking-active';
  };
}

export interface ContextResponseMessage extends BaseMessage {
  type: 'CONTEXT_RESPONSE';
  payload: {
    focusSession: FocusSession | null;
    blockingActive: boolean;
    blockedSites: string[];
  };
}

export type ExtensionMessage =
  | TaskMessage
  | FocusMessage
  | BlockingMessage
  | SyncMessage
  | SettingsMessage
  | ContentCaptureMessage
  | QueryContextMessage
  | ContextResponseMessage;

export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

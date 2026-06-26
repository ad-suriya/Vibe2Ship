export type { ExtensionMessage, MessageResponse, MessageType } from './lib/message-types.js';
export type {
  TaskMessage,
  FocusMessage,
  BlockingMessage,
  SyncMessage,
  SettingsMessage,
  ContentCaptureMessage,
  QueryContextMessage,
  ContextResponseMessage,
  BaseMessage,
} from './lib/message-types.js';

export {
  registerMessageHandler,
  setupMessageListener,
  clearAllHandlers,
} from './lib/handler.js';

export {
  sendMessage,
  sendMessageToTab,
  sendMessageToBackground,
  type SendMessageOptions,
} from './lib/sender.js';

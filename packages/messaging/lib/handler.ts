import type { ExtensionMessage, MessageResponse, MessageType } from './message-types.js';

type MessageHandler = (
  message: ExtensionMessage,
) => Promise<MessageResponse | undefined> | MessageResponse | undefined;

const handlers: Record<string, MessageHandler> = {};

export const registerMessageHandler = <T extends MessageType>(
  type: T,
  handler: (message: ExtensionMessage & { type: T }) => Promise<MessageResponse | undefined> | MessageResponse | undefined,
): (() => void) => {
  handlers[type] = handler as MessageHandler;

  return () => {
    delete handlers[type];
  };
};

export const setupMessageListener = (): void => {
  if (!globalThis.chrome?.runtime?.onMessage) {
    console.warn('Chrome runtime messaging API not available');
    return;
  }

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const msg = message as ExtensionMessage;

    if (!msg.type) {
      sendResponse({ success: false, error: 'Missing message type' });
      return;
    }

    const handler = handlers[msg.type as MessageType];

    if (!handler) {
      sendResponse({
        success: false,
        error: `No handler registered for message type: ${msg.type}`,
      });
      return;
    }

    Promise.resolve()
      .then(() => handler(msg))
      .then(response => {
        sendResponse(response ?? { success: true });
      })
      .catch(error => {
        console.error(`Error handling message of type ${msg.type}:`, error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });

    return true;
  });
};

export const clearAllHandlers = (): void => {
  Object.keys(handlers).forEach(key => {
    delete handlers[key as MessageType];
  });
};

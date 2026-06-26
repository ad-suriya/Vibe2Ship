import type { ExtensionMessage, MessageResponse } from './message-types.js';

const DEFAULT_TIMEOUT = 5000;

export interface SendMessageOptions {
  timeout?: number;
  tabId?: number;
}

const generateRequestId = () =>
  `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

export const sendMessage = async <T = unknown>(
  message: ExtensionMessage,
  options?: SendMessageOptions,
): Promise<T> => {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    throw new Error('Chrome runtime messaging API not available');
  }

  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const requestId = generateRequestId();

  const messageWithId: ExtensionMessage = {
    ...message,
    requestId,
    timestamp: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Message timeout (${timeout}ms) for type: ${message.type}`));
    }, timeout);

    try {
      if (options?.tabId) {
        chrome.tabs.sendMessage(options.tabId, messageWithId, response => {
          clearTimeout(timeoutId);

          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (response?.success === false) {
            reject(new Error(response.error ?? 'Message handler failed'));
            return;
          }

          resolve(response?.data as T);
        });
      } else {
        chrome.runtime.sendMessage(messageWithId, response => {
          clearTimeout(timeoutId);

          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (response?.success === false) {
            reject(new Error(response.error ?? 'Message handler failed'));
            return;
          }

          resolve(response?.data as T);
        });
      }
    } catch (error) {
      clearTimeout(timeoutId);
      reject(error);
    }
  });
};

export const sendMessageToTab = async <T = unknown>(
  tabId: number,
  message: ExtensionMessage,
  options?: Omit<SendMessageOptions, 'tabId'>,
): Promise<T> => {
  return sendMessage(message, { ...options, tabId });
};

export const sendMessageToBackground = async <T = unknown>(
  message: ExtensionMessage,
  options?: Omit<SendMessageOptions, 'tabId'>,
): Promise<T> => {
  return sendMessage(message, options);
};

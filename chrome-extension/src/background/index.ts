import 'webextension-polyfill';
import { exampleThemeStorage, authStorage } from '@extension/storage';

exampleThemeStorage.get().then(theme => {
  console.log('[Background] theme:', theme);
});

// Message handler for focus and blocking lifecycle
chrome.runtime.onMessage.addListener(async (message: any, sender, sendResponse) => {
  try {
    if (message.type === 'FOCUS_STARTED') {
      console.log('[Background] Focus started:', message.payload);
      sendResponse({ success: true });
    } else if (message.type === 'FOCUS_ENDED' || message.type === 'FOCUS_PAUSED') {
      console.log('[Background]', message.type);
      sendResponse({ success: true });
    } else if (message.type === 'FOCUS_RESUMED') {
      console.log('[Background] Focus resumed');
      sendResponse({ success: true });
    } else if (message.type === 'TASK_CREATED') {
      console.log('[Background] Task created:', message.payload);
      sendResponse({ success: true });
    } else if (message.type === 'AUTH_CHANGED') {
      console.log('[Background] Auth changed:', message.payload);
      if (message.payload.isAuthenticated && message.payload.user) {
        await authStorage.setAuth(
          message.payload.user,
          message.payload.accessToken || 'token',
          message.payload.refreshToken || 'refresh',
          3600
        );
      } else {
        await authStorage.logout();
      }
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Unknown message type' });
    }
  } catch (error) {
    console.error('[Background] Error handling message:', error);
    sendResponse({ success: false, error: String(error) });
  }
});

console.log('Background loaded');
console.log("Edit 'chrome-extension/src/background/index.ts' and save to reload.");

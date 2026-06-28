import 'webextension-polyfill';
import { exampleThemeStorage, authStorage } from '@extension/storage';

exampleThemeStorage.get().then(theme => {
  console.log('[Background] theme:', theme);
});

// Ambient capture: a context-menu entry and keyboard shortcut both open the
// task-capture popup pre-filled with the page (and any selected text), so
// "add this for tomorrow" doesn't require deliberately opening the extension
// popup first.
const CAPTURE_MENU_ID = 'task-weave-capture';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CAPTURE_MENU_ID,
    title: 'Add to Task Weave',
    contexts: ['page', 'selection', 'link'],
  });
});

function openCapture(tab?: chrome.tabs.Tab, selectedText?: string): void {
  const params = new URLSearchParams();
  if (tab?.title) params.set('title', tab.title);
  if (tab?.url) params.set('url', tab.url);
  if (selectedText) params.set('selectedText', selectedText);

  chrome.windows.create({
    url: chrome.runtime.getURL(`task-capture/index.html?${params.toString()}`),
    type: 'popup',
    width: 480,
    height: 640,
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === CAPTURE_MENU_ID) {
    openCapture(tab, info.selectionText);
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'capture-task') {
    openCapture(tab);
  }
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

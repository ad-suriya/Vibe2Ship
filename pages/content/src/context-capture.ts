export interface PageContext {
  selectedText?: string;
  title: string;
  url: string;
}

export const capturePageContext = (): PageContext => {
  const selectedText = window.getSelection()?.toString().trim() || undefined;

  return {
    selectedText,
    title: document.title,
    url: window.location.href,
  };
};

export const setupContextMessaging = (): void => {
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const msg = message as { type?: string; payload?: unknown };

    if (msg.type === 'QUERY_CONTEXT') {
      const context = capturePageContext();
      sendResponse({
        success: true,
        selectedText: context.selectedText,
      });
      return;
    }

    sendResponse(undefined);
  });
};

export const initializeContentCapture = (): void => {
  setupContextMessaging();
  console.log('[CEB] Context capture initialized');
};

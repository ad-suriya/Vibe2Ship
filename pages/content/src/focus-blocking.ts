export interface BlockingState {
  isActive: boolean;
  blockedSites: string[];
}

let blockingState: BlockingState = {
  isActive: false,
  blockedSites: [],
};

const normalizeUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const isSiteBlocked = (url: string): boolean => {
  if (!blockingState.isActive) return false;

  const normalized = normalizeUrl(url);

  return blockingState.blockedSites.some(site => {
    const normalizedSite = site.replace(/^www\./, '');
    return normalized.includes(normalizedSite) || normalizedSite.includes(normalized);
  });
};

const handleNavigation = (url: string): void => {
  if (isSiteBlocked(url)) {
    const focusLockUrl = chrome.runtime.getURL(
      `focus-lock/index.html?url=${encodeURIComponent(url)}`,
    );
    window.location.href = focusLockUrl;
  }
};

export const setupFocusBlocking = (): void => {
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const msg = message as { type?: string; payload?: unknown };

    if (msg.type === 'BLOCKING_ENABLED') {
      const payload = msg.payload as { sites?: string[]; isActive?: boolean };
      blockingState = {
        isActive: payload.isActive ?? true,
        blockedSites: payload.sites ?? [],
      };
      console.log('[CEB] Blocking enabled for:', blockingState.blockedSites);
      sendResponse({ success: true });
      return;
    }

    if (msg.type === 'BLOCKING_DISABLED') {
      blockingState = {
        isActive: false,
        blockedSites: [],
      };
      console.log('[CEB] Blocking disabled');
      sendResponse({ success: true });
      return;
    }

    sendResponse(undefined);
  });

  const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
    const currentUrl = window.location.href;
    const nextUrl = (event.target as any)?.location?.href || currentUrl;

    if (currentUrl !== nextUrl && isSiteBlocked(nextUrl)) {
      event.preventDefault();
      handleNavigation(nextUrl);
    }
  };

  const handleClickAndContextMenu = (event: MouseEvent) => {
    if (blockingState.isActive) {
      const target = event.target as HTMLElement;
      const link = target.closest('a');

      if (link?.href) {
        const href = link.getAttribute('href');
        if (href && isSiteBlocked(href)) {
          event.preventDefault();
          event.stopPropagation();
          handleNavigation(href);
        }
      }
    }
  };

  document.addEventListener('click', handleClickAndContextMenu, true);
  document.addEventListener('auxclick', handleClickAndContextMenu, true);

  window.addEventListener('beforeunload', handleBeforeUnload);

  console.log('[CEB] Focus blocking initialized');
};

export const initializeFocusMode = (): void => {
  setupFocusBlocking();
};

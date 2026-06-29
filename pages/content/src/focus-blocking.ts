import { blockingStorage, FRONTEND_URL } from '@extension/storage';
import type { BlockingState } from '@extension/storage';

let blockingState: BlockingState = {
  isActive: false,
  mode: 'blocklist',
  blockedSites: [],
  allowedSite: null,
  overrideUntil: {},
};

// The dashboard itself must always be reachable while locked to a captured
// task's site — otherwise there'd be no way to see progress, log hours, or
// stop the lock without going through the popup specifically.
const DASHBOARD_HOSTNAME = (() => {
  try {
    return new URL(FRONTEND_URL).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
})();

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
  if (normalized === DASHBOARD_HOSTNAME) return false;

  const overrideExpiry = blockingState.overrideUntil[normalized];
  if (overrideExpiry && overrideExpiry > Date.now()) return false;

  if (blockingState.mode === 'allowlist') {
    // Task-capture site lock: only the one locked site is reachable —
    // everything else (the inverse of the blocklist check below) is blocked.
    if (!blockingState.allowedSite) return false;
    return normalized !== blockingState.allowedSite;
  }

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
  // The persisted blocking-storage is the source of truth (it survives a
  // fresh page load, unlike a one-off runtime message), so a tab opened
  // straight to a blocked site during an active focus session is caught
  // immediately, not just on subsequent in-page link clicks.
  blockingStorage.get().then(state => {
    blockingState = state;
    handleNavigation(window.location.href);
  });
  blockingStorage.subscribe(() => {
    const next = blockingStorage.getSnapshot();
    if (next) {
      blockingState = next;
      handleNavigation(window.location.href);
    }
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

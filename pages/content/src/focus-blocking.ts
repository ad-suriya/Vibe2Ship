import { blockingStorage, FRONTEND_URL, API_BASE } from '@extension/storage';
import type { BlockingState } from '@extension/storage';

let blockingState: BlockingState = {
  isActive: false,
  mode: 'blocklist',
  blockedSites: [],
  allowedSite: null,
  overrideUntil: {},
};

const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

// These must always be reachable no matter what's locked/blocked, or the
// lock can brick its own escape hatch:
// - the dashboard itself — otherwise there's no way to see progress, log
//   hours, or stop the lock without going through the popup specifically.
// - the BACKEND's origin — login is a real page navigation to
//   /api/auth/google/login (a 307 to Google, which then redirects back),
//   not an XHR, so the content script sees it as a normal navigation and
//   blocked it just like any other site. Missing this exemption meant a
//   locked-but-logged-out user couldn't even log back in to unlock.
// - accounts.google.com — the OAuth consent screen itself, mid-redirect.
const ALWAYS_ALLOWED_HOSTNAMES = new Set(
  [hostnameOf(FRONTEND_URL), hostnameOf(API_BASE), 'accounts.google.com'].filter(Boolean),
);

const isSiteBlocked = (url: string): boolean => {
  if (!blockingState.isActive) return false;

  // A URL with no extractable hostname (relative/malformed) can never equal
  // an exemption or the allowed site — in allowlist mode that's "always
  // blocked" by construction, the wrong fail direction for something that
  // can trap a user out of their own login flow. Fail open instead: if we
  // can't tell what this is, don't trap it.
  const normalized = hostnameOf(url);
  if (!normalized) return false;
  if (ALWAYS_ALLOWED_HOSTNAMES.has(normalized)) return false;

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
        // `link.href` is the resolved IDL property (always absolute, e.g.
        // "https://host/api/...") — `getAttribute('href')` would return the
        // raw markup instead, which for a same-origin relative link (e.g.
        // "/api/auth/google/login", exactly what the dashboard's login
        // button uses) is relative and has no hostname to check at all.
        // new URL() on that throws, isSiteBlocked's catch swallowed it to
        // '', which matched neither the allowlist nor the exemption set —
        // so it got blocked instead of correctly exempted.
        if (isSiteBlocked(link.href)) {
          event.preventDefault();
          event.stopPropagation();
          handleNavigation(link.href);
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

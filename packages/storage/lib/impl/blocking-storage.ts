import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType } from '../base/index.js';

export type BlockingMode = 'blocklist' | 'allowlist';

export interface BlockingState {
  isActive: boolean;
  mode: BlockingMode;
  // blocklist mode: these specific sites are off-limits, everything else is fine.
  blockedSites: string[];
  // allowlist mode: ONLY this one site is reachable — set when a task is
  // captured from a page and locked, so working on that task can't drift
  // into browsing anything else. null unless mode === 'allowlist'.
  allowedSite: string | null;
  // hostname -> epoch ms until which the one-time "Override" grants free access,
  // so navigating to the now-allowed page doesn't immediately re-trigger the block.
  overrideUntil: Record<string, number>;
}

// Sites blocked by default during a focus session, per the product spec
// (distraction protection inspired by the Regain app).
export const DEFAULT_BLOCKED_SITES = [
  'youtube.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'reddit.com',
];

const storage: BaseStorageType<BlockingState> = createStorage<BlockingState>(
  'focus-blocking-state',
  { isActive: false, mode: 'blocklist', blockedSites: [], allowedSite: null, overrideUntil: {} },
  { storageEnum: StorageEnum.Local, liveUpdate: true },
);

const OVERRIDE_GRACE_MS = 5 * 60 * 1000;

const normalizeHostname = (site: string): string => site.replace(/^www\./, '').toLowerCase();

export const blockingStorage = {
  ...storage,
  enable: async (sites: string[] = DEFAULT_BLOCKED_SITES): Promise<void> => {
    await storage.set({ isActive: true, mode: 'blocklist', blockedSites: sites, allowedSite: null, overrideUntil: {} });
  },
  // Captured-task site lock: the opposite of `enable` — instead of blocking
  // a known-distracting list, only `hostname` itself is reachable until
  // `disable()` is called (or a one-time Override is used).
  lockToSite: async (hostname: string): Promise<void> => {
    await storage.set({
      isActive: true,
      mode: 'allowlist',
      blockedSites: [],
      allowedSite: normalizeHostname(hostname),
      overrideUntil: {},
    });
  },
  disable: async (): Promise<void> => {
    await storage.set({ isActive: false, mode: 'blocklist', blockedSites: [], allowedSite: null, overrideUntil: {} });
  },
  overrideOnce: async (hostname: string): Promise<void> => {
    await storage.set(prev => ({
      ...prev,
      overrideUntil: { ...prev.overrideUntil, [hostname]: Date.now() + OVERRIDE_GRACE_MS },
    }));
  },
  // Live-push an edited site list into a session that's already running.
  // No-op when no session is active — editing the list shouldn't itself
  // turn blocking on.
  updateSites: async (sites: string[]): Promise<void> => {
    await storage.set(prev => (prev.isActive && prev.mode === 'blocklist' ? { ...prev, blockedSites: sites } : prev));
  },
};

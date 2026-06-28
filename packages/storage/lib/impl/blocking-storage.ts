import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType } from '../base/index.js';

export interface BlockingState {
  isActive: boolean;
  blockedSites: string[];
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
  { isActive: false, blockedSites: [], overrideUntil: {} },
  { storageEnum: StorageEnum.Local, liveUpdate: true },
);

const OVERRIDE_GRACE_MS = 5 * 60 * 1000;

export const blockingStorage = {
  ...storage,
  enable: async (sites: string[] = DEFAULT_BLOCKED_SITES): Promise<void> => {
    await storage.set({ isActive: true, blockedSites: sites, overrideUntil: {} });
  },
  disable: async (): Promise<void> => {
    await storage.set({ isActive: false, blockedSites: [], overrideUntil: {} });
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
    await storage.set(prev => (prev.isActive ? { ...prev, blockedSites: sites } : prev));
  },
};

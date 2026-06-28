import { createStorage, StorageEnum } from '../base/index.js';
import { DEFAULT_BLOCKED_SITES } from './blocking-storage.js';
import type { BaseStorageType } from '../base/index.js';

const storage: BaseStorageType<string[]> = createStorage<string[]>(
  'blocked-sites-list',
  DEFAULT_BLOCKED_SITES,
  { storageEnum: StorageEnum.Local, liveUpdate: true },
);

const normalize = (site: string): string =>
  site.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

export const blockedSitesStorage = {
  ...storage,
  add: async (site: string): Promise<string[]> => {
    const normalized = normalize(site);
    let next: string[] = [];
    await storage.set(prev => {
      next = normalized && !prev.includes(normalized) ? [...prev, normalized] : prev;
      return next;
    });
    return next;
  },
  remove: async (site: string): Promise<string[]> => {
    let next: string[] = [];
    await storage.set(prev => {
      next = prev.filter(s => s !== site);
      return next;
    });
    return next;
  },
};

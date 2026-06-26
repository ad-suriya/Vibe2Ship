import { createStorage, StorageEnum } from '../base/index.js';

interface AuthState {
  isAuthenticated: boolean;
  user: {
    id: string;
    email: string;
    name: string;
    picture?: string;
  } | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
}

const storage = createStorage<AuthState>(
  'auth-storage-key',
  {
    isAuthenticated: false,
    user: null,
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
  },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

export const authStorage = {
  ...storage,
  setAuth: async (user: AuthState['user'], accessToken: string, refreshToken: string, expiresIn: number = 3600) => {
    await storage.set(() => ({
      isAuthenticated: !!user,
      user,
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
    }));
  },
  logout: async () => {
    await storage.set(() => ({
      isAuthenticated: false,
      user: null,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
    }));
  },
  isTokenExpired: async () => {
    const state = await storage.get();
    if (!state.expiresAt) return true;
    return Date.now() > state.expiresAt;
  },
  getAccessToken: async () => {
    const state = await storage.get();
    return state.accessToken;
  },
};

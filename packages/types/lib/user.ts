export interface StreakData {
  currentCount: number;
  longestCount: number;
  lastActiveDate: number;
  startDate: number;
  frozenUntil?: number;
}

export interface UserSettings {
  userId: string;
  defaultFocusDuration: number;
  longFocusDuration: number;
  pomodoroBreakDuration: number;
  dailyFocusQuotaMinutes: number;
  dailyBreakQuotaMinutes: number;
  blockedSites: string[];
  blockedSitesCustom: string[];
  enableNotifications: boolean;
  enableBreakReminders: boolean;
  timezone: string;
  theme: 'light' | 'dark' | 'system';
  lastModified: number;
  syncedToMobile: boolean;
  syncedAt?: number;
}

export interface UserProfile {
  userId: string;
  email: string;
  displayName: string;
  createdAt: number;
  settings: UserSettings;
  streak: StreakData;
}

export type UserSettingsUpdatePayload = Partial<
  Omit<UserSettings, 'userId' | 'lastModified'>
>;

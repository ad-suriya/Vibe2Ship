export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
export type ScheduleType = 'daily' | 'weekly' | 'custom';

export interface TimeRange {
  startTime: string; // HH:mm format
  endTime: string;   // HH:mm format
}

export interface WeeklySchedule {
  type: 'weekly';
  days: DayOfWeek[];
  timeRange: TimeRange;
}

export interface DailySchedule {
  type: 'daily';
  timeRange: TimeRange;
}

export interface CustomSchedule {
  type: 'custom';
  dates: string[]; // ISO date strings YYYY-MM-DD
  timeRange: TimeRange;
}

export type Schedule = WeeklySchedule | DailySchedule | CustomSchedule;

export interface BlockSchedule {
  id: string;
  sites: string[]; // URLs to block
  schedule: Schedule;
  isActive: boolean;
  createdAt: number;
  lastModified: number;
}

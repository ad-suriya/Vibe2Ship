// Engine + API contract shared between the FastAPI backend and the React UI.

export type Mode =
  | 'PLANNING_MODE'
  | 'FOCUS_MODE'
  | 'PANIC_MODE'
  | 'REVIEW_MODE';

export type ActionType =
  | 'DRAFT_EMAIL'
  | 'CREATE_OUTLINE'
  | 'MOCK_QUESTIONS'
  | 'RESOURCE_LINK'
  | 'NONE';

export type Status = 'TODO' | 'IN_PROGRESS' | 'COMPLETED';

export type Urgency = 'HIGH' | 'MEDIUM' | 'LOW';

export type SystemTrigger =
  | 'START_POMODORO'
  | 'PROMPT_CALENDAR_SYNC'
  | 'NONE';

export interface ChatUI {
  agent_message: string;
  suggested_quick_replies: string[];
}

export interface AgenticAction {
  action_type: ActionType;
  action_content: string;
}

// Persisted task as returned by the backend (Firestore-backed).
export interface Task {
  id: number;
  task_name: string;
  status: Status;
  urgency: Urgency;
  estimated_minutes: number;
  deadline: string | null; // ISO 8601 local datetime
  next_micro_step: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  goal_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface ChatResponse {
  chat_ui: ChatUI;
  current_mode: Mode;
  agentic_action: AgenticAction;
  system_trigger: SystemTrigger;
  tasks: Task[];
}

export interface StatusInfo {
  now: string;
  overdue: number[];
  slipped: number[];
  at_risk: number[];
  recommend_reschedule: boolean;
}

export interface ScheduleResult {
  tasks: Task[];
  at_risk: number[];
  message: string;
}

export interface RescheduleResult {
  tasks: Task[];
  moved: number[];
  overdue: number[];
  at_risk: number[];
  message: string;
}

export type ReminderKind = 'DEADLINE' | 'FOCUS_START' | 'CUSTOM';

export interface Reminder {
  id: number;
  task_id: number | null;
  message: string;
  remind_at: string;
  kind: ReminderKind;
  acknowledged: number;
  created_at: string;
  due: boolean;
}

export interface Goal {
  id: number;
  title: string;
  description: string;
  metric: string;
  target_value: number;
  current_value: number;
  deadline: string | null;
  created_at: string;
  updated_at: string;
  linked_total: number;
  linked_done: number;
}

export interface HabitDay {
  date: string;
  done: boolean;
}

export interface Habit {
  id: number;
  name: string;
  cadence: 'DAILY' | 'WEEKLY';
  created_at: string;
  streak: number;
  done_today: boolean;
  total_done: number;
  last7: HabitDay[];
}

// Local UI-only type.
export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  system?: boolean; // engine/system note rendered distinctly in the chat
}

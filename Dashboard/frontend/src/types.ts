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
  // Actual minutes logged so far — drives the deadline-risk prediction
  // below. Not auto-tracked from focus sessions; set via the UI.
  completed_minutes?: number;
  deadline: string | null; // ISO 8601 local datetime
  next_micro_step: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  goal_id: number | null;
  calendar_event_id: string | null;
  created_at: string;
  updated_at: string;
  // Other task ids that must be COMPLETED before this one starts — the
  // execution graph for AI-decomposed goals. Absent/empty for tasks created
  // any other way (chat, manual add, workflows).
  dependencies?: number[];
  // Live deadline-risk prediction (risk.py), recomputed on every fetch —
  // null if the task has no deadline or is already done.
  risk?: TaskRisk | null;
}

export type RiskLevel = 'safe' | 'medium' | 'high';

export interface TaskRisk {
  task_id: number;
  risk_score: number;
  risk_percent: number;
  risk_level: RiskLevel;
  remaining_hours: number;
  usable_hours: number;
  productivity_factor: number;
  reason: string;
}

// A focus/work-timer session — the same resource the Chrome extension's
// popup polls, so starting one here makes the extension reflect it too.
export interface Session {
  id: number;
  description: string;
  project_id: number | null;
  start_time: string;
  end_time: string | null;
  duration_minutes: number;
  is_paused: boolean;
  breaks_taken: number;
  total_break_minutes: number;
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
  risks: TaskRisk[];
  // Automatic task recovery — set when the "incomplete after end time"
  // trigger fired during this poll (see recovery.py), null otherwise.
  recovery: RecoveryResult | null;
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

// --- Automatic task recovery -------------------------------------------------
export interface RecoveryChunk {
  start: string;
  end: string;
}

export interface RecoveryMove {
  task_id: number;
  task_name: string;
  old_start: string | null;
  old_end: string | null;
  new_start: string;
  new_end: string;
  chunks: RecoveryChunk[];
}

export interface RecoveryResult {
  tasks: Task[];
  moved: RecoveryMove[];
  message: string;
}

export interface FreeSlot {
  start: string;
  end: string;
  free_hours: number;
}

// --- Long-term behavioral memory --------------------------------------------
// Compact facts derived from planned-vs-actual task timing (db.py's
// task_events log) — never raw chat. Retrievable as AI context for chat.
export interface MemoryFact {
  id: number;
  fact: string;
  created_at: string;
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

// Persisted chat (Firestore-backed via the backend, keyed by a client-generated
// session id stored in localStorage).
export interface PersistedChatMessage {
  id: number;
  role: 'user' | 'model';
  content: string;
  timestamp: string;
}

export interface ChatSession {
  id: string;
  messages: PersistedChatMessage[];
}

// --- AI Search Assistant --------------------------------------------------
export interface SearchResults {
  tasks: Task[];
  goals: Goal[];
  habits: Habit[];
  sessions: Session[];
}

// --- AI Workflow Builder ---------------------------------------------------
export type WorkflowTriggerType = 'DAILY' | 'WEEKLY' | 'ON_TASK_COMPLETE' | 'MANUAL';

export interface WorkflowStep {
  task_name: string;
  urgency: Urgency;
  estimated_minutes: number;
  tags: string[];
}

export interface WorkflowPlan {
  name: string;
  trigger_type: WorkflowTriggerType;
  trigger_match: string;
  steps: WorkflowStep[];
}

export interface Workflow extends WorkflowPlan {
  id: number;
  sop_text: string;
  active: boolean;
  last_run: string | null;
  created_at: string;
  updated_at: string;
}

// --- AI Task Decomposition --------------------------------------------------
export interface SubtaskDraft {
  // Local to one decomposition draft, used only to express depends_on —
  // replaced by the real Firestore task id once committed.
  id: string;
  title: string;
  estimated_hours: number;
  priority: Urgency;
  depends_on: string[];
}

export interface DecompositionPlan {
  goal: string;
  subtasks: SubtaskDraft[];
}

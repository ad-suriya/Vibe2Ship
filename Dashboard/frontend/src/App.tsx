/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LoginPage } from './LoginPage';
import {
  Loader2, Send, Copy, Check, Timer, CalendarPlus, Play, Pause, RotateCcw,
  Plus, CalendarDays, RefreshCw, Trash2, Download, Clock, AlertTriangle, ArrowRight, Link2, Unlink,
  MessageCircle, X, HelpCircle, Crosshair, SkipForward,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from './api';
import {
  AgenticAction, ChatMessage, DecompositionPlan, Goal, Habit, MemoryFact, Mode, Status, SystemTrigger, Task,
  TaskRisk, Urgency, Workflow, WorkflowPlan,
} from './types';
import RemindersBell from './components/RemindersBell';
import GoalsPanel from './components/GoalsPanel';
import HabitsPanel from './components/HabitsPanel';
import ExecutionPanel from './components/ExecutionPanel';
import PanicPanel from './components/PanicPanel';
import SearchBar from './components/SearchBar';
import GuidedTour from './components/GuidedTour';
import NotificationPrompt from './components/NotificationPrompt';
import WorkflowsPanel from './components/WorkflowsPanel';
import DecomposePanel from './components/DecomposePanel';
import MemoryPanel from './components/MemoryPanel';
import Sidebar, { Section } from './components/Sidebar';

const MODE_META: Record<Mode, { label: string; color: string; blurb: string }> = {
  PLANNING_MODE: { label: 'Planning', color: '#2A6B5E', blurb: 'Deadline is days out — be strategic.' },
  FOCUS_MODE: { label: 'Focus', color: '#1A1A1A', blurb: 'One task. Heads down. Execute.' },
  PANIC_MODE: { label: 'Panic', color: '#D14D2A', blurb: 'Hours left — urgent, direct action only.' },
  REVIEW_MODE: { label: 'Review', color: '#6B5BD1', blurb: 'Reflecting on what is done.' },
};
const URGENCY_COLOR: Record<Urgency, string> = { HIGH: '#D14D2A', MEDIUM: '#1A1A1A', LOW: '#6B7280' };
const URGENCY_RANK: Record<Urgency, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const RISK_COLOR: Record<TaskRisk['risk_level'], string> = { high: '#D14D2A', medium: '#C99A2E', safe: '#2A6B5E' };
const STATUS_LABEL: Record<Status, string> = { TODO: 'To Do', IN_PROGRESS: 'In Progress', COMPLETED: 'Completed' };
const ACTION_LABEL: Record<string, string> = {
  DRAFT_EMAIL: 'Drafted Email', CREATE_OUTLINE: 'Generated Outline',
  MOCK_QUESTIONS: 'Practice Questions', RESOURCE_LINK: 'Resource',
};
const POMODORO_SECONDS = 25 * 60;
const SEED_MESSAGE: ChatMessage = {
  role: 'model',
  text: "What's weighing on you? Dump the deadline, the half-finished task, the thing you keep avoiding — I'll turn it into a plan and start the first step for you.",
};

const CHAT_SESSION_KEY = 'chatSessionId';
function loadOrCreateChatSessionId(): string {
  const existing = localStorage.getItem(CHAT_SESSION_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(CHAT_SESSION_KEY, id);
  return id;
}

const pad = (n: number) => n.toString().padStart(2, '0');
const fmtTimer = (s: number) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const diff = (startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86400000;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtDeadline(iso: string): string {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const gcalStamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d+/, '');
function gcalUrl(task: Task): string {
  const s = task.scheduled_start || task.deadline;
  const e = task.scheduled_end || task.deadline;
  const text = encodeURIComponent(task.task_name);
  const details = encodeURIComponent(task.next_micro_step || '');
  const dates = s && e ? `&dates=${gcalStamp(s)}/${gcalStamp(e)}` : '';
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}${dates}&details=${details}`;
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authUser, setAuthUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatSessionId, setChatSessionId] = useState<string>(loadOrCreateChatSessionId);
  const [chatLoading, setChatLoading] = useState(true); // hydrating from Firestore
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [mode, setMode] = useState<Mode>('PLANNING_MODE');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [action, setAction] = useState<AgenticAction | null>(null);
  const [trigger, setTrigger] = useState<SystemTrigger>('NONE');
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [atRisk, setAtRisk] = useState<Set<number>>(new Set());
  const [overdue, setOverdue] = useState<Set<number>>(new Set());
  // Deadline-risk prediction (risk.py), keyed by task id — refreshed by the
  // same 60s status poll, plus immediately after any edit that affects it.
  const [taskRisks, setTaskRisks] = useState<Record<number, TaskRisk>>({});

  const [pomoSeconds, setPomoSeconds] = useState(POMODORO_SECONDS);
  const [pomoRunning, setPomoRunning] = useState(false);
  const [pomoSessionId, setPomoSessionId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<'' | 'schedule' | 'reschedule'>('');

  const [showAdd, setShowAdd] = useState(false);
  const [newTask, setNewTask] = useState({ task_name: '', deadline: '', estimated_minutes: 30, urgency: 'MEDIUM' as Urgency, goal_id: '' });

  const [goals, setGoals] = useState<Goal[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [memoryFacts, setMemoryFacts] = useState<MemoryFact[]>([]);
  const [tab, setTab] = useState<Section>('plan');
  const [chatOpen, setChatOpen] = useState(true);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showNotifPrompt, setShowNotifPrompt] = useState(false);

  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const guardRef = useRef(false); // prevents overlapping auto-reschedules

  // --- effects ---------------------------------------------------------------
  useEffect(() => {
    // The backend's OAuth callback (/api/auth/google/callback) redirects back
    // here with the verified ID token in a URL fragment, e.g. #credential=...
    // A fragment (not a query param) keeps it out of server logs and isn't
    // sent on any subsequent request.
    const hashMatch = window.location.hash.match(/credential=([^&]+)/);
    if (hashMatch) {
      const credential = decodeURIComponent(hashMatch[1]);
      try {
        const base64Url = credential.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
          atob(base64)
            .split('')
            .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
        );
        const userData = JSON.parse(jsonPayload);
        const authData = {
          isAuthenticated: true,
          user: {
            id: userData.sub,
            email: userData.email,
            name: userData.name,
            picture: userData.picture,
          },
          accessToken: credential,
          refreshToken: credential,
          expiresAt: Date.now() + 3600 * 1000,
        };
        localStorage.setItem('auth', JSON.stringify(authData));
        window.history.replaceState(null, '', window.location.pathname + window.location.search);

        fetch('/api/me', {
          method: 'POST',
          headers: { Authorization: `Bearer ${credential}` },
        }).catch((err) => console.error('Failed to persist user to backend:', err));

        // The extension's dashboard-bridge content script listens for this and
        // relays isAuthenticated/user/accessToken/refreshToken to the
        // background script — that's the only path that carries the real
        // token to the extension (chrome.runtime isn't reachable from this
        // page directly without externally_connectable + an extension id).
        window.dispatchEvent(new CustomEvent('dashboardAuthChanged', { detail: authData }));

        setIsAuthenticated(true);
        setAuthUser(userData);
        setAuthLoading(false);
        return;
      } catch (err) {
        console.error('Failed to parse credential from redirect:', err);
      }
    }

    const params = new URLSearchParams(window.location.search);
    const err = params.get('auth_error');
    if (err) {
      setAuthError(err);
      window.history.replaceState(null, '', window.location.pathname);
    }

    // Check authentication from localStorage
    const authStr = localStorage.getItem('auth');
    if (authStr) {
      try {
        const auth = JSON.parse(authStr);
        if (auth.isAuthenticated && auth.user) {
          setIsAuthenticated(true);
          setAuthUser(auth.user);

          // Re-broadcast on every page load (not just at login time) so the
          // extension's content script re-syncs after a reload/refresh —
          // otherwise a stale content script from before an extension reload
          // never hears about an auth state that already existed.
          window.dispatchEvent(new CustomEvent('dashboardAuthChanged', { detail: auth }));
        }
      } catch (err) {
        console.error('Failed to parse auth:', err);
      }
    }
    setAuthLoading(false);
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  // Restore the conversation for this session id from Firestore (via the
  // backend) on startup/refresh — runs before render shows an empty chat.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    setChatLoading(true);
    api.getChatSession(chatSessionId)
      .then((chat) => {
        if (cancelled) return;
        setMessages(
          chat.messages.length > 0
            ? chat.messages.map((m) => ({ role: m.role, text: m.content }))
            : [SEED_MESSAGE],
        );
      })
      .catch(() => { if (!cancelled) setMessages([SEED_MESSAGE]); })
      .finally(() => { if (!cancelled) setChatLoading(false); });
    return () => { cancelled = true; };
  }, [isAuthenticated, chatSessionId]);

  useEffect(() => {
    if (!isAuthenticated) return;

    api.listTasks().then(setTasks).catch(() => {});
    api.listGoals().then(setGoals).catch(() => {});
    api.listHabits().then(setHabits).catch(() => {});
    api.listWorkflows().then(setWorkflows).catch(() => {});
    api.getMemory().then(setMemoryFacts).catch(() => {});
    api.calendarStatus().then((s) => setCalendarConnected(s.connected)).catch(() => {});

    if (!localStorage.getItem('tutorialSeen')) setShowTutorial(true);

    // Ask for notification permission up front instead of leaving it buried
    // in the Reminders bell dropdown where most people would never find it.
    // Only if the browser hasn't already been asked (or denied) — re-asking
    // after a denial just gets auto-rejected and annoys people.
    if (typeof Notification !== 'undefined' && Notification.permission === 'default' && !localStorage.getItem('notifPromptSeen')) {
      setShowNotifPrompt(true);
    }
  }, [isAuthenticated]);

  // Sync the timer with whatever session is actually active on the backend —
  // without this, a session started from the extension popup (or this same
  // page before a reload) never shows up here: pomoSeconds/pomoRunning were
  // purely local state with nothing ever reading back from /api/sessions.
  useEffect(() => {
    if (!isAuthenticated) return;
    const sync = async () => {
      try {
        const sessions = await api.listSessions();
        const active = sessions.filter((s) => !s.end_time).sort((a, b) => b.id - a.id)[0];
        if (!active) {
          setPomoSessionId(null);
          setPomoRunning(false);
          return;
        }
        const elapsedSeconds = Math.floor((Date.now() - new Date(active.start_time).getTime()) / 1000);
        const remaining = Math.max(0, active.duration_minutes * 60 - elapsedSeconds);
        setPomoSessionId(active.id);
        setPomoSeconds(remaining);
        setPomoRunning(!active.is_paused && remaining > 0);
      } catch { /* offline — try again next tick */ }
    };
    sync();
    const id = setInterval(sync, 5_000);
    return () => clearInterval(id);
  }, [isAuthenticated]);

  const handleLogout = () => {
    localStorage.removeItem('auth');
    // Mirror the login path: the extension's dashboard-bridge content script
    // listens for this on the dashboard tab and relays it to the background
    // script, which clears the extension's own auth state too.
    window.dispatchEvent(new CustomEvent('dashboardAuthChanged', {
      detail: { isAuthenticated: false, user: null, accessToken: '', refreshToken: '' },
    }));
    setIsAuthenticated(false);
    setAuthUser(null);
  };

  const dismissTutorial = () => {
    localStorage.setItem('tutorialSeen', '1');
    setShowTutorial(false);
  };

  const enableNotifications = async () => {
    if (typeof Notification !== 'undefined') {
      try { await Notification.requestPermission(); } catch { /* unsupported */ }
    }
    localStorage.setItem('notifPromptSeen', '1');
    setShowNotifPrompt(false);
  };

  const dismissNotifPrompt = () => {
    localStorage.setItem('notifPromptSeen', '1');
    setShowNotifPrompt(false);
  };

  useEffect(() => {
    if (!pomoRunning) return;
    const id = setInterval(() => {
      setPomoSeconds((s) => { if (s <= 1) { setPomoRunning(false); return 0; } return s - 1; });
    }, 1000);
    return () => clearInterval(id);
  }, [pomoRunning]);

  // The countdown reaching zero ends the timer locally — also end the
  // backend session so the extension's popup (which polls /api/sessions)
  // stops showing it as active.
  useEffect(() => {
    if (pomoSeconds !== 0 || pomoSessionId == null) return;
    const id = pomoSessionId;
    setPomoSessionId(null);
    api.patchSession(id, { end_time: new Date().toISOString() }).catch(() => {});
  }, [pomoSeconds, pomoSessionId]);

  // Autonomous rescheduling + deadline-risk refresh: poll status, auto-replan
  // when tasks have slipped. This same 60s tick is what makes risk "real
  // time" — every poll recomputes against the current clock, well inside
  // the "run hourly" requirement.
  useEffect(() => {
    const check = async () => {
      if (guardRef.current || loading) return;
      try {
        const s = await api.status();
        setAtRisk(new Set(s.at_risk));
        setOverdue(new Set(s.overdue));
        setTaskRisks(Object.fromEntries(s.risks.map((r) => [r.task_id, r])));
        // Automatic task recovery's "incomplete after end time" trigger
        // fires server-side on this same poll (see recovery.py) — surface
        // it the moment it happens, same pattern as a workflow firing.
        if (s.recovery) {
          setTasks(s.recovery.tasks);
          pushSystem(s.recovery.message);
        }
        if (s.recommend_reschedule) {
          guardRef.current = true;
          const r = await api.reschedule();
          setTasks(r.tasks);
          setAtRisk(new Set(r.at_risk));
          setOverdue(new Set(r.overdue));
          guardRef.current = false;
        }
      } catch { /* offline / backend down — ignore */ }
    };
    const id = setInterval(check, 60_000);
    const t = setTimeout(check, 4_000); // first pass shortly after load

    // "Run after inactivity": a backgrounded/minimized tab pauses JS timers,
    // so the 60s interval can't be trusted to have fired — force an
    // immediate recheck the moment the tab becomes visible again.
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => { clearInterval(id); clearTimeout(t); document.removeEventListener('visibilitychange', onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Automatic task recovery — "inactivity detected" trigger: distinct from
  // the time-based "incomplete after end time" trigger above (which fires
  // on the clock regardless of whether anyone's there), this fires only
  // when the user has stopped interacting while a task is IN_PROGRESS and
  // already past its scheduled end — i.e. they walked away mid-task.
  const tasksRef = useRef<Task[]>(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => {
    const IDLE_THRESHOLD_MS = 5 * 60_000;
    let lastActivity = Date.now();
    const handled = new Set<number>();
    const markActive = () => { lastActivity = Date.now(); };
    const events: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, markActive, { passive: true }));

    const id = setInterval(() => {
      if (Date.now() - lastActivity < IDLE_THRESHOLD_MS) return;
      const now = Date.now();
      const stale = tasksRef.current.find((t) =>
        t.status === 'IN_PROGRESS' && t.scheduled_end && new Date(t.scheduled_end).getTime() < now && !handled.has(t.id),
      );
      if (stale) {
        handled.add(stale.id);
        skipTask(stale);
      }
    }, 30_000);

    return () => { events.forEach((e) => window.removeEventListener(e, markActive)); clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-sync with Google Calendar: pulls in events the user added directly
  // on their calendar (as tasks) and pushes the current plan back out, on a
  // timer — no "Sync" button press required once Calendar is connected.
  const calendarSyncGuardRef = useRef(false);
  useEffect(() => {
    if (!calendarConnected) return;
    const syncNow = async () => {
      if (calendarSyncGuardRef.current) return;
      calendarSyncGuardRef.current = true;
      try {
        const r = await api.calendarSync();
        setTasks(r.tasks);
        if (r.imported > 0) {
          pushSystem(`Pulled ${r.imported} event${r.imported === 1 ? '' : 's'} from your Google Calendar.`);
        }
        refreshStatus();
      } catch { /* offline / token revoked — try again next tick */ }
      finally { calendarSyncGuardRef.current = false; }
    };
    const id = setInterval(syncNow, 90_000);
    const t = setTimeout(syncNow, 2_000);
    return () => { clearInterval(id); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarConnected]);

  // --- helpers ---------------------------------------------------------------
  const pushSystem = (text: string) =>
    setMessages((prev) => [...prev, { role: 'model', text, system: true }]);

  // Old sessions are left in Firestore untouched — only the localStorage
  // pointer moves, so switching back would still find them if we ever add
  // a session switcher.
  const startNewChat = () => {
    const id = crypto.randomUUID();
    localStorage.setItem(CHAT_SESSION_KEY, id);
    setChatSessionId(id);
    setMessages([SEED_MESSAGE]);
    setQuickReplies([]);
    setError('');
  };

  const refreshStatus = async () => {
    try {
      const s = await api.status();
      setAtRisk(new Set(s.at_risk));
      setOverdue(new Set(s.overdue));
      setTaskRisks(Object.fromEntries(s.risks.map((r) => [r.task_id, r])));
      if (s.recovery) {
        setTasks(s.recovery.tasks);
        pushSystem(s.recovery.message);
      }
    } catch { /* ignore */ }
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const history = messages
      .filter((m) => m !== SEED_MESSAGE && !m.system)
      .map((m) => ({ role: m.role, text: m.text }));

    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
    api.addChatMessage(chatSessionId, 'user', trimmed).catch(() => {});
    setInput('');
    setQuickReplies([]);
    setError('');
    setLoading(true);
    try {
      const data = await api.chat(trimmed, history);
      setMessages((prev) => [...prev, { role: 'model', text: data.chat_ui.agent_message }]);
      api.addChatMessage(chatSessionId, 'model', data.chat_ui.agent_message).catch(() => {});
      setQuickReplies(data.chat_ui.suggested_quick_replies || []);
      setMode(data.current_mode);
      setAction(data.agentic_action?.action_type !== 'NONE' ? data.agentic_action : null);
      setTasks(data.tasks);
      setTrigger(data.system_trigger);
      if (data.system_trigger === 'START_POMODORO') {
        setPomoSeconds(POMODORO_SECONDS);
        setPomoRunning(true);
        api.startSession('Pomodoro focus session', POMODORO_SECONDS / 60)
          .then((s) => setPomoSessionId(s.id))
          .catch(() => {});
      }
      refreshStatus();
    } catch (err: any) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  const togglePomo = () => {
    const next = !pomoRunning;
    setPomoRunning(next);
    if (pomoSessionId != null) api.patchSession(pomoSessionId, { is_paused: !next }).catch(() => {});
  };

  const resetPomo = () => {
    setPomoRunning(false);
    setPomoSeconds(POMODORO_SECONDS);
    if (pomoSessionId != null) {
      api.patchSession(pomoSessionId, { end_time: new Date().toISOString() }).catch(() => {});
      setPomoSessionId(null);
    }
  };

  const cycleStatus = async (task: Task) => {
    const next: Status = task.status === 'TODO' ? 'IN_PROGRESS' : task.status === 'IN_PROGRESS' ? 'COMPLETED' : 'TODO';
    const updated = await api.patchTask(task.id, { status: next });
    setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    setTaskRisks((prev) => {
      if (updated.risk) return { ...prev, [task.id]: updated.risk };
      const { [task.id]: _drop, ...rest } = prev; // e.g. just marked COMPLETED — no risk anymore
      return rest;
    });
    refreshStatus();
    if (task.goal_id) api.listGoals().then(setGoals).catch(() => {}); // keep linked goal progress in sync
  };

  const removeTask = async (id: number) => {
    await api.deleteTask(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  // "Run on task update": logging hours immediately returns a freshly
  // computed risk (risk.py) on this one task — no need to wait for the
  // next 60s status poll to see the badge move.
  const logCompletedHours = async (task: Task, hours: number) => {
    const updated = await api.patchTask(task.id, { completed_minutes: Math.max(0, Math.round(hours * 60)) });
    setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    if (updated.risk) setTaskRisks((prev) => ({ ...prev, [task.id]: updated.risk! }));
  };

  // Automatic task recovery — "user skips task" trigger. Inactivity
  // detection (below) calls this same handler for the same reason: both are
  // just different ways of deciding a task got missed.
  const skipTask = async (task: Task) => {
    try {
      const result = await api.skipTask(task.id);
      setTasks(result.tasks);
      pushSystem(result.message);
    } catch (err: any) {
      setError(err.message || 'Could not move this task.');
    }
  };

  const addTask = async () => {
    if (!newTask.task_name.trim()) return;
    const created = await api.createTask({
      task_name: newTask.task_name.trim(),
      urgency: newTask.urgency,
      estimated_minutes: Number(newTask.estimated_minutes) || 30,
      deadline: newTask.deadline ? newTask.deadline : null,
      goal_id: newTask.goal_id ? Number(newTask.goal_id) : null,
    });
    setTasks((prev) => [...prev, created]);
    setNewTask({ task_name: '', deadline: '', estimated_minutes: 30, urgency: 'MEDIUM', goal_id: '' });
    setShowAdd(false);
  };

  // --- goals & habits handlers ----------------------------------------------
  const addGoal = async (body: { title: string; metric: string; target_value: number; deadline: string | null }) => {
    const g = await api.createGoal(body);
    setGoals((prev) => [...prev, g]);
  };
  const incGoal = async (id: number, delta: number) => {
    const g = await api.incrementGoal(id, delta);
    setGoals((prev) => prev.map((x) => (x.id === id ? g : x)));
  };
  const deleteGoal = async (id: number) => {
    await api.deleteGoal(id);
    setGoals((prev) => prev.filter((x) => x.id !== id));
  };
  const addHabit = async (name: string, cadence: 'DAILY' | 'WEEKLY') => {
    const h = await api.createHabit(name, cadence);
    setHabits((prev) => [...prev, h]);
  };
  const checkHabit = async (id: number) => {
    const h = await api.checkHabit(id);
    setHabits((prev) => prev.map((x) => (x.id === id ? h : x)));
  };
  const deleteHabit = async (id: number) => {
    await api.deleteHabit(id);
    setHabits((prev) => prev.filter((x) => x.id !== id));
  };

  // --- workflows handlers (AI Workflow Builder) ------------------------------
  const generateWorkflowDraft = (sopText: string) => api.generateWorkflow(sopText);
  const saveWorkflow = async (plan: WorkflowPlan, sopText: string) => {
    const w = await api.createWorkflow({ ...plan, sop_text: sopText, active: true });
    setWorkflows((prev) => [...prev, w]);
  };
  const toggleWorkflowActive = async (id: number, active: boolean) => {
    const w = await api.patchWorkflow(id, { active });
    setWorkflows((prev) => prev.map((x) => (x.id === id ? w : x)));
  };
  const runWorkflow = async (id: number) => {
    const { created } = await api.runWorkflow(id);
    setTasks((prev) => [...prev, ...created]);
    api.listWorkflows().then(setWorkflows).catch(() => {});
    pushSystem(`Workflow ran — added ${created.length} task${created.length === 1 ? '' : 's'}.`);
  };
  const deleteWorkflowById = async (id: number) => {
    await api.deleteWorkflow(id);
    setWorkflows((prev) => prev.filter((x) => x.id !== id));
  };

  // --- task decomposition handlers (AI Task Decomposition) ------------------
  const decomposeGoalDraft = (goal: string) => api.decomposeGoal(goal);
  const commitDecomposition = async (plan: DecompositionPlan) => {
    const created = await api.commitDecomposition(plan.goal, plan.subtasks);
    setTasks((prev) => [...prev, ...created]);
    pushSystem(`Broke "${plan.goal}" into ${created.length} task${created.length === 1 ? '' : 's'}.`);
    return created;
  };

  // --- long-term behavioral memory -------------------------------------------
  const summarizeMemoryNow = async () => {
    const facts = await api.summarizeMemory();
    setMemoryFacts(facts);
  };

  // Search result selection: jump to the relevant tab. Tasks live on the
  // "plan" tab already, so there's nothing more specific to scroll to yet.
  const selectSearchTask = (_task: Task) => setTab('plan');
  const selectSearchGoal = () => setTab('goals');
  const selectSearchHabit = () => setTab('habits');

  const connectCalendar = () => {
    // Calendar access is granted via the same full-page OAuth redirect as
    // sign-in (it's requested as part of that scope) — re-running it with
    // `prompt=consent` always returns a fresh refresh token, so this also
    // doubles as "reconnect" if access was revoked.
    window.location.href = '/api/auth/google/login';
  };

  const disconnectCalendar = async () => {
    setCalendarBusy(true);
    try {
      await api.disconnectCalendar();
      setCalendarConnected(false);
    } catch (err: any) {
      setError(err.message || 'Could not disconnect Google Calendar.');
    } finally { setCalendarBusy(false); }
  };

  const planDay = async () => {
    setBusy('schedule');
    try {
      const r = await api.schedule();
      setTasks(r.tasks);
      setAtRisk(new Set(r.at_risk));
      pushSystem(r.message);
      refreshStatus();
    } catch (err: any) {
      setError(err.message || 'Could not build a schedule.');
    } finally { setBusy(''); }
  };

  const rescheduleNow = async () => {
    setBusy('reschedule');
    guardRef.current = true;
    try {
      const r = await api.reschedule();
      setTasks(r.tasks);
      setAtRisk(new Set(r.at_risk));
      setOverdue(new Set(r.overdue));
      pushSystem(r.message);
    } catch (err: any) {
      setError(err.message || 'Could not reschedule.');
    } finally { setBusy(''); guardRef.current = false; }
  };

  const copyAction = async () => {
    if (!action) return;
    try {
      await navigator.clipboard.writeText(action.action_content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  // --- derived ---------------------------------------------------------------
  const modeMeta = MODE_META[mode];
  const scheduled = useMemo(
    () => tasks.filter((t) => t.scheduled_start && t.status !== 'COMPLETED')
      .sort((a, b) => new Date(a.scheduled_start!).getTime() - new Date(b.scheduled_start!).getTime()),
    [tasks],
  );
  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of scheduled) {
      const label = dayLabel(t.scheduled_start!);
      (map.get(label) ?? map.set(label, []).get(label)!).push(t);
    }
    return Array.from(map, ([label, items]) => ({ label, items }));
  }, [scheduled]);
  const hasRisk = atRisk.size > 0 || overdue.size > 0;

  // The single most urgent open task — backs both the Execution panel
  // ("up next" when nothing is in progress) and Panic mode (the one task
  // shown when everything else is suppressed).
  const openTasks = useMemo(() => tasks.filter((t) => t.status !== 'COMPLETED'), [tasks]);
  const priorityTask = useMemo(() => {
    if (openTasks.length === 0) return null;
    return [...openTasks].sort((a, b) => {
      const rank = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      if (rank !== 0) return rank;
      const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      return ad - bd;
    })[0];
  }, [openTasks]);
  const inProgressTask = useMemo(() => tasks.find((t) => t.status === 'IN_PROGRESS') ?? null, [tasks]);
  const executionTask = inProgressTask ?? priorityTask;
  const overdueTasks = useMemo(() => tasks.filter((t) => overdue.has(t.id)), [tasks, overdue]);

  const markTaskDone = async (task: Task) => {
    const updated = await api.patchTask(task.id, { status: 'COMPLETED' });
    setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    refreshStatus();
    if (task.goal_id) api.listGoals().then(setGoals).catch(() => {});
  };

  const startFocusOnTask = async (task: Task) => {
    // Only one task is ever "the" active one — choosing a different task to
    // focus on demotes whatever was previously in progress back to To Do,
    // so the Execution Panel always shows exactly the task just picked.
    if (inProgressTask && inProgressTask.id !== task.id) {
      const reverted = await api.patchTask(inProgressTask.id, { status: 'TODO' });
      setTasks((prev) => prev.map((t) => (t.id === inProgressTask.id ? reverted : t)));
    }
    const updated = await api.patchTask(task.id, { status: 'IN_PROGRESS' });
    setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    setTab('plan');
    setPomoSeconds(POMODORO_SECONDS);
    setPomoRunning(true);
    api.startSession(task.task_name, POMODORO_SECONDS / 60).then((s) => setPomoSessionId(s.id)).catch(() => {});
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F5F2ED] text-[#1A1A1A] flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto" />
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage authError={authError} />;
  }

  return (
    <div className="h-screen bg-[#F5F2ED] text-[#1A1A1A] font-serif flex overflow-hidden">
      {showTutorial && (
        <GuidedTour
          onDismiss={dismissTutorial}
          onStepChange={(selector) => {
            if (selector === '[data-tour="task-toolbar"]' || selector === '[data-tour="nav-board"]') setTab('board');
            else if (selector === '[data-tour="nav-plan"]') setTab('plan');
          }}
        />
      )}
      <Sidebar active={tab} onSelect={setTab} badges={{ board: openTasks.length || undefined, workflows: workflows.length || undefined }} />

      <div className="flex-grow flex flex-col min-w-0 h-full">
        <Sidebar horizontal active={tab} onSelect={setTab} badges={{ board: openTasks.length || undefined, workflows: workflows.length || undefined }} />

        {/* Top bar */}
        <header className="relative z-50 flex flex-col md:flex-row justify-between md:items-center border-b border-[#1A1A1A] bg-white px-4 md:px-6 py-3 gap-3">
          <div className="flex items-center gap-2">
            <span className="font-sans text-[10px] uppercase tracking-widest font-bold opacity-60">Mode</span>
            <span className="font-sans text-[11px] font-bold uppercase tracking-widest px-3 py-1 text-white" style={{ backgroundColor: modeMeta.color }}>
              {modeMeta.label}
            </span>
          </div>
          <div className="flex items-center gap-3 md:justify-end flex-wrap">
            <div data-tour="search-bar">
              <SearchBar onSelectTask={selectSearchTask} onSelectGoal={selectSearchGoal} onSelectHabit={selectSearchHabit} />
            </div>
            <RemindersBell />
            <button
              onClick={calendarConnected ? disconnectCalendar : connectCalendar}
              disabled={calendarBusy}
              title={calendarConnected ? 'Disconnect Google Calendar' : 'Sync your schedule with Google Calendar'}
              className="font-sans text-[10px] uppercase tracking-widest font-bold px-3 py-1 border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors flex items-center gap-1 disabled:opacity-40"
            >
              {calendarBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : calendarConnected ? <Unlink className="w-3 h-3" /> : <Link2 className="w-3 h-3" />}
              {calendarConnected ? 'Calendar Synced' : 'Sync Google Calendar'}
            </button>
            <button
              data-tour="chat-toggle"
              onClick={() => setChatOpen((s) => !s)}
              title={chatOpen ? 'Close chat' : 'Open chat'}
              className={`font-sans text-[10px] uppercase tracking-widest font-bold px-3 py-1 border border-[#1A1A1A] transition-colors flex items-center gap-1 ${
                chatOpen ? 'bg-[#1A1A1A] text-white' : 'hover:bg-[#1A1A1A] hover:text-white'
              }`}
            >
              <MessageCircle className="w-3 h-3" /> Chat
            </button>
            <button
              onClick={() => { setTab('plan'); setShowTutorial(true); }}
              title="Replay the guided tour"
              aria-label="Replay the guided tour"
              className="p-1.5 border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors"
            >
              <HelpCircle className="w-3 h-3" />
            </button>
            {authUser && (
              <div className="font-sans text-[10px] opacity-70">
                {authUser.name}
              </div>
            )}
            <button
              onClick={handleLogout}
              className="font-sans text-[10px] uppercase tracking-widest font-bold px-3 py-1 border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors"
            >
              Logout
            </button>
          </div>
        </header>

      {/* Row: main content + chat panel as real flex siblings, so opening
          chat shrinks the content column instead of covering it. */}
      <div className="flex-grow flex flex-row min-h-0 overflow-hidden">
      <div className="flex-grow flex flex-col justify-between min-w-0 min-h-0 overflow-y-auto">
      <main className="w-full flex flex-col gap-5 p-4 md:p-8">
          {/* Capped at a readable width — only the Task Board below breaks
              out to fill the screen, everything above it reads better narrow. */}
          <div className="w-full max-w-3xl flex flex-col gap-5">
          {showNotifPrompt && (
            <NotificationPrompt onEnable={enableNotifications} onDismiss={dismissNotifPrompt} />
          )}

          {tab === 'plan' && (
            <p className="font-sans text-xs opacity-60 -mb-2">{modeMeta.blurb}</p>
          )}

          {/* Panic mode: suppress everything else, show exactly one task */}
          {tab === 'plan' && mode === 'PANIC_MODE' && priorityTask && (
            <PanicPanel task={priorityTask} onMarkDone={markTaskDone} />
          )}

          {/* Active Execution Panel: one task, a timer, the next micro-step */}
          {tab === 'plan' && mode !== 'PANIC_MODE' && executionTask && (
            <ExecutionPanel
              task={executionTask}
              isActive={executionTask.status === 'IN_PROGRESS'}
              pomoSeconds={pomoSeconds}
              pomoRunning={pomoRunning}
              onStartFocus={startFocusOnTask}
              onToggleTimer={togglePomo}
              onResetTimer={resetPomo}
              onMarkDone={markTaskDone}
            />
          )}

          {/* Autonomous rescheduling banner */}
          <AnimatePresence>
            {hasRisk && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                className="bg-[#D14D2A] text-white p-4 flex items-center justify-between shadow-[5px_5px_0px_0px_#1A1A1A]">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5" />
                  <div className="font-sans text-xs">
                    <span className="font-bold uppercase tracking-widest">Plan drift detected</span>
                    <p className="opacity-90">{overdue.size} overdue · {atRisk.size} at risk of missing a deadline.</p>
                  </div>
                </div>
                <button onClick={rescheduleNow} disabled={busy !== ''}
                  className="font-sans text-[11px] font-bold uppercase tracking-widest px-4 py-2 bg-white text-[#D14D2A] hover:bg-[#1A1A1A] hover:text-white transition-colors flex items-center gap-2 whitespace-nowrap">
                  {busy === 'reschedule' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Replan now
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* System triggers */}
          <AnimatePresence>
            {/* Suppressed when the Execution Panel above is already showing this
                exact timer for the active task — otherwise it's a duplicate. */}
            {(trigger === 'START_POMODORO' || pomoSessionId != null) && executionTask?.status !== 'IN_PROGRESS' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                className="bg-[#1A1A1A] text-white p-5 flex items-center justify-between shadow-[5px_5px_0px_0px_#D14D2A]">
                <div className="flex items-center gap-4">
                  <Timer className="w-6 h-6 text-[#D14D2A]" />
                  <div>
                    <span className="font-sans text-[10px] uppercase tracking-widest font-bold opacity-60">Focus Timer</span>
                    <p className="text-4xl font-black tabular-nums tracking-tight">{fmtTimer(pomoSeconds)}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={togglePomo} className="p-3 border border-white/40 hover:bg-white hover:text-[#1A1A1A] transition-colors" aria-label={pomoRunning ? 'Pause' : 'Play'}>
                    {pomoRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button onClick={resetPomo} className="p-3 border border-white/40 hover:bg-white hover:text-[#1A1A1A] transition-colors" aria-label="Reset">
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}
            {trigger === 'PROMPT_CALENDAR_SYNC' && tasks.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                className="bg-white border border-[#1A1A1A] p-5 flex items-center justify-between shadow-[5px_5px_0px_0px_rgba(26,26,26,0.1)]">
                <div className="flex items-center gap-4">
                  <CalendarPlus className="w-6 h-6 text-[#2A6B5E]" />
                  <div>
                    <span className="font-sans text-[10px] uppercase tracking-widest font-bold opacity-60">Lock In The Deadlines</span>
                    <p className="font-sans text-sm">Export your plan so it lives in your real calendar.</p>
                  </div>
                </div>
                <a href={api.calendarIcsUrl()}
                  className="font-sans text-[11px] font-bold uppercase tracking-widest px-4 py-3 bg-[#2A6B5E] text-white hover:opacity-90 transition-opacity whitespace-nowrap flex items-center gap-2">
                  <Download className="w-3 h-3" /> Export .ics
                </a>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Agentic action */}
          <AnimatePresence>
            {action && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                className="bg-white border border-[#1A1A1A] shadow-[5px_5px_0px_0px_rgba(209,77,42,1)]">
                <div className="flex items-center justify-between border-b border-[#1A1A1A] px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-sans text-[9px] font-bold px-2 py-1 bg-[#D14D2A] text-white uppercase tracking-widest">Started For You</span>
                    <span className="font-sans text-[11px] font-bold uppercase tracking-widest opacity-70">{ACTION_LABEL[action.action_type] ?? action.action_type}</span>
                  </div>
                  <button onClick={copyAction} className="font-sans text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 hover:text-[#D14D2A] transition-colors">
                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}{copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="font-sans text-[13px] leading-relaxed p-5 whitespace-pre-wrap bg-[#F5F2ED] max-h-72 overflow-y-auto">{action.action_content}</pre>
              </motion.div>
            )}
          </AnimatePresence>

          {tab === 'goals' && (
            <GoalsPanel goals={goals} onAdd={addGoal} onIncrement={incGoal} onDelete={deleteGoal} />
          )}
          {tab === 'workflows' && (
            <WorkflowsPanel
              workflows={workflows}
              onGenerate={generateWorkflowDraft}
              onSave={saveWorkflow}
              onToggleActive={toggleWorkflowActive}
              onRun={runWorkflow}
              onDelete={deleteWorkflowById}
            />
          )}
          {tab === 'breakdown' && (
            <DecomposePanel onGenerate={decomposeGoalDraft} onCommit={commitDecomposition} />
          )}
          {tab === 'memory' && (
            <MemoryPanel facts={memoryFacts} onSummarize={summarizeMemoryNow} />
          )}
          {tab === 'habits' && (
            <HabitsPanel habits={habits} onAdd={addHabit} onCheck={checkHabit} onDelete={deleteHabit} />
          )}

          {/* Overdue: surfaced separately from the timeline so it can't be missed */}
          {tab === 'plan' && mode !== 'PANIC_MODE' && overdueTasks.length > 0 && (
            <div>
              <div className="flex items-center gap-4 border-b border-[#D14D2A] pb-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-[#D14D2A]" />
                <span className="font-sans text-[10px] uppercase tracking-widest font-black text-[#D14D2A]">Overdue</span>
                <div className="h-[1px] flex-grow bg-[#D14D2A] opacity-20" />
              </div>
              <div className="space-y-2">
                {overdueTasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 bg-white border-l-4 border-l-[#D14D2A] border border-[#1A1A1A]/15 px-3 py-2">
                    <span className="font-sans text-sm truncate flex-grow">{t.task_name}</span>
                    {t.deadline && <span className="font-sans text-[10px] uppercase opacity-60 whitespace-nowrap">Was due {fmtDeadline(t.deadline)}</span>}
                    <button onClick={() => markTaskDone(t)} className="font-sans text-[10px] uppercase font-bold tracking-widest px-2 py-1 border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors whitespace-nowrap">
                      Done
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Today's plan (schedule) */}
          {tab === 'plan' && mode !== 'PANIC_MODE' && scheduled.length > 0 && (
            <div>
              <div className="flex items-center gap-4 border-b border-[#1A1A1A] pb-2 mb-4">
                <CalendarDays className="w-4 h-4" />
                <span className="font-sans text-[10px] uppercase tracking-widest font-black">Your Plan</span>
                <div className="h-[1px] flex-grow bg-[#1A1A1A] opacity-20" />
                <a href={api.calendarIcsUrl()} className="font-sans text-[10px] uppercase font-bold tracking-widest flex items-center gap-1 hover:text-[#2A6B5E] transition-colors">
                  <Download className="w-3 h-3" /> Export all
                </a>
              </div>
              <div className="space-y-4">
                {grouped.map(({ label, items }) => (
                  <div key={label}>
                    <p className="font-sans text-[10px] uppercase font-black tracking-widest opacity-50 mb-2">{label}</p>
                    <div className="space-y-2">
                      {items.map((t) => (
                        <div key={t.id} className={`flex items-center gap-3 bg-white border-l-4 border border-[#1A1A1A]/15 px-3 py-2 ${atRisk.has(t.id) ? 'border-l-[#D14D2A]' : 'border-l-[#2A6B5E]'}`}>
                          <Clock className="w-4 h-4 opacity-50 shrink-0" />
                          <span className="font-sans text-xs font-bold tabular-nums whitespace-nowrap">
                            {fmtTime(t.scheduled_start!)}<ArrowRight className="w-3 h-3 inline mx-1 opacity-40" />{fmtTime(t.scheduled_end!)}
                          </span>
                          <span className="font-sans text-sm truncate flex-grow">{t.task_name}</span>
                          {atRisk.has(t.id) && <span className="font-sans text-[9px] font-bold uppercase text-[#D14D2A] whitespace-nowrap">At risk</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          </div>

          {/* Task Board — its own page now, breaking out of the max-w-3xl
              column above to actually use the full screen width. */}
          {tab === 'board' && (
          <div className="flex-grow w-full">
            <div data-tour="task-toolbar" className="flex items-center gap-3 border-b border-[#1A1A1A] pb-2 mb-4 flex-wrap">
              <span className="font-sans text-[10px] uppercase tracking-widest font-black">Task Board</span>
              <div className="h-[1px] flex-grow bg-[#1A1A1A] opacity-20 min-w-[20px]" />
              <button onClick={() => setShowAdd((s) => !s)} className="font-sans text-[10px] uppercase font-bold tracking-widest flex items-center gap-1 px-2 py-1 border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors">
                <Plus className="w-3 h-3" /> Task
              </button>
              <button onClick={planDay} disabled={busy !== '' || tasks.length === 0} className="font-sans text-[10px] uppercase font-bold tracking-widest flex items-center gap-1 px-2 py-1 bg-[#1A1A1A] text-white hover:bg-[#333] disabled:opacity-40 transition-colors">
                {busy === 'schedule' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CalendarDays className="w-3 h-3" />} Plan my day
              </button>
            </div>

            {showAdd && (
              <div className="bg-white border border-[#1A1A1A] p-4 mb-4 space-y-3 shadow-[3px_3px_0px_0px_rgba(26,26,26,0.1)]">
                <input className="w-full p-2 border border-[#1A1A1A]/30 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]"
                  placeholder="Task name" value={newTask.task_name} onChange={(e) => setNewTask({ ...newTask, task_name: e.target.value })} />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <label className="font-sans text-[10px] uppercase font-bold tracking-widest flex flex-col gap-1">Deadline
                    <input type="datetime-local" className="p-2 border border-[#1A1A1A]/30 font-sans text-xs normal-case" value={newTask.deadline} onChange={(e) => setNewTask({ ...newTask, deadline: e.target.value })} />
                  </label>
                  <label className="font-sans text-[10px] uppercase font-bold tracking-widest flex flex-col gap-1">Est. minutes
                    <input type="number" min={5} step={5} className="p-2 border border-[#1A1A1A]/30 font-sans text-xs" value={newTask.estimated_minutes} onChange={(e) => setNewTask({ ...newTask, estimated_minutes: Number(e.target.value) })} />
                  </label>
                  <label className="font-sans text-[10px] uppercase font-bold tracking-widest flex flex-col gap-1">Urgency
                    <select className="p-2 border border-[#1A1A1A]/30 font-sans text-xs" value={newTask.urgency} onChange={(e) => setNewTask({ ...newTask, urgency: e.target.value as Urgency })}>
                      <option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
                    </select>
                  </label>
                </div>
                {goals.length > 0 && (
                  <label className="font-sans text-[10px] uppercase font-bold tracking-widest flex flex-col gap-1">Link to goal (optional)
                    <select className="p-2 border border-[#1A1A1A]/30 font-sans text-xs normal-case" value={newTask.goal_id} onChange={(e) => setNewTask({ ...newTask, goal_id: e.target.value })}>
                      <option value="">— none —</option>
                      {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
                    </select>
                  </label>
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowAdd(false)} className="font-sans text-[10px] uppercase font-bold tracking-widest px-3 py-2">Cancel</button>
                  <button onClick={addTask} disabled={!newTask.task_name.trim()} className="font-sans text-[10px] uppercase font-bold tracking-widest px-3 py-2 bg-[#1A1A1A] text-white disabled:opacity-40">Add task</button>
                </div>
              </div>
            )}

            {tasks.length === 0 ? (
              <div className="font-sans text-sm opacity-50 italic py-10 text-center border border-dashed border-[#1A1A1A]/30">
                Your tasks will appear here once you tell me what's on your plate — or add one manually.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {tasks.map((task) => {
                  const done = task.status === 'COMPLETED';
                  const taskRisk = taskRisks[task.id] ?? task.risk ?? null;
                  return (
                    <div key={task.id} className={`bg-white border border-[#1A1A1A] p-4 flex flex-col shadow-[3px_3px_0px_0px_rgba(26,26,26,0.1)] ${done ? 'opacity-50' : ''}`}>
                      <div className="flex justify-between items-start mb-2 gap-2">
                        <span className="font-sans text-[9px] font-bold px-2 py-1 text-white uppercase" style={{ backgroundColor: URGENCY_COLOR[task.urgency] }}>{task.urgency}</span>
                        <div className="flex items-center gap-2">
                          {overdue.has(task.id) && <span className="font-sans text-[9px] font-bold uppercase text-[#D14D2A]">Overdue</span>}
                          <span className="font-sans text-[9px] font-bold uppercase opacity-50">{STATUS_LABEL[task.status]}</span>
                        </div>
                      </div>
                      <h3 className={`text-lg font-bold tracking-tight leading-tight mb-1 ${done ? 'line-through' : ''}`}>{task.task_name}</h3>
                      <div className="font-sans text-[10px] uppercase tracking-wide opacity-60 mb-3 flex flex-wrap gap-x-3">
                        <span>~{task.estimated_minutes} min</span>
                        {task.deadline && <span>Due {fmtDeadline(task.deadline)}</span>}
                      </div>
                      {!done && task.deadline && (
                        <div className="mb-3 pb-3 border-b border-dashed border-gray-300 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            {taskRisk && (
                              <span className="font-sans text-[9px] font-bold px-2 py-0.5 text-white uppercase tracking-widest"
                                style={{ backgroundColor: RISK_COLOR[taskRisk.risk_level] }}>
                                {taskRisk.risk_level} risk · {taskRisk.risk_percent}%
                              </span>
                            )}
                            <label className="font-sans text-[9px] uppercase tracking-wide opacity-60 flex items-center gap-1 ml-auto">
                              Logged
                              <input
                                key={`${task.id}-${task.completed_minutes ?? 0}`}
                                type="number" min={0} step={0.5}
                                defaultValue={((task.completed_minutes ?? 0) / 60).toFixed(1)}
                                onBlur={(e) => {
                                  const h = Number(e.target.value);
                                  if (!Number.isNaN(h)) logCompletedHours(task, h);
                                }}
                                className="w-14 p-1 border border-[#1A1A1A]/30 font-sans text-[11px] normal-case"
                              />
                              h
                            </label>
                          </div>
                          {taskRisk && <p className="font-sans text-[11px] italic opacity-70">{taskRisk.reason}</p>}
                        </div>
                      )}
                      <div className="mb-3 pt-3 border-t border-dashed border-gray-300">
                        <span className="font-sans text-[9px] font-bold uppercase block mb-1 opacity-60">Next Step</span>
                        <p className="font-sans text-[12px] leading-snug">{task.next_micro_step || '—'}</p>
                      </div>
                      <div className="mt-auto flex items-center gap-2 flex-wrap">
                        <button onClick={() => cycleStatus(task)} className="font-sans text-[10px] uppercase font-bold tracking-widest px-2 py-1 border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors">
                          {task.status === 'TODO' ? 'Start' : task.status === 'IN_PROGRESS' ? 'Done' : 'Reopen'}
                        </button>
                        {!done && (
                          <button onClick={() => startFocusOnTask(task)}
                            title={task.status === 'IN_PROGRESS' ? 'Already the active focus task' : 'Focus on this task now'}
                            disabled={task.status === 'IN_PROGRESS'}
                            className="font-sans text-[10px] uppercase font-bold tracking-widest px-2 py-1 border border-[#D14D2A] text-[#D14D2A] hover:bg-[#D14D2A] hover:text-white transition-colors disabled:opacity-40 flex items-center gap-1">
                            <Crosshair className="w-3 h-3" /> Focus
                          </button>
                        )}
                        {!done && task.scheduled_start && (
                          <button onClick={() => skipTask(task)} title="Move this task — frees the slot and redistributes the remaining work into the next free time"
                            className="font-sans text-[10px] uppercase font-bold tracking-widest px-2 py-1 border border-[#1A1A1A]/30 hover:border-[#1A1A1A] transition-colors flex items-center gap-1">
                            <SkipForward className="w-3 h-3" /> Skip
                          </button>
                        )}
                        <a href={api.taskIcsUrl(task.id)} title="Download .ics" className="p-1 border border-[#1A1A1A]/30 hover:border-[#2A6B5E] hover:text-[#2A6B5E] transition-colors"><Download className="w-3.5 h-3.5" /></a>
                        <a href={gcalUrl(task)} target="_blank" rel="noreferrer" title="Add to Google Calendar" className="p-1 border border-[#1A1A1A]/30 hover:border-[#2A6B5E] hover:text-[#2A6B5E] transition-colors"><CalendarPlus className="w-3.5 h-3.5" /></a>
                        <button onClick={() => removeTask(task.id)} title="Delete" className="p-1 border border-[#1A1A1A]/30 hover:border-[#D14D2A] hover:text-[#D14D2A] transition-colors ml-auto"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}
      </main>

      <footer className="px-4 md:px-8 py-3 border-t border-[#1A1A1A] bg-white">
        <div className="font-sans text-[10px] uppercase font-black opacity-60">Proactive Engine Online</div>
      </footer>
      </div>

      {/* Chat: a real flex sibling of the content column above, not an
          overlay — opening it shrinks the content width instead of
          covering it. Stays mounted (width animates to 0) so scroll
          position / in-progress typing survive a toggle. */}
      <aside className={`shrink-0 bg-white border-l border-[#1A1A1A] flex flex-col overflow-hidden transition-[width] duration-200 ${
        chatOpen ? 'w-full sm:w-[420px]' : 'w-0 border-l-0'
      }`}>
        <div className="flex items-center justify-between gap-3 border-b border-[#1A1A1A] px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-[#D14D2A] animate-pulse" />
            <span className="font-sans text-[10px] uppercase tracking-widest font-black">Conversation</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={startNewChat} aria-label="New chat" title="New chat"
              className="p-1 hover:text-[#D14D2A]">
              <Plus className="w-4 h-4" />
            </button>
            <button onClick={() => setChatOpen(false)} aria-label="Close chat" className="p-1 hover:text-[#D14D2A]">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-grow overflow-y-auto px-5 py-4 space-y-4">
          {chatLoading && (
            <div className="flex justify-center pt-8">
              <Loader2 className="w-5 h-5 animate-spin text-[#D14D2A]" />
            </div>
          )}
          {!chatLoading && messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] font-sans text-sm leading-relaxed px-4 py-3 ${
                m.role === 'user' ? 'bg-[#1A1A1A] text-white'
                  : m.system ? 'bg-[#2A6B5E]/10 border border-[#2A6B5E]/40 text-[#1A1A1A] italic'
                  : 'bg-[#F5F2ED] border border-[#1A1A1A]/15'
              }`}>
                {m.system && <span className="block text-[9px] uppercase tracking-widest font-bold text-[#2A6B5E] mb-1 not-italic">System</span>}
                {m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-[#F5F2ED] border border-[#1A1A1A]/15 px-4 py-3 flex items-center gap-2 font-sans text-xs uppercase tracking-widest">
                <Loader2 className="w-4 h-4 animate-spin text-[#D14D2A]" /> Thinking
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {quickReplies.length > 0 && !loading && (
          <div className="px-5 pb-2 flex flex-wrap gap-2">
            {quickReplies.map((q, i) => (
              <button key={i} onClick={() => send(q)}
                className="font-sans text-[11px] font-bold px-3 py-2 border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors text-left">
                {q}
              </button>
            ))}
          </div>
        )}
        {error && <div className="px-5 py-2 font-sans text-[11px] font-bold uppercase text-[#D14D2A]">{error}</div>}

        <div className="border-t border-[#1A1A1A] p-3 flex gap-2 items-end">
          <textarea
            className="flex-grow h-16 p-3 border border-[#1A1A1A]/30 bg-white font-sans text-sm focus:outline-none focus:ring-1 focus:ring-[#1A1A1A] resize-none"
            placeholder="Tell me what's due and where you're stuck…"
            value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={loading || chatLoading} />
          <button onClick={() => send(input)} disabled={loading || chatLoading || !input.trim()}
            className="h-16 px-5 bg-[#1A1A1A] hover:bg-[#333] disabled:bg-gray-400 text-white flex items-center justify-center shadow-[3px_3px_0px_0px_#D14D2A] transition-colors" aria-label="Send">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </aside>
      </div>
      </div>
    </div>
  );
}

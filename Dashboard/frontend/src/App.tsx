/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LoginPage } from './LoginPage';
import {
  Loader2, Send, Copy, Check, Timer, CalendarPlus, Play, Pause, RotateCcw,
  Plus, CalendarDays, RefreshCw, Trash2, Download, Clock, AlertTriangle, ArrowRight, Link2, Unlink,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from './api';
import {
  AgenticAction, ChatMessage, Goal, Habit, Mode, Status, SystemTrigger, Task, Urgency,
} from './types';
import RemindersBell from './components/RemindersBell';
import GoalsPanel from './components/GoalsPanel';
import HabitsPanel from './components/HabitsPanel';
import ExecutionPanel from './components/ExecutionPanel';
import PanicPanel from './components/PanicPanel';

const MODE_META: Record<Mode, { label: string; color: string; blurb: string }> = {
  PLANNING_MODE: { label: 'Planning', color: '#2A6B5E', blurb: 'Deadline is days out — be strategic.' },
  FOCUS_MODE: { label: 'Focus', color: '#1A1A1A', blurb: 'One task. Heads down. Execute.' },
  PANIC_MODE: { label: 'Panic', color: '#D14D2A', blurb: 'Hours left — urgent, direct action only.' },
  REVIEW_MODE: { label: 'Review', color: '#6B5BD1', blurb: 'Reflecting on what is done.' },
};
const URGENCY_COLOR: Record<Urgency, string> = { HIGH: '#D14D2A', MEDIUM: '#1A1A1A', LOW: '#6B7280' };
const URGENCY_RANK: Record<Urgency, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
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

  const [messages, setMessages] = useState<ChatMessage[]>([SEED_MESSAGE]);
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

  const [pomoSeconds, setPomoSeconds] = useState(POMODORO_SECONDS);
  const [pomoRunning, setPomoRunning] = useState(false);
  const [pomoSessionId, setPomoSessionId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<'' | 'schedule' | 'reschedule'>('');

  const [showAdd, setShowAdd] = useState(false);
  const [newTask, setNewTask] = useState({ task_name: '', deadline: '', estimated_minutes: 30, urgency: 'MEDIUM' as Urgency, goal_id: '' });

  const [goals, setGoals] = useState<Goal[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [tab, setTab] = useState<'plan' | 'goals' | 'habits'>('plan');

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

  useEffect(() => {
    if (!isAuthenticated) return;

    api.listTasks().then(setTasks).catch(() => {});
    api.listGoals().then(setGoals).catch(() => {});
    api.listHabits().then(setHabits).catch(() => {});
    api.calendarStatus().then((s) => setCalendarConnected(s.connected)).catch(() => {});
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

  // Autonomous rescheduling: poll status, auto-replan when tasks have slipped.
  useEffect(() => {
    const check = async () => {
      if (guardRef.current || loading) return;
      try {
        const s = await api.status();
        setAtRisk(new Set(s.at_risk));
        setOverdue(new Set(s.overdue));
        if (s.recommend_reschedule) {
          guardRef.current = true;
          const r = await api.reschedule();
          setTasks(r.tasks);
          setAtRisk(new Set(r.at_risk));
          setOverdue(new Set(r.overdue));
          pushSystem(`Autonomous reschedule: ${r.message}`);
          guardRef.current = false;
        }
      } catch { /* offline / backend down — ignore */ }
    };
    const id = setInterval(check, 60_000);
    const t = setTimeout(check, 4_000); // first pass shortly after load
    return () => { clearInterval(id); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

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

  const refreshStatus = async () => {
    try {
      const s = await api.status();
      setAtRisk(new Set(s.at_risk));
      setOverdue(new Set(s.overdue));
    } catch { /* ignore */ }
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const history = messages
      .filter((m) => m !== SEED_MESSAGE && !m.system)
      .map((m) => ({ role: m.role, text: m.text }));

    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
    setInput('');
    setQuickReplies([]);
    setError('');
    setLoading(true);
    try {
      const data = await api.chat(trimmed, history);
      setMessages((prev) => [...prev, { role: 'model', text: data.chat_ui.agent_message }]);
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
    refreshStatus();
    if (task.goal_id) api.listGoals().then(setGoals).catch(() => {}); // keep linked goal progress in sync
  };

  const removeTask = async (id: number) => {
    await api.deleteTask(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
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
    const updated = await api.patchTask(task.id, { status: 'IN_PROGRESS' });
    setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
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
    <div className="min-h-screen bg-[#F5F2ED] text-[#1A1A1A] font-serif flex flex-col p-4 md:p-8 overflow-x-hidden">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between md:items-baseline border-b border-[#1A1A1A] pb-5 mb-6 gap-3">
        <div className="flex flex-col">
          <span className="font-sans text-[10px] uppercase tracking-widest font-bold opacity-60 mb-1">
            Task Weave / Live Session
          </span>
          <h1 className="text-3xl md:text-4xl font-black italic tracking-tight leading-none">Anxiety, into Action.</h1>
        </div>
        <div className="flex items-center gap-3 md:justify-end flex-wrap">
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
          {authUser && (
            <div className="font-sans text-[10px] opacity-70">
              {authUser.name}
            </div>
          )}
          <span className="font-sans text-[10px] uppercase tracking-widest font-bold opacity-60">Mode</span>
          <span className="font-sans text-[11px] font-bold uppercase tracking-widest px-3 py-1 text-white" style={{ backgroundColor: modeMeta.color }}>
            {modeMeta.label}
          </span>
          <button
            onClick={handleLogout}
            className="font-sans text-[10px] uppercase tracking-widest font-bold px-3 py-1 border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="flex-grow w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ---------------- Chat panel ---------------- */}
        <section className="lg:col-span-5 flex flex-col bg-white border border-[#1A1A1A] shadow-[6px_6px_0px_0px_#1A1A1A] min-h-[60vh] lg:min-h-0 lg:h-[80vh]">
          <div className="flex items-center gap-3 border-b border-[#1A1A1A] px-5 py-3">
            <div className="w-2 h-2 rounded-full bg-[#D14D2A] animate-pulse" />
            <span className="font-sans text-[10px] uppercase tracking-widest font-black">Conversation</span>
          </div>

          <div className="flex-grow overflow-y-auto px-5 py-4 space-y-4">
            {messages.map((m, i) => (
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
              value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={loading} />
            <button onClick={() => send(input)} disabled={loading || !input.trim()}
              className="h-16 px-5 bg-[#1A1A1A] hover:bg-[#333] disabled:bg-gray-400 text-white flex items-center justify-center shadow-[3px_3px_0px_0px_#D14D2A] transition-colors" aria-label="Send">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </section>

        {/* ---------------- Dashboard ---------------- */}
        <section className="lg:col-span-7 flex flex-col gap-5 lg:h-[80vh] lg:overflow-y-auto pr-1">
          {/* Mode strip */}
          <div className="text-white p-5 flex items-center justify-between shadow-[5px_5px_0px_0px_rgba(26,26,26,0.15)]" style={{ backgroundColor: modeMeta.color }}>
            <div>
              <span className="font-sans text-[10px] uppercase tracking-widest font-bold opacity-70">Current Mode</span>
              <p className="text-2xl font-black italic">{modeMeta.label}</p>
            </div>
            <p className="font-sans text-xs opacity-80 max-w-[45%] text-right">{modeMeta.blurb}</p>
          </div>

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
            {trigger === 'START_POMODORO' && (
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

          {/* Dashboard tabs */}
          <div className="flex gap-1 border-b border-[#1A1A1A]">
            {(['plan', 'goals', 'habits'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`font-sans text-[10px] uppercase font-black tracking-widest px-4 py-2 transition-colors ${tab === t ? 'bg-[#1A1A1A] text-white' : 'hover:bg-[#1A1A1A]/5'}`}>
                {t}
              </button>
            ))}
          </div>

          {tab === 'goals' && (
            <GoalsPanel goals={goals} onAdd={addGoal} onIncrement={incGoal} onDelete={deleteGoal} />
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

          {/* Task board + toolbar */}
          {tab === 'plan' && mode !== 'PANIC_MODE' && (
          <div className="flex-grow">
            <div className="flex items-center gap-3 border-b border-[#1A1A1A] pb-2 mb-4 flex-wrap">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {tasks.map((task) => {
                  const done = task.status === 'COMPLETED';
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
                      <div className="mb-3 pt-3 border-t border-dashed border-gray-300">
                        <span className="font-sans text-[9px] font-bold uppercase block mb-1 opacity-60">Next Step</span>
                        <p className="font-sans text-[12px] leading-snug">{task.next_micro_step || '—'}</p>
                      </div>
                      <div className="mt-auto flex items-center gap-2 flex-wrap">
                        <button onClick={() => cycleStatus(task)} className="font-sans text-[10px] uppercase font-bold tracking-widest px-2 py-1 border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors">
                          {task.status === 'TODO' ? 'Start' : task.status === 'IN_PROGRESS' ? 'Done' : 'Reopen'}
                        </button>
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
        </section>
      </main>

      <footer className="mt-6 pt-5 flex flex-col md:flex-row justify-between md:items-center border-t border-[#1A1A1A] gap-2">
        <div className="font-sans text-[10px] uppercase font-black opacity-60">Proactive Engine Online</div>
        <div className="font-sans text-[10px] uppercase font-black italic opacity-60">Zero-friction starts. Real deadlines met.</div>
      </footer>
    </div>
  );
}

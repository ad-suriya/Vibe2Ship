import '@src/Popup.css';
import { useEffect, useState } from 'react';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleThemeStorage, authStorage, focusSessionStorage, tasksStorage, blockingStorage, blockedSitesStorage, FRONTEND_URL, API_BASE } from '@extension/storage';
import { cn, LoadingSpinner, TimeTracker } from '@extension/ui';
import { Login } from './Login';
import type { FocusSession, Task } from '@extension/types';

function Popup() {
  const { isLight } = useStorage(exampleThemeStorage);
  const { isAuthenticated } = useStorage(authStorage);
  const blockedSites = useStorage(blockedSitesStorage);
  const [session, setSession] = useState<FocusSession | null>(null);
  const [description, setDescription] = useState('');
  const [todayTotal, setTodayTotal] = useState(0);
  const [weekTotal, setWeekTotal] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [taskError, setTaskError] = useState<string | null>(null);
  const [newSite, setNewSite] = useState('');
  const [showBlocklist, setShowBlocklist] = useState(false);

  // authStorage is updated live by the background script when the dashboard
  // bridge relays a login. Once that lands, enrich the user with backend data.
  useEffect(() => {
    if (!isAuthenticated) return;

    authStorage.get().then(auth => {
      if (!auth.accessToken) return;
      fetch(`${API_BASE}/me`, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      })
        .then(response => {
          if (response.status === 401) authStorage.logout();
          return response.ok ? response.json() : null;
        })
        .then(userData => {
          if (userData?.id) {
            // Preserve the real token — only refresh the user profile fields.
            authStorage.setAuth(
              {
                id: userData.id,
                email: userData.email || '',
                name: userData.name || 'User',
                picture: userData.picture,
              },
              auth.accessToken!,
              auth.refreshToken || '',
              3600,
            );
          }
        })
        .catch(() => console.log('Backend auth check failed, using local storage'));
    });
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;

    let isMounted = true;
    let interval: NodeJS.Timeout | null = null;

    const loadState = async () => {
      try {
        const activeSession = await focusSessionStorage.getCurrent();
        setSession(activeSession);

        const now = Date.now();
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);

        const startOfWeek = new Date(now);
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
        startOfWeek.setHours(0, 0, 0, 0);

        const sessionsToday = await focusSessionStorage.getSessionsSince(startOfDay.getTime());
        const sessionsWeek = await focusSessionStorage.getSessionsSince(startOfWeek.getTime());

        const calcTotal = (sessions: FocusSession[]) =>
          sessions.reduce((sum, s) => sum + ((s.endTime || now) - s.startTime), 0);

        setTodayTotal(calcTotal(sessionsToday));
        setWeekTotal(calcTotal(sessionsWeek));

        if (activeSession) {
          setDescription(activeSession.description || '');
        }
      } catch (err) {
        console.error('Failed to load tracking state:', err);
      }
    };

    loadState();
    interval = setInterval(loadState, 1000);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isAuthenticated]);

  const refreshTasks = async () => {
    try {
      const openTasks = await tasksStorage.query({ status: ['inbox', 'todo', 'in-progress'], limit: 10 });
      setTasks(openTasks);
    } catch (err) {
      console.error('Failed to load tasks:', err);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;

    refreshTasks();
    const interval = setInterval(refreshTasks, 5000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const handleAddTask = async () => {
    const title = newTaskTitle.trim();
    if (!title) return;

    setTaskError(null);
    try {
      await tasksStorage.addTask({
        title,
        priority: 'medium',
        tags: [],
        status: 'todo',
        syncedToMobile: false,
      });
      setNewTaskTitle('');
      await refreshTasks();
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : 'Failed to add task');
    }
  };

  const handleCompleteTask = async (taskId: string) => {
    try {
      await tasksStorage.update(taskId, { status: 'done', completedAt: Date.now() });
      await refreshTasks();
    } catch (err) {
      console.error('Failed to complete task:', err);
    }
  };

  const openDashboard = () => {
    chrome.tabs.create({ url: FRONTEND_URL });
  };

  const handleLogout = async () => {
    await authStorage.logout();
  };

  const handleStart = async () => {
    try {
      const newSession = await focusSessionStorage.startTracking({ description });
      setSession(newSession);
      await blockingStorage.enable(blockedSites);
    } catch (err) {
      console.error('Failed to start tracking:', err);
    }
  };

  const handleAddSite = async () => {
    const site = newSite.trim();
    if (!site) return;
    const next = await blockedSitesStorage.add(site);
    setNewSite('');
    await blockingStorage.updateSites(next);
  };

  const handleRemoveSite = async (site: string) => {
    const next = await blockedSitesStorage.remove(site);
    await blockingStorage.updateSites(next);
  };

  const handleStop = async () => {
    try {
      await focusSessionStorage.stopTracking();
      await blockingStorage.disable();
      setSession(null);
      setDescription('');

      const now = Date.now();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const startOfWeek = new Date(now);
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);

      const sessionsToday = await focusSessionStorage.getSessionsSince(startOfDay.getTime());
      const sessionsWeek = await focusSessionStorage.getSessionsSince(startOfWeek.getTime());

      const calcTotal = (sessions: FocusSession[]) =>
        sessions.reduce((sum, s) => sum + ((s.endTime || now) - s.startTime), 0);

      setTodayTotal(calcTotal(sessionsToday));
      setWeekTotal(calcTotal(sessionsWeek));
    } catch (err) {
      console.error('Failed to stop tracking:', err);
    }
  };

  const formatMs = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  if (!isAuthenticated) {
    return <Login isLight={isLight} onLoginSuccess={() => {}} />;
  }

  return (
    <div
      className={cn('w-full flex flex-col p-4 gap-4 font-sans', isLight ? 'bg-paper text-ink' : 'bg-ink text-paper')}
      style={{ width: '380px', minHeight: '500px' }}
    >
      {/* Time Totals */}
      <div className="flex gap-3 text-center">
        <div className={cn('flex-1 border py-2', isLight ? 'border-ink/15' : 'border-paper/20')}>
          <p className="text-[10px] uppercase tracking-widest font-bold opacity-60">Today</p>
          <p className="font-serif font-black text-2xl">{formatMs(todayTotal)}</p>
        </div>
        <div className={cn('flex-1 border py-2', isLight ? 'border-ink/15' : 'border-paper/20')}>
          <p className="text-[10px] uppercase tracking-widest font-bold opacity-60">This Week</p>
          <p className="font-serif font-black text-2xl">{formatMs(weekTotal)}</p>
        </div>
      </div>

      {/* Time Tracker */}
      <TimeTracker session={session} description={description} onDescriptionChange={setDescription} onStart={handleStart} onStop={handleStop} />

      {/* Tasks */}
      <div className={cn('border-t pt-3 flex flex-col gap-2', isLight ? 'border-ink/15' : 'border-paper/20')}>
        <p className="text-[10px] uppercase tracking-widest font-bold opacity-60">Tasks</p>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Add a task..."
            value={newTaskTitle}
            onChange={e => setNewTaskTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleAddTask();
            }}
            className={cn(
              'flex-1 px-3 py-2 border text-sm focus:outline-none',
              isLight
                ? 'bg-white border-ink/30 text-ink focus:border-ink'
                : 'bg-ink border-paper/30 text-paper focus:border-paper',
            )}
          />
          <button
            onClick={handleAddTask}
            className={cn(
              'px-3 py-2 text-[10px] uppercase tracking-widest font-bold border',
              isLight ? 'bg-ink text-paper border-ink hover:bg-[#333]' : 'bg-paper text-ink border-paper hover:bg-gray-200',
            )}
          >
            Add
          </button>
        </div>

        {taskError && <p className="text-xs text-panic">{taskError}</p>}

        <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
          {tasks.length === 0 ? (
            <p className="text-xs opacity-50 py-2 text-center">No open tasks</p>
          ) : (
            tasks.map(task => (
              <div
                key={task.id}
                className={cn('flex items-start justify-between gap-2 border p-2', isLight ? 'border-ink/15' : 'border-paper/20')}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{task.title}</p>
                  {task.priority !== 'medium' && (
                    <p className={cn('text-[10px] uppercase tracking-widest font-bold mt-0.5', task.priority === 'high' ? 'text-panic' : 'text-planning')}>
                      {task.priority}
                    </p>
                  )}
                </div>
                <button onClick={() => handleCompleteTask(task.id)} className="text-sm hover:opacity-70" title="Mark done">
                  ✓
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Blocked Sites */}
      <div className={cn('border-t pt-3 flex flex-col gap-2', isLight ? 'border-ink/15' : 'border-paper/20')}>
        <button
          onClick={() => setShowBlocklist(s => !s)}
          className="flex items-center justify-between text-[10px] uppercase tracking-widest font-bold opacity-60"
        >
          <span>Blocked Sites During Focus ({blockedSites.length})</span>
          <span>{showBlocklist ? '▲' : '▼'}</span>
        </button>

        {showBlocklist && (
          <>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. tiktok.com"
                value={newSite}
                onChange={e => setNewSite(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddSite();
                }}
                className={cn(
                  'flex-1 px-3 py-2 border text-sm focus:outline-none',
                  isLight
                    ? 'bg-white border-ink/30 text-ink focus:border-ink'
                    : 'bg-ink border-paper/30 text-paper focus:border-paper',
                )}
              />
              <button
                onClick={handleAddSite}
                className={cn(
                  'px-3 py-2 text-[10px] uppercase tracking-widest font-bold border',
                  isLight ? 'bg-ink text-paper border-ink hover:bg-[#333]' : 'bg-paper text-ink border-paper hover:bg-gray-200',
                )}
              >
                Add
              </button>
            </div>

            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {blockedSites.length === 0 ? (
                <p className="text-xs opacity-50 py-2">No sites blocked — focus sessions won't restrict anything.</p>
              ) : (
                blockedSites.map(site => (
                  <span
                    key={site}
                    className={cn(
                      'flex items-center gap-1.5 px-2 py-1 text-xs border',
                      isLight ? 'border-ink/20' : 'border-paper/20',
                    )}
                  >
                    {site}
                    <button onClick={() => handleRemoveSite(site)} className="hover:text-panic" aria-label={`Remove ${site}`}>
                      ✕
                    </button>
                  </span>
                ))
              )}
            </div>
            {session && (
              <p className="text-[10px] opacity-50 italic">Changes apply immediately to this session.</p>
            )}
          </>
        )}
      </div>

      {/* Footer Actions */}
      <div className={cn('flex gap-2 pt-3 border-t', isLight ? 'border-ink/15' : 'border-paper/20')}>
        <button
          onClick={openDashboard}
          className={cn(
            'flex-1 py-2 px-3 text-[10px] uppercase tracking-widest font-bold border transition-colors',
            isLight ? 'border-ink hover:bg-ink hover:text-paper' : 'border-paper hover:bg-paper hover:text-ink',
          )}
        >
          Dashboard
        </button>
        <button
          onClick={handleLogout}
          className={cn(
            'flex-1 py-2 px-3 text-[10px] uppercase tracking-widest font-bold border transition-colors',
            isLight ? 'border-ink hover:bg-ink hover:text-paper' : 'border-paper hover:bg-paper hover:text-ink',
          )}
        >
          Logout
        </button>
      </div>
    </div>
  );
}

export default withSuspense(Popup, <LoadingSpinner />);

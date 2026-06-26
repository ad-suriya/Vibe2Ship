import '@src/Popup.css';
import { useEffect, useState } from 'react';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleThemeStorage, authStorage, focusSessionStorage, projectsStorage } from '@extension/storage';
import { cn, LoadingSpinner, TimeTracker } from '@extension/ui';
import { dashboardApi } from './api';
import { Login } from './Login';
import type { FocusSession, Project } from '@extension/types';

function Popup() {
  const { isLight } = useStorage(exampleThemeStorage);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authUser, setAuthUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<FocusSession | null>(null);
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState<string | undefined>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [todayTotal, setTodayTotal] = useState(0);
  const [weekTotal, setWeekTotal] = useState(0);

  useEffect(() => {
    let isMounted = true;
    let interval: NodeJS.Timeout | null = null;

    const checkAuth = async () => {
      let state = await authStorage.get();

      if (state.isAuthenticated) {
        try {
          const response = await fetch('http://localhost:8000/api/me');
          if (response.ok) {
            const userData = await response.json();
            if (userData.id) {
              const user = {
                id: userData.id,
                email: userData.email || '',
                name: userData.name || 'User',
                picture: userData.picture,
              };
              await authStorage.setAuth(user, 'backend-token', 'backend-refresh', 3600);
              state = await authStorage.get();
            }
          }
        } catch (err) {
          console.log('Backend auth check failed, using local storage');
        }
      }

      if (isMounted) {
        setIsAuthenticated(state.isAuthenticated);
        setAuthUser(state.user);
        setIsLoading(false);
      }
    };

    checkAuth();

    const setupInterval = async () => {
      const state = await authStorage.get();
      if (state.isAuthenticated && isMounted) {
        interval = setInterval(checkAuth, 2000);
      }
    };
    setupInterval();

    return () => {
      isMounted = false;
      if (interval) clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    let isMounted = true;
    let interval: NodeJS.Timeout | null = null;

    const loadState = async () => {
      try {
        const activeSession = await focusSessionStorage.getCurrent();
        setSession(activeSession);

        const allProjects = await projectsStorage.getProjects();
        setProjects(allProjects);

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
          setProjectId(activeSession.projectId);
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

  const openDashboard = () => {
    chrome.tabs.create({ url: 'http://localhost:5173' });
  };

  const handleLogout = async () => {
    await authStorage.logout();
    setIsAuthenticated(false);
    setAuthUser(null);
  };

  const handleStart = async () => {
    try {
      const currentProject = projects.find(p => p.id === projectId);
      const newSession = await focusSessionStorage.startTracking({
        description,
        projectId,
        projectName: currentProject?.name,
        projectColor: currentProject?.color,
      });

      setSession(newSession);

      dashboardApi.createSession(description, projectId).catch(err => {
        console.error('Failed to sync session to backend:', err);
      });
    } catch (err) {
      console.error('Failed to start tracking:', err);
    }
  };

  const handleStop = async () => {
    try {
      const stoppedSession = await focusSessionStorage.stopTracking();
      setSession(null);
      setDescription('');
      setProjectId(undefined);

      if (stoppedSession) {
        dashboardApi.stopSession(stoppedSession.id).catch(err => {
          console.error('Failed to sync session stop to backend:', err);
        });
      }

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

  const handleAddProject = async (name: string, color: string) => {
    try {
      const newProject = await projectsStorage.addProject({ name, color });
      setProjects([...projects, newProject]);
      setProjectId(newProject.id);

      dashboardApi.createProject(name, color).catch(err => {
        console.error('Failed to sync project to backend:', err);
      });
    } catch (err) {
      console.error('Failed to add project:', err);
    }
  };

  const formatMs = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!isAuthenticated) {
    return (
      <Login
        isLight={isLight}
        onLoginSuccess={(user) => {
          setAuthUser(user);
          setIsAuthenticated(true);
        }}
      />
    );
  }

  return (
    <div
      className={cn(
        'w-full flex flex-col p-4 gap-4',
        isLight ? 'bg-white text-gray-900' : 'bg-gray-900 text-white'
      )}
      style={{ width: '380px', minHeight: '500px' }}
    >
      {/* Time Totals */}
      <div className="flex gap-4 text-center text-sm">
        <div className="flex-1">
          <p className="opacity-70 text-xs">TODAY</p>
          <p className="font-semibold text-lg">{formatMs(todayTotal)}</p>
        </div>
        <div className="flex-1">
          <p className="opacity-70 text-xs">THIS WEEK</p>
          <p className="font-semibold text-lg">{formatMs(weekTotal)}</p>
        </div>
      </div>

      {/* Time Tracker */}
      <TimeTracker
        session={session}
        description={description}
        onDescriptionChange={setDescription}
        projectId={projectId}
        projects={projects}
        onProjectChange={setProjectId}
        onStart={handleStart}
        onStop={handleStop}
        onAddProject={handleAddProject}
      />

      {/* Footer Actions */}
      <div className="flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={openDashboard}
          className="flex-1 py-2 px-3 rounded-lg text-sm font-medium bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          title="Open Dashboard"
        >
          📊
        </button>
        <button
          onClick={handleLogout}
          className="flex-1 py-2 px-3 rounded-lg text-sm font-medium bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          title="Logout"
        >
          🚪
        </button>
      </div>
    </div>
  );
}

export default withSuspense(Popup, <LoadingSpinner />);

import '@src/SidePanel.css';
import { useEffect, useState } from 'react';
import { t } from '@extension/i18n';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleThemeStorage, focusSessionStorage, tasksStorage } from '@extension/storage';
import { cn, ErrorDisplay, FocusTimer, LoadingSpinner, ToggleButton } from '@extension/ui';
import type { Task, FocusSession } from '@extension/types';

const SidePanel = () => {
  const { isLight } = useStorage(exampleThemeStorage);
  const [focusSession, setFocusSession] = useState<FocusSession | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTab, setActiveTab] = useState<'focus' | 'tasks'>('focus');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadState = async () => {
      try {
        const session = await focusSessionStorage.getCurrent();
        setFocusSession(session);

        const taskList = await tasksStorage.query({
          status: ['inbox', 'todo', 'in-progress'],
          limit: 10,
        });
        setTasks(taskList);
      } catch (err) {
        console.error('Failed to load state:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadState();

    const interval = setInterval(loadState, 5000);
    return () => clearInterval(interval);
  }, []);

  const handlePauseClick = async () => {
    if (focusSession?.isActive) {
      await focusSessionStorage.pause();
      setFocusSession(prev => prev ? { ...prev, isActive: false } : null);
    }
  };

  const handleBreakClick = async () => {
    if (focusSession) {
      await focusSessionStorage.takeBreak(5);
      setFocusSession(prev =>
        prev ? {
          ...prev,
          breaksTaken: prev.breaksTaken + 1,
          totalBreakMinutes: prev.totalBreakMinutes + 5,
        } : null,
      );
    }
  };

  const handleEndClick = async () => {
    if (focusSession) {
      await focusSessionStorage.end();
      setFocusSession(null);
    }
  };

  const handleTaskClick = async (taskId: string) => {
    await tasksStorage.update(taskId, { status: 'in-progress' });
    const updated = await tasksStorage.query({
      status: ['inbox', 'todo', 'in-progress'],
      limit: 10,
    });
    setTasks(updated);
  };

  const handleCompleteTask = async (taskId: string) => {
    await tasksStorage.update(taskId, { status: 'done', completedAt: Date.now() });
    const updated = await tasksStorage.query({
      status: ['inbox', 'todo', 'in-progress'],
      limit: 10,
    });
    setTasks(updated);
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className={cn('h-screen flex flex-col font-sans', isLight ? 'bg-paper text-ink' : 'bg-ink text-paper')}>
      <div className={cn('flex items-center justify-between p-4 border-b', isLight ? 'border-ink/15' : 'border-paper/20')}>
        <h2 className="font-serif italic font-black text-xl">Productivity</h2>
        <ToggleButton>{t('toggleTheme')}</ToggleButton>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {focusSession?.isActive ? (
          <>
            <div
              className={cn(
                'border p-4',
                isLight ? 'bg-ink text-paper border-ink shadow-[5px_5px_0px_0px_#D14D2A]' : 'bg-paper text-ink border-paper shadow-[5px_5px_0px_0px_#D14D2A]',
              )}>
              <p className="text-[10px] uppercase tracking-widest font-bold mb-3 opacity-70">Focus Active</p>
              <FocusTimer session={focusSession} onPause={handlePauseClick} onBreak={handleBreakClick} onEnd={handleEndClick} />
            </div>

            <div className="space-y-2">
              <h3 className="text-[10px] uppercase tracking-widest font-bold opacity-60">Tasks This Session</h3>
              {focusSession.associatedTaskId && (
                <div className={cn('border p-2 text-sm', isLight ? 'border-ink/15' : 'border-paper/20')}>
                  <p className="opacity-70">Associated task ID:</p>
                  <p className="font-mono text-xs opacity-50 break-all">{focusSession.associatedTaskId}</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab('focus')}
                className={cn(
                  'flex-1 px-3 py-2 text-[10px] uppercase tracking-widest font-bold border transition-colors',
                  activeTab === 'focus'
                    ? isLight
                      ? 'bg-ink text-paper border-ink'
                      : 'bg-paper text-ink border-paper'
                    : isLight
                      ? 'border-ink/30 hover:bg-ink/10'
                      : 'border-paper/30 hover:bg-paper/10',
                )}>
                Focus
              </button>
              <button
                onClick={() => setActiveTab('tasks')}
                className={cn(
                  'flex-1 px-3 py-2 text-[10px] uppercase tracking-widest font-bold border transition-colors',
                  activeTab === 'tasks'
                    ? isLight
                      ? 'bg-ink text-paper border-ink'
                      : 'bg-paper text-ink border-paper'
                    : isLight
                      ? 'border-ink/30 hover:bg-ink/10'
                      : 'border-paper/30 hover:bg-paper/10',
                )}>
                Tasks ({tasks.length})
              </button>
            </div>

            {activeTab === 'focus' && (
              <div className="text-center space-y-3 py-8 opacity-75">
                <p className="text-sm">No active focus session</p>
                <p className="text-xs uppercase tracking-widest opacity-70">Start a focus session from the popup</p>
              </div>
            )}

            {activeTab === 'tasks' && (
              <div className="space-y-2">
                {tasks.length === 0 ? (
                  <div className="text-center py-8 opacity-75">
                    <p className="text-sm">No active tasks</p>
                  </div>
                ) : (
                  tasks.map(task => (
                    <div
                      key={task.id}
                      className={cn(
                        'border p-3 cursor-pointer transition-colors',
                        task.status === 'in-progress'
                          ? 'border-l-4 border-l-planning border-y-ink/15 border-r-ink/15 dark:border-y-paper/15 dark:border-r-paper/15'
                          : isLight
                            ? 'border-ink/15 hover:bg-ink/5'
                            : 'border-paper/20 hover:bg-paper/5',
                      )}
                      onClick={() => handleTaskClick(task.id)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{task.title}</p>
                          {task.priority !== 'medium' && (
                            <p className={cn('text-[10px] uppercase tracking-widest font-bold mt-1', task.priority === 'high' ? 'text-panic' : 'text-planning')}>
                              {task.priority}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handleCompleteTask(task.id);
                          }}
                          className="text-lg hover:opacity-70">
                          ✓
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default withErrorBoundary(withSuspense(SidePanel, <LoadingSpinner />), ErrorDisplay);

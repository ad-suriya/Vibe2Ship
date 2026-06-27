import { useEffect, useState } from 'react';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleThemeStorage, tasksStorage } from '@extension/storage';
import { cn, LoadingSpinner, ErrorDisplay } from '@extension/ui';

interface PageContext {
  title?: string;
  url?: string;
  favicon?: string;
  selectedText?: string;
}

async function createTaskOnDashboard(taskName: string, description?: string, url?: string, selectedText?: string) {
  return tasksStorage.addTask({
    title: taskName,
    description,
    url,
    selectedText,
    priority: 'medium',
    tags: [],
    status: 'todo',
    estimatedMinutes: 30,
    syncedToMobile: false,
  });
}

function TaskCaptureContent() {
  const { isLight } = useStorage(exampleThemeStorage);
  const [context, setContext] = useState<PageContext>({});
  const [taskName, setTaskName] = useState('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const getPageContext = async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (tab) {
          setContext({
            title: tab.title,
            url: tab.url,
            favicon: tab.favIconUrl,
          });

          if (taskName === '' && tab.title) {
            setTaskName(tab.title);
          }

          if (tab.id) {
            try {
              const response = await chrome.tabs.sendMessage(tab.id, {
                type: 'QUERY_CONTEXT',
                payload: { query: 'context' },
              });

              if (response?.selectedText && description === '') {
                setDescription(response.selectedText);
                setContext(prev => ({
                  ...prev,
                  selectedText: response.selectedText,
                }));
              }
            } catch {
            }
          }
        }
      } catch (err) {
        console.error('Failed to get page context:', err);
      }
    };

    getPageContext();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskName.trim()) {
      setError('Task name is required');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await createTaskOnDashboard(taskName.trim(), description.trim(), context.url, context.selectedText);
      setSuccess(true);

      setTimeout(() => {
        window.close();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn('min-h-screen p-6 font-sans', isLight ? 'bg-paper' : 'bg-ink')}>
      <div className="mx-auto max-w-2xl">
        <div className="space-y-6">
          <div>
            <h1 className={cn('font-serif italic font-black text-3xl', isLight ? 'text-ink' : 'text-paper')}>
              Capture Task
            </h1>
            <p className={cn('mt-2 text-xs uppercase tracking-widest', isLight ? 'text-ink/60' : 'text-paper/60')}>
              Save to your Task Weave task list
            </p>
          </div>

          {context.url && (
            <div className={cn('border p-4', isLight ? 'bg-white border-ink/15' : 'bg-ink border-paper/20')}>
              <p className={cn('text-[10px] uppercase tracking-widest', isLight ? 'text-ink/60' : 'text-paper/60')}>
                From current tab:
              </p>
              <p className={cn('mt-1 truncate font-semibold', isLight ? 'text-ink' : 'text-paper')}>{context.title}</p>
              <p className={cn('mt-1 truncate text-xs', isLight ? 'text-ink/50' : 'text-paper/50')}>{context.url}</p>
            </div>
          )}

          <div
            className={cn(
              'border p-6',
              isLight
                ? 'bg-white border-ink shadow-[6px_6px_0px_0px_#1A1A1A]'
                : 'bg-ink border-paper shadow-[6px_6px_0px_0px_#F5F2ED]',
            )}>
            {success ? (
              <div className="text-center">
                <div
                  className={cn(
                    'mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border',
                    isLight ? 'border-planning text-planning' : 'border-planning text-planning',
                  )}>
                  <span className="text-2xl">✓</span>
                </div>
                <h2 className={cn('font-serif font-black text-lg', isLight ? 'text-ink' : 'text-paper')}>
                  Task Created!
                </h2>
                <p className={cn('mt-1 text-xs uppercase tracking-widest', isLight ? 'text-ink/60' : 'text-paper/60')}>
                  Added to Dashboard
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label
                    className={cn(
                      'block text-[10px] uppercase tracking-widest font-bold mb-1',
                      isLight ? 'text-ink/70' : 'text-paper/70',
                    )}>
                    Task Name *
                  </label>
                  <input
                    type="text"
                    value={taskName}
                    onChange={e => setTaskName(e.target.value)}
                    placeholder="What needs to be done?"
                    className={cn(
                      'w-full px-3 py-2 border focus:outline-none',
                      isLight
                        ? 'bg-white border-ink/30 text-ink focus:border-ink'
                        : 'bg-ink border-paper/30 text-paper focus:border-paper',
                    )}
                    disabled={isLoading}
                  />
                </div>

                <div>
                  <label
                    className={cn(
                      'block text-[10px] uppercase tracking-widest font-bold mb-1',
                      isLight ? 'text-ink/70' : 'text-paper/70',
                    )}>
                    Next Step / Details
                  </label>
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Break it into the smallest next step..."
                    rows={3}
                    className={cn(
                      'w-full px-3 py-2 border focus:outline-none resize-none',
                      isLight
                        ? 'bg-white border-ink/30 text-ink focus:border-ink'
                        : 'bg-ink border-paper/30 text-paper focus:border-paper',
                    )}
                    disabled={isLoading}
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading || !taskName.trim()}
                  className={cn(
                    'w-full py-2 font-bold uppercase tracking-widest text-sm transition-all border',
                    isLight
                      ? 'bg-ink text-paper border-ink shadow-[3px_3px_0px_0px_#D14D2A] hover:bg-[#333] disabled:opacity-50'
                      : 'bg-paper text-ink border-paper shadow-[3px_3px_0px_0px_#D14D2A] hover:bg-gray-200 disabled:opacity-50',
                  )}>
                  {isLoading ? 'Creating...' : 'Create Task'}
                </button>
              </form>
            )}
          </div>

          {error && (
            <div className={cn('border p-4', isLight ? 'border-panic bg-panic/10' : 'border-panic bg-panic/20')}>
              <p className={cn('text-sm font-medium', isLight ? 'text-panic' : 'text-panic')}>{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const TaskCapture = withErrorBoundary(
  withSuspense(TaskCaptureContent, <LoadingSpinner />),
  ErrorDisplay,
);

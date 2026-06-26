import { useEffect, useState } from 'react';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleThemeStorage } from '@extension/storage';
import { cn, LoadingSpinner, ErrorDisplay } from '@extension/ui';

interface PageContext {
  title?: string;
  url?: string;
  favicon?: string;
  selectedText?: string;
}

const API_BASE = 'http://localhost:8000/api';

async function createTaskOnDashboard(taskName: string, description?: string) {
  const res = await fetch(`${API_BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task_name: taskName,
      urgency: 'MEDIUM',
      estimated_minutes: 30,
      next_micro_step: description || '',
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(data.detail || 'Failed to create task');
  }

  return res.json();
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
      await createTaskOnDashboard(taskName.trim(), description.trim());
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
    <div className={cn('min-h-screen p-6', isLight ? 'bg-gray-50' : 'bg-slate-950')}>
      <div className="mx-auto max-w-2xl">
        <div className="space-y-6">
          <div>
            <h1 className={cn('text-3xl font-bold', isLight ? 'text-gray-900' : 'text-white')}>
              Capture Task
            </h1>
            <p className={cn('mt-2', isLight ? 'text-gray-600' : 'text-gray-400')}>
              Save to your Last-Minute Life Saver task list
            </p>
          </div>

          {context.url && (
            <div className={cn('rounded-lg p-4', isLight ? 'bg-white border border-gray-200' : 'bg-slate-800 border border-slate-700')}>
              <p className={cn('text-sm', isLight ? 'text-gray-600' : 'text-gray-400')}>From current tab:</p>
              <p className={cn('mt-1 truncate font-semibold', isLight ? 'text-gray-900' : 'text-white')}>
                {context.title}
              </p>
              <p className={cn('mt-1 truncate text-xs', isLight ? 'text-gray-500' : 'text-gray-500')}>
                {context.url}
              </p>
            </div>
          )}

          <div className={cn('rounded-lg p-6 shadow-sm', isLight ? 'bg-white' : 'bg-slate-800')}>
            {success ? (
              <div className="text-center">
                <div className={cn('mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full', isLight ? 'bg-green-100' : 'bg-green-900')}>
                  <span className="text-2xl">✓</span>
                </div>
                <h2 className={cn('text-lg font-semibold', isLight ? 'text-gray-900' : 'text-white')}>
                  Task Created!
                </h2>
                <p className={cn('mt-1 text-sm', isLight ? 'text-gray-600' : 'text-gray-400')}>
                  Added to Dashboard
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className={cn('block text-sm font-medium mb-1', isLight ? 'text-gray-700' : 'text-gray-300')}>
                    Task Name *
                  </label>
                  <input
                    type="text"
                    value={taskName}
                    onChange={(e) => setTaskName(e.target.value)}
                    placeholder="What needs to be done?"
                    className={cn(
                      'w-full px-3 py-2 rounded border focus:outline-none',
                      isLight
                        ? 'bg-white border-gray-300 text-gray-900 focus:border-purple-500'
                        : 'bg-slate-700 border-slate-600 text-white focus:border-purple-500',
                    )}
                    disabled={isLoading}
                  />
                </div>

                <div>
                  <label className={cn('block text-sm font-medium mb-1', isLight ? 'text-gray-700' : 'text-gray-300')}>
                    Next Step / Details
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Break it into the smallest next step..."
                    rows={3}
                    className={cn(
                      'w-full px-3 py-2 rounded border focus:outline-none resize-none',
                      isLight
                        ? 'bg-white border-gray-300 text-gray-900 focus:border-purple-500'
                        : 'bg-slate-700 border-slate-600 text-white focus:border-purple-500',
                    )}
                    disabled={isLoading}
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading || !taskName.trim()}
                  className={cn(
                    'w-full py-2 rounded font-semibold transition-all',
                    isLight
                      ? 'bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50'
                      : 'bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50',
                  )}>
                  {isLoading ? 'Creating...' : 'Create Task'}
                </button>
              </form>
            )}
          </div>

          {error && (
            <div className={cn('rounded-lg border p-4', isLight ? 'border-red-200 bg-red-50' : 'border-red-900 bg-red-900/20')}>
              <p className={cn('text-sm font-medium', isLight ? 'text-red-800' : 'text-red-200')}>{error}</p>
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

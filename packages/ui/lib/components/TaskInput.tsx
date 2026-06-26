import React, { useState } from 'react';
import { cn } from '../utils';
import type { TaskPriority } from '@extension/types';

export interface TaskInputProps {
  onSubmit: (task: {
    title: string;
    description?: string;
    priority: TaskPriority;
    tags: string[];
    url?: string;
    selectedText?: string;
  }) => Promise<void>;
  defaultUrl?: string;
  defaultTitle?: string;
  defaultSelectedText?: string;
  isLoading?: boolean;
}

export const TaskInput: React.FC<TaskInputProps> = ({
  onSubmit,
  defaultUrl,
  defaultTitle,
  defaultSelectedText,
  isLoading = false,
}) => {
  const [title, setTitle] = useState(defaultTitle || '');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Task title is required');
      return;
    }

    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        tags,
        url: defaultUrl,
        selectedText: defaultSelectedText,
      });

      setTitle('');
      setDescription('');
      setPriority('medium');
      setTags([]);
      setExpanded(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <input
          type="text"
          placeholder="What do you need to do?"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onFocus={() => setExpanded(true)}
          className={cn(
            'w-full rounded-lg border px-3 py-2 text-sm',
            'border-gray-300 bg-white text-gray-900',
            'placeholder-gray-500',
            'focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none',
            'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100',
            'dark:placeholder-gray-400',
          )}
          disabled={isLoading}
        />
      </div>

      {expanded && (
        <>
          <div>
            <textarea
              placeholder="Add more details..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              className={cn(
                'w-full rounded-lg border px-3 py-2 text-sm',
                'border-gray-300 bg-white text-gray-900',
                'placeholder-gray-500',
                'focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none',
                'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100',
                'dark:placeholder-gray-400',
                'resize-none h-20',
              )}
              disabled={isLoading}
            />
          </div>

          <div className="flex gap-2">
            <select
              value={priority}
              onChange={e => setPriority(e.target.value as TaskPriority)}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm font-medium',
                'border-gray-300 bg-white text-gray-900',
                'focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none',
                'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100',
              )}
              disabled={isLoading}>
              <option value="low">Low Priority</option>
              <option value="medium">Medium Priority</option>
              <option value="high">High Priority</option>
            </select>
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Add tag (press Enter)"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                className={cn(
                  'flex-1 rounded-lg border px-3 py-2 text-sm',
                  'border-gray-300 bg-white text-gray-900',
                  'placeholder-gray-500',
                  'focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none',
                  'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100',
                  'dark:placeholder-gray-400',
                )}
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={handleAddTag}
                className={cn(
                  'rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white',
                  'hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed',
                )}
                disabled={isLoading}>
                Add
              </button>
            </div>

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tags.map(tag => (
                  <span
                    key={tag}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs',
                      'bg-blue-100 text-blue-700',
                      'dark:bg-blue-900 dark:text-blue-200',
                    )}>
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="hover:opacity-70"
                      disabled={isLoading}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {defaultUrl && (
            <div className={cn('text-xs text-gray-500', 'dark:text-gray-400')}>
              From: {new URL(defaultUrl).hostname}
            </div>
          )}
        </>
      )}

      {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

      <button
        type="submit"
        disabled={isLoading}
        className={cn(
          'w-full rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white',
          'hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed',
          'transition-colors',
        )}>
        {isLoading ? 'Creating...' : 'Create Task'}
      </button>
    </form>
  );
};

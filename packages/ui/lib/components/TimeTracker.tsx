import { useEffect, useState } from 'react';
import { cn } from '../utils';
import type { FocusSession, Project } from '@extension/types';

interface TimeTrackerProps {
  session: FocusSession | null;
  description: string;
  onDescriptionChange: (v: string) => void;
  projectId?: string;
  projects: Project[];
  onProjectChange: (id: string | undefined) => void;
  onStart: () => void;
  onStop: () => void;
  onAddProject?: (name: string, color: string) => void;
  className?: string;
}

const formatTime = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const TimeTracker = ({
  session,
  description,
  onDescriptionChange,
  projectId,
  projects,
  onProjectChange,
  onStart,
  onStop,
  onAddProject,
  className,
}: TimeTrackerProps) => {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectColor, setNewProjectColor] = useState('#2563eb');

  useEffect(() => {
    if (!session?.isActive) {
      setElapsedMs(0);
      return;
    }

    setElapsedMs(Date.now() - session.startTime);

    const interval = setInterval(() => {
      setElapsedMs(Date.now() - session.startTime);
    }, 100);

    return () => clearInterval(interval);
  }, [session?.isActive, session?.startTime]);

  const handleAddProject = () => {
    if (newProjectName.trim() && onAddProject) {
      onAddProject(newProjectName, newProjectColor);
      setNewProjectName('');
      setNewProjectColor('#2563eb');
      setShowNewProject(false);
    }
  };

  const currentProject = projects.find(p => p.id === projectId);

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Timer Display */}
      {session?.isActive && (
        <div className="text-center">
          <div className="text-5xl font-bold font-mono tabular-nums">
            {formatTime(elapsedMs)}
          </div>
        </div>
      )}

      {/* Description Input */}
      <input
        type="text"
        placeholder="What are you working on?"
        value={description}
        onChange={e => onDescriptionChange(e.target.value)}
        disabled={session?.isActive}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white disabled:opacity-50"
      />

      {/* Project Selection */}
      <div className="flex gap-2">
        <select
          value={projectId || ''}
          onChange={e => {
            if (e.target.value === '__new__') {
              setShowNewProject(true);
              e.target.value = projectId || '';
            } else {
              onProjectChange(e.target.value || undefined);
            }
          }}
          disabled={session?.isActive}
          className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white disabled:opacity-50"
        >
          <option value="">No project</option>
          {projects.map(project => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
          <option value="__new__">+ Add project</option>
        </select>
        {currentProject && (
          <div
            className="w-10 h-10 rounded-lg border border-gray-300 dark:border-gray-600"
            style={{ backgroundColor: currentProject.color }}
          />
        )}
      </div>

      {/* New Project Form */}
      {showNewProject && (
        <div className="flex gap-2 items-center bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
          <input
            type="text"
            placeholder="Project name"
            value={newProjectName}
            onChange={e => setNewProjectName(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
            autoFocus
          />
          <input
            type="color"
            value={newProjectColor}
            onChange={e => setNewProjectColor(e.target.value)}
            className="w-10 h-10 rounded cursor-pointer"
          />
          <button
            onClick={handleAddProject}
            className="px-3 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700"
          >
            Add
          </button>
          <button
            onClick={() => {
              setShowNewProject(false);
              setNewProjectName('');
              setNewProjectColor('#2563eb');
            }}
            className="px-3 py-2 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white rounded text-sm font-medium hover:bg-gray-400 dark:hover:bg-gray-500"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Start/Stop Button */}
      <button
        onClick={session?.isActive ? onStop : onStart}
        className={cn(
          'w-full py-3 px-4 rounded-lg font-semibold transition-all text-white',
          session?.isActive
            ? 'bg-red-600 hover:bg-red-700'
            : 'bg-green-600 hover:bg-green-700',
        )}
      >
        {session?.isActive ? '⏹ Stop' : '▶ Start'}
      </button>
    </div>
  );
};

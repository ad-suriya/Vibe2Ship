import { useEffect, useState } from 'react';
import { cn } from '../utils';
import type { FocusSession } from '@extension/types';

interface TimeTrackerProps {
  session: FocusSession | null;
  description: string;
  onDescriptionChange: (v: string) => void;
  onStart: () => void;
  onStop: () => void;
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

export const TimeTracker = ({ session, description, onDescriptionChange, onStart, onStop, className }: TimeTrackerProps) => {
  const [remainingMs, setRemainingMs] = useState(0);

  useEffect(() => {
    if (!session?.isActive) {
      setRemainingMs(0);
      return;
    }

    const targetMs = (session.durationMinutes || 25) * 60_000;
    const tick = () => setRemainingMs(Math.max(0, targetMs - (Date.now() - session.startTime)));

    tick();
    const interval = setInterval(tick, 1000);

    return () => clearInterval(interval);
  }, [session?.isActive, session?.startTime, session?.durationMinutes]);

  return (
    <div className={cn('flex flex-col gap-4 font-sans', className)}>
      {/* Timer Display */}
      {session?.isActive && (
        <div className="text-center">
          <div className="text-5xl font-mono font-black tabular-nums">{formatTime(remainingMs)}</div>
        </div>
      )}

      {/* Description Input */}
      <input
        type="text"
        placeholder="What are you working on?"
        value={description}
        onChange={e => onDescriptionChange(e.target.value)}
        disabled={session?.isActive}
        className="w-full px-3 py-2 border border-ink/30 dark:border-paper/30 bg-paper dark:bg-ink text-ink dark:text-paper placeholder:text-ink/50 dark:placeholder:text-paper/50 focus:outline-none focus:border-ink dark:focus:border-paper disabled:opacity-50"
      />

      {/* Start/Stop Button */}
      <button
        onClick={session?.isActive ? onStop : onStart}
        className={cn(
          'w-full py-3 px-4 font-bold uppercase tracking-widest text-sm transition-all text-paper border',
          session?.isActive
            ? 'bg-panic border-panic shadow-[4px_4px_0px_0px_#1A1A1A]'
            : 'bg-ink border-ink shadow-[4px_4px_0px_0px_#D14D2A]',
        )}
      >
        {session?.isActive ? '■ Stop' : '▶ Start'}
      </button>
    </div>
  );
};

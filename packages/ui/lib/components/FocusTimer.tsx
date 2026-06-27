import React, { useEffect, useState } from 'react';
import { cn } from '../utils';
import type { FocusSession } from '@extension/types';

export interface FocusTimerProps {
  session: FocusSession;
  onPause?: () => void;
  onBreak?: () => void;
  onEnd?: () => void;
  className?: string;
}

export const FocusTimer: React.FC<FocusTimerProps> = ({
  session,
  onPause,
  onBreak,
  onEnd,
  className,
}) => {
  const [timeLeft, setTimeLeft] = useState(0);
  const [isPaused, setIsPaused] = useState(!session.isActive);

  useEffect(() => {
    if (!session.endTime) {
      const elapsed = (Date.now() - session.startTime) / 1000 / 60;
      const remaining = Math.max(0, session.durationMinutes - elapsed);
      setTimeLeft(remaining);
    }
  }, [session]);

  useEffect(() => {
    if (isPaused || !session.isActive) return;

    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 0) {
          clearInterval(interval);
          return 0;
        }
        return prev - 0.016;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isPaused, session.isActive]);

  const minutes = Math.floor(timeLeft);
  const seconds = Math.floor((timeLeft % 1) * 60);
  const percentage = (timeLeft / session.durationMinutes) * 100;

  return (
    <div className={cn('space-y-4 font-sans', className)}>
      <div className="text-center">
        <div className="text-5xl font-mono font-black tabular-nums">
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </div>
        <p className="mt-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
          {session.mode === 'pomodoro' && 'Pomodoro Focus'}
          {session.mode === 'long-focus' && 'Long Focus'}
          {session.mode === 'custom' && `${session.durationMinutes} min Focus`}
        </p>
      </div>

      <div className="w-full h-2 border border-ink/20 dark:border-paper/20 overflow-hidden">
        <div className="h-full bg-planning transition-all duration-1000" style={{ width: `${percentage}%` }} />
      </div>

      {session.breaksTaken > 0 && (
        <div className="text-center text-sm">
          <p className="opacity-70">
            Breaks taken: <span className="font-semibold">{session.breaksTaken}</span>
          </p>
          <p className="text-xs opacity-50">Total break time: {session.totalBreakMinutes} min</p>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => {
            setIsPaused(!isPaused);
            if (!isPaused) {
              onPause?.();
            }
          }}
          className="flex-1 border border-ink dark:border-paper px-3 py-2 font-bold uppercase tracking-widest text-[10px] hover:bg-ink hover:text-paper dark:hover:bg-paper dark:hover:text-ink transition-colors">
          {isPaused ? 'Resume' : 'Pause'}
        </button>

        <button
          onClick={onBreak}
          className="flex-1 border border-ink dark:border-paper px-3 py-2 font-bold uppercase tracking-widest text-[10px] hover:bg-ink hover:text-paper dark:hover:bg-paper dark:hover:text-ink transition-colors">
          Break
        </button>

        <button
          onClick={onEnd}
          className="flex-1 bg-panic border border-panic text-paper px-3 py-2 font-bold uppercase tracking-widest text-[10px] hover:bg-[#b53f21] transition-colors">
          End
        </button>
      </div>
    </div>
  );
};

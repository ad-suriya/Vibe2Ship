import React, { useEffect, useState } from 'react';
import { cn } from '../utils';

export interface FocusBlockerProps {
  blockedUrl: string;
  focusTimeLeft: number;
  onOverride?: () => void;
  onFocusMore?: () => void;
  // Task-capture site lock: when set, only `allowedSite` is reachable —
  // the heading/subtext flip to explain that instead of the generic
  // "this specific site is blocked" blocklist framing.
  allowedSite?: string | null;
}

export const FocusBlocker: React.FC<FocusBlockerProps> = ({
  blockedUrl,
  focusTimeLeft,
  onOverride,
  onFocusMore,
  allowedSite,
}) => {
  const [countdownLeft, setCountdownLeft] = useState(5);

  useEffect(() => {
    if (countdownLeft <= 0) return;

    const timer = setTimeout(() => {
      setCountdownLeft(prev => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdownLeft]);

  const getDomainFromUrl = (url: string): string => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };

  const minutes = Math.floor(focusTimeLeft);
  const seconds = Math.floor((focusTimeLeft % 1) * 60);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-orange-50 dark:from-gray-900 dark:to-gray-800 p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="text-6xl">🎯</div>

        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            {allowedSite ? "You're locked to your task's site." : 'You started a focus session. Finish first.'}
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {allowedSite ? (
              <>
                Only <span className="font-semibold text-lg">{allowedSite}</span> is reachable right now —{' '}
                <span className="font-semibold text-lg">{getDomainFromUrl(blockedUrl)}</span> is off-limits until you
                finish or unlock from the popup.
              </>
            ) : (
              <>
                <span className="font-semibold text-lg">{getDomainFromUrl(blockedUrl)}</span> is blocked until your
                session ends.
              </>
            )}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">Time left in focus session:</p>
          <p className="text-4xl font-bold tabular-nums">
            {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
          </p>
        </div>

        <div className="space-y-3">
          {countdownLeft > 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-500">
              Override available in {countdownLeft}s...
            </p>
          ) : (
            <button
              onClick={onOverride}
              className={cn(
                'w-full rounded-lg px-4 py-2 font-medium',
                'bg-orange-500 text-white hover:bg-orange-600',
                'transition-colors',
              )}>
              🔓 Override (1 time)
            </button>
          )}

          <button
            onClick={onFocusMore}
            className={cn(
              'w-full rounded-lg px-4 py-2 font-medium',
              'bg-blue-600 text-white hover:bg-blue-700',
              'transition-colors',
            )}>
            💪 Add 5 More Minutes
          </button>

          <button
            onClick={() => window.history.back()}
            className={cn(
              'w-full rounded-lg px-4 py-2 font-medium',
              'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-300 dark:hover:bg-gray-600',
              'transition-colors',
            )}>
            ← Go Back
          </button>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-500 px-4">
          This helps you stay on track. Remember why you started this focus session.
        </p>
      </div>
    </div>
  );
};

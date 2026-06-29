import React, { useEffect, useState } from 'react';
import { FocusBlocker } from '@extension/ui';
import { focusSessionStorage, blockingStorage } from '@extension/storage';
import type { FocusSession } from '@extension/types';

const FocusLock: React.FC = () => {
  const [session, setSession] = useState<FocusSession | null>(null);
  const [blockedUrl, setBlockedUrl] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [allowedSite, setAllowedSite] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      const params = new URLSearchParams(window.location.search);
      const url = params.get('url') || window.location.href;
      setBlockedUrl(url);

      const blocking = await blockingStorage.get();
      setAllowedSite(blocking.mode === 'allowlist' ? blocking.allowedSite : null);

      // Best-effort: pull the real session for the countdown / "+5 min".
      // This hits the backend and needs a still-valid auth token (~1hr
      // lifetime) — if it fails (expired token, backend hiccup, offline),
      // still show the lock screen below instead of trapping the user on
      // an infinite spinner with no override and no way out.
      try {
        const currentSession = await focusSessionStorage.getCurrent();
        if (currentSession && !currentSession.endTime) {
          setSession(currentSession);
          const elapsed = (Date.now() - currentSession.startTime) / 1000 / 60;
          setTimeLeft(Math.max(0, currentSession.durationMinutes - elapsed));
        }
      } catch (err) {
        console.error('Failed to load the active session (showing the lock screen without a countdown):', err);
      } finally {
        setIsLoading(false);
      }
    };

    init();
  }, []);

  useEffect(() => {
    if (!session || !session.isActive) return;

    const interval = setInterval(() => {
      setTimeLeft(prev => Math.max(0, prev - 0.016));
    }, 1000);

    return () => clearInterval(interval);
  }, [session]);

  const handleOverride = async () => {
    try {
      await blockingStorage.overrideOnce(new URL(blockedUrl).hostname.replace(/^www\./, ''));
    } catch {
      /* malformed URL — fall through and let it redirect again if so */
    }
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]?.id) {
        chrome.tabs.update(tabs[0].id, { url: blockedUrl });
      }
    });
  };

  const handleFocusMore = async () => {
    if (!session) return;

    await focusSessionStorage.update(session.id, {
      durationMinutes: session.durationMinutes + 5,
    });

    window.history.back();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-6xl animate-pulse">🎯</div>
          <p className="text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <FocusBlocker
      blockedUrl={blockedUrl}
      focusTimeLeft={timeLeft}
      onOverride={handleOverride}
      onFocusMore={handleFocusMore}
      allowedSite={allowedSite}
    />
  );
};

export default FocusLock;

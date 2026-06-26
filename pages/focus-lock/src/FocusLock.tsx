import React, { useEffect, useState } from 'react';
import { FocusBlocker } from '@extension/ui';
import { focusSessionStorage } from '@extension/storage';
import type { FocusSession } from '@extension/types';

const FocusLock: React.FC = () => {
  const [session, setSession] = useState<FocusSession | null>(null);
  const [blockedUrl, setBlockedUrl] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const url = params.get('url') || window.location.href;
        setBlockedUrl(url);

        const currentSession = await focusSessionStorage.getCurrent();
        if (currentSession && !currentSession.endTime) {
          setSession(currentSession);

          const elapsed = (Date.now() - currentSession.startTime) / 1000 / 60;
          const remaining = Math.max(0, currentSession.durationMinutes - elapsed);
          setTimeLeft(remaining);
        }
      } catch (err) {
        console.error('Failed to initialize focus lock:', err);
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

  const handleOverride = () => {
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

  if (isLoading || !session) {
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
    />
  );
};

export default FocusLock;

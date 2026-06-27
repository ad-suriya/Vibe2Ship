import React, { useEffect } from 'react';
import { cn, LoadingSpinner } from '@extension/ui';
import { authStorage } from '@extension/storage';

interface LoginProps {
  isLight: boolean;
  onLoginSuccess: (user: any) => void;
  isLoading?: boolean;
}

export const Login: React.FC<LoginProps> = ({ isLight, onLoginSuccess, isLoading = false }) => {
  const handleOpenDashboard = () => {
    chrome.tabs.create({ url: 'http://localhost:5173' });
    // After opening dashboard, periodically check if user logged in
    const checkInterval = setInterval(async () => {
      const state = await authStorage.get();
      if (state.isAuthenticated) {
        clearInterval(checkInterval);
        onLoginSuccess(state.user);
      }
    }, 1000);
    // Stop checking after 2 minutes
    setTimeout(() => clearInterval(checkInterval), 120000);
  };

  const handleRefreshAuth = async () => {
    const state = await authStorage.get();
    if (state.isAuthenticated) {
      onLoginSuccess(state.user);
    }
  };

  return (
    <div
      className={cn(
        'min-h-screen flex items-center justify-center p-4 font-sans',
        isLight ? 'bg-paper text-ink' : 'bg-ink text-paper',
      )}
    >
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="font-serif italic font-black text-3xl">Task Weave</h1>
          <p className="mt-2 text-xs uppercase tracking-widest opacity-60">Stay focused. Get more done.</p>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleOpenDashboard}
            className={cn(
              'w-full py-3 px-4 font-semibold transition-all border',
              isLight
                ? 'bg-ink text-paper border-ink shadow-[4px_4px_0px_0px_#D14D2A] hover:bg-[#333]'
                : 'bg-paper text-ink border-paper shadow-[4px_4px_0px_0px_#D14D2A] hover:bg-gray-200',
            )}
          >
            Login with Google
          </button>

          <button
            onClick={handleRefreshAuth}
            className={cn(
              'w-full py-3 px-4 font-semibold transition-all text-sm border',
              isLight ? 'border-ink hover:bg-ink hover:text-paper' : 'border-paper hover:bg-paper hover:text-ink',
            )}
          >
            Already Logged In? Click Here
          </button>

          {isLoading && (
            <div className="flex justify-center">
              <LoadingSpinner />
            </div>
          )}
        </div>

        <div className="text-center text-xs opacity-60 space-y-1">
          <p>Sign in with your Google account on the dashboard</p>
          <p>After logging in on dashboard, click the button above</p>
        </div>
      </div>
    </div>
  );
};

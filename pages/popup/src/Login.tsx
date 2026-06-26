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
        'min-h-screen flex items-center justify-center p-4',
        isLight ? 'bg-white text-gray-900' : 'bg-gray-900 text-white'
      )}
    >
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Focus Manager</h1>
          <p className="mt-2 text-sm opacity-70">Stay focused. Get more done.</p>
        </div>

        <div className="space-y-4">
          <button
            onClick={handleOpenDashboard}
            className={cn(
              'w-full py-3 px-4 rounded-lg font-semibold transition-all',
              isLight
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            )}
          >
            Login with Google
          </button>

          <button
            onClick={handleRefreshAuth}
            className={cn(
              'w-full py-3 px-4 rounded-lg font-semibold transition-all text-sm',
              isLight
                ? 'bg-gray-200 text-gray-900 hover:bg-gray-300'
                : 'bg-gray-700 text-white hover:bg-gray-600'
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

import React from 'react';

interface LoginPageProps {
  authError?: string;
}

// Sign-in is a full-page OAuth redirect handled by the backend
// (/api/auth/google/login -> Google -> /api/auth/google/callback), not a
// popup or FedCM/One Tap prompt. Google's popup/One Tap relay
// (accounts.google.com/gsi/transform) depends on third-party storage access
// that's unreliable across browsers/profiles; a redirect has no such
// dependency. App.tsx picks up the result from the #credential= fragment
// the backend redirects back with.
export const LoginPage: React.FC<LoginPageProps> = ({ authError }) => {
  return (
    <div className="min-h-screen bg-[#F5F2ED] text-[#1A1A1A] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-12">
        {/* Branding */}
        <div className="text-center space-y-3">
          <img src="/logo-mark.png" alt="Task Weave" className="h-16 w-16 mx-auto" />
          <div className="text-5xl font-black italic">Remember. Connect. Execute.</div>
          <p className="font-sans text-sm opacity-60">
            Your personal AI productivity coach. Remember what matters, connect it to a plan, execute without delay.
          </p>
        </div>

        {/* Login Section */}
        <div className="bg-white border-2 border-[#1A1A1A] p-8 shadow-[8px_8px_0px_0px_#1A1A1A] space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold">Get Started</h1>
            <p className="text-sm opacity-70">Sign in with your Google account</p>
          </div>

          <div className="space-y-4">
            <a
              href="/api/auth/google/login"
              className="flex items-center justify-center gap-3 w-full border-2 border-[#1A1A1A] rounded-md py-3 font-bold hover:bg-[#1A1A1A] hover:text-white transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
                <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
                <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
                <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l6.19 5.238C40.205 35.811 44 30.401 44 24c0-1.341-.138-2.65-.389-3.917z"/>
              </svg>
              Sign in with Google
            </a>

            {authError && (
              <p className="text-center text-xs text-red-600 font-sans">{authError}</p>
            )}
          </div>

          <div className="border-t border-[#1A1A1A]/20 pt-4 space-y-2 text-center text-xs opacity-60">
            <p>🔒 Your data is encrypted and secure</p>
            <p>📱 Synced across your extension and dashboard</p>
            <p>⚡ Zero-friction productivity starts here</p>
          </div>
        </div>

        {/* Features */}
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="space-y-1">
            <div className="text-2xl">📋</div>
            <p className="text-xs font-bold uppercase opacity-60">Task Planning</p>
          </div>
          <div className="space-y-1">
            <div className="text-2xl">⏱️</div>
            <p className="text-xs font-bold uppercase opacity-60">Focus Mode</p>
          </div>
          <div className="space-y-1">
            <div className="text-2xl">🎯</div>
            <p className="text-xs font-bold uppercase opacity-60">Goal Tracking</p>
          </div>
        </div>

        {/* Extension callout */}
        <div className="text-center">
          <a
            href="/judges.html"
            className="inline-flex items-center gap-2 text-sm font-bold underline text-[#2A6B5E] hover:text-[#1A1A1A] transition-colors"
          >
            🧩 Try our Chrome extension — install &amp; testing guide
          </a>
        </div>

        {/* Footer */}
        <p className="text-center text-xs opacity-50">
          By signing in, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  );
};

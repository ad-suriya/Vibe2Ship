import React, { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

interface LoginPageProps {
  onLoginSuccess: (user: any) => void;
  isLoading?: boolean;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, isLoading = false }) => {
  useEffect(() => {
    // Load Google SDK
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);

    // Set up callback
    (window as any).onCredentialResponse = (response: any) => {
      const credential = response.credential;

      // Decode JWT token to get user info
      const base64Url = credential.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      const userData = JSON.parse(jsonPayload);

      const authData = {
        isAuthenticated: true,
        user: {
          id: userData.sub,
          email: userData.email,
          name: userData.name,
          picture: userData.picture,
        },
        accessToken: credential,
        refreshToken: credential,
        expiresAt: Date.now() + 3600 * 1000,
      };

      // Store in localStorage
      localStorage.setItem('auth', JSON.stringify(authData));

      // Dispatch event for content script to relay to extension
      window.dispatchEvent(
        new CustomEvent('dashboardAuthChanged', {
          detail: authData,
        })
      );

      // Try direct message to extension if available
      if ((window as any).chrome?.runtime) {
        (window as any).chrome.runtime.sendMessage(
          {
            type: 'AUTH_CHANGED',
            payload: { isAuthenticated: true, user: userData },
          },
          () => {
            if ((window as any).chrome?.runtime?.lastError) {
              console.log('Message sent to extension');
            }
          }
        );
      }

      onLoginSuccess(userData);
    };

    return () => {
      document.head.removeChild(script);
    };
  }, [onLoginSuccess]);

  return (
    <div className="min-h-screen bg-[#F5F2ED] text-[#1A1A1A] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-12">
        {/* Branding */}
        <div className="text-center space-y-3">
          <div className="text-5xl font-black italic">Anxiety, into Action.</div>
          <p className="font-sans text-sm opacity-60">
            Your personal AI productivity coach. Turn anxiety into a battle plan in seconds.
          </p>
        </div>

        {/* Login Section */}
        <div className="bg-white border-2 border-[#1A1A1A] p-8 shadow-[8px_8px_0px_0px_#1A1A1A] space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold">Get Started</h1>
            <p className="text-sm opacity-70">Sign in with your Google account</p>
          </div>

          <div className="space-y-4">
            {/* Google Sign-In Button */}
            <div id="g_id_onload" data-client_id="499282325321-nb73ceobbqt3bpvu58fjnoma3qt3k809.apps.googleusercontent.com" data-callback="onCredentialResponse" />
            <div
              id="g_id_signin"
              data-type="standard"
              data-size="large"
              data-theme="outline"
              data-text="signin_with"
              data-shape="rectangular"
              data-logo_alignment="left"
              className="flex justify-center"
            />

            {isLoading && (
              <div className="flex justify-center items-center gap-2 py-4">
                <Loader2 className="w-5 h-5 animate-spin text-[#1A1A1A]" />
                <span className="text-sm">Signing you in...</span>
              </div>
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

        {/* Footer */}
        <p className="text-center text-xs opacity-50">
          By signing in, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  );
};

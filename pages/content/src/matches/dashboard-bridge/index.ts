// Content script that runs on localhost:5173 dashboard
// Bridges authentication between dashboard and extension

console.log('[Dashboard Bridge] Content script loaded');

// Listen for dashboard auth changes
window.addEventListener('dashboardAuthChanged', (event: any) => {
  console.log('[Dashboard Bridge] Auth changed event received:', event.detail);

  const authData = event.detail;

  // Send to extension background script
  chrome.runtime.sendMessage(
    {
      type: 'AUTH_CHANGED',
      payload: {
        isAuthenticated: authData.isAuthenticated,
        user: authData.user,
        accessToken: authData.accessToken,
        refreshToken: authData.refreshToken,
      },
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.log('[Dashboard Bridge] Message sent with note:', chrome.runtime.lastError.message);
      } else {
        console.log('[Dashboard Bridge] Message sent successfully:', response);
      }
    }
  );
});

console.log('[Dashboard Bridge] Listening for auth events');

import React from 'react';
import ReactDOM from 'react-dom/client';
import { TaskCapture } from './TaskCapture';
import './index.css';

function initializeApp() {
  const root = document.getElementById('root');

  if (!root) {
    console.error('Root element not found');
    return;
  }

  try {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <TaskCapture />
      </React.StrictMode>,
    );
  } catch (error) {
    console.error('Failed to render app:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

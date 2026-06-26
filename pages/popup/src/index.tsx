import '@src/index.css';
import Popup from '@src/Popup';
import { createRoot } from 'react-dom/client';

const init = () => {
  const appContainer = document.querySelector('#app-container');
  if (!appContainer) {
    console.error('Can not find #app-container');
    return;
  }
  try {
    const root = createRoot(appContainer);
    root.render(<Popup />);
  } catch (error) {
    console.error('Failed to render popup:', error);
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

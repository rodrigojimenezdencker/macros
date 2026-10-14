import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { watchStorageHealth } from './storage';
import './styles.css';

// Ask the browser not to evict our IndexedDB data under storage pressure.
void navigator.storage?.persist?.();
watchStorageHealth();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

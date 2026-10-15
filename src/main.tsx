import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './Root';
import { ErrorBoundary } from './components/ErrorBoundary';
import { watchStorageHealth } from './storage';
import { keepUpToDate } from './pwa';
import './styles.css';

// Ask the browser not to evict our IndexedDB data under storage pressure.
void navigator.storage?.persist?.();
watchStorageHealth();
keepUpToDate();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);

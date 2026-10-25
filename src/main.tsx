import '@fontsource/noto-sans-devanagari/400.css';
import '@fontsource/noto-sans-devanagari/500.css';
import '@fontsource/noto-sans-devanagari/600.css';
import '@fontsource/noto-sans-devanagari/700.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/rozha-one/400.css';
import '@fontsource/kalam/400.css';
import '@fontsource/kalam/700.css';

import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initAndroidNativeBridge } from './utils/androidBridge.ts';
import { ErrorBoundary, installGlobalErrorHandlers } from './ErrorBoundary';

initAndroidNativeBridge();

// Install global error handlers so crashes show a red box instead of blank screen
installGlobalErrorHandlers();

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <div id="error-global-root"></div>
    <App />
  </ErrorBoundary>
);

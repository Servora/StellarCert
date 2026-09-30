import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './context/ThemeContext';
import { queryClient } from './lib/queryClient';
import App from './App';
import './index.css';
import { validateFrontendEnv } from './utils/envValidation';
import Misconfiguration from './components/Misconfiguration';

let error: Error | null = null;
try {
  validateFrontendEnv();
} catch (err) {
  error = err as Error;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Server-state cache. Sits outermost so every provider below it (notably
        AuthProvider, which gates rendering on a session refresh) can use
        queries without the client being torn down on re-authentication. */}
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          {error ? (
            <Misconfiguration error={error} />
          ) : (
            <App />
          )}
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);


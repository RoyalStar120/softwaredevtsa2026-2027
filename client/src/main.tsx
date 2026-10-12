import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/theme.css';
import './styles/components.css';
import './styles/app.css';
import { App } from './App.tsx';
import { SessionProvider } from './state/session.tsx';
import { ToastProvider } from './components/ui.tsx';

document.documentElement.dataset.theme = localStorage.getItem('sb-theme') ?? 'light';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);

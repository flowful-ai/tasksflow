import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { queryClient } from './lib/queryClient';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { Toaster } from './components/ui/Toast';
import { TooltipProvider } from './components/ui/Tooltip';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary variant="page">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

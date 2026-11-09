import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Load env files from monorepo root
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Dev server on 3000 (WEB_URL); the API, including SSE, is proxied from 3001.
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // No timeouts: SSE streams stay open.
        timeout: 0,
        proxyTimeout: 0,
      },
      '/.well-known': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});

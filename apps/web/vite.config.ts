import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * sonner injects its stylesheet with a runtime <style> tag, which the API's
 * CSP (style-src without 'unsafe-inline') blocks. Drop the injection; the
 * same CSS is imported as a file in src/components/ui/Toast.tsx.
 */
function sonnerWithoutInlineCss(): Plugin {
  return {
    name: 'sonner-without-inline-css',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]sonner[\\/]dist[\\/]index\.m?js$/.test(id)) return null;
      return { code: code.replace(/__insertCSS\("(?:[^"\\]|\\.)*"\);?/, ''), map: null };
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [sonnerWithoutInlineCss(), react()],
  // Dev pre-bundling skips plugin transforms: keep sonner out of it.
  optimizeDeps: { exclude: ['sonner'] },
  // Load env files from monorepo root
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // CSP: apply Radix's scroll-lock CSS via CSSOM instead of a <style> tag.
      'react-style-singleton': path.resolve(__dirname, './src/lib/styleSingleton.ts'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Stable vendor chunks: cached across app deploys, and no chunk over
        // 500 kB. zod is not listed: it follows the lazy routes that import
        // schemas from @flowtask/shared/types.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) return 'vendor-react';
          if (id.includes('@tanstack')) return 'vendor-query';
          if (id.includes('@radix-ui') || id.includes('@floating-ui')) return 'vendor-radix';
          if (id.includes('@dnd-kit')) return 'vendor-dnd';
          return undefined;
        },
      },
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

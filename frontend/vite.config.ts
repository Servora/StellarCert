import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src')
    }
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          // Heavy third-party libraries get dedicated, long-cacheable vendor
          // chunks instead of being duplicated into whichever route imports
          // them, so first-load is smaller and cross-route caching holds.
          if (id.includes('react-router') || id.includes('@remix-run')) return 'chunk-react-router';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'chunk-react';
          if (id.includes('html5-qrcode')) return 'chunk-qrcode-scan';
          if (id.includes('socket.io-client') || id.includes('engine.io-client')) return 'chunk-socket';
          if (id.includes('/qrcode')) return 'chunk-qrcode';
          if (id.includes('lucide-react')) return 'chunk-icons';
          if (id.includes('@stellar/stellar-sdk') || id.includes('stellar-base')) return 'chunk-stellar';
          if (id.includes('axios')) return 'chunk-axios';
          return 'chunk-vendor';
        }
      }
    },
    chunkSizeWarningLimit: 1200
  }
});

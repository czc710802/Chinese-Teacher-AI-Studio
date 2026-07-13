import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ['defaults', 'iOS >= 12', 'Android >= 7'],
      modernPolyfills: true
    })
  ],
  build: {
    target: 'es2018'
  },
  server: {
    allowedHosts: true,
    proxy: {
      '/api': 'http://127.0.0.1:4000',
      '/exports': 'http://127.0.0.1:4000',
      '/uploads': 'http://127.0.0.1:4000'
    }
  }
});

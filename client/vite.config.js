import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
  server: {
    host: true,       // Bind to 0.0.0.0 (required for Docker port forwarding)
    port: 5173,
    watch: {
      usePolling: true, // Detect file changes through Docker bind mounts
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  // `vite preview` serves the built dist/ verbatim, which is what needs checking for
  // any runtime request to a third-party origin (§6.3) — the same proxy as dev so it
  // can be checked against a real backend without a second reverse proxy.
  preview: {
    host: true,
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
    },
  },
})

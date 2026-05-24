import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Browser → :5173 (Vite) → /api/* proxied to :8501 (Python ASR server).
// Keeps the UI fetch() paths relative so swapping the backend later
// doesn't touch component code. ws: true upgrades WebSocket connects
// (used by /api/ws → /ws on the backend) — needed for the voice loop.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8501',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        ws: true,
      },
    },
  },
})

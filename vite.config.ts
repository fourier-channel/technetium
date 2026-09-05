import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Reachable over the tailnet via `tailscale serve`, which forwards the real
    // Host header (vesper.tail93f93d.ts.net). Vite blocks unknown hosts by
    // default; scope the allowance to this tailnet rather than disabling it.
    allowedHosts: ['.tail93f93d.ts.net'],
  },
})

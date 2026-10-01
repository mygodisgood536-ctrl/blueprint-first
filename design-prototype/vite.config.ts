import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    open: false,
    // Never watch test-run artifacts (headless-Chrome profile, logs,
    // screenshots, smoke output) — a locked file here crashes the watcher.
    watch: {
      ignored: [
        '**/.chrome-test/**',
        '**/*.log',
        '**/smoke-out.txt',
        '**/shot-*.png',
        '**/probe*.txt',
        '**/dom-*.txt',
        '**/net*.txt',
        '**/chk*.txt',
        '**/ns.txt',
      ],
    },
  },
})


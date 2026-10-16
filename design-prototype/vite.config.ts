import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Frontend dev server.
 *
 * The SPA talks to the same-origin control plane. In development the control
 * plane runs separately (`npm run dev` on :3000), so Vite proxies `/api` to it:
 * without this the dev workflow cannot reach a single real endpoint, which is
 * exactly how "everything works" can be believed while nothing is connected.
 */
const controlPlane = process.env.BF_CONTROL_PLANE ?? 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    open: false,
    proxy: {
      '/api': {
        target: controlPlane,
        changeOrigin: false,
        // The control plane rejects cross-origin writes; the dev proxy is
        // same-origin from the browser's point of view, so forward the original
        // host and let the CSRF check see a matching Origin.
        headers: {},
      },
      '/nexona': { target: controlPlane, changeOrigin: false },
      '/assets': { target: controlPlane, changeOrigin: false },
    },
    // Never watch test-run artifacts (headless-Chrome profile, logs,
    // screenshots, smoke output) - a locked file here crashes the watcher.
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
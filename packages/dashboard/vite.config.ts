import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// The dashboard is a static SPA; `VITE_GATEWAY_URL` / `VITE_XRPL_NETWORK` are
// read at runtime from import.meta.env (see src/config.ts).
// `xrpl` / `xrpl-connect` expect Node globals (Buffer/global/process) in the
// browser bundle — the polyfill plugin provides them.
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({ globals: { Buffer: true, global: true } }),
  ],
  server: {
    port: 5173,
  },
});

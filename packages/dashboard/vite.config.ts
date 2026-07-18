import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// Hosts the preview server answers to. Vite rejects unknown Host headers to
// block DNS-rebinding, which would reject the platform domain when `vite
// preview` serves the built SPA. Railway sets RAILWAY_PUBLIC_DOMAIN; any extra
// (custom) domains go in PREVIEW_ALLOWED_HOSTS as a comma-separated list.
const previewAllowedHosts = [
  process.env.RAILWAY_PUBLIC_DOMAIN,
  ...(process.env.PREVIEW_ALLOWED_HOSTS ?? '').split(','),
]
  .map((host) => host?.trim())
  .filter((host): host is string => Boolean(host));

// The dashboard is a static SPA; `VITE_GATEWAY_URL` / `VITE_XRPL_NETWORK` are
// read at runtime from import.meta.env (see src/config.ts).
// `xrpl` / `xrpl-connect` expect Node globals (Buffer/global/process) in the
// browser bundle — the polyfill plugin provides them.
export default defineConfig({
  plugins: [react(), nodePolyfills({ globals: { Buffer: true, global: true } })],
  server: {
    port: 5173,
  },
  preview: {
    allowedHosts: previewAllowedHosts,
  },
});

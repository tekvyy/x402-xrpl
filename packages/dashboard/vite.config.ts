import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dashboard is a static SPA; `VITE_GATEWAY_URL` / `VITE_XRPL_NETWORK` are
// read at runtime from import.meta.env (see src/config.ts).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});

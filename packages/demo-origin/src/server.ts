/**
 * Demo origin process entrypoint. Listens on its own port (default 8403,
 * override with `DEMO_ORIGIN_PORT`).
 */
import { buildOrigin } from './index.js';

const port = Number(process.env.DEMO_ORIGIN_PORT ?? 8403);

buildOrigin()
  .listen({ port, host: '0.0.0.0' })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

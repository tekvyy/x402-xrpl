/**
 * Express adapter for the `x402` middleware. Drop it in front of any route to
 * charge per call:
 *
 *   import express from 'express';
 *   import { x402Express } from '@app/sdk-server';
 *
 *   const app = express();
 *   app.get(
 *     '/premium',
 *     x402Express({ gatewayUrl: 'http://localhost:8402', sellerId }),
 *     (_req, res) => res.json({ secret: 42 }),
 *   );
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { X402Header } from '@app/shared';
import { decide, PAYMENT_RESPONSE_HEADER } from './core.js';
import type { X402MiddlewareOptions } from './types.js';

/** Build an Express middleware that meters the route behind it via x402. */
export function x402Express(options: X402MiddlewareOptions): RequestHandler {
  return function x402Handler(req: Request, res: Response, next: NextFunction): void {
    const header = req.header(X402Header.X_PAYMENT) ?? undefined;

    decide(options, req.path, header)
      .then((decision) => {
        if (decision.kind === 'proceed') {
          res.setHeader(PAYMENT_RESPONSE_HEADER, decision.paymentResponseHeader);
          next();
          return;
        }
        if (decision.paymentResponseHeader) {
          res.setHeader(PAYMENT_RESPONSE_HEADER, decision.paymentResponseHeader);
        }
        res.status(decision.status).json(decision.body);
      })
      .catch(next);
  };
}

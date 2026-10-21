import type { Request, Response, NextFunction, RequestHandler } from "express";
import { logger } from "../utils/logger";

/**
 * Error with an attached HTTP status code. Throw this from routes/services to
 * control the response status; anything else becomes a 500.
 */
export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * Wraps an async route handler so rejected promises are forwarded to Express's
 * error pipeline instead of becoming unhandled rejections.
 *
 *   router.get("/", asyncHandler(async (req, res) => { ... }));
 */
export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/** 404 handler for unmatched API routes (mount after all API routers). */
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
}

/**
 * Centralized Express error handler. Logs the error with request context and
 * returns a sanitized JSON body — internal messages are hidden in production.
 */
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const status = err?.status || err?.statusCode || 500;
  const message =
    status >= 500 && process.env.NODE_ENV === "production"
      ? "Internal Server Error"
      : err?.message || "Internal Server Error";

  logger.error(
    {
      err,
      method: req.method,
      path: req.path,
      status,
    },
    "Request failed"
  );

  if (res.headersSent) {
    return;
  }

  res.status(status).json({ error: message });
}

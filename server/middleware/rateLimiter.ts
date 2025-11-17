import type { Request, Response, NextFunction } from "express";

// Simple in-memory rate limiter
// For production, consider using Redis-based rate limiting
interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

interface RateLimitOptions {
  windowMs: number; // Time window in milliseconds
  max: number; // Maximum number of requests
  message?: string;
  keyGenerator?: (req: Request) => string;
}

/**
 * Rate limiting middleware
 * Prevents brute force attacks and API abuse
 */
export function rateLimiter(options: RateLimitOptions) {
  const {
    windowMs,
    max,
    message = "Too many requests, please try again later",
    keyGenerator = (req) => {
      // Default: use IP address + route path
      return `${req.ip || req.socket.remoteAddress || "unknown"}:${req.path}`;
    },
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyGenerator(req);
    const now = Date.now();

    // Clean up expired entries (simple garbage collection)
    if (Object.keys(store).length > 1000) {
      Object.keys(store).forEach((k) => {
        if (store[k].resetTime < now) {
          delete store[k];
        }
      });
    }

    // Get or create rate limit entry
    let entry = store[key];
    if (!entry || entry.resetTime < now) {
      // Create new entry or reset expired one
      entry = {
        count: 0,
        resetTime: now + windowMs,
      };
      store[key] = entry;
    }

    entry.count += 1;

    // Set rate limit headers
    res.setHeader("X-RateLimit-Limit", max.toString());
    res.setHeader("X-RateLimit-Remaining", Math.max(0, max - entry.count).toString());
    res.setHeader(
      "X-RateLimit-Reset",
      new Date(entry.resetTime).toISOString()
    );

    // Check if limit exceeded
    if (entry.count > max) {
      return res.status(429).json({
        error: message,
        retryAfter: Math.ceil((entry.resetTime - now) / 1000),
      });
    }

    next();
  };
}

/**
 * Rate limiter for authentication endpoints
 * Stricter limits to prevent brute force attacks
 */
export const authRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  message: "Too many authentication attempts. Please try again later.",
  keyGenerator: (req) => {
    // Rate limit by IP only for auth endpoints
    return `auth:${req.ip || req.socket.remoteAddress || "unknown"}`;
  },
});

/**
 * Rate limiter for general API endpoints
 */
export const apiRateLimiter = rateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: "Too many API requests. Please slow down.",
});

/**
 * Rate limiter for username checks (can be expensive)
 */
export const usernameCheckRateLimiter = rateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 checks per minute
  message: "Too many username checks. Please slow down.",
});


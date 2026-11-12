import "dotenv/config";
import express from "express";
import { registerRoutes } from "./routes";
import { serveStatic, log } from "./static";
import { connectToMongoDB, testMongoConnection } from "./database/mongodb";
import { startCronJobs } from "./services/cron";
import { logger } from "./utils/logger";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

const app = express();

// Start background jobs
startCronJobs();

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

const isProduction = process.env.NODE_ENV === "production";

/**
 * Content-Security-Policy, built from the origins this client actually loads.
 *
 * Anything listed here should be a host the app really talks to, not a
 * precaution: every extra source is one more place an injected script would
 * be allowed to send data. The awkward entries are explained where they sit.
 */
const cspDirectives: Record<string, string[]> = {
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  // The modern spelling of the `X-Frame-Options: DENY` set below. Both go out,
  // because the older header is still what some scanners look for.
  "frame-ancestors": ["'none'"],
  "form-action": ["'self'"],
  // `wasm-unsafe-eval`, not `unsafe-eval`: face-api.js runs on TensorFlow.js,
  // which compiles a WebAssembly module when it cannot get a WebGL context.
  // apis.google.com is pulled in by Firebase's Google sign-in.
  "script-src": ["'self'", "'wasm-unsafe-eval'", "https://apis.google.com"],
  // Radix and framer-motion both animate by writing to the `style` attribute,
  // so inline styles cannot be refused without rewriting the component layer.
  // Scripts stay locked down, which is the half that carries the risk.
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
  // blob: is the camera preview and anything drawn to a canvas;
  // lh3.googleusercontent.com is the avatar Google hands back after sign-in.
  "img-src": [
    "'self'",
    "data:",
    "blob:",
    "https://res.cloudinary.com",
    "https://lh3.googleusercontent.com",
  ],
  "media-src": ["'self'", "blob:"],
  "worker-src": ["'self'", "blob:"],
  "connect-src": [
    "'self'",
    "https://justadudewhohacks.github.io", // face-api.js model weights
    // The only two Google hosts the built bundle actually names. A wildcard
    // over *.googleapis.com would also hand an injected script Drive, Gmail
    // and every other Google API as a place to send what it scrapes.
    "https://identitytoolkit.googleapis.com", // Firebase Auth
    "https://securetoken.googleapis.com", // Firebase ID token refresh
    "https://*.firebaseio.com",
    "wss://*.firebaseio.com",
    "https://res.cloudinary.com",
  ],
  // Firebase Auth keeps a hidden iframe on its own auth domain, and the
  // Google sign-in popup runs on accounts.google.com.
  "frame-src": ["'self'", "https://*.firebaseapp.com", "https://accounts.google.com"],
};

if (isProduction) {
  cspDirectives["upgrade-insecure-requests"] = [];
} else {
  // Vite's dev server injects its client inline and talks back over a
  // websocket. Neither of those exists in a built bundle, so the production
  // policy above stays strict.
  cspDirectives["script-src"].push("'unsafe-inline'", "'unsafe-eval'");
  cspDirectives["connect-src"].push("ws:", "http://localhost:*");
}

const contentSecurityPolicy = Object.entries(cspDirectives)
  .map(([directive, sources]) => (sources.length ? `${directive} ${sources.join(" ")}` : directive))
  .join("; ");

// Security headers middleware
app.use((req, res, next) => {
  // CORS configuration
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",")
    : process.env.NODE_ENV === "production"
      ? []
      : ["http://localhost:3000"];

  const origin = req.headers.origin;
  if (origin && (allowedOrigins.includes(origin) || process.env.NODE_ENV !== "production")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", contentSecurityPolicy);

  // HSTS only on a request that actually arrived encrypted. Render terminates
  // TLS in front of this process, so `req.secure` is false here and
  // `x-forwarded-proto` is the only honest signal. Sending it over plain HTTP
  // means nothing, and sending it from localhost would pin the browser to
  // HTTPS for every other project ever served from that port.
  if (isProduction && req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  // Return JSON 404 for unmatched API routes (before the Vite/static catch-all).
  app.use("/api", notFoundHandler);

  // Centralized error handler — logs with request context and sanitizes output.
  app.use(errorHandler);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 3000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "3000", 10);
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    log(`Open http://0.0.0.0:${port} to view the app`);
  });

  // Test MongoDB connection on startup (non-blocking)
  connectToMongoDB()
    .then(() => testMongoConnection())
    .catch((error) => {
      logger.warn(
        { err: error },
        "MongoDB connection failed, continuing in frontend-only mode (data features disabled)"
      );
    });
})();

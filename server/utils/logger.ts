import pino, { type Logger as PinoLogger } from "pino";

/**
 * Centralized application logger (pino).
 *
 * - In development it pretty-prints with colors via `pino-pretty`.
 * - In production it emits structured JSON (one object per line) which is
 *   easy for log aggregators to parse.
 *
 * The exported `logger` wraps pino with a console-compatible, variadic API
 * (`logger.info("msg", obj, ...)`) so existing call sites keep working while
 * objects and `Error`s are still captured as structured fields instead of
 * being swallowed by pino's `(mergingObject, message)` signature.
 */

const isProduction = process.env.NODE_ENV === "production";
const level = process.env.LOG_LEVEL || (isProduction ? "info" : "debug");

const base: PinoLogger = pino({
  level,
  // Pretty transport only in non-production to keep prod logs as pure JSON.
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }),
});

type Level = "debug" | "info" | "warn" | "error";

/** Split console-style args into a structured merge object + a message string. */
function splitArgs(args: unknown[]): [Record<string, unknown> | undefined, string] {
  const parts: string[] = [];
  let merged: Record<string, unknown> | undefined;

  for (const arg of args) {
    if (arg instanceof Error) {
      merged = { ...(merged ?? {}), err: arg };
    } else if (arg !== null && typeof arg === "object") {
      merged = { ...(merged ?? {}), ...(arg as Record<string, unknown>) };
    } else {
      parts.push(String(arg));
    }
  }

  return [merged, parts.join(" ")];
}

function wrap(levelName: Level) {
  return (...args: unknown[]): void => {
    const [merged, message] = splitArgs(args);
    if (merged) {
      base[levelName](merged, message);
    } else {
      base[levelName](message);
    }
  };
}

export const logger = {
  debug: wrap("debug"),
  info: wrap("info"),
  warn: wrap("warn"),
  error: wrap("error"),
  /** Direct access to the underlying pino instance when child loggers are needed. */
  raw: base,
};

export type AppLogger = typeof logger;

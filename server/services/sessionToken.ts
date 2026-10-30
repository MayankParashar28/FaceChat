/**
 * Session tokens for email/password accounts.
 *
 * Those accounts have no Firebase credential, so the client used to send the
 * account's own `firebaseUid` as its bearer token and the middleware looked a
 * user up by it. That made every user id a password — and ids are not secret:
 * they travel in conversation participants, search results and message
 * payloads, so any signed-in person could authenticate as anyone whose id they
 * had seen. These tokens replace that with something the holder cannot forge.
 *
 * Deliberately built on node's crypto rather than a JWT library: the payload is
 * two fields and an expiry, and the project does not need another dependency.
 *
 * Format: v1.<base64url payload>.<base64url HMAC-SHA256 of the payload>
 */

import crypto from "crypto";
import mongoose from "mongoose";
import { logger } from "../utils/logger";

const TOKEN_VERSION = "v1";
/** Long enough that a chat app does not sign people out while they use it. */
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SECRET_COLLECTION = "serversecrets";
const SECRET_ID = "session-signing-key";

let cachedSecret: Buffer | null = null;

/**
 * SESSION_SECRET if it is set, otherwise a key generated once and kept in
 * MongoDB.
 *
 * An environment variable is the better home for this, and setting one takes
 * precedence with no code change. The database fallback exists because the
 * alternative — a key held only in memory — would sign every user out each
 * time the process restarts, and on a free dyno that is constantly.
 */
async function signingSecret(): Promise<Buffer> {
  if (cachedSecret) return cachedSecret;

  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) {
    cachedSecret = Buffer.from(fromEnv, "utf8");
    return cachedSecret;
  }

  const db = mongoose.connection.db;
  if (!db) throw new Error("Cannot resolve a session signing key before MongoDB is connected");

  const collection = db.collection<{ _id: string; secret: string; createdAt: Date }>(
    SECRET_COLLECTION
  );
  // $setOnInsert so two workers starting at once settle on one key rather than
  // each overwriting the other's and invalidating live sessions.
  await collection.updateOne(
    { _id: SECRET_ID },
    { $setOnInsert: { secret: crypto.randomBytes(48).toString("hex"), createdAt: new Date() } },
    { upsert: true }
  );
  const stored = await collection.findOne({ _id: SECRET_ID });
  if (!stored?.secret) throw new Error("Could not store a session signing key");

  if (!fromEnv) {
    logger.info("Session signing key loaded from the database (set SESSION_SECRET to override)");
  }
  cachedSecret = Buffer.from(stored.secret, "hex");
  return cachedSecret;
}

export interface SessionClaims {
  /** The user's MongoDB id. */
  sub: string;
  /** The identifier the rest of the app treats as `uid`. */
  uid: string;
  /**
   * This token's own id, so one session can be signed out by name without
   * touching the others. See models/revokedSession.
   */
  jti: string;
  /** The account's `tokenVersion` when this was minted. */
  ver: number;
  /** When it expires, so a revocation row can be cleaned up alongside it. */
  exp: number;
}

type TokenPayload = SessionClaims & {
  iat: number;
};

const b64url = (buf: Buffer) => buf.toString("base64url");

async function sign(payloadPart: string): Promise<string> {
  const secret = await signingSecret();
  return b64url(crypto.createHmac("sha256", secret).update(payloadPart).digest());
}

export async function issueSessionToken(
  claims: Omit<SessionClaims, "jti" | "exp"> & { jti?: string }
): Promise<string> {
  const now = Date.now();
  const payload: TokenPayload = {
    sub: claims.sub,
    uid: claims.uid,
    // Unguessable, so knowing a token's id is not a way to revoke someone.
    jti: claims.jti || crypto.randomBytes(16).toString("hex"),
    ver: claims.ver ?? 0,
    iat: now,
    exp: now + TOKEN_TTL_MS,
  };
  const payloadPart = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${TOKEN_VERSION}.${payloadPart}.${await sign(payloadPart)}`;
}

/** Cheap shape test, so the middleware knows which verifier to reach for. */
export function looksLikeSessionToken(token: string): boolean {
  return token.startsWith(`${TOKEN_VERSION}.`) && token.split(".").length === 3;
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const [version, payloadPart, signature] = token.split(".");
    if (version !== TOKEN_VERSION || !payloadPart || !signature) return null;

    const expected = Buffer.from(await sign(payloadPart), "utf8");
    const provided = Buffer.from(signature, "utf8");
    // Compare in constant time, and only when the lengths already match —
    // timingSafeEqual throws on a length mismatch.
    if (expected.length !== provided.length) return null;
    if (!crypto.timingSafeEqual(expected, provided)) return null;

    const payload = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf8")
    ) as TokenPayload;

    if (typeof payload.sub !== "string" || typeof payload.uid !== "string") return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    // Tokens minted before revocation existed carry neither field. They are
    // still validly signed, so treat them as version 0 and give them an id
    // derived from nothing — they simply cannot be revoked individually, and
    // they age out within the thirty-day window.
    const jti = typeof payload.jti === "string" ? payload.jti : "";
    const ver = typeof payload.ver === "number" ? payload.ver : 0;

    return { sub: payload.sub, uid: payload.uid, jti, ver, exp: payload.exp };
  } catch {
    // A malformed token is simply not a credential.
    return null;
  }
}

import { logger } from "../utils/logger";
import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { verifyFirebaseToken } from "../firebase/admin";
import { mongoService } from "../services/mongodb";

// Extend Express Request to include user info
declare global {
  namespace Express {
    interface Request {
      user?: {
        uid: string;
        email: string | null;
        name: string | null;
        emailVerified: boolean;
        dbUser?: any; // MongoDB user document
      };
    }
  }
}

/**
 * Authentication middleware that verifies Firebase ID token
 * and attaches user information to the request object
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    // Get token from Authorization header or firebaseToken in body
    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    } else if (req.body?.firebaseToken) {
      token = req.body.firebaseToken;
    } else if (req.query?.firebaseToken) {
      token = req.query.firebaseToken as string;
    }

    if (!token || token === "null" || token === "undefined") {
      return res.status(401).json({ error: "Authentication required" });
    }

    let uid = token;
    let email: string | null = null;
    let name: string | null = null;
    let emailVerified = true;
    let dbUser: any = null;

    // 1. An existing account, looked up by the identifier the client holds.
    //    Email/password signups get a generated `user_<ts>_<rand>` firebaseUid
    //    (see routes/auth.ts), so they resolve here; the id forms cover clients
    //    that kept a MongoDB id instead.
    try {
      dbUser = await mongoService.getUserByFirebaseUid(token);
      if (!dbUser && mongoose.Types.ObjectId.isValid(token)) {
        dbUser = await mongoService.getUserById(token);
      }
      if (!dbUser && token.startsWith("user_")) {
        const candidate = token.slice("user_".length);
        if (mongoose.Types.ObjectId.isValid(candidate)) {
          dbUser = await mongoService.getUserById(candidate);
        }
      }
    } catch (err) {
      logger.error("Error looking up user during authentication:", err);
    }

    if (dbUser) {
      uid = dbUser.firebaseUid || dbUser._id.toString();
      email = dbUser.email;
      name = dbUser.name;
      emailVerified = dbUser.isEmailVerified ?? true;
    } else {
      // 2. A Firebase ID token. Its uid may not have a MongoDB row yet — that
      //    is normal right after sign-up, and routes handle a missing dbUser.
      try {
        const decodedToken = await verifyFirebaseToken(token);
        uid = decodedToken.uid;
        email = decodedToken.email || null;
        name = decodedToken.name || null;
        emailVerified = decodedToken.emailVerified ?? false;

        dbUser = await mongoService.getUserByFirebaseUid(uid);
      } catch (err) {
        // Anything else is simply not a valid credential.
        //
        // This used to fall through to creating an account from whatever
        // string arrived, so any value in the Authorization header became a
        // real, usable identity — unauthenticated requests were silently
        // promoted to authenticated ones under a brand new user.
        logger.warn("Rejected an unrecognised authentication token");
        return res.status(401).json({ error: "Invalid or expired credentials" });
      }
    }

    // Attach user info to request
    req.user = {
      uid,
      email,
      name,
      emailVerified,
      dbUser: dbUser || undefined,
    };

    next();
  } catch (error: any) {
    // Previously this called next() without a user, so an internal failure
    // looked like an anonymous request rather than an error.
    logger.error("Authentication error:", error);
    res.status(500).json({ error: "Authentication failed" });
  }
}

/**
 * Optional authentication - doesn't fail if no token is provided
 * Useful for routes that work with or without auth
 */
export async function optionalAuthenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    } else if (req.body?.firebaseToken) {
      token = req.body.firebaseToken;
    } else if (req.query?.firebaseToken) {
      token = req.query.firebaseToken as string;
    }

    if (token) {
      try {
        const decodedToken = await verifyFirebaseToken(token);
        req.user = {
          uid: decodedToken.uid,
          email: decodedToken.email || null,
          name: decodedToken.name || null,
          emailVerified: decodedToken.emailVerified ?? false,
        };

        try {
          const dbUser = await mongoService.getUserByFirebaseUid(decodedToken.uid);
          if (dbUser && req.user) {
            req.user.dbUser = dbUser;
          }
        } catch (error) {
          // Ignore MongoDB lookup errors
        }
      } catch (error) {
        // Invalid token, but continue without auth
        logger.info("Optional auth: Invalid token provided, continuing without auth");
      }
    }

    next();
  } catch (error) {
    // On any error, continue without auth
    next();
  }
}

/**
 * Authorization middleware - ensures user owns the resource
 * Must be used after authenticate middleware
 */
export function requireOwnership(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  // Check if userId in params/query matches authenticated user
  const requestedUserId = req.params.userId || req.query.userId;

  if (requestedUserId && requestedUserId !== req.user.uid) {
    // Also check if it's a MongoDB ID and matches the user
    if (req.user.dbUser && requestedUserId !== req.user.dbUser._id.toString()) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (!req.user.dbUser) {
      return res.status(403).json({ error: "Access denied" });
    }
  }

  next();
}

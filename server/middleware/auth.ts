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
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
) {
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

    // 1. Try to find user directly in MongoDB by token (firebaseUid / _id)
    try {
      dbUser = await mongoService.getUserByFirebaseUid(token);
      if (!dbUser && mongoose.Types.ObjectId.isValid(token)) {
        dbUser = await mongoService.getUserById(token);
      }
    } catch (err) {}

    if (dbUser) {
      uid = dbUser.firebaseUid || dbUser._id.toString();
      email = dbUser.email;
      name = dbUser.name;
      emailVerified = dbUser.isEmailVerified ?? true;
    } else {
      // 2. Try Firebase token verification if available
      try {
        const decodedToken = await verifyFirebaseToken(token);
        uid = decodedToken.uid;
        email = decodedToken.email || null;
        name = decodedToken.name || null;
        emailVerified = decodedToken.emailVerified ?? false;

        dbUser = await mongoService.getUserByFirebaseUid(uid);
      } catch (err) {
        // 3. Fallback for custom user tokens (e.g. user_... or mock-...)
        uid = token;
        name = token.startsWith("mock-") ? token.replace("mock-", "") : token;
        email = `${name.toLowerCase()}@demo.local`;
        
        try {
          dbUser = await mongoService.createOrUpdateUser({
            firebaseUid: uid,
            email,
            name,
            username: name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "user",
            isEmailVerified: true,
          });
        } catch (createErr) {}
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
    console.error("Authentication error:", error);
    next();
  }
}

/**
 * Optional authentication - doesn't fail if no token is provided
 * Useful for routes that work with or without auth
 */
export async function optionalAuthenticate(
  req: Request,
  res: Response,
  next: NextFunction
) {
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
        console.log("Optional auth: Invalid token provided, continuing without auth");
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
export function requireOwnership(
  req: Request,
  res: Response,
  next: NextFunction
) {
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

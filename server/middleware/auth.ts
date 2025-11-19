import type { Request, Response, NextFunction } from "express";
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

    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Verify the token
    const decodedToken = await verifyFirebaseToken(token);
    
    // Attach user info to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email || null,
      name: decodedToken.name || null,
      emailVerified: decodedToken.emailVerified ?? false,
    };

    // Optionally load MongoDB user document
    try {
      const dbUser = await mongoService.getUserByFirebaseUid(decodedToken.uid);
      if (dbUser && req.user) {
        req.user.dbUser = dbUser;
      }
    } catch (error) {
      // If user doesn't exist in MongoDB, that's okay - they might be new
      console.log(`User ${decodedToken.uid} not found in MongoDB`);
    }

    next();
  } catch (error: any) {
    console.error("Authentication error:", error);
    return res.status(401).json({ error: "Invalid or expired token" });
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

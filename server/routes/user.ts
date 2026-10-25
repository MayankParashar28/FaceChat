import { logger } from "../utils/logger";
import { Router } from "express";
import mongoose from "mongoose";
import { authenticate } from "../middleware/auth";
import { apiRateLimiter, usernameCheckRateLimiter } from "../middleware/rateLimiter";
import { mongoService } from "../services/mongodb";

const router = Router();

// Rate limit user creation/update (use apiRateLimiter for sync, authRateLimiter is too strict)
router.post("/", apiRateLimiter, authenticate, async (req, res) => {
  try {
    logger.info("=== USER CREATION START ===");
    const { firebaseToken, password, ...userData } = req.body;
    logger.info("User data received:", {
      ...userData,
      firebaseToken: firebaseToken ? "present" : "missing",
      password: password ? "***" : undefined,
    });

    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    logger.info("Decoded token:", {
      uid: req.user.uid,
      email: req.user.email,
      name: req.user.name,
    });

    // Ensure we have all required fields with fallbacks
    const name = userData.name && userData.name.trim() ? userData.name : req.user.name || "User";
    const email = userData.email || req.user.email || "";
    const username =
      userData.username && userData.username.trim()
        ? userData.username
        : email.split("@")[0] || "user";

    logger.info("Final user data:", { name, email, username, hasPassword: !!password });

    const user = await mongoService.createOrUpdateUser({
      firebaseUid: req.user.uid,
      email: email,
      name: name,
      username: username,
      password: password, // Will be hashed in service
      avatar: userData.avatar,
      isEmailVerified: false, // Start as unverified, require OTP verification
    });

    // Remove password from response
    const userResponse = user.toObject();
    delete userResponse.password;

    logger.info("User created/updated in MongoDB:", {
      _id: user._id,
      username: user.username,
      email: user.email,
      name: user.name,
    });
    res.json(userResponse);
  } catch (error: any) {
    logger.error("Error creating user:", error);
    res.status(500).json({ error: error.message || "Failed to create user" });
  }
});

// Search users by username (must be before /:id route)
router.get("/search", apiRateLimiter, authenticate, async (req, res) => {
  try {
    const { q, limit } = req.query as { q?: string; limit?: string };
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: "Query 'q' must be at least 2 characters" });
    }

    const max = Math.max(1, Math.min(25, Number(limit) || 10));
    const users = await mongoService.searchUsersByUsername(q.trim(), max);

    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const requesterUid = req.user.uid;
    const requester = req.user.dbUser || (await mongoService.getUserByFirebaseUid(requesterUid));

    // Import models dynamically if needed or rely on existing imports (need to add to top of file if not present)
    // Assuming Connection and Discovery are exported from ../models
    const { Connection, Discovery } = await import("../models");

    const result = await Promise.all(
      users.map(async (u) => {
        let status: "connected" | "discovered" | "none" = "none";

        if (requester) {
          // Check for active connection
          const connection = await Connection.findOne({
            participants: { $all: [requester._id, u._id] },
            status: "active",
          });

          if (connection) {
            status = "connected";
          } else {
            // Check if *requester* has discovered *target*
            const discovery = await Discovery.findOne({
              viewerId: requester._id,
              targetId: u._id,
            });
            if (discovery) {
              status = "discovered";
            }
          }
        }

        return {
          id: u._id.toString(),
          name: u.name,
          username: u.username,
          email: u.email,
          avatar: (u as any).avatar ?? null,
          connectionStatus: status,
        };
      })
    );

    res.json(result);
  } catch (error) {
    logger.error("Error searching users:", error);
    res.status(500).json({ error: "Failed to search users" });
  }
});

// Get current user's profile - MUST be before /:id to avoid route conflict
router.get("/me", authenticate, async (req, res) => {
  try {
    logger.info("[GET /api/users/me] Request received");

    if (!req.user) {
      logger.error("[GET /api/users/me] No user in request");
      return res.status(401).json({ error: "Authentication required" });
    }

    logger.info("[GET /api/users/me] User UID:", req.user.uid);

    // Check MongoDB connection
    if (mongoose.connection.readyState !== 1) {
      logger.error(
        "[GET /api/users/me] MongoDB not connected. ReadyState:",
        mongoose.connection.readyState
      );
      return res.status(503).json({
        error: "Database connection unavailable. Please try again later.",
        details: "MongoDB is not connected",
      });
    }

    // Try to get user from req.user.dbUser first (already loaded by auth middleware)
    let dbUser = req.user.dbUser;

    // If not in req.user.dbUser, fetch from MongoDB
    if (!dbUser) {
      logger.info("[GET /api/users/me] User not in req.user.dbUser, fetching from MongoDB...");
      try {
        dbUser = await mongoService.getUserByFirebaseUid(req.user.uid);
        logger.info(
          "[GET /api/users/me] User fetch result:",
          dbUser ? `Found: ${dbUser._id}` : "Not found"
        );
      } catch (fetchError: any) {
        logger.error("[GET /api/users/me] Error fetching user:", fetchError);
        throw new Error(`Failed to fetch user from database: ${fetchError.message}`);
      }
    }

    // If user doesn't exist, create them
    if (!dbUser) {
      logger.info("[GET /api/users/me] User does not exist, creating new user...");

      // Generate username from email
      let baseUsername = (req.user.email?.split("@")[0] || "user")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "");
      if (baseUsername.length < 3) {
        baseUsername = baseUsername + "123";
      }

      // Ensure username is unique
      let username = baseUsername;
      let attempts = 0;
      while (attempts < 10) {
        try {
          const isTaken = await mongoService.isUsernameTaken(username);
          if (!isTaken) break;
          username = `${baseUsername}${Math.floor(Math.random() * 1000)}`;
          attempts++;
        } catch (e) {
          break; // If check fails, use the username anyway
        }
      }

      try {
        dbUser = await mongoService.createOrUpdateUser({
          firebaseUid: req.user.uid,
          email: req.user.email || "",
          name: req.user.name || req.user.email?.split("@")[0] || "User",
          username: username,
          isEmailVerified: req.user.emailVerified || false,
        });
        logger.info("[GET /api/users/me] User created successfully:", dbUser._id);
      } catch (createError: any) {
        logger.error("[GET /api/users/me] Error creating user:", createError);

        // If duplicate key, try to fetch existing user
        if (createError.code === 11000) {
          logger.info("[GET /api/users/me] Duplicate key, fetching existing user...");
          dbUser = await mongoService.getUserByFirebaseUid(req.user.uid);
          if (!dbUser && req.user.email) {
            const User = (await import("../models")).User;
            dbUser = await User.findOne({ email: req.user.email.toLowerCase() });
          }
        }

        if (!dbUser) {
          throw createError;
        }
      }
    }

    if (!dbUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Picked field by field rather than returned wholesale: `password` is
    // `select: false` but a lean/aggregate path could still carry it, and the
    // client has no business with firebase internals beyond the uid.
    //
    // The nested objects matter as much as the flat ones. They were missing
    // here, which meant anything saved into them — the Settings page writes
    // preferences.call — was stored correctly and then never read back, so
    // every reload silently reverted to defaults.
    const userResponse: any = {
      _id: dbUser._id.toString(),
      firebaseUid: dbUser.firebaseUid,
      email: dbUser.email,
      name: dbUser.name,
      username: dbUser.username,
      avatar: dbUser.avatar,
      phone: dbUser.phone,
      bio: dbUser.bio,
      dateOfBirth: dbUser.dateOfBirth,
      location: dbUser.location,
      website: dbUser.website,
      isEmailVerified: dbUser.isEmailVerified,
      isPhoneVerified: (dbUser as any).isPhoneVerified ?? false,
      professional: dbUser.professional ?? null,
      socials: dbUser.socials ?? null,
      preferences: dbUser.preferences ?? null,
      onboarding: dbUser.onboarding ?? null,
      lastLogin: dbUser.lastLogin ?? null,
      createdAt: dbUser.createdAt,
      updatedAt: dbUser.updatedAt,
    };

    logger.info("[GET /api/users/me] Successfully returning user:", userResponse._id);
    res.json(userResponse);
  } catch (error: any) {
    logger.error("[GET /api/users/me] ERROR:", error);
    logger.error("[GET /api/users/me] Error message:", error?.message);
    logger.error("[GET /api/users/me] Error stack:", error?.stack?.split("\n").slice(0, 5));

    res.status(500).json({
      error: error?.message || "Failed to fetch user profile",
      details:
        process.env.NODE_ENV === "development"
          ? {
              message: error?.message,
              code: error?.code,
              name: error?.name,
            }
          : undefined,
    });
  }
});

/**
 * The three numbers on the profile header.
 *
 * Counted in the database rather than derived on the client. The page used to
 * download every meeting the user had ever been in — participants populated —
 * and infer the figures from it: "friends" meant anyone who had shared a call,
 * and "groups" meant a call with three or more people. Both already exist as
 * real records (an accepted Connection, a Conversation with isGroup), so the
 * guesses were both wrong and expensive.
 */
router.get("/me/stats", authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const dbUser = req.user.dbUser || (await mongoService.getUserByFirebaseUid(req.user.uid));
    if (!dbUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const { Connection, Conversation, Meeting } = await import("../models");
    const userId = dbUser._id;

    const [friends, groups, meetingsHosted] = await Promise.all([
      Connection.countDocuments({ participants: userId, status: "active" }),
      Conversation.countDocuments({ participants: userId, isGroup: true, isDeleted: false }),
      Meeting.countDocuments({ hostId: userId }),
    ]);

    res.json({ friends, groups, meetingsHosted });
  } catch (error) {
    logger.error("Error fetching profile stats:", error);
    res.status(500).json({ error: "Failed to fetch profile stats" });
  }
});

/** Fields a user is allowed to change about themselves through PUT /me. */
const EDITABLE_USER_FIELDS = [
  "name",
  "username",
  "avatar",
  "phone",
  "bio",
  "dateOfBirth",
  "location",
  "website",
] as const;

/**
 * Nested objects that merge key by key instead of replacing the whole object.
 *
 * The Settings page sends only `preferences.call`; the profile editor sends only
 * the socials it knows about. Assigning the object wholesale would drop every
 * sibling key the sender happened not to include, so each leaf is written as its
 * own dotted path.
 */
const MERGEABLE_USER_FIELDS = ["professional", "socials", "preferences", "onboarding"] as const;

/** Keys are spliced into update paths, so anything exotic is refused outright. */
const SAFE_KEY = /^[a-zA-Z0-9_]+$/;

function flattenPaths(value: Record<string, unknown>, prefix: string): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const key of Object.keys(value)) {
    if (!SAFE_KEY.test(key)) continue;
    const path = `${prefix}.${key}`;
    const child = value[key];
    if (child && typeof child === "object" && !Array.isArray(child) && !(child instanceof Date)) {
      out.push(...flattenPaths(child as Record<string, unknown>, path));
    } else {
      out.push([path, child]);
    }
  }
  return out;
}

function buildUserUpdate(body: unknown): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  if (!body || typeof body !== "object") return update;
  const source = body as Record<string, unknown>;

  for (const field of EDITABLE_USER_FIELDS) {
    if (field in source) update[field] = source[field];
  }

  for (const field of MERGEABLE_USER_FIELDS) {
    const value = source[field];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const [path, leaf] of flattenPaths(value as Record<string, unknown>, field)) {
      update[path] = leaf;
    }
  }

  return update;
}

// Update current user's profile
router.put("/me", authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const dbUser = req.user.dbUser || (await mongoService.getUserByFirebaseUid(req.user.uid));
    if (!dbUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Only the fields below are taken from the body. This used to spread
    // everything except password/firebaseUid/email straight into the update,
    // which let a caller set their own isEmailVerified / isPhoneVerified — the
    // flags the profile page renders a "Verified" badge from — and overwrite
    // lastLogin. Email and firebaseUid stay with Firebase Auth; passwords go
    // through the reset flow.
    const updateData = buildUserUpdate(req.body);

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No updatable fields were provided" });
    }

    // Validate username if being updated
    if (updateData.username && updateData.username !== dbUser.username) {
      const isTaken = await mongoService.isUsernameTaken(updateData.username as string);
      if (isTaken) {
        return res.status(400).json({ error: "Username is already taken" });
      }
    }

    const updatedUser = await mongoService.updateUser(dbUser._id.toString(), updateData as any);
    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Remove password from response
    const userResponse = updatedUser.toObject();
    delete userResponse.password;

    res.json(userResponse);
  } catch (error: any) {
    logger.error("Error updating user profile:", error);
    if (error.code === 11000) {
      // Duplicate key error (e.g., username already exists)
      return res.status(400).json({ error: "Username is already taken" });
    }
    res.status(500).json({ error: error.message || "Failed to update profile" });
  }
});

// Check if username is available (rate limited to prevent abuse)
// Public (rate-limited): username availability is needed on the signup form,
// before the user has an account/token.
router.get("/check-username/:username", usernameCheckRateLimiter, async (req, res) => {
  try {
    const { username } = req.params;

    if (!username || username.length < 3) {
      return res.status(400).json({ error: "Username must be at least 3 characters" });
    }

    const isTaken = await mongoService.isUsernameTaken(username);
    res.json({
      username,
      available: !isTaken,
      message: isTaken ? "Username is already taken" : "Username is available",
    });
  } catch (error) {
    logger.error("Error checking username:", error);
    res.status(500).json({ error: "Failed to check username" });
  }
});

// Get username suggestions — public (rate-limited); also used on the signup form.
router.get("/suggestions/:baseUsername", usernameCheckRateLimiter, async (req, res) => {
  try {
    const { baseUsername } = req.params;

    if (!baseUsername || baseUsername.length < 2) {
      return res.status(400).json({ error: "Base username must be at least 2 characters" });
    }

    const suggestions = await mongoService.generateUsernameSuggestions(baseUsername);
    res.json({ suggestions });
  } catch (error) {
    logger.error("Error generating username suggestions:", error);
    res.status(500).json({ error: "Failed to generate suggestions" });
  }
});

// Get user's meetings
router.get("/:userId/meetings", authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Users can only view their own meetings
    const dbUser = req.user.dbUser || (await mongoService.getUserByFirebaseUid(req.user.uid));
    if (!dbUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const requestedUserId = req.params.userId;

    // Check if requested user ID matches authenticated user
    // Allow if it's the Firebase UID or MongoDB ID
    if (requestedUserId !== req.user.uid && requestedUserId !== dbUser._id.toString()) {
      return res.status(403).json({ error: "Access denied" });
    }

    const meetings = await mongoService.getUserMeetings(dbUser._id.toString());
    res.json(meetings);
  } catch (error) {
    logger.error("Error fetching user meetings:", error);
    res.status(500).json({ error: "Failed to fetch meetings" });
  }
});

// Get user by ID - MUST be after /me to avoid route conflict
router.get("/:id", authenticate, async (req, res) => {
  try {
    // Prevent /me from matching this route
    if (req.params.id === "me") {
      logger.error(
        "[GET /api/users/:id] Route conflict detected! /api/users/me should be handled by /api/users/me route"
      );
      return res.status(500).json({ error: "Route configuration error. Please contact support." });
    }

    const user = await mongoService.getUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Anyone signed in can ask about anyone else, so this answers with the
    // profile its owner put on show and nothing else. It used to hand back the
    // whole document minus the password — email, phone, date of birth, the
    // Firebase uid and every saved preference included.
    const profile: any = user.toObject();
    res.json({
      id: profile._id.toString(),
      name: profile.name || "",
      username: profile.username || "",
      avatar: profile.avatar || null,
      bio: profile.bio || "",
      location: profile.location || "",
      website: profile.website || "",
      professional: profile.professional ?? null,
      socials: profile.socials ?? null,
      isVerified: !!profile.isVerified,
      createdAt: profile.createdAt ?? null,
    });
  } catch (error: any) {
    logger.error("[GET /api/users/:id] Error fetching user:", error);
    res.status(500).json({
      error: "Failed to fetch user",
      details: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export default router;

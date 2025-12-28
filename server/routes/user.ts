import { Router } from "express";
import mongoose from "mongoose";
import { authenticate } from "../middleware/auth";
import { apiRateLimiter, usernameCheckRateLimiter } from "../middleware/rateLimiter";
import { mongoService } from "../services/mongodb";

const router = Router();

// Rate limit user creation/update (use apiRateLimiter for sync, authRateLimiter is too strict)
router.post("/", apiRateLimiter, authenticate, async (req, res) => {
    try {
        console.log("=== USER CREATION START ===");
        const { firebaseToken, password, ...userData } = req.body;
        console.log("User data received:", { ...userData, firebaseToken: firebaseToken ? 'present' : 'missing', password: password ? '***' : undefined });

        if (!req.user) {
            return res.status(401).json({ error: "Authentication required" });
        }

        console.log("Decoded token:", { uid: req.user.uid, email: req.user.email, name: req.user.name });

        // Ensure we have all required fields with fallbacks
        const name = userData.name && userData.name.trim() ? userData.name : req.user.name || 'User';
        const email = userData.email || req.user.email || '';
        const username = userData.username && userData.username.trim() ? userData.username : (email.split('@')[0] || 'user');

        console.log("Final user data:", { name, email, username, hasPassword: !!password });

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

        console.log("User created/updated in MongoDB:", { _id: user._id, username: user.username, email: user.email, name: user.name });
        res.json(userResponse);
    } catch (error: any) {
        console.error("Error creating user:", error);
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
        const requester = req.user.dbUser || await mongoService.getUserByFirebaseUid(requesterUid);

        // Import models dynamically if needed or rely on existing imports (need to add to top of file if not present)
        // Assuming Connection and Discovery are exported from ../models
        const { Connection, Discovery } = await import("../models");

        const result = await Promise.all(users.map(async (u) => {
            let status: 'connected' | 'discovered' | 'none' = 'none';

            if (requester) {
                // Check for active connection
                const connection = await Connection.findOne({
                    participants: { $all: [requester._id, u._id] },
                    status: 'active'
                });

                if (connection) {
                    status = 'connected';
                } else {
                    // Check if *requester* has discovered *target*
                    const discovery = await Discovery.findOne({
                        viewerId: requester._id,
                        targetId: u._id
                    });
                    if (discovery) {
                        status = 'discovered';
                    }
                }
            }

            return {
                id: u._id.toString(),
                name: u.name,
                username: u.username,
                email: u.email,
                avatar: (u as any).avatar ?? null,
                connectionStatus: status
            };
        }));

        res.json(result);
    } catch (error) {
        console.error("Error searching users:", error);
        res.status(500).json({ error: "Failed to search users" });
    }
});

// Get current user's profile - MUST be before /:id to avoid route conflict
router.get("/me", authenticate, async (req, res) => {
    try {
        console.log("[GET /api/users/me] Request received");

        if (!req.user) {
            console.error("[GET /api/users/me] No user in request");
            return res.status(401).json({ error: "Authentication required" });
        }

        console.log("[GET /api/users/me] User UID:", req.user.uid);

        // Check MongoDB connection
        if (mongoose.connection.readyState !== 1) {
            console.error("[GET /api/users/me] MongoDB not connected. ReadyState:", mongoose.connection.readyState);
            return res.status(503).json({
                error: "Database connection unavailable. Please try again later.",
                details: "MongoDB is not connected"
            });
        }

        // Try to get user from req.user.dbUser first (already loaded by auth middleware)
        let dbUser = req.user.dbUser;

        // If not in req.user.dbUser, fetch from MongoDB
        if (!dbUser) {
            console.log("[GET /api/users/me] User not in req.user.dbUser, fetching from MongoDB...");
            try {
                dbUser = await mongoService.getUserByFirebaseUid(req.user.uid);
                console.log("[GET /api/users/me] User fetch result:", dbUser ? `Found: ${dbUser._id}` : "Not found");
            } catch (fetchError: any) {
                console.error("[GET /api/users/me] Error fetching user:", fetchError);
                throw new Error(`Failed to fetch user from database: ${fetchError.message}`);
            }
        }

        // If user doesn't exist, create them
        if (!dbUser) {
            console.log("[GET /api/users/me] User does not exist, creating new user...");

            // Generate username from email
            let baseUsername = (req.user.email?.split('@')[0] || 'user').toLowerCase().replace(/[^a-z0-9_]/g, '');
            if (baseUsername.length < 3) {
                baseUsername = baseUsername + '123';
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
                    email: req.user.email || '',
                    name: req.user.name || req.user.email?.split('@')[0] || 'User',
                    username: username,
                    isEmailVerified: req.user.emailVerified || false,
                });
                console.log("[GET /api/users/me] User created successfully:", dbUser._id);
            } catch (createError: any) {
                console.error("[GET /api/users/me] Error creating user:", createError);

                // If duplicate key, try to fetch existing user
                if (createError.code === 11000) {
                    console.log("[GET /api/users/me] Duplicate key, fetching existing user...");
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

        // Convert to plain object and remove password
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
            createdAt: dbUser.createdAt,
            updatedAt: dbUser.updatedAt,
        };

        console.log("[GET /api/users/me] Successfully returning user:", userResponse._id);
        res.json(userResponse);
    } catch (error: any) {
        console.error("[GET /api/users/me] ERROR:", error);
        console.error("[GET /api/users/me] Error message:", error?.message);
        console.error("[GET /api/users/me] Error stack:", error?.stack?.split('\n').slice(0, 5));

        res.status(500).json({
            error: error?.message || "Failed to fetch user profile",
            details: process.env.NODE_ENV === "development" ? {
                message: error?.message,
                code: error?.code,
                name: error?.name
            } : undefined
        });
    }
});

// Update current user's profile
router.put("/me", authenticate, async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const dbUser = req.user.dbUser || await mongoService.getUserByFirebaseUid(req.user.uid);
        if (!dbUser) {
            return res.status(404).json({ error: "User not found" });
        }

        const { password, firebaseUid, email, ...updateData } = req.body;

        // Don't allow updating email, firebaseUid, or password through this endpoint
        // Email and firebaseUid should be managed through Firebase Auth
        // Password updates should use a separate password reset endpoint

        // Validate username if being updated
        if (updateData.username && updateData.username !== dbUser.username) {
            const isTaken = await mongoService.isUsernameTaken(updateData.username);
            if (isTaken) {
                return res.status(400).json({ error: "Username is already taken" });
            }
        }

        const updatedUser = await mongoService.updateUser(dbUser._id.toString(), updateData);
        if (!updatedUser) {
            return res.status(404).json({ error: "User not found" });
        }

        // Remove password from response
        const userResponse = updatedUser.toObject();
        delete userResponse.password;

        res.json(userResponse);
    } catch (error: any) {
        console.error("Error updating user profile:", error);
        if (error.code === 11000) {
            // Duplicate key error (e.g., username already exists)
            return res.status(400).json({ error: "Username is already taken" });
        }
        res.status(500).json({ error: error.message || "Failed to update profile" });
    }
});

// Check if username is available (rate limited to prevent abuse)
router.get("/check-username/:username", usernameCheckRateLimiter, authenticate, async (req, res) => {
    try {
        const { username } = req.params;

        if (!username || username.length < 3) {
            return res.status(400).json({ error: "Username must be at least 3 characters" });
        }

        const isTaken = await mongoService.isUsernameTaken(username);
        res.json({
            username,
            available: !isTaken,
            message: isTaken ? "Username is already taken" : "Username is available"
        });
    } catch (error) {
        console.error("Error checking username:", error);
        res.status(500).json({ error: "Failed to check username" });
    }
});

// Get username suggestions
router.get("/suggestions/:baseUsername", authenticate, async (req, res) => {
    try {
        const { baseUsername } = req.params;

        if (!baseUsername || baseUsername.length < 2) {
            return res.status(400).json({ error: "Base username must be at least 2 characters" });
        }

        const suggestions = await mongoService.generateUsernameSuggestions(baseUsername);
        res.json({ suggestions });
    } catch (error) {
        console.error("Error generating username suggestions:", error);
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
        const dbUser = req.user.dbUser || await mongoService.getUserByFirebaseUid(req.user.uid);
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
        console.error("Error fetching user meetings:", error);
        res.status(500).json({ error: "Failed to fetch meetings" });
    }
});

// Get user by ID - MUST be after /me to avoid route conflict
router.get("/:id", authenticate, async (req, res) => {
    try {
        // Prevent /me from matching this route
        if (req.params.id === "me") {
            console.error("[GET /api/users/:id] Route conflict detected! /api/users/me should be handled by /api/users/me route");
            return res.status(500).json({ error: "Route configuration error. Please contact support." });
        }

        const user = await mongoService.getUserById(req.params.id);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Remove password from response
        const userResponse: any = user.toObject();
        delete userResponse.password;

        res.json(userResponse);
    } catch (error: any) {
        console.error("[GET /api/users/:id] Error fetching user:", error);
        res.status(500).json({
            error: "Failed to fetch user",
            details: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
});

export default router;

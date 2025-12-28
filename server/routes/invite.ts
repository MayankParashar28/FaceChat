import { Router } from "express";
import { Invite, User, Connection, Discovery } from "../models";
import { authenticate } from "../middleware/auth";
import { mongoService } from "../services/mongodb"; // Import mongoService
import crypto from "crypto";

const router = Router();

// Generate a new invite
router.post("/generate", authenticate, async (req, res) => {
    try {
        const user = req.user!;
        let dbUser = user.dbUser;

        // Fallback: Create/Get user if missing in DB but authenticated in Firebase
        if (!dbUser) {
            console.log(`User ${user.uid} missing in DB for invite generation, creating on the fly...`);
            try {
                dbUser = await mongoService.createOrUpdateUser({
                    firebaseUid: user.uid,
                    email: user.email || `${user.uid}@placeholder.email`,
                    name: user.name || "User",
                    username: (function () {
                        let u = (user.email?.split('@')[0] || `user_${user.uid.substring(0, 6)}`).toLowerCase().replace(/[^a-z0-9_]/g, '_');
                        if (u.length < 3) u = u + "_user";
                        return u;
                    })()
                });
            } catch (err) {
                console.error("Failed to auto-create user:", err);
                return res.status(500).json({ message: "User profile could not be created" });
            }
        }

        if (!dbUser) {
            return res.status(404).json({ message: "User profile not found" });
        }

        // Generate a random 8-character code
        const code = crypto.randomBytes(4).toString("hex");

        // Expires in 24 hours
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const invite = await Invite.create({
            creatorId: dbUser._id,
            code,
            expiresAt
        });

        res.json({
            code: invite.code,
            expiresAt: invite.expiresAt
        });
    } catch (error: any) {
        console.error("Generate invite error:", error);
        res.status(500).json({
            message: error.message || "Failed to generate invite",
            details: error.toString()
        });
    }
});

// Get invite details (public endpoint, to show preview)
router.get("/:code", async (req, res) => {
    try {
        const { code } = req.params;
        const invite = await Invite.findOne({
            code: { $regex: new RegExp(`^${code}$`, 'i') },
            expiresAt: { $gt: new Date() } // Not expired
        }).populate("creatorId", "name avatar username");

        if (!invite) {
            return res.status(404).json({ message: "Invite not found or expired" });
        }

        res.json({
            creator: invite.creatorId,
            expiresAt: invite.expiresAt
        });
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch invite" });
    }
});

// Accept invite
router.post("/:code/accept", authenticate, async (req, res) => {
    try {
        const { code } = req.params;
        const user = req.user!;
        let dbUser = user.dbUser;

        // Fallback for acceptor too
        if (!dbUser) {
            try {
                dbUser = await mongoService.createOrUpdateUser({
                    firebaseUid: user.uid,
                    email: user.email || `${user.uid}@placeholder.email`,
                    name: user.name || "User",
                    username: (function () {
                        let u = (user.email?.split('@')[0] || `user_${user.uid.substring(0, 6)}`).toLowerCase().replace(/[^a-z0-9_]/g, '_');
                        if (u.length < 3) u = u + "_user";
                        return u;
                    })()
                });
            } catch (err) {
                return res.status(500).json({ message: "User profile could not be created" });
            }
        }

        if (!dbUser) {
            return res.status(404).json({ message: "User profile not found" });
        }

        const invite = await Invite.findOne({
            code: { $regex: new RegExp(`^${code}$`, 'i') },
            expiresAt: { $gt: new Date() }
        });

        if (!invite) {
            return res.status(404).json({ message: "Invite not found or expired" });
        }

        if (invite.creatorId.toString() === dbUser._id.toString()) {
            return res.status(400).json({ message: "You cannot accept your own invite" });
        }

        // BI-DIRECTIONAL DISCOVERY
        await Discovery.updateOne(
            { viewerId: dbUser._id, targetId: invite.creatorId },
            { viewerId: dbUser._id, targetId: invite.creatorId, timestamp: new Date() },
            { upsert: true }
        );
        await Discovery.updateOne(
            { viewerId: invite.creatorId, targetId: dbUser._id },
            { viewerId: invite.creatorId, targetId: dbUser._id, timestamp: new Date() },
            { upsert: true }
        );

        // CREATE CONNECTION
        let connection = await Connection.findOne({
            participants: { $all: [dbUser._id, invite.creatorId] }
        });

        if (!connection) {
            connection = await Connection.create({
                participants: [dbUser._id, invite.creatorId],
                status: 'active'
            });
        }

        // Increment uses
        invite.uses += 1;
        await invite.save();

        res.json({ message: "Invite accepted! Connection formed.", connectionId: connection._id });

    } catch (error) {
        console.error("Accept invite error:", error);
        res.status(500).json({ message: "Failed to accept invite" });
    }
});

export default router;

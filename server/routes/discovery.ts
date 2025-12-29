import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { apiRateLimiter } from "../middleware/rateLimiter";
import { mongoService } from "../services/mongodb";
import { Discovery, Connection, User, Notification as NotificationModel } from "../models";
import mongoose from "mongoose";

const router = Router();

// "Discover" / View a user profile
// POST /api/discovery/:targetId
router.post("/:targetId", apiRateLimiter, authenticate, async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const { targetId } = req.params;
        const viewerUid = req.user.uid;

        // Get Viewer's MongoDB ID
        const viewer = req.user.dbUser || await mongoService.getUserByFirebaseUid(viewerUid);
        if (!viewer) {
            return res.status(404).json({ error: "Viewer not found" });
        }
        const viewerId = viewer._id.toString();

        // Prevent self-discovery
        if (viewerId === targetId) {
            return res.status(400).json({ error: "Cannot discover yourself" });
        }

        // Check if target exists
        const target = await User.findById(targetId);
        if (!target) {
            return res.status(404).json({ error: "Target user not found" });
        }

        // Check if ALREADY connected
        const existingConnection = await Connection.findOne({
            participants: {
                $all: [new mongoose.Types.ObjectId(viewerId), new mongoose.Types.ObjectId(targetId)]
            },
            status: 'active'
        });

        if (existingConnection) {
            return res.json({
                status: "connected",
                messagingUnlocked: true,
                connectionId: existingConnection._id
            });
        }

        // Check if ALREADY discovered (idempotency)
        const existingDiscovery = await Discovery.findOne({
            viewerId: new mongoose.Types.ObjectId(viewerId),
            targetId: new mongoose.Types.ObjectId(targetId)
        });

        if (existingDiscovery) {
            // Just return "discovered" status, check for reverse again just in case
            const reverseDiscovery = await Discovery.findOne({
                viewerId: new mongoose.Types.ObjectId(targetId),
                targetId: new mongoose.Types.ObjectId(viewerId)
            });

            if (reverseDiscovery) {
                // Create connection if missing
                const newConnection = await Connection.create({
                    participants: [viewerId, targetId],
                    status: 'active'
                });

                // Create Notifications
                await NotificationModel.create([
                    {
                        userId: viewerId,
                        type: "match",
                        title: "New Match! 🎉",
                        message: `You matched with ${target.name}!`,
                        relatedId: newConnection._id
                    },
                    {
                        userId: targetId,
                        type: "match",
                        title: "New Match! 🎉",
                        message: `You matched with ${viewer.name}!`,
                        relatedId: newConnection._id
                    }
                ]);

                // @ts-ignore - access io from app
                const io = req.app.get("io");
                if (io) {
                    // Emit to both users
                    io.to(`user:${viewerId}`).emit("discovery:match", {
                        partner: { id: target._id, name: target.name, avatar: target.avatar },
                        connectionId: newConnection._id
                    });
                    io.to(`user:${targetId}`).emit("discovery:match", {
                        partner: { id: viewer._id, name: viewer.name, avatar: viewer.avatar },
                        connectionId: newConnection._id
                    });
                }

                return res.json({ status: "matched", messagingUnlocked: true, connectionId: newConnection._id });
            }

            return res.json({ status: "discovered", messagingUnlocked: false });
        }

        // CREATE NEW DISCOVERY RECORD
        await Discovery.create({
            viewerId: new mongoose.Types.ObjectId(viewerId),
            targetId: new mongoose.Types.ObjectId(targetId)
        });

        // CHECK FOR MUTUAL (Reverse Discovery)
        const reverseDiscovery = await Discovery.findOne({
            viewerId: new mongoose.Types.ObjectId(targetId),
            targetId: new mongoose.Types.ObjectId(viewerId)
        });

        if (reverseDiscovery) {
            // IT'S A MATCH!
            const newConnection = await Connection.create({
                participants: [viewerId, targetId],
                status: 'active'
            });

            // Create Notifications
            await NotificationModel.create([
                {
                    userId: viewerId,
                    type: "match",
                    title: "New Match! 🎉",
                    message: `You matched with ${target.name}!`,
                    relatedId: newConnection._id
                },
                {
                    userId: targetId,
                    type: "match",
                    title: "New Match! 🎉",
                    message: `You matched with ${viewer.name}!`,
                    relatedId: newConnection._id
                }
            ]);

            // @ts-ignore - access io from app
            const io = req.app.get("io");
            if (io) {
                io.to(`user:${viewerId}`).emit("discovery:match", {
                    partner: { id: target._id, name: target.name, avatar: target.avatar },
                    connectionId: newConnection._id
                });
                io.to(`user:${targetId}`).emit("discovery:match", {
                    partner: { id: viewer._id, name: viewer.name, avatar: viewer.avatar },
                    connectionId: newConnection._id
                });
            }

            return res.json({ status: "matched", messagingUnlocked: true, connectionId: newConnection._id });
        }

        // No match yet
        return res.json({ status: "discovered", messagingUnlocked: false });

    } catch (error) {
        console.error("Discovery error:", error);
        res.status(500).json({ error: "Failed to process discovery" });
    }
});

// Check status between current user and target
router.get("/status/:targetId", authenticate, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: "Authentication required" });

        const { targetId } = req.params;
        const viewerUid = req.user.uid;
        const viewer = req.user.dbUser || await mongoService.getUserByFirebaseUid(viewerUid);
        if (!viewer) return res.status(404).json({ error: "Viewer not found" });

        const connection = await Connection.findOne({
            participants: { $all: [viewer._id, targetId] },
            status: 'active'
        });

        if (connection) {
            return res.json({ status: "connected", messagingUnlocked: true });
        }

        const discovery = await Discovery.findOne({
            viewerId: viewer._id,
            targetId: targetId
        });

        return res.json({
            status: discovery ? "discovered" : "none",
            messagingUnlocked: false
        });

    } catch (error) {
        console.error("Error checking status:", error);
        res.status(500).json({ error: "Failed to check status" });
    }
});

// Block a user
router.post("/block/:targetId", authenticate, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: "Authentication required" });

        const { targetId } = req.params;
        const viewerUid = req.user.uid;
        const viewer = req.user.dbUser || await mongoService.getUserByFirebaseUid(viewerUid);
        if (!viewer) return res.status(404).json({ error: "Viewer not found" });

        // Find the active connection
        const connection = await Connection.findOne({
            participants: { $all: [viewer._id, targetId] }
        });

        if (connection) {
            // Update status to blocked
            connection.status = 'blocked';
            await connection.save();
            return res.json({ success: true, message: "User blocked" });
        }

        // If no connection exists, we might want to create a blocked record or just ignore
        // For now, let's assume blocking only works if you have a connection/match
        return res.status(404).json({ error: "Connection not found" });

    } catch (error) {
        console.error("Error blocking user:", error);
        res.status(500).json({ error: "Failed to block user" });
    }
});

export default router;

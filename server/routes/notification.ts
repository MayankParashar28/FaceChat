import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { mongoService } from "../services/mongodb";
import { Notification } from "../models";

const router = Router();

// Get all notifications for current user
router.get("/", authenticate, async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const userId = req.user.uid;
        const dbUser = req.user.dbUser || await mongoService.getUserByFirebaseUid(userId);
        if (!dbUser) {
            return res.status(404).json({ error: "User not found" });
        }

        const notifications = await Notification.find({ userId: dbUser._id })
            .sort({ createdAt: -1 })
            .limit(50); // Limit to recent 50 for now

        res.json(notifications);
    } catch (error) {
        console.error("Error fetching notifications:", error);
        res.status(500).json({ error: "Failed to fetch notifications" });
    }
});

// Mark as read
router.put("/:id/read", authenticate, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: "Auth required" });

        const { id } = req.params;
        await Notification.findByIdAndUpdate(id, { isRead: true });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Failed to update notification" });
    }
});

// Mark ALL as read
router.put("/read-all", authenticate, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: "Auth required" });

        const userId = req.user.uid;
        const dbUser = req.user.dbUser || await mongoService.getUserByFirebaseUid(userId);

        if (dbUser) {
            await Notification.updateMany({ userId: dbUser._id, isRead: false }, { isRead: true });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Failed to mark all read" });
    }
});

// Delete notification
router.delete("/:id", authenticate, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: "Auth required" });
        await Notification.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Failed to delete notification" });
    }
});

export default router;

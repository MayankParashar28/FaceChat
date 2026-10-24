import { logger } from "../utils/logger";
import { Router } from "express";
import mongoose from "mongoose";
import type { Request } from "express";
import { authenticate } from "../middleware/auth";
import { mongoService } from "../services/mongodb";
import { Notification } from "../models";

const router = Router();

/**
 * The caller's MongoDB user. The token may carry a Firebase uid or, for
 * email/password logins, the MongoDB id itself.
 */
async function resolveUser(req: Request) {
  if (!req.user) return null;
  const userId = req.user.uid;
  let dbUser = req.user.dbUser || (await mongoService.getUserByFirebaseUid(userId));
  if (!dbUser && mongoose.Types.ObjectId.isValid(userId)) {
    dbUser = await mongoService.getUserById(userId);
  }
  return dbUser || null;
}

// Get all notifications for current user
router.get("/", authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const dbUser = await resolveUser(req);
    if (!dbUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const notifications = await Notification.find({ userId: dbUser._id })
      .sort({ createdAt: -1 })
      .limit(50); // Limit to recent 50 for now

    res.json(notifications);
  } catch (error) {
    logger.error("Error fetching notifications:", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// Mark ALL as read.
// Declared before "/:id/read" so the literal path always wins, even if a
// single-segment id pattern is added later.
router.put("/read-all", authenticate, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Auth required" });

    const dbUser = await resolveUser(req);
    if (!dbUser) return res.status(404).json({ error: "User not found" });

    const result = await Notification.updateMany(
      { userId: dbUser._id, isRead: false },
      { isRead: true }
    );
    res.json({ success: true, updated: result.modifiedCount });
  } catch (error) {
    logger.error("Error marking all notifications read:", error);
    res.status(500).json({ error: "Failed to mark all read" });
  }
});

// Mark one as read.
//
// Scoped to the caller's own notifications: this previously updated by id
// alone, so any signed-in user could mark another user's notification as read
// just by knowing its id.
router.put("/:id/read", authenticate, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Auth required" });

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid notification id" });
    }

    const dbUser = await resolveUser(req);
    if (!dbUser) return res.status(404).json({ error: "User not found" });

    const updated = await Notification.findOneAndUpdate(
      { _id: id, userId: dbUser._id },
      { isRead: true },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ error: "Notification not found" });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error("Error marking notification read:", error);
    res.status(500).json({ error: "Failed to update notification" });
  }
});

// Delete a notification.
//
// Also scoped to the caller. This used to delete by id alone, so any signed-in
// user could delete anybody's notification — the destructive version of the
// same hole.
router.delete("/:id", authenticate, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Auth required" });

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid notification id" });
    }

    const dbUser = await resolveUser(req);
    if (!dbUser) return res.status(404).json({ error: "User not found" });

    const deleted = await Notification.findOneAndDelete({ _id: id, userId: dbUser._id });
    if (!deleted) {
      return res.status(404).json({ error: "Notification not found" });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error("Error deleting notification:", error);
    res.status(500).json({ error: "Failed to delete notification" });
  }
});

export default router;

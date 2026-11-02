import { logger } from "../utils/logger";
import { Router } from "express";
import mongoose from "mongoose";
import type { Request } from "express";
import { authenticate } from "../middleware/auth";
import { mongoService } from "../services/mongodb";
import { Connection, Conversation, Meeting, Notification } from "../models";
import { notificationPath, type RelatedThing } from "../services/notificationTarget";

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

/**
 * Where this notification points, so clicking it lands somewhere.
 *
 * `relatedId` names a row in one of three collections and says which in none
 * of them, so each is tried in turn — and every one of those lookups is scoped
 * to the caller. That scoping is the reason this is a request at all rather
 * than something the client works out: answering "is this id a conversation?"
 * for anybody who asks would turn the endpoint into a way to probe for other
 * people's rows.
 *
 * A null path is a real answer. The thing a notification was about can be
 * deleted — a GhostLink chat expires by design — and saying so is better than
 * navigating somewhere that merely looks like an answer.
 */
router.get("/:id/target", authenticate, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Auth required" });

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid notification id" });
    }

    const dbUser = await resolveUser(req);
    if (!dbUser) return res.status(404).json({ error: "User not found" });

    const notification = await Notification.findOne({ _id: id, userId: dbUser._id });
    if (!notification) {
      return res.status(404).json({ error: "Notification not found" });
    }

    const relatedId = notification.relatedId;
    let thing: RelatedThing = { kind: "none" };

    if (relatedId) {
      const conversation = await Conversation.findOne({
        _id: relatedId,
        participants: dbUser._id,
        isDeleted: { $ne: true },
      }).select("_id");

      if (conversation) {
        thing = { kind: "conversation", id: conversation._id.toString() };
      } else {
        // Looked up by id alone, because holding the notification is already
        // the proof of entitlement — and a missed call cannot be scoped to the
        // meeting's own membership. The meeting a missed call points at is
        // created with only the caller on it; the person who missed it is, by
        // definition, not a participant, so requiring membership here made the
        // one notification this was all for resolve to nowhere.
        const meeting = await Meeting.findById(relatedId).select(
          "roomId status hostId participants"
        );

        if (meeting) {
          // A call placed from a chat uses that conversation's id as its room.
          // Membership of the conversation is checked, not assumed: that is
          // what stops a room id from being a way to reach somebody else's
          // chat.
          const room = /^[0-9a-fA-F]{24}$/.test(meeting.roomId)
            ? await Conversation.findOne({
                _id: meeting.roomId,
                participants: dbUser._id,
                isDeleted: { $ne: true },
              }).select("_id")
            : null;

          // Joining a standalone room, or seeing it in the meeting list, does
          // need the caller to be on the meeting. Without the chat to fall
          // back on there is nowhere else to send them.
          const onTheMeeting =
            meeting.hostId.equals(dbUser._id) ||
            meeting.participants.some((p) => p.equals(dbUser._id));

          thing =
            room || onTheMeeting
              ? {
                  kind: "meeting",
                  roomId: meeting.roomId,
                  status: meeting.status,
                  roomIsConversation: !!room,
                }
              : { kind: "none" };
        } else {
          const connection = await Connection.findOne({
            _id: relatedId,
            participants: dbUser._id,
          }).select("participants");

          if (connection) {
            const other = connection.participants.find((p) => !p.equals(dbUser._id));
            const shared = other
              ? await Conversation.findOne({
                  isGroup: { $ne: true },
                  participants: { $all: [dbUser._id, other] },
                  isDeleted: { $ne: true },
                }).select("_id")
              : null;
            thing = { kind: "connection", conversationId: shared?._id.toString() ?? null };
          }
        }
      }
    }

    res.json({ path: notificationPath(thing) });
  } catch (error) {
    logger.error("Error resolving notification target:", error);
    res.status(500).json({ error: "Failed to resolve notification" });
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

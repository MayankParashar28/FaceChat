import { logger } from "../utils/logger";
import { Router } from "express";
import mongoose from "mongoose";
import { authenticate } from "../middleware/auth";
import { apiRateLimiter } from "../middleware/rateLimiter";
import { mongoService } from "../services/mongodb";
import { Conversation, Message } from "../models";
import { CacheKeys, CacheTTL, cacheDelete, remember } from "../services/cache";
import {
  destroyGhostConversation,
  enforceGhostExpiry,
  isGhostExpired,
} from "../services/ghostChat";

const router = Router();

/** Drop the cached conversation list for everyone in a conversation. */
async function invalidateConversationLists(participants: { toString(): string }[]) {
  await cacheDelete(...participants.map((p) => CacheKeys.conversationList(p.toString())));
}

/**
 * The gate every read of one conversation's contents has to pass: signed in,
 * the conversation exists, it has not quietly expired, and the caller is
 * actually in it. Answers the request itself on a refusal and returns null,
 * so a caller only has to check for that.
 */
async function authorizeConversationRead(
  req: any,
  res: any
): Promise<{ conversation: any; dbUser: any } | null> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }

  const conversation = await Conversation.findById(req.params.conversationId);
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return null;
  }

  // A ghost chat whose time has passed is gone the moment anybody asks for
  // it, whether or not the sweep has come round yet. The dyno sleeps, and a
  // sweep that has not run for an hour must not mean an hour of extra life.
  if (await enforceGhostExpiry(conversation)) {
    res.status(410).json({ error: "This GhostLink chat has vanished.", vanished: true });
    return null;
  }

  const dbUser = req.user.dbUser || (await mongoService.getUserByFirebaseUid(req.user.uid));
  if (!dbUser) {
    res.status(404).json({ error: "User not found" });
    return null;
  }

  const isParticipant = conversation.participants.some(
    (p: { toString(): string }) => p.toString() === dbUser._id.toString()
  );
  if (!isParticipant) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }

  return { conversation, dbUser };
}

// Get all conversations for the current user
router.get("/", authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Use authenticated user's ID instead of query parameter for security
    const userId = req.user.uid;

    // userId is Firebase UID, we need to get the MongoDB user
    const dbUser = req.user.dbUser || (await mongoService.getUserByFirebaseUid(userId));

    logger.info("API Call: Fetching conversations for userId:", userId);

    if (!dbUser) {
      // The account exists in Firebase but has not been synced to MongoDB yet.
      // This used to answer with a canned list of invented conversations.
      return res.json([]);
    }

    logger.info("Fetching conversations for MongoDB user:", dbUser._id.toString());

    const getOnlineUserIds = req.app.get("getOnlineUserIds");
    const onlineUserIds: Set<string> | undefined =
      typeof getOnlineUserIds === "function" ? getOnlineUserIds() : undefined;

    // The expensive part of this request is the conversation query plus the
    // unread-count aggregate, and the chat page asks for it on every open and
    // on a poll. Cache that, keyed by user, for a few seconds.
    //
    // Online status is deliberately NOT cached: it is re-applied below from the
    // live socket set on every request, so a cached list never shows someone as
    // online after they have left.
    const conversations = await remember(
      CacheKeys.conversationList(dbUser._id.toString()),
      CacheTTL.conversationList,
      () => mongoService.getUserConversations(dbUser._id.toString())
    );

    // The list is cached for a few seconds, so an overdue ghost can still be
    // sitting in it. Filter on the way out — the sweep and the message read
    // both destroy it, but neither should be what decides whether somebody
    // sees it listed.
    const live = conversations.filter((conversation: any) => !isGhostExpired(conversation));

    const withPresence = live.map((conversation: any) => ({
      ...conversation,
      participants: (conversation.participants || []).map((p: any) => ({
        ...p,
        online: onlineUserIds
          ? onlineUserIds.has(p.id) || (p.firebaseUid ? onlineUserIds.has(p.firebaseUid) : false)
          : false,
      })),
    }));

    logger.info("Found conversations:", withPresence.length);

    res.json(withPresence);
  } catch (error) {
    logger.error("Error fetching conversations:", error);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// Get messages for a conversation
router.get("/:conversationId/messages", authenticate, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { beforeDate, limit } = req.query;

    const allowed = await authorizeConversationRead(req, res);
    if (!allowed) return;
    const { dbUser } = allowed;

    logger.info(
      "Fetching messages for conversation:",
      conversationId,
      "userId:",
      dbUser.firebaseUid,
      "beforeDate:",
      beforeDate
    );

    const limitNum = limit ? parseInt(limit as string, 10) : 50;
    const beforeDateObj = beforeDate ? new Date(beforeDate as string) : undefined;

    // Get messages from MongoDB with pagination
    const messages = await mongoService.getConversationMessages(
      conversationId,
      dbUser._id.toString(),
      limitNum,
      beforeDateObj
    );

    logger.info("Returning messages:", messages.length);
    res.json(messages);
  } catch (error) {
    logger.error("Error fetching messages:", error);
    // Return empty array to prevent client errors
    res.json([]);
  }
});

/**
 * One whole thread: the message it hangs off and every reply beneath it, in
 * the order they were written.
 *
 * Separate from the paginated message list because a thread is read as a unit
 * — its root may be weeks above the page someone is looking at, and half a
 * thread is not worth drawing.
 */
router.get("/:conversationId/threads/:rootId", authenticate, async (req, res) => {
  try {
    const { conversationId, rootId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(rootId)) {
      return res.status(400).json({ error: "Invalid message id" });
    }

    const allowed = await authorizeConversationRead(req, res);
    if (!allowed) return;

    const messages = await mongoService.getThreadMessages(
      conversationId,
      rootId,
      allowed.dbUser._id.toString()
    );

    // Empty means the root is not in this conversation — a thread always has
    // at least its own root — so it reads as missing rather than as blank.
    if (!messages.length) {
      return res.status(404).json({ error: "Thread not found" });
    }

    res.json(messages);
  } catch (error) {
    logger.error("Error fetching thread:", error);
    res.status(500).json({ error: "Failed to fetch thread" });
  }
});

// Create conversation endpoint
router.post("/", apiRateLimiter, authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { participantIds, name } = req.body;

    if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
      return res.status(400).json({ error: "At least one participant is required" });
    }

    // Use authenticated user as creator
    const createdBy = req.user.uid;

    // Convert participant IDs to MongoDB IDs
    // participantIds may contain Firebase UIDs or MongoDB IDs
    const mongoParticipantIds: string[] = [];
    for (const participantId of participantIds) {
      // First try to find by Firebase UID
      const userByFirebase = await mongoService.getUserByFirebaseUid(participantId);
      if (userByFirebase) {
        mongoParticipantIds.push(userByFirebase._id.toString());
      } else {
        // If not found by Firebase UID, check if it's already a MongoDB ID
        // MongoDB ObjectIds are 24-character hex strings
        const isMongoId = /^[0-9a-fA-F]{24}$/.test(participantId);
        if (isMongoId) {
          // Check if this MongoDB ID exists
          const userByMongoId = await mongoService.getUserById(participantId);
          if (userByMongoId) {
            mongoParticipantIds.push(participantId);
          } else {
            return res.status(400).json({ error: `Participant ${participantId} not found` });
          }
        } else {
          return res.status(400).json({ error: `Participant ${participantId} not found` });
        }
      }
    }

    // Get the creator's MongoDB ID
    const creatorUser = req.user.dbUser || (await mongoService.getUserByFirebaseUid(createdBy));
    if (!creatorUser) {
      return res.status(404).json({ error: "Creator not found" });
    }
    const mongoCreatedBy = creatorUser._id.toString();

    // Ensure creator is in participant list
    if (!mongoParticipantIds.includes(mongoCreatedBy)) {
      mongoParticipantIds.push(mongoCreatedBy);
    }

    // Check if conversation already exists (for 1-on-1 chats)
    if (mongoParticipantIds.length === 2) {
      // Convert string IDs to ObjectId for query
      const participantObjectIds = mongoParticipantIds.map((id) => new mongoose.Types.ObjectId(id));

      const existingConv = await Conversation.findOne({
        participants: { $all: participantObjectIds, $size: participantObjectIds.length },
        isDeleted: false,
      });

      if (existingConv) {
        await existingConv.populate("participants", "username name email avatar firebaseUid");
        await existingConv.populate("lastMessage");

        const lastMessage = existingConv.lastMessage
          ? await Message.findById(existingConv.lastMessage).populate("senderId", "username name")
          : null;

        return res.json({
          id: existingConv._id.toString(),
          name: existingConv.name,
          isGroup: existingConv.isGroup,
          participants: existingConv.participants.map((p: any) => ({
            id: p._id.toString(),
            firebaseUid: p.firebaseUid,
            name: p.name,
            username: p.username,
            avatar: p.avatar,
            online: false,
          })),
          lastMessage:
            lastMessage &&
            typeof lastMessage.senderId !== "string" &&
            "name" in lastMessage.senderId
              ? {
                  id: lastMessage._id.toString(),
                  conversationId: existingConv._id.toString(),
                  senderId: (lastMessage.senderId as any)._id.toString(),
                  // A deleted last message must not leave its text sitting in
                  // the conversation list after it has gone from the thread.
                  content: lastMessage.deletedAt ? "" : lastMessage.content,
                  deletedAt: lastMessage.deletedAt,
                  isPinned: lastMessage.isPinned,
                  createdAt: lastMessage.createdAt,
                  sender: {
                    id: (lastMessage.senderId as any)._id.toString(),
                    name: (lastMessage.senderId as any).name,
                    username: (lastMessage.senderId as any).username,
                  },
                }
              : undefined,
          unreadCount: 0,
        });
      }
    }

    // FaceLink gate: a NEW 1-on-1 conversation requires an active mutual
    // connection. (Existing conversations are returned above; groups are exempt.)
    if (mongoParticipantIds.length === 2) {
      const otherId = mongoParticipantIds.find((id) => id !== mongoCreatedBy);
      if (otherId && !(await mongoService.areConnected(mongoCreatedBy, otherId))) {
        return res.status(403).json({
          error: "You must both discover each other before starting a chat.",
        });
      }
    }

    const conversation = await mongoService.createConversation(
      mongoParticipantIds,
      mongoCreatedBy,
      name
    );

    // Populate and format response
    await conversation.populate("participants", "username name email avatar firebaseUid");
    await conversation.populate("createdBy", "username name");

    res.json({
      id: conversation._id.toString(),
      name: conversation.name,
      isGroup: conversation.isGroup,
      participants: conversation.participants.map((p: any) => ({
        id: p._id.toString(),
        firebaseUid: p.firebaseUid,
        name: p.name,
        username: p.username,
        avatar: p.avatar,
        online: false,
      })),
      createdBy: conversation.createdBy,
      unreadCount: 0,
    });
  } catch (error) {
    logger.error("Error creating conversation:", error);
    res.status(500).json({ error: "Failed to create conversation" });
  }
});
// Delete conversation (soft delete)
router.delete("/:conversationId", authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { conversationId } = req.params;
    const userId = req.user.uid;

    const dbUser = req.user.dbUser || (await mongoService.getUserByFirebaseUid(userId));
    if (!dbUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      // Already gone or not found
      return res.json({ success: true });
    }

    // Verify participant
    const isParticipant = conversation.participants.some(
      (p) => p.toString() === dbUser._id.toString()
    );
    if (!isParticipant) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Take it off this person's list and nobody else's. Both branches of the
    // old code set `isDeleted`, which removed the conversation — and its
    // history — from the other participant too, whatever the button said. A
    // later message brings it back for everyone (see createMessage).
    await Conversation.updateOne(
      { _id: conversation._id },
      { $addToSet: { hiddenFor: dbUser._id } }
    );

    await invalidateConversationLists([dbUser._id]);

    res.json({ success: true });
  } catch (error) {
    logger.error("Error deleting conversation:", error);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

// Clear chat history (soft delete messages for user)
router.post("/:conversationId/clear", authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { conversationId } = req.params;
    const userId = req.user.uid;

    const dbUser = req.user.dbUser || (await mongoService.getUserByFirebaseUid(userId));
    if (!dbUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Verify participant
    const isParticipant = conversation.participants.some(
      (p) => p.toString() === dbUser._id.toString()
    );
    if (!isParticipant) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Clear for this caller only: record where they cleared up to, and hide
    // everything at or before it when building their view. The other
    // participant keeps the conversation intact — it is their history too.
    //
    // This used to be `Message.updateMany(..., { isDeleted: true })`. Message
    // has no isDeleted path and the schema is strict, so Mongoose dropped the
    // field and the update wrote nothing: the endpoint returned success, the
    // client emptied its local array, and every message came back on reload.
    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: { [`clearedAt.${dbUser._id.toString()}`]: new Date() } }
    );

    // Only this user's list changes; nobody else's view moved.
    await invalidateConversationLists([dbUser._id]);

    res.json({ success: true });
  } catch (error) {
    logger.error("Error clearing chat:", error);
    res.status(500).json({ error: "Failed to clear chat" });
  }
});

/**
 * End a GhostLink chat now, without waiting for its timer.
 *
 * The timer was the only way out, so sending something to the wrong person
 * meant watching the clock for however long was left. Either participant can
 * pull it: both of them are in the room, and the chat was never going to
 * survive anyway — this only decides when.
 *
 * Confined to ghost chats on purpose. The same call against an ordinary
 * conversation would be an unrecoverable delete of somebody else's history,
 * which is a different feature and not one anybody asked for.
 */
router.post("/:conversationId/ghost/destroy", apiRateLimiter, authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { conversationId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ error: "Invalid conversation id" });
    }

    const dbUser = req.user.dbUser || (await mongoService.getUserByFirebaseUid(req.user.uid));
    if (!dbUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      // Already gone, most likely because its timer or the other person got
      // there first. That is the outcome being asked for, so it is not a
      // failure — but say nothing about whether it ever existed.
      return res.status(404).json({ error: "Conversation not found" });
    }

    const isParticipant = conversation.participants.some(
      (p) => p.toString() === dbUser._id.toString()
    );
    if (!isParticipant) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (!conversation.isGhost) {
      return res.status(400).json({ error: "This conversation is not a GhostLink chat" });
    }

    // Erases the attachments, the messages, the conversation and the invite,
    // drops both cached lists and tells the room — the same path the timer
    // takes, so there is one way a ghost chat ends.
    const erased = await destroyGhostConversation(conversation._id);

    logger.info(
      `GhostLink chat ${conversationId} ended early by ${dbUser._id.toString()}: ` +
        `${erased.messages} messages, ${erased.attachments} attachments`
    );

    res.json({ success: true, erased });
  } catch (error) {
    logger.error("Error destroying ghost chat:", error);
    res.status(500).json({ error: "Failed to destroy the chat" });
  }
});

export default router;

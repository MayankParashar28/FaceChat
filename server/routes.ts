import { logger } from "./utils/logger";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import mongoose from "mongoose";
// Import Twilio only if installed (runtime will fail if env/config missing)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
// import twilio from "twilio";
import { mongoService } from "./services/mongodb";
import { verifyFirebaseToken, setUserOnlineStatus } from "./firebase/admin";
import { mongoHealthCheck } from "./database/mongodb";
import { Message, Conversation, User, Meeting, ChatMessage, Notification } from "./models";
import type { IMeeting } from "./models";
import { authenticate } from "./middleware/auth";

import { transcriptionService } from "./services/transcription";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/user";
import chatRoutes from "./routes/chat";
import meetingRoutes from "./routes/meeting";
import discoveryRoutes from "./routes/discovery";

import notificationRoutes from "./routes/notification";
import inviteRoutes from "./routes/invite";
import attachmentRoutes from "./routes/attachments";
import avatarRoutes from "./routes/avatar";
import { CacheKeys, cacheDelete } from "./services/cache";
import {
  MAX_UPLOAD_BYTES,
  deleteAttachment,
  findGridfsFile,
  publicIdBelongsToConversation,
} from "./services/attachmentStorage";
import { ALLOWED_MIME } from "./services/fileSignature";
import { looksLikeSessionToken, verifySessionToken } from "./services/sessionToken";
import { enforceGhostExpiry, setGhostBroadcaster } from "./services/ghostChat";
import { PIN_LIMIT, pinsToEvict } from "./services/pinLimit";
import { canDelete, canEdit, validateEdit } from "./services/messageEdits";
import { buildReplyQuote } from "./services/replyQuote";

/** Attachment metadata that has been checked against what is actually stored. */
type VerifiedAttachment = {
  provider: "cloudinary" | "gridfs";
  storageId: string;
  resourceType?: string;
  name: string;
  size: number;
  mimeType: string;
};

/**
 * Room ids double as conversation ids for calls started from a chat, but ad-hoc
 * rooms use free-form names. Only the former can be looked up as a Conversation
 * — casting anything else throws a CastError. `ObjectId.isValid` is too loose
 * here, since it accepts any 12-character string (e.g. "team-standup").
 */
const isConversationId = (roomId: string): boolean => /^[0-9a-fA-F]{24}$/.test(roomId);

/**
 * When a call began, for the timer every client in the room counts from.
 *
 * `actualStartTime` is stamped the moment a meeting goes active;
 * `startTime` is only the slot it was booked for, and counting from that
 * showed a call held hours after its scheduled time as hours old.
 */
const callStartedAt = (meeting: IMeeting | null): string =>
  (meeting?.actualStartTime ?? meeting?.startTime ?? new Date()).toISOString();

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === "production" ? false : "*"),
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  const userSockets = new Map<string, string>();
  const socketUserMap = new Map<string, string>(); // socketId -> userId
  const roomParticipants = new Map<string, Set<string>>(); // roomId -> Set of socketIds

  /**
   * Active call invitations, keyed by call roomId. Lets us post "call started /
   * ended / declined / missed" system messages into the originating chat and
   * keep caller and callee in sync.
   */
  const callSessions = new Map<
    string,
    {
      conversationId?: string;
      callerUid: string;
      calleeUid: string;
      callerName: string;
      calleeName: string;
      callType: "audio" | "video";
      answered: boolean;
      ended: boolean;
      startedAt?: number;
    }
  >();

  function formatCallDuration(ms: number) {
    const total = Math.max(1, Math.round(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }

  /** Post a `system` message into a conversation and broadcast it live. */
  async function postCallSystemMessage(
    conversationId: string | undefined,
    senderUid: string,
    content: string
  ) {
    if (!conversationId) return;
    try {
      const dbUser = await mongoService.getUserByFirebaseUidCached(senderUid);
      if (!dbUser) return;

      const message = await mongoService.createMessage({
        conversationId,
        senderId: dbUser._id.toString(),
        content,
        messageType: "system",
      });

      io.to(`conversation:${conversationId}`).emit("message:new", {
        id: message._id.toString(),
        conversationId,
        senderId: senderUid,
        content,
        messageType: "system",
        isPinned: false,
        createdAt: message.createdAt,
        sender: {
          id: dbUser._id.toString(),
          name: dbUser.name,
          username: dbUser.username,
          firebaseUid: senderUid,
        },
        status: "sent" as const,
      });
    } catch (error) {
      logger.error("Failed to post call system message:", error);
    }
  }

  // Make IO and online users accessible in routes
  app.set("io", io);

  // A ghost chat is destroyed from the sweep and from read paths, neither of
  // which can reach `io` — it is created here. Hand the emitter over so the
  // people in the room are told the moment it happens.
  setGhostBroadcaster((conversationId, erased) => {
    io.to(`conversation:${conversationId}`).emit("conversation:vanished", {
      conversationId,
      erased,
    });
  });
  app.set("getOnlineUserIds", () => new Set(userSockets.keys()));

  // Register API Routes
  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/conversations", chatRoutes);
  app.use("/api/meetings", meetingRoutes);
  app.use("/api/discovery", discoveryRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/invites", inviteRoutes);
  app.use("/api/avatars", avatarRoutes);
  // Mounted at /api so it owns both /api/conversations/:id/attachments and
  // /api/attachments/:fileId.
  app.use("/api", attachmentRoutes);

  io.on("connection", (socket) => {
    logger.debug("Client connected:", socket.id);

    /**
     * Registering the connection against an account.
     *
     * Takes an acknowledgement callback, because everything else a socket does
     * depends on this having finished. `socketUserMap` is only written at the
     * end of this handler, and `conversationMember` reads it — so a client
     * that joined a conversation room without waiting was refused, silently
     * stayed out of the room, and then saw none of what is broadcast to it.
     * Pins were the visible symptom: messages still arrived, because sending
     * one joins the room as a side effect, but a reader who never sent
     * anything sat outside and had to reload to see a pin.
     */
    socket.on(
      "user:online",
      async (data: { firebaseToken: string }, ack?: (ok: boolean) => void) => {
        try {
          const token = data?.firebaseToken;
          if (!token) return ack?.(false);

          let userId: string | null = null;
          let dbUser: any = null;

          // A session token this server issued, or a Firebase ID token. Nothing
          // else. This used to look the token up as a firebaseUid or MongoDB id
          // first, so knowing someone's id was enough to come online as them and
          // read their conversations; and when neither worked it fell through to
          // `userId = token`, registering the connection as authenticated under
          // whatever string had arrived.
          if (looksLikeSessionToken(token)) {
            const claims = await verifySessionToken(token);
            if (claims) {
              dbUser = await mongoService.getUserById(claims.sub);
              if (dbUser) userId = dbUser.firebaseUid || dbUser._id.toString();
            }
          } else {
            try {
              const decodedToken = await verifyFirebaseToken(token);
              userId = decodedToken.uid;
              dbUser = await mongoService.getUserByFirebaseUidCached(userId);
              if (!dbUser) {
                dbUser = await mongoService.createOrUpdateUser({
                  firebaseUid: userId,
                  email: decodedToken.email || "",
                  name: decodedToken.name || "",
                  username: decodedToken.email?.split("@")[0] || "user",
                });
              }
            } catch (e) {
              userId = null;
            }
          }

          if (!dbUser || !userId) {
            logger.warn("Rejected a socket sign-in with an unrecognised token");
            socket.emit("user:unauthenticated", {
              error: "Your session has expired. Please sign in again.",
            });
            return ack?.(false);
          }

          // Past the guard there is always a resolved account, so socketUserMap
          // now only ever holds a MongoDB id — the assumption conversationMember
          // and call:invite make about it is finally true.
          const mongoId = dbUser._id.toString();
          const firebaseUid = dbUser.firebaseUid || mongoId;

          userSockets.set(mongoId, socket.id);
          userSockets.set(firebaseUid, socket.id);
          socketUserMap.set(socket.id, mongoId);

          setUserOnlineStatus(firebaseUid, true).catch(() => {});
          setUserOnlineStatus(mongoId, true).catch(() => {});

          io.emit("user:status", { userId: mongoId, online: true });
          io.emit("user:status", { userId: firebaseUid, online: true });

          socket.join(`user:${mongoId}`);
          socket.join(`user:${firebaseUid}`);

          const meetings = await mongoService.getUserMeetings(mongoId);
          meetings.forEach((meeting) => {
            socket.join(`meeting:${meeting._id.toString()}`);
          });

          socket.emit("user:authenticated", { userId: mongoId, user: dbUser });
          socket.emit("users:online-list", { onlineUserIds: Array.from(userSockets.keys()) });

          // Only now is this connection something `conversationMember` can
          // recognise, so only now may the client ask to join a room.
          ack?.(true);
        } catch (error) {
          logger.error("Error in user:online socket handler:", error);
          ack?.(false);
        }
      }
    );

    /**
     * The user this connection signed in as, but only if they belong to the
     * conversation in question. Everything that reads or writes a conversation
     * goes through here: the payloads used to name their own author.
     */
    const conversationMember = async (conversationId: string) => {
      try {
        const viewerId = socketUserMap.get(socket.id);
        if (!viewerId || !mongoose.Types.ObjectId.isValid(conversationId)) return null;

        // socketUserMap holds a MongoDB id for a connection whose user was
        // resolved, but a raw Firebase uid for one whose user was not (see the
        // else branch of user:online). Assuming the first form here killed the
        // server: the uid went into a findById and the CastError escaped as an
        // unhandled rejection.
        const dbUser = mongoose.Types.ObjectId.isValid(viewerId)
          ? await mongoService.getUserById(viewerId)
          : await mongoService.getUserByFirebaseUidCached(viewerId);
        if (!dbUser) return null;

        const conversation = await Conversation.findById(conversationId).select("participants");
        const isParticipant = !!conversation?.participants.some(
          (p) => p.toString() === dbUser._id.toString()
        );
        return isParticipant ? dbUser : null;
      } catch (error) {
        // Refuse the event rather than take the process with it.
        logger.error("Error resolving conversation membership:", error);
        return null;
      }
    };

    /**
     * An attachment on message:send is metadata the client hands over, so by
     * itself it proves nothing: a client can skip the upload endpoint entirely
     * and describe any file it likes, which would walk straight past the byte
     * check the endpoint now does. Confirm the file really was stored for THIS
     * conversation, and prefer what storage says over what the payload claims.
     *
     * Returns undefined for a plain message, null to refuse, or the metadata
     * to persist.
     */
    const verifiedAttachment = async (
      conversationId: string,
      attachment:
        | {
            provider?: unknown;
            storageId?: unknown;
            resourceType?: unknown;
            name?: unknown;
            size?: unknown;
            mimeType?: unknown;
          }
        | undefined
    ): Promise<VerifiedAttachment | null | undefined> => {
      if (!attachment) return undefined;

      const { provider, storageId, resourceType, name, size, mimeType } = attachment;
      if (provider !== "cloudinary" && provider !== "gridfs") return null;
      if (typeof storageId !== "string" || storageId.length === 0) return null;
      // mimeType was read without checking it existed, so `attachment: {}`
      // threw on .startsWith before reaching any of this.
      if (typeof mimeType !== "string" || !ALLOWED_MIME.has(mimeType)) return null;

      if (provider === "gridfs") {
        if (!mongoose.Types.ObjectId.isValid(storageId)) return null;
        const file = await findGridfsFile(new mongoose.Types.ObjectId(storageId));
        if (!file) return null;
        const owner = (file.metadata as { conversationId?: string } | undefined)?.conversationId;
        if (owner !== conversationId) return null;
        // GridFS recorded all of this at upload time; trust it over the payload.
        return {
          provider,
          storageId,
          name: file.filename,
          size: file.length,
          mimeType: file.contentType || mimeType,
        };
      }

      // Cloudinary public ids are namespaced by conversation, which is what
      // stops one conversation's message pointing at another's asset.
      if (!publicIdBelongsToConversation(storageId, conversationId)) return null;
      return {
        provider,
        storageId,
        resourceType: typeof resourceType === "string" ? resourceType : undefined,
        name: typeof name === "string" && name.length > 0 ? name.slice(0, 200) : "file",
        size:
          typeof size === "number" && Number.isFinite(size) && size > 0
            ? Math.min(size, MAX_UPLOAD_BYTES)
            : 0,
        mimeType,
      };
    };

    socket.on("join:conversation", async (conversationId: string) => {
      // Everything in a conversation room — new messages, typing, read
      // receipts — is broadcast to whoever is in it. Joining used to be
      // unconditional, so any connection could name someone else's
      // conversation and listen to it live.
      const dbUser = await conversationMember(conversationId);
      if (!dbUser) {
        // Not on `message:error`, which means "your message did not send" and
        // makes the client drop whatever it had not sent yet.
        socket.emit("conversation:join-error", {
          conversationId,
          error: "You are not part of that conversation.",
        });
        return;
      }

      socket.join(`conversation:${conversationId}`);

      // Anything already waiting here counts as delivered now that the
      // recipient is on the conversation: tell the senders so.
      try {
        const received = await Message.find({
          conversationId,
          senderId: { $ne: dbUser._id },
          isRead: false,
        }).select("_id");

        for (const msg of received) {
          io.to(`conversation:${conversationId}`).emit("message:status", {
            messageId: msg._id.toString(),
            status: "delivered",
          });
        }
      } catch (error) {
        logger.error("Error marking messages as delivered:", error);
      }
    });

    socket.on("leave:conversation", (conversationId: string) => {
      socket.leave(`conversation:${conversationId}`);
    });

    // There is no `mark:read` here any more. Nothing emitted it — the client
    // reports each message as it is actually seen — and it took the user id
    // from the payload, so any connection could clear anyone's unread badge.

    socket.on(
      "typing:start",
      ({
        conversationId,
        userId,
        userName,
      }: {
        conversationId: string;
        userId: string;
        userName?: string;
      }) => {
        socket.to(`conversation:${conversationId}`).emit("user:typing", { userId, userName });
      }
    );

    socket.on(
      "typing:stop",
      ({ conversationId, userId }: { conversationId: string; userId: string }) => {
        socket.to(`conversation:${conversationId}`).emit("user:stopped-typing", { userId });
      }
    );

    socket.on(
      "message:send",
      async (data: {
        conversationId: string;
        senderId: string;
        content: string;
        /** The message this one answers. Checked to be in this conversation. */
        replyTo?: string;
        messageType?: "text" | "image" | "file";
        attachment?: {
          provider: "cloudinary" | "gridfs";
          storageId: string;
          resourceType?: string;
          name: string;
          size: number;
          mimeType: string;
        };
      }) => {
        try {
          // Who is sending is whoever this connection signed in as, never the
          // id in the payload: that let one connection write messages under
          // someone else's name.
          const dbUser = await conversationMember(data.conversationId);
          if (!dbUser) {
            socket.emit("message:error", {
              error: "You are not signed in on this connection, or not part of that conversation.",
            });
            return;
          }

          // --- FACELINK GATE ---
          // For 1-on-1 chats, both users must have an ACTIVE mutual connection
          // before any message is persisted. This is checked BEFORE creating the
          // message so we never write (and then have to delete) a blocked message.
          // Groups are exempt; a `blocked` connection also fails this check.
          const conversationToCheck = await Conversation.findById(data.conversationId);
          if (conversationToCheck?.isGhost) {
            // A GhostLink chat has no connection behind it — redeeming the
            // link was the authorisation, and the two of them stay strangers.
            // Participation is already proven by conversationMember above, so
            // the only thing left to enforce here is the timer.
            if (await enforceGhostExpiry(conversationToCheck)) {
              socket.emit("message:error", { error: "This GhostLink chat has vanished." });
              return;
            }
          } else if (conversationToCheck && !conversationToCheck.isGroup) {
            const otherParticipantId = conversationToCheck.participants.find(
              (p) => p.toString() !== dbUser._id.toString()
            );

            if (otherParticipantId) {
              const connected = await mongoService.areConnected(
                dbUser._id.toString(),
                otherParticipantId.toString()
              );
              if (!connected) {
                socket.emit("message:error", {
                  error:
                    "Messaging is locked. You are not connected, or one of you blocked the other.",
                });
                return;
              }
            }
          }
          // ---------------------

          // Create message in MongoDB
          // An attachment decides the type; anything else is plain text, so a
          // client cannot label a bare message as an image.
          const attachment = await verifiedAttachment(data.conversationId, data.attachment);
          if (attachment === null) {
            socket.emit("message:error", {
              error: "That attachment could not be verified. Please upload it again.",
            });
            return;
          }
          const messageType = attachment
            ? attachment.mimeType.startsWith("image/")
              ? ("image" as const)
              : ("file" as const)
            : ("text" as const);

          // A reply names a message by id, and the quoted preview is built
          // from whatever that id points at — so an id from *another*
          // conversation would pull a line of someone else's chat into this
          // one. It has to belong here, and not be a tombstone.
          let replyTo: string | undefined;
          let threadRoot: string | undefined;
          let quotedSource: any = null;
          if (data.replyTo) {
            const quoted = mongoose.Types.ObjectId.isValid(data.replyTo)
              ? await Message.findById(data.replyTo).select("conversationId deletedAt threadRoot")
              : null;
            const belongsHere = quoted && quoted.conversationId.toString() === data.conversationId;
            if (!belongsHere || quoted!.deletedAt) {
              socket.emit("message:error", {
                error: "The message you replied to is no longer there.",
                tempId: (data as { tempId?: string }).tempId,
              });
              return;
            }
            replyTo = quoted!._id.toString();
            // Answering anything inside a thread joins that same thread rather
            // than starting a new one under the reply, so a side conversation
            // stays one readable list however deep people nest inside it.
            threadRoot = quoted!.threadRoot?.toString() ?? replyTo;
            // Re-read with the fields a quote needs; the check above only
            // asked which conversation it was in.
            quotedSource = await Message.findById(replyTo)
              .populate("senderId", "name")
              .select("content messageType attachment deletedAt senderId")
              .lean();
          }

          const message = await mongoService.createMessage({
            conversationId: data.conversationId,
            senderId: dbUser._id.toString(),
            content: data.content,
            replyTo,
            threadRoot,
            messageType,
            attachment,
          });

          // Populate sender info (including firebaseUid for client matching)
          const populatedMessage = await Message.findById(message._id).populate(
            "senderId",
            "username name avatar firebaseUid"
          );

          if (!populatedMessage) {
            socket.emit("message:error", { error: "Message not found" });
            return;
          }

          // Format message for client
          const senderId =
            typeof populatedMessage.senderId === "string"
              ? populatedMessage.senderId
              : (populatedMessage.senderId as any)._id.toString();

          const sender =
            typeof populatedMessage.senderId === "string" || !("name" in populatedMessage.senderId)
              ? { id: senderId, name: "Unknown", username: "unknown" }
              : {
                  id: (populatedMessage.senderId as any)._id.toString(),
                  name: (populatedMessage.senderId as any).name,
                  username: (populatedMessage.senderId as any).username,
                };

          // Get Firebase UID for matching optimistic messages
          const senderFirebaseUid =
            (populatedMessage.senderId as any)?.firebaseUid || dbUser.firebaseUid;

          const formattedMessage = {
            id: populatedMessage._id.toString(),
            conversationId: populatedMessage.conversationId.toString(),
            senderId: senderFirebaseUid, // Use Firebase UID for client matching
            content: populatedMessage.content,
            messageType: populatedMessage.messageType,
            attachment: populatedMessage.attachment
              ? {
                  provider: populatedMessage.attachment.provider,
                  storageId: populatedMessage.attachment.storageId,
                  resourceType: populatedMessage.attachment.resourceType,
                  name: populatedMessage.attachment.name,
                  size: populatedMessage.attachment.size,
                  mimeType: populatedMessage.attachment.mimeType,
                }
              : undefined,
            isPinned: populatedMessage.isPinned,
            // Built the same way the fetched page builds it, so the quote does
            // not change shape when the thread is reloaded.
            replyTo: replyTo ? buildReplyQuote(replyTo, quotedSource) : undefined,
            threadRoot,
            // Nothing can have answered a message that is only now arriving.
            replyCount: 0,
            createdAt: populatedMessage.createdAt,
            sender: {
              ...sender,
              firebaseUid: senderFirebaseUid, // Include Firebase UID in sender object too
            },
            status: "sent" as const,
          };

          // Join the conversation room if not already joined
          socket.join(`conversation:${data.conversationId}`);

          // Get conversation participants to determine who should receive the message
          const conversation = await Conversation.findById(data.conversationId).populate(
            "participants",
            "firebaseUid"
          );

          // The cached conversation list is now stale for everyone in this
          // chat: both the last message and the unread counts have moved. Drop
          // it rather than waiting for the TTL, so nobody sees an old preview.
          if (conversation) {
            await cacheDelete(
              ...conversation.participants.map((p: any) =>
                CacheKeys.conversationList(p._id.toString())
              )
            );
          }

          // Broadcast to all users in the conversation
          io.to(`conversation:${data.conversationId}`).emit("message:new", formattedMessage);

          // After a short delay, mark as delivered for recipients who are in the room
          // This simulates the message being delivered to their devices
          setTimeout(async () => {
            if (conversation) {
              const participants = conversation.participants as any[];
              const recipientIds = participants
                .filter((p: any) => p.firebaseUid && p.firebaseUid !== dbUser.firebaseUid)
                .map((p: any) => p.firebaseUid);

              if (recipientIds.length === 0) {
                return; // No recipients
              }

              // Check which recipients are currently in the conversation room
              const socketsInRoom = await io
                .in(`conversation:${data.conversationId}`)
                .fetchSockets();
              const activeRecipients = new Set<string>();

              for (const s of socketsInRoom) {
                const socketUserId = socketUserMap.get(s.id);
                if (socketUserId && recipientIds.includes(socketUserId)) {
                  activeRecipients.add(socketUserId);
                }
              }

              // If any recipients are active in the room, mark as delivered
              // The status update will be received by the sender (who sees the status)
              if (activeRecipients.size > 0) {
                io.to(`conversation:${data.conversationId}`).emit("message:status", {
                  messageId: formattedMessage.id,
                  status: "delivered",
                });
              }
              // If no recipients are in the room, status stays as "sent"
              // It will be updated to "delivered" when they join the conversation
            }
          }, 200);
        } catch (error) {
          logger.error("Error sending message:", error);
          socket.emit("message:error", { error: "Failed to send message" });
        }
      }
    );

    socket.on("message:seen", async ({ messageId }: { messageId: string; userId?: string }) => {
      try {
        if (!mongoose.Types.ObjectId.isValid(messageId)) return;

        // Only someone in the conversation can say they have seen a message
        // in it. This used to take the reader's id from the payload and
        // never check the message at all.
        const message = await Message.findById(messageId);
        if (!message) return;

        const dbUser = await conversationMember(message.conversationId.toString());
        if (!dbUser) return;
        // Your own message was never unread for you.
        if (message.senderId.toString() === dbUser._id.toString()) return;

        await Message.findByIdAndUpdate(messageId, { isRead: true });

        const conversationId = message.conversationId.toString();

        // Tell the room the message has been seen.
        io.to(`conversation:${conversationId}`).emit("message:status", {
          messageId,
          status: "seen",
        });

        // The reader's unread badge just changed, so their cached
        // conversation list is stale.
        await cacheDelete(CacheKeys.conversationList(dbUser._id.toString()));

        // Nudge the room to refetch. This used to send a whole formatted
        // conversation — an extra query and populate per message seen — that
        // the client never read: it refetches rather than trusting a count
        // worked out for whoever did the reading.
        io.to(`conversation:${conversationId}`).emit("conversation:updated", {
          id: conversationId,
        });
      } catch (error) {
        logger.error("Error updating message status:", error);
      }
    });

    /**
     * Pinning is shared: either participant can pin, and either can unpin,
     * including the other's pin. A pinned message is the conversation's note
     * to itself rather than one person's bookmark, which is why `pinnedBy` is
     * recorded and shown instead of being used to lock the other side out.
     *
     * Failures answer on `message:pin-error`, never on `message:error`. The
     * latter means "your message did not send", and the client reacts to it by
     * dropping the most recent unsent message — so reporting a failed pin
     * there deleted something the user had just typed.
     */
    socket.on(
      "message:pin",
      async ({ messageId, isPinned }: { messageId: string; isPinned: boolean }) => {
        const fail = (error: string) => socket.emit("message:pin-error", { messageId, error });
        try {
          // This used to return silently, leaving the client waiting for an
          // answer that was never coming.
          if (!mongoose.Types.ObjectId.isValid(messageId)) {
            return fail("That message no longer exists.");
          }
          // A string "false" is truthy once mongoose casts it, which would pin
          // a message the caller asked to unpin.
          if (typeof isPinned !== "boolean") {
            return fail("Could not tell whether to pin or unpin.");
          }

          const message = await Message.findById(messageId).select("conversationId");
          if (!message) return fail("That message no longer exists.");

          const conversationId = message.conversationId.toString();
          // Pinning was open to any connection, for any message id.
          const member = await conversationMember(conversationId);
          if (!member) return fail("You are not part of that conversation.");

          const pinnedAt = isPinned ? new Date() : undefined;
          // Persist the pin state so it survives reloads.
          await Message.findByIdAndUpdate(
            messageId,
            isPinned
              ? { $set: { isPinned: true, pinnedAt, pinnedBy: member._id } }
              : { $set: { isPinned: false }, $unset: { pinnedAt: 1, pinnedBy: 1 } }
          );

          // A conversation keeps only so many pins. Rather than refuse the
          // new one, the oldest steps aside — the pin just made is the newest,
          // so it is never the one evicted. Enforced here rather than in the
          // client because both sides pin into the same list, and two taps
          // arriving together would otherwise walk past any client-side count.
          let replaced: string[] = [];
          if (isPinned) {
            const allPinned = await Message.find({ conversationId, isPinned: true })
              .select("_id pinnedAt createdAt")
              .lean();
            const evicted = pinsToEvict(allPinned);
            if (evicted.length > 0) {
              replaced = evicted.map((m) => m._id.toString());
              await Message.updateMany(
                { _id: { $in: evicted.map((m) => m._id) } },
                { $set: { isPinned: false }, $unset: { pinnedAt: 1, pinnedBy: 1 } }
              );
            }
          }

          // To the conversation, not to every client connected to the server,
          // and to this socket too — both sides see the same board. `replaced`
          // rides along so one event carries the whole change: everyone clears
          // those pins, and the client that asked for this can say which.
          io.to(`conversation:${conversationId}`).emit("message:pinned", {
            messageId,
            isPinned,
            pinnedAt,
            pinnedBy: isPinned ? member._id.toString() : undefined,
            replaced,
            pinLimit: PIN_LIMIT,
          });
        } catch (error) {
          logger.error("Error pinning message:", error);
          fail("Could not save that pin. Try again.");
        }
      }
    );

    /**
     * Rewriting a message you sent.
     *
     * Only the author, only text, and only for a while — `services/messageEdits`
     * holds the reasoning. The original text is replaced rather than kept: this
     * is a chat, not a version-controlled document, and storing every draft of
     * something the sender wanted changed would be the opposite of the point.
     */
    socket.on(
      "message:edit",
      async ({ messageId, content }: { messageId: string; content: string }) => {
        const fail = (error: string) => socket.emit("message:edit-error", { messageId, error });
        try {
          if (!mongoose.Types.ObjectId.isValid(messageId)) {
            return fail("That message no longer exists.");
          }
          const text = validateEdit(content);
          if (!text.ok) return fail(text.reason);

          const message = await Message.findById(messageId);
          if (!message) return fail("That message no longer exists.");

          const conversationId = message.conversationId.toString();
          const member = await conversationMember(conversationId);
          if (!member) return fail("You are not part of that conversation.");

          const verdict = canEdit(message, member._id.toString());
          if (!verdict.ok) return fail(verdict.reason);

          const editedAt = new Date();
          const next = (content as string).trim();
          await Message.findByIdAndUpdate(messageId, { $set: { content: next, editedAt } });

          io.to(`conversation:${conversationId}`).emit("message:edited", {
            messageId,
            content: next,
            editedAt,
          });
        } catch (error) {
          logger.error("Error editing message:", error);
          fail("Could not save that edit. Try again.");
        }
      }
    );

    /**
     * Taking a message back.
     *
     * The row stays as a tombstone so the thread does not silently reshuffle
     * and a reply pointing here still has something to point at, but the text
     * and the file are actually gone — cleared in the database and deleted
     * from storage, not merely hidden by the client.
     */
    socket.on("message:delete", async ({ messageId }: { messageId: string }) => {
      const fail = (error: string) => socket.emit("message:delete-error", { messageId, error });
      try {
        if (!mongoose.Types.ObjectId.isValid(messageId)) {
          return fail("That message no longer exists.");
        }

        const message = await Message.findById(messageId);
        if (!message) return fail("That message no longer exists.");

        const conversationId = message.conversationId.toString();
        const member = await conversationMember(conversationId);
        if (!member) return fail("You are not part of that conversation.");

        const verdict = canDelete(message, member._id.toString());
        if (!verdict.ok) return fail(verdict.reason);

        // The file goes first: if clearing the row succeeded and this failed,
        // nothing would be left pointing at the bytes to try again with.
        const attachment = (message as { attachment?: any }).attachment;
        if (attachment?.provider && attachment?.storageId) {
          await deleteAttachment({
            provider: attachment.provider,
            storageId: attachment.storageId,
            resourceType: attachment.resourceType,
          });
        }

        // Unpinned at the same time: a pinned list is a list of things worth
        // going back to, and there is nothing to go back to here.
        const wasPinned = message.isPinned;
        await Message.findByIdAndUpdate(messageId, {
          $set: { content: "", deletedAt: new Date(), isPinned: false },
          $unset: { attachment: 1, pinnedAt: 1, pinnedBy: 1, editedAt: 1 },
        });

        io.to(`conversation:${conversationId}`).emit("message:deleted", {
          messageId,
          deletedAt: new Date(),
          wasPinned,
          // So the thread this belonged to can drop its count by one without
          // anyone having to refetch the page to find out.
          threadRoot: message.threadRoot?.toString(),
        });

        // The list preview quotes the last message, which may be this one.
        const conversation = await Conversation.findById(conversationId).select("participants");
        if (conversation) {
          await cacheDelete(
            ...conversation.participants.map((p: any) => CacheKeys.conversationList(p.toString()))
          );
        }
        io.to(`conversation:${conversationId}`).emit("conversation:updated", {
          id: conversationId,
        });
      } catch (error) {
        logger.error("Error deleting message:", error);
        fail("Could not delete that message. Try again.");
      }
    });

    /** Callers name someone by Firebase uid or by MongoDB id; accept either. */
    const resolveUser = async (id: string) => {
      const byFirebase = await mongoService.getUserByFirebaseUidCached(id);
      if (byFirebase) return byFirebase;
      if (mongoose.Types.ObjectId.isValid(id)) {
        return await mongoService.getUserById(id);
      }
      return null;
    };

    // --- Incoming-call signaling (ring the callee) ---
    // Caller -> server -> callee's `user:<id>` room. toUserId/fromUserId are
    // Firebase UIDs; each socket joins user:<firebaseUid> on connect.
    socket.on(
      "call:invite",
      async (
        data: {
          toUserId: string;
          fromUserId: string;
          fromName?: string;
          fromAvatar?: string;
          roomId: string;
          callType: "audio" | "video";
          conversationId?: string;
        },
        ack?: (result: { ok: boolean; message?: string }) => void
      ) => {
        if (!data?.toUserId || !data?.roomId) {
          ack?.({ ok: false, message: "Could not start the call." });
          return;
        }
        // Don't let a user ring themselves.
        if (data.toUserId === data.fromUserId) {
          ack?.({ ok: false, message: "You can't call yourself." });
          return;
        }

        // The caller never gets to say who they are: that comes from whatever
        // this socket authenticated as. The id in the payload is only a
        // fallback for a socket that never sent `user:online`. The caller is
        // told why over the ack, since they leave this page for the call
        // screen as soon as the invite goes out.
        const refuse = (message: string) => {
          socket.emit("call:error", { message });
          ack?.({ ok: false, message });
        };

        try {
          // Same two forms as conversationMember: a MongoDB id, or a Firebase
          // uid when the connection's user could not be resolved at sign-in.
          const callerId = socketUserMap.get(socket.id);
          const [caller, callee] = await Promise.all([
            callerId
              ? resolveUser(callerId)
              : mongoService.getUserByFirebaseUidCached(data.fromUserId),
            resolveUser(data.toUserId),
          ]);

          if (!caller) return refuse("Sign in again to start a call.");
          if (!callee) return refuse("That person could not be found.");
          if (caller._id.toString() === callee._id.toString()) {
            return refuse("You can't call yourself.");
          }

          // The same gate messaging uses: a 1-on-1 call needs an active mutual
          // connection, so blocking someone also stops them ringing you. Group
          // calls are exempt, as group messages are.
          let isGroup = false;
          if (data.conversationId && mongoose.Types.ObjectId.isValid(data.conversationId)) {
            const conversation = await Conversation.findById(data.conversationId).select("isGroup");
            isGroup = !!conversation?.isGroup;
          }
          if (!isGroup) {
            const connected = await mongoService.areConnected(
              caller._id.toString(),
              callee._id.toString()
            );
            if (!connected) {
              return refuse(
                "You can't call this person. You are not connected, or one of you blocked the other."
              );
            }
          }

          const callerUid = caller.firebaseUid || caller._id.toString();
          const session = {
            conversationId: data.conversationId,
            callerUid,
            calleeUid: callee.firebaseUid || data.toUserId,
            callerName: caller.name || data.fromName || "Someone",
            calleeName: callee.name || "Someone",
            callType: data.callType,
            answered: false,
            ended: false,
          };
          callSessions.set(data.roomId, session);

          // Ring with the caller's own name and avatar rather than the ones the
          // payload carried, so an incoming call cannot claim to be from
          // someone else.
          io.to(`user:${session.calleeUid}`).emit("call:incoming", {
            ...data,
            fromUserId: callerUid,
            fromName: session.callerName,
            fromAvatar: caller.avatar || data.fromAvatar,
          });
          ack?.({ ok: true });
        } catch (error) {
          logger.error("Error ringing callee:", error);
          refuse("Could not start the call. Try again.");
        }
      }
    );

    // Callee answered — let the caller stop ringing and log it in the chat.
    socket.on("call:accept", async (data: { roomId: string; toUserId: string }) => {
      if (!data?.roomId) return;
      const session = callSessions.get(data.roomId);
      if (session && !session.answered && !session.ended) {
        session.answered = true;
        session.startedAt = Date.now();
        await postCallSystemMessage(
          session.conversationId,
          session.callerUid,
          session.callType === "video"
            ? `📹 ${session.callerName} started a video call`
            : `📞 ${session.callerName} started a voice call`
        );
      }
      if (data.toUserId) {
        io.to(`user:${data.toUserId}`).emit("call:accepted", { roomId: data.roomId });
      }
    });

    // Callee declined.
    socket.on("call:decline", async (data: { toUserId: string; roomId: string }) => {
      if (!data?.toUserId) return;
      const session = callSessions.get(data.roomId);
      if (session && !session.ended) {
        session.ended = true;
        await postCallSystemMessage(
          session.conversationId,
          session.callerUid,
          `📵 ${session.calleeName} declined the call`
        );
        callSessions.delete(data.roomId);
      }
      io.to(`user:${data.toUserId}`).emit("call:declined", { roomId: data.roomId });
    });

    // Caller hung up before it was answered — stop the callee's ringing.
    socket.on("call:cancel", async (data: { toUserId: string; roomId: string }) => {
      if (!data?.toUserId) return;
      const session = callSessions.get(data.roomId);
      if (session && !session.ended) {
        session.ended = true;
        await postCallSystemMessage(
          session.conversationId,
          session.callerUid,
          `📞 Missed call from ${session.callerName}`
        );
        callSessions.delete(data.roomId);
      }
      io.to(`user:${data.toUserId}`).emit("call:cancelled", { roomId: data.roomId });
    });

    // Video call signaling handlers
    socket.on("call:join", async ({ roomId, userId }: { roomId: string; userId: string }) => {
      logger.debug(`=== CALL:JOIN EVENT RECEIVED ===`);
      logger.debug(`   Socket ID: ${socket.id}`);
      logger.debug(`   User ID: ${userId}`);
      logger.debug(`   Room ID: ${roomId}`);
      logger.debug(`   Timestamp: ${new Date().toISOString()}`);

      if (!roomId || !userId) {
        logger.error(`❌ Missing required fields: roomId=${roomId}, userId=${userId}`);
        return;
      }

      socket.join(`call:${roomId}`);
      logger.debug(`   Socket joined room: call:${roomId}`);

      // Check for duplicate user in the room
      logger.debug(`🔍 checking duplicate for room ${roomId}, User: ${userId}`);
      logger.debug(
        `   Current roomParticipants:`,
        roomParticipants.has(roomId) ? Array.from(roomParticipants.get(roomId)!) : "Empty"
      );

      if (roomParticipants.has(roomId)) {
        const existingSocketIds = Array.from(roomParticipants.get(roomId)!);
        for (const existingSocketId of existingSocketIds) {
          // Find userId for existing socket using robust map
          const existingUserId = socketUserMap.get(existingSocketId);
          logger.debug(`   Checking socket ${existingSocketId}: Maps to User ${existingUserId}`);

          if (existingUserId === userId) {
            logger.warn(
              `User ${userId} is already in room ${roomId}. Rejecting duplicate connection.`
            );
            socket.emit("call:error", {
              message: "You are already joined to this meeting in another tab or device.",
            });
            socket.leave(`call:${roomId}`); // Leave the room immediately
            return; // Stop processing
          }
        }
      }

      // Track participants - check BEFORE adding to determine if first user
      const isFirstUser = !roomParticipants.has(roomId) || roomParticipants.get(roomId)!.size === 0;
      if (!roomParticipants.has(roomId)) {
        roomParticipants.set(roomId, new Set());
      }
      roomParticipants.get(roomId)!.add(socket.id);

      // Get user data for the joining user
      let userName: string | undefined;
      let userAvatar: string | undefined;
      let dbUser;
      try {
        dbUser = await mongoService.getUserByFirebaseUidCached(userId);
        if (!dbUser && mongoose.Types.ObjectId.isValid(userId)) {
          dbUser = await mongoService.getUserById(userId);
        }
        if (dbUser) {
          userName = dbUser.name;
          userAvatar = dbUser.avatar;
          logger.debug(`Found user in DB: ${dbUser.name}, ID: ${dbUser._id}`);
        } else {
          logger.warn(`User ${userId} not found in MongoDB database`);
        }
      } catch (error) {
        logger.error("Error fetching user data:", error);
      }

      // Auto-create meeting if this is the first user joining
      logger.debug(
        `Meeting creation check - isFirstUser: ${isFirstUser}, dbUser exists: ${!!dbUser}, roomId: ${roomId}`
      );

      if (isFirstUser) {
        if (!dbUser) {
          logger.error(
            `❌ Cannot create meeting: User ${userId} not found in MongoDB. User must be registered first.`
          );
          logger.error(
            `   This usually means the user hasn't completed signup or MongoDB sync failed.`
          );
        } else {
          try {
            // One atomic upsert instead of check-then-create: two sockets
            // joining the same empty room at once used to both pass the
            // "not found" check and insert a meeting apiece.
            const { meeting: roomMeeting, created } =
              await mongoService.findOrCreateMeetingByRoomId({
                title: `Call with ${userName || "Participants"}`,
                hostId: dbUser._id.toString(),
                participants: [dbUser._id.toString()],
                startTime: new Date(),
                roomId: roomId,
                meetingType: "video",
                status: "scheduled", // active only once a 2nd user joins
              });

            if (created) {
              logger.debug(`✅ Created meeting ${roomMeeting._id} for room: ${roomId}`);
            } else {
              logger.debug(`ℹ️ Meeting already exists for room: ${roomId}, ID: ${roomMeeting._id}`);

              // CRITICAL FIX: Even if "First Socket", we must add this user to the existing meeting
              // (They might be the 2nd PERSON, but 1st SOCKET due to refresh)
              const updatedMeeting = await mongoService.addParticipantToMeeting(
                roomMeeting._id.toString(),
                dbUser._id.toString()
              );

              if (updatedMeeting) {
                const currentParticipantCount = updatedMeeting.participants.length;

                // Restart if ended
                if (roomMeeting.status === "ended") {
                  const restarted = await mongoService.activateMeeting(roomMeeting._id.toString(), {
                    restart: true,
                  });
                  await mongoService.updateMeeting(roomMeeting._id.toString(), {
                    analytics: {
                      totalDuration: roomMeeting.analytics?.totalDuration || 0,
                      participantCount: currentParticipantCount,
                      engagementScore: roomMeeting.analytics?.engagementScore || 0,
                      emotionData: roomMeeting.analytics?.emotionData || [],
                      reactions: roomMeeting.analytics?.reactions,
                    },
                  });
                  io.to(`call:${roomId}`).emit("call:meeting-active", {
                    startTime: callStartedAt(restarted),
                    meetingId: roomMeeting._id.toString(),
                  });
                }
                // ACTIVATE if scheduled and now 2 people
                else if (roomMeeting.status === "scheduled" && currentParticipantCount === 2) {
                  logger.debug(`🚀 Activating meeting (refresh case) ${roomId}`);
                  const activated = await mongoService.activateMeeting(roomMeeting._id.toString());
                  io.to(`call:${roomId}`).emit("call:meeting-active", {
                    startTime: callStartedAt(activated),
                    meetingId: roomMeeting._id.toString(),
                  });
                }
              }
            }
          } catch (error: any) {
            logger.error("❌ Error auto-creating meeting:", error);
            logger.error("Error details:", {
              message: error.message,
              code: error.code,
              name: error.name,
              stack: error.stack,
              roomId,
              userId,
              dbUserId: dbUser?._id,
              dbUserType: typeof dbUser?._id,
            });

            // Check for specific MongoDB errors
            if (error.code === 11000) {
              logger.error("❌ Duplicate key error - meeting with this roomId might already exist");
            }
            if (error.name === "ValidationError") {
              logger.error("❌ Validation error:", error.errors);
            }
            // Don't block the call if meeting creation fails, but log the error
          }
        }
      }

      // Add user to existing meeting participants if not already there (for non-first users)
      if (!isFirstUser && dbUser) {
        try {
          const existingMeeting = await mongoService.getMeetingByRoomId(roomId);
          if (existingMeeting) {
            // Atomically add participant (or just get updated doc if already there)
            const updatedMeeting = await mongoService.addParticipantToMeeting(
              existingMeeting._id.toString(),
              dbUser._id.toString()
            );

            if (updatedMeeting) {
              const currentParticipantCount = updatedMeeting.participants.length;

              // Update analytics
              await mongoService.updateMeeting(existingMeeting._id.toString(), {
                analytics: {
                  totalDuration: existingMeeting.analytics?.totalDuration || 0,
                  participantCount: currentParticipantCount,
                  engagementScore: existingMeeting.analytics?.engagementScore || 0,
                  emotionData: existingMeeting.analytics?.emotionData || [],
                },
              });

              // logic: if status is 'ended', restart it
              if (existingMeeting.status === "ended") {
                const restarted = await mongoService.activateMeeting(
                  existingMeeting._id.toString(),
                  { restart: true }
                );
                await mongoService.updateMeeting(existingMeeting._id.toString(), {
                  analytics: {
                    totalDuration: 0,
                    participantCount: currentParticipantCount,
                    engagementScore: 0,
                    emotionData: [],
                  },
                });
                // Broadcast restart
                io.to(`call:${roomId}`).emit("call:meeting-active", {
                  startTime: callStartedAt(restarted),
                  meetingId: existingMeeting._id.toString(),
                });
              }
              // logic: if status is 'scheduled' and we now have 2 people, ACTIVATE
              else if (existingMeeting.status === "scheduled" && currentParticipantCount === 2) {
                logger.debug(`🚀 Activating scheduled meeting ${roomId} - 2nd participant joined`);
                const activated = await mongoService.activateMeeting(
                  existingMeeting._id.toString()
                );

                // Broadcast start
                io.to(`call:${roomId}`).emit("call:meeting-active", {
                  startTime: callStartedAt(activated),
                  meetingId: existingMeeting._id.toString(),
                });
              }
            }
          }
        } catch (error) {
          logger.error("Error updating meeting participants:", error);
        }
      }

      // Notify others in the room
      socket.to(`call:${roomId}`).emit("call:user-joined", {
        socketId: socket.id,
        userId,
        userName,
        userAvatar,
      });

      // Send list of existing participants to the new user with their user data
      const existingSocketIds = Array.from(roomParticipants.get(roomId) || []).filter(
        (id) => id !== socket.id
      );

      // Fetch user data for all existing participants
      const participantsWithData = await Promise.all(
        existingSocketIds.map(async (socketId) => {
          // O(1) reverse lookup via socketUserMap (socketId -> userId).
          const participantUserId = socketUserMap.get(socketId);

          if (participantUserId) {
            try {
              const dbUser = await mongoService.getUserByFirebaseUidCached(participantUserId);
              return {
                socketId,
                userId: participantUserId,
                userName: dbUser?.name,
                userAvatar: dbUser?.avatar,
              };
            } catch (error) {
              logger.error("Error fetching participant data:", error);
            }
          }

          return {
            socketId,
            userId: participantUserId || "",
            userName: undefined,
            userAvatar: undefined,
          };
        })
      );

      // Get current meeting start time if active. The timer in the call counts
      // from when the call began, not from the slot it was booked for.
      let meetingStartTime = null;
      // The call screen needs the meeting's id to send the caller to its
      // summary afterwards; without it, hanging up could only go back to the
      // dashboard and every summary page was unreachable.
      let roomMeetingId: string | null = null;
      try {
        const m = await mongoService.getMeetingByRoomId(roomId);
        if (m) {
          roomMeetingId = m._id.toString();
          if (m.status === "active") {
            meetingStartTime = callStartedAt(m);
          }
        }
      } catch (e) {
        logger.error("Error fetching start time", e);
      }

      socket.emit("call:existing-users", {
        participants: participantsWithData,
        startTime: meetingStartTime,
        meetingId: roomMeetingId,
      });

      // Send previous room chat history to joining user
      try {
        const previousMessages = await mongoService.getMeetingMessages(roomId, 100);
        if (previousMessages && previousMessages.length > 0) {
          const formattedHistory = previousMessages.map((m: any) => ({
            id: m._id ? m._id.toString() : Date.now().toString(),
            socketId: "",
            userId: m.senderId?.firebaseUid || (m.senderId?._id ? m.senderId._id.toString() : ""),
            sender: m.senderId?.name || "Participant",
            avatar: m.senderId?.avatar,
            message: m.content,
            time: m.timestamp
              ? new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          }));
          socket.emit("call:chat-history", formattedHistory);
        }
      } catch (err) {
        logger.error("Error fetching chat history for joining socket:", err);
      }
    });

    const handleUserLeave = async (roomId: string, socketId: string) => {
      logger.debug(`Handling user leave for room: ${roomId}, socket: ${socketId}`);

      const wasLastUser = roomParticipants.has(roomId) && roomParticipants.get(roomId)!.size <= 1;

      if (roomParticipants.has(roomId)) {
        roomParticipants.get(roomId)!.delete(socketId);
        if (roomParticipants.get(roomId)!.size === 0) {
          roomParticipants.delete(roomId);
        }
      }

      // Update meeting status to 'ended' if this was the last user
      if (wasLastUser) {
        // Log the call outcome into the originating chat.
        const callSession = callSessions.get(roomId);
        if (callSession && !callSession.ended) {
          callSession.ended = true;
          if (callSession.answered && callSession.startedAt) {
            await postCallSystemMessage(
              callSession.conversationId,
              callSession.callerUid,
              `📞 Call ended · ${formatCallDuration(Date.now() - callSession.startedAt)}`
            );
          } else {
            // Caller gave up before it was answered.
            await postCallSystemMessage(
              callSession.conversationId,
              callSession.callerUid,
              `📞 Missed call from ${callSession.callerName}`
            );
            io.to(`user:${callSession.calleeUid}`).emit("call:cancelled", { roomId });
          }
          callSessions.delete(roomId);
        }

        try {
          const existingMeeting = await mongoService.getMeetingByRoomId(roomId);

          // MISSED CALL DETECTION
          // If only 1 participant was ever in the meeting when it ends (or acts as end)
          // Ad-hoc rooms have no conversation behind them, so there is nobody
          // to notify and nothing to look up.
          if (
            existingMeeting &&
            existingMeeting.participants.length === 1 &&
            isConversationId(roomId)
          ) {
            try {
              const conversation = await Conversation.findById(roomId);
              if (conversation) {
                const missedCallUserIds = conversation.participants
                  .map((p) => p.toString())
                  .filter((pId) => pId !== existingMeeting.participants[0].toString());

                const hostUser = await User.findById(existingMeeting.participants[0]);
                const hostName = hostUser ? hostUser.name : "Someone";

                // Send notifications
                const notifications = missedCallUserIds.map((userId) => ({
                  userId,
                  type: "missed_call",
                  title: "Missed Call 📞",
                  message: `You missed a call from ${hostName}`,
                  relatedId: existingMeeting._id,
                }));

                if (notifications.length > 0) {
                  await Notification.create(notifications);
                }
              }
            } catch (e) {
              logger.error("Error creating missed call notifications:", e);
            }
          }

          if (existingMeeting && existingMeeting.status === "active") {
            const endTime = new Date();
            // Measured from when the call actually began. Using the scheduled
            // startTime reported the gap since the booking instead: a meeting
            // booked weeks earlier and then held for a minute recorded weeks.
            const startTime = existingMeeting.actualStartTime ?? existingMeeting.startTime;
            const durationMs = Math.max(0, endTime.getTime() - startTime.getTime());
            // Ensure at least 1 minute if duration is very sort, or ceil
            const durationMinutes = Math.max(1, Math.ceil(durationMs / (1000 * 60)));

            // Get final participant count (before this user left)
            const finalParticipantCount = existingMeeting.participants.length;

            // Calculate engagement score
            let score = 0;
            // 1. Duration (max 40)
            score += Math.min(durationMinutes * 2, 40);

            // 2. Participation (max 20)
            score += Math.min(finalParticipantCount * 5, 20);

            // 3. Reactions (max 20)
            const reactionsMap = existingMeeting.analytics?.reactions;
            let totalReactions = 0;
            if (reactionsMap) {
              if (reactionsMap instanceof Map) {
                totalReactions = Array.from(reactionsMap.values()).reduce((a, b) => a + b, 0);
              } else {
                totalReactions = Object.values(reactionsMap).reduce(
                  (a: any, b: any) => a + b,
                  0
                ) as number;
              }
            }
            score += Math.min(totalReactions * 2, 20);

            // 4. Emotion Sentiment (max 20)
            const emotionData = existingMeeting.analytics?.emotionData || [];
            if (emotionData.length > 5) {
              const positiveEmotions = emotionData.filter((e: any) =>
                ["Happy", "Surprised"].includes(e.emotion)
              ).length;
              score += Math.round((positiveEmotions / emotionData.length) * 20);
            }

            const engagementScore = Math.min(Math.round(score), 100);

            // Update meeting with end time, status, and analytics
            await mongoService.updateMeeting(existingMeeting._id.toString(), {
              status: "ended",
              endTime: endTime,
              analytics: {
                totalDuration: durationMinutes, // Duration in minutes
                participantCount: finalParticipantCount,
                engagementScore,
                emotionData: existingMeeting.analytics?.emotionData || [],
                reactions: existingMeeting.analytics?.reactions,
              },
            });
            logger.debug(
              `Marked meeting as ended for room: ${roomId}, duration: ${durationMinutes} minutes, participants: ${finalParticipantCount}`
            );
          }
        } catch (error) {
          logger.error("Error updating meeting status on leave:", error);
        }
      } else {
        // Update participant count in analytics even if not the last user
        try {
          const existingMeeting = await mongoService.getMeetingByRoomId(roomId);
          if (existingMeeting && existingMeeting.status === "active") {
            const currentParticipantCount = roomParticipants.get(roomId)?.size || 0;
            await mongoService.updateMeeting(existingMeeting._id.toString(), {
              analytics: {
                totalDuration: existingMeeting.analytics?.totalDuration || 0,
                participantCount: currentParticipantCount,
                engagementScore: existingMeeting.analytics?.engagementScore || 0,
                emotionData: existingMeeting.analytics?.emotionData || [],
                reactions: existingMeeting.analytics?.reactions,
              },
            });
          }
        } catch (error) {
          logger.error("Error updating participant count:", error);
        }
      }

      // Use io.to to ensure delivery even if socket has left/disconnected
      io.to(`call:${roomId}`).emit("call:user-left", { socketId });
    };

    socket.on("call:leave", async ({ roomId }: { roomId: string }) => {
      logger.debug(`User leaving call room: ${roomId}`);
      socket.leave(`call:${roomId}`);
      await handleUserLeave(roomId, socket.id);
    });

    // Generic signaling for simple-peer
    socket.on(
      "call:signal",
      ({ targetSocketId, signal }: { targetSocketId: string; signal: any; roomId: string }) => {
        io.to(targetSocketId).emit("call:signal", {
          signal,
          senderId: socket.id,
        });
      }
    );

    socket.on(
      "call:toggle-media",
      ({
        roomId,
        mediaType,
        enabled,
      }: {
        roomId: string;
        mediaType: "audio" | "video";
        enabled: boolean;
      }) => {
        socket.to(`call:${roomId}`).emit("call:media-toggled", {
          socketId: socket.id,
          mediaType,
          enabled,
        });
      }
    );

    socket.on("call:reaction", async ({ roomId, emoji }: { roomId: string; emoji: string }) => {
      // Broadcast reaction immediately for UI
      socket.to(`call:${roomId}`).emit("call:reaction", {
        socketId: socket.id,
        emoji,
      });

      // Update reaction count in database
      try {
        const meeting = await mongoService.getMeetingByRoomId(roomId);
        if (meeting && meeting.status === "active") {
          // Use a dynamic key for the map update
          const updateKey = `analytics.reactions.${emoji}`;
          const update: any = { $inc: {} };
          update.$inc[updateKey] = 1;

          await Meeting.findByIdAndUpdate(meeting._id, update);
        }
      } catch (error) {
        logger.error("Error updating reaction analytics:", error);
      }
    });

    socket.on(
      "call:audio-stream",
      async ({ roomId, audioData }: { roomId: string; audioData: Buffer }) => {
        try {
          const userId = socketUserMap.get(socket.id);
          if (!userId) return; // Only authenticated users

          // Basic validation - ignore very small empty chunks
          if (!audioData || audioData.length < 1000) return;

          // Console log every chunk for debugging
          logger.debug(`🎤 Received audio chunk from ${userId} (${audioData.length} bytes)`);

          const result = await transcriptionService.transcribe(audioData, "audio.webm");

          if (result.text && result.text.trim().length > 0) {
            logger.debug(`🎤 Transcription result (${roomId}): "${result.text}"`);

            // Fetch user name for display
            let speakerName = "Speaker";
            try {
              // `name` is what a user is called here; there is no `displayName`
              // on this model, so asking for one always fell through to the
              // username and captions never showed a real name.
              const user = await User.findById(userId).select("name username");
              if (user) {
                speakerName = user.name || user.username || "Speaker";
              }
            } catch (e) {
              logger.error("Error fetching speaker name:", e);
            }

            // Broadcast to room
            io.to(`call:${roomId}`).emit("call:caption", {
              userId: userId,
              userName: speakerName, // Send name directly
              text: result.text,
              timestamp: Date.now(),
              isFinal: true,
            });
          }
        } catch (error: any) {
          // Silent fail for transcription errors to not spam logs too much
          if (error.message && !error.message.includes("401")) {
            logger.error("Transcription error:", error.message);
          }
        }
      }
    );

    socket.on(
      "call:emotion",
      async ({
        roomId,
        emotion,
        percentage,
      }: {
        roomId: string;
        emotion: string;
        percentage: number;
      }) => {
        logger.debug(
          `[SERVER] call:emotion received from ${socket.id} for room ${roomId}: ${emotion}`
        );

        // Broadcast to others in the call
        socket.to(`call:${roomId}`).emit("call:emotion", {
          socketId: socket.id,
          emotion,
          percentage,
        });
        logger.debug(`[SERVER] Broadcasted emotion to room call:${roomId}`);

        try {
          const meeting = await mongoService.getMeetingByRoomId(roomId);
          // Allow recording in 'scheduled' state too, so solo testing works
          if (meeting && (meeting.status === "active" || meeting.status === "scheduled")) {
            // Push new emotion data point
            // We limit the size of this array to prevent unbound growth for long meetings
            await Meeting.findByIdAndUpdate(meeting._id, {
              $push: {
                "analytics.emotionData": {
                  emotion,
                  percentage,
                  timestamp: new Date(),
                  count: 1,
                },
              },
            });
          }
        } catch (error) {
          logger.error("Error logging emotion data:", error);
        }
      }
    );

    // Call chat messages
    socket.on(
      "call:chat-message",
      async ({ roomId, message, userId }: { roomId: string; message: string; userId: string }) => {
        try {
          logger.debug("=== SERVER: Received chat message ===");
          logger.debug("Room ID:", roomId);
          logger.debug("Message:", message);
          logger.debug("User ID:", userId);
          logger.debug("Socket ID:", socket.id);

          if (!roomId || !message || !userId) {
            logger.error("Missing required fields:", { roomId, message, userId });
            return;
          }

          // Verify socket is in the room
          const roomName = `call:${roomId}`;
          const socketRooms = Array.from(socket.rooms);
          logger.debug("Socket rooms:", socketRooms);
          logger.debug("Target room name:", roomName);
          logger.debug("Is socket in room?", socketRooms.includes(roomName));

          if (!socketRooms.includes(roomName)) {
            logger.warn(`Socket ${socket.id} not in room ${roomName}, joining now`);
            socket.join(roomName);
            logger.debug("Socket joined room, new rooms:", Array.from(socket.rooms));
          }

          // Get user data for the sender
          let userName: string | undefined;
          let userAvatar: string | undefined;
          try {
            const dbUser = await mongoService.getUserByFirebaseUidCached(userId);
            if (dbUser) {
              userName = dbUser.name;
              userAvatar = dbUser.avatar;
            }
          } catch (error) {
            logger.error("Error fetching user data for chat:", error);
          }

          const messageData = {
            id: Date.now().toString(),
            socketId: socket.id,
            userId,
            sender: userName || "Unknown",
            avatar: userAvatar,
            message: message.trim(),
            time: new Date().toISOString(),
          };

          logger.debug("=== SERVER: Broadcasting chat message ===");
          logger.debug("Room name:", roomName);
          logger.debug("Message data:", JSON.stringify(messageData, null, 2));
          logger.debug("Socket rooms:", Array.from(socket.rooms));

          // Broadcast message to all participants in the room (including sender)
          logger.debug("Broadcasting to room:", roomName);
          io.to(roomName).emit("call:chat-message", messageData);

          // Persist message to MongoDB Atlas
          try {
            let dbUser = await mongoService.getUserByFirebaseUidCached(userId);
            if (!dbUser && mongoose.Types.ObjectId.isValid(userId)) {
              dbUser = await mongoService.getUserById(userId);
            }

            if (dbUser) {
              const meeting = await mongoService.getMeetingByRoomId(roomId);
              await mongoService.createChatMessage({
                meetingId: meeting?._id?.toString(),
                roomId: roomId,
                senderId: dbUser._id.toString(),
                content: message.trim(),
              });
              logger.debug(`✅ Saved chat message to DB for room: ${roomId}`);
            }
          } catch (dbErr) {
            logger.error("Error persisting chat message to DB:", dbErr);
          }

          logger.debug("=== SERVER: Message broadcast complete ===");
        } catch (error) {
          logger.error("Error handling chat message:", error);
        }
      }
    );

    // H: Caption Received
    socket.on(
      "call:caption",
      ({ roomId, text, userId }: { roomId: string; text: string; userId: string }) => {
        // Broadcast caption to all other participants in the room
        socket.to(`call:${roomId}`).emit("call:caption", {
          userId,
          text,
          timestamp: Date.now(),
        });
      }
    );

    socket.on("disconnect", async () => {
      logger.debug("Client disconnected:", socket.id);

      // Remove from all call rooms
      for (const [roomId, participants] of Array.from(roomParticipants.entries())) {
        if (participants.has(socket.id)) {
          // Use handleUserLeave to ensure DB updates happen even on disconnect
          await handleUserLeave(roomId, socket.id);
        }
      }

      const userId = socketUserMap.get(socket.id);
      if (userId) {
        userSockets.delete(userId);
        socketUserMap.delete(socket.id); // Clean up reverse mapping
        await setUserOnlineStatus(userId, false);
        io.emit("user:status", { userId, online: false });
      }
    });
  });

  // Debug/test endpoints — only registered outside production to avoid
  // exposing database internals or meeting-creation scaffolding publicly.
  if (process.env.NODE_ENV !== "production") {
    // Test endpoint to manually create a meeting (for debugging)
    app.post("/api/test/create-meeting", authenticate, async (req, res) => {
      try {
        if (!req.user?.dbUser) {
          return res.status(400).json({ error: "User not found in MongoDB" });
        }

        const dbUser = req.user.dbUser;
        const testRoomId = `test-${Date.now()}`;

        logger.info("🧪 TEST: Creating meeting manually");
        logger.info("   User ID:", dbUser._id);
        logger.info("   Room ID:", testRoomId);

        const meeting = await mongoService.createMeeting({
          title: "Test Meeting",
          hostId: dbUser._id.toString(),
          participants: [dbUser._id.toString()],
          startTime: new Date(),
          roomId: testRoomId,
          meetingType: "video",
          status: "active",
        });

        logger.info("✅ TEST: Meeting created successfully:", meeting._id);

        // Verify it was saved
        const verifyMeeting = await mongoService.getMeetingByRoomId(testRoomId);
        if (verifyMeeting) {
          res.json({
            success: true,
            meeting: {
              _id: meeting._id,
              roomId: meeting.roomId,
              title: meeting.title,
              status: meeting.status,
              verified: true,
            },
          });
        } else {
          res.status(500).json({
            success: false,
            error: "Meeting created but not found in database",
            meetingId: meeting._id,
          });
        }
      } catch (error: any) {
        logger.error("❌ TEST: Error creating meeting:", error);
        res.status(500).json({
          success: false,
          error: error.message,
          details: error,
        });
      }
    });

    // Database check endpoint (for debugging)
    app.get("/api/db/check", async (req, res) => {
      try {
        const db = mongoose.connection.db;
        if (!db) {
          return res.status(503).json({
            error: "Database not connected",
            status: mongoose.connection.readyState,
          });
        }

        const states = ["disconnected", "connected", "connecting", "disconnecting"];
        const connectionState = mongoose.connection.readyState;

        const collections = await db.listCollections().toArray();

        // Get recent meetings for debugging
        const recentMeetings = await Meeting.find()
          .sort({ createdAt: -1 })
          .limit(5)
          .select("_id roomId title status startTime hostId participants createdAt")
          .lean()
          .catch(() => []);

        const stats = {
          status: states[connectionState],
          readyState: connectionState,
          database: db.databaseName,
          collections: collections.map((c) => c.name),
          models: {
            users: await User.countDocuments().catch(() => null),
            meetings: await Meeting.countDocuments().catch(() => null),
            conversations: await Conversation.countDocuments().catch(() => null),
            messages: await Message.countDocuments().catch(() => null),
            chatMessages: await ChatMessage.countDocuments().catch(() => null),
          },
          recentMeetings: recentMeetings,
        };

        res.json(stats);
      } catch (error: any) {
        res.status(500).json({
          error: "Failed to check database",
          message: error.message,
        });
      }
    });
  } // end non-production debug endpoints

  app.get("/api/health", async (req, res) => {
    try {
      const health = await mongoHealthCheck();
      res.status(health.status === "healthy" ? 200 : 503).json(health);
    } catch (error) {
      res.status(503).json({
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
        database: "mongodb",
      });
    }
  });

  return httpServer;
}

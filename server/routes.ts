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
import { Message, Conversation, User, Meeting, ChatMessage, Connection, Notification } from "./models";
import { authenticate, optionalAuthenticate } from "./middleware/auth";
import { authRateLimiter, apiRateLimiter, usernameCheckRateLimiter } from "./middleware/rateLimiter";
import { createOTP, verifyOTP } from "./services/otpService";
import { transcriptionService } from "./services/transcription";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/user";
import chatRoutes from "./routes/chat";
import meetingRoutes from "./routes/meeting";
import discoveryRoutes from "./routes/discovery";

import notificationRoutes from "./routes/notification";
import inviteRoutes from "./routes/invite";

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === "production" ? false : "*"),
      methods: ["GET", "POST"],
      credentials: true,
    }
  });

  // Make IO accessible in routes
  app.set("io", io);

  // Register API Routes
  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/chat", chatRoutes);
  app.use("/api/meetings", meetingRoutes);
  app.use("/api/discovery", discoveryRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/invites", inviteRoutes);


  const userSockets = new Map<string, string>();
  const socketUserMap = new Map<string, string>(); // socketId -> userId
  const roomParticipants = new Map<string, Set<string>>(); // roomId -> Set of socketIds

  // Twilio Verify client (for phone number verification)
  // const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
  // const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  // const twilioVerifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  // const twilioClient =
  //   twilioAccountSid && twilioAuthToken
  //     ? twilio(twilioAccountSid, twilioAuthToken)
  //     : null;

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("user:online", async (data: { firebaseToken: string }) => {
      try {
        const decodedToken = await verifyFirebaseToken(data.firebaseToken);
        const userId = decodedToken.uid;

        // Use createOrUpdateUser to handle existing users
        const user = await mongoService.createOrUpdateUser({
          firebaseUid: userId,
          email: decodedToken.email || '',
          name: decodedToken.name || '',
          username: decodedToken.email?.split('@')[0] || 'user',
        });

        userSockets.set(userId, socket.id);
        socketUserMap.set(socket.id, userId);
        await setUserOnlineStatus(userId, true);
        io.emit("user:status", { userId, online: true });

        // Join user-specific room for individual updates
        socket.join(`user:${user._id.toString()}`);

        const meetings = await mongoService.getUserMeetings(user._id.toString());
        meetings.forEach(meeting => {
          socket.join(`meeting:${meeting._id.toString()}`);
        });

        socket.emit("user:authenticated", { userId, user });
      } catch (error) {
        console.error("Authentication error:", error);
        socket.emit("error", { message: "Authentication failed" });
      }
    });

    socket.on("join:conversation", async (conversationId: string) => {
      socket.join(`conversation:${conversationId}`);

      // Mark messages sent by others as delivered when user joins conversation
      // Get the socket's user from userSockets map
      const userId = Array.from(userSockets.entries()).find(([, socketId]) => socketId === socket.id)?.[0];
      if (userId) {
        try {
          const dbUser = await mongoService.getUserByFirebaseUid(userId);
          if (dbUser) {
            // Find all messages in this conversation that are not from this user
            // These are messages sent by others that this user is receiving
            const receivedMessages = await Message.find({
              conversationId,
              senderId: { $ne: dbUser._id.toString() },
              isRead: false
            }).populate('senderId', '_id');

            // For each message received, update its status to "delivered" for the sender
            // This tells the sender that their message was delivered
            for (const msg of receivedMessages) {
              // Emit status update to conversation room (sender will see "delivered")
              io.to(`conversation:${conversationId}`).emit("message:status", {
                messageId: msg._id.toString(),
                status: "delivered"
              });
            }
          }
        } catch (error) {
          console.error("Error marking messages as delivered:", error);
        }
      }
    });

    socket.on("leave:conversation", (conversationId: string) => {
      socket.leave(`conversation:${conversationId}`);
    });

    socket.on("mark:read", async ({ conversationId, userId }: { conversationId: string; userId: string }) => {
      try {
        // Get user from MongoDB
        const dbUser = await mongoService.getUserByFirebaseUid(userId);
        if (!dbUser) {
          console.error("User not found for mark read");
          return;
        }

        // Mark all unread messages as read for this user in this conversation
        await Message.updateMany(
          {
            conversationId,
            senderId: { $ne: dbUser._id.toString() },
            isRead: false
          },
          { isRead: true }
        );

        // Get updated unread count
        const conversation = await Conversation.findById(conversationId);
        if (conversation) {
          await conversation.populate('participants', 'username name email avatar firebaseUid');
          const unreadCount = await Message.countDocuments({
            conversationId: conversation._id,
            senderId: { $ne: dbUser._id.toString() },
            isRead: false
          });

          // Format and broadcast to all participants
          const formattedConv = {
            id: conversation._id.toString(),
            name: conversation.name,
            isGroup: conversation.isGroup,
            participants: conversation.participants.map((p: any) => ({
              id: p._id.toString(),
              firebaseUid: p.firebaseUid,
              name: p.name,
              username: p.username,
              avatar: p.avatar,
              online: false
            })),
            unreadCount
          };

          // Broadcast to all participants using Firebase UID
          conversation.participants.forEach((p: any) => {
            if (p.firebaseUid) {
              io.emit("conversation:updated", formattedConv);
            }
          });
        }
      } catch (error) {
        console.error("Error marking messages as read:", error);
      }
    });

    socket.on("typing:start", ({ conversationId, userId, userName }: { conversationId: string; userId: string; userName?: string }) => {
      socket.to(`conversation:${conversationId}`).emit("user:typing", { userId, userName });
    });

    socket.on("typing:stop", ({ conversationId, userId }: { conversationId: string; userId: string }) => {
      socket.to(`conversation:${conversationId}`).emit("user:stopped-typing", { userId });
    });

    socket.on("message:send", async (data: { conversationId: string; senderId: string; content: string }) => {
      try {
        // Get user from MongoDB
        const dbUser = await mongoService.getUserByFirebaseUid(data.senderId);
        if (!dbUser) {
          socket.emit("message:error", { error: "User not found" });
          return;
        }

        // Create message in MongoDB
        const message = await mongoService.createMessage({
          conversationId: data.conversationId,
          senderId: dbUser._id.toString(),
          content: data.content,
          messageType: 'text'
        });

        // Populate sender info (including firebaseUid for client matching)
        const populatedMessage = await Message.findById(message._id)
          .populate('senderId', 'username name avatar firebaseUid');

        if (!populatedMessage) {
          socket.emit("message:error", { error: "Message not found" });
          return;
        }

        // --- MUTUAL SEARCH GUARD ---
        // Verify that the sender and receiver have a mutual connection
        // For groups, we might need different logic, but for 1-on-1:
        const conversationToCheck = await Conversation.findById(data.conversationId);
        if (conversationToCheck && !conversationToCheck.isGroup) {
          const otherParticipantId = conversationToCheck.participants.find(p => p.toString() !== dbUser._id.toString());

          if (otherParticipantId) {
            // const connection = await Connection.findOne({
            //   participants: { $all: [dbUser._id, otherParticipantId] },
            //   status: 'active'
            // });
            //

            // if (!connection) {
            //   // NO MUTUAL CONNECTION! Block message.
            //   // (Optional: Allow if they are 'friends' in the future)
            //
            //   socket.emit("message:error", { error: "Messaging locked. You must both discover each other first." });

            //   // Delete the message we just optimistically created
            //   await Message.findByIdAndDelete(message._id);
            //   return;
            // }
          }
        }
        // ---------------------------

        // Format message for client
        const senderId = typeof populatedMessage.senderId === 'string'
          ? populatedMessage.senderId
          : (populatedMessage.senderId as any)._id.toString();

        const sender = typeof populatedMessage.senderId === 'string' || !('name' in populatedMessage.senderId)
          ? { id: senderId, name: 'Unknown', username: 'unknown' }
          : {
            id: (populatedMessage.senderId as any)._id.toString(),
            name: (populatedMessage.senderId as any).name,
            username: (populatedMessage.senderId as any).username
          };

        // Get Firebase UID for matching optimistic messages
        const senderFirebaseUid = (populatedMessage.senderId as any)?.firebaseUid || data.senderId;

        const formattedMessage = {
          id: populatedMessage._id.toString(),
          conversationId: populatedMessage.conversationId.toString(),
          senderId: senderFirebaseUid, // Use Firebase UID for client matching
          content: populatedMessage.content,
          isPinned: populatedMessage.isPinned,
          createdAt: populatedMessage.createdAt,
          sender: {
            ...sender,
            firebaseUid: senderFirebaseUid // Include Firebase UID in sender object too
          },
          status: "sent" as const
        };

        // Join the conversation room if not already joined
        socket.join(`conversation:${data.conversationId}`);

        // Get conversation participants to determine who should receive the message
        const conversation = await Conversation.findById(data.conversationId)
          .populate('participants', 'firebaseUid');

        // Broadcast to all users in the conversation
        io.to(`conversation:${data.conversationId}`).emit("message:new", formattedMessage);

        // After a short delay, mark as delivered for recipients who are in the room
        // This simulates the message being delivered to their devices
        setTimeout(async () => {
          if (conversation) {
            const participants = conversation.participants as any[];
            const recipientIds = participants
              .filter((p: any) => p.firebaseUid && p.firebaseUid !== data.senderId)
              .map((p: any) => p.firebaseUid);

            if (recipientIds.length === 0) {
              return; // No recipients
            }

            // Check which recipients are currently in the conversation room
            const socketsInRoom = await io.in(`conversation:${data.conversationId}`).fetchSockets();
            const activeRecipients = new Set<string>();

            for (const s of socketsInRoom) {
              const socketUserId = Array.from(userSockets.entries()).find(([, socketId]) => socketId === s.id)?.[0];
              if (socketUserId && recipientIds.includes(socketUserId)) {
                activeRecipients.add(socketUserId);
              }
            }

            // If any recipients are active in the room, mark as delivered
            // The status update will be received by the sender (who sees the status)
            if (activeRecipients.size > 0) {
              io.to(`conversation:${data.conversationId}`).emit("message:status", {
                messageId: formattedMessage.id,
                status: "delivered"
              });
            }
            // If no recipients are in the room, status stays as "sent"
            // It will be updated to "delivered" when they join the conversation
          }
        }, 200);
      } catch (error) {
        console.error("Error sending message:", error);
        socket.emit("message:error", { error: "Failed to send message" });
      }
    });

    socket.on("message:seen", async ({ messageId, userId }: { messageId: string; userId: string }) => {
      try {
        // Get user from MongoDB
        const dbUser = await mongoService.getUserByFirebaseUid(userId);
        if (!dbUser) {
          console.error("User not found for seen status");
          return;
        }

        // Update message as read in database
        await Message.findByIdAndUpdate(messageId, {
          isRead: true
        });

        // Get the conversation to update unread count
        const message = await Message.findById(messageId);
        if (message) {
          // Emit status update to conversation room (not all clients)
          io.to(`conversation:${message.conversationId.toString()}`).emit("message:status", {
            messageId,
            status: "seen"
          });

          // Broadcast updated conversation with new unread count
          const conversation = await Conversation.findById(message.conversationId.toString());
          if (conversation) {
            await conversation.populate('participants', 'username name email avatar firebaseUid');
            const unreadCount = await Message.countDocuments({
              conversationId: conversation._id,
              senderId: { $ne: dbUser._id.toString() },
              isRead: false
            });

            // Format and broadcast to all participants
            const formattedConv = {
              id: conversation._id.toString(),
              name: conversation.name,
              isGroup: conversation.isGroup,
              participants: conversation.participants.map((p: any) => ({
                id: p._id.toString(),
                firebaseUid: p.firebaseUid,
                name: p.name,
                username: p.username,
                avatar: p.avatar,
                online: false
              })),
              unreadCount
            };

            // Broadcast to all participants in the conversation room
            io.to(`conversation:${message.conversationId.toString()}`).emit("conversation:updated", formattedConv);
          }
        }
      } catch (error) {
        console.error("Error updating message status:", error);
      }
    });

    socket.on("message:pin", async ({ messageId, isPinned }: { messageId: string; isPinned: boolean }) => {
      try {
        // For now, just emit the pin update without database persistence
        io.emit("message:pinned", { messageId, isPinned });
      } catch (error) {
        console.error("Error pinning message:", error);
      }
    });

    // Video call signaling handlers
    socket.on("call:join", async ({ roomId, userId }: { roomId: string; userId: string }) => {
      console.log(`=== CALL:JOIN EVENT RECEIVED ===`);
      console.log(`   Socket ID: ${socket.id}`);
      console.log(`   User ID: ${userId}`);
      console.log(`   Room ID: ${roomId}`);
      console.log(`   Timestamp: ${new Date().toISOString()}`);

      if (!roomId || !userId) {
        console.error(`❌ Missing required fields: roomId=${roomId}, userId=${userId}`);
        return;
      }

      socket.join(`call:${roomId}`);
      console.log(`   Socket joined room: call:${roomId}`);

      // Check for duplicate user in the room
      console.log(`🔍 checking duplicate for room ${roomId}, User: ${userId}`);
      console.log(`   Current roomParticipants:`, roomParticipants.has(roomId) ? Array.from(roomParticipants.get(roomId)!) : "Empty");

      if (roomParticipants.has(roomId)) {
        const existingSocketIds = Array.from(roomParticipants.get(roomId)!);
        for (const existingSocketId of existingSocketIds) {
          // Find userId for existing socket using robust map
          const existingUserId = socketUserMap.get(existingSocketId);
          console.log(`   Checking socket ${existingSocketId}: Maps to User ${existingUserId}`);

          if (existingUserId === userId) {
            console.warn(`User ${userId} is already in room ${roomId}. Rejecting duplicate connection.`);
            socket.emit("call:error", { message: "You are already joined to this meeting in another tab or device." });
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
        dbUser = await mongoService.getUserByFirebaseUid(userId);
        if (dbUser) {
          userName = dbUser.name;
          userAvatar = dbUser.avatar;
          console.log(`Found user in DB: ${dbUser.name}, ID: ${dbUser._id}`);
        } else {
          console.warn(`User ${userId} not found in MongoDB database`);
        }
      } catch (error) {
        console.error("Error fetching user data:", error);
      }

      // Auto-create meeting if this is the first user joining
      console.log(`Meeting creation check - isFirstUser: ${isFirstUser}, dbUser exists: ${!!dbUser}, roomId: ${roomId}`);

      if (isFirstUser) {
        if (!dbUser) {
          console.error(`❌ Cannot create meeting: User ${userId} not found in MongoDB. User must be registered first.`);
          console.error(`   This usually means the user hasn't completed signup or MongoDB sync failed.`);
        } else {
          try {
            console.log(`🔍 Checking for existing meeting with roomId: ${roomId}`);
            // Check if meeting already exists for this room
            const existingMeeting = await mongoService.getMeetingByRoomId(roomId);
            console.log(`   Existing meeting check result: ${existingMeeting ? `Found (${existingMeeting._id})` : 'Not found'}`);

            if (!existingMeeting) {
              // Create a new meeting
              console.log(`📝 Creating new meeting for room: ${roomId}`);
              console.log(`   Host ID: ${dbUser._id} (${typeof dbUser._id})`);
              console.log(`   Host ID string: ${dbUser._id.toString()}`);
              console.log(`   Participants: [${dbUser._id.toString()}]`);
              console.log(`   Room ID: ${roomId}`);

              const meetingData = {
                title: `Call with ${userName || 'Participants'}`,
                hostId: dbUser._id.toString(),
                participants: [dbUser._id.toString()],
                startTime: new Date(),
                roomId: roomId,
                meetingType: 'video' as const,
                status: 'scheduled' as const // Start as scheduled, active only when 2nd user joins
              };

              console.log(`   Meeting data prepared:`, meetingData);

              const newMeeting = await mongoService.createMeeting(meetingData);
              console.log(`✅ Successfully created meeting: ${newMeeting._id} for room: ${roomId}`);
              console.log(`   Meeting saved with ID: ${newMeeting._id}`);

              // Verify it was actually saved
              const verifyMeeting = await mongoService.getMeetingByRoomId(roomId);
              if (verifyMeeting) {
                console.log(`✅ Verification: Meeting found in DB: ${verifyMeeting._id}`);
              } else {
                console.error(`❌ Verification FAILED: Meeting not found in DB after creation!`);
              }
            } else {
              console.log(`ℹ️ Meeting already exists for room: ${roomId}, ID: ${existingMeeting._id}`);

              // CRITICAL FIX: Even if "First Socket", we must add this user to the existing meeting
              // (They might be the 2nd PERSON, but 1st SOCKET due to refresh)
              const updatedMeeting = await mongoService.addParticipantToMeeting(existingMeeting._id.toString(), dbUser._id.toString());

              if (updatedMeeting) {
                const currentParticipantCount = updatedMeeting.participants.length;

                // Restart if ended
                if (existingMeeting.status === 'ended') {
                  const newStartTime = new Date();
                  await mongoService.updateMeeting(existingMeeting._id.toString(), {
                    status: 'active',
                    startTime: newStartTime,
                    endTime: undefined,
                    analytics: { participantCount: currentParticipantCount }
                  });
                  io.to(`call:${roomId}`).emit("call:meeting-active", { startTime: newStartTime.toISOString() });
                }
                // ACTIVATE if scheduled and now 2 people
                else if (existingMeeting.status === 'scheduled' && currentParticipantCount === 2) {
                  console.log(`🚀 Activating meeting (refresh case) ${roomId}`);
                  const newStartTime = new Date();
                  await mongoService.updateMeeting(existingMeeting._id.toString(), {
                    status: 'active',
                    startTime: newStartTime
                  });
                  io.to(`call:${roomId}`).emit("call:meeting-active", { startTime: newStartTime.toISOString() });
                }
              }
            }
          } catch (error: any) {
            console.error("❌ Error auto-creating meeting:", error);
            console.error("Error details:", {
              message: error.message,
              code: error.code,
              name: error.name,
              stack: error.stack,
              roomId,
              userId,
              dbUserId: dbUser?._id,
              dbUserType: typeof dbUser?._id
            });

            // Check for specific MongoDB errors
            if (error.code === 11000) {
              console.error("❌ Duplicate key error - meeting with this roomId might already exist");
            }
            if (error.name === 'ValidationError') {
              console.error("❌ Validation error:", error.errors);
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
            const updatedMeeting = await mongoService.addParticipantToMeeting(existingMeeting._id.toString(), dbUser._id.toString());

            if (updatedMeeting) {
              const currentParticipantCount = updatedMeeting.participants.length;

              // Update analytics
              await mongoService.updateMeeting(existingMeeting._id.toString(), {
                analytics: {
                  totalDuration: existingMeeting.analytics?.totalDuration || 0,
                  participantCount: currentParticipantCount,
                  engagementScore: existingMeeting.analytics?.engagementScore || 0,
                  emotionData: existingMeeting.analytics?.emotionData || []
                }
              });

              // logic: if status is 'ended', restart it
              if (existingMeeting.status === 'ended') {
                const newStartTime = new Date();
                await mongoService.updateMeeting(existingMeeting._id.toString(), {
                  status: 'active',
                  startTime: newStartTime,
                  endTime: undefined,
                  analytics: {
                    totalDuration: 0,
                    participantCount: currentParticipantCount,
                    engagementScore: 0,
                    emotionData: []
                  }
                });
                // Broadcast restart
                io.to(`call:${roomId}`).emit("call:meeting-active", { startTime: newStartTime.toISOString() });
              }
              // logic: if status is 'scheduled' and we now have 2 people, ACTIVATE
              else if (existingMeeting.status === 'scheduled' && currentParticipantCount === 2) {
                console.log(`🚀 Activating scheduled meeting ${roomId} - 2nd participant joined`);
                const newStartTime = new Date();
                await mongoService.updateMeeting(existingMeeting._id.toString(), {
                  status: 'active',
                  startTime: newStartTime
                });

                // Broadcast start
                io.to(`call:${roomId}`).emit("call:meeting-active", { startTime: newStartTime.toISOString() });
              }
            }
          }
        } catch (error) {
          console.error("Error updating meeting participants:", error);
        }
      }

      // Notify others in the room
      socket.to(`call:${roomId}`).emit("call:user-joined", {
        socketId: socket.id,
        userId,
        userName,
        userAvatar
      });

      // Send list of existing participants to the new user with their user data
      const existingSocketIds = Array.from(roomParticipants.get(roomId) || [])
        .filter(id => id !== socket.id);

      // Fetch user data for all existing participants
      const participantsWithData = await Promise.all(
        existingSocketIds.map(async (socketId) => {
          // Find userId for this socketId
          const participantUserId = Array.from(userSockets.entries())
            .find(([, sid]) => sid === socketId)?.[0];

          if (participantUserId) {
            try {
              const dbUser = await mongoService.getUserByFirebaseUid(participantUserId);
              return {
                socketId,
                userId: participantUserId,
                userName: dbUser?.name,
                userAvatar: dbUser?.avatar
              };
            } catch (error) {
              console.error("Error fetching participant data:", error);
            }
          }

          return {
            socketId,
            userId: participantUserId || "",
            userName: undefined,
            userAvatar: undefined
          };
        })
      );

      // Get current meeting start time if active
      let meetingStartTime = null;
      try {
        const m = await mongoService.getMeetingByRoomId(roomId);
        if (m && m.status === 'active' && m.startTime) {
          meetingStartTime = m.startTime.toISOString();
        }
      } catch (e) { console.error("Error fetching start time", e); }

      socket.emit("call:existing-users", {
        participants: participantsWithData,
        startTime: meetingStartTime
      });
    });

    const handleUserLeave = async (roomId: string, socketId: string) => {
      console.log(`Handling user leave for room: ${roomId}, socket: ${socketId}`);

      const wasLastUser = roomParticipants.has(roomId) && roomParticipants.get(roomId)!.size <= 1;

      if (roomParticipants.has(roomId)) {
        roomParticipants.get(roomId)!.delete(socketId);
        if (roomParticipants.get(roomId)!.size === 0) {
          roomParticipants.delete(roomId);
        }
      }

      // Update meeting status to 'ended' if this was the last user
      if (wasLastUser) {
        try {
          const existingMeeting = await mongoService.getMeetingByRoomId(roomId);

          // MISSED CALL DETECTION
          // If only 1 participant was ever in the meeting when it ends (or acts as end)
          if (existingMeeting && existingMeeting.participants.length === 1) {
            try {
              // Assuming roomId is conversationId
              const conversation = await Conversation.findById(roomId);
              if (conversation) {
                const missedCallUserIds = conversation.participants
                  .map(p => p.toString())
                  .filter(pId => pId !== existingMeeting.participants[0].toString());

                const hostUser = await User.findById(existingMeeting.participants[0]);
                const hostName = hostUser ? hostUser.name : "Someone";

                // Send notifications
                const notifications = missedCallUserIds.map(userId => ({
                  userId,
                  type: "missed_call",
                  title: "Missed Call 📞",
                  message: `You missed a call from ${hostName}`,
                  relatedId: existingMeeting._id
                }));

                if (notifications.length > 0) {
                  await Notification.create(notifications);
                }
              }
            } catch (e) {
              console.error("Error creating missed call notifications:", e);
            }
          }

          if (existingMeeting && existingMeeting.status === 'active') {
            const endTime = new Date();
            const startTime = existingMeeting.startTime;
            const durationMs = endTime.getTime() - startTime.getTime();
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
                totalReactions = Object.values(reactionsMap).reduce((a: any, b: any) => a + b, 0) as number;
              }
            }
            score += Math.min(totalReactions * 2, 20);

            // 4. Emotion Sentiment (max 20)
            const emotionData = existingMeeting.analytics?.emotionData || [];
            if (emotionData.length > 5) {
              const positiveEmotions = emotionData.filter((e: any) => ["Happy", "Surprised"].includes(e.emotion)).length;
              score += Math.round((positiveEmotions / emotionData.length) * 20);
            }

            const engagementScore = Math.min(Math.round(score), 100);

            // Update meeting with end time, status, and analytics
            await mongoService.updateMeeting(existingMeeting._id.toString(), {
              status: 'ended',
              endTime: endTime,
              analytics: {
                totalDuration: durationMinutes, // Duration in minutes
                participantCount: finalParticipantCount,
                engagementScore,
                emotionData: existingMeeting.analytics?.emotionData || [],
                reactions: existingMeeting.analytics?.reactions
              }
            });
            console.log(`Marked meeting as ended for room: ${roomId}, duration: ${durationMinutes} minutes, participants: ${finalParticipantCount}`);
          }
        } catch (error) {
          console.error("Error updating meeting status on leave:", error);
        }
      } else {
        // Update participant count in analytics even if not the last user
        try {
          const existingMeeting = await mongoService.getMeetingByRoomId(roomId);
          if (existingMeeting && existingMeeting.status === 'active') {
            const currentParticipantCount = roomParticipants.get(roomId)?.size || 0;
            await mongoService.updateMeeting(existingMeeting._id.toString(), {
              analytics: {
                totalDuration: existingMeeting.analytics?.totalDuration || 0,
                participantCount: currentParticipantCount,
                engagementScore: existingMeeting.analytics?.engagementScore || 0,
                emotionData: existingMeeting.analytics?.emotionData || [],
                reactions: existingMeeting.analytics?.reactions
              }
            });
          }
        } catch (error) {
          console.error("Error updating participant count:", error);
        }
      }

      // Use io.to to ensure delivery even if socket has left/disconnected
      io.to(`call:${roomId}`).emit("call:user-left", { socketId });
    };

    socket.on("call:leave", async ({ roomId }: { roomId: string }) => {
      console.log(`User leaving call room: ${roomId}`);
      socket.leave(`call:${roomId}`);
      await handleUserLeave(roomId, socket.id);
    });

    // Generic signaling for simple-peer
    socket.on("call:signal", ({ targetSocketId, signal, roomId }: { targetSocketId: string; signal: any; roomId: string }) => {
      io.to(targetSocketId).emit("call:signal", {
        signal,
        senderId: socket.id
      });
    });

    socket.on("call:toggle-media", ({ roomId, mediaType, enabled }: {
      roomId: string;
      mediaType: "audio" | "video";
      enabled: boolean
    }) => {
      socket.to(`call:${roomId}`).emit("call:media-toggled", {
        socketId: socket.id,
        mediaType,
        enabled
      });
    });

    socket.on("call:reaction", async ({ roomId, emoji }: { roomId: string; emoji: string }) => {
      // Broadcast reaction immediately for UI
      socket.to(`call:${roomId}`).emit("call:reaction", {
        socketId: socket.id,
        emoji
      });

      // Update reaction count in database
      try {
        const meeting = await mongoService.getMeetingByRoomId(roomId);
        if (meeting && meeting.status === 'active') {
          // Use a dynamic key for the map update
          const updateKey = `analytics.reactions.${emoji}`;
          const update: any = { $inc: {} };
          update.$inc[updateKey] = 1;

          await Meeting.findByIdAndUpdate(meeting._id, update);
        }
      } catch (error) {
        console.error("Error updating reaction analytics:", error);
      }
    });

    socket.on("call:audio-stream", async ({ roomId, audioData }: { roomId: string; audioData: Buffer }) => {
      try {
        const userId = socketUserMap.get(socket.id);
        if (!userId) return; // Only authenticated users

        // Basic validation - ignore very small empty chunks
        if (!audioData || audioData.length < 1000) return;

        // Console log every chunk for debugging
        console.log(`🎤 Received audio chunk from ${userId} (${audioData.length} bytes)`);

        const result = await transcriptionService.transcribe(audioData, 'audio.webm');

        if (result.text && result.text.trim().length > 0) {
          console.log(`🎤 Transcription result (${roomId}): "${result.text}"`);

          // Fetch user name for display
          let speakerName = "Speaker";
          try {
            // We can fetch from DB or maybe we have a cache. For now, DB fetch is safe.
            // We need to import User model if not available in this scope, but it is available in file.
            const user = await User.findById(userId);
            if (user) {
              speakerName = (user as any).displayName || user.username || "Speaker";
            }
          } catch (e) {
            console.error("Error fetching speaker name:", e);
          }

          // Broadcast to room
          io.to(`call:${roomId}`).emit("call:caption", {
            userId: userId,
            userName: speakerName, // Send name directly
            text: result.text,
            timestamp: Date.now(),
            isFinal: true
          });
        }
      } catch (error: any) {
        // Silent fail for transcription errors to not spam logs too much
        if (error.message && !error.message.includes("401")) {
          console.error("Transcription error:", error.message);
        }
      }
    });

    socket.on("call:emotion", async ({ roomId, emotion, percentage }: { roomId: string; emotion: string; percentage: number }) => {
      console.log(`[SERVER] call:emotion received from ${socket.id} for room ${roomId}: ${emotion}`);

      // Broadcast to others in the call
      socket.to(`call:${roomId}`).emit("call:emotion", {
        socketId: socket.id,
        emotion,
        percentage
      });
      console.log(`[SERVER] Broadcasted emotion to room call:${roomId}`);

      try {
        const meeting = await mongoService.getMeetingByRoomId(roomId);
        // Allow recording in 'scheduled' state too, so solo testing works
        if (meeting && (meeting.status === 'active' || meeting.status === 'scheduled')) {
          // Push new emotion data point
          // We limit the size of this array to prevent unbound growth for long meetings
          await Meeting.findByIdAndUpdate(meeting._id, {
            $push: {
              "analytics.emotionData": {
                emotion,
                percentage,
                timestamp: new Date(),
                count: 1
              }
            }
          });
        }
      } catch (error) {
        console.error("Error logging emotion data:", error);
      }
    });

    // Call chat messages
    socket.on("call:chat-message", async ({ roomId, message, userId }: {
      roomId: string;
      message: string;
      userId: string
    }) => {
      try {
        console.log("=== SERVER: Received chat message ===");
        console.log("Room ID:", roomId);
        console.log("Message:", message);
        console.log("User ID:", userId);
        console.log("Socket ID:", socket.id);

        if (!roomId || !message || !userId) {
          console.error("Missing required fields:", { roomId, message, userId });
          return;
        }

        // Verify socket is in the room
        const roomName = `call:${roomId}`;
        const socketRooms = Array.from(socket.rooms);
        console.log("Socket rooms:", socketRooms);
        console.log("Target room name:", roomName);
        console.log("Is socket in room?", socketRooms.includes(roomName));

        if (!socketRooms.includes(roomName)) {
          console.warn(`Socket ${socket.id} not in room ${roomName}, joining now`);
          socket.join(roomName);
          console.log("Socket joined room, new rooms:", Array.from(socket.rooms));
        }

        // Get user data for the sender
        let userName: string | undefined;
        let userAvatar: string | undefined;
        try {
          const dbUser = await mongoService.getUserByFirebaseUid(userId);
          if (dbUser) {
            userName = dbUser.name;
            userAvatar = dbUser.avatar;
          }
        } catch (error) {
          console.error("Error fetching user data for chat:", error);
        }

        const messageData = {
          id: Date.now().toString(),
          socketId: socket.id,
          userId,
          sender: userName || "Unknown",
          avatar: userAvatar,
          message: message.trim(),
          time: new Date().toISOString()
        };

        console.log("=== SERVER: Broadcasting chat message ===");
        console.log("Room name:", roomName);
        console.log("Message data:", JSON.stringify(messageData, null, 2));
        console.log("Socket rooms:", Array.from(socket.rooms));

        // Broadcast message to all participants in the room (including sender)
        // Use io.to() to broadcast to all sockets in the room
        console.log("Broadcasting to room:", roomName);
        io.to(roomName).emit("call:chat-message", messageData);

        console.log("=== SERVER: Message broadcast complete ===");
      } catch (error) {
        console.error("Error handling chat message:", error);
      }
    });

    // H: Caption Received
    socket.on("call:caption", ({ roomId, text, userId }: { roomId: string, text: string, userId: string }) => {
      // Broadcast caption to all other participants in the room
      socket.to(`call:${roomId}`).emit("call:caption", {
        userId,
        text,
        timestamp: Date.now()
      });
    });

    socket.on("disconnect", async () => {
      console.log("Client disconnected:", socket.id);

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

  // Test endpoint to manually create a meeting (for debugging)
  app.post("/api/test/create-meeting", authenticate, async (req, res) => {
    try {
      if (!req.user?.dbUser) {
        return res.status(400).json({ error: "User not found in MongoDB" });
      }

      const dbUser = req.user.dbUser;
      const testRoomId = `test-${Date.now()}`;

      console.log("🧪 TEST: Creating meeting manually");
      console.log("   User ID:", dbUser._id);
      console.log("   Room ID:", testRoomId);

      const meeting = await mongoService.createMeeting({
        title: "Test Meeting",
        hostId: dbUser._id.toString(),
        participants: [dbUser._id.toString()],
        startTime: new Date(),
        roomId: testRoomId,
        meetingType: 'video',
        status: 'active'
      });

      console.log("✅ TEST: Meeting created successfully:", meeting._id);

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
            verified: true
          }
        });
      } else {
        res.status(500).json({
          success: false,
          error: "Meeting created but not found in database",
          meetingId: meeting._id
        });
      }
    } catch (error: any) {
      console.error("❌ TEST: Error creating meeting:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        details: error
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
          status: mongoose.connection.readyState
        });
      }

      const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
      const connectionState = mongoose.connection.readyState;

      const collections = await db.listCollections().toArray();

      // Get recent meetings for debugging
      const recentMeetings = await Meeting.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select('_id roomId title status startTime hostId participants createdAt')
        .lean()
        .catch(() => []);

      const stats = {
        status: states[connectionState],
        readyState: connectionState,
        database: db.databaseName,
        collections: collections.map(c => c.name),
        models: {
          users: await User.countDocuments().catch(() => null),
          meetings: await Meeting.countDocuments().catch(() => null),
          conversations: await Conversation.countDocuments().catch(() => null),
          messages: await Message.countDocuments().catch(() => null),
          chatMessages: await ChatMessage.countDocuments().catch(() => null),
        },
        recentMeetings: recentMeetings
      };

      res.json(stats);
    } catch (error: any) {
      res.status(500).json({
        error: "Failed to check database",
        message: error.message
      });
    }
  });

  app.get("/api/health", async (req, res) => {
    try {
      const health = await mongoHealthCheck();
      res.status(health.status === "healthy" ? 200 : 503).json(health);
    } catch (error) {
      res.status(503).json({
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
        database: "mongodb"
      });
    }
  });

  // Register modular routes
  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/conversations", chatRoutes);
  app.use("/api/meetings", meetingRoutes);

  return httpServer;
}
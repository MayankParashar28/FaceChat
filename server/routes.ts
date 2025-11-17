import type { Express } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import mongoose from "mongoose";
import { mongoService } from "./services/mongodb";
import { verifyFirebaseToken, setUserOnlineStatus } from "./firebase/admin";
import { mongoHealthCheck } from "./database/mongodb";
import { Message, Conversation } from "./models";
import { authenticate, optionalAuthenticate } from "./middleware/auth";
import { authRateLimiter, apiRateLimiter, usernameCheckRateLimiter } from "./middleware/rateLimiter";
import { createOTP, verifyOTP } from "./services/otpService";

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === "production" ? false : "*"),
      methods: ["GET", "POST"],
      credentials: true,
    }
  });

  const userSockets = new Map<string, string>();
  const roomParticipants = new Map<string, Set<string>>(); // roomId -> Set of socketIds

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
      console.log(`User ${userId} joining call room: ${roomId}`);
      socket.join(`call:${roomId}`);
      
      // Track participants
      if (!roomParticipants.has(roomId)) {
        roomParticipants.set(roomId, new Set());
      }
      roomParticipants.get(roomId)!.add(socket.id);
      
      // Get user data for the joining user
      let userName: string | undefined;
      let userAvatar: string | undefined;
      try {
        const dbUser = await mongoService.getUserByFirebaseUid(userId);
        if (dbUser) {
          userName = dbUser.name;
          userAvatar = dbUser.avatar;
        }
      } catch (error) {
        console.error("Error fetching user data:", error);
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
      
      socket.emit("call:existing-users", { participants: participantsWithData });
    });

    socket.on("call:leave", ({ roomId }: { roomId: string }) => {
      console.log(`User leaving call room: ${roomId}`);
      socket.leave(`call:${roomId}`);
      
      if (roomParticipants.has(roomId)) {
        roomParticipants.get(roomId)!.delete(socket.id);
        if (roomParticipants.get(roomId)!.size === 0) {
          roomParticipants.delete(roomId);
        }
      }
      
      socket.to(`call:${roomId}`).emit("call:user-left", { socketId: socket.id });
    });

    // WebRTC signaling
    socket.on("call:offer", ({ roomId, offer, targetSocketId }: { 
      roomId: string; 
      offer: RTCSessionDescriptionInit; 
      targetSocketId: string 
    }) => {
      socket.to(targetSocketId).emit("call:offer", {
        offer,
        socketId: socket.id
      });
    });

    socket.on("call:answer", ({ roomId, answer, targetSocketId }: { 
      roomId: string; 
      answer: RTCSessionDescriptionInit; 
      targetSocketId: string 
    }) => {
      socket.to(targetSocketId).emit("call:answer", {
        answer,
        socketId: socket.id
      });
    });

    socket.on("call:ice-candidate", ({ roomId, candidate, targetSocketId }: { 
      roomId: string; 
      candidate: RTCIceCandidateInit; 
      targetSocketId: string 
    }) => {
      socket.to(targetSocketId).emit("call:ice-candidate", {
        candidate,
        socketId: socket.id
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

    socket.on("disconnect", async () => {
      console.log("Client disconnected:", socket.id);
      
      // Remove from all call rooms
      for (const [roomId, participants] of roomParticipants.entries()) {
        if (participants.has(socket.id)) {
          participants.delete(socket.id);
          io.to(`call:${roomId}`).emit("call:user-left", { socketId: socket.id });
          if (participants.size === 0) {
            roomParticipants.delete(roomId);
          }
        }
      }
      
      const userId = Array.from(userSockets.entries()).find(([, socketId]) => socketId === socket.id)?.[0];
      if (userId) {
        userSockets.delete(userId);
        await setUserOnlineStatus(userId, false);
        io.emit("user:status", { userId, online: false });
      }
    });
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
        }
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

  // Auth routes (OTP verification)
  // Send OTP for email verification
  app.post("/api/auth/send-otp", authRateLimiter, authenticate, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { email } = req.body;
      const userEmail = email || req.user.email;

      if (!userEmail) {
        return res.status(400).json({ error: "Email is required" });
      }

      // Verify the email matches the authenticated user
      if (userEmail.toLowerCase() !== req.user.email?.toLowerCase()) {
        return res.status(403).json({ error: "Email does not match authenticated user" });
      }

      // Create and send OTP
      await createOTP(userEmail, "email_verification");

      res.json({ 
        success: true, 
        message: "Verification code sent to your email",
        // In development, return the OTP in the response (remove in production)
        ...(process.env.NODE_ENV === "development" && { 
          otp: "Check console for OTP (development only)" 
        })
      });
    } catch (error: any) {
      console.error("Error sending OTP:", error);
      res.status(500).json({ error: error.message || "Failed to send verification code" });
    }
  });

  // Verify OTP
  app.post("/api/auth/verify-otp", authRateLimiter, authenticate, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { email, otp } = req.body;

      if (!email || !otp) {
        return res.status(400).json({ error: "Email and OTP are required" });
      }

      // Verify the email matches the authenticated user
      if (email.toLowerCase() !== req.user.email?.toLowerCase()) {
        return res.status(403).json({ error: "Email does not match authenticated user" });
      }

      // Verify OTP
      const verified = await verifyOTP(email, otp, "email_verification");

      if (verified) {
        res.json({ 
          verified: true, 
          message: "Email verified successfully" 
        });
      } else {
        res.status(400).json({ error: "Invalid verification code" });
      }
    } catch (error: any) {
      console.error("Error verifying OTP:", error);
      res.status(400).json({ error: error.message || "Verification failed" });
    }
  });

  // Resend OTP
  app.post("/api/auth/resend-otp", authRateLimiter, authenticate, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { email } = req.body;
      const userEmail = email || req.user.email;

      if (!userEmail) {
        return res.status(400).json({ error: "Email is required" });
      }

      // Verify the email matches the authenticated user
      if (userEmail.toLowerCase() !== req.user.email?.toLowerCase()) {
        return res.status(403).json({ error: "Email does not match authenticated user" });
      }

      // Create and send new OTP
      await createOTP(userEmail, "email_verification");

      res.json({ 
        success: true, 
        message: "New verification code sent to your email",
        // In development, return the OTP in the response (remove in production)
        ...(process.env.NODE_ENV === "development" && { 
          otp: "Check console for OTP (development only)" 
        })
      });
    } catch (error: any) {
      console.error("Error resending OTP:", error);
      res.status(500).json({ error: error.message || "Failed to resend verification code" });
    }
  });

  // User routes
  // Rate limit user creation/update (use apiRateLimiter for sync, authRateLimiter is too strict)
  app.post("/api/users", apiRateLimiter, authenticate, async (req, res) => {
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
  app.get("/api/users/search", apiRateLimiter, authenticate, async (req, res) => {
    try {
      const { q, limit } = req.query as { q?: string; limit?: string };
      if (!q || q.trim().length < 2) {
        return res.status(400).json({ error: "Query 'q' must be at least 2 characters" });
      }

      const max = Math.max(1, Math.min(25, Number(limit) || 10));
      const users = await mongoService.searchUsersByUsername(q.trim(), max);

      // Return minimal safe fields
      const result = users.map((u) => ({
        id: u._id.toString(),
        name: u.name,
        username: u.username,
        email: u.email,
        avatar: (u as any).avatar ?? null,
      }));

      res.json(result);
    } catch (error) {
      console.error("Error searching users:", error);
      res.status(500).json({ error: "Failed to search users" });
    }
  });

  app.get("/api/users/:id", authenticate, async (req, res) => {
    try {
      const user = await mongoService.getUserById(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  // Check if username is available (rate limited to prevent abuse)
  app.get("/api/users/check-username/:username", usernameCheckRateLimiter, authenticate, async (req, res) => {
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
  app.get("/api/users/suggestions/:baseUsername", authenticate, async (req, res) => {
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

  // Meeting routes
  app.post("/api/meetings", apiRateLimiter, authenticate, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { firebaseToken, ...meetingData } = req.body;

      const meeting = await mongoService.createMeeting({
        ...meetingData,
        hostId: req.user.uid
      });

      res.json(meeting);
    } catch (error) {
      console.error("Error creating meeting:", error);
      res.status(500).json({ error: "Failed to create meeting" });
    }
  });

  // Get current user's meetings
  app.get("/api/meetings", authenticate, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const dbUser = req.user.dbUser || await mongoService.getUserByFirebaseUid(req.user.uid);
      if (!dbUser) {
        return res.status(404).json({ error: "User not found" });
      }

      // Get limit and skip from query params
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = parseInt(req.query.skip as string) || 0;
      const status = req.query.status as string | undefined; // Optional filter by status

      let meetings = await mongoService.getUserMeetings(dbUser._id.toString());

      // Filter by status if provided
      if (status) {
        meetings = meetings.filter(m => m.status === status);
      }

      // Only return ended meetings for recent calls, sort by endTime or startTime desc
      meetings = meetings
        .filter(m => m.status === 'ended')
        .sort((a, b) => {
          const aTime = a.endTime?.getTime() || a.startTime.getTime();
          const bTime = b.endTime?.getTime() || b.startTime.getTime();
          return bTime - aTime;
        })
        .slice(skip, skip + limit);

      res.json(meetings);
    } catch (error) {
      console.error("Error fetching user meetings:", error);
      res.status(500).json({ error: "Failed to fetch meetings" });
    }
  });

  app.get("/api/meetings/:id", authenticate, async (req, res) => {
    try {
      const meeting = await mongoService.getMeetingById(req.params.id);
      if (!meeting) {
        return res.status(404).json({ error: "Meeting not found" });
      }
      res.json(meeting);
    } catch (error) {
      console.error("Error fetching meeting:", error);
      res.status(500).json({ error: "Failed to fetch meeting" });
    }
  });

  app.get("/api/users/:userId/meetings", authenticate, async (req, res) => {
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

  // Chat routes
  app.get("/api/meetings/:meetingId/messages", authenticate, async (req, res) => {
    try {
      const messages = await mongoService.getMeetingMessages(req.params.meetingId);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  // Conversation routes
  app.get("/api/conversations", authenticate, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      // Use authenticated user's ID instead of query parameter for security
      const userId = req.user.uid;
      
      // userId is Firebase UID, we need to get the MongoDB user
      const dbUser = req.user.dbUser || await mongoService.getUserByFirebaseUid(userId);
      
      console.log("API Call: Fetching conversations for userId:", userId);
      
      if (!dbUser) {
        // User doesn't exist in MongoDB yet - return mock data for demo
        console.log("User not found in MongoDB, returning mock data");
        
        const mockConversations = [
          {
            id: "conv-1",
            name: null,
            isGroup: false,
            participants: [
              {
                id: userId as string,
                name: "You",
                username: "user",
                online: true
              },
              {
                id: "user-2",
                name: "John Doe",
                username: "sarahj",
                online: true
              }
            ],
            lastMessage: {
              id: "msg-1",
              conversationId: "conv-1",
              senderId: "user-2",
              content: "Hey! How are you doing?",
              isPinned: false,
              createdAt: new Date(Date.now() - 1000 * 60 * 5),
              sender: {
                id: "user-2",
                name: "Sarah Johnson",
                username: "sarahj"
              },
              status: "delivered"
            },
            unreadCount: 2
          },
          {
            id: "conv-2",
            name: "Team Standup",
            isGroup: true,
            participants: [
              {
                id: userId as string,
                name: "You",
                username: "user",
                online: true
              },
              {
                id: "user-3",
                name: "Mike Chen",
                username: "mikec",
                online: false
              },
              {
                id: "user-4",
                name: "Emily Davis",
                username: "emilyd",
                online: true
              }
            ],
            lastMessage: {
              id: "msg-2",
              conversationId: "conv-2",
              senderId: "user-4",
              content: "Great work on the presentation! 🎉",
              isPinned: false,
              createdAt: new Date(Date.now() - 1000 * 60 * 30),
              sender: {
                id: "user-4",
                name: "Emily Davis",
                username: "emilyd"
              },
              status: "seen"
            },
            unreadCount: 0
          }
        ];
        
        return res.json(mockConversations);
      }

      console.log("Fetching conversations for MongoDB user:", dbUser._id.toString());
      
      // Get conversations from MongoDB using MongoDB user ID
      const conversations = await mongoService.getUserConversations(dbUser._id.toString());
      
      console.log("Found conversations:", conversations.length);
      
      // If no conversations in MongoDB, return mock data for demo
      if (conversations.length === 0) {
        const mockConversations = [
          {
            id: "conv-1",
            name: null,
            isGroup: false,
            participants: [
              {
                id: userId as string,
                name: dbUser.name,
                username: dbUser.username,
                online: true
              },
              {
                id: "user-2",
                name: "Sarah Johnson",
                username: "sarahj",
                online: true
              }
            ],
            lastMessage: {
              id: "msg-1",
              conversationId: "conv-1",
              senderId: "user-2",
              content: "Hey! How are you doing?",
              isPinned: false,
              createdAt: new Date(Date.now() - 1000 * 60 * 5),
              sender: {
                id: "user-2",
                name: "Sarah Johnson",
                username: "sarahj"
              },
              status: "delivered"
            },
            unreadCount: 2
          }
        ];
        return res.json(mockConversations);
      }
      
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // Keep old mock data as fallback
  app.get("/api/conversations/mock", authenticate, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const userId = req.user.uid;

      // For now, return mock data until we implement conversation logic
      const mockConversations = [
        {
          id: "conv-1",
          name: null,
          isGroup: false,
          participants: [
            {
              id: userId as string,
              name: "John Doe",
              username: "johndoe",
              online: true
            },
            {
              id: "user-2",
              name: "Sarah Johnson",
              username: "sarahj",
              online: true
            }
          ],
          lastMessage: {
            id: "msg-1",
            conversationId: "conv-1",
            senderId: "user-2",
            content: "Hey! How are you doing?",
            isPinned: false,
            createdAt: new Date(Date.now() - 1000 * 60 * 5), // 5 minutes ago
            sender: {
              id: "user-2",
              name: "Sarah Johnson",
              username: "sarahj"
            },
            status: "delivered"
          },
          unreadCount: 2
        },
        {
          id: "conv-2",
          name: "Team Standup",
          isGroup: true,
          participants: [
            {
              id: userId as string,
              name: "John Doe",
              username: "johndoe",
              online: true
            },
            {
              id: "user-3",
              name: "Mike Chen",
              username: "mikec",
              online: false
            },
            {
              id: "user-4",
              name: "Emily Davis",
              username: "emilyd",
              online: true
            }
          ],
          lastMessage: {
            id: "msg-2",
            conversationId: "conv-2",
            senderId: "user-4",
            content: "Great work on the presentation! 🎉",
            isPinned: false,
            createdAt: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
            sender: {
              id: "user-4",
              name: "Emily Davis",
              username: "emilyd"
            },
            status: "seen"
          },
          unreadCount: 0
        },
        {
          id: "conv-3",
          name: null,
          isGroup: false,
          participants: [
            {
              id: userId as string,
              name: "John Doe",
              username: "johndoe",
              online: true
            },
            {
              id: "user-5",
              name: "Alex Wilson",
              username: "alexw",
              online: false
            }
          ],
          lastMessage: {
            id: "msg-3",
            conversationId: "conv-3",
            senderId: userId as string,
            content: "Thanks for the help with the project!",
            isPinned: false,
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
            sender: {
              id: userId as string,
              name: "John Doe",
              username: "johndoe"
            },
            status: "seen"
          },
          unreadCount: 0
        }
      ];

      res.json(mockConversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  app.get("/api/conversations/:conversationId/messages", authenticate, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { conversationId } = req.params;
      const { beforeDate, limit } = req.query;

      // Use authenticated user's ID instead of query parameter
      const userId = req.user.uid;

      console.log("Fetching messages for conversation:", conversationId, "userId:", userId, "beforeDate:", beforeDate);

      // Verify user is a participant in this conversation
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      const dbUser = req.user.dbUser || await mongoService.getUserByFirebaseUid(userId);
      if (!dbUser) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check if user is a participant
      const isParticipant = conversation.participants.some(
        (p) => p.toString() === dbUser._id.toString()
      );
      
      if (!isParticipant) {
        return res.status(403).json({ error: "Access denied" });
      }

      const limitNum = limit ? parseInt(limit as string, 10) : 50;
      const beforeDateObj = beforeDate ? new Date(beforeDate as string) : undefined;

      // Get messages from MongoDB with pagination
      const messages = await mongoService.getConversationMessages(
        conversationId, 
        dbUser._id.toString(),
        limitNum,
        beforeDateObj
      );
      
      console.log("Returning messages:", messages.length);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      // Return empty array to prevent client errors
      res.json([]);
    }
  });

  // Create conversation endpoint
  app.post("/api/conversations", apiRateLimiter, authenticate, async (req, res) => {
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
      const creatorUser = req.user.dbUser || await mongoService.getUserByFirebaseUid(createdBy);
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
        const participantObjectIds = mongoParticipantIds.map(id => new mongoose.Types.ObjectId(id));
        
        const existingConv = await Conversation.findOne({
          participants: { $all: participantObjectIds, $size: participantObjectIds.length },
          isDeleted: false
        });

        if (existingConv) {
          await existingConv.populate('participants', 'username name email avatar firebaseUid');
          await existingConv.populate('lastMessage');
          
          const lastMessage = existingConv.lastMessage 
            ? await Message.findById(existingConv.lastMessage).populate('senderId', 'username name')
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
              online: false
            })),
            lastMessage: lastMessage && typeof lastMessage.senderId !== 'string' && 'name' in lastMessage.senderId ? {
              id: lastMessage._id.toString(),
              conversationId: existingConv._id.toString(),
              senderId: (lastMessage.senderId as any)._id.toString(),
              content: lastMessage.content,
              isPinned: lastMessage.isPinned,
              createdAt: lastMessage.createdAt,
              sender: {
                id: (lastMessage.senderId as any)._id.toString(),
                name: (lastMessage.senderId as any).name,
                username: (lastMessage.senderId as any).username
              }
            } : undefined,
            unreadCount: 0
          });
        }
      }

      const conversation = await mongoService.createConversation(mongoParticipantIds, mongoCreatedBy, name);
      
      // Populate and format response
      await conversation.populate('participants', 'username name email avatar firebaseUid');
      await conversation.populate('createdBy', 'username name');
      
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
          online: false
        })),
        createdBy: conversation.createdBy,
        unreadCount: 0
      });
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });

  return httpServer;
}
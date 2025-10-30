import type { Express } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import mongoose from "mongoose";
import { mongoService } from "./services/mongodb";
import { verifyFirebaseToken, setUserOnlineStatus } from "./firebase/admin";
import { mongoHealthCheck } from "./database/mongodb";
import { Message, Conversation } from "./models";

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const userSockets = new Map<string, string>();

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

    socket.on("join:conversation", (conversationId: string) => {
      socket.join(`conversation:${conversationId}`);
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

        // Populate sender info
        const populatedMessage = await Message.findById(message._id)
          .populate('senderId', 'username name avatar');

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

        const formattedMessage = {
          id: populatedMessage._id.toString(),
          conversationId: populatedMessage.conversationId.toString(),
          senderId,
          content: populatedMessage.content,
          isPinned: populatedMessage.isPinned,
          createdAt: populatedMessage.createdAt,
          sender,
          status: "sent" as const
        };

        // Join the conversation room if not already joined
        socket.join(`conversation:${data.conversationId}`);
        
        // Broadcast to all users in the conversation
        io.to(`conversation:${data.conversationId}`).emit("message:new", formattedMessage);
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
          // Emit status update to all clients
          io.emit("message:status", { messageId, status: "seen" });
          
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

            // Broadcast to all participants
            conversation.participants.forEach((p: any) => {
              if (p.firebaseUid) {
                io.emit("conversation:updated", formattedConv);
              }
            });
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

    socket.on("disconnect", async () => {
      console.log("Client disconnected:", socket.id);
      const userId = Array.from(userSockets.entries()).find(([, socketId]) => socketId === socket.id)?.[0];
      if (userId) {
        userSockets.delete(userId);
        await setUserOnlineStatus(userId, false);
        io.emit("user:status", { userId, online: false });
      }
    });
  });

  // Health check endpoint
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

  // User routes
  app.post("/api/users", async (req, res) => {
    try {
      console.log("=== USER CREATION START ===");
      const { firebaseToken, ...userData } = req.body;
      console.log("User data received:", { ...userData, firebaseToken: firebaseToken ? 'present' : 'missing' });
      
      const decodedToken = await verifyFirebaseToken(firebaseToken);
      console.log("Decoded token:", { uid: decodedToken.uid, email: decodedToken.email, name: decodedToken.name });
      
      // Ensure we have all required fields with fallbacks
      const name = userData.name && userData.name.trim() ? userData.name : 'User';
      const email = userData.email || decodedToken.email || '';
      const username = userData.username && userData.username.trim() ? userData.username : (email.split('@')[0] || 'user');
      
      console.log("Final user data:", { name, email, username });
      
      const user = await mongoService.createOrUpdateUser({
        firebaseUid: decodedToken.uid,
        email: email,
        name: name,
        username: username,
        avatar: userData.avatar
      });

      console.log("User created/updated in MongoDB:", { _id: user._id, username: user.username, email: user.email, name: user.name });
      res.json(user);
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  // Search users by username (must be before /:id route)
  app.get("/api/users/search", async (req, res) => {
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

  app.get("/api/users/:id", async (req, res) => {
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

  // Check if username is available
  app.get("/api/users/check-username/:username", async (req, res) => {
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
  app.get("/api/users/suggestions/:baseUsername", async (req, res) => {
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
  app.post("/api/meetings", async (req, res) => {
    try {
      const { firebaseToken, ...meetingData } = req.body;
      const decodedToken = await verifyFirebaseToken(firebaseToken);

      const meeting = await mongoService.createMeeting({
        ...meetingData,
        hostId: decodedToken.uid
      });

      res.json(meeting);
    } catch (error) {
      console.error("Error creating meeting:", error);
      res.status(500).json({ error: "Failed to create meeting" });
    }
  });

  app.get("/api/meetings/:id", async (req, res) => {
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

  app.get("/api/users/:userId/meetings", async (req, res) => {
    try {
      const meetings = await mongoService.getUserMeetings(req.params.userId);
      res.json(meetings);
    } catch (error) {
      console.error("Error fetching user meetings:", error);
      res.status(500).json({ error: "Failed to fetch meetings" });
    }
  });

  // Chat routes
  app.get("/api/meetings/:meetingId/messages", async (req, res) => {
    try {
      const messages = await mongoService.getMeetingMessages(req.params.meetingId);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  // Conversation routes
  app.get("/api/conversations", async (req, res) => {
    try {
      const { userId } = req.query;
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }

      // userId is Firebase UID, we need to get the MongoDB user
      const dbUser = await mongoService.getUserByFirebaseUid(userId as string);
      
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
  app.get("/api/conversations/mock", async (req, res) => {
    try {
      const { userId } = req.query;
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }

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

  app.get("/api/conversations/:conversationId/messages", async (req, res) => {
    try {
      const { conversationId } = req.params;
      const { userId } = req.query;

      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }

      console.log("Fetching messages for conversation:", conversationId, "userId:", userId);

      // Get messages from MongoDB
      const messages = await mongoService.getConversationMessages(conversationId);
      
      console.log("Returning messages:", messages.length);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      // Return empty array to prevent client errors
      res.json([]);
    }
  });

  // Create conversation endpoint
  app.post("/api/conversations", async (req, res) => {
    try {
      const { participantIds, createdBy, name } = req.body;
      
      if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
        return res.status(400).json({ error: "At least one participant is required" });
      }
      
      if (!createdBy) {
        return res.status(400).json({ error: "CreatedBy is required" });
      }

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
      const creatorUser = await mongoService.getUserByFirebaseUid(createdBy);
      if (!creatorUser) {
        return res.status(404).json({ error: "Creator not found" });
      }
      const mongoCreatedBy = creatorUser._id.toString();

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
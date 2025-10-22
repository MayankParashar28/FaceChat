import type { Express } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import { storage } from "./storage";
import { insertMessageSchema, type Message } from "@shared/schema";

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
    
    socket.on("user:online", async (userId: string) => {
      const user = await storage.getUser(userId);
      if (!user) {
        socket.emit("error", { message: "Invalid user" });
        return;
      }
      
      userSockets.set(userId, socket.id);
      await storage.updateUserOnlineStatus(userId, true);
      io.emit("user:status", { userId, online: true });
      
      const conversations = await storage.getUserConversations(userId);
      conversations.forEach(conv => {
        socket.join(`conversation:${conv.id}`);
      });
    });

    socket.on("join:conversation", (conversationId: string) => {
      socket.join(`conversation:${conversationId}`);
    });

    socket.on("leave:conversation", (conversationId: string) => {
      socket.leave(`conversation:${conversationId}`);
    });

    socket.on("typing:start", ({ conversationId, userId, userName }) => {
      socket.to(`conversation:${conversationId}`).emit("user:typing", { userId, userName });
    });

    socket.on("typing:stop", ({ conversationId, userId }) => {
      socket.to(`conversation:${conversationId}`).emit("user:stopped-typing", { userId });
    });

    socket.on("message:send", async (data: { conversationId: string, senderId: string, content: string }) => {
      try {
        const conv = await storage.getConversation(data.conversationId);
        if (!conv) {
          socket.emit("message:error", { error: "Conversation not found" });
          return;
        }

        const message = await storage.createMessage({
          conversationId: data.conversationId,
          senderId: data.senderId,
          content: data.content
        });

        const sender = await storage.getUser(data.senderId);
        const messageWithSender = { ...message, sender };

        await storage.updateMessageStatus(message.id, data.senderId, "sent");
        io.to(`conversation:${data.conversationId}`).emit("message:new", { ...messageWithSender, status: "sent" });

        const conversations = await storage.getUserConversations(data.senderId);
        const participants = conversations.find(c => c.id === data.conversationId)?.participants || [];
        
        setTimeout(async () => {
          for (const participant of participants) {
            if (participant.id !== data.senderId) {
              await storage.updateMessageStatus(message.id, participant.id, "delivered");
            }
          }
          io.to(`conversation:${data.conversationId}`).emit("message:status", {
            messageId: message.id,
            status: "delivered"
          });
        }, 500);
      } catch (error) {
        console.error("Error sending message:", error);
        socket.emit("message:error", { error: "Failed to send message" });
      }
    });

    socket.on("message:seen", async ({ messageId, userId }) => {
      try {
        await storage.updateMessageStatus(messageId, userId, "seen");
        io.emit("message:status", { messageId, status: "seen" });
      } catch (error) {
        console.error("Error updating message status:", error);
      }
    });

    socket.on("message:pin", async ({ messageId, isPinned }) => {
      try {
        await storage.pinMessage(messageId, isPinned);
        io.emit("message:pinned", { messageId, isPinned });
      } catch (error) {
        console.error("Error pinning message:", error);
      }
    });

    socket.on("disconnect", async () => {
      console.log("Client disconnected:", socket.id);
      const userId = Array.from(userSockets.entries())
        .find(([, socketId]) => socketId === socket.id)?.[0];
      
      if (userId) {
        userSockets.delete(userId);
        await storage.updateUserOnlineStatus(userId, false);
        io.emit("user:status", { userId, online: false });
      }
    });
  });

  app.get("/api/conversations", async (req, res) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const conversations = await storage.getUserConversations(userId);
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  app.get("/api/conversations/:id/messages", async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.query.userId as string;
      
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const userConversations = await storage.getUserConversations(userId);
      const hasAccess = userConversations.some(c => c.id === id);
      
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied" });
      }

      const messages = await storage.getConversationMessages(id);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  app.post("/api/conversations", async (req, res) => {
    try {
      const { name, isGroup, participantIds } = req.body;
      
      if (!participantIds || !Array.isArray(participantIds) || participantIds.length < 2) {
        return res.status(400).json({ error: "At least 2 participants required" });
      }

      const conversation = await storage.createConversation(
        { name, isGroup: isGroup || false },
        participantIds
      );

      res.json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });

  app.post("/api/users", async (req, res) => {
    try {
      const user = await storage.createUser(req.body);
      res.json(user);
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  app.get("/api/users/:id", async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  return httpServer;
}

import { Router } from "express";
import mongoose from "mongoose";
import { authenticate } from "../middleware/auth";
import { apiRateLimiter } from "../middleware/rateLimiter";
import { mongoService } from "../services/mongodb";
import { Conversation, Message } from "../models";

const router = Router();

// Get all conversations for the current user
router.get("/", authenticate, async (req, res) => {
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
router.get("/mock", authenticate, async (req, res) => {
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

// Get messages for a conversation
router.get("/:conversationId/messages", authenticate, async (req, res) => {
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

export default router;

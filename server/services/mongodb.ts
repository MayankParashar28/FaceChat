import { User, Meeting, ChatMessage, IUser, IMeeting, IChatMessage, Conversation, Message, IConversation, IMessage, ActivityLog, IActivityLog } from '../models';
import mongoose, { Types } from 'mongoose';
import { hashPassword, validatePasswordStrength } from '../utils/passwordHash';

export class MongoDBService {
  private buildDefaultAvatarUrl(seed: string): string {
    const safeSeed = encodeURIComponent(seed || Math.random().toString(36).slice(2));
    return `https://api.dicebear.com/9.x/adventurer/svg?seed=${safeSeed}`;
  }
  // User operations
  async createUser(userData: {
    firebaseUid: string;
    email: string;
    name: string;
    username: string;
    password?: string;
    avatar?: string;
    phone?: string;
    bio?: string;
    dateOfBirth?: Date;
    location?: string;
    website?: string;
    isEmailVerified?: boolean;
  }): Promise<IUser> {
    try {
      console.log("Creating new user in MongoDB:", { ...userData, password: userData.password ? '***' : undefined });

      // Hash password if provided
      let hashedPassword: string | undefined;
      if (userData.password) {
        // Validate password strength
        const validation = validatePasswordStrength(userData.password);
        if (!validation.isValid) {
          throw new Error(validation.errors[0] || "Password does not meet requirements");
        }
        hashedPassword = await hashPassword(userData.password);
      }

      const avatarUrl = userData.avatar && userData.avatar.trim().length > 0
        ? userData.avatar
        : this.buildDefaultAvatarUrl(userData.username || userData.firebaseUid);

      const userDataToSave = {
        ...userData,
        password: hashedPassword,
        avatar: avatarUrl,
        isEmailVerified: userData.isEmailVerified || false,
      };

      const user = new User(userDataToSave);
      await user.save();
      console.log("User saved successfully:", { _id: user._id, username: user.username });
      return user;
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }


  async logUserActivity(
    userId: string,
    action: string,
    metadata?: any,
    ipAddress?: string,
    userAgent?: string
  ): Promise<IActivityLog> {
    try {
      const log = new ActivityLog({
        userId: new mongoose.Types.ObjectId(userId),
        action,
        metadata,
        ipAddress,
        userAgent
      });
      await log.save();
      return log;
    } catch (error) {
      console.error('Error logging user activity:', error);
      // Don't throw logic errors for logging failure to avoid breaking main flows
      throw error;
    }
  }

  async createOrUpdateUser(userData: {
    firebaseUid: string;
    email: string;
    name: string;
    username: string;
    password?: string;
    avatar?: string;
    phone?: string;
    bio?: string;
    dateOfBirth?: Date;
    location?: string;
    website?: string;
    isEmailVerified?: boolean;
    // Enhanced Fields
    professional?: {
      title?: string;
      company?: string;
      industry?: string;
      skills?: string[];
    };
    socials?: {
      linkedin?: string;
      twitter?: string;
      github?: string;
      instagram?: string;
      website?: string;
    };
    preferences?: any;
    onboarding?: any;
  }): Promise<IUser> {
    try {
      console.log("createOrUpdateUser called with:", { ...userData, password: userData.password ? '***' : undefined });

      // Try to find existing user first
      let user = await this.getUserByFirebaseUid(userData.firebaseUid);

      if (user) {
        console.log("User exists, updating:", user._id);
        // Update existing user
        user.email = userData.email;
        user.name = userData.name;
        user.username = userData.username;

        // Update password if provided
        if (userData.password) {
          const validation = validatePasswordStrength(userData.password);
          if (!validation.isValid) {
            throw new Error(validation.errors[0] || "Password does not meet requirements");
          }
          user.password = await hashPassword(userData.password);
        }

        // Update optional fields if provided
        if (userData.phone !== undefined) user.phone = userData.phone;
        if (userData.bio !== undefined) user.bio = userData.bio;
        if (userData.dateOfBirth !== undefined) user.dateOfBirth = userData.dateOfBirth;
        if (userData.location !== undefined) user.location = userData.location;
        if (userData.website !== undefined) user.website = userData.website;
        if (userData.isEmailVerified !== undefined) user.isEmailVerified = userData.isEmailVerified;

        // Enhanced Fields Update
        if (userData.professional) {
          user.professional = { ...user.professional, ...userData.professional };
        }
        if (userData.socials) {
          user.socials = { ...user.socials, ...userData.socials };
        }
        if (userData.preferences) {
          user.preferences = { ...user.preferences, ...userData.preferences };
        }
        if (userData.onboarding) {
          user.onboarding = { ...user.onboarding, ...userData.onboarding };
        }

        if (userData.avatar) {
          user.avatar = userData.avatar;
        } else if (!user.avatar || user.avatar.trim().length === 0) {
          user.avatar = this.buildDefaultAvatarUrl(userData.username || userData.firebaseUid);
        }

        // Update last login
        user.lastLogin = new Date();

        await user.save();
        console.log("User updated successfully:", user._id);

        // Log activity
        this.logUserActivity(user._id.toString(), 'user_login', { method: 'createOrUpdateUser' });

        return user;
      } else {
        console.log("User does not exist, creating new user");
        // Create new user
        const newUser = await this.createUser(userData);
        console.log("New user created successfully:", newUser._id);

        // Log activity
        this.logUserActivity(newUser._id.toString(), 'user_register', { method: 'createOrUpdateUser' });

        return newUser;
      }
    } catch (error) {
      console.error('Error creating or updating user:', error);
      throw error;
    }
  }

  async getUserByFirebaseUid(firebaseUid: string): Promise<IUser | null> {
    try {
      return await User.findOne({ firebaseUid });
    } catch (error) {
      console.error('Error getting user by Firebase UID:', error);
      throw error;
    }
  }

  async getUserById(userId: string): Promise<IUser | null> {
    try {
      return await User.findById(userId);
    } catch (error) {
      console.error('Error getting user by ID:', error);
      throw error;
    }
  }

  async updateUser(userId: string, updateData: Partial<IUser>): Promise<IUser | null> {
    try {
      return await User.findByIdAndUpdate(userId, updateData, { new: true });
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }

  async isUsernameTaken(username: string): Promise<boolean> {
    try {
      const user = await User.findOne({ username: username.toLowerCase() });
      return !!user;
    } catch (error) {
      console.error('Error checking username:', error);
      return false;
    }
  }

  async generateUsernameSuggestions(baseUsername: string): Promise<string[]> {
    try {
      const suggestions: string[] = [];
      const cleanUsername = baseUsername.toLowerCase().replace(/[^a-z0-9_]/g, '');

      // Ensure minimum length
      let username = cleanUsername;
      if (username.length < 3) {
        username = username + 'user';
      }

      // Ensure maximum length
      if (username.length > 30) {
        username = username.substring(0, 30);
      }

      // Generate suggestions
      for (let i = 1; i <= 5; i++) {
        const suggestion = `${username}${i}`;
        const isTaken = await this.isUsernameTaken(suggestion);
        if (!isTaken) {
          suggestions.push(suggestion);
        }
        if (suggestions.length >= 3) break;
      }

      // If we don't have enough suggestions, try with random numbers
      if (suggestions.length < 3) {
        for (let i = 0; i < 10 && suggestions.length < 3; i++) {
          const randomNum = Math.floor(Math.random() * 1000);
          const suggestion = `${username}${randomNum}`;
          const isTaken = await this.isUsernameTaken(suggestion);
          if (!isTaken && !suggestions.includes(suggestion)) {
            suggestions.push(suggestion);
          }
        }
      }

      return suggestions;
    } catch (error) {
      console.error('Error generating username suggestions:', error);
      return [];
    }
  }

  // Meeting operations
  async createMeeting(meetingData: {
    title: string;
    description?: string;
    hostId: string;
    participants: string[];
    startTime: Date;
    roomId: string;
    meetingType?: 'video' | 'audio' | 'screen-share';
    settings?: any;
    status?: 'scheduled' | 'active' | 'ended';
  }): Promise<IMeeting> {
    try {
      // Check MongoDB connection
      if (mongoose.connection.readyState !== 1) {
        throw new Error('MongoDB is not connected. ReadyState: ' + mongoose.connection.readyState);
      }

      console.log('Creating meeting with data:', {
        ...meetingData,
        hostId: meetingData.hostId,
        participants: meetingData.participants,
        startTime: meetingData.startTime,
        mongooseReadyState: mongoose.connection.readyState
      });

      // Convert hostId and participants to ObjectIds if they're strings
      const hostIdObj = typeof meetingData.hostId === 'string'
        ? new Types.ObjectId(meetingData.hostId)
        : meetingData.hostId;

      const participantsObj = meetingData.participants.map(p =>
        typeof p === 'string' ? new Types.ObjectId(p) : p
      );

      // Validate ObjectIds
      if (!Types.ObjectId.isValid(hostIdObj.toString())) {
        throw new Error(`Invalid hostId: ${meetingData.hostId}`);
      }
      participantsObj.forEach((p, idx) => {
        if (!Types.ObjectId.isValid(p.toString())) {
          throw new Error(`Invalid participant ID at index ${idx}: ${meetingData.participants[idx]}`);
        }
      });

      // Create meeting object - explicitly set all required fields and defaults
      // Similar to how Message is created (which works)
      const meetingDataToSave: any = {
        title: meetingData.title,
        hostId: hostIdObj,
        participants: participantsObj,
        startTime: meetingData.startTime,
        roomId: meetingData.roomId,
        meetingType: meetingData.meetingType || 'video',
        status: meetingData.status || 'scheduled', // Default to scheduled, not active
        // Explicitly set settings (schema has defaults, but let's be explicit)
        settings: meetingData.settings || {
          allowScreenShare: true,
          allowChat: true,
          allowRecording: false,
          maxParticipants: 6
        },
        // Explicitly set analytics with defaults (schema has defaults, but let's be explicit)
        analytics: {
          totalDuration: 0,
          participantCount: participantsObj.length,
          engagementScore: 0,
          emotionData: []
        },
        isDeleted: false
      };

      // Add optional fields only if provided
      if (meetingData.description) {
        meetingDataToSave.description = meetingData.description;
      }

      console.log('Creating Meeting instance with data:', {
        title: meetingDataToSave.title,
        hostId: meetingDataToSave.hostId.toString(),
        participants: meetingDataToSave.participants.map((p: any) => p.toString()),
        roomId: meetingDataToSave.roomId,
        status: meetingDataToSave.status,
        meetingType: meetingDataToSave.meetingType,
        hasSettings: !!meetingDataToSave.settings,
        hasAnalytics: !!meetingDataToSave.analytics
      });

      const meeting = new Meeting(meetingDataToSave);

      // Validate before saving
      const validationError = meeting.validateSync();
      if (validationError) {
        console.error('❌ Meeting validation error:', validationError);
        throw validationError;
      }

      console.log('Attempting to save meeting to MongoDB...');
      await meeting.save();
      console.log('✅ Meeting saved successfully:', meeting._id);
      console.log('   Meeting details:', {
        _id: meeting._id,
        roomId: meeting.roomId,
        hostId: meeting.hostId,
        participants: meeting.participants,
        status: meeting.status
      });

      return meeting;
    } catch (error: any) {
      console.error('❌ Error creating meeting:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        name: error.name,
        meetingData: {
          ...meetingData,
          hostId: meetingData.hostId,
          participants: meetingData.participants
        }
      });
      throw error;
    }
  }

  async getMeetingById(meetingId: string): Promise<IMeeting | null> {
    try {
      return await Meeting.findById(meetingId)
        .populate('hostId', 'name email avatar')
        .populate('participants', 'name email avatar');
    } catch (error) {
      console.error('Error getting meeting by ID:', error);
      throw error;
    }
  }

  async getMeetingByRoomId(roomId: string): Promise<IMeeting | null> {
    try {
      return await Meeting.findOne({ roomId })
        .populate('hostId', 'name email avatar')
        .populate('participants', 'name email avatar');
    } catch (error) {
      console.error('Error getting meeting by room ID:', error);
      throw error;
    }
  }

  async getUserMeetings(userId: string): Promise<IMeeting[]> {
    try {
      return await Meeting.find({
        $or: [
          { hostId: userId },
          { participants: userId }
        ]
      })
        .populate('hostId', 'name email avatar')
        .populate('participants', 'name email avatar')
        .sort({ startTime: -1 });
    } catch (error) {
      console.error('Error getting user meetings:', error);
      throw error;
    }
  }

  async updateMeetingStatus(meetingId: string, status: 'scheduled' | 'active' | 'ended'): Promise<IMeeting | null> {
    try {
      const updateData: any = { status };
      if (status === 'ended') {
        updateData.endTime = new Date();
      }
      return await Meeting.findByIdAndUpdate(meetingId, updateData, { new: true });
    } catch (error) {
      console.error('Error updating meeting status:', error);
      throw error;
    }
  }

  async updateMeeting(meetingId: string, updateData: Partial<IMeeting>): Promise<IMeeting | null> {
    try {
      return await Meeting.findByIdAndUpdate(meetingId, updateData, { new: true });
    } catch (error) {
      console.error('Error updating meeting:', error);
      throw error;
    }
  }

  async addParticipantToMeeting(meetingId: string, userId: string): Promise<IMeeting | null> {
    try {
      return await Meeting.findByIdAndUpdate(
        meetingId,
        { $addToSet: { participants: userId } },
        { new: true }
      );
    } catch (error) {
      console.error('Error adding participant to meeting:', error);
      throw error;
    }
  }

  async removeParticipantFromMeeting(meetingId: string, userId: string): Promise<IMeeting | null> {
    try {
      return await Meeting.findByIdAndUpdate(
        meetingId,
        { $pull: { participants: userId } },
        { new: true }
      );
    } catch (error) {
      console.error('Error removing participant from meeting:', error);
      throw error;
    }
  }

  // Chat operations
  async createChatMessage(messageData: {
    meetingId: string;
    senderId: string;
    content: string;
    messageType?: 'text' | 'image' | 'file' | 'system';
  }): Promise<IChatMessage> {
    try {
      const message = new ChatMessage(messageData);
      await message.save();
      return await message.populate('senderId', 'name email avatar');
    } catch (error) {
      console.error('Error creating chat message:', error);
      throw error;
    }
  }

  async getMeetingMessages(meetingId: string, limit: number = 50): Promise<IChatMessage[]> {
    try {
      return await ChatMessage.find({ meetingId })
        .populate('senderId', 'name email avatar')
        .sort({ timestamp: -1 })
        .limit(limit);
    } catch (error) {
      console.error('Error getting meeting messages:', error);
      throw error;
    }
  }

  async pinMessage(messageId: string, isPinned: boolean): Promise<IChatMessage | null> {
    try {
      return await ChatMessage.findByIdAndUpdate(
        messageId,
        { isPinned },
        { new: true }
      );
    } catch (error) {
      console.error('Error pinning message:', error);
      throw error;
    }
  }

  async addReactionToMessage(messageId: string, userId: string, emoji: string): Promise<IChatMessage | null> {
    try {
      return await ChatMessage.findByIdAndUpdate(
        messageId,
        {
          $push: {
            reactions: {
              userId,
              emoji,
              timestamp: new Date()
            }
          }
        },
        { new: true }
      );
    } catch (error) {
      console.error('Error adding reaction to message:', error);
      throw error;
    }
  }

  // Analytics operations
  async updateMeetingAnalytics(meetingId: string, analyticsData: {
    totalDuration?: number;
    participantCount?: number;
    engagementScore?: number;
    emotionData?: any[];
  }): Promise<IMeeting | null> {
    try {
      return await Meeting.findByIdAndUpdate(
        meetingId,
        { $set: { analytics: analyticsData } },
        { new: true }
      );
    } catch (error) {
      console.error('Error updating meeting analytics:', error);
      throw error;
    }
  }

  async getUserMeetingAnalytics(userId: string): Promise<any> {
    try {
      const oid = new mongoose.Types.ObjectId(userId);
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const pipeline = [
        {
          $match: {
            $or: [{ hostId: oid }, { participants: oid }],
            status: 'ended'
          }
        },
        {
          $addFields: {
            calculatedDuration: {
              $cond: {
                if: {
                  $and: [
                    { $gt: ["$analytics.totalDuration", 0] },
                    { $ne: ["$analytics.totalDuration", null] }
                  ]
                },
                then: "$analytics.totalDuration",
                else: {
                  $divide: [
                    { $subtract: [{ $ifNull: ["$endTime", new Date()] }, "$startTime"] },
                    1000 * 60 // Convert ms to minutes
                  ]
                }
              }
            }
          }
        },
        {
          $facet: {
            // Total stats
            "totals": [
              {
                $group: {
                  _id: null,
                  totalCalls: { $sum: 1 },
                  totalDuration: { $sum: "$calculatedDuration" },
                  avgEngagement: { $avg: "$analytics.engagementScore" }
                }
              }
            ],
            // Unique participants
            "participants": [
              { $unwind: "$participants" },
              { $match: { participants: { $ne: oid } } }, // Exclude self
              { $group: { _id: "$participants" } },
              { $count: "count" }
            ],
            // Weekly activity (Last 7 days)
            "weeklyActivity": [
              {
                $match: {
                  startTime: { $gte: oneWeekAgo }
                }
              },
              {
                $project: {
                  dayOfWeek: { $dayOfWeek: "$startTime" }, // 1=Sun, 2=Mon...
                  duration: "$calculatedDuration"
                }
              },
              {
                $group: {
                  _id: "$dayOfWeek",
                  calls: { $sum: 1 },
                  duration: { $sum: "$duration" }
                }
              }
            ],
            // Stats from last month for comparison
            "lastMonthTotals": [
              {
                $match: {
                  startTime: { $gte: oneMonthAgo, $lt: now }
                }
              },
              {
                $group: {
                  _id: null,
                  totalCalls: { $sum: 1 },
                  totalDuration: { $sum: "$calculatedDuration" },
                }
              }
            ],
            // Emotion aggregation
            "emotions": [
              { $unwind: "$analytics.emotionData" },
              {
                $group: {
                  _id: "$analytics.emotionData.emotion",
                  count: { $sum: { $ifNull: ["$analytics.emotionData.count", 1] } }
                }
              }
            ],
            // Reactions aggregation
            "reactions": [
              {
                $project: {
                  reactionsArr: { $objectToArray: { $ifNull: ["$analytics.reactions", {}] } }
                }
              },
              { $unwind: "$reactionsArr" },
              {
                $group: {
                  _id: "$reactionsArr.k",
                  count: { $sum: "$reactionsArr.v" }
                }
              },
              { $sort: { count: -1 } },
              { $limit: 10 }
            ]
          }
        }
      ];

      const results = await Meeting.aggregate(pipeline as any);
      const data = results[0];

      // Format weekly activity to match chart format (Mon-Sun)
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const activityData = days.map((day, index) => {
        // Mongo dayOfWeek: 1=Sun, 7=Sat. Index 0=Sun.
        // So day index directly maps to Mongo dayOfWeek - 1? No.
        // Mongo: Sun=1. Map Index: 0. So MongoID = Index + 1.
        const dayStats = data.weeklyActivity.find((d: any) => d._id === (index + 1)) || { calls: 0, duration: 0 };
        return {
          name: day,
          calls: dayStats.calls,
          duration: dayStats.duration
        };
      });

      // Rotate array so Monday is first if desired, or keep as Sun-Sat
      // Chart mockup had Mon-Sun.
      const activityDataMonFirst = [...activityData.slice(1), activityData[0]];

      // Format emotion data
      const totalEmotions = data.emotions.reduce((acc: number, curr: any) => acc + curr.count, 0);
      const emotionData = data.emotions.map((e: any) => ({
        name: e._id || "Unknown",
        value: totalEmotions > 0 ? Math.round((e.count / totalEmotions) * 100) : 0
      }));

      // Calculate trends (naive)
      const currentTotals = data.totals[0] || { totalCalls: 0, totalDuration: 0, avgEngagement: 0 };

      // Format reactions
      const topReactions = (data.reactions || []).map((r: any) => ({
        emoji: r._id,
        count: r.count
      }));

      return {
        totalCalls: currentTotals.totalCalls,
        totalDuration: currentTotals.totalDuration,
        uniqueParticipants: data.participants[0]?.count || 0,
        avgSentiment: "Positive", // Placeholder until sentiment analysis is better
        activityData: activityDataMonFirst,
        emotionData: emotionData.length > 0 ? emotionData : [
          { name: "Happy", value: 30 },
          { name: "Neutral", value: 50 },
          { name: "Surprised", value: 20 }
        ],
        topReactions
      };

    } catch (error) {
      console.error('Error calculating analytics:', error);
      throw error;
    }
  }

  async addRecordingToMeeting(meetingId: string, recordingData: {
    url: string;
    duration: number;
  }): Promise<IMeeting | null> {
    try {
      return await Meeting.findByIdAndUpdate(
        meetingId,
        {
          $push: {
            recordings: {
              ...recordingData,
              createdAt: new Date()
            }
          }
        },
        { new: true }
      );
    } catch (error) {
      console.error('Error adding recording to meeting:', error);
      throw error;
    }
  }

  // Conversation operations
  async getUserConversations(userId: string): Promise<any[]> {
    try {
      console.log("Getting conversations for MongoDB user ID:", userId);

      const conversations = await Conversation.find({
        participants: userId,
        isDeleted: false
      })
        .populate('participants', 'username name email avatar firebaseUid')
        .populate('lastMessage')
        .populate('createdBy', 'username name')
        .sort({ updatedAt: -1 })
        .limit(50);

      console.log("Found raw conversations:", conversations.length);

      // Transform to include last message details
      const formattedConversations = await Promise.all(
        conversations.map(async (conv) => {
          const otherParticipants = conv.participants.filter(
            (p: any) => p._id.toString() !== userId
          );

          const lastMessage = conv.lastMessage
            ? await Message.findById(conv.lastMessage).populate('senderId', 'username name')
            : null;

          return {
            id: conv._id.toString(),
            name: conv.name,
            isGroup: conv.isGroup,
            participants: conv.participants.map((p: any) => ({
              id: p._id.toString(),
              firebaseUid: p.firebaseUid,
              name: p.name,
              username: p.username,
              avatar: p.avatar,
              online: false // This will be set by WebSocket
            })),
            lastMessage: lastMessage && typeof lastMessage.senderId !== 'string' && 'name' in lastMessage.senderId ? {
              id: lastMessage._id.toString(),
              conversationId: conv._id.toString(),
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
            unreadCount: await Message.countDocuments({
              conversationId: conv._id,
              senderId: { $ne: userId },
              isRead: false
            })
          };
        })
      );

      console.log("Formatted conversations:", formattedConversations.length);
      return formattedConversations;
    } catch (error) {
      console.error('Error getting user conversations:', error);
      throw error;
    }
  }

  async createConversation(participants: string[], createdBy: string, name?: string): Promise<IConversation> {
    try {
      // Convert string IDs to ObjectId instances
      const participantObjectIds = participants.map(p => new mongoose.Types.ObjectId(p));
      const createdByObjectId = new mongoose.Types.ObjectId(createdBy);

      const conversation = new Conversation({
        participants: participantObjectIds,
        createdBy: createdByObjectId,
        name,
        isGroup: participants.length > 2
      });
      await conversation.save();
      return conversation;
    } catch (error) {
      console.error('Error creating conversation:', error);
      throw error;
    }
  }

  async getConversationMessages(conversationId: string, viewerId?: string, limit: number = 50, beforeDate?: Date): Promise<any[]> {
    try {
      console.log("Getting messages for conversation:", conversationId, "beforeDate:", beforeDate);

      const query: any = { conversationId };

      // If beforeDate is provided, only get messages before that date (for pagination)
      if (beforeDate) {
        query.createdAt = { $lt: beforeDate };
      }

      const messages = await Message.find(query)
        .populate('senderId', 'username name avatar')
        .sort({ createdAt: -1 })
        .limit(limit);

      console.log("Found messages:", messages.length);

      if (!messages || messages.length === 0) {
        console.log("No messages found, returning empty array");
        return [];
      }

      const formattedMessages = messages.reverse().map(msg => {
        const senderId = typeof msg.senderId === 'string' ? msg.senderId : (msg.senderId as any)._id.toString();
        const sender = typeof msg.senderId === 'string' || !('name' in msg.senderId) ? null : {
          id: (msg.senderId as any)._id.toString(),
          name: (msg.senderId as any).name,
          username: (msg.senderId as any).username
        };

        // Determine status: only show status for messages sent by the viewer
        let status: "sent" | "delivered" | "seen" | undefined;
        if (viewerId && senderId === viewerId) {
          // Message was sent by the viewer
          // If read, it's "seen", otherwise "delivered" (assuming it was delivered if we're viewing)
          // For loaded messages, if isRead is true, it's "seen", otherwise "delivered"
          status = msg.isRead ? "seen" : "delivered";
        }
        // If message is from someone else, no status (it's not our message to track)

        return {
          id: msg._id.toString(),
          conversationId: msg.conversationId.toString(),
          senderId,
          content: msg.content,
          isPinned: msg.isPinned,
          createdAt: msg.createdAt,
          sender: sender || { id: senderId, name: 'Unknown', username: 'unknown' },
          status
        };
      });

      console.log("Formatted messages:", formattedMessages.length);
      return formattedMessages;
    } catch (error) {
      console.error('Error getting conversation messages:', error);
      // Return empty array instead of throwing to prevent client errors
      return [];
    }
  }

  async createMessage(messageData: {
    conversationId: string;
    senderId: string;
    content: string;
    messageType?: 'text' | 'image' | 'file' | 'system';
  }): Promise<IMessage> {
    try {
      const message = new Message({
        conversationId: new mongoose.Types.ObjectId(messageData.conversationId),
        senderId: new mongoose.Types.ObjectId(messageData.senderId),
        content: messageData.content,
        messageType: messageData.messageType
      });
      await message.save();

      // Update conversation's last message
      await Conversation.findByIdAndUpdate(messageData.conversationId, {
        lastMessage: message._id,
        updatedAt: new Date()
      });

      return message;
    } catch (error) {
      console.error('Error creating message:', error);
      throw error;
    }
  }

  async searchUsersByUsername(query: string, limit: number = 10): Promise<IUser[]> {
    try {
      const users = await User.find({
        username: { $regex: query.toLowerCase(), $options: 'i' },
        isDeleted: { $ne: true }
      })
        .select('username name avatar email')
        .limit(limit);

      return users;
    } catch (error) {
      console.error('Error searching users:', error);
      throw error;
    }
  }
}

export const mongoService = new MongoDBService();

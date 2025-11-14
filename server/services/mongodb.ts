import { User, Meeting, ChatMessage, IUser, IMeeting, IChatMessage, Conversation, Message, IConversation, IMessage } from '../models';
import mongoose from 'mongoose';

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
    avatar?: string;
  }): Promise<IUser> {
    try {
      console.log("Creating new user in MongoDB:", userData);
      const avatarUrl = userData.avatar && userData.avatar.trim().length > 0
        ? userData.avatar
        : this.buildDefaultAvatarUrl(userData.username || userData.firebaseUid);
      const user = new User({ ...userData, avatar: avatarUrl });
      await user.save();
      console.log("User saved successfully:", { _id: user._id, username: user.username });
      return user;
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  async createOrUpdateUser(userData: {
    firebaseUid: string;
    email: string;
    name: string;
    username: string;
    avatar?: string;
  }): Promise<IUser> {
    try {
      console.log("createOrUpdateUser called with:", userData);
      
      // Try to find existing user first
      let user = await this.getUserByFirebaseUid(userData.firebaseUid);
      
      if (user) {
        console.log("User exists, updating:", user._id);
        // Update existing user
        user.email = userData.email;
        user.name = userData.name;
        user.username = userData.username;
        if (userData.avatar) {
          user.avatar = userData.avatar;
        } else if (!user.avatar || user.avatar.trim().length === 0) {
          user.avatar = this.buildDefaultAvatarUrl(userData.username || userData.firebaseUid);
        }
        await user.save();
        console.log("User updated successfully:", user._id);
        return user;
      } else {
        console.log("User does not exist, creating new user");
        // Create new user
        const newUser = await this.createUser(userData);
        console.log("New user created successfully:", newUser._id);
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
  }): Promise<IMeeting> {
    try {
      const meeting = new Meeting(meetingData);
      await meeting.save();
      return meeting;
    } catch (error) {
      console.error('Error creating meeting:', error);
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

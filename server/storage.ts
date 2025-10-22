import { db } from "./db";
import { 
  type User, 
  type InsertUser, 
  type Conversation, 
  type InsertConversation,
  type Message,
  type InsertMessage,
  users,
  conversations,
  conversationParticipants,
  messages,
  messageStatus
} from "@shared/schema";
import { eq, and, desc, or, sql, inArray } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserOnlineStatus(userId: string, online: boolean): Promise<void>;
  
  // Conversation operations
  getConversation(id: string): Promise<Conversation | undefined>;
  getUserConversations(userId: string): Promise<Array<Conversation & { 
    participants: User[],
    lastMessage?: Message,
    unreadCount: number
  }>>;
  createConversation(conversation: InsertConversation, participantIds: string[]): Promise<Conversation>;
  
  // Message operations
  getConversationMessages(conversationId: string): Promise<Array<Message & { sender: User }>>;
  createMessage(message: InsertMessage): Promise<Message>;
  pinMessage(messageId: string, isPinned: boolean): Promise<void>;
  updateMessageStatus(messageId: string, userId: string, status: string): Promise<void>;
}

export class DbStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await db.insert(users).values({
      ...insertUser,
      online: false,
      lastSeen: new Date()
    }).returning();
    return result[0];
  }

  async updateUserOnlineStatus(userId: string, online: boolean): Promise<void> {
    await db.update(users)
      .set({ online, lastSeen: new Date() })
      .where(eq(users.id, userId));
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    const result = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
    return result[0];
  }

  async getUserConversations(userId: string): Promise<Array<Conversation & { 
    participants: User[],
    lastMessage?: Message,
    unreadCount: number
  }>> {
    const userConvs = await db
      .select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.userId, userId));
    
    const conversationIds = userConvs.map(uc => uc.conversationId);
    
    if (conversationIds.length === 0) return [];
    
    const convs = await db
      .select()
      .from(conversations)
      .where(inArray(conversations.id, conversationIds))
      .orderBy(desc(conversations.updatedAt));
    
    const result = await Promise.all(convs.map(async (conv) => {
      const participantsList = await db
        .select({ user: users })
        .from(conversationParticipants)
        .innerJoin(users, eq(conversationParticipants.userId, users.id))
        .where(eq(conversationParticipants.conversationId, conv.id));
      
      const lastMessageResult = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(desc(messages.createdAt))
        .limit(1);
      
      const unreadResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .leftJoin(messageStatus, and(
          eq(messageStatus.messageId, messages.id),
          eq(messageStatus.userId, userId)
        ))
        .where(and(
          eq(messages.conversationId, conv.id),
          sql`${messageStatus.status} IS NULL OR ${messageStatus.status} != 'seen'`
        ));
      
      return {
        ...conv,
        participants: participantsList.map(p => p.user),
        lastMessage: lastMessageResult[0],
        unreadCount: Number(unreadResult[0]?.count || 0)
      };
    }));
    
    return result;
  }

  async createConversation(conversation: InsertConversation, participantIds: string[]): Promise<Conversation> {
    const result = await db.insert(conversations).values(conversation).returning();
    const conv = result[0];
    
    await db.insert(conversationParticipants).values(
      participantIds.map(userId => ({
        conversationId: conv.id,
        userId
      }))
    );
    
    return conv;
  }

  async getConversationMessages(conversationId: string): Promise<Array<Message & { sender: User }>> {
    const result = await db
      .select({
        message: messages,
        sender: users
      })
      .from(messages)
      .innerJoin(users, eq(messages.senderId, users.id))
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);
    
    return result.map(r => ({ ...r.message, sender: r.sender }));
  }

  async createMessage(message: InsertMessage): Promise<Message> {
    const result = await db.insert(messages).values(message).returning();
    
    await db.update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, message.conversationId));
    
    return result[0];
  }

  async pinMessage(messageId: string, isPinned: boolean): Promise<void> {
    await db.update(messages)
      .set({ isPinned })
      .where(eq(messages.id, messageId));
  }

  async updateMessageStatus(messageId: string, userId: string, status: string): Promise<void> {
    const existing = await db
      .select()
      .from(messageStatus)
      .where(and(
        eq(messageStatus.messageId, messageId),
        eq(messageStatus.userId, userId)
      ))
      .limit(1);
    
    if (existing.length > 0) {
      await db.update(messageStatus)
        .set({ status, readAt: status === 'seen' ? new Date() : null })
        .where(and(
          eq(messageStatus.messageId, messageId),
          eq(messageStatus.userId, userId)
        ));
    } else {
      await db.insert(messageStatus).values({
        messageId,
        userId,
        status,
        readAt: status === 'seen' ? new Date() : null
      });
    }
  }
}

export const storage = new DbStorage();

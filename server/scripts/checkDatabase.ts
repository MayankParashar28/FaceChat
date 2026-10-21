import { logger } from "../utils/logger";
/**
 * Database Check Script
 * Checks database connection, collections, and provides statistics
 */

import mongoose from "mongoose";
import { User, Meeting, Conversation, Message, ChatMessage } from "../models";
import { connectToMongoDB } from "../database/mongodb";
import dotenv from "dotenv";

dotenv.config();

async function checkDatabase() {
  try {
    logger.info("\n🔍 Database Check Script");
    logger.info("================================\n");

    // 1. Check connection
    logger.info("1. Checking MongoDB Connection...");
    const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/facecallai";
    logger.info(`   URI: ${MONGODB_URI.replace(/\/\/.*@/, "//***:***@")}`); // Hide credentials

    await connectToMongoDB(1, 1000);

    const connectionState = mongoose.connection.readyState;
    const states = ["disconnected", "connected", "connecting", "disconnecting"];
    logger.info(`   Status: ${states[connectionState]} (${connectionState})`);

    if (connectionState !== 1) {
      logger.info("   ❌ Database is not connected");
      process.exit(1);
    }
    logger.info("   ✅ Connected successfully\n");

    // 2. Check database info
    logger.info("2. Database Information...");
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Database connection not available");
    }

    const dbName = db.databaseName;
    const adminDb = db.admin();
    const serverStatus = await adminDb.serverStatus();

    logger.info(`   Database Name: ${dbName}`);
    logger.info(`   MongoDB Version: ${serverStatus.version}`);
    logger.info(`   Uptime: ${Math.floor(serverStatus.uptime / 3600)} hours\n`);

    // 3. List collections
    logger.info("3. Collections...");
    const collections = await db.listCollections().toArray();
    logger.info(`   Found ${collections.length} collection(s):`);
    collections.forEach((col) => {
      logger.info(`   - ${col.name}`);
    });
    logger.info("");

    // 4. Check each model
    logger.info("4. Model Statistics...\n");

    // Users
    try {
      const userCount = await User.countDocuments();
      logger.info(`   Users: ${userCount}`);
      if (userCount > 0) {
        const sampleUser = await User.findOne().select("email username name createdAt").lean();
        logger.info(`   Sample: ${sampleUser?.email || "N/A"} (@${sampleUser?.username || "N/A"})`);
      }
    } catch (error) {
      logger.info(`   Users: Error - ${error instanceof Error ? error.message : "Unknown error"}`);
    }

    // Meetings
    try {
      const meetingCount = await Meeting.countDocuments();
      const activeMeetings = await Meeting.countDocuments({ status: "active" });
      logger.info(`   Meetings: ${meetingCount} (${activeMeetings} active)`);
    } catch (error) {
      logger.info(
        `   Meetings: Error - ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    // Conversations
    try {
      const conversationCount = await Conversation.countDocuments();
      const groupConversations = await Conversation.countDocuments({ isGroup: true });
      logger.info(`   Conversations: ${conversationCount} (${groupConversations} groups)`);
    } catch (error) {
      logger.info(
        `   Conversations: Error - ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    // Messages
    try {
      const messageCount = await Message.countDocuments();
      const unreadMessages = await Message.countDocuments({ isRead: false });
      logger.info(`   Messages: ${messageCount} (${unreadMessages} unread)`);
    } catch (error) {
      logger.info(
        `   Messages: Error - ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    // Chat Messages
    try {
      const chatMessageCount = await ChatMessage.countDocuments();
      logger.info(`   Chat Messages: ${chatMessageCount}`);
    } catch (error) {
      logger.info(
        `   Chat Messages: Error - ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    logger.info("");

    // 5. Check indexes
    logger.info("5. Checking Indexes...\n");
    for (const collection of collections) {
      try {
        const indexes = await db.collection(collection.name).indexes();
        if (indexes.length > 1) {
          // More than just _id index
          logger.info(`   ${collection.name}:`);
          indexes.forEach((index) => {
            const keys = Object.keys(index.key || {});
            if (keys.length > 0) {
              logger.info(`     - ${keys.join(", ")}`);
            }
          });
        }
      } catch (error) {
        // Skip if can't get indexes
      }
    }

    logger.info("\n✅ Database check completed successfully\n");

    // Close connection
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    logger.error("\n❌ Database check failed:");
    logger.error(error);
    process.exit(1);
  }
}

// Run the check
checkDatabase();

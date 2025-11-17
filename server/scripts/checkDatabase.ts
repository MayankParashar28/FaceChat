/**
 * Database Check Script
 * Checks database connection, collections, and provides statistics
 */

import mongoose from 'mongoose';
import { User, Meeting, Conversation, Message, ChatMessage } from '../models';
import { connectToMongoDB } from '../database/mongodb';
import dotenv from 'dotenv';

dotenv.config();

async function checkDatabase() {
  try {
    console.log('\n🔍 Database Check Script');
    console.log('================================\n');

    // 1. Check connection
    console.log('1. Checking MongoDB Connection...');
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/facecallai';
    console.log(`   URI: ${MONGODB_URI.replace(/\/\/.*@/, '//***:***@')}`); // Hide credentials
    
    await connectToMongoDB(1, 1000);
    
    const connectionState = mongoose.connection.readyState;
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    console.log(`   Status: ${states[connectionState]} (${connectionState})`);
    
    if (connectionState !== 1) {
      console.log('   ❌ Database is not connected');
      process.exit(1);
    }
    console.log('   ✅ Connected successfully\n');

    // 2. Check database info
    console.log('2. Database Information...');
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database connection not available');
    }
    
    const dbName = db.databaseName;
    const adminDb = db.admin();
    const serverStatus = await adminDb.serverStatus();
    
    console.log(`   Database Name: ${dbName}`);
    console.log(`   MongoDB Version: ${serverStatus.version}`);
    console.log(`   Uptime: ${Math.floor(serverStatus.uptime / 3600)} hours\n`);

    // 3. List collections
    console.log('3. Collections...');
    const collections = await db.listCollections().toArray();
    console.log(`   Found ${collections.length} collection(s):`);
    collections.forEach(col => {
      console.log(`   - ${col.name}`);
    });
    console.log('');

    // 4. Check each model
    console.log('4. Model Statistics...\n');
    
    // Users
    try {
      const userCount = await User.countDocuments();
      console.log(`   Users: ${userCount}`);
      if (userCount > 0) {
        const sampleUser = await User.findOne().select('email username name createdAt').lean();
        console.log(`   Sample: ${sampleUser?.email || 'N/A'} (@${sampleUser?.username || 'N/A'})`);
      }
    } catch (error) {
      console.log(`   Users: Error - ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Meetings
    try {
      const meetingCount = await Meeting.countDocuments();
      const activeMeetings = await Meeting.countDocuments({ status: 'active' });
      console.log(`   Meetings: ${meetingCount} (${activeMeetings} active)`);
    } catch (error) {
      console.log(`   Meetings: Error - ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Conversations
    try {
      const conversationCount = await Conversation.countDocuments();
      const groupConversations = await Conversation.countDocuments({ isGroup: true });
      console.log(`   Conversations: ${conversationCount} (${groupConversations} groups)`);
    } catch (error) {
      console.log(`   Conversations: Error - ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Messages
    try {
      const messageCount = await Message.countDocuments();
      const unreadMessages = await Message.countDocuments({ isRead: false });
      console.log(`   Messages: ${messageCount} (${unreadMessages} unread)`);
    } catch (error) {
      console.log(`   Messages: Error - ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Chat Messages
    try {
      const chatMessageCount = await ChatMessage.countDocuments();
      console.log(`   Chat Messages: ${chatMessageCount}`);
    } catch (error) {
      console.log(`   Chat Messages: Error - ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    console.log('');

    // 5. Check indexes
    console.log('5. Checking Indexes...\n');
    for (const collection of collections) {
      try {
        const indexes = await db.collection(collection.name).indexes();
        if (indexes.length > 1) { // More than just _id index
          console.log(`   ${collection.name}:`);
          indexes.forEach(index => {
            const keys = Object.keys(index.key || {});
            if (keys.length > 0) {
              console.log(`     - ${keys.join(', ')}`);
            }
          });
        }
      } catch (error) {
        // Skip if can't get indexes
      }
    }

    console.log('\n✅ Database check completed successfully\n');
    
    // Close connection
    await mongoose.connection.close();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Database check failed:');
    console.error(error);
    process.exit(1);
  }
}

// Run the check
checkDatabase();


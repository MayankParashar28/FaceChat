import { logger } from "../utils/logger";
import mongoose, { ConnectOptions } from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/facecallai";

const options: ConnectOptions = {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  bufferCommands: false,
};

// Event listeners
mongoose.connection.on("connected", () => logger.info("✅ MongoDB connected"));
mongoose.connection.on("error", (err) => logger.error("❌ MongoDB error:", err));
mongoose.connection.on("disconnected", () => logger.info("⚠️ MongoDB disconnected"));

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`\nReceived ${signal}, closing MongoDB connection...`);
  await mongoose.connection.close();
  logger.info("MongoDB connection closed gracefully");
  process.exit(0);
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

export async function connectToMongoDB(retries = 5, delay = 3000): Promise<void> {
  while (retries) {
    try {
      await mongoose.connect(MONGODB_URI, options);
      logger.info("✅ MongoDB connection established");
      return;
    } catch (error) {
      retries -= 1;
      logger.error(`❌ Failed to connect. Retries left: ${retries}`);
      if (!retries) throw error;
      await new Promise((res) => setTimeout(res, delay));
    }
  }
}

export async function testMongoConnection(): Promise<boolean> {
  try {
    if (mongoose.connection.readyState !== 1) {
      // Not connected yet — connect first
      await mongoose.connect(MONGODB_URI);
    }

    const db = mongoose.connection.db;
    if (!db) throw new Error("MongoDB connection not ready yet");

    await db.admin().ping();
    logger.info("✅ MongoDB connection test successful");
    return true;
  } catch (error) {
    logger.error("❌ MongoDB connection test failed:", error);
    return false;
  }
}

export async function mongoHealthCheck() {
  const states = ["disconnected", "connected", "connecting", "disconnecting"];
  const state = mongoose.connection.readyState;

  return {
    status: state === 1 ? "healthy" : "unhealthy",
    state: states[state],
    database: "mongodb",
  };
}

export default mongoose;

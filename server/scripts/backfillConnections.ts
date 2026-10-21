/**
 * Backfill Connections Migration
 * -------------------------------
 * The FaceLink gate requires an ACTIVE `Connection` between two users before
 * they can message or open a 1-on-1 conversation. Conversations created before
 * the gate existed may have no Connection row, which would lock those chats.
 *
 * This script creates a missing `active` Connection for every existing
 * non-group, 2-participant conversation.
 *
 * Safety:
 *   - DRY RUN by default. Pass `--apply` to actually write.
 *   - Idempotent: re-running makes no further changes.
 *   - Never overrides a block: if ANY connection (active OR blocked) already
 *     exists for a pair, that pair is left untouched.
 *
 * Usage:
 *   npx tsx server/scripts/backfillConnections.ts            # preview only
 *   npx tsx server/scripts/backfillConnections.ts --apply    # write changes
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { connectToMongoDB } from "../database/mongodb";
import { Conversation, Connection } from "../models";
import { logger } from "../utils/logger";

dotenv.config();

const APPLY = process.argv.includes("--apply");

async function backfillConnections() {
  logger.info("\n🔗 Backfill Connections Migration");
  logger.info("================================");
  logger.info(
    APPLY ? "Mode: APPLY (writing changes)" : "Mode: DRY RUN (no writes) — pass --apply to write"
  );

  await connectToMongoDB(1, 1000);
  if (mongoose.connection.readyState !== 1) {
    throw new Error("Could not connect to MongoDB");
  }

  // Only real 1-on-1 conversations.
  const conversations = await Conversation.find({
    isGroup: { $ne: true },
    isDeleted: { $ne: true },
  }).select("_id participants");

  let scanned = 0;
  let skippedNotPair = 0;
  let alreadyConnected = 0;
  let created = 0;

  for (const conv of conversations) {
    scanned++;
    const participants = (conv.participants || []).map((p) => p.toString());

    // Need exactly two distinct participants to form a pairwise connection.
    const unique = Array.from(new Set(participants));
    if (unique.length !== 2) {
      skippedNotPair++;
      continue;
    }

    const [a, b] = unique;

    // Any existing connection (active or blocked) means leave it alone.
    const existing = await Connection.findOne({
      participants: {
        $all: [new mongoose.Types.ObjectId(a), new mongoose.Types.ObjectId(b)],
      },
    });

    if (existing) {
      alreadyConnected++;
      continue;
    }

    if (APPLY) {
      await Connection.create({ participants: [a, b], status: "active" });
    }
    created++;
    logger.info(
      `${APPLY ? "created" : "would create"} connection for conversation ${conv._id} (${a} ↔ ${b})`
    );
  }

  logger.info("\n--- Summary ---");
  logger.info(`Conversations scanned:        ${scanned}`);
  logger.info(`Skipped (not a 2-person 1:1): ${skippedNotPair}`);
  logger.info(`Already had a connection:     ${alreadyConnected}`);
  logger.info(
    `${APPLY ? "Connections created:         " : "Connections that WOULD be created: "} ${created}`
  );
  if (!APPLY && created > 0) {
    logger.info("\nRe-run with --apply to create the connections above.");
  }

  await mongoose.connection.close();
  logger.info("MongoDB connection closed.");
  process.exit(0);
}

backfillConnections().catch((error) => {
  logger.error("Migration failed:", error);
  process.exit(1);
});

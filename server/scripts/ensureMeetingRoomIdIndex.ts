/**
 * Make the meetings.roomId index unique
 * --------------------------------------
 * `MeetingSchema` declares `roomId: { unique: true }`, but the collection was
 * created before that flag was added and Mongoose never alters an index that
 * already exists. The live index is therefore a plain `roomId_1`, so nothing
 * stopped two sockets joining the same empty room from inserting a meeting
 * apiece.
 *
 * `findOrCreateMeetingByRoomId` now upserts instead of check-then-create, which
 * closes the wide window. MongoDB only guarantees upsert can't double-insert
 * when the queried field is uniquely indexed, so this script closes the rest.
 *
 * Safety:
 *   - DRY RUN by default. Pass `--apply` to actually write.
 *   - Idempotent: re-running once the index is unique makes no changes.
 *   - Refuses to touch the index while duplicate roomIds exist, and lists them
 *     so they can be resolved first.
 *
 * Usage:
 *   npx tsx server/scripts/ensureMeetingRoomIdIndex.ts            # preview only
 *   npx tsx server/scripts/ensureMeetingRoomIdIndex.ts --apply    # write changes
 */

import "dotenv/config";
import mongoose from "mongoose";
import { connectToMongoDB } from "../database/mongodb";
import { logger } from "../utils/logger";

const APPLY = process.argv.includes("--apply");
const INDEX_NAME = "roomId_1";

async function ensureMeetingRoomIdIndex() {
  logger.info("\n🔑 Meetings roomId Unique Index Migration");
  logger.info("=========================================");
  logger.info(
    APPLY ? "Mode: APPLY (writing changes)" : "Mode: DRY RUN (no writes) — pass --apply to write"
  );

  await connectToMongoDB(1, 1000);
  if (mongoose.connection.readyState !== 1) {
    logger.error("MongoDB is not connected; aborting.");
    process.exit(1);
  }

  const meetings = mongoose.connection.db!.collection("meetings");

  const indexes = await meetings.indexes();
  const existing = indexes.find((i) => i.name === INDEX_NAME);
  logger.info(
    `Current index: ${existing ? JSON.stringify({ key: existing.key, unique: !!existing.unique }) : "none"}`
  );

  if (existing?.unique) {
    logger.info("\n✅ roomId is already uniquely indexed. Nothing to do.");
    await mongoose.connection.close();
    process.exit(0);
  }

  const duplicates = await meetings
    .aggregate<{ _id: string; n: number; ids: unknown[] }>([
      { $group: { _id: "$roomId", n: { $sum: 1 }, ids: { $push: "$_id" } } },
      { $match: { n: { $gt: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray();

  if (duplicates.length > 0) {
    logger.error(`\n❌ ${duplicates.length} roomId(s) have more than one meeting:`);
    for (const d of duplicates) {
      logger.error(`   ${d._id}: ${d.n} meetings — ${d.ids.map(String).join(", ")}`);
    }
    logger.error(
      "\nA unique index cannot be built until each room has a single meeting. " +
        "Decide which document to keep for each room above, remove the rest, then re-run."
    );
    await mongoose.connection.close();
    process.exit(1);
  }

  logger.info(`Duplicate roomIds: none (${await meetings.countDocuments()} meetings scanned)`);

  if (!APPLY) {
    logger.info(
      `\nWould drop index '${INDEX_NAME}' and recreate it as unique.` +
        "\nRe-run with --apply to make the change."
    );
    await mongoose.connection.close();
    process.exit(0);
  }

  if (existing) {
    await meetings.dropIndex(INDEX_NAME);
    logger.info(`Dropped index '${INDEX_NAME}'.`);
  }
  await meetings.createIndex({ roomId: 1 }, { unique: true, name: INDEX_NAME });
  logger.info(`✅ Recreated '${INDEX_NAME}' as unique.`);

  await mongoose.connection.close();
  logger.info("MongoDB connection closed.");
  process.exit(0);
}

ensureMeetingRoomIdIndex().catch((error) => {
  logger.error("Migration failed:", error);
  process.exit(1);
});

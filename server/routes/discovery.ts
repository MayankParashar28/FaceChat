import { logger } from "../utils/logger";
import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { apiRateLimiter } from "../middleware/rateLimiter";
import { mongoService } from "../services/mongodb";
import { Discovery, Connection, Notification as NotificationModel } from "../models";
import mongoose from "mongoose";

const router = Router();

/** Accepts a MongoDB id or a Firebase uid, like the discovery route always has. */
async function resolveUser(id: string) {
  if (!id) return null;
  if (mongoose.Types.ObjectId.isValid(id)) {
    const byId = await mongoService.getUserById(id).catch(() => null);
    if (byId) return byId;
  }
  return await mongoService.getUserByFirebaseUid(id).catch(() => null);
}

/**
 * The one connection document for a pair, whatever its status.
 *
 * Every lookup here used to filter on `status: "active"`, so a blocked pair
 * looked like a pair with no connection at all and the discovery handler
 * happily created a second, active one next to the blocked one. That handed
 * the blocked person a way to unblock themselves.
 */
async function findPairConnection(aId: string, bId: string) {
  return await Connection.findOne({
    participants: {
      $all: [new mongoose.Types.ObjectId(aId), new mongoose.Types.ObjectId(bId)],
    },
  });
}

/** Both people have discovered each other, so a connection is warranted. */
async function isMutualDiscovery(aId: string, bId: string) {
  const [forward, reverse] = await Promise.all([
    Discovery.findOne({ viewerId: aId, targetId: bId }),
    Discovery.findOne({ viewerId: bId, targetId: aId }),
  ]);
  return !!forward && !!reverse;
}

// "Discover" / View a user profile
// POST /api/discovery/:targetId
router.post("/:targetId", apiRateLimiter, authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { targetId } = req.params;
    const viewerUid = req.user.uid;

    // Get Viewer's MongoDB ID
    const viewer = req.user.dbUser || (await mongoService.getUserByFirebaseUid(viewerUid));
    if (!viewer) {
      return res.status(404).json({ error: "Viewer not found" });
    }
    const viewerId = viewer._id.toString();

    // Check if target exists (by MongoDB ID or Firebase UID)
    let target = await mongoService.getUserById(targetId).catch(() => null);
    if (!target) {
      target = await mongoService.getUserByFirebaseUid(targetId).catch(() => null);
    }
    if (!target) {
      return res.status(404).json({ error: "Target user not found" });
    }
    const resolvedTargetId = target._id.toString();

    // Prevent self-discovery
    if (viewerId === resolvedTargetId) {
      return res.status(400).json({ error: "Cannot discover yourself" });
    }

    // Any connection for this pair, active or blocked. This used to ask only
    // for an active one, which is why a block could be undone by the person
    // who was blocked: with the blocked row invisible here, the mutual-discovery
    // branch below created a fresh active connection beside it and both of them
    // got a "New Match!" notification.
    const existingConnection = await findPairConnection(viewerId, resolvedTargetId);

    if (existingConnection?.status === "blocked") {
      // Say nothing about who blocked whom. Either way there is nothing to
      // discover and nothing to create.
      return res.json({ status: "blocked", messagingUnlocked: false });
    }

    if (existingConnection) {
      return res.json({
        status: "connected",
        messagingUnlocked: true,
        connectionId: existingConnection._id,
      });
    }

    // Check if ALREADY discovered (idempotency)
    const existingDiscovery = await Discovery.findOne({
      viewerId: new mongoose.Types.ObjectId(viewerId),
      targetId: new mongoose.Types.ObjectId(resolvedTargetId),
    });

    if (existingDiscovery) {
      // Just return "discovered" status, check for reverse again just in case
      const reverseDiscovery = await Discovery.findOne({
        viewerId: new mongoose.Types.ObjectId(resolvedTargetId),
        targetId: new mongoose.Types.ObjectId(viewerId),
      });

      if (reverseDiscovery) {
        // Create connection if missing
        const newConnection = await Connection.create({
          participants: [viewerId, resolvedTargetId],
          status: "active",
        });

        // Create Notifications
        await NotificationModel.create([
          {
            userId: viewerId,
            type: "match",
            title: "New Match! 🎉",
            message: `You matched with ${target.name}!`,
            relatedId: newConnection._id,
          },
          {
            userId: resolvedTargetId,
            type: "match",
            title: "New Match! 🎉",
            message: `You matched with ${viewer.name}!`,
            relatedId: newConnection._id,
          },
        ]);

        // @ts-ignore - access io from app
        const io = req.app.get("io");
        if (io) {
          // Emit to both users
          io.to(`user:${viewerId}`).emit("discovery:match", {
            partner: { id: target._id, name: target.name, avatar: target.avatar },
            connectionId: newConnection._id,
          });
          io.to(`user:${resolvedTargetId}`).emit("discovery:match", {
            partner: { id: viewer._id, name: viewer.name, avatar: viewer.avatar },
            connectionId: newConnection._id,
          });
        }

        return res.json({
          status: "matched",
          messagingUnlocked: true,
          connectionId: newConnection._id,
        });
      }

      return res.json({ status: "discovered", messagingUnlocked: false });
    }

    // CREATE NEW DISCOVERY RECORD
    await Discovery.create({
      viewerId: new mongoose.Types.ObjectId(viewerId),
      targetId: new mongoose.Types.ObjectId(resolvedTargetId),
    });

    // CHECK FOR MUTUAL (Reverse Discovery)
    const reverseDiscovery = await Discovery.findOne({
      viewerId: new mongoose.Types.ObjectId(resolvedTargetId),
      targetId: new mongoose.Types.ObjectId(viewerId),
    });

    if (reverseDiscovery) {
      // IT'S A MATCH!
      const newConnection = await Connection.create({
        participants: [viewerId, resolvedTargetId],
        status: "active",
      });

      // Create Notifications
      await NotificationModel.create([
        {
          userId: viewerId,
          type: "match",
          title: "New Match! 🎉",
          message: `You matched with ${target.name}!`,
          relatedId: newConnection._id,
        },
        {
          userId: resolvedTargetId,
          type: "match",
          title: "New Match! 🎉",
          message: `You matched with ${viewer.name}!`,
          relatedId: newConnection._id,
        },
      ]);

      // @ts-ignore - access io from app
      const io = req.app.get("io");
      if (io) {
        io.to(`user:${viewerId}`).emit("discovery:match", {
          partner: { id: target._id, name: target.name, avatar: target.avatar },
          connectionId: newConnection._id,
        });
        io.to(`user:${resolvedTargetId}`).emit("discovery:match", {
          partner: { id: viewer._id, name: viewer.name, avatar: viewer.avatar },
          connectionId: newConnection._id,
        });
      }

      return res.json({
        status: "matched",
        messagingUnlocked: true,
        connectionId: newConnection._id,
      });
    }

    // No match yet
    return res.json({ status: "discovered", messagingUnlocked: false });
  } catch (error) {
    logger.error("Discovery error:", error);
    res.status(500).json({ error: "Failed to process discovery" });
  }
});

// Check status between current user and target
router.get("/status/:targetId", authenticate, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });

    const { targetId } = req.params;
    const viewerUid = req.user.uid;
    const viewer = req.user.dbUser || (await mongoService.getUserByFirebaseUid(viewerUid));
    if (!viewer) return res.status(404).json({ error: "Viewer not found" });

    // The id went straight into the query before this, so a Firebase uid or any
    // other non-ObjectId answered with a 500 from Mongoose's cast error.
    const target = await resolveUser(targetId);
    if (!target) return res.status(404).json({ error: "Target user not found" });

    const viewerId = viewer._id.toString();
    const resolvedTargetId = target._id.toString();

    const connection = await findPairConnection(viewerId, resolvedTargetId);

    if (connection?.status === "blocked") {
      // The chat header needs to know whether to offer Block or Unblock, so
      // say who is holding the block — but only ever to the blocker.
      const blockedByMe = connection.blockedBy?.toString() === viewerId;
      return res.json({
        status: "blocked",
        messagingUnlocked: false,
        blockedByMe,
        // No blockedBy recorded: a row from before that field existed, which
        // either participant may lift.
        canUnblock: blockedByMe || !connection.blockedBy,
      });
    }

    if (connection) {
      return res.json({ status: "connected", messagingUnlocked: true });
    }

    const discovery = await Discovery.findOne({
      viewerId: viewer._id,
      targetId: target._id,
    });

    return res.json({
      status: discovery ? "discovered" : "none",
      messagingUnlocked: false,
    });
  } catch (error) {
    logger.error("Error checking status:", error);
    res.status(500).json({ error: "Failed to check status" });
  }
});

// Block a user
router.post("/block/:targetId", apiRateLimiter, authenticate, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });

    const { targetId } = req.params;
    const viewerUid = req.user.uid;
    const viewer = req.user.dbUser || (await mongoService.getUserByFirebaseUid(viewerUid));
    if (!viewer) return res.status(404).json({ error: "Viewer not found" });

    const target = await resolveUser(targetId);
    if (!target) return res.status(404).json({ error: "Target user not found" });

    const viewerId = viewer._id.toString();
    const resolvedTargetId = target._id.toString();
    if (viewerId === resolvedTargetId) {
      return res.status(400).json({ error: "You cannot block yourself" });
    }

    const connection = await findPairConnection(viewerId, resolvedTargetId);

    if (connection?.status === "blocked") {
      // Already blocked. Don't reassign blockedBy — that would let the blocked
      // person take ownership of the block and then lift it.
      return res.json({ success: true, message: "User blocked" });
    }

    if (connection) {
      connection.status = "blocked";
      connection.blockedBy = viewer._id;
      await connection.save();
      return res.json({ success: true, message: "User blocked" });
    }

    // No connection yet. Blocking used to answer 404 here, so you could not
    // block anyone you had not already matched with — and nothing stopped the
    // two of you matching later. A blocked row with no match behind it records
    // the refusal and keeps the discovery handler above from forming one.
    await Connection.create({
      participants: [viewer._id, target._id],
      status: "blocked",
      blockedBy: viewer._id,
    });

    return res.json({ success: true, message: "User blocked" });
  } catch (error) {
    logger.error("Error blocking user:", error);
    res.status(500).json({ error: "Failed to block user" });
  }
});

// Unblock a user. There was no way to do this at all: the only route out of a
// block was the resurrection bug the discovery handler used to have.
router.delete("/block/:targetId", apiRateLimiter, authenticate, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });

    const { targetId } = req.params;
    const viewerUid = req.user.uid;
    const viewer = req.user.dbUser || (await mongoService.getUserByFirebaseUid(viewerUid));
    if (!viewer) return res.status(404).json({ error: "Viewer not found" });

    const target = await resolveUser(targetId);
    if (!target) return res.status(404).json({ error: "Target user not found" });

    const viewerId = viewer._id.toString();
    const resolvedTargetId = target._id.toString();

    const connection = await findPairConnection(viewerId, resolvedTargetId);
    if (!connection || connection.status !== "blocked") {
      // Nothing to lift. Idempotent so a double click is harmless.
      return res.json({ success: true, message: "User is not blocked" });
    }

    // Only the person who asked for the block can lift it. Rows from before
    // blockedBy existed carry no owner, so either participant may clear those.
    const isBlocker = connection.blockedBy?.toString() === viewerId;
    if (connection.blockedBy && !isBlocker) {
      return res.status(403).json({ error: "You cannot lift a block you did not set" });
    }

    if (await isMutualDiscovery(viewerId, resolvedTargetId)) {
      // They had matched before the block, so put the match back.
      connection.status = "active";
      connection.blockedBy = undefined;
      await connection.save();
      return res.json({ success: true, status: "connected", messagingUnlocked: true });
    }

    // A pre-emptive block with no match behind it: drop the row and leave the
    // two of them as strangers rather than inventing a connection.
    await Connection.deleteOne({ _id: connection._id });
    return res.json({ success: true, status: "none", messagingUnlocked: false });
  } catch (error) {
    logger.error("Error unblocking user:", error);
    res.status(500).json({ error: "Failed to unblock user" });
  }
});

export default router;

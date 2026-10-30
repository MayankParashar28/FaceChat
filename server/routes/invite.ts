import { logger } from "../utils/logger";
import { Router } from "express";
import { Conversation, Invite, Connection, Discovery, Notification } from "../models";
import { authenticate } from "../middleware/auth";
import { mongoService } from "../services/mongodb"; // Import mongoService
import {
  DEFAULT_GHOST_LIFETIME_MS,
  GHOST_LINK_REDEEM_WINDOW_MS,
  MAX_GHOST_LIFETIME_MS,
  MIN_GHOST_LIFETIME_MS,
  enforceGhostExpiry,
  scheduleGhostDestruction,
} from "../services/ghostChat";
import { CacheKeys, cacheDelete } from "../services/cache";
import crypto from "crypto";

const router = Router();

/**
 * Codes are lowercase hex from `crypto.randomBytes(4)`, so an exact match is
 * all that is needed.
 *
 * Both lookups used to build `new RegExp(`^${code}$`, "i")` from the URL
 * without escaping it, so a code of `.*` matched the first invite in the
 * collection — any caller could read, and redeem, somebody else's link.
 */
function normalizedCode(raw: string): string | null {
  const code = String(raw || "")
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{6,64}$/.test(code) ? code : null;
}

// Generate a new invite
router.post("/generate", authenticate, async (req, res) => {
  try {
    const user = req.user!;
    let dbUser = user.dbUser;

    // Fallback: Create/Get user if missing in DB but authenticated in Firebase
    if (!dbUser) {
      logger.info(`User ${user.uid} missing in DB for invite generation, creating on the fly...`);
      try {
        dbUser = await mongoService.createOrUpdateUser({
          firebaseUid: user.uid,
          email: user.email || `${user.uid}@placeholder.email`,
          name: user.name || "User",
          username: (function () {
            let u = (user.email?.split("@")[0] || `user_${user.uid.substring(0, 6)}`)
              .toLowerCase()
              .replace(/[^a-z0-9_]/g, "_");
            if (u.length < 3) u = u + "_user";
            return u;
          })(),
        });
      } catch (err) {
        logger.error("Failed to auto-create user:", err);
        return res.status(500).json({ message: "User profile could not be created" });
      }
    }

    if (!dbUser) {
      return res.status(404).json({ message: "User profile not found" });
    }

    // Generate a random 8-character code
    const code = crypto.randomBytes(4).toString("hex");

    const isGhost = req.body?.kind === "ghost";

    // `expiresAt` is the window for redeeming the link. For a ghost that is
    // not the same thing as the life of the chat it opens, which is stamped
    // when somebody actually redeems it.
    const expiresAt = new Date(
      Date.now() + (isGhost ? GHOST_LINK_REDEEM_WINDOW_MS : 24 * 60 * 60 * 1000)
    );

    let chatLifetimeMs: number | undefined;
    if (isGhost) {
      const requested = Number(req.body?.lifetimeMinutes);
      chatLifetimeMs = Number.isFinite(requested)
        ? Math.min(Math.max(requested * 60 * 1000, MIN_GHOST_LIFETIME_MS), MAX_GHOST_LIFETIME_MS)
        : DEFAULT_GHOST_LIFETIME_MS;
    }

    const invite = await Invite.create({
      creatorId: dbUser._id,
      code,
      kind: isGhost ? "ghost" : "standard",
      expiresAt,
      chatLifetimeMs,
    });

    res.json({
      code: invite.code,
      kind: invite.kind,
      expiresAt: invite.expiresAt,
      chatLifetimeMs: invite.chatLifetimeMs,
    });
  } catch (error: any) {
    logger.error("Generate invite error:", error);
    res.status(500).json({
      message: error.message || "Failed to generate invite",
      details: error.toString(),
    });
  }
});

/**
 * Withdraw an invite that nobody has used yet.
 *
 * A link, once sent, could not be taken back: it stayed redeemable for its
 * whole 24-hour window, so pasting one into the wrong thread meant waiting a
 * day to be sure of who could reach you.
 *
 * Only the creator, and only while it is unused — a redeemed ghost link is
 * the handle on a conversation that already exists, and deleting the row
 * would strand the chat with no way to destroy it afterwards.
 */
router.delete("/:code", authenticate, async (req, res) => {
  try {
    const dbUser = req.user?.dbUser;
    if (!dbUser) {
      return res.status(404).json({ message: "User profile not found" });
    }

    const safeCode = normalizedCode(req.params.code);
    if (!safeCode) {
      return res.status(404).json({ message: "Invite not found" });
    }

    // One conditional delete rather than read-then-delete: somebody redeeming
    // in the gap between the two would have their chat taken out from under
    // them, and the owner would be told the link was withdrawn unused.
    const revoked = await Invite.findOneAndDelete({
      code: safeCode,
      creatorId: dbUser._id,
      uses: 0,
      conversationId: { $exists: false },
    });

    if (revoked) {
      return res.json({ success: true, revoked: true });
    }

    // Scoped to this user, so it cannot be used to find out whether somebody
    // else's code exists.
    const own = await Invite.findOne({ code: safeCode, creatorId: dbUser._id }).select("_id");
    if (own) {
      return res.status(409).json({ message: "That link has already been used." });
    }
    return res.status(404).json({ message: "Invite not found" });
  } catch (error: any) {
    logger.error("Revoke invite error:", error);
    res.status(500).json({ message: "Failed to revoke the invite" });
  }
});

// Get invite details (public endpoint, to show preview)
router.get("/:code", async (req, res) => {
  try {
    const safeCode = normalizedCode(req.params.code);
    if (!safeCode) {
      return res.status(404).json({ message: "Invite not found or expired" });
    }

    const invite = await Invite.findOne({
      code: safeCode,
      expiresAt: { $gt: new Date() }, // Not expired
    }).populate("creatorId", "name avatar username");

    if (!invite) {
      return res.status(404).json({ message: "Invite not found or expired" });
    }

    // A link whose uses are gone is spent, whatever its expiry says. This is
    // only the preview, so it reports the state rather than refusing.
    const spent = invite.uses >= invite.maxUses;

    res.json({
      creator: invite.creatorId,
      expiresAt: invite.expiresAt,
      kind: invite.kind,
      chatLifetimeMs: invite.chatLifetimeMs,
      spent,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch invite" });
  }
});

// Accept invite
router.post("/:code/accept", authenticate, async (req, res) => {
  try {
    const { code } = req.params;
    const user = req.user!;
    let dbUser = user.dbUser;

    // Fallback for acceptor too
    if (!dbUser) {
      try {
        dbUser = await mongoService.createOrUpdateUser({
          firebaseUid: user.uid,
          email: user.email || `${user.uid}@placeholder.email`,
          name: user.name || "User",
          username: (function () {
            let u = (user.email?.split("@")[0] || `user_${user.uid.substring(0, 6)}`)
              .toLowerCase()
              .replace(/[^a-z0-9_]/g, "_");
            if (u.length < 3) u = u + "_user";
            return u;
          })(),
        });
      } catch (err) {
        return res.status(500).json({ message: "User profile could not be created" });
      }
    }

    if (!dbUser) {
      return res.status(404).json({ message: "User profile not found" });
    }

    const safeCode = normalizedCode(code);
    if (!safeCode) {
      return res.status(404).json({ message: "Invite not found or expired" });
    }

    // Read first, so self-redemption and an already-open ghost chat are
    // settled before a use is spent.
    const invite = await Invite.findOne({ code: safeCode, expiresAt: { $gt: new Date() } });

    if (!invite) {
      return res.status(404).json({ message: "Invite not found or expired" });
    }

    // A ghost link already redeemed by this person reopens their chat rather
    // than refusing them: reloading the page should not cost them the chat.
    if (invite.kind === "ghost" && invite.conversationId) {
      const existingChat = await Conversation.findById(invite.conversationId);
      if (existingChat && !(await enforceGhostExpiry(existingChat))) {
        const isParticipant = existingChat.participants.some(
          (p) => p.toString() === dbUser._id.toString()
        );
        if (isParticipant) {
          return res.json({
            message: "Rejoined your GhostLink chat.",
            kind: "ghost",
            conversationId: existingChat._id,
            destructAt: existingChat.destructAt,
          });
        }
      }
      return res.status(410).json({ message: "This GhostLink has already been used." });
    }

    if (invite.creatorId.toString() === dbUser._id.toString()) {
      return res.status(400).json({ message: "You cannot accept your own invite" });
    }

    // Claim a use atomically.
    //
    // `maxUses` was never compared with `uses`: the count went up and nothing
    // ever read it, so every link issued was unlimited-use until it expired.
    // Reading, adding one and saving would not have fixed it either — two
    // people clicking at once both read the same number and both write it
    // back. One conditional update is the entire check.
    const claimed = await Invite.findOneAndUpdate(
      {
        _id: invite._id,
        expiresAt: { $gt: new Date() },
        $expr: { $lt: ["$uses", "$maxUses"] },
      },
      { $inc: { uses: 1 } },
      { new: true }
    );

    if (!claimed) {
      return res
        .status(410)
        .json({ message: "This invite has already been used, or it has expired." });
    }

    if (claimed.kind === "ghost") {
      try {
        const lifetime = claimed.chatLifetimeMs || DEFAULT_GHOST_LIFETIME_MS;
        const chat = await Conversation.create({
          participants: [dbUser._id, claimed.creatorId],
          createdBy: claimed.creatorId,
          isGroup: false,
          isGhost: true,
          destructAt: new Date(Date.now() + lifetime),
        });
        claimed.conversationId = chat._id;
        await claimed.save();

        // Fire on the second rather than waiting for a sweep tick. The sweep
        // remains the backstop for anything a restart drops.
        if (chat.destructAt) scheduleGhostDestruction(chat._id, chat.destructAt);

        // Both lists are cached for half a minute. Without dropping them the
        // chat is missing from the creator's list for up to thirty seconds
        // after they are told it opened — and on a one-minute ghost that is
        // half of it gone before they can see the room.
        await cacheDelete(
          CacheKeys.conversationList(dbUser._id.toString()),
          CacheKeys.conversationList(claimed.creatorId.toString())
        );

        // Tell the creator their link was used. They had no way to know:
        // sharing a GhostLink and then watching the app for a room to appear
        // was the only signal, and a short-lived chat can be over before
        // anybody thinks to look.
        //
        // Deliberately says nothing about who walked in — a ghost chat makes
        // no connection and leaves no trace of the other person, so naming
        // them in a notification that outlives the chat would undo it.
        try {
          await Notification.create({
            userId: claimed.creatorId,
            type: "system",
            title: "GhostLink opened 👻",
            message: "Someone opened your GhostLink. The chat is live and already counting down.",
            relatedId: chat._id,
          });
        } catch (err) {
          // A missing notice must not cost somebody the chat they just opened.
          logger.error("Could not record the GhostLink-opened notification:", err);
        }

        // No Discovery and no Connection on purpose: a ghost chat leaves the
        // two of them strangers afterwards, which is the whole point of it.
        return res.json({
          message: "GhostLink opened.",
          kind: "ghost",
          conversationId: chat._id,
          destructAt: chat.destructAt,
        });
      } catch (error) {
        // The use is spent but nothing opened. Give it back rather than burn
        // somebody's link on a failure of ours.
        await Invite.updateOne({ _id: claimed._id }, { $inc: { uses: -1 } });
        throw error;
      }
    }

    // BI-DIRECTIONAL DISCOVERY
    await Discovery.updateOne(
      { viewerId: dbUser._id, targetId: invite.creatorId },
      { viewerId: dbUser._id, targetId: invite.creatorId, timestamp: new Date() },
      { upsert: true }
    );
    await Discovery.updateOne(
      { viewerId: invite.creatorId, targetId: dbUser._id },
      { viewerId: invite.creatorId, targetId: dbUser._id, timestamp: new Date() },
      { upsert: true }
    );

    // CREATE CONNECTION
    let connection = await Connection.findOne({
      participants: { $all: [dbUser._id, invite.creatorId] },
    });

    if (!connection) {
      connection = await Connection.create({
        participants: [dbUser._id, invite.creatorId],
        status: "active",
      });
    }

    res.json({ message: "Invite accepted! Connection formed.", connectionId: connection._id });
  } catch (error) {
    logger.error("Accept invite error:", error);
    res.status(500).json({ message: "Failed to accept invite" });
  }
});

export default router;

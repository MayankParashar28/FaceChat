/**
 * Chat attachments.
 *
 * Upload goes through here for both backends (see services/attachmentStorage).
 * Delivery differs:
 *
 *   Cloudinary — this server only signs a URL after checking the caller is a
 *   participant; the bytes then come straight from the CDN, resized and in a
 *   modern format, and never touch this process.
 *
 *   GridFS — this server streams the bytes itself, which is why it is the
 *   fallback rather than the default.
 *
 * Bytes are sent as a raw body rather than multipart, which avoids pulling in
 * a multipart parser; the file's name and type travel as query parameters.
 */

import { logger } from "../utils/logger";
import { Router } from "express";
import express from "express";
import mongoose from "mongoose";
import { authenticate } from "../middleware/auth";
import { apiRateLimiter } from "../middleware/rateLimiter";
import { mongoService } from "../services/mongodb";
import { Conversation } from "../models";
import {
  MAX_UPLOAD_BYTES,
  findGridfsFile,
  isCloudinaryConfigured,
  openGridfsDownload,
  publicIdBelongsToConversation,
  signedDeliveryUrl,
  storeAttachment,
} from "../services/attachmentStorage";

const router = Router();

/** Types we are willing to store and serve back to a browser. */
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

/** Resolve the caller's MongoDB user and confirm they belong to the conversation. */
async function assertParticipant(firebaseUid: string, conversationId: string) {
  if (!mongoose.Types.ObjectId.isValid(conversationId)) return null;
  const dbUser = await mongoService.getUserByFirebaseUid(firebaseUid);
  if (!dbUser) return null;
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) return null;
  const isParticipant = conversation.participants.some(
    (p) => p.toString() === dbUser._id.toString()
  );
  return isParticipant ? dbUser : null;
}

// Upload a file for a conversation. Returns the metadata the client then sends
// with `message:send`; the message itself is created over the socket so it goes
// through the same FaceLink gate as any other message.
router.post(
  "/conversations/:conversationId/attachments",
  apiRateLimiter,
  authenticate,
  express.raw({ type: "*/*", limit: MAX_UPLOAD_BYTES }),
  async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { conversationId } = req.params;
      const dbUser = await assertParticipant(req.user.uid, conversationId);
      if (!dbUser) {
        return res.status(403).json({ error: "Access denied" });
      }

      const name = typeof req.query.name === "string" ? req.query.name.slice(0, 200) : "file";
      const mimeType = typeof req.query.type === "string" ? req.query.type : "";
      const body = req.body as Buffer;

      if (!Buffer.isBuffer(body) || body.length === 0) {
        return res.status(400).json({ error: "Empty upload" });
      }
      if (!ALLOWED_MIME.has(mimeType)) {
        return res.status(415).json({ error: `Unsupported file type: ${mimeType || "unknown"}` });
      }

      const stored = await storeAttachment({
        body,
        name,
        mimeType,
        conversationId,
        uploadedBy: dbUser._id.toString(),
      });

      res.status(201).json(stored);
    } catch (error) {
      logger.error("Error uploading attachment:", error);
      res.status(500).json({ error: "Failed to upload attachment" });
    }
  }
);

// Hand back a signed CDN URL for a Cloudinary attachment. The participant check
// happens here; the signature then stands in for it at the edge, so the bytes
// never pass through this server.
router.get("/attachments/signed-url", authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!isCloudinaryConfigured()) {
      return res.status(409).json({ error: "Cloudinary is not configured" });
    }

    const publicId = typeof req.query.publicId === "string" ? req.query.publicId : "";
    const conversationId =
      typeof req.query.conversationId === "string" ? req.query.conversationId : "";
    const resourceType =
      typeof req.query.resourceType === "string" ? req.query.resourceType : "image";

    if (!publicId || !conversationId) {
      return res.status(400).json({ error: "publicId and conversationId are required" });
    }
    // Being a participant of *some* conversation is not enough: the asset has
    // to live in this one's folder.
    if (!publicIdBelongsToConversation(publicId, conversationId)) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (!(await assertParticipant(req.user.uid, conversationId))) {
      return res.status(403).json({ error: "Access denied" });
    }

    res.json({ url: signedDeliveryUrl(publicId, resourceType) });
  } catch (error) {
    logger.error("Error signing attachment URL:", error);
    res.status(500).json({ error: "Failed to sign attachment URL" });
  }
});

// Stream a GridFS attachment. Only reachable for files stored before (or
// without) Cloudinary; authorized against the conversation recorded on the file.
router.get("/attachments/:fileId", authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { fileId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(fileId)) {
      return res.status(400).json({ error: "Invalid file id" });
    }

    const objectId = new mongoose.Types.ObjectId(fileId);
    const file = await findGridfsFile(objectId);
    if (!file) {
      return res.status(404).json({ error: "File not found" });
    }

    const conversationId = (file.metadata as { conversationId?: string } | undefined)
      ?.conversationId;
    if (!conversationId || !(await assertParticipant(req.user.uid, conversationId))) {
      return res.status(403).json({ error: "Access denied" });
    }

    res.setHeader("Content-Type", file.contentType || "application/octet-stream");
    res.setHeader("Content-Length", String(file.length));
    // Not cached at all. `private, max-age=...` still lets one browser profile
    // reuse the bytes, so after a second person signs in on the same machine
    // they would be served the file without the participant check running
    // again. These are per-conversation files; correctness beats a re-download.
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.filename)}"`);

    const stream = openGridfsDownload(objectId);
    stream.on("error", (err) => {
      logger.error("Error streaming attachment:", err);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    stream.pipe(res);
  } catch (error) {
    logger.error("Error fetching attachment:", error);
    res.status(500).json({ error: "Failed to fetch attachment" });
  }
});

export default router;

/**
 * Where chat attachments live.
 *
 * Cloudinary is used when it is configured, and MongoDB GridFS otherwise, so
 * the feature keeps working on a machine (or a deploy) with no Cloudinary
 * credentials rather than failing every upload.
 *
 * Why Cloudinary is preferred: with GridFS every view streams the whole file
 * through this server, which on Render's free plan means waking a sleeping
 * instance and spending its bandwidth on a file the browser cannot cache.
 * Cloudinary serves from a CDN and can hand back a resized, modern-format
 * version of an image — usually tens of KB instead of megabytes.
 *
 * Privacy: assets are uploaded as `authenticated`, so they are not reachable
 * from a plain URL. A delivery URL has to be signed with the API secret, and
 * this server only signs one after checking the caller is a participant of the
 * conversation the asset belongs to. That check is possible because the
 * conversation id is part of the asset's folder path (see folderFor).
 */

import { v2 as cloudinary } from "cloudinary";
import mongoose from "mongoose";
import { logger } from "../utils/logger";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB

const GRIDFS_BUCKET = "attachments";
const CLOUDINARY_ROOT = "facecall/attachments";

export type AttachmentProvider = "cloudinary" | "gridfs";

export interface StoredAttachment {
  provider: AttachmentProvider;
  /** GridFS object id, or the Cloudinary public id. */
  storageId: string;
  /** Cloudinary only: image | video | raw, needed to build a delivery URL. */
  resourceType?: string;
  name: string;
  size: number;
  mimeType: string;
}

let configured = false;

export function isCloudinaryConfigured(): boolean {
  if (configured) return true;

  // Cloudinary's dashboard hands you a single CLOUDINARY_URL
  // (cloudinary://key:secret@cloud_name); the SDK parses that from the
  // environment on its own. The three separate variables are the alternative,
  // and are what a host like Render is easier to configure with. Accept either.
  if (process.env.CLOUDINARY_URL) {
    cloudinary.config({ secure: true });
    configured = !!cloudinary.config().cloud_name;
    return configured;
  }

  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) return false;
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
  return true;
}

/**
 * Assets are filed under their conversation so that a public id proves which
 * conversation it belongs to. Without that, a caller could ask us to sign a
 * URL for someone else's asset while naming a conversation they do belong to.
 */
function folderFor(conversationId: string): string {
  return `${CLOUDINARY_ROOT}/${conversationId}`;
}

export function publicIdBelongsToConversation(publicId: string, conversationId: string): boolean {
  return publicId.startsWith(`${folderFor(conversationId)}/`);
}

function gridfsBucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db!, {
    bucketName: GRIDFS_BUCKET,
  });
}

/** Cloudinary splits uploads by kind; everything that is not an image or video is "raw". */
function resourceTypeFor(mimeType: string): "image" | "video" | "raw" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "raw";
}

export async function storeAttachment(opts: {
  body: Buffer;
  name: string;
  mimeType: string;
  conversationId: string;
  uploadedBy: string;
}): Promise<StoredAttachment> {
  const { body, name, mimeType, conversationId, uploadedBy } = opts;

  if (isCloudinaryConfigured()) {
    const resourceType = resourceTypeFor(mimeType);
    const result = await new Promise<{ public_id: string; bytes: number }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: folderFor(conversationId),
          resource_type: resourceType,
          // Not reachable without a signed URL.
          type: "authenticated",
          // Let Cloudinary pick the id so it cannot be guessed from the name.
          use_filename: false,
          unique_filename: true,
          context: { uploadedBy, originalName: name },
        },
        (error, uploaded) => {
          if (error || !uploaded) return reject(error || new Error("Cloudinary upload failed"));
          resolve(uploaded as { public_id: string; bytes: number });
        }
      );
      stream.end(body);
    });

    return {
      provider: "cloudinary",
      storageId: result.public_id,
      resourceType,
      name,
      size: result.bytes ?? body.length,
      mimeType,
    };
  }

  const upload = gridfsBucket().openUploadStream(name, {
    contentType: mimeType,
    metadata: { conversationId, uploadedBy, uploadedAt: new Date() },
  });
  upload.end(body);
  await new Promise<void>((resolve, reject) => {
    upload.on("finish", () => resolve());
    upload.on("error", reject);
  });

  return {
    provider: "gridfs",
    storageId: upload.id.toString(),
    name,
    size: body.length,
    mimeType,
  };
}

/**
 * A signed, non-guessable delivery URL for a Cloudinary asset.
 *
 * Images also get `f_auto,q_auto`, which is the reason to be on a CDN at all:
 * Cloudinary converts to WebP/AVIF and picks a sensible quality, so a photo
 * arrives at a fraction of its original size.
 */
export function signedDeliveryUrl(publicId: string, resourceType = "image"): string {
  if (!isCloudinaryConfigured()) {
    throw new Error("Cloudinary is not configured");
  }
  return cloudinary.url(publicId, {
    resource_type: resourceType,
    type: "authenticated",
    sign_url: true,
    secure: true,
    ...(resourceType === "image"
      ? { transformation: [{ fetch_format: "auto", quality: "auto" }] }
      : {}),
  });
}

/** Stream a GridFS attachment; only used when Cloudinary is not configured. */
export function openGridfsDownload(fileId: mongoose.Types.ObjectId) {
  return gridfsBucket().openDownloadStream(fileId);
}

export async function findGridfsFile(fileId: mongoose.Types.ObjectId) {
  const [file] = await gridfsBucket().find({ _id: fileId }).limit(1).toArray();
  return file ?? null;
}

export async function deleteAttachment(attachment: {
  provider: AttachmentProvider;
  storageId: string;
  resourceType?: string;
}): Promise<void> {
  try {
    if (attachment.provider === "cloudinary") {
      if (!isCloudinaryConfigured()) return;
      await cloudinary.uploader.destroy(attachment.storageId, {
        resource_type: attachment.resourceType || "image",
        type: "authenticated",
      });
      return;
    }
    if (mongoose.Types.ObjectId.isValid(attachment.storageId)) {
      await gridfsBucket().delete(new mongoose.Types.ObjectId(attachment.storageId));
    }
  } catch (error) {
    logger.warn("Could not delete attachment:", error);
  }
}

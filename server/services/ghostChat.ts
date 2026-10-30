/**
 * GhostLink chats: conversations that erase themselves.
 *
 * The promise a ghost chat makes is that nothing survives it, so deleting the
 * message rows is not enough. A message's bytes live on Cloudinary or in
 * GridFS, keyed by `attachment.storageId`, and nothing in MongoDB knows how to
 * reach them — drop the rows and every photo sent in the chat is still sitting
 * on the CDN. So destruction runs in a fixed order: attachments at their
 * provider, then the messages, then the conversation, then the invite that
 * opened it.
 *
 * Two things trigger it. A sweep on the existing cron tick catches chats whose
 * time has passed while nobody was looking, and a check on read refuses an
 * overdue chat the moment someone asks for it — the free dyno sleeps, and a
 * sweep that has not run for an hour must not mean an hour of extra life.
 */

import { logger } from "../utils/logger";
import { Conversation, Invite, Message } from "../models";
import { deleteAttachment } from "./attachmentStorage";
import { CacheKeys, cacheDelete } from "./cache";
import type { Types } from "mongoose";

/** How long a ghost chat lives once it is opened, when no other value is set. */
export const DEFAULT_GHOST_LIFETIME_MS = 10 * 60 * 1000;

/** The window in which a ghost link may be redeemed before it goes stale. */
export const GHOST_LINK_REDEEM_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Bounds a caller may choose a lifetime within: one minute to one day. */
export const MIN_GHOST_LIFETIME_MS = 60 * 1000;
export const MAX_GHOST_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * How the rest of the app is told a chat has gone.
 *
 * `destroyGhostConversation` cannot reach socket.io directly: `io` is created
 * inside `registerRoutes`, and cron imports this module, so importing routes
 * here would close a cycle. routes.ts hands the emitter over at startup
 * instead.
 */
type GhostBroadcaster = (conversationId: string, erased: DestructionResult) => void;
let broadcast: GhostBroadcaster | null = null;

export function setGhostBroadcaster(fn: GhostBroadcaster | null): void {
  broadcast = fn;
}

/**
 * Exact timers for chats that are already open, keyed by conversation id.
 *
 * The sweep alone means a chat nobody is looking at can outlive its deadline
 * until the next tick. A timer armed the moment the link is redeemed fires on
 * the second instead. Timers do not survive a restart, which is exactly why
 * the sweep stays: it is the backstop, not the mechanism.
 */
const pendingTimers = new Map<string, NodeJS.Timeout>();

export function scheduleGhostDestruction(
  conversationId: Types.ObjectId | string,
  destructAt: Date
): void {
  const id = conversationId.toString();
  const existing = pendingTimers.get(id);
  if (existing) clearTimeout(existing);

  const delay = Math.max(0, new Date(destructAt).getTime() - Date.now());
  const timer = setTimeout(() => {
    pendingTimers.delete(id);
    destroyGhostConversation(id).catch((error) =>
      logger.error(`Timed destruction of ghost chat ${id} failed:`, error)
    );
  }, delay);
  // Do not hold the process open for a chat that has not expired yet.
  timer.unref?.();
  pendingTimers.set(id, timer);
}

/**
 * Re-arm timers for ghost chats still in flight.
 *
 * Called once the database is up, since a restart drops every timer: without
 * this, chats opened before the restart would wait for a sweep tick.
 */
export async function rearmPendingGhostChats(): Promise<number> {
  const inFlight = await Conversation.find({
    isGhost: true,
    destructAt: { $gt: new Date() },
  })
    .select("_id destructAt")
    .lean();

  for (const conversation of inFlight) {
    if (conversation.destructAt) {
      scheduleGhostDestruction(conversation._id, conversation.destructAt);
    }
  }
  return inFlight.length;
}

export interface DestructionResult {
  messages: number;
  attachments: number;
}

/**
 * Erase one ghost conversation and everything it carried.
 *
 * Safe to call twice: each step is keyed on ids that no longer match once it
 * has run, so a sweep racing a read cannot double-count or fail.
 */
export async function destroyGhostConversation(
  conversationId: Types.ObjectId | string
): Promise<DestructionResult> {
  const result: DestructionResult = { messages: 0, attachments: 0 };

  // Read the participants before the conversation goes: their cached
  // conversation lists have to be dropped, and afterwards there is nothing
  // left to say whose they were.
  const conversation = await Conversation.findById(conversationId).select("participants").lean();

  // Only the messages that actually carry bytes, so the common case costs one
  // query and no provider calls.
  const withAttachments = await Message.find({
    conversationId,
    attachment: { $exists: true, $ne: null },
  })
    .select("attachment")
    .lean();

  for (const message of withAttachments) {
    const attachment = (message as { attachment?: any }).attachment;
    if (!attachment?.provider || !attachment?.storageId) continue;
    // deleteAttachment swallows provider errors and warns. A file we cannot
    // reach must not strand the rest of the chat, but it is worth counting
    // only what we believe went.
    await deleteAttachment({
      provider: attachment.provider,
      storageId: attachment.storageId,
      resourceType: attachment.resourceType,
    });
    result.attachments += 1;
  }

  const deleted = await Message.deleteMany({ conversationId });
  result.messages = deleted.deletedCount ?? 0;

  await Conversation.deleteOne({ _id: conversationId });

  // The conversation list is cached per user for a few seconds. Without this
  // the row keeps being served after the chat is gone — and a list row still
  // carries a preview of its last message.
  if (conversation?.participants?.length) {
    await cacheDelete(
      ...conversation.participants.map((p) => CacheKeys.conversationList(p.toString()))
    );
  }
  // The invite is what points a URL at this chat; leaving it would hand out a
  // code that resolves to nothing.
  await Invite.deleteMany({ conversationId });

  const id = conversationId.toString();
  const pending = pendingTimers.get(id);
  if (pending) {
    clearTimeout(pending);
    pendingTimers.delete(id);
  }

  // Tell anyone with the chat open, rather than leaving them to notice. Their
  // own countdown would get there, but it runs on the browser's clock and the
  // messages are already drawn on their screen — this is the moment the
  // server actually acted.
  try {
    // The counts go with it: the other person's screen is the only place the
    // promise can be shown to have been kept, and once this returns there is
    // nothing left to count.
    broadcast?.(id, result);
  } catch (error) {
    logger.warn("Could not announce a vanished ghost chat:", error);
  }

  logger.info(
    `GhostLink chat ${conversationId} vanished: ${result.messages} messages, ${result.attachments} attachments`
  );
  return result;
}

/**
 * Whether this conversation has outlived its timer.
 *
 * Takes a plain object as readily as a document, since the read paths work
 * with `.lean()` results.
 */
export function isGhostExpired(conversation: {
  isGhost?: boolean;
  destructAt?: Date | null;
}): boolean {
  if (!conversation?.isGhost || !conversation.destructAt) return false;
  return new Date(conversation.destructAt).getTime() <= Date.now();
}

/** Milliseconds a ghost chat has left, or null when it is not a ghost. */
export function ghostTimeRemaining(conversation: {
  isGhost?: boolean;
  destructAt?: Date | null;
}): number | null {
  if (!conversation?.isGhost || !conversation.destructAt) return null;
  return Math.max(0, new Date(conversation.destructAt).getTime() - Date.now());
}

/**
 * Destroy the conversation if its time has passed, and say whether it is gone.
 *
 * Read paths call this before serving a ghost chat, so an overdue one is never
 * handed over just because the sweep has not come round yet.
 */
export async function enforceGhostExpiry(conversation: {
  _id: Types.ObjectId | string;
  isGhost?: boolean;
  destructAt?: Date | null;
}): Promise<boolean> {
  if (!isGhostExpired(conversation)) return false;
  await destroyGhostConversation(conversation._id);
  return true;
}

/**
 * Erase every ghost chat whose time has passed. Returns how many went.
 *
 * Runs on the cron tick. Overdue chats are processed one at a time rather than
 * in parallel: each one makes a provider call per attachment, and a burst of
 * those on a free dyno is how you get a request timeout elsewhere.
 */
export async function sweepExpiredGhostChats(): Promise<number> {
  const overdue = await Conversation.find({
    isGhost: true,
    destructAt: { $lte: new Date() },
  })
    .select("_id")
    .lean();

  let destroyed = 0;
  for (const conversation of overdue) {
    try {
      await destroyGhostConversation(conversation._id);
      destroyed += 1;
    } catch (error) {
      // One stubborn chat must not stop the rest; the next tick retries it.
      logger.error(`Could not destroy ghost chat ${conversation._id}:`, error);
    }
  }
  return destroyed;
}

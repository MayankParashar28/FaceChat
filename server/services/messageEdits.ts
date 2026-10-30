/**
 * Who may rewrite or take back a message, and for how long.
 *
 * Both are things one person does to a record two people share, so the rules
 * are narrow on purpose and live here rather than inline in a socket handler:
 * getting them wrong means letting someone rewrite the other person's words.
 */

/**
 * How long after sending a message may still be edited.
 *
 * Open-ended editing turns a conversation into something neither party can
 * rely on — you could answer a question and have the question rewritten under
 * you an hour later. Fifteen minutes is long enough for the typo you notice
 * after sending, short enough that the thread above a message is still roughly
 * what was on screen when it was written.
 */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** The longest a message may be, matching what the composer will send. */
export const MAX_MESSAGE_LENGTH = 5000;

export type EditableRecord = {
  senderId: { toString(): string };
  createdAt: Date;
  deletedAt?: Date | null;
  attachment?: unknown;
};

export type Verdict = { ok: true } | { ok: false; reason: string };

/**
 * Whether `userId` may rewrite this message right now.
 *
 * Attachments are excluded: `content` on one of those is the caption, and the
 * file itself cannot be edited, so allowing it would mean a picture whose
 * description no longer matches what is in it.
 */
export function canEdit(msg: EditableRecord, userId: string, now = Date.now()): Verdict {
  if (msg.senderId.toString() !== userId) {
    return { ok: false, reason: "You can only edit your own messages." };
  }
  if (msg.deletedAt) {
    return { ok: false, reason: "That message was deleted." };
  }
  if (msg.attachment) {
    return { ok: false, reason: "Messages with an attachment cannot be edited." };
  }
  if (now - msg.createdAt.getTime() > EDIT_WINDOW_MS) {
    return { ok: false, reason: "That message is too old to edit." };
  }
  return { ok: true };
}

/** Whether the new text is something a message may be changed to. */
export function validateEdit(content: unknown): Verdict {
  if (typeof content !== "string") {
    return { ok: false, reason: "That is not a message." };
  }
  if (content.trim().length === 0) {
    // Emptying a message is deleting it, and that is a different button with
    // a different outcome — saying so beats silently leaving a blank bubble.
    return { ok: false, reason: "An edited message cannot be empty. Delete it instead." };
  }
  if (content.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, reason: "That message is too long." };
  }
  return { ok: true };
}

/**
 * Whether `userId` may take this message back.
 *
 * No time limit, unlike editing: removing something you should not have sent
 * is worth allowing late, and unlike an edit it cannot put words in anyone's
 * mouth. The author only — deleting the other person's message is moderation,
 * which this app does not have.
 */
export function canDelete(msg: EditableRecord, userId: string): Verdict {
  if (msg.senderId.toString() !== userId) {
    return { ok: false, reason: "You can only delete your own messages." };
  }
  if (msg.deletedAt) {
    return { ok: false, reason: "That message was already deleted." };
  }
  return { ok: true };
}

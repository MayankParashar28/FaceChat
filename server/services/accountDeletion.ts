/**
 * What becomes of everything an account touched when that account goes.
 *
 * The rules live here rather than in the route because the awkward part is not
 * the deleting, it is deciding what a conversation with somebody still in it
 * should look like afterwards — and that is worth testing without a database.
 *
 * The invariant the whole thing exists to hold: once this has run, nothing
 * anywhere references the removed account. The alternative is what this
 * codebase had before it — connections pointing at nobody, conversations with
 * no live participant, and messages whose sender cannot be resolved.
 */

import { logger } from "../utils/logger";
import {
  ActivityLog,
  Connection,
  Conversation,
  Discovery,
  Meeting,
  Message,
  User,
} from "../models";
import { Notification } from "../models/notification";
import { Invite } from "../models/invite";
import { OTP } from "../models/otp";
import { RevokedSession } from "../models/revokedSession";
import { auth as firebaseAuth } from "../firebase/admin";
import { deleteAttachment } from "./attachmentStorage";

/** The only part of a conversation the decision looks at. */
export type ConversationShape = {
  id: string;
  participants: string[];
};

export type ConversationVerdict =
  /** Nobody is left who could read it, so it goes along with its messages. */
  | { id: string; action: "delete" }
  /** Someone else is still in it: they keep their half, the leaver comes out. */
  | { id: string; action: "detach"; remaining: string[] };

/**
 * Per conversation: remove it outright, or take the leaver out of it.
 *
 * A conversation goes only when nobody is left to read it. Deleting one that
 * another live person is still part of would be taking their history away to
 * tidy up after someone else, which is never the right trade — their own
 * messages stay exactly where they are.
 *
 * `liveUserIds` is who still exists *after* the account goes. Passing it in
 * rather than reading the database keeps this a decision, not a query, and
 * means the previously-orphaned case (everyone already gone) falls out of the
 * same rule rather than needing one of its own.
 */
export function planConversationCleanup(
  conversations: ConversationShape[],
  leavingUserId: string,
  liveUserIds: Set<string>
): ConversationVerdict[] {
  return conversations.map((conversation) => {
    const remaining = conversation.participants.filter(
      (p) => p !== leavingUserId && liveUserIds.has(p)
    );
    return remaining.length
      ? { id: conversation.id, action: "detach", remaining }
      : { id: conversation.id, action: "delete" };
  });
}

/** Everything one run removed, for the log and for the caller's reply. */
export type DeletionReport = {
  conversationsDeleted: number;
  conversationsDetached: number;
  messagesDeleted: number;
  attachmentsDeleted: number;
  connections: number;
  activityLogs: number;
  notifications: number;
  discoveries: number;
  invites: number;
  otps: number;
  revokedSessions: number;
  meetingsHosted: number;
  meetingsLeft: number;
  firebaseUserDeleted: boolean;
};

export const emptyReport = (): DeletionReport => ({
  conversationsDeleted: 0,
  conversationsDetached: 0,
  messagesDeleted: 0,
  attachmentsDeleted: 0,
  connections: 0,
  activityLogs: 0,
  notifications: 0,
  discoveries: 0,
  invites: 0,
  otps: 0,
  revokedSessions: 0,
  meetingsHosted: 0,
  meetingsLeft: 0,
  firebaseUserDeleted: false,
});

/**
 * Removes an account and everything that hangs off it.
 *
 * Ordered so a failure part-way through leaves the account unusable rather
 * than half-present: the files go first (nothing else points at them once the
 * rows are gone), the rows next, and the user record last. Running it twice is
 * harmless — every step is "delete what matches", and the second time nothing
 * does.
 */
export async function deleteAccount(userId: string): Promise<DeletionReport> {
  const report = emptyReport();

  const user = await User.findById(userId);
  if (!user) throw new Error("No such account");
  const firebaseUid = user.firebaseUid;

  // Who is left once this account goes. Read before anything is removed, so
  // the conversation rules see the same world the caller does.
  const liveUserIds = new Set(
    (await User.find({ _id: { $ne: user._id } }).select("_id")).map((u) => u._id.toString())
  );

  const conversations = await Conversation.find({ participants: user._id }).select("participants");
  const verdicts = planConversationCleanup(
    conversations.map((c) => ({
      id: c._id.toString(),
      participants: c.participants.map((p) => p.toString()),
    })),
    userId,
    liveUserIds
  );

  const doomedConversations = verdicts.filter((v) => v.action === "delete").map((v) => v.id);
  const detaching = verdicts.filter(
    (v): v is Extract<ConversationVerdict, { action: "detach" }> => v.action === "detach"
  );

  // Every message about to go: the ones in conversations nobody is left to
  // read, and this account's own messages in the ones that survive. What the
  // other person wrote is theirs and stays.
  const doomedMessages = await Message.find({
    $or: [{ conversationId: { $in: doomedConversations } }, { senderId: user._id }],
  }).select("_id attachment");

  // Files first. A row removed before its file would leave bytes in storage
  // with nothing left pointing at them to try again from.
  for (const message of doomedMessages) {
    const attachment = (message as { attachment?: any }).attachment;
    if (attachment?.provider && attachment?.storageId) {
      await deleteAttachment({
        provider: attachment.provider,
        storageId: attachment.storageId,
        resourceType: attachment.resourceType,
      });
      report.attachmentsDeleted++;
    }
  }

  report.messagesDeleted = (
    await Message.deleteMany({ _id: { $in: doomedMessages.map((m) => m._id) } })
  ).deletedCount;

  report.conversationsDeleted = (
    await Conversation.deleteMany({ _id: { $in: doomedConversations } })
  ).deletedCount;

  for (const verdict of detaching) {
    // The preview may quote a message that has just gone, so it is rebuilt
    // from whatever is actually left rather than pointed at a hole.
    const newest = await Message.findOne({ conversationId: verdict.id }).sort({ createdAt: -1 });
    await Conversation.updateOne(
      { _id: verdict.id },
      {
        $set: {
          participants: verdict.remaining,
          lastMessage: newest?._id ?? null,
        },
      }
    );
    report.conversationsDetached++;
  }

  report.connections = (await Connection.deleteMany({ participants: user._id })).deletedCount;
  report.activityLogs = (await ActivityLog.deleteMany({ userId: user._id })).deletedCount;
  report.notifications = (await Notification.deleteMany({ userId: user._id })).deletedCount;
  report.discoveries = (
    await Discovery.deleteMany({ $or: [{ viewerId: user._id }, { targetId: user._id }] })
  ).deletedCount;
  report.invites = (await Invite.deleteMany({ creatorId: user._id })).deletedCount;
  report.otps = (await OTP.deleteMany({ email: user.email })).deletedCount;
  report.revokedSessions = (await RevokedSession.deleteMany({ userId: user._id })).deletedCount;

  // A meeting this account ran goes with it; one it merely attended loses a
  // name from the list and keeps happening for everybody else.
  report.meetingsHosted = (await Meeting.deleteMany({ hostId: user._id })).deletedCount;
  report.meetingsLeft = (
    await Meeting.updateMany({ participants: user._id }, { $pull: { participants: user._id } })
  ).modifiedCount;

  await User.deleteOne({ _id: user._id });

  // Last, and allowed to fail: without this the address cannot be signed up
  // again, but a Firebase record with no account behind it grants nothing on
  // its own, and the rows above are already gone.
  if (firebaseAuth && firebaseUid) {
    try {
      await firebaseAuth.deleteUser(firebaseUid);
      report.firebaseUserDeleted = true;
    } catch (error) {
      logger.warn(`Account ${userId} removed, but its Firebase user was not:`, error);
    }
  }

  logger.info(`Account ${userId} deleted`, report);
  return report;
}

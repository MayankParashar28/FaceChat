import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * An invite code someone can redeem to reach the person who made it.
 *
 * Two kinds share this collection:
 *
 *   standard — the long-lived link on the profile page. Redeeming it forms a
 *   permanent connection, so both people keep each other afterwards.
 *
 *   ghost — a single-use link that opens one conversation and then erases it,
 *   messages and uploaded files included. It forms no connection: the link
 *   itself is the authorisation, and when the chat goes so does any trace that
 *   the two of them ever spoke.
 */
export interface IInvite extends Document {
  _id: Types.ObjectId;
  creatorId: Types.ObjectId;
  code: string;
  kind: "standard" | "ghost";
  maxUses: number;
  uses: number;
  /** How long the link may be redeemed for. */
  expiresAt: Date;
  /**
   * Ghost only: how long the chat lives once somebody opens it.
   *
   * Kept apart from `expiresAt` on purpose. One value cannot do both jobs —
   * a link redeemed nine minutes into a ten-minute window would leave a
   * one-minute chat, which is not what either person was promised.
   */
  chatLifetimeMs?: number;
  /** Ghost only: the conversation created when the link was redeemed. */
  conversationId?: Types.ObjectId;
  createdAt: Date;
}

const InviteSchema = new Schema<IInvite>(
  {
    creatorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    code: { type: String, required: true, unique: true },
    kind: { type: String, enum: ["standard", "ghost"], default: "standard" },
    maxUses: { type: Number, default: 1 },
    uses: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    chatLifetimeMs: { type: Number },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation" },
  },
  { timestamps: true }
);

// Auto-delete expired invites (optional, but good for cleanup)
InviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Invite = mongoose.model<IInvite>("Invite", InviteSchema);

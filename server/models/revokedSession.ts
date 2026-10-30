import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * Session tokens that have been signed out before their own expiry.
 *
 * The tokens are signed, not stored, so nothing about one can be changed after
 * it is issued — which means signing out could only ever clear the browser and
 * hope. The token itself stayed valid for its full thirty days, so a copy
 * taken from a shared machine kept working and there was no way to stop it.
 *
 * Each row names one token by its `jti`. The row lives exactly as long as the
 * token would have: once the token expires on its own, the entry is pointless,
 * and the TTL index clears it without a job. So this collection only ever
 * holds tokens that are both signed out AND still otherwise valid, which is a
 * small, self-limiting set.
 *
 * Revoking every session at once is a different mechanism — `tokenVersion` on
 * the user — because that must not need a row per outstanding token.
 */
export interface IRevokedSession extends Document {
  _id: Types.ObjectId;
  /** The token's unique id, from its payload. */
  jti: string;
  userId: Types.ObjectId;
  /** When the token would have expired anyway; the row goes at the same time. */
  expiresAt: Date;
  createdAt: Date;
}

const RevokedSessionSchema = new Schema<IRevokedSession>(
  {
    jti: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

RevokedSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RevokedSession = mongoose.model<IRevokedSession>(
  "RevokedSession",
  RevokedSessionSchema
);

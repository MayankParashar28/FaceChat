import mongoose, { Schema, Document, Types } from "mongoose";

export interface IInvite extends Document {
    _id: Types.ObjectId;
    creatorId: Types.ObjectId;
    code: string;
    maxUses: number;
    uses: number;
    expiresAt: Date;
    createdAt: Date;
}

const InviteSchema = new Schema<IInvite>(
    {
        creatorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        code: { type: String, required: true, unique: true },
        maxUses: { type: Number, default: 1 },
        uses: { type: Number, default: 0 },
        expiresAt: { type: Date, required: true },
    },
    { timestamps: true }
);

// Auto-delete expired invites (optional, but good for cleanup)
InviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Invite = mongoose.model<IInvite>("Invite", InviteSchema);

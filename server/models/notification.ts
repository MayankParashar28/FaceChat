import { Schema, Document, Types, model } from "mongoose";

export interface INotification extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    type: "match" | "missed_call" | "system";
    title: string;
    message: string;
    relatedId?: Types.ObjectId; // connectionId, meetingId, or whatever
    isRead: boolean;
    createdAt: Date;
}

const NotificationSchema = new Schema<INotification>(
    {
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        type: {
            type: String,
            enum: ["match", "missed_call", "system"],
            required: true,
        },
        title: { type: String, required: true },
        message: { type: String, required: true },
        relatedId: { type: Schema.Types.ObjectId },
        isRead: { type: Boolean, default: false },
    },
    { timestamps: true }
);

NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ isRead: 1 });

export const Notification = model<INotification>("Notification", NotificationSchema);

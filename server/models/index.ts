import mongoose, { Schema, Document, Types } from "mongoose";

/* =========================================================
 *  USER MODEL
 * ========================================================= */

export interface IUser extends Document {
  _id: Types.ObjectId;
  firebaseUid: string;
  email: string;
  password?: string; // Hashed password (optional if using only Firebase Auth)
  name: string;
  username: string;
  avatar?: string;
  phone?: string;
  bio?: string;
  dateOfBirth?: Date;
  location?: string;
  website?: string;
  isEmailVerified: boolean;
  isPhoneVerified?: boolean;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
  // Enhanced Fields
  professional?: {
    title?: string;
    company?: string;
    industry?: string;
    skills?: string[];
  };
  socials?: {
    linkedin?: string;
    twitter?: string;
    github?: string;
    instagram?: string;
    website?: string;
  };
  preferences?: {
    theme?: "light" | "dark" | "system";
    notifications?: {
      email?: boolean;
      push?: boolean;
      meetingReminders?: boolean;
    };
    privacy?: {
      showOnlineStatus?: boolean;
      allowPublicProfile?: boolean;
    };
    /**
     * Call preferences from the Settings page. Device ids are deliberately
     * absent: which camera or microphone to use is a property of the machine
     * you are sitting at, not of the account, so those stay in localStorage.
     */
    call?: {
      autoJoinAudio?: boolean;
      autoJoinVideo?: boolean;
      backgroundBlur?: boolean;
      emotionDetection?: boolean;
      videoQuality?: "sd" | "hd" | "full-hd";
      audioQuality?: "standard" | "high" | "studio";
    };
  };
  onboarding?: {
    hasCompleted?: boolean;
    completedStep?: number;
  };
}

const UserSchema = new Schema<IUser>(
  {
    firebaseUid: { type: String, required: true, unique: true },
    email: {
      type: String,
      required: true,
      unique: true,
      match: /.+@.+\..+/,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      select: false, // Don't return password in queries by default
      minlength: 8,
    },
    name: { type: String, required: true, trim: true },
    username: {
      type: String,
      required: true,
      unique: true,
      minlength: 3,
      maxlength: 30,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9_]+$/, // Only lowercase letters, numbers, and underscores
    },
    avatar: { type: String },
    phone: {
      type: String,
      trim: true,
      match: /^\+?[1-9]\d{1,14}$/, // E.164 format
    },
    bio: {
      type: String,
      maxlength: 500,
      trim: true,
    },
    dateOfBirth: {
      type: Date,
      validate: {
        validator: function (this: IUser, value: Date) {
          if (!value) return true;
          const age = Math.floor((Date.now() - value.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
          return age >= 13; // Minimum age 13
        },
        message: "You must be at least 13 years old to register.",
      },
    },
    location: {
      type: String,
      maxlength: 100,
      trim: true,
    },
    website: {
      type: String,
      maxlength: 200,
      trim: true,
      match: /^https?:\/\/.+/,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    isPhoneVerified: {
      type: Boolean,
      default: false,
    },
    lastLogin: {
      type: Date,
    },
    // Enhanced Fields
    professional: {
      title: { type: String, trim: true },
      company: { type: String, trim: true },
      industry: { type: String, trim: true },
      skills: [{ type: String, trim: true }],
    },
    socials: {
      linkedin: { type: String, trim: true },
      twitter: { type: String, trim: true },
      github: { type: String, trim: true },
      instagram: { type: String, trim: true },
      website: { type: String, trim: true },
    },
    preferences: {
      theme: { type: String, enum: ["light", "dark", "system"], default: "system" },
      notifications: {
        email: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
        meetingReminders: { type: Boolean, default: true },
      },
      privacy: {
        showOnlineStatus: { type: Boolean, default: true },
        allowPublicProfile: { type: Boolean, default: true },
      },
      call: {
        autoJoinAudio: { type: Boolean, default: false },
        autoJoinVideo: { type: Boolean, default: false },
        backgroundBlur: { type: Boolean, default: false },
        emotionDetection: { type: Boolean, default: true },
        videoQuality: { type: String, enum: ["sd", "hd", "full-hd"], default: "hd" },
        audioQuality: {
          type: String,
          enum: ["standard", "high", "studio"],
          default: "high",
        },
      },
    },
    onboarding: {
      hasCompleted: { type: Boolean, default: false },
      completedStep: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

/* =========================================================
 *  ACTIVITY LOG MODEL
 * ========================================================= */

export interface IActivityLog extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  action: string;
  metadata?: any;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
}

const ActivityLogSchema = new Schema<IActivityLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
    ipAddress: { type: String },
    userAgent: { type: String },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ActivityLogSchema.index({ userId: 1, timestamp: -1 });
ActivityLogSchema.index({ action: 1 });

/* =========================================================
 *  MEETING MODEL
 * ========================================================= */

export interface IMeeting extends Document {
  _id: Types.ObjectId;
  title: string;
  description?: string;
  hostId: Types.ObjectId;
  participants: Types.ObjectId[];
  startTime: Date;
  /**
   * When the call actually began, as opposed to the slot it was booked for.
   *
   * `startTime` is the scheduled time: a meeting booked for 10:00 and held at
   * 14:00 still carries 10:00, which is what the calendar should show. Every
   * duration is measured from `actualStartTime` instead — it is stamped the
   * first time the meeting goes "active" and left alone as further
   * participants join. Meetings that ended before this field existed do not
   * have it, so readers fall back to `startTime`.
   */
  actualStartTime?: Date;
  endTime?: Date;
  status: "scheduled" | "active" | "ended";
  roomId: string;
  meetingType: "video" | "audio" | "screen-share";
  settings: {
    allowScreenShare: boolean;
    allowChat: boolean;
    allowRecording: boolean;
    maxParticipants: number;
  };
  recordings?: {
    url: string;
    duration: number;
    createdAt: Date;
  }[];
  analytics?: {
    totalDuration: number;
    participantCount: number;
    engagementScore: number;
    reactions?: Map<string, number>;
    emotionData: {
      emotion: string;
      percentage: number;
      timestamp: Date;
      count?: number;
    }[];
  };
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MeetingSchema = new Schema<IMeeting>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    hostId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    participants: [{ type: Schema.Types.ObjectId, ref: "User" }],
    startTime: { type: Date, required: true },
    actualStartTime: { type: Date },
    endTime: {
      type: Date,
      validate: {
        validator: function (this: IMeeting, value: Date) {
          // Against the real start, not the scheduled one: a meeting booked
          // for 10:00 but held (and ended) at 09:30 is perfectly ordinary.
          return !value || value >= (this.actualStartTime ?? this.startTime);
        },
        message: "End time must be after start time.",
      },
    },
    status: {
      type: String,
      enum: ["scheduled", "active", "ended"],
      default: "scheduled",
    },
    roomId: { type: String, required: true, unique: true },
    meetingType: {
      type: String,
      enum: ["video", "audio", "screen-share"],
      default: "video",
    },
    settings: {
      allowScreenShare: { type: Boolean, default: true },
      allowChat: { type: Boolean, default: true },
      allowRecording: { type: Boolean, default: false },
      maxParticipants: { type: Number, default: 6, min: 2, max: 50 },
    },
    recordings: [
      {
        url: { type: String },
        duration: { type: Number },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    analytics: {
      totalDuration: { type: Number, default: 0 },
      participantCount: { type: Number, default: 0 },
      engagementScore: { type: Number, default: 0 },
      reactions: {
        type: Map,
        of: Number,
        default: {},
      },
      emotionData: [
        {
          emotion: { type: String },
          percentage: { type: Number },
          timestamp: { type: Date, default: Date.now },
          count: { type: Number, default: 1 },
        },
      ],
    },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/* ===== Indexes ===== */
MeetingSchema.index({ hostId: 1, startTime: -1 });
// MeetingSchema.index({ roomId: 1 }, { unique: true });
MeetingSchema.index({ status: 1 });
MeetingSchema.index({ startTime: 1 });
MeetingSchema.index({ isDeleted: 1 });

/* ===== Virtuals ===== */
MeetingSchema.virtual("participantDetails", {
  ref: "User",
  localField: "participants",
  foreignField: "_id",
});

/* =========================================================
 *  CHAT MESSAGE MODEL
 * ========================================================= */

export interface IChatMessage extends Document {
  _id: Types.ObjectId;
  meetingId?: Types.ObjectId;
  roomId?: string;
  senderId: Types.ObjectId;
  content: string;
  messageType: "text" | "image" | "file" | "system";
  timestamp: Date;
  isPinned: boolean;
  reactions: {
    userId: Types.ObjectId;
    emoji: string;
    timestamp: Date;
  }[];
  isDeleted: boolean;
}

const ChatMessageSchema = new Schema<IChatMessage>(
  {
    meetingId: { type: Schema.Types.ObjectId, ref: "Meeting", required: false },
    roomId: { type: String, required: false, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: String, required: true, trim: true },
    messageType: {
      type: String,
      enum: ["text", "image", "file", "system"],
      default: "text",
    },
    timestamp: { type: Date, default: Date.now },
    isPinned: { type: Boolean, default: false },
    reactions: [
      {
        userId: { type: Schema.Types.ObjectId, ref: "User" },
        emoji: { type: String },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/* ===== Indexes ===== */
ChatMessageSchema.index({ meetingId: 1, timestamp: -1 });
ChatMessageSchema.index({ senderId: 1 });
ChatMessageSchema.index({ content: "text" });
ChatMessageSchema.index({ isDeleted: 1 });

/* ===== Optional TTL for auto-deletion of old messages ===== */
// ChatMessageSchema.index({ timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }); // 30 days

/* =========================================================
 *  CONVERSATION MODEL
 * ========================================================= */

export interface IConversation extends Document {
  _id: Types.ObjectId;
  name?: string;
  isGroup: boolean;
  participants: Types.ObjectId[];
  lastMessage?: Types.ObjectId;
  createdBy: Types.ObjectId;
  isDeleted: boolean;
  /**
   * When each participant last cleared this conversation, keyed by their user
   * id. Messages at or before someone's mark are hidden from them and from
   * their unread count; everybody else still sees the whole history.
   *
   * Clearing used to run `Message.updateMany(..., { isDeleted: true })`, but
   * Message has no isDeleted path and the schema is strict, so the field was
   * dropped and nothing was written — the history reappeared on reload. Had it
   * worked it would have been worse, since it would have erased the
   * conversation for the other person too.
   */
  clearedAt?: Map<string, Date>;
  createdAt: Date;
  updatedAt: Date;
}

const ConversationSchema = new Schema<IConversation>(
  {
    name: { type: String, trim: true },
    isGroup: { type: Boolean, default: false },
    participants: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
    lastMessage: { type: Schema.Types.ObjectId, ref: "Message" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false },
    clearedAt: { type: Map, of: Date, default: undefined },
  },
  { timestamps: true }
);

ConversationSchema.index({ participants: 1 });
ConversationSchema.index({ createdBy: 1 });
ConversationSchema.index({ lastMessage: 1 });
ConversationSchema.index({ isDeleted: 1 });

/* =========================================================
 *  MESSAGE MODEL
 * ========================================================= */

export interface IMessageAttachment {
  /** Where the bytes live. Cloudinary when configured, GridFS otherwise. */
  provider: "cloudinary" | "gridfs";
  /** Cloudinary public id, or the GridFS file id as a string. */
  storageId: string;
  /** Cloudinary only: image | video | raw, needed to build a delivery URL. */
  resourceType?: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface IMessage extends Document {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  content: string;
  messageType: "text" | "image" | "file" | "system";
  attachment?: IMessageAttachment;
  isPinned: boolean;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema<IMessage>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: String, required: true, trim: true },
    messageType: {
      type: String,
      enum: ["text", "image", "file", "system"],
      default: "text",
    },
    // Present only on image/file messages. `content` carries the caption (or
    // the file name when there is none) so existing list previews still read.
    attachment: {
      type: new Schema<IMessageAttachment>(
        {
          provider: { type: String, enum: ["cloudinary", "gridfs"], required: true },
          storageId: { type: String, required: true },
          resourceType: { type: String, required: false },
          name: { type: String, required: true },
          size: { type: Number, required: true },
          mimeType: { type: String, required: true },
        },
        { _id: false }
      ),
      required: false,
    },
    isPinned: { type: Boolean, default: false },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index({ senderId: 1 });
MessageSchema.index({ isPinned: 1, createdAt: -1 });

/* =========================================================
 *  DISCOVERY MODEL (Mutual Search/Tinder-like)
 * ========================================================= */

export interface IDiscovery extends Document {
  _id: Types.ObjectId;
  viewerId: Types.ObjectId;
  targetId: Types.ObjectId;
  timestamp: Date;
}

const DiscoverySchema = new Schema<IDiscovery>(
  {
    viewerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    targetId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

DiscoverySchema.index({ viewerId: 1, targetId: 1 }, { unique: true });
DiscoverySchema.index({ targetId: 1 });

/* =========================================================
 *  CONNECTION MODEL (Mutual Match)
 * ========================================================= */

export interface IConnection extends Document {
  _id: Types.ObjectId;
  participants: Types.ObjectId[];
  status: "active" | "blocked";
  unlockedAt: Date;
}

const ConnectionSchema = new Schema<IConnection>(
  {
    participants: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
    status: {
      type: String,
      enum: ["active", "blocked"],
      default: "active",
    },
    unlockedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ConnectionSchema.index({ participants: 1 });

export const User = mongoose.model<IUser>("User", UserSchema);
export const Meeting = mongoose.model<IMeeting>("Meeting", MeetingSchema);
export const ChatMessage = mongoose.model<IChatMessage>("ChatMessage", ChatMessageSchema);
export const Conversation = mongoose.model<IConversation>("Conversation", ConversationSchema);
export const Message = mongoose.model<IMessage>("Message", MessageSchema);
export const ActivityLog = mongoose.model<IActivityLog>("ActivityLog", ActivityLogSchema);
export const Discovery = mongoose.model<IDiscovery>("Discovery", DiscoverySchema);
export const Connection = mongoose.model<IConnection>("Connection", ConnectionSchema);

// Export OTP model (for email verification)
export { OTP } from "./otp";
export type { IOTP } from "./otp";
export { Notification } from "./notification";
export type { INotification } from "./notification";
export { Invite } from "./invite";
export type { IInvite } from "./invite";

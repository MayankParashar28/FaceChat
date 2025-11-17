import mongoose, { Schema, Document, Types } from "mongoose";

/* =========================================================
 *  OTP MODEL for Email Verification
 * ========================================================= */

export interface IOTP extends Document {
  _id: Types.ObjectId;
  email: string;
  otp: string; // Hashed OTP
  purpose: "email_verification" | "password_reset" | "login";
  attempts: number;
  expiresAt: Date;
  verified: boolean;
  createdAt: Date;
}

const OTPSchema = new Schema<IOTP>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    otp: {
      type: String,
      required: true,
      select: false, // Don't return OTP in queries
    },
    purpose: {
      type: String,
      enum: ["email_verification", "password_reset", "login"],
      default: "email_verification",
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
      max: 5, // Maximum 5 attempts
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 }, // Auto-delete expired OTPs
    },
    verified: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Indexes
OTPSchema.index({ email: 1, purpose: 1, createdAt: -1 });
OTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OTP = mongoose.model<IOTP>("OTP", OTPSchema);


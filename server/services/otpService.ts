import { OTP, IOTP } from '../models/otp';
import { hashPassword, comparePassword } from '../utils/passwordHash';
import { User } from '../models';

/**
 * Generate a random 6-digit OTP
 */
export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Generate a random alphanumeric OTP (8 characters)
 */
export function generateAlphanumericOTP(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excludes confusing chars
  let otp = '';
  for (let i = 0; i < 8; i++) {
    otp += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return otp;
}

/**
 * Create and send OTP for email verification
 */
export async function createOTP(
  email: string,
  purpose: "email_verification" | "password_reset" | "login" = "email_verification"
): Promise<string> {
  try {
    // Generate OTP
    const otpCode = generateOTP();
    
    // Hash the OTP before storing
    const hashedOTP = await hashPassword(otpCode);
    
    // Delete any existing unverified OTPs for this email and purpose
    await OTP.deleteMany({
      email: email.toLowerCase().trim(),
      purpose,
      verified: false,
    });
    
    // Create new OTP (expires in 10 minutes)
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);
    
    const otp = new OTP({
      email: email.toLowerCase().trim(),
      otp: hashedOTP,
      purpose,
      expiresAt,
      verified: false,
      attempts: 0,
    });
    
    await otp.save();
    
    // Send OTP via email (for now, log it - implement email service later)
    console.log(`📧 OTP for ${email}: ${otpCode} (expires in 10 minutes)`);
    
    // TODO: Implement actual email sending service
    // await sendEmail(email, 'Email Verification', `Your verification code is: ${otpCode}`);
    
    return otpCode; // Return plain OTP for testing (remove in production)
  } catch (error) {
    console.error('Error creating OTP:', error);
    throw new Error('Failed to create verification code');
  }
}

/**
 * Verify OTP
 */
export async function verifyOTP(
  email: string,
  otpCode: string,
  purpose: "email_verification" | "password_reset" | "login" = "email_verification"
): Promise<boolean> {
  try {
    // Find the most recent unverified OTP for this email and purpose
    const otp = await OTP.findOne({
      email: email.toLowerCase().trim(),
      purpose,
      verified: false,
    })
      .sort({ createdAt: -1 })
      .select('+otp'); // Include hashed OTP in query
    
    if (!otp) {
      throw new Error('No verification code found or already verified');
    }
    
    // Check if OTP has expired
    if (new Date() > otp.expiresAt) {
      await OTP.deleteOne({ _id: otp._id });
      throw new Error('Verification code has expired. Please request a new one.');
    }
    
    // Check attempts
    if (otp.attempts >= 5) {
      await OTP.deleteOne({ _id: otp._id });
      throw new Error('Too many failed attempts. Please request a new verification code.');
    }
    
    // Verify OTP
    const isValid = await comparePassword(otpCode, otp.otp);
    
    if (!isValid) {
      // Increment attempts
      otp.attempts += 1;
      await otp.save();
      
      const remainingAttempts = 5 - otp.attempts;
      if (remainingAttempts > 0) {
        throw new Error(`Invalid verification code. ${remainingAttempts} attempts remaining.`);
      } else {
        throw new Error('Invalid verification code. Please request a new one.');
      }
    }
    
    // Mark as verified
    otp.verified = true;
    await otp.save();
    
    // If email verification, update user's emailVerified status
    if (purpose === 'email_verification') {
      await User.updateOne(
        { email: email.toLowerCase().trim() },
        { isEmailVerified: true }
      );
    }
    
    return true;
  } catch (error: any) {
    console.error('Error verifying OTP:', error);
    throw error;
  }
}

/**
 * Check if OTP exists and is valid (without verifying it)
 */
export async function checkOTPExists(
  email: string,
  purpose: "email_verification" | "password_reset" | "login" = "email_verification"
): Promise<boolean> {
  try {
    const otp = await OTP.findOne({
      email: email.toLowerCase().trim(),
      purpose,
      verified: false,
      expiresAt: { $gt: new Date() },
    });
    
    return !!otp;
  } catch (error) {
    return false;
  }
}

/**
 * Delete OTP (cleanup after verification or expiration)
 */
export async function deleteOTP(otpId: string): Promise<void> {
  try {
    await OTP.deleteOne({ _id: otpId });
  } catch (error) {
    console.error('Error deleting OTP:', error);
  }
}

/**
 * Clean up expired OTPs (should be run periodically)
 */
export async function cleanupExpiredOTPs(): Promise<number> {
  try {
    const result = await OTP.deleteMany({
      expiresAt: { $lt: new Date() },
    });
    return result.deletedCount || 0;
  } catch (error) {
    console.error('Error cleaning up expired OTPs:', error);
    return 0;
  }
}


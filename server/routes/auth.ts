import { logger } from "../utils/logger";
import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { authRateLimiter } from "../middleware/rateLimiter";
import { createOTP, verifyOTP } from "../services/otpService";
import { mongoService } from "../services/mongodb";
import { comparePassword, hashPassword } from "../utils/passwordHash";

const router = Router();

// DB Signup endpoint (creates user in MongoDB with hashed password, no confirmation email)
router.post("/signup", authRateLimiter, async (req, res) => {
    try {
        const { email, password, name, username } = req.body;

        if (!email || !password || !name || !username) {
            return res.status(400).json({ error: "Please fill in all fields (email, password, name, username)" });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const normalizedUsername = username.trim().toLowerCase();

        // Check if user already exists in DB by email or username
        const existingEmail = await mongoService.getUserByEmail(normalizedEmail);
        if (existingEmail) {
            return res.status(400).json({ error: "This email is already registered. Please log in." });
        }

        const existingUsername = await mongoService.getUserByUsername(normalizedUsername);
        if (existingUsername) {
            return res.status(400).json({ error: "Username is already taken. Please choose another one." });
        }

        // Generate unique firebaseUid for MongoDB lookup
        const firebaseUid = `user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        const user = await mongoService.createUser({
            firebaseUid,
            email: normalizedEmail,
            name: name.trim(),
            username: normalizedUsername,
            password,
            isEmailVerified: true,
        });

        res.json({
            success: true,
            user,
            firebaseUid: user.firebaseUid,
            email: user.email,
            name: user.name,
            username: user.username,
            avatar: user.avatar
        });
    } catch (error: any) {
        console.error("DB Signup error:", error);
        res.status(500).json({ error: error.message || "Signup failed" });
    }
});

// DB Login endpoint (validates email/username & password against MongoDB Atlas)
router.post("/login", authRateLimiter, async (req, res) => {
    try {
        const { email, username, password } = req.body;
        const identifier = (email || username || "").trim().toLowerCase();

        if (!identifier || !password) {
            return res.status(400).json({ error: "Please enter your email/username and password" });
        }

        // Search user in DB by email or username, with password included
        let user = await mongoService.getUserByEmail(identifier, true);
        if (!user) {
            user = await mongoService.getUserByUsername(identifier, true);
        }

        if (!user) {
            return res.status(404).json({ error: `No account found for "${identifier}". Please check your email/username or switch to Sign Up to create an account.` });
        }

        if (user.password) {
            const isMatch = await comparePassword(password, user.password);
            if (!isMatch) {
                return res.status(401).json({ error: "Incorrect password. Please double check your password and try again." });
            }
        } else {
            // First-time password set for legacy accounts without a password
            const hashedPassword = await hashPassword(password);
            user.password = hashedPassword;
            await user.save();
        }

        const userObj = user.toObject();
        delete userObj.password;

        res.json({
            success: true,
            user: userObj,
            firebaseUid: user.firebaseUid,
            email: user.email,
            name: user.name,
            username: user.username,
            avatar: user.avatar
        });
    } catch (error: any) {
        console.error("DB Login error:", error);
        res.status(500).json({ error: error.message || "Login failed" });
    }
});

// Direct Password Reset endpoint (updates password in MongoDB Atlas)
router.post("/reset-password", authRateLimiter, async (req, res) => {
    try {
        const { email, username, newPassword } = req.body;
        const identifier = (email || username || "").trim().toLowerCase();

        if (!identifier || !newPassword) {
            return res.status(400).json({ error: "Please enter your email/username and new password" });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ error: "New password must be at least 8 characters long" });
        }

        // Search user in DB by email or username
        let user = await mongoService.getUserByEmail(identifier, true);
        if (!user) {
            user = await mongoService.getUserByUsername(identifier, true);
        }

        if (!user) {
            return res.status(404).json({ error: `No account found for "${identifier}". Please check your details or click Sign Up.` });
        }

        const hashedPassword = await hashPassword(newPassword);
        user.password = hashedPassword;
        await user.save();

        res.json({
            success: true,
            message: "Password updated successfully! You can now log in with your new password.",
        });
    } catch (error: any) {
        console.error("Password reset error:", error);
        res.status(500).json({ error: error.message || "Failed to reset password" });
    }
});

// Send OTP for email verification
router.post("/send-otp", authRateLimiter, authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { email } = req.body;
    const userEmail = email || req.user.email;

    if (!userEmail) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Verify the email matches the authenticated user
    if (userEmail.toLowerCase() !== req.user.email?.toLowerCase()) {
      return res.status(403).json({ error: "Email does not match authenticated user" });
    }

    // Create and send OTP
    await createOTP(userEmail, "email_verification");

    res.json({
      success: true,
      message: "Verification code sent to your email",
      // In development, return the OTP in the response (remove in production)
      ...(process.env.NODE_ENV === "development" && {
        otp: "Check console for OTP (development only)",
      }),
    });
  } catch (error: any) {
    logger.error("Error sending OTP:", error);
    res.status(500).json({ error: error.message || "Failed to send verification code" });
  }
});

// Verify OTP
router.post("/verify-otp", authRateLimiter, authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: "Email and OTP are required" });
    }

    // Verify the email matches the authenticated user
    if (email.toLowerCase() !== req.user.email?.toLowerCase()) {
      return res.status(403).json({ error: "Email does not match authenticated user" });
    }

    // Verify OTP
    const verified = await verifyOTP(email, otp, "email_verification");

    if (verified) {
      res.json({
        verified: true,
        message: "Email verified successfully",
      });
    } else {
      res.status(400).json({ error: "Invalid verification code" });
    }
  } catch (error: any) {
    logger.error("Error verifying OTP:", error);
    res.status(400).json({ error: error.message || "Verification failed" });
  }
});

// Resend OTP
router.post("/resend-otp", authRateLimiter, authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { email } = req.body;
    const userEmail = email || req.user.email;

    if (!userEmail) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Verify the email matches the authenticated user
    if (userEmail.toLowerCase() !== req.user.email?.toLowerCase()) {
      return res.status(403).json({ error: "Email does not match authenticated user" });
    }

    // Create and send new OTP
    await createOTP(userEmail, "email_verification");

    res.json({
      success: true,
      message: "New verification code sent to your email",
      // In development, return the OTP in the response (remove in production)
      ...(process.env.NODE_ENV === "development" && {
        otp: "Check console for OTP (development only)",
      }),
    });
  } catch (error: any) {
    logger.error("Error resending OTP:", error);
    res.status(500).json({ error: error.message || "Failed to resend verification code" });
  }
});

// Phone verification via Twilio Verify - send code
/* router.post("/phone/send", authRateLimiter, authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!twilioClient || !twilioVerifyServiceSid) {
      return res.status(500).json({ error: "Phone verification is not configured on the server." });
    }

    const { phone } = req.body as { phone?: string };
    if (!phone || typeof phone !== "string") {
      return res.status(400).json({ error: "Phone number is required." });
    }

    // Basic E.164 validation (Twilio will also validate)
    const normalized = phone.replace(/[^\d+]/g, "");
    if (!/^\+\d{8,15}$/.test(normalized)) {
      return res.status(400).json({ error: "Invalid phone format. Use full international format like +14155552671." });
    }

    await twilioClient.verify.v2
      .services(twilioVerifyServiceSid)
      .verifications.create({ to: normalized, channel: "sms" });

    res.json({ success: true, message: "Verification code sent via SMS." });
  } catch (error: any) {
    logger.error("Error sending phone verification code:", error);
    res.status(500).json({ error: error.message || "Failed to send phone verification code." });
  }
}); */

// Phone verification via Twilio Verify - check code and mark user as verified
/* router.post("/phone/verify", authRateLimiter, authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!twilioClient || !twilioVerifyServiceSid) {
      return res.status(500).json({ error: "Phone verification is not configured on the server." });
    }

    const { phone, code } = req.body as { phone?: string; code?: string };
    if (!phone || typeof phone !== "string" || !code || typeof code !== "string") {
      return res.status(400).json({ error: "Phone number and verification code are required." });
    }

    const normalized = phone.replace(/[^\d+]/g, "");
    if (!/^\+\d{8,15}$/.test(normalized)) {
      return res.status(400).json({ error: "Invalid phone format. Use full international format like +14155552671." });
    }

    const check = await twilioClient.verify.v2
      .services(twilioVerifyServiceSid)
      .verificationChecks.create({ to: normalized, code });

    if (check.status !== "approved") {
      return res.status(400).json({ error: "Invalid or expired verification code." });
    }

    // Mark user's phone as verified in MongoDB
    const dbUser = req.user.dbUser || await mongoService.getUserByFirebaseUid(req.user.uid);
    if (!dbUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const updatedUser = await mongoService.updateUser(dbUser._id.toString(), {
      phone: normalized,
      isPhoneVerified: true,
    } as any);

    res.json({
      success: true,
      verified: true,
      phone: normalized,
      user: updatedUser ? {
        _id: updatedUser._id,
        phone: updatedUser.phone,
        isPhoneVerified: (updatedUser as any).isPhoneVerified,
      } : undefined,
    });
  } catch (error: any) {
    logger.error("Error verifying phone code:", error);
    res.status(500).json({ error: error.message || "Failed to verify phone number." });
  }
}); */

export default router;

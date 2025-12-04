import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { authRateLimiter } from "../middleware/rateLimiter";
import { createOTP, verifyOTP } from "../services/otpService";
import { mongoService } from "../services/mongodb";

// Import Twilio only if installed (runtime will fail if env/config missing)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
// import twilio from "twilio";

const router = Router();

// Twilio Verify client (for phone number verification)
// const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
// const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
// const twilioVerifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
// const twilioClient =
//   twilioAccountSid && twilioAuthToken
//     ? twilio(twilioAccountSid, twilioAuthToken)
//     : null;

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
                otp: "Check console for OTP (development only)"
            })
        });
    } catch (error: any) {
        console.error("Error sending OTP:", error);
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
                message: "Email verified successfully"
            });
        } else {
            res.status(400).json({ error: "Invalid verification code" });
        }
    } catch (error: any) {
        console.error("Error verifying OTP:", error);
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
                otp: "Check console for OTP (development only)"
            })
        });
    } catch (error: any) {
        console.error("Error resending OTP:", error);
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
    console.error("Error sending phone verification code:", error);
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
    console.error("Error verifying phone code:", error);
    res.status(500).json({ error: error.message || "Failed to verify phone number." });
  }
}); */

export default router;

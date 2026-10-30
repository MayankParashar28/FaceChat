import { logger } from "../utils/logger";
import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { authRateLimiter } from "../middleware/rateLimiter";
import { createOTP, verifyOTP } from "../services/otpService";
import { mongoService } from "../services/mongodb";
import { comparePassword } from "../utils/passwordHash";
import {
  issueSessionToken,
  looksLikeSessionToken,
  verifySessionToken,
} from "../services/sessionToken";
import { RevokedSession, User } from "../models";
import { deleteAccount } from "../services/accountDeletion";

const router = Router();

/**
 * A real bcrypt hash of a value nobody holds, compared against when there is
 * no stored password to compare with. It exists only to keep the work — and so
 * the response time — the same whether or not the account exists.
 */
const DUMMY_PASSWORD_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8DvKkXr3W8cPNaB1T7wCmnTDFPNC3y";

// DB Signup endpoint (creates user in MongoDB with hashed password, no confirmation email)
router.post("/signup", authRateLimiter, async (req, res) => {
  try {
    const { email, password, name, username } = req.body;

    if (!email || !password || !name || !username) {
      return res
        .status(400)
        .json({ error: "Please fill in all fields (email, password, name, username)" });
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
      return res
        .status(400)
        .json({ error: "Username is already taken. Please choose another one." });
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

    // The client sends this back as its bearer token. It used to send the
    // account's firebaseUid, which authenticated anyone who knew it.
    const sessionToken = await issueSessionToken({
      sub: user._id.toString(),
      uid: user.firebaseUid || user._id.toString(),
      ver: user.tokenVersion ?? 0,
    });

    res.json({
      success: true,
      user,
      sessionToken,
      firebaseUid: user.firebaseUid,
      email: user.email,
      name: user.name,
      username: user.username,
      avatar: user.avatar,
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

    // Both lookups, always, and in parallel.
    //
    // Sequentially with an early exit, a hit on the email cost one query and a
    // miss cost two — so a non-existent account answered measurably slower
    // than a real one, which gives away the same thing the messages used to.
    // Doing both every time removes the difference, and it is quicker for
    // anyone signing in with a username.
    const [byEmail, byUsername] = await Promise.all([
      mongoService.getUserByEmail(identifier, true),
      mongoService.getUserByUsername(identifier, true),
    ]);
    const user = byEmail || byUsername;

    // Every failure answers the same way.
    //
    // This used to distinguish them: a 404 naming the identifier when no
    // account existed, versus a 401 about the password when one did. That let
    // anyone test addresses and usernames against the service and learn which
    // were registered — the rate limiter slowed it down but did not stop it.
    // The passwordless cases gave existence away the same way.
    //
    // Nothing here tells the caller which of the four it was; the reason goes
    // to the log instead, so support can still see it.
    const refuse = (reason: string) => {
      logger.info(`Login refused for "${identifier}": ${reason}`);
      return res.status(401).json({ error: "Incorrect email/username or password." });
    };

    if (!user) {
      // Spend what a real comparison would. Skipping bcrypt here made a
      // missing account answer measurably faster than a wrong password, which
      // is the same leak by a different route.
      await comparePassword(password, DUMMY_PASSWORD_HASH);
      return refuse("no such account");
    }

    if (!user.password) {
      // No password on the account, so there is nothing to check against.
      //
      // This used to hash whatever had just been submitted, store it and sign
      // the caller in — described as a "first-time password set for legacy
      // accounts". It handed the account to whoever typed the email address
      // first, with a password of their choosing. Accounts created through
      // Firebase hold no password by design, so that covered most of them.
      await comparePassword(password, DUMMY_PASSWORD_HASH);
      return refuse(
        user.firebaseUid?.startsWith("user_")
          ? "account has no password set"
          : "account uses a social sign-in"
      );
    }

    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      return refuse("wrong password");
    }

    const userObj = user.toObject();
    delete userObj.password;

    const sessionToken = await issueSessionToken({
      sub: user._id.toString(),
      uid: user.firebaseUid || user._id.toString(),
      ver: user.tokenVersion ?? 0,
    });

    res.json({
      success: true,
      user: userObj,
      sessionToken,
      firebaseUid: user.firebaseUid,
      email: user.email,
      name: user.name,
      username: user.username,
      avatar: user.avatar,
    });
  } catch (error: any) {
    console.error("DB Login error:", error);
    res.status(500).json({ error: error.message || "Login failed" });
  }
});

// Direct Password Reset endpoint (updates password in MongoDB Atlas)
// Password reset is deliberately absent.
//
// This endpoint used to take an email (or username) plus a new password and
// set it — no token, no code, no proof the account was yours. Anyone who knew
// a username could take the account over, and usernames are searchable.
//
// A real reset needs a one-time link or code sent to the address on file, and
// this server has no mail provider wired up (see services/otpService, which
// only logs codes). Until one exists, the honest thing is to offer no reset at
// all rather than a form that hands accounts to whoever asks.

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

/** The bearer token on this request, whatever carried it. */
function presentedToken(req: { headers: any; body?: any; query?: any }): string | null {
  const header = req.headers?.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) return header.substring(7);
  if (typeof req.body?.firebaseToken === "string") return req.body.firebaseToken;
  if (typeof req.query?.firebaseToken === "string") return req.query.firebaseToken;
  return null;
}

/**
 * Sign out of this device.
 *
 * Clearing the browser was all that ever happened, which left the token itself
 * working for the rest of its thirty days — so a copy taken from a shared
 * machine kept full access and nothing could stop it. Naming the token here
 * is what actually ends the session.
 *
 * Deliberately forgiving: a token already expired, already revoked or simply
 * absent still answers 200, because a sign-out that reports failure leaves
 * people stuck on a screen they are trying to leave.
 */
router.post("/logout", async (req, res) => {
  try {
    const token = presentedToken(req);
    if (token && looksLikeSessionToken(token)) {
      const claims = await verifySessionToken(token);
      // A sign-out that follows an account deletion has nothing left to
      // revoke: the account is gone, so the token already resolves to nobody.
      // Writing the row anyway would leave this collection holding a reference
      // to a deleted user for the rest of the token's thirty days — the one
      // thing `deleteAccount` cannot clean up, because it is created after it
      // has run.
      const stillAnAccount = claims?.sub ? await User.exists({ _id: claims.sub }) : null;
      if (claims?.jti && stillAnAccount) {
        await RevokedSession.updateOne(
          { jti: claims.jti },
          {
            $setOnInsert: {
              jti: claims.jti,
              userId: claims.sub,
              // The row is pointless once the token would have expired, and
              // the TTL index drops it then.
              expiresAt: new Date(claims.exp),
            },
          },
          { upsert: true }
        );
        logger.info(`Session signed out for user ${claims.sub}`);
      }
    }
    res.json({ success: true });
  } catch (error: any) {
    logger.error("Logout error:", error);
    // Still a success as far as the caller is concerned: they are leaving.
    res.json({ success: true });
  }
});

/**
 * What the delete dialog has to ask for before it can ask anything.
 *
 * Whether an account has a password is not on the user record the client
 * holds — it cannot be, since the hash is `select: false` and never leaves the
 * server. Without this the dialog would have to either show a password field
 * to someone who signed in with Google and has no password to type, or guess
 * by attempting the deletion and reading the rejection. Neither is a thing to
 * do to a person on the way to closing their account.
 */
router.get("/account", authenticate, async (req, res) => {
  try {
    const sessionUser = req.user?.dbUser;
    if (!sessionUser) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const user = await User.findById(sessionUser._id).select("+password");
    if (!user) {
      return res.status(404).json({ error: "No such account" });
    }

    res.json({ requiresPassword: !!user.password });
  } catch (error: any) {
    logger.error("Account requirements error:", error);
    res.status(500).json({ error: "Could not read the account" });
  }
});

/**
 * Close an account for good, taking everything it touched with it.
 *
 * Two things have to be true before this runs: the word DELETE typed out, and
 * — for an account with a password — that password. A live session is not
 * enough on its own. Everything else here is recoverable by signing in again;
 * this one is not, so it asks for the thing only the account holder knows.
 *
 * What goes and what stays is `deleteAccount`'s decision, and the reply says
 * what it did rather than a bare success: someone closing an account is owed
 * the count of what left with it.
 */
router.delete("/account", authRateLimiter, authenticate, async (req, res) => {
  try {
    const sessionUser = req.user?.dbUser;
    if (!sessionUser) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { password, confirm } = req.body ?? {};
    if (confirm !== "DELETE") {
      return res.status(400).json({ error: "Type DELETE to confirm." });
    }

    // `password` is `select: false` on the schema, so it has to be asked for
    // by name. Without the `+password` this reads as "the account has no
    // password", the check below is skipped, and a session token alone is
    // enough to close somebody's account.
    const user = await User.findById(sessionUser._id).select("+password");
    if (!user) {
      return res.status(404).json({ error: "No such account" });
    }

    if (user.password) {
      if (typeof password !== "string" || !password) {
        // Spend what a real comparison would, so a missing password and a
        // wrong one take the same time to answer.
        await comparePassword("", DUMMY_PASSWORD_HASH);
        return res.status(400).json({ error: "Enter your password to confirm." });
      }
      if (!(await comparePassword(password, user.password))) {
        return res.status(401).json({ error: "That password is not right." });
      }
    }

    const removed = await deleteAccount(user._id.toString());
    res.json({ success: true, removed });
  } catch (error: any) {
    logger.error("Account deletion error:", error);
    res.status(500).json({ error: "Could not delete the account" });
  }
});

/**
 * Sign out everywhere — every token this account has issued, at once.
 *
 * Bumping the account's version does it without a row per outstanding token,
 * which is what makes this usable after a lost device or a password change.
 */
router.post("/logout-all", authenticate, async (req, res) => {
  try {
    const dbUser = req.user?.dbUser;
    if (!dbUser) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const updated = await User.findByIdAndUpdate(
      dbUser._id,
      { $inc: { tokenVersion: 1 } },
      { new: true }
    );
    logger.info(`All sessions revoked for user ${dbUser._id}`);

    res.json({ success: true, tokenVersion: updated?.tokenVersion ?? 0 });
  } catch (error: any) {
    logger.error("Logout-all error:", error);
    res.status(500).json({ error: "Could not sign out everywhere" });
  }
});

export default router;

import { logger } from "../utils/logger";
import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getDatabase, type Database } from "firebase-admin/database";

// Firebase Admin SDK configuration
interface FirebaseConfig {
  projectId?: string;
  privateKey?: string;
  clientEmail?: string;
  databaseURL?: string;
}

let firebaseConfig: FirebaseConfig = {};

// Try to parse FIREBASE_SERVICE_ACCOUNT first (Render deployment)
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    firebaseConfig = {
      projectId: serviceAccount.project_id,
      privateKey: serviceAccount.private_key,
      clientEmail: serviceAccount.client_email,
      databaseURL:
        process.env.FIREBASE_DATABASE_URL || `https://${serviceAccount.project_id}.firebaseio.com`,
    };
    logger.info("✅ Parsed FIREBASE_SERVICE_ACCOUNT environment variable");
  } catch (error) {
    logger.error("❌ Failed to parse FIREBASE_SERVICE_ACCOUNT:", error);
  }
}

// Fallback to individual environment variables if parsing failed or keys are missing
if (!firebaseConfig.projectId || !firebaseConfig.privateKey || !firebaseConfig.clientEmail) {
  firebaseConfig = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  };
}

// Initialize Firebase Admin SDK
let app: App | null = null;
if (getApps().length === 0) {
  try {
    // Check if all required environment variables are present
    if (firebaseConfig.projectId && firebaseConfig.privateKey && firebaseConfig.clientEmail) {
      app = initializeApp({
        credential: cert({
          projectId: firebaseConfig.projectId,
          privateKey: firebaseConfig.privateKey,
          clientEmail: firebaseConfig.clientEmail,
        }),
        databaseURL: firebaseConfig.databaseURL,
      });
      logger.info("✅ Firebase Admin SDK initialized");
    } else {
      logger.info("⚠️  Firebase credentials not found - Firebase features will be disabled");
      logger.info("💡 Make sure to set Firebase environment variables in .env");
    }
  } catch (error) {
    logger.error("❌ Firebase Admin SDK initialization failed:", error);
    logger.info("💡 Make sure to set Firebase environment variables in .env");
  }
} else {
  app = getApps()[0];
}

// Export Firebase services with null checks
export const auth: Auth | null = app ? getAuth(app) : null;
export const database: Database | null = app ? getDatabase(app) : null;

// Verify Firebase ID token
export async function verifyFirebaseToken(idToken: string) {
  if (!auth) {
    throw new Error("Firebase Admin SDK not initialized. Please check your environment variables.");
  }
  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    return {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name,
      emailVerified: decodedToken.email_verified,
    };
  } catch (error) {
    // A credential that does not verify is not a server error. This logged the
    // whole FirebaseAuthError with its stack at ERROR level, so every rejected
    // token — now including every probe at the door — produced ~20 lines of
    // log. Keep the reason, drop the stack.
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(`Firebase token verification failed: ${reason}`);
    throw new Error("Invalid Firebase token");
  }
}

// Set user online status in Firebase Realtime Database
export async function setUserOnlineStatus(userId: string, isOnline: boolean) {
  if (!database) {
    logger.info("⚠️  Firebase Database not available - skipping online status update");
    return false;
  }
  try {
    const userStatusRef = database.ref(`users/${userId}/status`);
    await userStatusRef.set({
      online: isOnline,
      lastSeen: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    logger.error("Failed to set user online status:", error);
    return false;
  }
}

// Get user online status
export async function getUserOnlineStatus(userId: string) {
  if (!database) {
    return null;
  }
  try {
    const userStatusRef = database.ref(`users/${userId}/status`);
    const snapshot = await userStatusRef.once("value");
    return snapshot.val();
  } catch (error) {
    logger.error("Failed to get user online status:", error);
    return null;
  }
}

// Listen to user online status changes
export function listenToUserStatus(userId: string, callback: (status: any) => void) {
  if (!database) {
    return () => {};
  }
  const userStatusRef = database.ref(`users/${userId}/status`);
  userStatusRef.on("value", (snapshot) => {
    callback(snapshot.val());
  });

  // Return unsubscribe function
  return () => userStatusRef.off("value");
}

// Listen to all users online status
export function listenToAllUsersStatus(callback: (users: any) => void) {
  if (!database) {
    return () => {};
  }
  const usersRef = database.ref("users");
  usersRef.on("value", (snapshot) => {
    callback(snapshot.val());
  });

  // Return unsubscribe function
  return () => usersRef.off("value");
}

export default app;

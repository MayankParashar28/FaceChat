import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getDatabase, connectDatabaseEmulator } from "firebase/database";

// Firebase client configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
};

// Configure Firebase Auth action code settings for email verification redirects
// This tells Firebase where to redirect after email verification
if (typeof window !== "undefined") {
  // Get the current origin for redirect URL
  const redirectUrl = `${window.location.origin}/verify-email`;
  // Note: In Firebase Console, set the action URL to use this redirect
  // Authentication > Templates > Email address verification > Customize action URL
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const database = getDatabase(app);

// Connect to emulators in development
if (
  import.meta.env.MODE === "development" &&
  import.meta.env.VITE_USE_FIREBASE_EMULATOR === "true"
) {
  try {
    connectAuthEmulator(auth, "http://localhost:9099");
    connectDatabaseEmulator(database, "localhost", 9000);
    console.log("Connected to Firebase emulators");
  } catch (error) {
    console.log("Firebase emulators not available, using production");
  }
}

export default app;

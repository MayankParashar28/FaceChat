import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";
import { getDatabase, connectDatabaseEmulator, type Database } from "firebase/database";

const rawApiKey = import.meta.env.VITE_FIREBASE_API_KEY;
export const isFirebaseConfigured =
  typeof rawApiKey === "string" && rawApiKey.trim().length > 0 && !rawApiKey.startsWith("YOUR_");

// Fallback configuration prevents getAuth() and getDatabase() from throwing
// fatal uncaught exceptions on startup when client Firebase credentials are not set.
const firebaseConfig = {
  apiKey: isFirebaseConfigured ? rawApiKey : "AIzaSyDummyFallbackKeyForFaceCallAI000",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "facecall-ai.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "facecall-ai",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "facecall-ai.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "100000000000",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:100000000000:web:abcdef1234567890",
  databaseURL:
    import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://facecall-ai-default-rtdb.firebaseio.com",
};

let app: FirebaseApp;
let auth: Auth;
let database: Database;

try {
  app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
  auth = getAuth(app);
  database = getDatabase(app);
} catch (error) {
  console.warn("Firebase initialization warning (using safe fallback):", error);
  const fallbackConfig = {
    apiKey: "AIzaSyDummyFallbackKeyForFaceCallAI000",
    authDomain: "facecall-ai.firebaseapp.com",
    projectId: "facecall-ai",
    storageBucket: "facecall-ai.appspot.com",
    messagingSenderId: "100000000000",
    appId: "1:100000000000:web:abcdef1234567890",
    databaseURL: "https://facecall-ai-default-rtdb.firebaseio.com",
  };
  app = getApps().length > 0 ? getApps()[0] : initializeApp(fallbackConfig);
  auth = getAuth(app);
  database = getDatabase(app);
}

// Connect to emulators in development if requested
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

export { app, auth, database };
export default app;

import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getDatabase, connectDatabaseEmulator } from 'firebase/database';

// Firebase client configuration
const firebaseConfig = {
    apiKey: "AIzaSyDEzuVkg67fpEvbxRdVGkB6MGLdS0qfkv4",
    authDomain: "facechat-125ca.firebaseapp.com",
    projectId: "facechat-125ca",
    storageBucket: "facechat-125ca.firebasestorage.app",
    messagingSenderId: "508443525051",
    appId: "1:508443525051:web:4ed142e765da7c12bfce9e",
    measurementId: "G-9WKRZBRP6T"
  };
  

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const database = getDatabase(app);

// Connect to emulators in development
if (
    import.meta.env.MODE === 'development' &&
    import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true'
  ) {
    try {
      connectAuthEmulator(auth, 'http://localhost:9099');
      connectDatabaseEmulator(database, 'localhost', 9000);
      console.log('Connected to Firebase emulators');
    } catch (error) {
      console.log('Firebase emulators not available, using production');
    }
  }

export default app;

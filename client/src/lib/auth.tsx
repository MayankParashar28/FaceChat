import { useState, useEffect, createContext, useContext } from "react";
import {
  signOut,
  onAuthStateChanged,
  User,
  sendEmailVerification as firebaseSendEmailVerification,
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithPopup,
  linkWithPopup,
} from "firebase/auth";
import { getDatabase, ref, onValue } from "firebase/database";
import { auth } from "./firebase";
import { getAvatarUrl } from "./utils";
import {
  SESSION_TOKEN_KEY,
  STORED_USER_KEY,
  readSessionToken,
  setAuthError,
} from "./sessionCredential";

// User interface
export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  username?: string | null;
  emailVerified?: boolean;
  isEmailVerified?: boolean; // MongoDB field
}

// Auth context interface
interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string, username: string) => Promise<void>;
  sendEmailVerification: () => Promise<void>;
  resendEmailVerification: () => Promise<void>;
  logout: () => Promise<void>;
  checkUsername: (username: string) => Promise<{ available: boolean; message: string }>;
  getUsernameSuggestions: (baseUsername: string) => Promise<string[]>;
  signInWithGoogle: () => Promise<void>;
  signInWithGithub: () => Promise<void>;
  linkGoogleAccount: () => Promise<void>;
  linkGithubAccount: () => Promise<void>;
}

/**
 * The cached profile, but only when the credential that authenticates it is
 * still present.
 *
 * The profile used to be the credential: the client sent its `uid` as the
 * bearer token and the server looked a user up by it. Now that an id is no
 * longer accepted as a credential, a profile on its own proves nothing, and
 * restoring it produced a signed-in-looking app whose every request went out
 * with no Authorization header at all — so the server answered 401 and the
 * dashboard and chat list rendered empty, which reads as an account with no
 * meetings and no conversations rather than as a sign-in that needs redoing.
 *
 * Sessions stored before tokens existed have no token, so they are cleared
 * here and the person signs in once more.
 */
function readStoredSession(): AppUser | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(STORED_USER_KEY);
    if (!saved) return null;
    if (!readSessionToken()) {
      localStorage.removeItem(STORED_USER_KEY);
      return null;
    }
    return JSON.parse(saved) as AppUser;
  } catch {
    return null;
  }
}

// Create singleton auth context to prevent HMR duplication
const g = typeof window !== "undefined" ? (window as any) : (globalThis as any);
export const AuthContext: React.Context<AuthContextType | undefined> =
  g.__FACECHAT_AUTH_CONTEXT__ ||
  (g.__FACECHAT_AUTH_CONTEXT__ = createContext<AuthContextType | undefined>(undefined));

// Auth provider component
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore an email/password session, if it still has its token.
    const stored = readStoredSession();
    if (stored) {
      setUser(stored);
      setLoading(false);
    }

    // Set up token refresh listener
    const tokenRefreshInterval = setInterval(
      async () => {
        const currentUser = auth.currentUser;
        if (currentUser) {
          try {
            await currentUser.getIdToken(true);
          } catch (error) {
            console.error("Token refresh failed:", error);
          }
        }
      },
      50 * 60 * 1000
    );

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: User | null) => {
      if (firebaseUser) {
        const derivedUsername =
          firebaseUser.email?.split("@")[0] ||
          firebaseUser.displayName?.replace(/\s+/g, "").toLowerCase() ||
          null;
        const derivedDisplayName =
          firebaseUser.displayName?.trim() ||
          firebaseUser.email?.split("@")[0] ||
          (derivedUsername ? derivedUsername : "Guest");
        const avatar = getAvatarUrl(firebaseUser.photoURL, firebaseUser.uid);

        const appUser: AppUser = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: derivedDisplayName,
          photoURL: avatar,
          username: derivedUsername,
          emailVerified: firebaseUser.emailVerified,
        };
        setUser(appUser);

        try {
          await updateOnlineStatus(firebaseUser.uid, true);
        } catch (e) {}

        try {
          const token = await firebaseUser.getIdToken();
          const response = await fetch("/api/users", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              email: firebaseUser.email,
              name: derivedDisplayName,
              username: derivedUsername || "user",
              isEmailVerified: firebaseUser.emailVerified,
            }),
          });

          // Read once: a body cannot be consumed twice.
          const syncBody = await response.json().catch(() => null as any);

          if (response.ok) {
            const dbUser = syncBody;
            setUser((prev) => {
              if (!prev) return prev;
              const nextDisplayName =
                (dbUser?.name && String(dbUser.name).trim()) || prev.displayName;
              const nextUsername =
                (dbUser?.username && String(dbUser.username).trim()) || prev.username;
              const nextPhoto = getAvatarUrl(dbUser?.avatar ?? prev.photoURL, prev.uid);

              return {
                ...prev,
                displayName: nextDisplayName,
                username: nextUsername,
                photoURL: nextPhoto,
                isEmailVerified: firebaseUser.emailVerified || dbUser?.isEmailVerified || false,
                emailVerified: firebaseUser.emailVerified,
              };
            });
          } else if (response.status === 409 && syncBody?.code === "EMAIL_ALREADY_REGISTERED") {
            // This uid will never have a record here: another account already
            // holds the address. Staying signed in would mean every request
            // resolving no user and answering with an empty list, so the app
            // would look like an account with nothing in it rather than a
            // sign-in that did not work. Say what happened instead.
            setAuthError(
              syncBody?.error ||
                "An account already exists for this email address under a different sign-in method."
            );
            setUser(null);
            await signOut(auth);
          } else {
            // Transient — network trouble, or a fault on our side. Someone who
            // already has a record keeps working, so do not sign them out.
            console.warn(`User sync failed with ${response.status}`);
          }
        } catch (error: any) {
          console.warn("User sync error:", error);
        }
      } else {
        // No Firebase user. An email/password session may still be live; a
        // profile without its token is not one.
        setUser(readStoredSession());
      }
      setLoading(false);
    });

    return () => {
      unsubscribe();
      clearInterval(tokenRefreshInterval);
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Login failed" }));
        throw new Error(errorData.error || "Invalid email or password.");
      }

      const userData = await response.json();
      const appUser: AppUser = {
        uid: userData.firebaseUid || `user_${userData._id}`,
        email: userData.email,
        displayName: userData.name || userData.username,
        photoURL: getAvatarUrl(userData.avatar, userData.firebaseUid),
        username: userData.username,
        emailVerified: true,
        isEmailVerified: true,
      };

      if (userData.sessionToken) {
        localStorage.setItem(SESSION_TOKEN_KEY, userData.sessionToken);
      }
      localStorage.setItem(STORED_USER_KEY, JSON.stringify(appUser));
      setUser(appUser);
    } catch (error: any) {
      console.warn("DB Login Error:", error);
      throw error;
    }
  };

  const signUp = async (email: string, password: string, name: string, username: string) => {
    try {
      if (!email || !password || !name || !username) {
        throw new Error("Please fill in all fields");
      }

      if (username.length < 3) {
        throw new Error("Username must be at least 3 characters");
      }

      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name, username }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Signup failed" }));
        throw new Error(errorData.error || "Signup failed.");
      }

      const userData = await response.json();
      const appUser: AppUser = {
        uid: userData.firebaseUid || `user_${userData._id}`,
        email: userData.email,
        displayName: userData.name || userData.username,
        photoURL: getAvatarUrl(userData.avatar, userData.firebaseUid),
        username: userData.username,
        emailVerified: true,
        isEmailVerified: true,
      };

      if (userData.sessionToken) {
        localStorage.setItem(SESSION_TOKEN_KEY, userData.sessionToken);
      }
      localStorage.setItem(STORED_USER_KEY, JSON.stringify(appUser));
      setUser(appUser);
    } catch (error: any) {
      console.warn("DB Signup Error:", error);
      throw error;
    }
  };

  const checkUsername = async (
    username: string
  ): Promise<{ available: boolean; message: string }> => {
    try {
      // Public endpoint — no auth needed (used on the signup form pre-login).
      const response = await fetch(`/api/users/check-username/${encodeURIComponent(username)}`);
      if (!response.ok) {
        throw new Error("Failed to check username");
      }
      return await response.json();
    } catch (error) {
      console.error("Error checking username:", error);
      throw error;
    }
  };

  const sendEmailVerification = async (): Promise<void> => {
    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error("User not authenticated");
      }

      if (user.emailVerified) {
        throw new Error("Email is already verified");
      }

      await firebaseSendEmailVerification(user);
      console.log("📧 Verification email sent! Check your inbox and click the verification link.");
    } catch (error: any) {
      console.error("Error sending verification email:", error);
      if (error.code === "auth/too-many-requests") {
        throw new Error(
          "Too many requests. Please wait a few minutes before requesting another verification email."
        );
      }
      throw new Error(error.message || "Failed to send verification email");
    }
  };

  const resendEmailVerification = async (): Promise<void> => {
    return sendEmailVerification();
  };

  const getUsernameSuggestions = async (baseUsername: string): Promise<string[]> => {
    try {
      // Public endpoint — no auth needed (used on the signup form pre-login).
      const response = await fetch(`/api/users/suggestions/${encodeURIComponent(baseUsername)}`);
      if (!response.ok) {
        throw new Error("Failed to get suggestions");
      }
      const data = await response.json();
      return data.suggestions;
    } catch (error) {
      console.error("Error getting username suggestions:", error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      // Tell the server first, while the token is still in hand. Clearing
      // storage on its own only hides the credential — the token stays valid
      // for the rest of its thirty days, so a copy of it keeps working.
      const sessionToken = readSessionToken();
      if (sessionToken) {
        try {
          await fetch("/api/auth/logout", {
            method: "POST",
            headers: { Authorization: `Bearer ${sessionToken}` },
          });
        } catch {
          // Offline, or the server is down. Sign out locally anyway; the
          // token still expires on its own.
        }
      }

      localStorage.removeItem(STORED_USER_KEY);
      localStorage.removeItem(SESSION_TOKEN_KEY);
      if (user) {
        try {
          await updateOnlineStatus(user.uid, false);
        } catch (e) {}
      }
      setUser(null);
      await signOut(auth);
    } catch (error) {
      console.log("Logout executed:", error);
      setUser(null);
    }
  };

  const signInWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Google sign in error:", error);

      if (error?.code === "auth/account-exists-with-different-credential") {
        throw new Error(
          "An account with this email already exists using a different login method. Please sign in with your existing method first."
        );
      }

      throw new Error(error.message || "Google sign in failed");
    }
  };

  const signInWithGithub = async () => {
    try {
      const provider = new GithubAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Github sign in error:", error);
      if (error?.code === "auth/account-exists-with-different-credential") {
        throw new Error(
          "An account with this email already exists using a different login method. Please sign in with your existing method first."
        );
      }
      throw new Error(error.message || "Github sign in failed");
    }
  };

  const linkGoogleAccount = async () => {
    const current = auth.currentUser;
    if (!current) {
      throw new Error("You must be signed in to link a Google account.");
    }

    try {
      const provider = new GoogleAuthProvider();
      await linkWithPopup(current, provider);
    } catch (error: any) {
      console.error("Link Google account error:", error);

      if (error?.code === "auth/credential-already-in-use") {
        throw new Error("This Google account is already linked to another user.");
      }
      if (error?.code === "auth/provider-already-linked") {
        throw new Error("Google is already linked to your account.");
      }
      if (error?.code === "auth/popup-closed-by-user") {
        throw new Error("Google linking was cancelled.");
      }

      throw new Error(error.message || "Failed to link Google account.");
    }
  };

  const linkGithubAccount = async () => {
    const current = auth.currentUser;
    if (!current) {
      throw new Error("You must be signed in to link a GitHub account.");
    }

    try {
      const provider = new GithubAuthProvider();
      await linkWithPopup(current, provider);
    } catch (error: any) {
      console.error("Link GitHub account error:", error);

      if (error?.code === "auth/credential-already-in-use") {
        throw new Error("This GitHub account is already linked to another user.");
      }
      if (error?.code === "auth/provider-already-linked") {
        throw new Error("GitHub is already linked to your account.");
      }
      if (error?.code === "auth/popup-closed-by-user") {
        throw new Error("GitHub linking was cancelled.");
      }

      throw new Error(error.message || "Failed to link GitHub account.");
    }
  };

  const value = {
    user,
    loading,
    signIn,
    signUp,
    sendEmailVerification,
    resendEmailVerification,
    logout,
    checkUsername,
    getUsernameSuggestions,
    signInWithGoogle,
    signInWithGithub,
    linkGoogleAccount,
    linkGithubAccount,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Hook to use auth context
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    if (typeof window !== "undefined") {
      const user = readStoredSession();
      return {
        user,
        loading: false,
        signIn: async () => {},
        signUp: async () => {},
        sendEmailVerification: async () => {},
        resendEmailVerification: async () => {},
        logout: async () => {},
        checkUsername: async () => ({ available: true, message: "" }),
        getUsernameSuggestions: async () => [],
        signInWithGoogle: async () => {},
        signInWithGithub: async () => {},
        linkGoogleAccount: async () => {},
        linkGithubAccount: async () => {},
      } as AuthContextType;
    }
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

// Update online status in Firebase Realtime Database
async function updateOnlineStatus(userId: string, isOnline: boolean) {
  try {
    const { getDatabase, ref, set, serverTimestamp } = await import("firebase/database");
    const database = getDatabase();
    const userStatusRef = ref(database, `users/${userId}/status`);

    await set(userStatusRef, {
      online: isOnline,
      lastSeen: serverTimestamp(),
    });
  } catch (error) {
    console.error("Failed to update online status:", error);
  }
}

// Listen to user online status
export function useOnlineStatus(userId: string) {
  const [isOnline, setIsOnline] = useState(false);
  const [lastSeen, setLastSeen] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;

    const database = getDatabase();
    const userStatusRef = ref(database, `users/${userId}/status`);

    const unsubscribe = onValue(userStatusRef, (snapshot: any) => {
      const data = snapshot.val();
      if (data) {
        setIsOnline(data.online || false);
        setLastSeen(data.lastSeen);
      }
    });

    return () => unsubscribe();
  }, [userId]);

  return { isOnline, lastSeen };
}

// Listen to all users online status
export function useAllUsersStatus() {
  const [users, setUsers] = useState<Record<string, any>>({});

  useEffect(() => {
    const database = getDatabase();
    const usersRef = ref(database, "users");

    const unsubscribe = onValue(usersRef, (snapshot: any) => {
      setUsers(snapshot.val() || {});
    });

    return () => unsubscribe();
  }, []);

  return users;
}

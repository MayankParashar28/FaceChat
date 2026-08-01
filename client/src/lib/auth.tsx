import { useState, useEffect, createContext, useContext } from 'react'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
  updateProfile,
  sendEmailVerification as firebaseSendEmailVerification,
  applyActionCode,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithPopup,
  linkWithPopup,
} from 'firebase/auth'
import { auth } from './firebase'
import { getAvatarUrl } from './utils'

// User interface
export interface AppUser {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  username?: string | null
  emailVerified?: boolean
  isEmailVerified?: boolean // MongoDB field
}

// Auth context interface
interface AuthContextType {
  user: AppUser | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, name: string, username: string) => Promise<void>
  sendEmailVerification: () => Promise<void>
  resendEmailVerification: () => Promise<void>
  logout: () => Promise<void>
  checkUsername: (username: string) => Promise<{ available: boolean; message: string }>
  getUsernameSuggestions: (baseUsername: string) => Promise<string[]>
  resetPassword: (email: string, newPassword?: string) => Promise<any>
  signInWithGoogle: () => Promise<void>
  signInWithGithub: () => Promise<void>
  linkGoogleAccount: () => Promise<void>
  linkGithubAccount: () => Promise<void>
}

// Create singleton auth context to prevent HMR duplication
const g = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
export const AuthContext: React.Context<AuthContextType | undefined> = g.__FACECHAT_AUTH_CONTEXT__ || (g.__FACECHAT_AUTH_CONTEXT__ = createContext<AuthContextType | undefined>(undefined));

// Auth provider component
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check for saved local mock user on mount
    const savedMock = localStorage.getItem('facechat_mock_user')
    if (savedMock) {
      try {
        const parsed = JSON.parse(savedMock)
        setUser(parsed)
        setLoading(false)
      } catch (e) {}
    }

    // Set up token refresh listener
    const tokenRefreshInterval = setInterval(async () => {
      const currentUser = auth.currentUser;
      if (currentUser) {
        try {
          await currentUser.getIdToken(true);
        } catch (error) {
          console.error("Token refresh failed:", error);
        }
      }
    }, 50 * 60 * 1000);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: User | null) => {
      if (firebaseUser) {
        const derivedUsername =
          firebaseUser.email?.split('@')[0] || firebaseUser.displayName?.replace(/\s+/g, '').toLowerCase() || null
        const derivedDisplayName =
          firebaseUser.displayName?.trim() ||
          firebaseUser.email?.split('@')[0] ||
          (derivedUsername ? derivedUsername : 'Guest')
        const avatar = getAvatarUrl(firebaseUser.photoURL, firebaseUser.uid, firebaseUser.email)

        const appUser: AppUser = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: derivedDisplayName,
          photoURL: avatar,
          username: derivedUsername,
          emailVerified: firebaseUser.emailVerified,
        }
        setUser(appUser)

        try {
          await updateOnlineStatus(firebaseUser.uid, true)
        } catch (e) {}

        try {
          const token = await firebaseUser.getIdToken()
          const response = await fetch('/api/users', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              email: firebaseUser.email,
              name: derivedDisplayName,
              username: derivedUsername || 'user',
              isEmailVerified: firebaseUser.emailVerified,
            }),
          })

          if (response.ok) {
            const dbUser = await response.json()
            setUser((prev) => {
              if (!prev) return prev
              const nextDisplayName = (dbUser?.name && String(dbUser.name).trim()) || prev.displayName
              const nextUsername = (dbUser?.username && String(dbUser.username).trim()) || prev.username
              const nextPhoto = getAvatarUrl(dbUser?.avatar ?? prev.photoURL, prev.uid, prev.email)

              return {
                ...prev,
                displayName: nextDisplayName,
                username: nextUsername,
                photoURL: nextPhoto,
                isEmailVerified: firebaseUser.emailVerified || dbUser?.isEmailVerified || false,
                emailVerified: firebaseUser.emailVerified,
              }
            })
          }
        } catch (error: any) {
          console.log('User sync error:', error)
        }
      } else {
        const localMock = localStorage.getItem('facechat_mock_user')
        if (localMock) {
          try {
            setUser(JSON.parse(localMock))
          } catch (e) {
            setUser(null)
          }
        } else {
          setUser(null)
        }
      }
      setLoading(false)
    })

    return () => {
      unsubscribe();
      clearInterval(tokenRefreshInterval);
    };
  }, [])

  const signIn = async (email: string, password: string) => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Login failed' }))
        throw new Error(errorData.error || 'Invalid email or password.')
      }

      const userData = await response.json()
      const appUser: AppUser = {
        uid: userData.firebaseUid || `user_${userData._id}`,
        email: userData.email,
        displayName: userData.name || userData.username,
        photoURL: getAvatarUrl(userData.avatar, userData.firebaseUid, userData.email),
        username: userData.username,
        emailVerified: true,
        isEmailVerified: true,
      }

      localStorage.setItem('facechat_mock_user', JSON.stringify(appUser))
      setUser(appUser)
    } catch (error: any) {
      console.warn('DB Login Error:', error)
      throw error
    }
  }

  const signUp = async (
    email: string,
    password: string,
    name: string,
    username: string
  ) => {
    try {
      if (!email || !password || !name || !username) {
        throw new Error('Please fill in all fields')
      }

      if (username.length < 3) {
        throw new Error('Username must be at least 3 characters')
      }

      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, username }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Signup failed' }))
        throw new Error(errorData.error || 'Signup failed.')
      }

      const userData = await response.json()
      const appUser: AppUser = {
        uid: userData.firebaseUid || `user_${userData._id}`,
        email: userData.email,
        displayName: userData.name || userData.username,
        photoURL: getAvatarUrl(userData.avatar, userData.firebaseUid, userData.email),
        username: userData.username,
        emailVerified: true,
        isEmailVerified: true,
      }

      localStorage.setItem('facechat_mock_user', JSON.stringify(appUser))
      setUser(appUser)
    } catch (error: any) {
      console.warn('DB Signup Error:', error)
      throw error
    }
  }

  const checkUsername = async (username: string): Promise<{ available: boolean; message: string }> => {
    try {
      const user = auth.currentUser
      if (!user) {
        throw new Error('User not authenticated')
      }

      const token = await user.getIdToken()
      const response = await fetch(`/api/users/check-username/${encodeURIComponent(username)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: "include",
      })
      if (!response.ok) {
        throw new Error('Failed to check username')
      }
      return await response.json()
    } catch (error) {
      console.error('Error checking username:', error)
      throw error
    }
  }

  const sendEmailVerification = async (): Promise<void> => {
    try {
      const user = auth.currentUser
      if (!user) {
        throw new Error('User not authenticated')
      }

      if (user.emailVerified) {
        throw new Error('Email is already verified')
      }

      await firebaseSendEmailVerification(user)
      console.log('📧 Verification email sent! Check your inbox and click the verification link.')
    } catch (error: any) {
      console.error('Error sending verification email:', error)
      if (error.code === 'auth/too-many-requests') {
        throw new Error('Too many requests. Please wait a few minutes before requesting another verification email.')
      }
      throw new Error(error.message || 'Failed to send verification email')
    }
  }

  const resendEmailVerification = async (): Promise<void> => {
    return sendEmailVerification()
  }

  const getUsernameSuggestions = async (baseUsername: string): Promise<string[]> => {
    try {
      const user = auth.currentUser
      if (!user) {
        throw new Error('User not authenticated')
      }

      const token = await user.getIdToken()
      const response = await fetch(`/api/users/suggestions/${encodeURIComponent(baseUsername)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: "include",
      })
      if (!response.ok) {
        throw new Error('Failed to get suggestions')
      }
      const data = await response.json()
      return data.suggestions
    } catch (error) {
      console.error('Error getting username suggestions:', error)
      throw error
    }
  }

  const resetPassword = async (email: string, newPassword?: string) => {
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, newPassword: newPassword || 'Password123!' }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }
      return data;
    } catch (error: any) {
      console.error("Reset password error:", error);
      throw error;
    }
  }

  const logout = async () => {
    try {
      localStorage.removeItem('facechat_mock_user')
      if (user) {
        try {
          await updateOnlineStatus(user.uid, false)
        } catch (e) {}
      }
      setUser(null)
      await signOut(auth)
    } catch (error) {
      console.log('Logout executed:', error)
      setUser(null)
    }
  }

  const signInWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error('Google sign in error:', error);

      if (error?.code === 'auth/account-exists-with-different-credential') {
        throw new Error(
          'An account with this email already exists using a different login method. Please sign in with your existing method first.'
        );
      }

      throw new Error(error.message || 'Google sign in failed');
    }
  };

  const signInWithGithub = async () => {
    try {
      const provider = new GithubAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error('Github sign in error:', error);
      if (error?.code === 'auth/account-exists-with-different-credential') {
        throw new Error(
          'An account with this email already exists using a different login method. Please sign in with your existing method first.'
        );
      }
      throw new Error(error.message || 'Github sign in failed');
    }
  };

  const linkGoogleAccount = async () => {
    const current = auth.currentUser
    if (!current) {
      throw new Error('You must be signed in to link a Google account.')
    }

    try {
      const provider = new GoogleAuthProvider()
      await linkWithPopup(current, provider)
    } catch (error: any) {
      console.error('Link Google account error:', error)

      if (error?.code === 'auth/credential-already-in-use') {
        throw new Error('This Google account is already linked to another user.')
      }
      if (error?.code === 'auth/provider-already-linked') {
        throw new Error('Google is already linked to your account.')
      }
      if (error?.code === 'auth/popup-closed-by-user') {
        throw new Error('Google linking was cancelled.')
      }

      throw new Error(error.message || 'Failed to link Google account.')
    }
  }

  const linkGithubAccount = async () => {
    const current = auth.currentUser
    if (!current) {
      throw new Error('You must be signed in to link a GitHub account.')
    }

    try {
      const provider = new GithubAuthProvider()
      await linkWithPopup(current, provider)
    } catch (error: any) {
      console.error('Link GitHub account error:', error)

      if (error?.code === 'auth/credential-already-in-use') {
        throw new Error('This GitHub account is already linked to another user.')
      }
      if (error?.code === 'auth/provider-already-linked') {
        throw new Error('GitHub is already linked to your account.')
      }
      if (error?.code === 'auth/popup-closed-by-user') {
        throw new Error('GitHub linking was cancelled.')
      }

      throw new Error(error.message || 'Failed to link GitHub account.')
    }
  }

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
    resetPassword,
    signInWithGoogle,
    signInWithGithub,
    linkGoogleAccount,
    linkGithubAccount,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// Hook to use auth context
export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    if (typeof window !== 'undefined') {
      const savedMock = localStorage.getItem('facechat_mock_user')
      let user: AppUser | null = null
      if (savedMock) {
        try {
          user = JSON.parse(savedMock)
        } catch (e) {}
      }
      return {
        user,
        loading: false,
        signIn: async () => {},
        signUp: async () => {},
        sendEmailVerification: async () => {},
        resendEmailVerification: async () => {},
        logout: async () => {},
        checkUsername: async () => ({ available: true, message: '' }),
        getUsernameSuggestions: async () => [],
        resetPassword: async () => {},
        signInWithGoogle: async () => {},
        signInWithGithub: async () => {},
        linkGoogleAccount: async () => {},
        linkGithubAccount: async () => {},
      } as AuthContextType
    }
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// Update online status in Firebase Realtime Database
async function updateOnlineStatus(userId: string, isOnline: boolean) {
  try {
    const { getDatabase, ref, set, serverTimestamp } = await import('firebase/database');
    const database = getDatabase();
    const userStatusRef = ref(database, `users/${userId}/status`);

    await set(userStatusRef, {
      online: isOnline,
      lastSeen: serverTimestamp(),
    });
  } catch (error) {
    console.error('Failed to update online status:', error);
  }
}

// Listen to user online status
export function useOnlineStatus(userId: string) {
  const [isOnline, setIsOnline] = useState(false);
  const [lastSeen, setLastSeen] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;

    const { getDatabase, ref, onValue } = require('firebase/database');
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
    const { getDatabase, ref, onValue } = require('firebase/database');
    const database = getDatabase();
    const usersRef = ref(database, 'users');

    const unsubscribe = onValue(usersRef, (snapshot: any) => {
      setUsers(snapshot.val() || {});
    });

    return () => unsubscribe();
  }, []);

  return users;
}

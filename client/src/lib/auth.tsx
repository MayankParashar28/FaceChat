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
}

// Create auth context
const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Auth provider component
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Set up token refresh listener
    const tokenRefreshInterval = setInterval(async () => {
      const currentUser = auth.currentUser;
      if (currentUser) {
        try {
          // Force token refresh before it expires (refresh every 50 minutes)
          await currentUser.getIdToken(true);
        } catch (error) {
          console.error("Token refresh failed:", error);
        }
      }
    }, 50 * 60 * 1000); // 50 minutes

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: User | null) => {
      if (firebaseUser) {
        // Reload user to get latest emailVerified status
        await firebaseUser.reload()
        
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

        // Update online status in Firebase Realtime Database
        await updateOnlineStatus(firebaseUser.uid, true)

        // Ensure user exists in MongoDB and sync emailVerified status
        // Only sync if we don't have user data yet or if emailVerified status changed
        try {
          const token = await firebaseUser.getIdToken()
          
          // Always sync on initial load, but skip if we already have the user and nothing changed
          // We'll let the server handle idempotent updates
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
            
            // Prefer server-provided profile information
            setUser((prev) => {
              if (!prev) return prev
              const nextDisplayName =
                (dbUser?.name && String(dbUser.name).trim()) || prev.displayName
              const nextUsername =
                (dbUser?.username && String(dbUser.username).trim()) || prev.username
              const nextPhoto = getAvatarUrl(dbUser?.avatar ?? prev.photoURL, prev.uid, prev.email)

              return {
                ...prev,
                displayName: nextDisplayName,
                username: nextUsername,
                photoURL: nextPhoto,
                // Use Firebase emailVerified as source of truth, sync with MongoDB
                isEmailVerified: firebaseUser.emailVerified || dbUser?.isEmailVerified || false,
                emailVerified: firebaseUser.emailVerified,
              }
            })
          } else if (response.status === 429) {
            // Rate limited - don't log as error, just skip this sync
            console.log('Rate limited on user sync, will retry later')
            // Update state without API call to avoid blocking UI
            setUser((prev) => {
              if (!prev) return prev
              return {
                ...prev,
                isEmailVerified: firebaseUser.emailVerified || prev.isEmailVerified || false,
                emailVerified: firebaseUser.emailVerified,
              }
            })
          } else if (response.status !== 400) {
            console.error('Failed to sync user to MongoDB')
          }
        } catch (error: any) {
          // Don't log rate limit errors as errors
          if (error.message?.includes('429') || error.message?.includes('Too many')) {
            console.log('Rate limited on user sync, will retry later')
          } else {
            console.error('Error syncing user to MongoDB:', error)
          }
        }
      } else {
        setUser(null)
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
      await signInWithEmailAndPassword(auth, email, password)
    } catch (error: any) {
      console.error('Sign in error:', error)

      // Provide user-friendly error messages
      if (error.code === 'auth/user-not-found') {
        throw new Error('No account found with this email. Please sign up first.')
      } else if (error.code === 'auth/wrong-password') {
        throw new Error('Incorrect password. Please try again.')
      } else if (error.code === 'auth/invalid-email') {
        throw new Error('Invalid email address. Please check and try again.')
      } else if (error.code === 'auth/invalid-credential') {
        throw new Error('Invalid email or password. Please try again.')
      } else if (error.message) {
        throw new Error(error.message)
      } else {
        throw new Error('Login failed. Please try again.')
      }
    }
  }

  const signUp = async (
    email: string, 
    password: string, 
    name: string, 
    username: string
  ) => {
    try {
      // Validate inputs
      if (!email || !password || !name || !username) {
        throw new Error('Please fill in all fields')
      }

      if (username.length < 3) {
        throw new Error('Username must be at least 3 characters')
      }

      // Create Firebase user
      const { user } = await createUserWithEmailAndPassword(auth, email, password)
      await updateProfile(user, { displayName: name })

      // Create user in MongoDB with password
      try {
        const token = await user.getIdToken()
        console.log('Sending user data to MongoDB:', { email, name, username, hasPassword: !!password })

        const response = await fetch('/api/users', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            email: user.email,
            name: name.trim(),
            username: username.trim(),
            password: password, // Send password to be hashed and stored in MongoDB
          }),
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
          console.error('Failed to create user in MongoDB:', errorData)
          throw new Error(`Failed to complete signup: ${errorData.error || 'Unknown error'}`)
        }

        const createdUser = await response.json()
        console.log('User successfully created in MongoDB:', createdUser)
        
        // Send Firebase email verification
        try {
          await firebaseSendEmailVerification(user)
          console.log('📧 Verification email sent! Check your inbox and click the verification link.')
        } catch (verificationError: any) {
          console.error('Failed to send verification email:', verificationError)
          // Don't throw - user is created, they can resend email later
        }
      } catch (error: any) {
        console.error('Error creating user in MongoDB:', error)
        // Don't throw - user is already created in Firebase
        // Just log the error
        if (error.message.includes('already exists') || error.message.includes('duplicate')) {
          // User exists, this is okay
          console.log('User already exists in MongoDB')
        } else {
          throw error // Re-throw if it's not a duplicate error
        }
      }
    } catch (error: any) {
      console.error('Sign up error:', error)

      // Provide user-friendly error messages
      if (error.code === 'auth/email-already-in-use') {
        throw new Error('This email is already registered. Please use a different email or login.')
      } else if (error.code === 'auth/weak-password') {
        throw new Error('Password is too weak. Please use at least 6 characters.')
      } else if (error.code === 'auth/invalid-email') {
        throw new Error('Invalid email address. Please check and try again.')
      } else if (error.message) {
        throw new Error(error.message)
      } else {
        throw new Error('Signup failed. Please try again.')
      }
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

  const logout = async () => {
    try {
      if (user) {
        await updateOnlineStatus(user.uid, false)
      }
      await signOut(auth)
    } catch (error) {
      console.error('Logout error:', error)
      throw error
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
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// Hook to use auth context
export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
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

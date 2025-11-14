import { useState, useEffect, createContext, useContext } from 'react'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
  updateProfile,
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
}

// Auth context interface
interface AuthContextType {
  user: AppUser | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, name: string, username: string) => Promise<void>
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
        }
        setUser(appUser)

        // Update online status in Firebase Realtime Database
        await updateOnlineStatus(firebaseUser.uid, true)

        // Ensure user exists in MongoDB
        try {
          const token = await firebaseUser.getIdToken()
          const response = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              firebaseToken: token,
              email: firebaseUser.email,
              name: derivedDisplayName,
              username: derivedUsername || 'user',
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
              }
            })
          } else if (response.status !== 400) {
            console.error('Failed to sync user to MongoDB')
          }
        } catch (error) {
          console.error('Error syncing user to MongoDB:', error)
        }
      } else {
        setUser(null)
      }
      setLoading(false)
    })

    return () => unsubscribe()
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

  const signUp = async (email: string, password: string, name: string, username: string) => {
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

      // Create user in MongoDB
      try {
        const token = await user.getIdToken()
        console.log('Sending user data to MongoDB:', { email, name, username })

        const response = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firebaseToken: token,
            email: user.email,
            name: name.trim(),
            username: username.trim(),
          }),
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
          console.error('Failed to create user in MongoDB:', errorData)
          throw new Error(`Failed to complete signup: ${errorData.error || 'Unknown error'}`)
        }

        const createdUser = await response.json()
        console.log('User successfully created in MongoDB:', createdUser)
      } catch (error: any) {
        console.error('Error creating user in MongoDB:', error)
        // Don't throw - user is already created in Firebase
        // Just log the error
        if (error.message.includes('already exists') || error.message.includes('duplicate')) {
          // User exists, this is okay
          console.log('User already exists in MongoDB')
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
      const response = await fetch(`/api/users/check-username/${encodeURIComponent(username)}`)
      if (!response.ok) {
        throw new Error('Failed to check username')
      }
      return await response.json()
    } catch (error) {
      console.error('Error checking username:', error)
      throw error
    }
  }

  const getUsernameSuggestions = async (baseUsername: string): Promise<string[]> => {
    try {
      const response = await fetch(`/api/users/suggestions/${encodeURIComponent(baseUsername)}`)
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

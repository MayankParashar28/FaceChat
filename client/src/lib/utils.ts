import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { auth } from "./firebase"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getInitials(name?: string | null, email?: string | null) {
  const source = (name ?? "").trim() || (email ?? "").split("@")[0] || ""
  if (!source) return "U"

  const parts = source.split(/\s+/).filter(Boolean)

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }

  const first = parts[0][0]
  const last = parts[parts.length - 1][0]
  return `${first}${last}`.toUpperCase()
}

export function getAvatarUrl(photoURL?: string | null, uid?: string, email?: string | null) {
  if (photoURL && photoURL.trim().length > 0) {
    return photoURL
  }

  const seed = uid || email || "user"
  return `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(seed)}`
}

// Search users by username via API
export async function searchUsers(query: string, limit: number = 10) {
  const params = new URLSearchParams({ q: query, limit: String(limit) })

  // Get auth token
  const headers: Record<string, string> = {};
  if (auth.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken();
      headers.Authorization = `Bearer ${token}`;
    } catch (error) {
      console.error("Failed to get auth token:", error);
    }
  }

  if (!headers.Authorization && typeof window !== "undefined") {
    const rawMock = localStorage.getItem("facechat_mock_user");
    if (rawMock) {
      try {
        const parsed = JSON.parse(rawMock);
        if (parsed?.uid) {
          headers.Authorization = `Bearer ${parsed.uid}`;
        }
      } catch (e) {}
    }
  }

  const res = await fetch(`/api/users/search?${params.toString()}`, {
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || "Failed to search users")
  }
  return res.json() as Promise<
    Array<{ id: string; name: string; username: string; email: string; avatar?: string }>
  >
}

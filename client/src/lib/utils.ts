import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { auth } from "./firebase";
import { readSessionToken } from "./sessionCredential";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getInitials(name?: string | null, email?: string | null) {
  const source = (name ?? "").trim() || (email ?? "").split("@")[0] || "";
  if (!source) return "U";

  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  const first = parts[0][0];
  const last = parts[parts.length - 1][0];
  return `${first}${last}`.toUpperCase();
}

/**
 * The picture to show for someone, falling back to a generated one.
 *
 * The fallback is now this server's own `/api/avatars` endpoint. It used to be
 * `https://api.dicebear.com/...`, which meant rendering a conversation list
 * told a third party, from the viewer's own IP, the username of everyone in
 * it. Same generator, same faces — see `server/services/avatar.ts`, which this
 * path has to agree with. (It is written out twice rather than imported: the
 * `@shared` alias in tsconfig has no counterpart in the Vite config, so the
 * client cannot import across that boundary.)
 *
 * `seed` takes an id, never an email. The old signature accepted one as a last
 * resort, which put a live email address in a URL — and so in access logs —
 * for a picture that does not need it. A signed-in user always has a uid, so
 * the fallback never actually earned its keep.
 */
export function getAvatarUrl(photoURL?: string | null, seed?: string | null) {
  if (photoURL && photoURL.trim().length > 0) {
    return photoURL;
  }

  const safe = (seed || "user").slice(0, 64);
  return `/api/avatars/${encodeURIComponent(safe)}.svg`;
}

// Search users by username via API
export async function searchUsers(query: string, limit: number = 10) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });

  // A Firebase ID token, or the session token issued at login — the same
  // credential every other request uses.
  //
  // What stood here fell back to the cached profile's `uid` as the bearer
  // token, the last place in the client that treated an id as a password.
  // The server no longer accepts one, so this was also simply broken: user
  // search came back 401 for every email/password session.
  const headers: Record<string, string> = {};
  let token: string | null = null;
  if (auth.currentUser) {
    try {
      token = await auth.currentUser.getIdToken();
    } catch (error) {
      console.error("Failed to get auth token:", error);
    }
  }
  token = token || readSessionToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`/api/users/search?${params.toString()}`, {
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to search users");
  }
  return res.json() as Promise<
    Array<{ id: string; name: string; username: string; avatar?: string }>
  >;
}

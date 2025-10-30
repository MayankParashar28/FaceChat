import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Search users by username via API
export async function searchUsers(query: string, limit: number = 10) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`/api/users/search?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to search users');
  }
  return res.json() as Promise<Array<{ id: string; name: string; username: string; email: string; avatar?: string }>>;
}

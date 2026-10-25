import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAuthToken } from "@/lib/queryClient";

export type Notification = {
  _id: string;
  type: "match" | "missed_call" | "system";
  title: string;
  message: string;
  relatedId?: string;
  isRead: boolean;
  createdAt: string;
};

export const NOTIFICATIONS_KEY = ["notifications"] as const;

/**
 * The one notifications query.
 *
 * The page and the sidebar badge both read this list, and both used to declare
 * their own `useQuery` against the key "notifications" with a different
 * queryFn: the page threw on a failed request, while the sidebar swallowed it
 * and returned an empty list. Two fetchers on one cache key means whichever
 * observer happens to trigger a refetch decides how errors behave, so the same
 * failure either surfaced or silently emptied the badge depending on which
 * page you were on. The sidebar also rolled its own token lookup instead of
 * using getAuthToken.
 */
export function useNotifications(enabled: boolean) {
  return useQuery<Notification[]>({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: async () => {
      const token = await getAuthToken();
      if (!token) return [];
      const res = await fetch("/api/notifications", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Could not load notifications (${res.status})`);
      return res.json();
    },
    enabled,
    refetchInterval: 10000, // Poll every 10s
  });
}

export function useRefreshNotifications() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
}

export function countUnread(notifications: Notification[]): number {
  return notifications.filter((n) => !n.isRead).length;
}

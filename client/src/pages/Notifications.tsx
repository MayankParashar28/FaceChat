import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Bell, Heart, PhoneMissed, Check, Trash2, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { getAuthToken } from "@/lib/queryClient";

type Notification = {
  _id: string;
  type: "match" | "missed_call" | "system";
  title: string;
  message: string;
  relatedId?: string;
  isRead: boolean;
  createdAt: string;
};

export default function Notifications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ["notifications"],
    queryFn: async () => {
      const token = await getAuthToken();
      if (!token) return [];
      const res = await fetch("/api/notifications", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!user,
    refetchInterval: 10000, // Poll every 10s
  });

  // A fetch that resolves is not a fetch that succeeded: these all ignored the
  // response, so a 403 or 500 still ran onSuccess and the UI claimed the action
  // had worked until the next refetch put the row back.
  const notificationRequest = async (path: string, method: "PUT" | "DELETE") => {
    const token = await getAuthToken();
    const res = await fetch(`/api/notifications${path}`, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return res.json().catch(() => ({}));
  };

  const showError = (error: Error) =>
    toast({ variant: "destructive", title: "Something went wrong", description: error.message });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationRequest(`/${id}/read`, "PUT"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
    onError: showError,
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationRequest(`/read-all`, "PUT"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
    onError: showError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => notificationRequest(`/${id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast({ title: "Notification removed" });
    },
    onError: showError,
  });

  const handleAction = (notif: Notification) => {
    // Mark as read first
    if (!notif.isRead) markReadMutation.mutate(notif._id);

    if (notif.type === "match") {
      // Go to chat? Or profile?
      // Ideally go to chat with this connection.
      // We don't have connectionId -> conversationId mapping direct here easily without lookup.
      // But usually we can just go to /chats
      setLocation("/chats");
    }
    // For missed call, maybe go to chats too or callback?
    if (notif.type === "missed_call") {
      setLocation("/chats");
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "match":
        return <Heart className="h-5 w-5 text-pink-500" fill="currentColor" />;
      case "missed_call":
        return <PhoneMissed className="h-5 w-5 text-red-500" />;
      default:
        return <Bell className="h-5 w-5 text-primary" />;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground">Manage your alerts and new matches.</p>
        </div>
        {notifications.length > 0 && (
          <Button
            variant="outline"
            className="self-start shrink-0 sm:self-auto"
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
          >
            <Check className="mr-2 h-4 w-4" />
            Mark all as read
          </Button>
        )}
      </div>

      <div className="grid gap-4">
        {notifications.length === 0 ? (
          <Card className="bg-muted/10 border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Bell className="h-12 w-12 mb-4 opacity-20" />
              <p>No notifications yet</p>
            </CardContent>
          </Card>
        ) : (
          notifications.map((notif) => (
            <div
              key={notif._id}
              className={`relative group flex items-start gap-4 p-4 rounded-xl border transition-all ${
                notif.isRead
                  ? "bg-background/50 border-transparent hover:bg-muted/10"
                  : "bg-primary/5 border-primary/10 shadow-sm"
              }`}
            >
              <div
                className={`mt-1 h-10 w-10 shrink-0 rounded-full flex items-center justify-center ${notif.isRead ? "bg-muted/20" : "bg-background shadow-inner"}`}
              >
                {getIcon(notif.type)}
              </div>

              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleAction(notif)}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h3
                    className={`font-semibold text-sm ${notif.isRead ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    {notif.title}
                  </h3>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(notif.createdAt), "MMM d, h:mm a")}
                  </span>
                </div>
                <p
                  className={`text-sm ${notif.isRead ? "text-muted-foreground/80" : "text-foreground/90"}`}
                >
                  {notif.message}
                </p>
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 transition-opacity -mr-2 text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteMutation.mutate(notif._id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>

              {!notif.isRead && (
                <div className="absolute top-4 right-4 h-2 w-2 rounded-full bg-primary" />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

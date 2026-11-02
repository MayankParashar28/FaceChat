import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Bell, Heart, PhoneMissed, Check, Trash2, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { getAuthToken } from "@/lib/queryClient";
import {
  countUnread,
  useNotifications,
  useRefreshNotifications,
  type Notification,
} from "@/hooks/useNotifications";

export default function Notifications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const refreshNotifications = useRefreshNotifications();
  const [, setLocation] = useLocation();
  const [pendingDelete, setPendingDelete] = useState<Notification | null>(null);
  // The notification whose destination is being looked up, if any.
  const [resolving, setResolving] = useState<string | null>(null);

  const { data: notifications = [], isLoading } = useNotifications(!!user);
  const unreadCount = countUnread(notifications);

  // A fetch that resolves is not a fetch that succeeded: these all ignored the
  // response, so a 403 or 500 still ran onSuccess and the UI claimed the action
  // had worked until the next refetch put the row back.
  const notificationRequest = async (path: string, method: "GET" | "PUT" | "DELETE") => {
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
    onSuccess: () => refreshNotifications(),
    onError: showError,
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationRequest(`/read-all`, "PUT"),
    onSuccess: () => refreshNotifications(),
    onError: showError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => notificationRequest(`/${id}`, "DELETE"),
    onSuccess: () => {
      refreshNotifications();
      toast({ title: "Notification removed" });
    },
    onError: showError,
  });

  /**
   * A notification can be followed if it is about something — which is exactly
   * what `relatedId` records. Where that leads is the server's answer, since
   * the id names a row in one of three collections and says which in none of
   * them; asking is also what keeps the lookup scoped to the person asking.
   */
  const isActionable = (notif: Notification) => !!notif.relatedId;

  const handleAction = async (notif: Notification) => {
    if (!notif.isRead) markReadMutation.mutate(notif._id);
    if (!isActionable(notif) || resolving) return;

    setResolving(notif._id);
    try {
      const { path } = await notificationRequest(`/${notif._id}/target`, "GET");
      if (path) {
        setLocation(path);
      } else {
        // The chat, call or match this was about is gone. Saying so beats
        // navigating somewhere plausible and letting them work it out.
        toast({
          title: "Nothing left to open",
          description: "Whatever this was about is no longer there.",
        });
      }
    } catch (error) {
      showError(error as Error);
    } finally {
      setResolving(null);
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
          <p className="text-muted-foreground">
            {unreadCount > 0
              ? `${unreadCount} unread`
              : notifications.length > 0
                ? "You are all caught up."
                : "New matches and missed calls show up here."}
          </p>
        </div>
        {/* Nothing to mark when nothing is unread. */}
        {unreadCount > 0 && (
          <Button
            variant="outline"
            className="self-start shrink-0 sm:self-auto"
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
          >
            {markAllReadMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
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

              <button
                type="button"
                disabled={!isActionable(notif)}
                aria-busy={resolving === notif._id}
                className={`min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActionable(notif) ? "cursor-pointer" : "cursor-default"
                }`}
                onClick={() => handleAction(notif)}
              >
                {/* Wraps rather than squeezing: the timestamp is nowrap, so on a
                    narrow screen a fixed row crushed the title into three lines. */}
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 mb-1">
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
                {resolving === notif._id && (
                  <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    Opening…
                  </span>
                )}
              </button>

              {/* An always-present slot, so a row does not change width when it
                  is read. The dot used to be absolutely positioned in the
                  corner the delete button occupies — unnoticed only because
                  that button was invisible until hover. */}
              <span className="mt-3 flex h-2 w-2 shrink-0 items-center justify-center">
                {!notif.isRead && (
                  <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
                )}
              </span>

              {/* Hover governed this alone, so on a touch screen the control
                  did not exist: there was no way to clear a notification from a
                  phone. Always there below md, revealed on hover or focus on a
                  pointer device. */}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete "${notif.title}"`}
                className="-mr-2 shrink-0 text-muted-foreground transition-opacity hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingDelete(notif);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this notification?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? `"${pendingDelete.title}" will be removed for good.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const target = pendingDelete;
                setPendingDelete(null);
                if (target) deleteMutation.mutate(target._id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

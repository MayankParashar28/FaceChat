import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Clock, Copy, Ghost, Loader2, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getAuthToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * Create a GhostLink without leaving the chat page.
 *
 * The profile page has its own invite dialog that offers both kinds of link
 * plus a QR code. This one does the single job somebody wants mid-conversation:
 * mint a self-destructing chat and hand over the URL.
 *
 * Lifetimes mirror the bounds the server clamps to (MIN/MAX_GHOST_LIFETIME_MS
 * in server/services/ghostChat.ts); anything outside them is clamped there
 * rather than trusted, so this list is a convenience, not the rule.
 */
const LIFETIME_OPTIONS = [
  { minutes: 1, label: "1 minute" },
  { minutes: 5, label: "5 minutes" },
  { minutes: 10, label: "10 minutes" },
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 1440, label: "24 hours" },
];

function describeLifetime(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = minutes / 60;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** How long the link itself may still be opened, as a short phrase. */
function describeRedeemWindow(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  if (msLeft <= 0) return "This link has expired";
  const hours = Math.floor(msLeft / 3_600_000);
  const minutes = Math.floor((msLeft % 3_600_000) / 60_000);
  if (hours > 0) return `Can be opened for ${hours}h ${minutes}m`;
  return `Can be opened for ${minutes}m`;
}

export function GhostLinkDialog({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(10);
  const [isCreating, setIsCreating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  // The lifetime the link was actually created with. Kept apart from
  // `minutes` so moving the select afterwards cannot rewrite what the
  // confirmation claims about a link that is already minted.
  const [createdMinutes, setCreatedMinutes] = useState(10);
  const [windowLabel, setWindowLabel] = useState<string | null>(null);

  const url = code ? `${window.location.origin}/invite/${code}` : "";

  // The redeem window is 24 hours, so minute precision is plenty; a per-second
  // timer here would just wake the page up for nothing.
  useEffect(() => {
    if (!expiresAt) {
      setWindowLabel(null);
      return;
    }
    setWindowLabel(describeRedeemWindow(expiresAt));
    const timer = setInterval(() => setWindowLabel(describeRedeemWindow(expiresAt)), 30_000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const createGhostLink = useCallback(async () => {
    setIsCreating(true);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("You are signed out. Sign in again to create a GhostLink.");

      const response = await fetch("/api/invites/generate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "ghost", lifetimeMinutes: minutes }),
        credentials: "include",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || "Could not create the GhostLink.");
      }

      const data = await response.json();
      setCode(data.code);
      setExpiresAt(data.expiresAt);
      // Trust the server's own clamped value over the select, so the text
      // matches the chat the other person will actually get.
      setCreatedMinutes(
        typeof data.chatLifetimeMs === "number" ? data.chatLifetimeMs / 60_000 : minutes
      );
    } catch (error: any) {
      toast({
        title: "GhostLink failed",
        description: error?.message || "Could not create the GhostLink.",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  }, [minutes, toast]);

  const copyLink = useCallback(() => {
    if (!url) return;
    navigator.clipboard.writeText(url).then(
      () => toast({ title: "Copied", description: "GhostLink copied to your clipboard." }),
      () =>
        toast({
          title: "Could not copy",
          description: "Select the link and copy it manually.",
          variant: "destructive",
        })
    );
  }, [url, toast]);

  const shareLink = useCallback(async () => {
    if (!url) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "GhostLink", text: "A chat that erases itself.", url });
        return;
      } catch {
        // The user dismissed the sheet, or sharing is unavailable; fall back
        // to the clipboard rather than leaving the tap doing nothing.
      }
    }
    copyLink();
  }, [url, copyLink]);

  const startOver = useCallback(() => {
    setCode(null);
    setExpiresAt(null);
  }, []);

  /**
   * Take the link back before anybody has used it.
   *
   * The server refuses once it has been redeemed, and says so — at that point
   * the chat exists and the way to end it is from inside the chat, not by
   * deleting the link that opened it.
   */
  const revokeLink = useCallback(async () => {
    if (!code) return;
    setIsRevoking(true);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("You are signed out. Sign in again.");

      const response = await fetch(`/api/invites/${code}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });

      if (response.status === 409) {
        toast({
          title: "Too late",
          description:
            "Somebody already opened this link. The chat is live — end it from inside the chat.",
          variant: "destructive",
        });
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || "Could not revoke the link.");
      }

      toast({ title: "Link revoked", description: "That GhostLink can no longer be opened." });
      startOver();
    } catch (error: any) {
      toast({
        title: "Could not revoke it",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRevoking(false);
    }
  }, [code, startOver, toast]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ghost className="h-5 w-5" aria-hidden="true" />
            New GhostLink
          </DialogTitle>
          <DialogDescription>
            One person, one chat. When the timer runs out the messages and any files are deleted for
            both of you, and you stay strangers.
          </DialogDescription>
        </DialogHeader>

        {!code ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ghost-lifetime">Vanishes after</Label>
              <select
                id="ghost-lifetime"
                value={minutes}
                onChange={(event) => setMinutes(Number(event.target.value))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {LIFETIME_OPTIONS.map((option) => (
                  <option key={option.minutes} value={option.minutes}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                The countdown starts when the other person opens the link, not now.
              </p>
            </div>

            <Button onClick={createGhostLink} disabled={isCreating} className="w-full gap-2">
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Ghost className="h-4 w-4" aria-hidden="true" />
              )}
              Create GhostLink
            </Button>

            <p className="text-[11px] text-muted-foreground">
              The other person can still screenshot the chat. A GhostLink clears it from this app,
              not from their screen.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              The first person to open this gets a chat that erases itself{" "}
              {describeLifetime(createdMinutes)} later. Nobody else can use it.
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                GhostLink
              </Label>
              <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted p-1.5">
                <div className="flex-1 select-all truncate px-2 text-sm font-medium text-foreground/90">
                  {url}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={copyLink}
                  aria-label="Copy GhostLink"
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 gap-2" onClick={copyLink}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                Copy
              </Button>
              <Button className="flex-1 gap-2" onClick={shareLink}>
                <Share2 className="h-4 w-4" aria-hidden="true" />
                Share
              </Button>
            </div>

            {windowLabel && (
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{windowLabel}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="h-8 flex-1 text-xs text-muted-foreground"
                onClick={startOver}
                disabled={isRevoking}
              >
                Create another
              </Button>
              {/* Sitting beside "Create another" because that is the moment
                  somebody realises they sent the wrong thing. */}
              <Button
                variant="ghost"
                className="h-8 flex-1 gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={revokeLink}
                disabled={isRevoking}
              >
                {isRevoking ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Revoke link
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

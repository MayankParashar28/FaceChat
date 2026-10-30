import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";

/**
 * Closing an account, with the two things the server asks for in front of the
 * person before they commit to it.
 *
 * A Dialog rather than an AlertDialog: this has fields to fill in, and an
 * AlertDialog is built for a confirmation that is only a yes. The typed word
 * and the password are both the server's requirements, not decoration here —
 * the route rejects the request without them, so asking for them up front is
 * the difference between one click and a round trip that reads as a failure.
 *
 * Whether there is a password to ask for comes from the server, since the
 * hash never reaches the client. Until that answer arrives the confirm button
 * stays disabled rather than guessing, which also keeps a Google account from
 * being shown a field it has nothing to type into.
 */
export function DeleteAccountDialog({
  open,
  onOpenChange,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the account is gone; the caller signs the session out. */
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const confirmRef = useRef<HTMLInputElement>(null);

  const { data: account, isLoading: loadingAccount } = useQuery<{ requiresPassword: boolean }>({
    queryKey: ["/api/auth/account"],
    queryFn: async () => (await apiRequest("GET", "/api/auth/account")).json(),
    // Only worth asking while the dialog is up, and the answer does not change
    // underneath it.
    enabled: open,
    staleTime: Infinity,
  });

  // A dialog that reopens holding the last attempt's typing — or its error —
  // invites a mis-click on the one action here that cannot be taken back.
  useEffect(() => {
    if (open) {
      setConfirm("");
      setPassword("");
      setError(null);
    }
  }, [open]);

  const requiresPassword = account?.requiresPassword ?? false;
  const ready =
    !loadingAccount && !!account && confirm === "DELETE" && (!requiresPassword || !!password);

  const handleDelete = async () => {
    if (!ready || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await apiRequest("DELETE", "/api/auth/account", {
        confirm,
        ...(requiresPassword ? { password } : {}),
      });
      onDeleted();
    } catch (err: any) {
      // The server's own wording is the useful part — "That password is not
      // right" tells someone what to do next; a status code does not.
      setError(err?.data?.error ?? "Could not delete the account. Try again.");
      setPassword("");
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !deleting && onOpenChange(next)}>
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(event) => {
          // Land on the first field instead of the close button, so the dialog
          // opens ready to be filled in — but never on the destructive action.
          event.preventDefault();
          confirmRef.current?.focus();
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-destructive/10 text-destructive">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <DialogTitle>Delete your account</DialogTitle>
          </div>
          <DialogDescription className="pt-2">
            This removes your profile, your messages, your connections and the meetings you host.
            Conversations you shared with other people stay with them, without you in them. There is
            no undo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="delete-confirm">
              Type <span className="font-mono font-semibold text-foreground">DELETE</span> to
              confirm
            </Label>
            <Input
              id="delete-confirm"
              ref={confirmRef}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={deleting}
            />
          </div>

          {requiresPassword && (
            <div className="space-y-2">
              <Label htmlFor="delete-password">Your password</Label>
              <Input
                id="delete-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={deleting}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleDelete();
                }}
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Keep my account
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={!ready || deleting}>
            {deleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting…
              </>
            ) : (
              "Delete account"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

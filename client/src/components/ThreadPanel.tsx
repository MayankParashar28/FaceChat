import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CornerDownRight,
  FileText,
  ImageIcon,
  Loader2,
  Reply,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getAuthToken } from "@/lib/queryClient";
import { describeMessage } from "@/lib/messagePreview";
import { buildThreadTree, MAX_THREAD_DEPTH } from "@/lib/threads";
import type { ChatAttachmentData } from "@/components/ChatAttachment";

/**
 * A message as the thread endpoint returns it.
 *
 * Deliberately narrower than the timeline's own message type, and structurally
 * satisfied by it: the panel hands rows back to the page's own send path, and
 * a shared shape is what lets it do that without importing the whole page.
 */
export type ThreadMessage = {
  id: string;
  content: string;
  createdAt: Date | string;
  messageType?: "text" | "image" | "file" | "system";
  attachment?: ChatAttachmentData;
  editedAt?: string | Date;
  deletedAt?: string | Date | null;
  replyTo?: { id: string };
  threadRoot?: string;
  sender: { id: string; name: string; username: string };
};

/** Indentation per level, in pixels. Four levels is MAX_THREAD_DEPTH's worth. */
const INDENT = 14;

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function timeOf(value: Date | string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * One whole side conversation, gathered.
 *
 * Replies stay in the main timeline as well — nothing is moved out of it — so
 * this is a second way to read the same messages, for when a thread has grown
 * past the point where following it inline is comfortable.
 */
export function ThreadPanel({
  conversationId,
  rootId,
  currentParticipantId,
  canSend,
  onClose,
  onJump,
  onSend,
}: {
  conversationId: string | null;
  /** The message the thread hangs off. Null closes the panel. */
  rootId: string | null;
  /** The viewer's own id within this conversation, so "You" is right. */
  currentParticipantId: string | null;
  /** False where the page would refuse the message anyway: blocked, or gone. */
  canSend: boolean;
  onClose: () => void;
  onJump: (messageId: string) => void;
  /** The page's own send path. Returns false when it sent nothing. */
  onSend: (content: string, replyTarget: ThreadMessage) => boolean;
}) {
  const open = !!rootId && !!conversationId;

  // The sheet takes a moment to slide out, and it is still on screen for all
  // of it. Closing clears `rootId`, which would swap the query key out from
  // under it and leave the thread reading "0 replies" on its way off the
  // screen, so the last thread shown stays the one it draws until it is gone.
  const lastRootId = useRef<string | null>(null);
  if (rootId) lastRootId.current = rootId;
  const shownRootId = rootId ?? lastRootId.current;

  const { data, isLoading, isError, error, refetch } = useQuery<ThreadMessage[]>({
    queryKey: ["thread", conversationId, shownRootId],
    enabled: open,
    queryFn: async () => {
      const token = await getAuthToken();
      if (!token) throw new Error("You are not signed in.");
      const res = await fetch(`/api/conversations/${conversationId}/threads/${shownRootId}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "That thread could not be loaded.");
      }
      return res.json();
    },
  });

  // The root is whichever row the thread was opened on; everything else in the
  // response is a reply somewhere beneath it.
  // What a reply typed here answers. The thread's own root until someone
  // picks a particular message out of it, because answering the thread is the
  // ordinary case and having to choose a target first would be in the way.
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const root = data?.find((msg) => msg.id === shownRootId);
  const nodes = root
    ? buildThreadTree(
        root,
        data!.filter((msg) => msg.id !== shownRootId)
      )
    : [];
  const liveReplies = nodes.filter((node) => node.depth > 0 && !node.message.deletedAt).length;
  const replyTarget = (replyTargetId && data?.find((msg) => msg.id === replyTargetId)) || root;

  // Opening a different thread starts a fresh reply; a half-typed one carried
  // over would be aimed at a conversation nobody is looking at any more.
  useEffect(() => {
    setReplyTargetId(null);
    setDraft("");
  }, [shownRootId]);

  // A thread reads oldest-first, so what just arrived is at the end of it.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [nodes.length]);

  // The server refuses a reply to a tombstone, so rather than let someone
  // type one and watch it bounce, the composer says so and waits for them to
  // pick a message that is still there.
  const targetGone = !!replyTarget?.deletedAt;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!replyTarget || targetGone || !draft.trim()) return;
    if (!onSend(draft, replyTarget)) return;
    setDraft("");
    setReplyTargetId(null);
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-4 py-3 text-left">
          <SheetTitle className="text-base">Thread</SheetTitle>
          <SheetDescription>
            {isLoading
              ? "Loading the replies…"
              : liveReplies === 1
                ? "1 reply"
                : `${liveReplies} replies`}
          </SheetDescription>
        </SheetHeader>

        {isLoading && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          </div>
        )}

        {isError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-muted-foreground">
              {(error as Error)?.message || "That thread could not be loaded."}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        )}

        {!isLoading && !isError && (
          <ScrollArea className="flex-1">
            <div className="space-y-1 p-3">
              {nodes.map(({ message, depth }) => {
                const isMine = !!currentParticipantId && message.sender.id === currentParticipantId;
                const preview = describeMessage(message);
                const name = isMine ? "You" : message.sender.name;

                return (
                  <div
                    key={message.id}
                    style={{ marginLeft: Math.min(depth, MAX_THREAD_DEPTH) * INDENT }}
                    className={`group/thread rounded-lg px-2 py-2 transition-colors hover:bg-accent/50 ${
                      depth > 0 ? "border-l-2 border-border pl-3" : "bg-muted/40"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <Avatar className="mt-0.5 h-6 w-6 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-[10px] text-primary">
                          {initials(name)}
                        </AvatarFallback>
                      </Avatar>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-xs font-medium">{name}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {timeOf(message.createdAt)}
                          </span>
                          {message.editedAt && !message.deletedAt && (
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              edited
                            </span>
                          )}
                          {depth === 0 && (
                            <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                              Start
                            </span>
                          )}
                        </div>

                        {message.deletedAt ? (
                          <p className="mt-0.5 flex items-center gap-1.5 text-xs italic text-muted-foreground">
                            <Trash2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                            {isMine ? "You deleted this message" : "This message was deleted"}
                          </p>
                        ) : (
                          <>
                            <p className="mt-0.5 flex items-start gap-1.5 break-words text-sm">
                              {preview.kind === "photo" && (
                                <ImageIcon
                                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                  aria-hidden="true"
                                />
                              )}
                              {preview.kind === "file" && (
                                <FileText
                                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                  aria-hidden="true"
                                />
                              )}
                              <span className="min-w-0">{preview.label}</span>
                            </p>
                            {preview.detail && preview.detail !== preview.label && (
                              <p className="truncate text-[11px] text-muted-foreground">
                                {preview.detail}
                              </p>
                            )}
                          </>
                        )}

                        <div className="mt-1 flex items-center gap-1 md:opacity-0 md:transition-opacity md:group-hover/thread:opacity-100 md:focus-within:opacity-100">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => onJump(message.id)}
                          >
                            <CornerDownRight className="mr-1 h-3 w-3" aria-hidden="true" />
                            Show in chat
                          </Button>
                          {!message.deletedAt && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[11px]"
                              onClick={() => {
                                setReplyTargetId(message.id);
                                composerRef.current?.focus();
                              }}
                            >
                              <Reply className="mr-1 h-3 w-3" aria-hidden="true" />
                              Reply
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>
        )}

        {!isLoading && !isError && root && canSend && (
          <form onSubmit={submit} className="border-t border-border p-3">
            {/* Only when it is not the thread itself being answered: saying
                "Replying to the thread" above a thread's own composer would be
                a line that never tells anyone anything. */}
            {replyTarget && replyTarget.id !== root.id && (
              <div className="mb-2 flex items-center gap-2 rounded-md border-l-2 border-primary/40 bg-muted/60 px-2 py-1">
                <Reply className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                  Replying to{" "}
                  {replyTarget.sender.id === currentParticipantId
                    ? "yourself"
                    : replyTarget.sender.name}
                  : {describeMessage(replyTarget).label}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0"
                  aria-label="Reply to the thread instead"
                  onClick={() => setReplyTargetId(null)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Input
                ref={composerRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && replyTargetId) {
                    event.preventDefault();
                    setReplyTargetId(null);
                  }
                }}
                placeholder={targetGone ? "That message was deleted" : "Reply in thread..."}
                className="h-9"
                disabled={targetGone}
                aria-label="Reply in this thread"
              />
              <Button
                type="submit"
                size="icon"
                className="h-9 w-9 shrink-0"
                disabled={targetGone || !draft.trim()}
              >
                <Send className="h-4 w-4" />
                <span className="sr-only">Send</span>
              </Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

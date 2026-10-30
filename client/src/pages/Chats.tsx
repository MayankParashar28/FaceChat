import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  LogOut,
  MessageSquare,
  User,
  Search,
  Send,
  Paperclip,
  Smile,
  MoreVertical,
  Phone,
  VideoIcon,
  Pin,
  Check,
  CheckCheck,
  Image as ImageIcon,
  ArrowLeft,
  Lock,
  Unlock,
  Loader2,
  MapPin,
  Link2,
  Briefcase,
  BadgeCheck,
  Flame,
  Ghost,
  PinOff,
  FileText,
  ChevronDown,
  X,
  Reply,
  Pencil,
  Trash2,
  MoreHorizontal,
  MessagesSquare,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ChatAttachment,
  formatFileSize,
  type ChatAttachmentData,
} from "@/components/ChatAttachment";
import { GhostLinkDialog } from "@/components/GhostLinkDialog";
import { PhotoBombStack } from "@/components/PhotoBombStack";
import { groupPhotoBombs } from "@/lib/photoBombs";
import { describeMessage } from "@/lib/messagePreview";
import { ReplyQuoteBlock, type ReplyQuoteData } from "@/components/ReplyQuoteBlock";
import { ThreadPanel, type ThreadMessage } from "@/components/ThreadPanel";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { io, Socket } from "socket.io-client";
import { useAuth } from "@/lib/auth";
import { readSessionToken } from "@/lib/sessionCredential";
import { auth } from "@/lib/firebase";
import { User as FirebaseUser } from "firebase/auth";
import { searchUsers } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// Matches MAX_UPLOAD_BYTES in server/routes/attachments.ts.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

// One request per file, and apiRateLimiter allows 60 a minute, so a batch this
// size leaves plenty of headroom for the rest of the page's traffic.
const MAX_ATTACHMENTS_PER_BATCH = 10;

// Matches EDIT_WINDOW_MS in server/services/messageEdits.ts, which is what
// actually enforces it. Repeated here only so the menu stops offering Edit at
// the same moment the server would start refusing it.
const EDIT_WINDOW_MS = 15 * 60 * 1000;

// Mirrors ALLOWED_MIME in server/routes/attachments.ts. The picker's `accept`
// does this job for files chosen through a dialog, but a drop or a paste can
// carry anything, so the batch checks the type itself and says what it skipped
// instead of letting the upload come back 415.
const ACCEPTED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const IMAGE_ACCEPT = "image/jpeg,image/png,image/gif,image/webp";
const FILE_ACCEPT = "application/pdf,text/plain,text/csv,application/zip,.doc,.docx,.xls,.xlsx";

/**
 * The one line a reply shows of what it answers.
 *
 * Raw rather than a ready-made sentence: `describeMessage` turns it into one,
 * so a quoted photo reads the same way the pinned list reads it. `unavailable`
 * is a quote whose original the server could not find at all — cleared by a
 * ghost chat, say — as opposed to `deleted`, which it found as a tombstone.
 */
type ReplyQuote = ReplyQuoteData;

type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  isPinned: boolean;
  /** Who pinned it and when; absent unless it is pinned. */
  pinnedAt?: string | Date;
  pinnedBy?: string;
  /** Set once the author rewrote it. */
  editedAt?: string | Date;
  /** Set once the author took it back; `content` and `attachment` are gone. */
  deletedAt?: string | Date | null;
  /** The message this one answers, as much of it as a quote needs. */
  replyTo?: ReplyQuote;
  /** The thread this sits in, when it is a reply. Absent on a thread's root. */
  threadRoot?: string;
  /** Live replies hanging off this one. Counted by the server, not stored. */
  replyCount?: number;
  createdAt: Date;
  messageType?: "text" | "image" | "file" | "system";
  attachment?: ChatAttachmentData;
  sender: {
    id: string;
    name: string;
    username: string;
  };
  status?: "sent" | "delivered" | "seen";
  isOptimistic?: boolean; // Flag to identify optimistic messages
  tempId?: string; // Temporary ID for optimistic messages
};

type Conversation = {
  id: string;
  name: string | null;
  isGroup: boolean;
  participants: Array<{
    id: string;
    firebaseUid?: string;
    avatar?: string | null;
    name: string;
    username: string;
    online: boolean;
  }>;
  lastMessage?: Message;
  unreadCount: number;
  /** A GhostLink chat, which erases itself once `destructAt` passes. */
  isGhost?: boolean;
  destructAt?: string | null;
};

type SearchedUser = {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  connectionStatus?: "connected" | "discovered" | "none";
};

/** The public half of a user, as `GET /api/users/:id` returns it. */
type ViewedProfile = {
  id: string;
  name: string;
  username: string;
  avatar?: string | null;
  bio?: string;
  location?: string;
  website?: string;
  professional?: { title?: string; company?: string } | null;
  isVerified?: boolean;
  createdAt?: string | null;
};

export default function Chats() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [selectedChat, setSelectedChat] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlId = params.get("id");
      if (urlId) return urlId;
      return localStorage.getItem("facechat_selected_chat");
    }
    return null;
  });
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  // The file going up right now, and where it sits in the batch.
  const [uploadingAttachment, setUploadingAttachment] = useState<{
    name: string;
    index: number;
    total: number;
  } | null>(null);
  // One dialog drives every destructive confirmation here, in place of the
  // browser's confirm() — which cannot be styled and blocks the page.
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    run: () => void | Promise<void>;
  } | null>(null);
  // Set to the other participant's MongoDB id while their profile is open.
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  // dragenter/dragleave fire again for every child element the pointer crosses,
  // so the overlay flickers if it keys off the events alone. Count them.
  const dragDepthRef = useRef(0);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set()); // Stores userIds
  const [typingUserNames, setTypingUserNames] = useState<Map<string, string>>(new Map()); // Maps userId -> userName
  const [searchedUsers, setSearchedUsers] = useState<SearchedUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [, setPendingMessages] = useState<Map<string, Message>>(new Map()); // Track optimistic messages by tempId
  const replacingMessagesRef = useRef<Set<string>>(new Set()); // Track messages being replaced to prevent duplicates
  const typingTimeoutRef = useRef<NodeJS.Timeout>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  /**
   * Set by Reply and Edit, read when the menu they were chosen from closes.
   *
   * Focusing the composer inside the handler does not survive: the menu
   * restores focus to its own trigger on the way out, after the handler has
   * run, so the cursor ended up back on the message instead of in the box —
   * and on a phone the keyboard never came up at all.
   */
  const focusComposerOnMenuClose = useRef(false);
  // Set for a moment after jumping to a pinned message, so the eye lands on it.
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [isPinnedListOpen, setIsPinnedListOpen] = useState(false);
  /**
   * Whether the server has registered this connection against the account.
   *
   * Joining a conversation room is refused until it has, and the refusal is
   * silent from the reader's point of view — so this gates the join rather
   * than letting it race the handshake and lose.
   */
  const [isSocketReady, setIsSocketReady] = useState(false);
  // `message:new` can arrive twice for one message — the optimistic-replacement
  // path has its own guards for that — and a thread must not count it twice.
  const threadCountedRef = useRef<Set<string>>(new Set());
  /** The message being answered, shown above the composer until sent or cancelled. */
  // Typed to the narrower thread shape, not Message: a reply can be started
  // from the thread panel, whose rows may be older than the loaded page.
  const [replyingTo, setReplyingTo] = useState<ThreadMessage | null>(null);
  /** The thread the panel is showing, by its root message id. */
  const [openThreadRoot, setOpenThreadRoot] = useState<string | null>(null);
  /**
   * The message being rewritten. The composer is reused rather than editing in
   * place: it already handles the keyboard, the send button and the draft, and
   * two separate text inputs would be two sets of that to keep working.
   */
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  /** Message ids already reported as seen, so the observer never re-emits. */
  const seenReportedRef = useRef<Set<string>>(new Set());
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [newConversation, setNewConversation] = useState<Conversation | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set()); // Stores firebaseUids
  const selectedChatRef = useRef<string | null>(null);
  const userRef = useRef(user);
  // Socket handlers close over the render they were registered in, so reading
  // the current messages out of a ref is how they name a message they are
  // being told about.
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;
  useEffect(() => {
    selectedChatRef.current = selectedChat;
  }, [selectedChat]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setFirebaseUser(user);
    });
    return () => unsubscribe();
  }, []);

  const getToken = useCallback(async (): Promise<string | null> => {
    if (firebaseUser) {
      try {
        const tok = await firebaseUser.getIdToken();
        if (tok) return tok;
      } catch (e) {}
    }
    // The email/password session token. This used to return `user.uid`, which
    // the server accepted as a credential — see getAuthToken in lib/queryClient.
    if (typeof window !== "undefined") {
      try {
        return readSessionToken();
      } catch (e) {
        /* storage can throw in a private window */
      }
    }
    return null;
  }, [firebaseUser, user?.uid]);

  const {
    data: conversations = [],
    refetch: refetchConversations,
    isLoading: isLoadingConversations,
  } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("User not authenticated");

      const res = await fetch("/api/conversations", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch conversations");
      return res.json();
    },
    enabled: !!user?.uid,
  });

  const refetchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const debouncedRefetchConversations = useCallback(() => {
    if (refetchDebounceRef.current) {
      clearTimeout(refetchDebounceRef.current);
    }
    refetchDebounceRef.current = setTimeout(() => {
      refetchConversations();
    }, 400);
  }, [refetchConversations]);

  useEffect(() => {
    const newSocket = io(window.location.origin, {
      transports: ["websocket", "polling"],
    });

    newSocket.on("connect", async () => {
      console.log("WebSocket connected");
      const token = await getToken();
      if (token) {
        // The acknowledgement is the point: the server only recognises this
        // connection once it has finished registering it, and anything that
        // joins a conversation room before then is turned away.
        newSocket.emit("user:online", { firebaseToken: token }, (ok: boolean) =>
          setIsSocketReady(!!ok)
        );
      }
    });

    newSocket.on("disconnect", () => {
      // Rooms do not survive a reconnect, so the join has to happen again.
      setIsSocketReady(false);
    });

    newSocket.on("conversation:join-error", ({ error }: { error: string }) => {
      toast({ title: "Cannot open that chat", description: error, variant: "destructive" });
    });

    newSocket.on("message:new", (newMessage: Message) => {
      const activeChatId = selectedChatRef.current;
      const currentUser = userRef.current;

      // Determine initial status based on sender
      let initialStatus: "sent" | "delivered" | "seen" | undefined = newMessage.status;
      if (!initialStatus) {
        if (newMessage.senderId === currentUser?.uid) {
          // Message sent by current user - starts as "sent"
          initialStatus = "sent";
        } else {
          // Message received from another user - no status shown (it's not our message)
          initialStatus = undefined;
        }
      }

      const normalizedMessage: Message = {
        ...newMessage,
        createdAt: new Date(newMessage.createdAt),
        status: initialStatus,
        isOptimistic: false, // Real message from server
      };

      if (activeChatId === newMessage.conversationId) {
        setMessages((prev) => {
          // First, check if this message already exists (by ID) - avoid duplicates
          const existingById = prev.find((m) => m.id === normalizedMessage.id && !m.isOptimistic);
          if (existingById) {
            // Message already exists, just update it (in case status changed)
            return prev.map((m) => (m.id === normalizedMessage.id ? normalizedMessage : m));
          }

          // Ch(prevent double appearanceck if this message is currently being replaced e)
          if (replacingMessagesRef.current.has(normalizedMessage.id)) {
            return prev; // Already processing this replacement
          }

          // Check if this is a confirmation of an optimistic message
          // For messages from current user, match by content and recent timestamp
          const isFromCurrentUser =
            normalizedMessage.senderId === currentUser?.uid ||
            (normalizedMessage.sender as any)?.firebaseUid === currentUser?.uid ||
            normalizedMessage.sender?.id === currentUser?.uid;

          if (isFromCurrentUser) {
            // This is our message - find and replace optimistic message
            // Match by content (exact match) and recent timestamp
            const contentToMatch = normalizedMessage.content.trim();
            const optimisticIndex = prev.findIndex(
              (m) =>
                m.isOptimistic &&
                m.senderId === currentUser?.uid &&
                m.content.trim() === contentToMatch &&
                Math.abs(new Date(m.createdAt).getTime() - normalizedMessage.createdAt.getTime()) <
                  30000 // Within 30 seconds
            );

            if (optimisticIndex !== -1) {
              // Mark as being replaced to prevent duplicates
              replacingMessagesRef.current.add(normalizedMessage.id);

              // Replace optimistic message with real one (WhatsApp-like behavior)
              const optimisticMsg = prev[optimisticIndex];

              // Always start with "sent" status for smooth progression
              // Status updates will handle progression to "delivered" and "seen"
              // This prevents jumping directly to "seen" which causes visual glitches
              const finalStatus: "sent" | "delivered" | "seen" = "sent";

              // Create new array and replace in place - this ensures atomic update
              const newMessages = prev
                .map((m, idx) => {
                  if (idx === optimisticIndex) {
                    // Replace optimistic with real message, always start with "sent"
                    return {
                      ...normalizedMessage,
                      status: finalStatus,
                      isOptimistic: false, // Ensure it's marked as real
                    };
                  }
                  // Also remove any other optimistic messages with same content (safety)
                  if (
                    m.isOptimistic &&
                    m.senderId === currentUser?.uid &&
                    m.content.trim() === contentToMatch &&
                    idx !== optimisticIndex
                  ) {
                    return null; // Mark for removal
                  }
                  return m;
                })
                .filter(Boolean) as Message[];

              // Remove from pending messages
              if (optimisticMsg.tempId) {
                setPendingMessages((prevPending) => {
                  const newPending = new Map(prevPending);
                  newPending.delete(optimisticMsg.tempId!);
                  return newPending;
                });
              }

              // Don't manually trigger status updates here - let the server status updates handle it
              // This prevents race conditions and duplicate messages

              // Clear the replacement flag after a short delay
              setTimeout(() => {
                replacingMessagesRef.current.delete(normalizedMessage.id);
              }, 1000);

              // Return immediately - don't add as new message
              return newMessages;
            }
          }

          // Check for duplicates
          const duplicateExists = prev.find(
            (m) =>
              m.id === normalizedMessage.id ||
              (!m.isOptimistic &&
                m.content.trim() === normalizedMessage.content.trim() &&
                m.senderId === normalizedMessage.senderId &&
                Math.abs(new Date(m.createdAt).getTime() - normalizedMessage.createdAt.getTime()) <
                  3000)
          );

          if (duplicateExists) return prev;

          // New message from another user - add it
          return [...prev, normalizedMessage];
        });

        // A reply is one more on the thread it joined, so the "N replies" line
        // under its root moves for everyone without a refetch.
        if (normalizedMessage.threadRoot && !threadCountedRef.current.has(normalizedMessage.id)) {
          threadCountedRef.current.add(normalizedMessage.id);
          const rootId = normalizedMessage.threadRoot;
          setMessages((prev) =>
            prev.map((m) => (m.id === rootId ? { ...m, replyCount: (m.replyCount ?? 0) + 1 } : m))
          );
          queryClient.invalidateQueries({
            queryKey: ["thread", newMessage.conversationId, rootId],
          });
        }

        // Only scroll if it's a new message from another user (WhatsApp behavior)
        // Don't scroll for our own messages - they're already visible
        if (
          newMessage.senderId !== currentUser?.uid &&
          (normalizedMessage.sender as any)?.firebaseUid !== currentUser?.uid
        ) {
          setTimeout(() => scrollToBottom(), 100);
        }

        // An incoming message counts as seen only while the window is really
        // in front. This fired unconditionally, so a message arriving in a
        // background tab was reported as read half a second later.
        if (
          newMessage.senderId !== currentUser?.uid &&
          (normalizedMessage.sender as any)?.firebaseUid !== currentUser?.uid
        ) {
          setTimeout(() => {
            if (document.visibilityState !== "visible") return;
            if (seenReportedRef.current.has(newMessage.id)) return;
            seenReportedRef.current.add(newMessage.id);
            newSocket.emit("message:seen", { messageId: newMessage.id, userId: currentUser?.uid });
          }, 500);
        }
      }

      debouncedRefetchConversations();
    });

    newSocket.on("message:status", ({ messageId, status }) => {
      setMessages((prev) => {
        // Find and update the message by ID
        const messageIndex = prev.findIndex(
          (m) =>
            (!m.isOptimistic && m.id === messageId) || (m.isOptimistic && m.tempId === messageId)
        );

        if (messageIndex === -1) return prev;

        // Update the message status
        const updated = [...prev];
        updated[messageIndex] = { ...updated[messageIndex], status };

        // Remove duplicates (optimistic + real with same content)
        const seenIds = new Set<string>();
        return updated.filter((msg) => {
          // Remove optimistic if real message with same content exists
          if (msg.isOptimistic) {
            const hasReal = updated.some(
              (m) =>
                !m.isOptimistic &&
                m.content.trim() === msg.content.trim() &&
                m.senderId === msg.senderId &&
                Math.abs(new Date(m.createdAt).getTime() - new Date(msg.createdAt).getTime()) <
                  10000
            );
            if (hasReal) return false;
          }

          // Remove duplicate IDs
          if (seenIds.has(msg.id)) return false;
          seenIds.add(msg.id);
          return true;
        });
      });
    });

    newSocket.on("message:error", ({ error, tempId }: { error: string; tempId?: string }) => {
      console.error("Message send error:", error);

      // If we have a tempId, remove the optimistic message
      if (tempId) {
        setMessages((prev) => prev.filter((msg) => msg.tempId !== tempId));
        setPendingMessages((prev) => {
          const newMap = new Map(prev);
          newMap.delete(tempId);
          return newMap;
        });
      } else {
        // Remove the most recent optimistic message if no tempId provided
        setMessages((prev) => {
          const optimisticIndex = prev.findLastIndex((msg) => msg.isOptimistic);
          if (optimisticIndex !== -1) {
            const removed = prev[optimisticIndex];
            if (removed.tempId) {
              setPendingMessages((prevPending) => {
                const newPending = new Map(prevPending);
                newPending.delete(removed.tempId!);
                return newPending;
              });
            }
            return prev.filter((_, index) => index !== optimisticIndex);
          }
          return prev;
        });
      }

      // Optionally show a toast/notification to the user
      // You can add a toast library here if needed
    });

    // Both sides are in the conversation room, so a pin either of them makes
    // lands here for both — including for the socket that asked for it, which
    // is what confirms the optimistic pin below.
    newSocket.on(
      "message:pinned",
      ({ messageId, isPinned, pinnedAt, pinnedBy, replaced, pinLimit }) => {
        // A conversation keeps only so many pins, so pinning one can unpin
        // another. The server sends both halves of that in a single event.
        const dropped: string[] = replaced ?? [];

        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id === messageId) {
              return {
                ...msg,
                isPinned,
                pinnedAt: isPinned ? pinnedAt : undefined,
                pinnedBy: isPinned ? pinnedBy : undefined,
              };
            }
            if (dropped.includes(msg.id)) {
              return { ...msg, isPinned: false, pinnedAt: undefined, pinnedBy: undefined };
            }
            return msg;
          })
        );

        if (dropped.length > 0) {
          // Said to both people, not just whoever pinned: the pin that stepped
          // aside may well have been the other one's, and they are the one who
          // would otherwise find it gone with no explanation.
          const names = dropped
            .map((id) => messagesRef.current.find((m) => m.id === id))
            .filter((m): m is Message => !!m)
            .map((m) => describeMessage(m).label);
          toast({
            title:
              names.length === 1 ? `Unpinned \u201c${names[0]}\u201d` : "Older pins were removed",
            description: `A chat keeps its ${pinLimit ?? 3} most recent pins.`,
          });
        }
      }
    );

    // Pins answer on their own channel. On `message:error` the handler above
    // throws away the most recent unsent message, so a refused pin used to
    // delete something the user had just typed.
    newSocket.on("message:edited", ({ messageId, content, editedAt }) => {
      setMessages((prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, content, editedAt } : msg))
      );
      queryClient.invalidateQueries({ queryKey: ["thread"] });
    });

    newSocket.on("message:deleted", ({ messageId, deletedAt, threadRoot }) => {
      // A tombstone is not a reply anyone can read, so the count drops with it.
      if (threadRoot) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === threadRoot ? { ...m, replyCount: Math.max(0, (m.replyCount ?? 0) - 1) } : m
          )
        );
      }
      queryClient.invalidateQueries({ queryKey: ["thread"] });
      // Everything the message carried goes, here as well as on the server:
      // leaving the text in this client's state would mean a tombstone whose
      // contents were one devtools expand away.
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                content: "",
                attachment: undefined,
                deletedAt,
                isPinned: false,
                pinnedAt: undefined,
                pinnedBy: undefined,
                editedAt: undefined,
              }
            : msg
        )
      );
    });

    newSocket.on("message:edit-error", ({ error }: { error: string }) => {
      toast({ title: "Edit not saved", description: error, variant: "destructive" });
    });

    newSocket.on("message:delete-error", ({ error }: { error: string }) => {
      toast({ title: "Not deleted", description: error, variant: "destructive" });
    });

    newSocket.on("message:pin-error", ({ messageId, error }) => {
      // Put the message back the way it was before the optimistic flip.
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? { ...msg, isPinned: !msg.isPinned, pinnedAt: undefined, pinnedBy: undefined }
            : msg
        )
      );
      toast({ title: "Pin not saved", description: error, variant: "destructive" });
    });

    newSocket.on("user:typing", ({ userId, userName, conversationId }) => {
      // Only show typing indicator for the current conversation
      if (conversationId === selectedChatRef.current) {
        setTypingUsers((prev) => new Set(prev).add(userId));
        setTypingUserNames((prev) => new Map(prev).set(userId, userName || "Someone"));
        setTimeout(() => {
          setTypingUsers((prev) => {
            const newSet = new Set(prev);
            newSet.delete(userId);
            return newSet;
          });
          setTypingUserNames((prev) => {
            const newMap = new Map(prev);
            newMap.delete(userId);
            return newMap;
          });
        }, 3000);
      }
    });

    newSocket.on("user:stopped-typing", ({ userId, conversationId }) => {
      // Only clear typing indicator for the current conversation
      if (conversationId === selectedChatRef.current) {
        setTypingUsers((prev) => {
          const newSet = new Set(prev);
          newSet.delete(userId);
          return newSet;
        });
        setTypingUserNames((prev) => {
          const newMap = new Map(prev);
          newMap.delete(userId);
          return newMap;
        });
      }
    });

    newSocket.on("user:status", ({ userId, online }) => {
      setOnlineUsers((prev) => {
        const newSet = new Set(prev);
        if (online) {
          newSet.add(userId);
        } else {
          newSet.delete(userId);
        }
        return newSet;
      });
    });

    newSocket.on("users:online-list", ({ onlineUserIds }: { onlineUserIds: string[] }) => {
      setOnlineUsers((prev) => {
        const newSet = new Set(prev);
        if (Array.isArray(onlineUserIds)) {
          onlineUserIds.forEach((id) => newSet.add(id));
        }
        return newSet;
      });
    });

    newSocket.on("conversation:updated", () => {
      // Debounced refetch to avoid multiple rapid requests
      debouncedRefetchConversations();
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
      if (refetchDebounceRef.current) {
        clearTimeout(refetchDebounceRef.current);
      }
    };
  }, [debouncedRefetchConversations, firebaseUser, queryClient, toast]);

  /**
   * Enter the conversation's room, once the server knows who this connection
   * is.
   *
   * Kept apart from loading the messages, which happens over HTTP and must
   * not wait for a websocket that may never connect. The join itself has to
   * wait: `conversationMember` reads a map written at the end of the
   * `user:online` handler, so a join sent before the acknowledgement was
   * refused and the socket sat outside the room. Everything broadcast to the
   * room — a pin, above all — then missed this client entirely, which is why
   * the other side had to reload to see one.
   */
  useEffect(() => {
    if (!selectedChat || !socket || !isSocketReady) return;
    socket.emit("join:conversation", selectedChat);
  }, [selectedChat, socket, isSocketReady]);

  useEffect(() => {
    // Clear typing state when conversation changes
    setTypingUsers(new Set());
    setTypingUserNames(new Map());
    setHasMoreMessages(true);
    setPendingMessages(new Map()); // Clear pending messages when switching conversations
    replacingMessagesRef.current.clear(); // Clear replacement tracking

    if (selectedChat && socket && user?.uid) {
      const currentChatId = selectedChat;
      setMessages([]);
      setIsLoadingOlder(false);

      // Opening a conversation no longer marks it read. It used to emit
      // "mark:read", which flips every unread message in the conversation to
      // read in one update — so opening a chat with a backlog told the sender
      // you had read messages you never scrolled to. Messages are now reported
      // seen individually as they actually appear on screen (see the observer
      // below).
      seenReportedRef.current.clear();

      let isActive = true;

      // Get auth token and fetch messages
      getToken()
        .then((token) => {
          if (!token) throw new Error("Authentication required");
          return fetch(`/api/conversations/${currentChatId}/messages?limit=30`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            credentials: "include",
          });
        })
        .then((res) => {
          if (!res.ok) throw new Error("Failed to fetch messages");
          return res.json();
        })
        .then((data: Message[]) => {
          if (!isActive) return;
          // Ensure data is an array before mapping
          const messagesArray = Array.isArray(data) ? data : [];
          const normalizedMessages = messagesArray.map((msg) => {
            // Determine status for loaded messages
            let messageStatus: "sent" | "delivered" | "seen" | undefined = msg.status;
            if (!messageStatus && msg.senderId === user?.uid) {
              // For messages sent by current user, use isRead to determine status
              // Note: status is already set in backend based on isRead
              messageStatus = msg.status;
            }

            return {
              ...msg,
              createdAt: new Date(msg.createdAt),
              status: messageStatus,
            };
          });
          setMessages(normalizedMessages);
          setHasMoreMessages(messagesArray.length === 30); // If we got 30 messages, there might be more

          // Gently scroll to show recent messages, but not force to absolute bottom
          // This allows users to see the conversation naturally and scroll up for older messages
          setTimeout(() => {
            const findViewport = () => {
              if (!scrollAreaRef.current) return null;
              return (
                (scrollAreaRef.current.querySelector(
                  "[data-radix-scroll-area-viewport]"
                ) as HTMLElement) ||
                (scrollAreaRef.current.querySelector(".rt-ScrollAreaViewport") as HTMLElement) ||
                (scrollAreaRef.current.firstElementChild as HTMLElement)
              );
            };
            const viewport = findViewport();
            if (viewport) {
              // Scroll to near bottom but leave some space to indicate there might be more
              viewport.scrollTop = viewport.scrollHeight - 100;
            }
          }, 100);
        })
        .catch((error) => {
          console.error("Error fetching messages:", error);
          if (isActive) {
            setMessages([]);
          }
        });

      return () => {
        isActive = false;
      };
    }
  }, [selectedChat, socket, user?.uid]);

  /**
   * Report a message as seen once it has actually been on screen.
   *
   * A read receipt is a claim made to another person, so it is only sent when
   * it is true: the bubble has to be inside the scrolling area and the window
   * has to be in front. Opening a conversation reports nothing by itself.
   *
   * Measured with getBoundingClientRect rather than IntersectionObserver.
   * The observer is the tidier API, but when it does not fire — some embedded
   * and headless browsers never deliver its callbacks — it fails silently, and
   * the failure mode is messages that stay unread forever with no way to clear
   * them. Geometry on a throttled scroll handler always runs.
   */
  useEffect(() => {
    if (!socket || !user?.uid || !selectedChat) return;

    const container = messagesContainerRef.current;
    if (!container) return;

    // The element that actually scrolls; the bubbles are clipped to it.
    const scroller =
      (container.closest("[data-radix-scroll-area-viewport]") as HTMLElement | null) ??
      (container.parentElement as HTMLElement | null);

    const reportVisible = () => {
      if (document.visibilityState !== "visible") return;
      const bounds = scroller?.getBoundingClientRect();
      const top = bounds ? bounds.top : 0;
      const bottom = bounds ? bounds.bottom : window.innerHeight;

      messagesContainerRef.current
        ?.querySelectorAll<HTMLElement>("[data-unread-message]")
        .forEach((el) => {
          // One element can stand for several messages: a photo stack draws
          // the whole burst, and the messages it folded have no node of their
          // own to be seen. Reporting only the lead left the rest unread for
          // good, so the element carries every id it speaks for.
          const ids = (el.dataset.unreadIds || "").split(",").filter(Boolean);
          if (ids.length === 0) return;
          const box = el.getBoundingClientRect();
          // Most of the bubble inside the visible strip, not just an edge.
          const shown = Math.min(box.bottom, bottom) - Math.max(box.top, top);
          if (shown <= 0 || shown < box.height * 0.6) return;
          for (const id of ids) {
            if (seenReportedRef.current.has(id)) continue;
            seenReportedRef.current.add(id);
            socket.emit("message:seen", { messageId: id, userId: user.uid });
          }
        });
    };

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        reportVisible();
      });
    };

    schedule();
    scroller?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", schedule);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [socket, user?.uid, selectedChat, messages]);

  // The rules for what counts as one burst live in lib/photoBombs, where they
  // can be tested without a DOM.
  const photoBombs = useMemo(() => groupPhotoBombs(messages), [messages]);

  /**
   * End the open ghost chat now rather than waiting out its timer.
   *
   * The server runs the same destruction the timer would and broadcasts to
   * the room, so the other person's screen clears from that event — this only
   * has to handle our own, and does it from the response so the counts show
   * even if our socket is in the middle of reconnecting.
   */
  const destroyGhostNow = async () => {
    if (!selectedChat) return;
    setIsDestroyingGhost(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/conversations/${selectedChat}/ghost/destroy`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not end the chat");
      }
      const { erased } = await res.json();
      if (erased) setGhostErased({ chatId: selectedChat, ...erased });
      setVanishedChatId(selectedChat);
      setMessages([]);
      queryClient.setQueryData<Conversation[]>(["/api/conversations"], (old) =>
        old ? old.filter((c) => c.id !== selectedChat) : old
      );
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    } catch (err) {
      toast({
        title: "Could not end the chat",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDestroyingGhost(false);
    }
  };

  const scrollToBottom = (smooth: boolean = true) => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
    }
  };

  const loadOlderMessages = useCallback(async () => {
    if (!selectedChat || !user?.uid || isLoadingOlder || !hasMoreMessages) return;

    const oldestMessage = messages[0];
    if (!oldestMessage) return;

    setIsLoadingOlder(true);

    try {
      const token = await getToken();
      const beforeDate = oldestMessage.createdAt.toISOString();
      const res = await fetch(
        `/api/conversations/${selectedChat}/messages?beforeDate=${encodeURIComponent(beforeDate)}&limit=30`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: "include",
        }
      );

      if (!res.ok) throw new Error("Failed to fetch older messages");

      const data: Message[] = await res.json();
      const messagesArray = Array.isArray(data) ? data : [];

      if (messagesArray.length === 0) {
        setHasMoreMessages(false);
        setIsLoadingOlder(false);
        return;
      }

      const normalizedMessages = messagesArray.map((msg) => ({
        ...msg,
        createdAt: new Date(msg.createdAt),
        status: msg.status,
      }));

      // Store scroll position before adding messages
      const container = messagesContainerRef.current;
      const findViewport = () => {
        if (!scrollAreaRef.current) return null;
        // Try multiple selectors to find the viewport
        return (
          (scrollAreaRef.current.querySelector(
            "[data-radix-scroll-area-viewport]"
          ) as HTMLElement) ||
          (scrollAreaRef.current.querySelector(".rt-ScrollAreaViewport") as HTMLElement) ||
          (scrollAreaRef.current.firstElementChild as HTMLElement)
        );
      };
      const viewport = findViewport();

      const previousScrollHeight = container?.scrollHeight || 0;
      const previousScrollTop = viewport?.scrollTop || 0;

      // Prepend older messages
      setMessages((prev) => [...normalizedMessages, ...prev]);
      setHasMoreMessages(messagesArray.length === 30);

      // Restore scroll position after messages are rendered
      setTimeout(() => {
        const updatedViewport = findViewport();
        if (container && updatedViewport) {
          const newScrollHeight = container.scrollHeight;
          const heightDifference = newScrollHeight - previousScrollHeight;
          updatedViewport.scrollTop = previousScrollTop + heightDifference;
        }
      }, 50);
    } catch (error) {
      console.error("Error loading older messages:", error);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [selectedChat, user?.uid, isLoadingOlder, hasMoreMessages, messages]);

  // Cleanup duplicate messages periodically
  useEffect(() => {
    if (!selectedChat || messages.length === 0) return;

    const cleanupDuplicates = () => {
      setMessages((prev) => {
        const seenIds = new Set<string>();
        return prev.filter((msg) => {
          // Remove duplicate IDs
          if (seenIds.has(msg.id) && !msg.isOptimistic) return false;
          seenIds.add(msg.id);

          // Remove optimistic if real message with same content exists
          if (msg.isOptimistic) {
            const hasReal = prev.some(
              (m) =>
                !m.isOptimistic &&
                m.content.trim() === msg.content.trim() &&
                m.senderId === msg.senderId &&
                Math.abs(new Date(m.createdAt).getTime() - new Date(msg.createdAt).getTime()) <
                  15000
            );
            if (hasReal) return false;
          }

          return true;
        });
      });
    };

    const interval = setInterval(cleanupDuplicates, 5000);
    return () => clearInterval(interval);
  }, [selectedChat, messages.length]);

  // Handle scroll to detect when user scrolls to top
  useEffect(() => {
    if (!selectedChat) return;

    // Find the viewport element inside ScrollArea (Radix UI structure)
    const findViewport = () => {
      if (!scrollAreaRef.current) return null;
      // Radix ScrollArea has a viewport element - try multiple selectors
      return (
        (scrollAreaRef.current.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement) ||
        (scrollAreaRef.current.querySelector(".rt-ScrollAreaViewport") as HTMLElement) ||
        (scrollAreaRef.current.firstElementChild as HTMLElement)
      );
    };

    const setupScrollListener = (element: HTMLElement) => {
      const handleScroll = () => {
        // Check if scrolled near the top (within 200px)
        if (element.scrollTop < 200 && hasMoreMessages && !isLoadingOlder) {
          loadOlderMessages();
        }
      };

      element.addEventListener("scroll", handleScroll);
      return () => element.removeEventListener("scroll", handleScroll);
    };

    const viewport = findViewport();
    if (!viewport) {
      // Retry after a short delay if viewport not found yet
      const timeout = setTimeout(() => {
        const retryViewport = findViewport();
        if (retryViewport) {
          setupScrollListener(retryViewport);
        }
      }, 100);
      return () => clearTimeout(timeout);
    }

    return setupScrollListener(viewport);
  }, [selectedChat, hasMoreMessages, isLoadingOlder, loadOlderMessages]);

  const emojis = ["😊", "😂", "❤️", "👍", "🎉", "🔥", "✨", "👏"];

  const handleSelectChat = (conversationId: string) => {
    // Clear typing state when switching conversations
    setTypingUsers(new Set());
    setTypingUserNames(new Map());
    selectedChatRef.current = conversationId;
    setSelectedChat(conversationId);

    if (typeof window !== "undefined") {
      localStorage.setItem("facechat_selected_chat", conversationId);
      const url = new URL(window.location.href);
      url.searchParams.set("id", conversationId);
      window.history.replaceState({}, "", url.toString());
    }
  };

  // Restore or auto-select valid conversation on initial conversations load
  useEffect(() => {
    if (conversations.length > 0 && !selectedChat) {
      const savedId =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("id") ||
            localStorage.getItem("facechat_selected_chat")
          : null;
      const validSaved = conversations.find((c) => c.id === savedId);
      if (validSaved) {
        handleSelectChat(validSaved.id);
      } else if (conversations[0]?.id) {
        handleSelectChat(conversations[0].id);
      }
    }
  }, [conversations, selectedChat]);

  /**
   * Sending one message, wherever it was typed.
   *
   * The composer under the conversation and the one inside the thread panel
   * both come through here. Two send paths would be two places for the
   * optimistic row, the typing indicator and the ten-second give-up to drift
   * apart from each other.
   *
   * Returns false when there was nothing to send or nowhere to send it, so the
   * caller knows to leave what was typed where it is.
   */
  const sendMessage = (content: string, replyTarget: ThreadMessage | null): boolean => {
    const messageContent = content.trim();
    if (!messageContent || !socket || !selectedChat || !user?.uid) return false;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create optimistic message
    const optimisticMessage: Message = {
      id: tempId,
      conversationId: selectedChat,
      senderId: user.uid,
      content: messageContent,
      isPinned: false,
      createdAt: new Date(),
      // Answering anything in a thread joins that thread, matching what the
      // server will decide, so an open panel shows this reply straight away.
      threadRoot: replyTarget ? (replyTarget.threadRoot ?? replyTarget.id) : undefined,
      // Quoted locally so the reply reads right the instant it appears;
      // the server sends its own version back on `message:new`.
      replyTo: replyTarget
        ? {
            id: replyTarget.id,
            senderName: replyTarget.sender.name,
            content: replyTarget.content,
            messageType: replyTarget.messageType,
            attachment: replyTarget.attachment
              ? {
                  mimeType: replyTarget.attachment.mimeType,
                  name: replyTarget.attachment.name,
                }
              : undefined,
            deleted: false,
          }
        : undefined,
      sender: {
        id: user.uid,
        name: user.displayName || user.username || "You",
        username: user.username || "you",
      },
      status: "sent",
      isOptimistic: true,
      tempId: tempId,
    };

    // Add optimistic message immediately
    setMessages((prev) => [...prev, optimisticMessage]);
    setPendingMessages((prev) => new Map(prev).set(tempId, optimisticMessage));

    // The thread panel reads its own fetched list, which knows nothing about
    // the row just added to the timeline. Without this a reply typed in the
    // panel would leave it unchanged until the server answered.
    const threadRoot = optimisticMessage.threadRoot;
    if (threadRoot) {
      queryClient.setQueryData<ThreadMessage[]>(["thread", selectedChat, threadRoot], (prev) =>
        prev ? [...prev, optimisticMessage] : prev
      );
    }

    // Scroll to bottom to show the new message
    setTimeout(() => scrollToBottom(true), 50);

    // Stop typing indicator
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    socket.emit("typing:stop", { conversationId: selectedChat, userId: user.uid });

    // Send message to server
    socket.emit("message:send", {
      conversationId: selectedChat,
      senderId: user.uid,
      content: messageContent,
      replyTo: replyTarget?.id,
      tempId,
    });

    // Set timeout to handle potential errors (if message doesn't arrive within 10 seconds)
    setTimeout(() => {
      setPendingMessages((prev) => {
        if (prev.has(tempId)) {
          // Message didn't arrive, might have failed
          // Remove optimistic message if it's still pending
          setMessages((prevMsgs) => prevMsgs.filter((msg) => msg.tempId !== tempId));
          const newMap = new Map(prev);
          newMap.delete(tempId);
          return newMap;
        }
        return prev;
      });
    }, 10000);
    return true;
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    // The composer doubles as the edit box, so the same submit does both.
    if (editingMessage) {
      saveEdit();
      return;
    }
    if (!sendMessage(message, replyingTo)) return;
    setMessage("");
    setReplyingTo(null);
  };

  const handleEmojiSelect = (emoji: string) => {
    setMessage(message + emoji);
  };

  /**
   * Pin or unpin, showing the result before the server has answered.
   *
   * This used to emit and return. With the socket down nothing happened at
   * all — no pin, no error, no hint that the tap had been noticed — and even
   * connected there was a round trip of silence before the ring appeared, so
   * people tapped twice and pinned it back off again.
   */
  const handlePinMessage = (messageId: string, currentPinStatus: boolean) => {
    const next = !currentPinStatus;

    if (!socket?.connected) {
      toast({
        title: next ? "Cannot pin right now" : "Cannot unpin right now",
        description: "You are offline. Reconnect and try again.",
        variant: "destructive",
      });
      return;
    }

    // `message:pinned` comes back to this socket too and overwrites these with
    // what was actually stored; `message:pin-error` puts them back.
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              isPinned: next,
              pinnedAt: next ? new Date().toISOString() : undefined,
              pinnedBy: next
                ? getCurrentParticipantId(selectedConversation) || undefined
                : undefined,
            }
          : msg
      )
    );
    socket.emit("message:pin", { messageId, isPinned: next });
  };

  /**
   * Whether Edit is worth offering.
   *
   * Mirrors `canEdit` on the server, which is what actually decides: your own
   * message, no attachment (its caption would stop describing the file), not
   * already gone, and still inside the window. An optimistic message has no
   * id the server would recognise yet, so it waits.
   */
  const canEditMessage = (msg: Message, isMine: boolean) =>
    isMine &&
    !msg.isOptimistic &&
    !msg.deletedAt &&
    !msg.attachment &&
    Date.now() - new Date(msg.createdAt).getTime() <= EDIT_WINDOW_MS;

  /** Answer a message: the quote sits above the composer until it is sent. */
  const startReply = (msg: Message) => {
    setEditingMessage(null);
    setReplyingTo(msg);
    focusComposerOnMenuClose.current = true;
  };

  /** Rewrite one of your own. The composer is loaded with what is there now. */
  const startEdit = (msg: Message) => {
    setReplyingTo(null);
    setEditingMessage(msg);
    setMessage(msg.content);
    focusComposerOnMenuClose.current = true;
  };

  /** Back out of either, leaving the draft as it was before. */
  const cancelCompose = () => {
    if (editingMessage) setMessage("");
    setEditingMessage(null);
    setReplyingTo(null);
  };

  const saveEdit = () => {
    const next = message.trim();
    if (!editingMessage) return;
    if (!next) {
      toast({
        title: "Nothing to save",
        description: "An empty message is a deleted one — use Delete instead.",
        variant: "destructive",
      });
      return;
    }
    if (next === editingMessage.content) {
      cancelCompose();
      return;
    }
    if (!socket?.connected) {
      toast({
        title: "Cannot edit right now",
        description: "You are offline. Reconnect and try again.",
        variant: "destructive",
      });
      return;
    }
    // Shown straight away; `message:edited` confirms it and `message:edit-error`
    // is where a refusal arrives.
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === editingMessage.id
          ? { ...msg, content: next, editedAt: new Date().toISOString() }
          : msg
      )
    );
    socket.emit("message:edit", { messageId: editingMessage.id, content: next });
    cancelCompose();
  };

  /**
   * Take a message back, after asking.
   *
   * Deliberately not optimistic, unlike pinning and editing: this one cannot
   * be undone, and showing it as gone before the server agreed would mean a
   * message rising from the dead when the answer was no.
   */
  const askToDelete = (target: Message) => {
    setConfirmAction({
      title: "Delete this message?",
      description:
        "It goes for both of you, and any file on it is deleted from storage. This cannot be undone.",
      confirmLabel: "Delete",
      run: () => {
        if (!socket?.connected) {
          toast({
            title: "Cannot delete right now",
            description: "You are offline. Reconnect and try again.",
            variant: "destructive",
          });
          return;
        }
        // Editing something that is about to be gone makes no sense.
        if (editingMessage?.id === target.id) cancelCompose();
        socket.emit("message:delete", { messageId: target.id });
      },
    });
  };

  /**
   * Scroll a pinned message into view and mark it, so tapping an entry in the
   * list goes somewhere instead of merely being readable.
   */
  const jumpToMessage = (messageId: string) => {
    // A photo inside a pile has no row of its own — the message leading the
    // pile draws all of them — so that is where the jump has to land.
    const target = photoBombs.folded.get(messageId) ?? messageId;
    const row = messagesContainerRef.current?.querySelector(
      `[data-message-id="${CSS.escape(target)}"]`
    );
    if (!row) {
      // It is pinned but older than the page that is loaded.
      toast({
        title: "Further up the conversation",
        description: "Scroll back to load that message.",
      });
      return;
    }
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(target);
    window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === target ? null : current));
    }, 1600);
  };

  // Upload first, then send the message over the socket so attachments go
  // through the same FaceLink gate and optimistic-update path as text.
  //
  // The endpoint takes one file per request (raw body, no multipart parser), so
  // a batch is a sequence of these. Throws so the batch driver can report which
  // files did not make it.
  const uploadOneAttachment = async (file: File, conversationId: string, senderUid: string) => {
    const token = await getToken();
    const res = await fetch(
      `/api/conversations/${conversationId}/attachments?name=${encodeURIComponent(
        file.name
      )}&type=${encodeURIComponent(file.type)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Upload failed");
    }

    const attachment = await res.json();
    socket!.emit("message:send", {
      conversationId,
      senderId: senderUid,
      // The caption doubles as the list preview, so name the file there.
      content: file.name,
      attachment,
    });
  };

  // Send every file the picker handed back. One at a time, so the messages
  // arrive in the order they were chosen and the rate limiter is not hammered.
  const uploadAttachments = async (picked: File[]) => {
    if (!selectedChat || !user?.uid || !socket || picked.length === 0) return;

    const conversationId = selectedChat;
    const senderUid = user.uid;

    const wrongType = picked.filter((f) => !ACCEPTED_MIME.has(f.type));
    const supported = picked.filter((f) => ACCEPTED_MIME.has(f.type));
    const tooBig = supported.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    let queue = supported.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);

    const overflow = Math.max(0, queue.length - MAX_ATTACHMENTS_PER_BATCH);
    queue = queue.slice(0, MAX_ATTACHMENTS_PER_BATCH);

    // One notice for everything being skipped, rather than a toast per file.
    const skipped = [
      ...wrongType.map((f) => `${f.name} (${f.type || "unknown type"})`),
      ...tooBig.map((f) => `${f.name} (${formatFileSize(f.size)})`),
      ...(overflow > 0 ? [`${overflow} more over the limit of ${MAX_ATTACHMENTS_PER_BATCH}`] : []),
    ];
    if (skipped.length > 0) {
      toast({
        title: wrongType.length > 0 ? "Some files were not supported" : "Some files were skipped",
        description: `Not sent: ${skipped.join(", ")}. Images, PDFs, documents and zips up to ${formatFileSize(
          MAX_ATTACHMENT_BYTES
        )} each.`,
        variant: "destructive",
      });
    }
    if (queue.length === 0) return;

    const failed: string[] = [];
    try {
      for (let i = 0; i < queue.length; i++) {
        const file = queue[i];
        setUploadingAttachment({ name: file.name, index: i + 1, total: queue.length });
        try {
          await uploadOneAttachment(file, conversationId, senderUid);
        } catch (err) {
          // One bad file should not drop the rest of the selection.
          console.error("Attachment upload failed", file.name, err);
          failed.push(file.name);
        }
      }
    } finally {
      setUploadingAttachment(null);
    }

    if (failed.length > 0) {
      toast({
        title: failed.length === queue.length ? "Could not send attachments" : "Some files failed",
        description: `${failed.join(", ")} did not send. Please try again.`,
        variant: "destructive",
      });
    }
  };

  const handleFilePicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Reset so picking the same file twice still fires a change event.
    event.target.value = "";
    if (files.length > 0) void uploadAttachments(files);
  };

  /** A drag carrying files, as opposed to dragged text or a link. */
  const dragHasFiles = (event: React.DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");

  const handleDragEnter = (event: React.DragEvent) => {
    if (!canAttach || !dragHasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (!canAttach || !dragHasFiles(event)) return;
    // Without this the browser navigates to the dropped file instead.
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: React.DragEvent) => {
    if (!canAttach || !dragHasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    if (!canAttach || !dragHasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) void uploadAttachments(files);
  };

  // Paste an image straight into the composer. Only takes over when the
  // clipboard actually carries files — pasting text has to keep working.
  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    if (!canAttach) return;
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    void uploadAttachments(files);
  };

  const handleStartConversation = async (userId: string) => {
    if (!user?.uid) return;

    try {
      const token = await getToken();
      if (!token) return;

      // DISCOVERY CHECK
      const discoveryRes = await fetch(`/api/discovery/${userId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!discoveryRes.ok) {
        console.error("Discovery check failed");
        // Fallback to allowing chat creation if discovery fails
      } else {
        const discoveryData = await discoveryRes.json();

        if (discoveryData.status === "blocked") {
          // One of them blocked the other. The conversation POST below would
          // refuse this anyway, with a message about discovering each other
          // that does not describe what happened.
          toast({
            variant: "destructive",
            title: "Messaging Locked",
            description: "You cannot message this user.",
          });
          return;
        }

        if (discoveryData.status === "discovered" && !discoveryData.messagingUnlocked) {
          // SHOW LOCKED UI - User A has discovered B, but B hasn't discovered A yet.
          toast({
            variant: "destructive",
            title: "🔒 Messaging Locked",
            description:
              "You have discovered this user, but they must discover you back to unlock messaging.",
          });
          return; // STOP HERE
        }

        if (discoveryData.status === "matched") {
          // It's a Match!
          toast({
            title: "🎉 It's a Match!",
            description: "You have discovered each other — messaging unlocked!",
            className: "bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400",
          });
        }
      }

      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          participantIds: [user.uid, userId],
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        console.error("Failed to create conversation:", error);
        return;
      }

      const conversation = await res.json();

      // Store the newly created conversation
      setNewConversation({
        id: conversation.id,
        name: conversation.name,
        isGroup: conversation.isGroup,
        participants: conversation.participants,
        unreadCount: 0,
      });

      // Clear search
      setSearchQuery("");
      setSearchedUsers([]);

      // Set the selected chat immediately
      handleSelectChat(conversation.id);

      // Refetch conversations in the background
      refetchConversations();
    } catch (error) {
      console.error("Error creating conversation:", error);
    }
  };

  useEffect(() => {
    if (!socket) return;

    socket.on("discovery:match", (data: any) => {
      // data = { partner: { name, ... }, connectionId }
      toast({
        title: "🎉 It's a Match!",
        description: `You and ${data.partner.name} have discovered each other — messaging unlocked!`,
        className: "bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400",
      });
    });

    return () => {
      socket.off("discovery:match");
    };
  }, [socket, toast]);

  const handleTyping = (value: string) => {
    setMessage(value);

    if (socket && selectedChat && value && user?.uid) {
      socket.emit("typing:start", {
        conversationId: selectedChat,
        userId: user.uid,
        userName: user.displayName || "You",
      });

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      typingTimeoutRef.current = setTimeout(() => {
        socket.emit("typing:stop", { conversationId: selectedChat, userId: user.uid });
      }, 2000);
    }
  };

  // Handle search query changes
  useEffect(() => {
    const performSearch = async () => {
      if (searchQuery.trim().length >= 2) {
        setIsSearching(true);
        try {
          const users = await searchUsers(searchQuery);
          setSearchedUsers(users.filter((u) => u.id !== user?.uid)); // Exclude current user
        } catch (error) {
          console.error("Error searching users:", error);
          setSearchedUsers([]);
        } finally {
          setIsSearching(false);
        }
      } else {
        setSearchedUsers([]);
      }
    };

    const timeoutId = setTimeout(performSearch, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, user?.uid]);

  const filteredConversations = conversations.filter((conv) => {
    const displayName = conv.isGroup
      ? conv.name || "Group Chat"
      : conv.participants.find((p) => p.firebaseUid !== user?.uid)?.name || "Unknown";
    return displayName.toLowerCase().includes(searchQuery.toLowerCase());
  });

  // Use newConversation as fallback if not in conversations list yet
  const selectedConversation =
    conversations.find((c) => c.id === selectedChat) ||
    (newConversation?.id === selectedChat ? newConversation : null);

  /**
   * The open ghost chat's deadline, held apart from the conversation itself.
   *
   * The server drops an expired ghost from the conversation list, and the list
   * refreshes on a poll — so the row can disappear a moment BEFORE the
   * countdown here reaches zero. Reading the deadline off `selectedConversation`
   * meant it went null at that point, the countdown never finished, and the
   * chat simply evaporated into "Select a conversation" with nothing said.
   * Remembering it lets the timer finish and the explanation appear.
   */
  const [ghostDeadline, setGhostDeadline] = useState<{ chatId: string; at: number } | null>(null);

  useEffect(() => {
    if (!selectedChat || !selectedConversation?.isGhost || !selectedConversation.destructAt) return;
    const at = new Date(selectedConversation.destructAt).getTime();
    setGhostDeadline((prev) =>
      prev?.chatId === selectedChat && prev.at === at ? prev : { chatId: selectedChat, at }
    );
  }, [selectedChat, selectedConversation?.isGhost, selectedConversation?.destructAt]);

  const activeGhost = ghostDeadline?.chatId === selectedChat ? ghostDeadline : null;

  // Ticks once a second so the countdown stays live. This is only the part
  // people can see — the server destroys the chat whether or not anybody has
  // this page open, and refuses it on read once the time has passed.
  const [ghostNow, setGhostNow] = useState(() => Date.now());
  useEffect(() => {
    if (!activeGhost) return;
    const timer = setInterval(() => setGhostNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeGhost]);

  const ghostMsLeft = activeGhost ? Math.max(0, activeGhost.at - ghostNow) : null;
  const ghostVanished = ghostMsLeft !== null && ghostMsLeft <= 0;

  /**
   * The ghost chat that just went, kept after its row has gone.
   *
   * Refreshing the list is what removes the conversation, and with it
   * `selectedConversation` — so a panel that depended on the conversation
   * still existing would be unmounted in the same tick and the person would
   * land on "Select a conversation" with no idea what happened. Holding the id
   * lets the explanation stay on screen until they leave it themselves.
   */
  const [vanishedChatId, setVanishedChatId] = useState<string | null>(null);

  /**
   * What the destruction took, when the server got to tell us.
   *
   * The server counts this as it erases and has always thrown the number
   * away. Showing it is the only moment the promise is demonstrated rather
   * than asserted. Null when the local countdown got there first and the
   * broadcast has not arrived yet, so the notice reads without it.
   */
  const [ghostErased, setGhostErased] = useState<{
    chatId: string;
    messages: number;
    attachments: number;
  } | null>(null);

  const [isDestroyingGhost, setIsDestroyingGhost] = useState(false);

  /**
   * What to say once a ghost chat has gone.
   *
   * There are two places this appears — a panel where the conversation's row
   * used to be, and an overlay for when the countdown reaches zero with the
   * thread still open — and they have to say the same thing. The counts are
   * only there when the server got to send them, which it cannot do if the
   * local clock arrived first.
   */
  const ghostVanishedCopy = (() => {
    const erased = ghostErased?.chatId === selectedChat ? ghostErased : null;
    if (!erased)
      return "The messages and any files are deleted. There is no history to go back to.";
    const messages = `${erased.messages} ${erased.messages === 1 ? "message" : "messages"}`;
    const files =
      erased.attachments > 0
        ? ` and ${erased.attachments} ${erased.attachments === 1 ? "file" : "files"}`
        : "";
    return `${messages}${files} erased. There is no history to go back to.`;
  })();

  // Once it goes, drop it from the list rather than leaving a dead row behind.
  useEffect(() => {
    if (!ghostVanished || !selectedChat) return;
    setVanishedChatId(selectedChat);
    setMessages([]);
    queryClient.setQueryData<Conversation[]>(["/api/conversations"], (old) =>
      old ? old.filter((c) => c.id !== selectedChat) : old
    );
    queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
  }, [ghostVanished, selectedChat, queryClient]);

  /**
   * The server telling us a ghost chat is gone.
   *
   * The countdown above would get there on its own, but it runs on this
   * browser's clock and the messages are already drawn on screen. This is the
   * moment the server actually destroyed them, so clear the thread then —
   * whatever the local clock thinks.
   */
  useEffect(() => {
    if (!socket) return;
    const onVanished = ({
      conversationId,
      erased,
    }: {
      conversationId: string;
      erased?: { messages: number; attachments: number };
    }) => {
      if (conversationId === selectedChat) {
        setVanishedChatId(conversationId);
        setMessages([]);
        if (erased) setGhostErased({ chatId: conversationId, ...erased });
      }
      // Drop the row outright rather than only asking for a refetch. The list
      // is cached server-side for a few seconds, so a refetch fired at this
      // moment can come back still holding the conversation — and a list row
      // carries a preview of its last message, which is the one thing a chat
      // that just erased itself must not leave behind.
      queryClient.setQueryData<Conversation[]>(["/api/conversations"], (old) =>
        old ? old.filter((c) => c.id !== conversationId) : old
      );
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    };
    socket.on("conversation:vanished", onVanished);
    return () => {
      socket.off("conversation:vanished", onVanished);
    };
  }, [socket, selectedChat, queryClient]);

  // What the other person chose to show: whatever they filled in on their own
  // profile page, and nothing more. The endpoint returns these fields only.
  const { data: viewedProfile, isLoading: profileLoading } = useQuery<ViewedProfile>({
    queryKey: ["chatProfile", profileUserId],
    enabled: !!profileUserId,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`/api/users/${profileUserId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load profile");
      return res.json();
    },
  });
  // The other person in a 1-on-1 thread. Groups have no single counterpart, so
  // block and unblock are offered on direct conversations only.
  const otherParticipant =
    selectedConversation && !selectedConversation.isGroup
      ? (selectedConversation.participants.find((p) => p.firebaseUid !== user?.uid) ?? null)
      : null;

  // Whether this pair is blocked, and whether this account is the one holding
  // the block. Without this the header offered "Block User" to someone who had
  // already blocked the other person, and offered no way back.
  const { data: connectionStatus, refetch: refetchConnectionStatus } = useQuery<{
    status: "connected" | "discovered" | "blocked" | "none";
    messagingUnlocked: boolean;
    blockedByMe?: boolean;
    canUnblock?: boolean;
  }>({
    queryKey: ["connectionStatus", otherParticipant?.id],
    enabled: !!otherParticipant?.id,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`/api/discovery/status/${otherParticipant!.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load connection status");
      return res.json();
    },
  });

  const isBlocked = connectionStatus?.status === "blocked";
  const canUnblock = isBlocked && !!connectionStatus?.canUnblock;
  // Drop and paste are refused for the same reasons the composer is hidden.
  const canAttach = !!selectedChat && !isBlocked;

  /**
   * Every pinned message, newest pin first.
   *
   * The bar this replaced rendered `pinnedMessages[0].content` and nothing
   * else, so pinning a second message made the first one vanish from view
   * while staying pinned — there was no count, no list, and no way to reach
   * or unpin anything but whichever one happened to sort first.
   *
   * Pins made before `pinnedAt` was recorded fall back to when the message
   * itself was sent, so they still take a sensible place in the order.
   */
  const pinnedMessages = useMemo(() => {
    const when = (m: Message) => new Date(m.pinnedAt ?? m.createdAt).getTime();
    return messages.filter((m) => m.isPinned).sort((a, b) => when(b) - when(a));
  }, [messages]);

  /** The name to put against a pin: the other person's, or "you". */
  const pinnerName = (pinnedBy?: string) => {
    if (!pinnedBy) return null;
    if (pinnedBy === getCurrentParticipantId(selectedConversation)) return "you";
    return selectedConversation?.participants.find((p) => p.id === pinnedBy)?.name ?? null;
  };

  // selectedChat is restored from localStorage, so it can point at a
  // conversation this account cannot see — after signing in as someone else,
  // or once a conversation is deleted. On mobile both panes key off it, so a
  // stale id hid the list *and* the thread and left a blank screen.
  useEffect(() => {
    if (!selectedChat || isLoadingConversations || selectedConversation) return;
    // A GhostLink chat keeps its slot. Its row is dropped from the list the
    // moment it expires, and clearing the selection here would swap the
    // countdown — and then the message saying it vanished — for an empty pane
    // before anybody could read either.
    if (ghostDeadline?.chatId === selectedChat) return;
    setSelectedChat(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem("facechat_selected_chat");
    }
  }, [selectedChat, selectedConversation, isLoadingConversations, ghostDeadline]);

  // Clear newConversation once it appears in the conversations list
  useEffect(() => {
    if (newConversation && conversations.find((c) => c.id === newConversation.id)) {
      setNewConversation(null);
    }
  }, [conversations, newConversation]);

  const getConversationName = (conv: Conversation) => {
    if (conv.isGroup) return conv.name || "Group Chat";
    const otherUser = conv.participants.find(
      (p) => p.id !== user?.uid && p.firebaseUid !== user?.uid
    );
    return otherUser?.name || "Unknown";
  };

  const getConversationAvatar = (conv: Conversation) => {
    if (conv.isGroup) return conv.name?.substring(0, 2).toUpperCase() || "GC";
    const otherUser = conv.participants.find(
      (p) => p.id !== user?.uid && p.firebaseUid !== user?.uid
    );
    return (
      otherUser?.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase() || "??"
    );
  };

  const isUserOnline = (conv: Conversation) => {
    if (conv.isGroup) return false;
    const otherUser = conv.participants.find(
      (p) => p.id !== user?.uid && p.firebaseUid !== user?.uid
    );
    if (!otherUser) return false;
    return (
      onlineUsers.has(otherUser.id) ||
      (otherUser.firebaseUid ? onlineUsers.has(otherUser.firebaseUid) : false) ||
      otherUser.online
    );
  };

  const isUserTyping = () => {
    if (!selectedConversation) return false;
    const typingParticipant = selectedConversation.participants.find(
      (p) =>
        p.id !== user?.uid &&
        p.firebaseUid !== user?.uid &&
        (typingUsers.has(p.id) || (p.firebaseUid && typingUsers.has(p.firebaseUid)))
    );
    return !!typingParticipant;
  };

  const getTypingUser = () => {
    if (!selectedConversation) return null;
    const typingParticipant = selectedConversation.participants.find(
      (p) =>
        p.id !== user?.uid &&
        p.firebaseUid !== user?.uid &&
        (typingUsers.has(p.id) || (p.firebaseUid && typingUsers.has(p.firebaseUid)))
    );
    if (typingParticipant) {
      const typingName =
        typingUserNames.get(typingParticipant.id) ||
        (typingParticipant.firebaseUid
          ? typingUserNames.get(typingParticipant.firebaseUid)
          : undefined);
      return typingName || typingParticipant.name;
    }
    return null;
  };

  const formatTime = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // Resolve current user's participant.id within a conversation (maps Firebase UID -> DB participant id)
  const getCurrentParticipantId = (conv?: Conversation | null) => {
    if (!conv || !user?.uid) return null;
    const me = conv.participants.find((p) => p.firebaseUid === user.uid);
    return me?.id || null;
  };

  // Determine if a message was sent by the current user
  const isMessageFromMe = (msg: Message, conv?: Conversation | null) => {
    const myFirebaseUid = user?.uid || null;
    if (!conv || !myFirebaseUid) return false;
    const myParticipantId = getCurrentParticipantId(conv);
    const candidates = [msg.senderId, msg.sender?.id].filter(Boolean) as string[];
    if (!candidates.length) return false;

    // Direct match on Firebase UID or participant ID
    if (
      candidates.some(
        (id) => id === myFirebaseUid || (myParticipantId ? id === myParticipantId : false)
      )
    ) {
      return true;
    }

    // Match via participant lookup
    return candidates.some((id) => {
      const participant = conv.participants.find((p) => p.id === id);
      return participant?.firebaseUid === myFirebaseUid;
    });
  };

  const handleDeleteConversation = (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation(); // Prevent opening the chat
    setConfirmAction({
      title: "Remove this match?",
      description: "The conversation disappears from your list. This cannot be undone.",
      confirmLabel: "Remove",
      run: () => deleteConversation(conversationId),
    });
  };

  const deleteConversation = async (conversationId: string) => {
    try {
      const token = await getToken();
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        await refetchConversations();
        if (selectedChat === conversationId) {
          setSelectedChat(null);
        }
        toast({
          title: "Removed",
          description: "Match removed from your list.",
        });
      }
    } catch (err) {
      console.error("Failed to delete", err);
    }
  };

  const startCall = (callType: "audio" | "video") => {
    const other = selectedConversation?.participants.find(
      (p) => p.firebaseUid && p.firebaseUid !== user?.uid
    );
    if (!other?.firebaseUid) {
      toast({
        variant: "destructive",
        title: "Can't start call",
        description: "This person isn't available to call right now.",
      });
      return;
    }

    const roomId =
      Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);

    // Carry the call context so the call screen can show "Ringing…",
    // cancel the invite on hang-up, and react to a decline.
    const query = new URLSearchParams({
      outgoing: "1",
      to: other.firebaseUid,
      type: callType,
      name: other.name || "",
    });
    const goToCall = () => setLocation(`/call/${roomId}?${query.toString()}`);

    if (!socket) {
      goToCall();
      return;
    }

    // The server decides whether this call may ring at all — it refuses one to
    // somebody who blocked you. Wait for that answer before leaving the page,
    // or the call screen would sit on "Ringing…" with nobody ringing. An
    // answer that never comes must not strand the caller either, so a short
    // timeout carries on regardless.
    let settled = false;
    const proceed = () => {
      if (settled) return;
      settled = true;
      goToCall();
    };
    const timer = window.setTimeout(proceed, 4000);

    socket.emit(
      "call:invite",
      {
        toUserId: other.firebaseUid,
        fromUserId: user?.uid,
        fromName: user?.displayName || user?.username,
        fromAvatar: user?.photoURL,
        roomId,
        callType,
        conversationId: selectedChat,
      },
      (result?: { ok: boolean; message?: string }) => {
        window.clearTimeout(timer);
        if (result && result.ok === false) {
          settled = true;
          toast({
            variant: "destructive",
            title: "Can't start call",
            description: result.message || "This call could not be started.",
          });
          return;
        }
        proceed();
      }
    );
  };

  const handleClearChat = () => {
    if (!selectedChat) return;
    setConfirmAction({
      title: "Clear chat history?",
      description:
        "This hides every message so far from your side of the conversation. The other person keeps their copy, and new messages still arrive. This cannot be undone.",
      confirmLabel: "Clear history",
      run: clearChat,
    });
  };

  const clearChat = async () => {
    if (!selectedChat) return;
    try {
      const token = await getToken();
      const res = await fetch(`/api/conversations/${selectedChat}/clear`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        setMessages([]); // Clear local messages immediately
        toast({
          title: "Chat cleared",
          description: "These messages are hidden from your side of the conversation.",
        });
      } else {
        throw new Error("Failed to clear chat");
      }
    } catch (err) {
      console.error("Failed to clear chat", err);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to clear chat history.",
      });
    }
  };

  const handleBlockUser = () => {
    if (!otherParticipant) return;

    setConfirmAction({
      title: `Block ${otherParticipant.name}?`,
      description: `You will no longer receive messages from ${otherParticipant.name}, and they cannot start a call with you. You can unblock them from this menu.`,
      confirmLabel: "Block",
      run: () => blockUser(otherParticipant.id, otherParticipant.name),
    });
  };

  const handleUnblockUser = () => {
    if (!otherParticipant) return;

    setConfirmAction({
      title: `Unblock ${otherParticipant.name}?`,
      description: `${otherParticipant.name} will be able to message and call you again.`,
      confirmLabel: "Unblock",
      run: () => unblockUser(otherParticipant.id, otherParticipant.name),
    });
  };

  const blockUser = async (otherUserId: string, otherUserName: string) => {
    try {
      const token = await getToken();
      // The block endpoint takes the MongoDB id, not the Firebase uid.
      const res = await fetch(`/api/discovery/block/${otherUserId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        toast({
          title: "User Blocked",
          description: `You have blocked ${otherUserName}.`,
        });
        // Keep the thread open and let the header and composer show the block.
        // Closing it used to look like the conversation had been deleted, and
        // left no way to find the person again to unblock them.
        await Promise.all([refetchConversations(), refetchConnectionStatus()]);
      } else {
        throw new Error("Failed to block user");
      }
    } catch (err) {
      console.error("Failed to block user", err);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to block user.",
      });
    }
  };

  const unblockUser = async (otherUserId: string, otherUserName: string) => {
    try {
      const token = await getToken();
      const res = await fetch(`/api/discovery/block/${otherUserId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to unblock user");
      }

      const body = (await res.json()) as { messagingUnlocked?: boolean };
      toast({
        title: "User Unblocked",
        description: body.messagingUnlocked
          ? `You and ${otherUserName} can message each other again.`
          : `${otherUserName} is unblocked. You will need to discover each other again to chat.`,
      });
      await Promise.all([refetchConversations(), refetchConnectionStatus()]);
    } catch (err) {
      console.error("Failed to unblock user", err);
      toast({
        variant: "destructive",
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to unblock user.",
      });
    }
  };

  const getMessageBubbleClasses = (isMine: boolean, isPinned: boolean, isHighlighted = false) => {
    const base = isMine
      ? "bg-primary/15 text-primary dark:text-primary-foreground border border-primary/20"
      : "bg-muted/50 text-foreground border border-border/60";

    const pinned = isPinned ? " ring-2 ring-chart-2/40" : "";
    // Briefly, after jumping here from the pinned list, so the eye lands on
    // the right bubble rather than somewhere near it.
    const jumped = isHighlighted ? " ring-2 ring-primary ring-offset-2 ring-offset-background" : "";
    return `rounded-2xl px-5 py-3 transition-shadow ${base}${pinned}${jumped}`;
  };

  return (
    <div className="flex h-[calc(100dvh-8rem)] w-full overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex-1 flex overflow-hidden">
        {/* Chat List */}
        <div
          className={`${selectedChat ? "hidden md:flex" : "flex"} w-full md:w-80 border-r border-border flex-col bg-muted/40 backdrop-blur-sm h-full`}
        >
          <div className="p-4 border-b border-border space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search conversations..."
                className="pl-10 bg-muted/40 border-border focus:bg-accent transition-all rounded-full"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* A GhostLink is most often wanted mid-conversation, so it is
                offered here rather than only on the profile page. */}
            <GhostLinkDialog>
              <Button variant="outline" size="sm" className="w-full gap-2">
                <Ghost className="h-4 w-4" aria-hidden="true" />
                New GhostLink
              </Button>
            </GhostLinkDialog>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {/* Show searched users first if search is active */}
              {searchedUsers.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-muted-foreground px-3 py-2 uppercase tracking-wider">
                    Search Results
                  </p>
                  {searchedUsers.map((searchedUser) => (
                    <div
                      key={searchedUser.id}
                      onClick={() => handleStartConversation(searchedUser.id)}
                      className="flex items-center gap-3 p-3 rounded-xl cursor-pointer hover:bg-accent transition-colors"
                    >
                      <div className="relative">
                        <Avatar className="h-12 w-12 border border-border">
                          {searchedUser.avatar && (
                            <AvatarImage src={searchedUser.avatar} alt={searchedUser.name} />
                          )}
                          <AvatarFallback className="bg-primary/10 text-primary">
                            {searchedUser.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{searchedUser.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          @{searchedUser.username}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {searchedUser.connectionStatus === "connected" ? (
                          <Badge
                            variant="outline"
                            className="text-xs border-green-500/20 bg-green-500/10 text-green-500 gap-1"
                          >
                            <Unlock className="h-3 w-3" />
                            Match
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-xs border-border bg-muted/40 text-muted-foreground gap-1"
                          >
                            <Lock className="h-3 w-3" />
                            Locked
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {searchQuery && searchedUsers.length === 0 && !isSearching && (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No users found matching &quot;{searchQuery}&quot;</p>
                </div>
              )}

              {isSearching && (
                <div className="text-center py-8 text-muted-foreground">
                  <p>Searching...</p>
                </div>
              )}

              {filteredConversations.length === 0 && !searchQuery && !isLoadingConversations && (
                <div className="px-4 py-12 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <MessageSquare className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground">No conversations yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Search for someone above to start chatting.
                  </p>
                </div>
              )}

              {/* Show conversations */}
              {filteredConversations.length > 0 && !searchQuery && (
                <div>
                  {filteredConversations.map((conv) => (
                    <div
                      key={conv.id}
                      onClick={() => handleSelectChat(conv.id)}
                      className={`group relative flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${
                        selectedChat === conv.id
                          ? "bg-accent border border-border shadow-sm"
                          : "hover:bg-accent border border-transparent"
                      }`}
                    >
                      <div className="relative">
                        <Avatar className="h-12 w-12 border border-border">
                          {!conv.isGroup &&
                            conv.participants.find((p) => p.firebaseUid !== user?.uid)?.avatar && (
                              <AvatarImage
                                src={
                                  (
                                    conv.participants.find(
                                      (p) => p.firebaseUid !== user?.uid
                                    ) as any
                                  ).avatar
                                }
                                alt={getConversationName(conv)}
                              />
                            )}
                          <AvatarFallback
                            className={
                              conv.isGroup
                                ? "bg-chart-2/10 text-chart-2"
                                : "bg-primary/10 text-primary"
                            }
                          >
                            {getConversationAvatar(conv)}
                          </AvatarFallback>
                        </Avatar>
                        {isUserOnline(conv) && (
                          <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-background rounded-full ring-2 ring-background" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className="font-medium text-sm truncate">
                            {getConversationName(conv)}
                          </p>
                          {conv.lastMessage && (
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatTime(conv.lastMessage.createdAt)}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          {(() => {
                            if (!conv.lastMessage) return "New Match";
                            const isMine = conv.lastMessage
                              ? isMessageFromMe(conv.lastMessage, conv)
                              : false;
                            // A deleted last message has no text left, so this
                            // read as a blank row rather than as anything.
                            if (conv.lastMessage.deletedAt) return "Message deleted";
                            // The raw content is the file name on an upload;
                            // the same rules the pinned list reads it by.
                            const preview = describeMessage(conv.lastMessage).label;
                            return `${isMine ? "You: " : ""}${preview}`;
                          })()}
                        </p>
                      </div>

                      {/* X Button for empty matches */}
                      {!conv.lastMessage && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex opacity-100 z-10">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            onClick={(e) => handleDeleteConversation(e, conv.id)}
                          >
                            <LogOut className="h-4 w-4 rotate-180" />
                          </Button>
                        </div>
                      )}

                      {conv.unreadCount > 0 && (
                        <Badge className="h-5 min-w-5 flex items-center justify-center px-1.5 bg-primary text-primary-foreground">
                          {conv.unreadCount}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Chat Area */}
        {vanishedChatId && selectedChat === vanishedChatId ? (
          <div className="flex flex-1 flex-col items-center justify-center bg-transparent w-full h-full px-6 text-center">
            <span className="text-5xl mb-3" aria-hidden="true">
              👻
            </span>
            <p className="text-lg font-semibold">This chat has vanished</p>
            <p className="text-sm text-muted-foreground max-w-xs mt-1">{ghostVanishedCopy}</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => {
                setVanishedChatId(null);
                setSelectedChat(null);
              }}
            >
              Back to chats
            </Button>
          </div>
        ) : selectedChat && selectedConversation ? (
          <div
            className={`${!selectedChat ? "hidden md:flex" : "flex"} flex-1 flex-col bg-transparent relative w-full h-full`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isDraggingFiles && (
              <div className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-background/80 backdrop-blur-sm pointer-events-none">
                <div className="flex flex-col items-center gap-2 text-center px-6">
                  <Paperclip className="h-8 w-8 text-primary" />
                  <p className="font-semibold text-foreground">Drop to send</p>
                  <p className="text-sm text-muted-foreground">
                    Up to {MAX_ATTACHMENTS_PER_BATCH} files, {formatFileSize(MAX_ATTACHMENT_BYTES)}{" "}
                    each
                  </p>
                </div>
              </div>
            )}
            {/* Chat Header */}
            <div className="p-4 border-b border-border bg-muted/40 backdrop-blur-sm flex items-center justify-between z-10 shrink-0">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden -ml-2 hover:bg-accent"
                  onClick={() => setSelectedChat(null)}
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="relative">
                  <Avatar className="h-10 w-10 border border-border">
                    {!selectedConversation.isGroup &&
                      selectedConversation.participants.find((p) => p.firebaseUid !== user?.uid)
                        ?.avatar && (
                        <AvatarImage
                          src={
                            (
                              selectedConversation.participants.find(
                                (p) => p.firebaseUid !== user?.uid
                              ) as any
                            ).avatar
                          }
                          alt={getConversationName(selectedConversation)}
                        />
                      )}
                    <AvatarFallback
                      className={
                        selectedConversation.isGroup
                          ? "bg-chart-2/10 text-chart-2"
                          : "bg-primary/10 text-primary"
                      }
                    >
                      {getConversationAvatar(selectedConversation)}
                    </AvatarFallback>
                  </Avatar>
                  {!selectedConversation.isGroup && isUserOnline(selectedConversation) && (
                    <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-background rounded-full" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{getConversationName(selectedConversation)}</p>
                    {isUserOnline(selectedConversation) && (
                      <span className="text-xs text-muted-foreground">•</span>
                    )}
                  </div>
                  {isUserTyping() ? (
                    <p className="text-xs text-primary italic animate-pulse">
                      {getTypingUser()} is typing...
                    </p>
                  ) : !selectedConversation.isGroup && isUserOnline(selectedConversation) ? (
                    <p className="text-xs text-green-500">Online</p>
                  ) : !selectedConversation.isGroup ? (
                    <p className="text-xs text-muted-foreground">Offline</p>
                  ) : selectedConversation.isGroup ? (
                    <p className="text-xs text-muted-foreground">
                      {selectedConversation.participants.length} members
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="hover:bg-accent"
                  onClick={() => startCall("audio")}
                >
                  <Phone className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hover:bg-accent"
                  onClick={() => startCall("video")}
                >
                  <VideoIcon className="h-5 w-5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="hover:bg-accent">
                      <MoreVertical className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-48 bg-background/95 backdrop-blur-xl border-border"
                  >
                    {!selectedConversation.isGroup && (
                      <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => {
                          const other = selectedConversation.participants.find(
                            (p) => p.firebaseUid !== user?.uid
                          );
                          if (other?.id) setProfileUserId(other.id);
                        }}
                      >
                        <User className="w-4 h-4 mr-2" />
                        View Profile
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      className="cursor-pointer text-chart-4 focus:text-chart-4"
                      onClick={handleClearChat}
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      Clear Chat
                    </DropdownMenuItem>
                    {!selectedConversation.isGroup && (
                      <>
                        <DropdownMenuSeparator className="bg-accent" />
                        {isBlocked ? (
                          <DropdownMenuItem
                            className="cursor-pointer"
                            disabled={!canUnblock}
                            onClick={handleUnblockUser}
                          >
                            <Unlock className="w-4 h-4 mr-2" />
                            {canUnblock ? "Unblock User" : "Blocked by them"}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            className="cursor-pointer text-destructive focus:text-destructive"
                            onClick={handleBlockUser}
                          >
                            <Lock className="w-4 h-4 mr-2" />
                            Block User
                          </DropdownMenuItem>
                        )}
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {ghostMsLeft !== null && !ghostVanished && (
              <div className="px-4 py-2 border-b border-border bg-muted/40 backdrop-blur-sm">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 font-medium">
                    <span aria-hidden="true">👻</span>
                    Self-destructs in{" "}
                    <span className="tabular-nums" aria-live="off">
                      {String(Math.floor(ghostMsLeft / 60000)).padStart(2, "0")}:
                      {String(Math.floor((ghostMsLeft % 60000) / 1000)).padStart(2, "0")}
                    </span>
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      They can still screenshot this
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isDestroyingGhost}
                      className="h-7 gap-1.5 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() =>
                        setConfirmAction({
                          title: "End this chat now?",
                          description:
                            "Every message and file in it is erased for both of you, straight away. There is no history to go back to.",
                          confirmLabel: "Erase it",
                          run: destroyGhostNow,
                        })
                      }
                    >
                      {isDestroyingGhost ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Flame className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      Destroy now
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {ghostVanished && (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/95 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3 text-center px-6">
                  <span className="text-5xl" aria-hidden="true">
                    👻
                  </span>
                  <p className="text-lg font-semibold">This chat has vanished</p>
                  <p className="text-sm text-muted-foreground max-w-xs">{ghostVanishedCopy}</p>
                  <Button
                    variant="outline"
                    className="mt-2"
                    onClick={() => {
                      setSelectedChat(null);
                      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
                    }}
                  >
                    Back to chats
                  </Button>
                </div>
              </div>
            )}

            {pinnedMessages.length > 0 && (
              <div className="border-b border-border bg-muted/40 backdrop-blur-sm">
                {/* Collapsed, this is the newest pin and a count. The whole row
                    is the toggle, because on a phone a chevron-sized target is
                    the difference between opening it and missing. */}
                <button
                  type="button"
                  onClick={() => setIsPinnedListOpen((open) => !open)}
                  aria-expanded={isPinnedListOpen}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <Pin className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="shrink-0 font-medium text-muted-foreground">
                    {pinnedMessages.length} pinned
                  </span>
                  {!isPinnedListOpen && (
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {describeMessage(pinnedMessages[0]).label}
                    </span>
                  )}
                  <ChevronDown
                    className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                      isPinnedListOpen ? "rotate-180" : ""
                    }`}
                    aria-hidden="true"
                  />
                </button>

                {isPinnedListOpen && (
                  <ul className="max-h-48 overflow-y-auto border-t border-border/60 px-2 pb-2">
                    {pinnedMessages.map((pinned) => {
                      const preview = describeMessage(pinned);
                      const by = pinnerName(pinned.pinnedBy);
                      const PreviewIcon =
                        preview.kind === "photo"
                          ? ImageIcon
                          : preview.kind === "file"
                            ? FileText
                            : MessageSquare;
                      return (
                        <li key={pinned.id} className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => jumpToMessage(pinned.id)}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <PreviewIcon
                              className="h-4 w-4 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm">{preview.label}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {/* The file name earns its place only when the
                                    line above is a caption rather than the name. */}
                                {[preview.detail, by && `Pinned by ${by}`]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </span>
                          </button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                            onClick={() => handlePinMessage(pinned.id, true)}
                            aria-label={`Unpin ${preview.label}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
              <div className="space-y-6" ref={messagesContainerRef}>
                {isLoadingOlder && (
                  <div className="flex justify-center py-4">
                    <p className="text-sm text-muted-foreground">Loading older messages...</p>
                  </div>
                )}
                {messages.length === 0 && !isLoadingOlder && (
                  <div className="flex h-full min-h-[40vh] flex-col items-center justify-center text-center">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      <MessageSquare className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground">No messages yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Say hello to {/* p.id is the MongoDB id; user.uid is the Firebase uid. */}
                      {selectedConversation?.participants.find((p) => p.firebaseUid !== user?.uid)
                        ?.name || "them"}
                      .
                    </p>
                  </div>
                )}
                {messages.map((msg) => {
                  // Call events (started / ended / declined / missed) render as
                  // a centered pill rather than a chat bubble.
                  if (msg.messageType === "system") {
                    return (
                      <div key={msg.id} className="flex justify-center py-1">
                        <span className="rounded-full bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
                          {msg.content}
                        </span>
                      </div>
                    );
                  }

                  // Everything after the first photo of a burst is drawn by
                  // the stack on that first message.
                  if (photoBombs.folded.has(msg.id)) return null;
                  const bomb = photoBombs.leads.get(msg.id);

                  const isMe = isMessageFromMe(msg, selectedConversation);

                  // A stack shows one tick for the whole burst, so it reports
                  // the least-advanced state in it rather than the first
                  // photo's — four photos are not "Seen" while one is sending.
                  const rank = { sent: 0, delivered: 1, seen: 2 } as const;
                  const group = bomb?.members ?? [msg];
                  const displayStatus = group.reduce<Message["status"]>(
                    (worst, m) =>
                      !m.status || !worst || rank[m.status] < rank[worst] ? m.status : worst,
                    group[0].status
                  );
                  const displayOptimistic = group.some((m) => m.isOptimistic);

                  // Marked for the read-receipt observer: only somebody else's
                  // messages, and only those still unread.
                  const unreadIds = group
                    .filter(
                      (m) =>
                        !isMessageFromMe(m, selectedConversation) &&
                        m.status !== "seen" &&
                        !m.isOptimistic
                    )
                    .map((m) => m.id);
                  const needsSeenReport = unreadIds.length > 0;
                  return (
                    <div
                      key={msg.id}
                      data-message-id={msg.id}
                      {...(needsSeenReport
                        ? { "data-unread-message": "true", "data-unread-ids": unreadIds.join(",") }
                        : {})}
                      className={`flex gap-3 group/message ${isMe ? "flex-row-reverse" : ""}`}
                    >
                      {!isMe && (
                        <Avatar className="h-8 w-8 border border-border">
                          {selectedConversation.participants.find((p) => p.id === msg.sender.id)
                            ?.avatar && (
                            <AvatarImage
                              src={
                                (
                                  selectedConversation.participants.find(
                                    (p) => p.id === msg.sender.id
                                  ) as any
                                ).avatar
                              }
                              alt={msg.sender.name}
                            />
                          )}
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            {msg.sender.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div
                        className={`flex flex-col max-w-[70%] ${isMe ? "items-end" : "items-start"}`}
                      >
                        {selectedConversation?.isGroup && (
                          <span className="text-xs font-medium text-muted-foreground mb-1">
                            {isMe ? "You" : msg.sender.name}
                          </span>
                        )}
                        <div className="relative">
                          <div
                            className={getMessageBubbleClasses(
                              isMe,
                              bomb ? false : msg.isPinned,
                              highlightedMessageId === msg.id
                            )}
                          >
                            {/* What it answers, above what it says. Tapping it
                                goes there, the same jump the pinned list makes. */}
                            {msg.replyTo && !msg.deletedAt && (
                              <ReplyQuoteBlock
                                quote={msg.replyTo}
                                isMine={isMe}
                                onJump={jumpToMessage}
                              />
                            )}

                            {msg.deletedAt ? (
                              // The row stays so the thread does not reshuffle
                              // under everyone; there is simply nothing in it.
                              <p className="flex items-center gap-2 text-sm italic text-muted-foreground">
                                <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                {isMe ? "You deleted this message" : "This message was deleted"}
                              </p>
                            ) : (
                              <>
                                {bomb ? (
                                  <PhotoBombStack
                                    photos={bomb.members.map((m) => ({
                                      messageId: m.id,
                                      attachment: m.attachment!,
                                      isPinned: m.isPinned,
                                    }))}
                                    conversationId={msg.conversationId}
                                  />
                                ) : (
                                  msg.attachment && (
                                    <ChatAttachment
                                      attachment={msg.attachment}
                                      conversationId={msg.conversationId}
                                    />
                                  )
                                )}
                                {/* An attachment's caption defaults to its file
                                    name, which the card above already shows. */}
                                {!bomb &&
                                  !(msg.attachment && msg.content === msg.attachment.name) && (
                                    <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                                      {msg.content}
                                    </p>
                                  )}
                              </>
                            )}
                            <div
                              className={`mt-3 flex items-center justify-end gap-2 text-[11px] font-medium ${
                                isMe
                                  ? "text-primary/70 dark:text-primary-foreground/80"
                                  : "text-muted-foreground/80"
                              }`}
                            >
                              {msg.editedAt && !msg.deletedAt && (
                                // Said plainly rather than hidden in a tooltip:
                                // the other person is entitled to know the words
                                // they are reading are not the ones that arrived.
                                <span title={`Edited ${formatTime(msg.editedAt)}`}>edited</span>
                              )}
                              <span>{formatTime(msg.createdAt)}</span>
                              {isMe && displayStatus && (
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                                    displayOptimistic
                                      ? "bg-muted/50 text-muted-foreground/70 opacity-70"
                                      : displayStatus === "seen"
                                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                                        : displayStatus === "delivered"
                                          ? "bg-sky-500/15 text-sky-600 dark:text-sky-300"
                                          : "bg-muted text-muted-foreground"
                                  }`}
                                >
                                  {displayStatus === "seen" && (
                                    <>
                                      <CheckCheck className="h-3 w-3" />
                                      Seen
                                    </>
                                  )}
                                  {displayStatus === "delivered" && (
                                    <>
                                      <CheckCheck className="h-3 w-3" />
                                      Delivered
                                    </>
                                  )}
                                  {displayStatus === "sent" && (
                                    <>
                                      <Check className="h-3 w-3" />
                                      {displayOptimistic ? "Sending..." : "Sent"}
                                    </>
                                  )}
                                </span>
                              )}
                            </div>
                          </div>
                          {/* A thread stays in the timeline as well as in the
                              panel, so this is a way into the same messages
                              rather than somewhere they have been moved to. */}
                          {!msg.deletedAt && (msg.replyCount ?? 0) > 0 && (
                            <button
                              type="button"
                              onClick={() => setOpenThreadRoot(msg.id)}
                              className="mt-1 flex items-center gap-1 rounded text-[11px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <MessagesSquare className="h-3 w-3" aria-hidden="true" />
                              {msg.replyCount === 1 ? "1 reply" : `${msg.replyCount} replies`}
                            </button>
                          )}
                          {/* Hover alone used to govern this, which meant the
                              control did not exist on a touch screen: there
                              was no way to pin, reply, edit or delete anything
                              from a phone at all. It is always there below md,
                              and still appears on hover or focus on a pointer
                              device. Nothing is offered on a tombstone — there
                              is nothing left to act on. */}
                          {!msg.deletedAt && (
                            <div
                              className={`absolute -top-2 transition-opacity md:opacity-0 md:group-hover/message:opacity-100 md:focus-within:opacity-100 ${
                                isMe ? "left-0 -ml-8" : "right-0 -mr-8"
                              }`}
                            >
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className={`h-6 w-6 hover:bg-accent ${
                                      msg.isPinned ? "text-chart-2" : "text-muted-foreground"
                                    }`}
                                    aria-label={`Actions for ${describeMessage(msg).label}`}
                                  >
                                    {msg.isPinned ? (
                                      <Pin className="h-3 w-3 fill-current" />
                                    ) : (
                                      <MoreHorizontal className="h-3 w-3" />
                                    )}
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align={isMe ? "start" : "end"}
                                  className="w-44"
                                  onCloseAutoFocus={(event) => {
                                    // Only when Reply or Edit asked for it.
                                    // Otherwise the menu keeps its own
                                    // behaviour and focus returns to the
                                    // trigger, where a keyboard user expects
                                    // to find it.
                                    if (!focusComposerOnMenuClose.current) return;
                                    focusComposerOnMenuClose.current = false;
                                    event.preventDefault();
                                    composerRef.current?.focus();
                                  }}
                                >
                                  <DropdownMenuItem onClick={() => startReply(msg)}>
                                    <Reply className="mr-2 h-4 w-4" />
                                    Reply
                                  </DropdownMenuItem>
                                  {/* A reply buried a few levels down is the
                                      hardest place from which to see what the
                                      side conversation actually was. */}
                                  {msg.threadRoot && (
                                    <DropdownMenuItem
                                      onClick={() => setOpenThreadRoot(msg.threadRoot!)}
                                    >
                                      <MessagesSquare className="mr-2 h-4 w-4" />
                                      View thread
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem
                                    onClick={() => handlePinMessage(msg.id, msg.isPinned)}
                                  >
                                    {msg.isPinned ? (
                                      <PinOff className="mr-2 h-4 w-4" />
                                    ) : (
                                      <Pin className="mr-2 h-4 w-4" />
                                    )}
                                    {msg.isPinned ? "Unpin" : "Pin"}
                                  </DropdownMenuItem>
                                  {canEditMessage(msg, isMe) && (
                                    <DropdownMenuItem onClick={() => startEdit(msg)}>
                                      <Pencil className="mr-2 h-4 w-4" />
                                      Edit
                                    </DropdownMenuItem>
                                  )}
                                  {isMe && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        onClick={() => askToDelete(msg)}
                                        className="text-destructive focus:text-destructive"
                                      >
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Delete
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={scrollRef} />
              </div>
            </ScrollArea>

            {isUserTyping() && getTypingUser() && (
              <div className="px-4 py-2 border-t border-border bg-muted/40">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-current animate-pulse" />
                    <div
                      className="w-2 h-2 rounded-full bg-current animate-pulse"
                      style={{ animationDelay: "0.2s" }}
                    />
                    <div
                      className="w-2 h-2 rounded-full bg-current animate-pulse"
                      style={{ animationDelay: "0.4s" }}
                    />
                  </div>
                  <span className="italic">{getTypingUser()} is typing...</span>
                </div>
              </div>
            )}

            {isBlocked ? (
              <div className="p-4 border-t border-border bg-card/60 backdrop-blur-sm">
                <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                  <Lock className="h-4 w-4 shrink-0" />
                  <span>
                    {canUnblock
                      ? `You blocked ${otherParticipant?.name ?? "this user"}. Unblock them to send messages.`
                      : "Messaging is locked for this conversation."}
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-4 border-t border-border bg-card/60 backdrop-blur-sm">
                {uploadingAttachment && (
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span className="truncate">
                      {uploadingAttachment.total > 1
                        ? `Uploading ${uploadingAttachment.index} of ${uploadingAttachment.total} — ${uploadingAttachment.name}…`
                        : `Uploading ${uploadingAttachment.name}…`}
                    </span>
                  </div>
                )}
                {/* What the composer is about to do, when it is not simply
                    sending something new. Without this the box silently
                    changes meaning — you would type into what looks like a
                    fresh message and overwrite an old one. */}
                {(replyingTo || editingMessage) && (
                  <div className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
                    {editingMessage ? (
                      <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Reply className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-muted-foreground">
                        {editingMessage
                          ? "Editing your message"
                          : `Replying to ${replyingTo!.sender.name}`}
                      </p>
                      <p className="truncate text-sm">
                        {describeMessage(editingMessage ?? replyingTo!).label}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={cancelCompose}
                      aria-label={editingMessage ? "Stop editing" : "Cancel reply"}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                <form
                  onSubmit={handleSendMessage}
                  className="relative flex items-end gap-2 p-2 rounded-2xl bg-background border border-border shadow-sm"
                >
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="relative">
                      <Input
                        ref={composerRef}
                        placeholder={editingMessage ? "Edit your message..." : "Type a message..."}
                        value={message}
                        onChange={(e) => handleTyping(e.target.value)}
                        onPaste={handlePaste}
                        onKeyDown={(e) => {
                          // Escape backs out of a reply or an edit, which is
                          // what the key does everywhere else in the app.
                          if (e.key === "Escape" && (editingMessage || replyingTo)) {
                            e.preventDefault();
                            cancelCompose();
                          }
                        }}
                        className="pr-24 bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
                      />
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept={FILE_ACCEPT}
                          className="hidden"
                          onChange={handleFilePicked}
                        />
                        <input
                          ref={imageInputRef}
                          type="file"
                          multiple
                          accept={IMAGE_ACCEPT}
                          className="hidden"
                          onChange={handleFilePicked}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Attach files"
                          disabled={!!uploadingAttachment}
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Paperclip className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Attach images"
                          disabled={!!uploadingAttachment}
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => imageInputRef.current?.click()}
                        >
                          <ImageIcon className="h-4 w-4" />
                        </Button>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 hover:bg-accent text-muted-foreground hover:text-foreground"
                            >
                              <Smile className="h-4 w-4" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-auto p-2 bg-background/95 backdrop-blur-xl border-border"
                            align="end"
                          >
                            <div className="grid grid-cols-4 gap-1">
                              {emojis.map((emoji, i) => (
                                <Button
                                  key={i}
                                  variant="ghost"
                                  size="icon"
                                  className="h-10 w-10 text-xl hover:bg-accent"
                                  onClick={() => handleEmojiSelect(emoji)}
                                >
                                  {emoji}
                                </Button>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  </div>
                  <Button
                    type="submit"
                    size="icon"
                    className="rounded-xl h-10 w-10 shadow-md"
                    aria-label={editingMessage ? "Save edit" : "Send message"}
                  >
                    {editingMessage ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                  </Button>
                </form>
              </div>
            )}
          </div>
        ) : (
          <div className="hidden md:flex flex-1 items-center justify-center text-muted-foreground">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-muted/40 flex items-center justify-center animate-pulse">
                <MessageSquare className="h-10 w-10 opacity-50" />
              </div>
              <p className="text-xl font-semibold mb-2">Select a conversation</p>
              <p className="text-sm text-muted-foreground/70">Choose a chat to start messaging</p>
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!profileUserId} onOpenChange={(open) => !open && setProfileUserId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Profile</DialogTitle>
            <DialogDescription>
              What this person has filled in on their own profile.
            </DialogDescription>
          </DialogHeader>
          {profileLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : viewedProfile ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar className="h-14 w-14 border border-border">
                  {viewedProfile.avatar && (
                    <AvatarImage src={viewedProfile.avatar} alt={viewedProfile.name} />
                  )}
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {(viewedProfile.name || viewedProfile.username || "?").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="font-semibold truncate">{viewedProfile.name || "User"}</p>
                    {viewedProfile.isVerified && (
                      <BadgeCheck className="h-4 w-4 text-primary shrink-0" />
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    @{viewedProfile.username}
                  </p>
                </div>
              </div>

              {viewedProfile.bio && <p className="text-sm text-foreground">{viewedProfile.bio}</p>}

              <div className="space-y-2 text-sm text-muted-foreground">
                {(viewedProfile.professional?.title || viewedProfile.professional?.company) && (
                  <div className="flex items-center gap-2">
                    <Briefcase className="h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {[viewedProfile.professional?.title, viewedProfile.professional?.company]
                        .filter(Boolean)
                        .join(" at ")}
                    </span>
                  </div>
                )}
                {viewedProfile.location && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 shrink-0" />
                    <span className="truncate">{viewedProfile.location}</span>
                  </div>
                )}
                {viewedProfile.website && (
                  <div className="flex items-center gap-2">
                    <Link2 className="h-4 w-4 shrink-0" />
                    <span className="truncate">{viewedProfile.website}</span>
                  </div>
                )}
                {viewedProfile.createdAt && (
                  <p>
                    Joined{" "}
                    {new Date(viewedProfile.createdAt).toLocaleDateString(undefined, {
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                )}
              </div>

              {!viewedProfile.bio &&
                !viewedProfile.location &&
                !viewedProfile.website &&
                !viewedProfile.professional?.title &&
                !viewedProfile.professional?.company && (
                  <p className="text-sm text-muted-foreground">
                    They haven't added anything else to their profile yet.
                  </p>
                )}
            </div>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">This profile could not be loaded.</p>
          )}
        </DialogContent>
      </Dialog>

      <ThreadPanel
        conversationId={selectedChat}
        rootId={openThreadRoot}
        currentParticipantId={getCurrentParticipantId(selectedConversation)}
        canSend={!isBlocked}
        onClose={() => setOpenThreadRoot(null)}
        onJump={(messageId) => {
          // The sheet covers the timeline, so it has to get out of the way for
          // the jump it just asked for to be visible at all.
          setOpenThreadRoot(null);
          window.setTimeout(() => jumpToMessage(messageId), 150);
        }}
        onSend={sendMessage}
      />

      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmAction?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const action = confirmAction;
                setConfirmAction(null);
                void action?.run();
              }}
            >
              {confirmAction?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

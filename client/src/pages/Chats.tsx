import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Video, Settings, LogOut, LayoutDashboard, MessageSquare, User, Search, Send, Paperclip, Smile, MoreVertical, Phone, VideoIcon, Pin, Check, CheckCheck, Image as ImageIcon, ArrowLeft, Lock, Unlock } from "lucide-react";
import { LogoMark } from "@/components/LogoMark";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { io, Socket } from "socket.io-client";
import { useAuth } from "@/lib/auth";
import { auth } from "@/lib/firebase";
import { User as FirebaseUser } from "firebase/auth";
import { getAvatarUrl, getInitials, searchUsers } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  isPinned: boolean;
  createdAt: Date;
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
};

type SearchedUser = {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar?: string;
  connectionStatus?: 'connected' | 'discovered' | 'none';
};

export default function Chats() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, logout } = useAuth();
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set()); // Stores userIds
  const [typingUserNames, setTypingUserNames] = useState<Map<string, string>>(new Map()); // Maps userId -> userName
  const [searchedUsers, setSearchedUsers] = useState<SearchedUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [pendingMessages, setPendingMessages] = useState<Map<string, Message>>(new Map()); // Track optimistic messages by tempId
  const replacingMessagesRef = useRef<Set<string>>(new Set()); // Track messages being replaced to prevent duplicates
  const typingTimeoutRef = useRef<NodeJS.Timeout>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [newConversation, setNewConversation] = useState<Conversation | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set()); // Stores firebaseUids
  const selectedChatRef = useRef<string | null>(null);
  const userRef = useRef(user);
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

  const { data: conversations = [], refetch: refetchConversations } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
    queryFn: async () => {
      if (!firebaseUser) throw new Error("User not authenticated");

      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/conversations", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch conversations");
      return res.json();
    },
    enabled: !!user?.uid && !!firebaseUser
  });

  useEffect(() => {
    const newSocket = io(window.location.origin, {
      transports: ['websocket', 'polling']
    });

    newSocket.on("connect", async () => {
      console.log("WebSocket connected");
      if (firebaseUser) {
        try {
          const token = await firebaseUser.getIdToken();
          newSocket.emit("user:online", { firebaseToken: token });
        } catch (error) {
          console.error("Failed to get Firebase token:", error);
        }
      }
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
        isOptimistic: false // Real message from server
      };

      if (activeChatId === newMessage.conversationId) {
        setMessages(prev => {
          // First, check if this message already exists (by ID) - avoid duplicates
          const existingById = prev.find(m => m.id === normalizedMessage.id && !m.isOptimistic);
          if (existingById) {
            // Message already exists, just update it (in case status changed)
            return prev.map(m => m.id === normalizedMessage.id ? normalizedMessage : m);
          }

          // Ch(prevent double appearanceck if this message is currently being replaced e)
          if (replacingMessagesRef.current.has(normalizedMessage.id)) {
            return prev; // Already processing this replacement
          }

          // Check if this is a confirmation of an optimistic message
          // For messages from current user, match by content and recent timestamp
          const isFromCurrentUser = normalizedMessage.senderId === currentUser?.uid ||
            (normalizedMessage.sender as any)?.firebaseUid === currentUser?.uid ||
            normalizedMessage.sender?.id === currentUser?.uid;

          if (isFromCurrentUser) {
            // This is our message - find and replace optimistic message
            // Match by content (exact match) and recent timestamp
            const contentToMatch = normalizedMessage.content.trim();
            const optimisticIndex = prev.findIndex(
              m => m.isOptimistic &&
                m.senderId === currentUser?.uid &&
                m.content.trim() === contentToMatch &&
                Math.abs(new Date(m.createdAt).getTime() - normalizedMessage.createdAt.getTime()) < 30000 // Within 30 seconds
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
              const newMessages = prev.map((m, idx) => {
                if (idx === optimisticIndex) {
                  // Replace optimistic with real message, always start with "sent"
                  return {
                    ...normalizedMessage,
                    status: finalStatus,
                    isOptimistic: false // Ensure it's marked as real
                  };
                }
                // Also remove any other optimistic messages with same content (safety)
                if (m.isOptimistic &&
                  m.senderId === currentUser?.uid &&
                  m.content.trim() === contentToMatch &&
                  idx !== optimisticIndex) {
                  return null; // Mark for removal
                }
                return m;
              }).filter(Boolean) as Message[];

              // Remove from pending messages
              if (optimisticMsg.tempId) {
                setPendingMessages(prevPending => {
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
          const duplicateExists = prev.find(m =>
            m.id === normalizedMessage.id ||
            (!m.isOptimistic &&
              m.content.trim() === normalizedMessage.content.trim() &&
              m.senderId === normalizedMessage.senderId &&
              Math.abs(new Date(m.createdAt).getTime() - normalizedMessage.createdAt.getTime()) < 3000)
          );

          if (duplicateExists) return prev;

          // New message from another user - add it
          return [...prev, normalizedMessage];
        });

        // Only scroll if it's a new message from another user (WhatsApp behavior)
        // Don't scroll for our own messages - they're already visible
        if (newMessage.senderId !== currentUser?.uid &&
          (normalizedMessage.sender as any)?.firebaseUid !== currentUser?.uid) {
          setTimeout(() => scrollToBottom(), 100);
        }

        // If message is from another user and we're viewing the chat, mark as seen
        if (newMessage.senderId !== currentUser?.uid &&
          (normalizedMessage.sender as any)?.firebaseUid !== currentUser?.uid) {
          setTimeout(() => {
            newSocket.emit("message:seen", { messageId: newMessage.id, userId: currentUser?.uid });
          }, 500);
        }
      }

      refetchConversations();
    });

    newSocket.on("message:status", ({ messageId, status }) => {
      setMessages(prev => {
        // Find and update the message by ID
        const messageIndex = prev.findIndex(m =>
          (!m.isOptimistic && m.id === messageId) ||
          (m.isOptimistic && m.tempId === messageId)
        );

        if (messageIndex === -1) return prev;

        // Update the message status
        const updated = [...prev];
        updated[messageIndex] = { ...updated[messageIndex], status };

        // Remove duplicates (optimistic + real with same content)
        const seenIds = new Set<string>();
        return updated.filter(msg => {
          // Remove optimistic if real message with same content exists
          if (msg.isOptimistic) {
            const hasReal = updated.some(m =>
              !m.isOptimistic &&
              m.content.trim() === msg.content.trim() &&
              m.senderId === msg.senderId &&
              Math.abs(new Date(m.createdAt).getTime() - new Date(msg.createdAt).getTime()) < 10000
            );
            if (hasReal) return false;
          }

          // Remove duplicate IDs
          if (seenIds.has(msg.id)) return false;
          seenIds.add(msg.id);
          return true;
        });
      });

      refetchConversations();
    });

    newSocket.on("message:error", ({ error, tempId }: { error: string; tempId?: string }) => {
      console.error("Message send error:", error);

      // If we have a tempId, remove the optimistic message
      if (tempId) {
        setMessages(prev => prev.filter(msg => msg.tempId !== tempId));
        setPendingMessages(prev => {
          const newMap = new Map(prev);
          newMap.delete(tempId);
          return newMap;
        });
      } else {
        // Remove the most recent optimistic message if no tempId provided
        setMessages(prev => {
          const optimisticIndex = prev.findLastIndex(msg => msg.isOptimistic);
          if (optimisticIndex !== -1) {
            const removed = prev[optimisticIndex];
            if (removed.tempId) {
              setPendingMessages(prevPending => {
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

    newSocket.on("message:pinned", ({ messageId, isPinned }) => {
      const activeChatId = selectedChatRef.current;
      setMessages(prev => prev.map(msg =>
        msg.id === messageId ? { ...msg, isPinned } : msg
      ));
    });

    newSocket.on("user:typing", ({ userId, userName, conversationId }) => {
      // Only show typing indicator for the current conversation
      if (conversationId === selectedChatRef.current) {
        setTypingUsers(prev => new Set(prev).add(userId));
        setTypingUserNames(prev => new Map(prev).set(userId, userName || "Someone"));
        setTimeout(() => {
          setTypingUsers(prev => {
            const newSet = new Set(prev);
            newSet.delete(userId);
            return newSet;
          });
          setTypingUserNames(prev => {
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
        setTypingUsers(prev => {
          const newSet = new Set(prev);
          newSet.delete(userId);
          return newSet;
        });
        setTypingUserNames(prev => {
          const newMap = new Map(prev);
          newMap.delete(userId);
          return newMap;
        });
      }
    });

    newSocket.on("user:status", ({ userId, online }) => {
      // userId should be firebaseUid
      setOnlineUsers(prev => {
        const newSet = new Set(prev);
        if (online) {
          newSet.add(userId);
        } else {
          newSet.delete(userId);
        }
        return newSet;
      });
    });

    newSocket.on("conversation:updated", (updatedConv: Conversation) => {
      // Refetch conversations to update the list
      refetchConversations();
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [refetchConversations, firebaseUser]);

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

      // Join the conversation room
      socket.emit("join:conversation", currentChatId);

      // Mark all messages as read
      socket.emit("mark:read", { conversationId: currentChatId, userId: user.uid });

      let isActive = true;

      // Get auth token and fetch messages
      firebaseUser?.getIdToken().then(token => {
        return fetch(`/api/conversations/${currentChatId}/messages?limit=30`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          credentials: "include",
        });
      }).then(res => {
        if (!res.ok) throw new Error("Failed to fetch messages");
        return res.json();
      })
        .then((data: Message[]) => {
          if (!isActive) return;
          // Ensure data is an array before mapping
          const messagesArray = Array.isArray(data) ? data : [];
          const normalizedMessages = messagesArray.map(msg => {
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
              status: messageStatus
            };
          });
          setMessages(normalizedMessages);
          setHasMoreMessages(messagesArray.length === 30); // If we got 30 messages, there might be more

          // Mark all messages from others as seen
          normalizedMessages.forEach(msg => {
            if (msg.senderId !== user?.uid) {
              socket.emit("message:seen", { messageId: msg.id, userId: user.uid });
            }
          });

          // Gently scroll to show recent messages, but not force to absolute bottom
          // This allows users to see the conversation naturally and scroll up for older messages
          setTimeout(() => {
            const findViewport = () => {
              if (!scrollAreaRef.current) return null;
              return scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement ||
                scrollAreaRef.current.querySelector('.rt-ScrollAreaViewport') as HTMLElement ||
                (scrollAreaRef.current.firstElementChild as HTMLElement);
            };
            const viewport = findViewport();
            if (viewport) {
              // Scroll to near bottom but leave some space to indicate there might be more
              viewport.scrollTop = viewport.scrollHeight - 100;
            }
          }, 100);
        })
        .catch(error => {
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
      const beforeDate = oldestMessage.createdAt.toISOString();
      const res = await fetch(
        `/api/conversations/${selectedChat}/messages?userId=${user.uid}&beforeDate=${encodeURIComponent(beforeDate)}&limit=30`
      );

      if (!res.ok) throw new Error("Failed to fetch older messages");

      const data: Message[] = await res.json();
      const messagesArray = Array.isArray(data) ? data : [];

      if (messagesArray.length === 0) {
        setHasMoreMessages(false);
        setIsLoadingOlder(false);
        return;
      }

      const normalizedMessages = messagesArray.map(msg => ({
        ...msg,
        createdAt: new Date(msg.createdAt),
        status: msg.status
      }));

      // Store scroll position before adding messages
      const container = messagesContainerRef.current;
      const findViewport = () => {
        if (!scrollAreaRef.current) return null;
        // Try multiple selectors to find the viewport
        return scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement ||
          scrollAreaRef.current.querySelector('.rt-ScrollAreaViewport') as HTMLElement ||
          (scrollAreaRef.current.firstElementChild as HTMLElement);
      };
      const viewport = findViewport();

      const previousScrollHeight = container?.scrollHeight || 0;
      const previousScrollTop = viewport?.scrollTop || 0;

      // Prepend older messages
      setMessages(prev => [...normalizedMessages, ...prev]);
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
      setMessages(prev => {
        const seenIds = new Set<string>();
        return prev.filter(msg => {
          // Remove duplicate IDs
          if (seenIds.has(msg.id) && !msg.isOptimistic) return false;
          seenIds.add(msg.id);

          // Remove optimistic if real message with same content exists
          if (msg.isOptimistic) {
            const hasReal = prev.some(m =>
              !m.isOptimistic &&
              m.content.trim() === msg.content.trim() &&
              m.senderId === msg.senderId &&
              Math.abs(new Date(m.createdAt).getTime() - new Date(msg.createdAt).getTime()) < 15000
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
      return scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement ||
        scrollAreaRef.current.querySelector('.rt-ScrollAreaViewport') as HTMLElement ||
        (scrollAreaRef.current.firstElementChild as HTMLElement);
    };

    const setupScrollListener = (element: HTMLElement) => {
      const handleScroll = () => {
        // Check if scrolled near the top (within 200px)
        if (element.scrollTop < 200 && hasMoreMessages && !isLoadingOlder) {
          loadOlderMessages();
        }
      };

      element.addEventListener('scroll', handleScroll);
      return () => element.removeEventListener('scroll', handleScroll);
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
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && socket && selectedChat && user?.uid) {
      const messageContent = message.trim();
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create optimistic message
      const optimisticMessage: Message = {
        id: tempId,
        conversationId: selectedChat,
        senderId: user.uid,
        content: messageContent,
        isPinned: false,
        createdAt: new Date(),
        sender: {
          id: user.uid,
          name: user.displayName || user.username || "You",
          username: user.username || "you"
        },
        status: "sent",
        isOptimistic: true,
        tempId: tempId
      };

      // Add optimistic message immediately
      setMessages(prev => [...prev, optimisticMessage]);
      setPendingMessages(prev => new Map(prev).set(tempId, optimisticMessage));

      // Scroll to bottom to show the new message
      setTimeout(() => scrollToBottom(true), 50);

      // Clear input
      setMessage("");

      // Stop typing indicator
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      socket.emit("typing:stop", { conversationId: selectedChat, userId: user.uid });

      // Send message to server
      socket.emit("message:send", {
        conversationId: selectedChat,
        senderId: user.uid,
        content: messageContent
      });

      // Set timeout to handle potential errors (if message doesn't arrive within 10 seconds)
      setTimeout(() => {
        setPendingMessages(prev => {
          if (prev.has(tempId)) {
            // Message didn't arrive, might have failed
            // Remove optimistic message if it's still pending
            setMessages(prevMsgs => prevMsgs.filter(msg => msg.tempId !== tempId));
            const newMap = new Map(prev);
            newMap.delete(tempId);
            return newMap;
          }
          return prev;
        });
      }, 10000);
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    setMessage(message + emoji);
  };

  const handlePinMessage = (messageId: string, currentPinStatus: boolean) => {
    if (socket) {
      socket.emit("message:pin", { messageId, isPinned: !currentPinStatus });
    }
  };

  const handleFileAttach = () => {
    console.log("File attachment clicked");
  };

  const handleStartConversation = async (userId: string) => {
    if (!user?.uid || !firebaseUser) return;

    try {
      const token = await firebaseUser.getIdToken();

      // DISCOVERY CHECK
      const discoveryRes = await fetch(`/api/discovery/${userId}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!discoveryRes.ok) {
        console.error("Discovery check failed");
        // Fallback to allowing chat creation if discovery fails (or handle error)
      } else {
        const discoveryData = await discoveryRes.json();

        if (discoveryData.status === 'discovered' && !discoveryData.messagingUnlocked) {
          // SHOW LOCKED UI - User A has discovered B, but B hasn't discovered A yet.
          toast({
            variant: "destructive",
            title: "🔒 Messaging Locked",
            description: "You have discovered this user, but they must discover you back to unlock messaging.",
          });
          return; // STOP HERE
        }

        if (discoveryData.status === 'matched') {
          // It's a Match!
          toast({
            title: "🎉 It's a Match!",
            description: "You have discovered each other — messaging unlocked!",
            className: "bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400",
          });
        }
      }

      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          participantIds: [user.uid, userId],
        })
      });

      if (!res.ok) {
        const error = await res.json();
        console.error('Failed to create conversation:', error);
        return;
      }

      const conversation = await res.json();

      // Store the newly created conversation
      setNewConversation({
        id: conversation.id,
        name: conversation.name,
        isGroup: conversation.isGroup,
        participants: conversation.participants,
        unreadCount: 0
      });

      // Clear search
      setSearchQuery("");
      setSearchedUsers([]);

      // Set the selected chat immediately
      handleSelectChat(conversation.id);

      // Refetch conversations in the background
      refetchConversations();
    } catch (error) {
      console.error('Error creating conversation:', error);
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
        userName: user.displayName || "You"
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
          setSearchedUsers(users.filter(u => u.id !== user?.uid)); // Exclude current user
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

  const filteredConversations = conversations.filter(conv => {
    const displayName = conv.isGroup
      ? (conv.name || "Group Chat")
      : (conv.participants.find(p => p.firebaseUid !== user?.uid)?.name || "Unknown");
    return displayName.toLowerCase().includes(searchQuery.toLowerCase());
  });

  // Use newConversation as fallback if not in conversations list yet
  const selectedConversation = conversations.find(c => c.id === selectedChat) ||
    (newConversation?.id === selectedChat ? newConversation : null);
  const pinnedMessages = messages.filter(m => m.isPinned);

  // Clear newConversation once it appears in the conversations list
  useEffect(() => {
    if (newConversation && conversations.find(c => c.id === newConversation.id)) {
      setNewConversation(null);
    }
  }, [conversations, newConversation]);

  const getConversationName = (conv: Conversation) => {
    if (conv.isGroup) return conv.name || "Group Chat";
    const otherUser = conv.participants.find(p => p.firebaseUid !== user?.uid);
    return otherUser?.name || "Unknown";
  };

  const getConversationAvatar = (conv: Conversation) => {
    if (conv.isGroup) return conv.name?.substring(0, 2).toUpperCase() || "GC";
    const otherUser = conv.participants.find(p => p.firebaseUid !== user?.uid);
    return otherUser?.name.split(' ').map(n => n[0]).join('').toUpperCase() || "??";
  };

  const isUserOnline = (conv: Conversation) => {
    if (conv.isGroup) return false;
    const otherUser = conv.participants.find(p => p.firebaseUid !== user?.uid);
    if (!otherUser?.firebaseUid) return false;
    return onlineUsers.has(otherUser.firebaseUid);
  };

  const isUserTyping = () => {
    if (!selectedConversation) return false;
    // Check if any participant (except current user) is typing
    const typingParticipant = selectedConversation.participants.find(
      p => p.firebaseUid !== user?.uid && typingUsers.has(p.firebaseUid || '')
    );
    return !!typingParticipant;
  };

  const getTypingUser = () => {
    if (!selectedConversation) return null;
    // Find the typing participant and return their name
    const typingParticipant = selectedConversation.participants.find(
      p => p.firebaseUid !== user?.uid && typingUsers.has(p.firebaseUid || '')
    );
    if (typingParticipant) {
      // Try to get name from typingUserNames map first, fallback to participant name
      const typingName = typingUserNames.get(typingParticipant.firebaseUid || '');
      return typingName || typingParticipant.name;
    }
    return null;
  };

  const formatTime = (date: Date) => {
    const d = new Date(date);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Resolve current user's participant.id within a conversation (maps Firebase UID -> DB participant id)
  const getCurrentParticipantId = (conv?: Conversation | null) => {
    if (!conv || !user?.uid) return null;
    const me = conv.participants.find(p => p.firebaseUid === user.uid);
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
    if (candidates.some((id) => id === myFirebaseUid || (myParticipantId ? id === myParticipantId : false))) {
      return true;
    }

    // Match via participant lookup
    return candidates.some((id) => {
      const participant = conv.participants.find((p) => p.id === id);
      return participant?.firebaseUid === myFirebaseUid;
    });
  };

  const handleDeleteConversation = async (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation(); // Prevent opening the chat
    if (!confirm("Remove this match from your list?")) return;

    try {
      const token = await firebaseUser?.getIdToken();
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
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

  const handleClearChat = async () => {
    if (!selectedChat || !firebaseUser) return;
    if (!confirm("Are you sure you want to clear the chat history? This cannot be undone.")) return;

    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`/api/chat/${selectedChat}/clear`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (res.ok) {
        setMessages([]); // Clear local messages immediately
        toast({
          title: "Chat Cleared",
          description: "History cleared for this session.",
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

  const handleBlockUser = async () => {
    if (!selectedConversation || !firebaseUser) return;

    // Find the other user
    const otherUser = selectedConversation.participants.find(p => p.firebaseUid !== user?.uid);
    if (!otherUser) return;

    if (!confirm(`Are you sure you want to block ${otherUser.name}? You will no longer receive messages from them.`)) return;

    try {
      const token = await firebaseUser.getIdToken();
      // Use the MongoDB ID (otherUser.id) for the block endpoint
      const res = await fetch(`/api/discovery/block/${otherUser.id}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (res.ok) {
        toast({
          title: "User Blocked",
          description: `You have blocked ${otherUser.name}.`,
        });
        // Optionally remove the chat or refresh
        await refetchConversations();
        setSelectedChat(null);
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

  const getMessageBubbleClasses = (isMine: boolean, isPinned: boolean) => {
    const base = isMine
      ? "bg-primary/15 text-primary dark:text-primary-foreground border border-primary/20"
      : "bg-muted/50 text-foreground border border-border/60";

    const pinned = isPinned ? " ring-2 ring-chart-2/40" : "";
    return `rounded-2xl px-5 py-3 ${base}${pinned}`;
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm shadow-2xl">
      <div className="flex-1 flex overflow-hidden">
        {/* Chat List */}
        <div className={`${selectedChat ? 'hidden md:flex' : 'flex'} w-full md:w-80 border-r border-white/10 flex-col bg-white/5 backdrop-blur-sm h-full`}>
          <div className="p-4 border-b border-white/10">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search conversations..."
                className="pl-10 bg-white/5 border-white/10 focus:bg-white/10 transition-all rounded-full"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {/* Show searched users first if search is active */}
              {searchedUsers.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-muted-foreground px-3 py-2 uppercase tracking-wider">Search Results</p>
                  {searchedUsers.map((searchedUser) => (
                    <div
                      key={searchedUser.id}
                      onClick={() => handleStartConversation(searchedUser.id)}
                      className="flex items-center gap-3 p-3 rounded-xl cursor-pointer hover:bg-white/10 transition-colors"
                    >
                      <div className="relative">
                        <Avatar className="h-12 w-12 border border-white/10">
                          {searchedUser.avatar && (
                            <AvatarImage src={searchedUser.avatar} alt={searchedUser.name} />
                          )}
                          <AvatarFallback className="bg-primary/10 text-primary">
                            {searchedUser.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{searchedUser.name}</p>
                        <p className="text-xs text-muted-foreground truncate">@{searchedUser.username}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {searchedUser.connectionStatus === 'connected' ? (
                          <Badge variant="outline" className="text-xs border-green-500/20 bg-green-500/10 text-green-500 gap-1">
                            <Unlock className="h-3 w-3" />
                            Match
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs border-white/10 bg-white/5 text-muted-foreground gap-1">
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

              {/* Show conversations */}
              {filteredConversations.length > 0 && !searchQuery && (
                <div>
                  {filteredConversations.map((conv) => (
                    <div
                      key={conv.id}
                      onClick={() => handleSelectChat(conv.id)}
                      className={`group relative flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${selectedChat === conv.id ? 'bg-white/10 border border-white/5 shadow-sm' : 'hover:bg-white/5 border border-transparent'
                        }`}
                    >
                      <div className="relative">
                        <Avatar className="h-12 w-12 border border-white/10">
                          {!conv.isGroup && (conv.participants.find(p => p.firebaseUid !== user?.uid)?.avatar) && (
                            <AvatarImage src={(conv.participants.find(p => p.firebaseUid !== user?.uid) as any).avatar} alt={getConversationName(conv)} />
                          )}
                          <AvatarFallback className={conv.isGroup ? "bg-chart-2/10 text-chart-2" : "bg-primary/10 text-primary"}>
                            {getConversationAvatar(conv)}
                          </AvatarFallback>
                        </Avatar>
                        {isUserOnline(conv) && (
                          <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-background rounded-full ring-2 ring-background" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className="font-medium text-sm truncate">{getConversationName(conv)}</p>
                          {conv.lastMessage && (
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatTime(conv.lastMessage.createdAt)}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          {(() => {
                            if (!conv.lastMessage) return "New Match";
                            const isMine = conv.lastMessage ? isMessageFromMe(conv.lastMessage, conv) : false;
                            return `${isMine ? 'You: ' : ''}${conv.lastMessage.content}`;
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
        {selectedChat && selectedConversation ? (
          <div className={`${!selectedChat ? 'hidden md:flex' : 'flex'} flex-1 flex-col bg-transparent relative w-full h-full`}>
            {/* Chat Header */}
            <div className="p-4 border-b border-white/10 bg-white/5 backdrop-blur-sm flex items-center justify-between z-10 shrink-0">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden -ml-2 hover:bg-white/10"
                  onClick={() => setSelectedChat(null)}
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="relative">
                  <Avatar className="h-10 w-10 border border-white/10">
                    {!selectedConversation.isGroup && (selectedConversation.participants.find(p => p.firebaseUid !== user?.uid)?.avatar) && (
                      <AvatarImage src={(selectedConversation.participants.find(p => p.firebaseUid !== user?.uid) as any).avatar} alt={getConversationName(selectedConversation)} />
                    )}
                    <AvatarFallback className={selectedConversation.isGroup ? "bg-chart-2/10 text-chart-2" : "bg-primary/10 text-primary"}>
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
                    <p className="text-xs text-primary italic animate-pulse">{getTypingUser()} is typing...</p>
                  ) : !selectedConversation.isGroup && isUserOnline(selectedConversation) ? (
                    <p className="text-xs text-green-500">Online</p>
                  ) : !selectedConversation.isGroup ? (
                    <p className="text-xs text-muted-foreground">Offline</p>
                  ) : selectedConversation.isGroup ? (
                    <p className="text-xs text-muted-foreground">{selectedConversation.participants.length} members</p>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="hover:bg-white/10"
                  onClick={() => {
                    const roomId = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
                    setLocation(`/call/${roomId}`);
                  }}
                >
                  <Phone className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hover:bg-white/10"
                  onClick={() => {
                    const roomId = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
                    setLocation(`/call/${roomId}`);
                  }}
                >
                  <VideoIcon className="h-5 w-5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="hover:bg-white/10">
                      <MoreVertical className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 bg-background/95 backdrop-blur-xl border-white/10">
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={() => {
                        // TODO: Implement navigation to user profile when available
                        toast({ title: "Profile View", description: "This feature is coming soon!" });
                      }}
                    >
                      <User className="w-4 h-4 mr-2" />
                      View Profile
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="cursor-pointer text-orange-500 focus:text-orange-500"
                      onClick={handleClearChat}
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      Clear Chat
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-white/10" />
                    <DropdownMenuItem
                      className="cursor-pointer text-red-500 focus:text-red-500"
                      onClick={handleBlockUser}
                    >
                      <Lock className="w-4 h-4 mr-2" />
                      Block User
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {pinnedMessages.length > 0 && (
              <div className="px-4 py-2 bg-white/5 border-b border-white/10 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-sm">
                  <Pin className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Pinned:</span>
                  <span className="truncate">{pinnedMessages[0].content}</span>
                </div>
              </div>
            )}

            <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
              <div className="space-y-6" ref={messagesContainerRef}>
                {isLoadingOlder && (
                  <div className="flex justify-center py-4">
                    <p className="text-sm text-muted-foreground">Loading older messages...</p>
                  </div>
                )}
                {messages.map((msg) => {
                  const isMe = isMessageFromMe(msg, selectedConversation);
                  return (
                    <div
                      key={msg.id}
                      className="flex gap-3 group/message"
                    >
                      {!isMe && (
                        <Avatar className="h-8 w-8 border border-white/10">
                          {(selectedConversation.participants.find(p => p.id === msg.sender.id)?.avatar) && (
                            <AvatarImage src={(selectedConversation.participants.find(p => p.id === msg.sender.id) as any).avatar} alt={msg.sender.name} />
                          )}
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            {msg.sender.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div className="flex flex-col items-start max-w-[70%]">
                        {selectedConversation?.isGroup && (
                          <span className="text-xs font-medium text-muted-foreground mb-1">
                            {isMe ? 'You' : msg.sender.name}
                          </span>
                        )}
                        <div className="relative">
                          <div
                            className={getMessageBubbleClasses(isMe, msg.isPinned)}
                          >
                            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                              {msg.content}
                            </p>
                            <div
                              className={`mt-3 flex items-center justify-end gap-2 text-[11px] font-medium ${isMe ? 'text-primary/70 dark:text-primary-foreground/80' : 'text-muted-foreground/80'
                                }`}
                            >
                              <span>{formatTime(msg.createdAt)}</span>
                              {isMe && msg.status && (
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${msg.isOptimistic
                                    ? "bg-muted/50 text-muted-foreground/70 opacity-70"
                                    : msg.status === "seen"
                                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                                      : msg.status === "delivered"
                                        ? "bg-sky-500/15 text-sky-600 dark:text-sky-300"
                                        : "bg-muted text-muted-foreground"
                                    }`}
                                >
                                  {msg.status === "seen" && (
                                    <>
                                      <CheckCheck className="h-3 w-3" />
                                      Seen
                                    </>
                                  )}
                                  {msg.status === "delivered" && (
                                    <>
                                      <CheckCheck className="h-3 w-3" />
                                      Delivered
                                    </>
                                  )}
                                  {msg.status === "sent" && (
                                    <>
                                      <Check className="h-3 w-3" />
                                      {msg.isOptimistic ? "Sending..." : "Sent"}
                                    </>
                                  )}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="absolute -top-2 right-0 -mr-8 opacity-0 group-hover/message:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 hover:bg-white/10"
                              onClick={() => handlePinMessage(msg.id, msg.isPinned)}
                            >
                              <Pin className={`h-3 w-3 ${msg.isPinned ? 'fill-current' : ''}`} />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={scrollRef} />
              </div>
            </ScrollArea>

            {isUserTyping() && getTypingUser() && (
              <div className="px-4 py-2 border-t border-white/10 bg-white/5">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-current animate-pulse" />
                    <div className="w-2 h-2 rounded-full bg-current animate-pulse" style={{ animationDelay: '0.2s' }} />
                    <div className="w-2 h-2 rounded-full bg-current animate-pulse" style={{ animationDelay: '0.4s' }} />
                  </div>
                  <span className="italic">{getTypingUser()} is typing...</span>
                </div>
              </div>
            )}

            <div className="p-4 border-t border-white/10 bg-white/5 backdrop-blur-sm">
              <form onSubmit={handleSendMessage} className="relative flex items-end gap-2 p-2 rounded-2xl bg-white/5 border border-white/10 shadow-lg">
                <div className="flex-1 flex flex-col gap-2">
                  <div className="relative">
                    <Input
                      placeholder="Type a message..."
                      value={message}
                      onChange={(e) => handleTyping(e.target.value)}
                      className="pr-24 bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
                    />
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-white/10 text-muted-foreground hover:text-foreground"
                        onClick={handleFileAttach}
                      >
                        <Paperclip className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-white/10 text-muted-foreground hover:text-foreground"
                        onClick={handleFileAttach}
                      >
                        <ImageIcon className="h-4 w-4" />
                      </Button>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 hover:bg-white/10 text-muted-foreground hover:text-foreground"
                          >
                            <Smile className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-2 bg-background/95 backdrop-blur-xl border-white/10" align="end">
                          <div className="grid grid-cols-4 gap-1">
                            {emojis.map((emoji, i) => (
                              <Button
                                key={i}
                                variant="ghost"
                                size="icon"
                                className="h-10 w-10 text-xl hover:bg-white/10"
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
                <Button type="submit" size="icon" className="rounded-xl h-10 w-10 shadow-md">
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </div>
        ) : (
          <div className="hidden md:flex flex-1 items-center justify-center text-muted-foreground">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-white/5 flex items-center justify-center animate-pulse">
                <MessageSquare className="h-10 w-10 opacity-50" />
              </div>
              <p className="text-xl font-semibold mb-2">Select a conversation</p>
              <p className="text-sm text-muted-foreground/70">Choose a chat to start messaging</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

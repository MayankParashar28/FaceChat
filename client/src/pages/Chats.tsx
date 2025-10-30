import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Video, Settings, LogOut, LayoutDashboard, MessageSquare, Search, Send, Paperclip, Smile, MoreVertical, Phone, VideoIcon, Pin, Check, CheckCheck, Image as ImageIcon } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { io, Socket } from "socket.io-client";
import { useAuth } from "@/lib/auth";
import { auth } from "@/lib/firebase";
import { User as FirebaseUser } from "firebase/auth";
import { searchUsers } from "@/lib/utils";

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
};

export default function Chats() {
  const { user } = useAuth();
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [searchedUsers, setSearchedUsers] = useState<SearchedUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [newConversation, setNewConversation] = useState<Conversation | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setFirebaseUser(user);
    });
    return () => unsubscribe();
  }, []);

  const { data: conversations = [], refetch: refetchConversations } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
    queryFn: async () => {
      const res = await fetch(`/api/conversations?userId=${user?.uid}`);
      if (!res.ok) throw new Error("Failed to fetch conversations");
      return res.json();
    },
    enabled: !!user?.uid
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
      setMessages(prev => {
        const exists = prev.find(m => m.id === newMessage.id);
        if (exists) return prev;
        return [...prev, { ...newMessage, status: "delivered" }];
      });
      refetchConversations();
      
      if (newMessage.senderId !== user?.uid && selectedChat === newMessage.conversationId) {
        setTimeout(() => {
          newSocket.emit("message:seen", { messageId: newMessage.id, userId: user?.uid });
        }, 500);
      }
      
      setTimeout(() => scrollToBottom(), 100);
    });

    newSocket.on("message:status", ({ messageId, status }) => {
      setMessages(prev => prev.map(msg => 
        msg.id === messageId ? { ...msg, status } : msg
      ));
    });

    newSocket.on("message:pinned", ({ messageId, isPinned }) => {
      setMessages(prev => prev.map(msg => 
        msg.id === messageId ? { ...msg, isPinned } : msg
      ));
    });

    newSocket.on("user:typing", ({ userName }) => {
      setTypingUsers(prev => new Set(prev).add(userName));
      setTimeout(() => {
        setTypingUsers(prev => {
          const newSet = new Set(prev);
          newSet.delete(userName);
          return newSet;
        });
      }, 3000);
    });

    newSocket.on("user:stopped-typing", ({ userId }) => {
      setTypingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(userId);
        return newSet;
      });
    });

    newSocket.on("user:status", ({ userId, online }) => {
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
    if (selectedChat && socket && user?.uid) {
      // Join the conversation room
      socket.emit("join:conversation", selectedChat);
      
      // Mark all messages as read
      socket.emit("mark:read", { conversationId: selectedChat, userId: user.uid });
      
      fetch(`/api/conversations/${selectedChat}/messages?userId=${user.uid}`)
        .then(res => {
          if (!res.ok) throw new Error("Failed to fetch messages");
          return res.json();
        })
        .then((data: Message[]) => {
          // Ensure data is an array before mapping
          const messagesArray = Array.isArray(data) ? data : [];
          setMessages(messagesArray.map(msg => ({ ...msg, status: "seen" })));
          
          messagesArray.forEach(msg => {
            if (msg.senderId !== user?.uid) {
              socket.emit("message:seen", { messageId: msg.id, userId: user.uid });
            }
          });
          
          setTimeout(() => scrollToBottom(), 100);
        })
        .catch(error => {
          console.error("Error fetching messages:", error);
          setMessages([]);
        });
    }
  }, [selectedChat, socket, user?.uid]);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  const sidebarItems = [
    { title: "Dashboard", icon: LayoutDashboard, url: "/dashboard" },
    { title: "Chats", icon: MessageSquare, url: "/chats" },
    { title: "Settings", icon: Settings, url: "/settings" }
  ];

  const emojis = ["😊", "😂", "❤️", "👍", "🎉", "🔥", "✨", "👏"];

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && socket && selectedChat && user?.uid) {
      socket.emit("message:send", {
        conversationId: selectedChat,
        senderId: user.uid,
        content: message
      });
      setMessage("");
      
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      socket.emit("typing:stop", { conversationId: selectedChat, userId: user.uid });
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
    if (!user?.uid) return;
    
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participantIds: [user.uid, userId],
          createdBy: user.uid
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
      setSelectedChat(conversation.id);
      
      // Refetch conversations in the background
      refetchConversations();
    } catch (error) {
      console.error('Error creating conversation:', error);
    }
  };

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
    const otherUser = selectedConversation.participants.find(p => p.firebaseUid !== user?.uid);
    return otherUser && typingUsers.has(otherUser.firebaseUid || '');
  };

  const getTypingUser = () => {
    if (!selectedConversation) return null;
    const otherUser = selectedConversation.participants.find(p => p.firebaseUid !== user?.uid);
    if (otherUser && typingUsers.has(otherUser.firebaseUid || '')) {
      return otherUser.name;
    }
    return null;
  };

  const formatTime = (date: Date) => {
    const d = new Date(date);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <Sidebar>
          <SidebarContent className="p-4">
            <div className="flex items-center gap-2 px-2 mb-6">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Video className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="text-lg font-semibold">AI Meet</span>
            </div>

            <SidebarGroup>
              <SidebarGroupLabel>Menu</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {sidebarItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild className="hover-elevate">
                        <a href={item.url} data-testid={`link-${item.title.toLowerCase()}`}>
                          <item.icon className="w-4 h-4" />
                          <span>{item.title}</span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <div className="mt-auto pt-4 border-t">
              <div className="flex items-center gap-3 p-2 rounded-lg hover-elevate cursor-pointer">
              <Avatar className="h-9 w-9">
                  <AvatarImage src={user?.photoURL || (user?.displayName || user?.email) ? `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(user?.uid || user?.email || 'user')}` : ''} />
                  <AvatarFallback className="bg-primary text-primary-foreground">{user?.displayName?.charAt(0)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{firebaseUser?.displayName}</p>
                  <p className="text-xs text-muted-foreground truncate">{firebaseUser?.email}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-logout">
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </SidebarContent>
        </Sidebar>

        <div className="flex flex-col flex-1">
          <header className="flex items-center justify-between gap-4 p-4 border-b">
            <div className="flex items-center gap-2">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <h1 className="text-xl font-semibold">Messages</h1>
            </div>
            <ThemeToggle />
          </header>

          <div className="flex-1 flex overflow-hidden">
            <div className="w-80 border-r flex flex-col">
              <div className="p-4 border-b">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Search conversations..." 
                    className="pl-10" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    data-testid="input-search-conversations"
                  />
                </div>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-2">
                  {/* Show searched users first if search is active */}
                  {searchedUsers.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-muted-foreground px-3 py-2">Search Results</p>
                      {searchedUsers.map((searchedUser) => (
                        <div
                          key={searchedUser.id}
                          onClick={() => handleStartConversation(searchedUser.id)}
                          className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover-elevate mb-1"
                          data-testid={`search-user-${searchedUser.id}`}
                        >
                          <div className="relative">
                            <Avatar className="h-12 w-12">
                              {searchedUser.avatar && (
                                <AvatarImage src={searchedUser.avatar} alt={searchedUser.name} />
                              )}
                              <AvatarFallback className="bg-primary/10 text-primary">
                                {searchedUser.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            {/* Note: Search results don't have online status yet */}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{searchedUser.name}</p>
                            <p className="text-xs text-muted-foreground truncate">@{searchedUser.username}</p>
                          </div>
                          <Badge variant="outline" className="text-xs">New Chat</Badge>
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
                          onClick={() => setSelectedChat(conv.id)}
                          className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer hover-elevate mb-1 ${
                            selectedChat === conv.id ? 'bg-accent' : ''
                          }`}
                          data-testid={`conversation-${conv.id}`}
                        >
                          <div className="relative">
                            <Avatar className="h-12 w-12">
                              {!conv.isGroup && (conv.participants.find(p => p.firebaseUid !== user?.uid)?.avatar) && (
                                <AvatarImage src={(conv.participants.find(p => p.firebaseUid !== user?.uid) as any).avatar} alt={getConversationName(conv)} />
                              )}
                              <AvatarFallback className={conv.isGroup ? "bg-chart-2/10 text-chart-2" : "bg-primary/10 text-primary"}>
                                {getConversationAvatar(conv)}
                              </AvatarFallback>
                            </Avatar>
                            {isUserOnline(conv) && (
                              <div className="absolute bottom-0 right-0 w-3 h-3 bg-chart-3 border-2 border-background rounded-full" />
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
                              {conv.lastMessage?.content || "No messages yet"}
                            </p>
                          </div>
                          {conv.unreadCount > 0 && (
                            <Badge className="h-5 min-w-5 flex items-center justify-center px-1.5">
                              {conv.unreadCount}
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Show conversations when search is active and filtered */}
                  {filteredConversations.length > 0 && searchQuery && searchedUsers.length === 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold text-muted-foreground px-3 py-2">Existing Conversations</p>
                      {filteredConversations.map((conv) => (
                        <div
                          key={conv.id}
                          onClick={() => setSelectedChat(conv.id)}
                          className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer hover-elevate mb-1 ${
                            selectedChat === conv.id ? 'bg-accent' : ''
                          }`}
                          data-testid={`conversation-${conv.id}`}
                        >
                          <div className="relative">
                            <Avatar className="h-12 w-12">
                              <AvatarFallback className={conv.isGroup ? "bg-chart-2/10 text-chart-2" : "bg-primary/10 text-primary"}>
                                {getConversationAvatar(conv)}
                              </AvatarFallback>
                            </Avatar>
                            {isUserOnline(conv) && (
                              <div className="absolute bottom-0 right-0 w-3 h-3 bg-chart-3 border-2 border-background rounded-full" />
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
                              {conv.lastMessage?.content || "No messages yet"}
                            </p>
                          </div>
                          {conv.unreadCount > 0 && (
                            <Badge className="h-5 min-w-5 flex items-center justify-center px-1.5">
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

            {selectedChat && selectedConversation ? (
              <div className="flex-1 flex flex-col">
                <div className="p-4 border-b flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Avatar className="h-10 w-10">
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
                        <p className="text-xs text-chart-3 italic">{getTypingUser()} is typing...</p>
                      ) : !selectedConversation.isGroup && isUserOnline(selectedConversation) ? (
                        <p className="text-xs text-green-600">Online</p>
                      ) : !selectedConversation.isGroup ? (
                        <p className="text-xs text-muted-foreground">Offline</p>
                      ) : selectedConversation.isGroup ? (
                        <p className="text-xs text-muted-foreground">{selectedConversation.participants.length} members</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" data-testid="button-voice-call">
                      <Phone className="h-5 w-5" />
                    </Button>
                    <Button variant="ghost" size="icon" data-testid="button-video-call">
                      <VideoIcon className="h-5 w-5" />
                    </Button>
                    <Button variant="ghost" size="icon" data-testid="button-chat-options">
                      <MoreVertical className="h-5 w-5" />
                    </Button>
                  </div>
                </div>

                {pinnedMessages.length > 0 && (
                  <div className="px-4 py-2 bg-muted/50 border-b">
                    <div className="flex items-center gap-2 text-sm">
                      <Pin className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Pinned:</span>
                      <span className="truncate">{pinnedMessages[0].content}</span>
                    </div>
                  </div>
                )}

                <ScrollArea className="flex-1 p-4">
                  <div className="space-y-4">
                    {messages.map((msg) => {
                      const isMe = msg.senderId === user?.uid;
                      return (
                        <div
                          key={msg.id}
                          className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}
                          data-testid={`message-${msg.id}`}
                        >
                          {!isMe && (
                            <Avatar className="h-8 w-8">
                              {(selectedConversation.participants.find(p => p.id === msg.sender.id)?.avatar) && (
                                <AvatarImage src={(selectedConversation.participants.find(p => p.id === msg.sender.id) as any).avatar} alt={msg.sender.name} />
                              )}
                              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                {msg.sender.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                          )}
                          <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[70%]`}>
                            {!isMe && (
                              <span className="text-xs font-medium text-muted-foreground mb-1">{msg.sender.name}</span>
                            )}
                            <div className="group relative">
                              <div
                                className={`rounded-lg px-4 py-2 ${
                                  isMe
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted'
                                } ${msg.isPinned ? 'ring-2 ring-chart-2/50' : ''}`}
                              >
                                <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                              </div>
                              <div className="absolute top-0 right-0 -mr-8 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => handlePinMessage(msg.id, msg.isPinned)}
                                  data-testid={`button-pin-${msg.id}`}
                                >
                                  <Pin className={`h-3 w-3 ${msg.isPinned ? 'fill-current' : ''}`} />
                                </Button>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-muted-foreground">{formatTime(msg.createdAt)}</span>
                              {isMe && msg.status && (
                                <span className="text-xs text-muted-foreground">
                                  {msg.status === "sent" && <Check className="h-3 w-3" />}
                                  {msg.status === "delivered" && <CheckCheck className="h-3 w-3" />}
                                  {msg.status === "seen" && <CheckCheck className="h-3 w-3 text-primary" />}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={scrollRef} />
                  </div>
                </ScrollArea>

                {typingUsers.size > 0 && (
                  <div className="px-4 py-2 border-t bg-muted/30">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <div className="flex gap-1">
                        <div className="w-2 h-2 rounded-full bg-current animate-pulse" />
                        <div className="w-2 h-2 rounded-full bg-current animate-pulse" style={{ animationDelay: '0.2s' }} />
                        <div className="w-2 h-2 rounded-full bg-current animate-pulse" style={{ animationDelay: '0.4s' }} />
                      </div>
                      <span className="italic">{Array.from(typingUsers)[0]} is typing...</span>
                    </div>
                  </div>
                )}

                <form onSubmit={handleSendMessage} className="p-4 border-t">
                  <div className="flex items-end gap-2">
                    <div className="flex-1 flex flex-col gap-2">
                      <div className="relative">
                        <Input
                          placeholder="Type a message..."
                          value={message}
                          onChange={(e) => handleTyping(e.target.value)}
                          className="pr-24"
                          data-testid="input-message"
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={handleFileAttach}
                            data-testid="button-attach-file"
                          >
                            <Paperclip className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={handleFileAttach}
                            data-testid="button-attach-image"
                          >
                            <ImageIcon className="h-4 w-4" />
                          </Button>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                data-testid="button-emoji-picker"
                              >
                                <Smile className="h-4 w-4" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-2" align="end">
                              <div className="grid grid-cols-4 gap-1">
                                {emojis.map((emoji, i) => (
                                  <Button
                                    key={i}
                                    variant="ghost"
                                    size="icon"
                                    className="h-10 w-10 text-xl"
                                    onClick={() => handleEmojiSelect(emoji)}
                                    data-testid={`emoji-${i}`}
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
                    <Button type="submit" size="icon" data-testid="button-send-message">
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <MessageSquare className="h-16 w-16 mx-auto mb-4 opacity-20" />
                  <p className="text-lg font-medium">Select a conversation</p>
                  <p className="text-sm">Choose a chat to start messaging</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}

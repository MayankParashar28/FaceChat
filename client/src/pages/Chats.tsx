import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Video, Settings, LogOut, LayoutDashboard, MessageSquare, Search, Send, Paperclip, Smile, MoreVertical, Phone, VideoIcon, Pin, Check, CheckCheck, Image as ImageIcon } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { io, Socket } from "socket.io-client";

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
    name: string;
    username: string;
    online: boolean;
  }>;
  lastMessage?: Message;
  unreadCount: number;
};

const currentUserId = "7ca9cd11-37fb-4546-8199-0b273e13d225"; // TODO: Get from auth context

export default function Chats() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const typingTimeoutRef = useRef<NodeJS.Timeout>();
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: conversations = [], refetch: refetchConversations } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
    queryFn: async () => {
      const res = await fetch(`/api/conversations?userId=${currentUserId}`);
      if (!res.ok) throw new Error("Failed to fetch conversations");
      return res.json();
    }
  });

  useEffect(() => {
    const newSocket = io(window.location.origin, {
      transports: ['websocket', 'polling']
    });

    newSocket.on("connect", () => {
      console.log("WebSocket connected");
      newSocket.emit("user:online", currentUserId);
    });

    newSocket.on("message:new", (newMessage: Message) => {
      setMessages(prev => {
        const exists = prev.find(m => m.id === newMessage.id);
        if (exists) return prev;
        return [...prev, { ...newMessage, status: "delivered" }];
      });
      refetchConversations();
      
      if (newMessage.senderId !== currentUserId && selectedChat === newMessage.conversationId) {
        setTimeout(() => {
          newSocket.emit("message:seen", { messageId: newMessage.id, userId: currentUserId });
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

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [refetchConversations]);

  useEffect(() => {
    if (selectedChat && socket) {
      fetch(`/api/conversations/${selectedChat}/messages?userId=${currentUserId}`)
        .then(res => res.json())
        .then((data: Message[]) => {
          setMessages(data.map(msg => ({ ...msg, status: "seen" })));
          
          data.forEach(msg => {
            if (msg.senderId !== currentUserId) {
              socket.emit("message:seen", { messageId: msg.id, userId: currentUserId });
            }
          });
          
          setTimeout(() => scrollToBottom(), 100);
        });
    }
  }, [selectedChat, socket]);

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
    if (message.trim() && socket && selectedChat) {
      socket.emit("message:send", {
        conversationId: selectedChat,
        senderId: currentUserId,
        content: message
      });
      setMessage("");
      
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      socket.emit("typing:stop", { conversationId: selectedChat, userId: currentUserId });
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

  const handleTyping = (value: string) => {
    setMessage(value);
    
    if (socket && selectedChat && value) {
      socket.emit("typing:start", { 
        conversationId: selectedChat, 
        userId: currentUserId,
        userName: "You"
      });

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit("typing:stop", { conversationId: selectedChat, userId: currentUserId });
      }, 2000);
    }
  };

  const filteredConversations = conversations.filter(conv => {
    const displayName = conv.isGroup 
      ? (conv.name || "Group Chat")
      : (conv.participants.find(p => p.id !== currentUserId)?.name || "Unknown");
    return displayName.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const selectedConversation = conversations.find(c => c.id === selectedChat);
  const pinnedMessages = messages.filter(m => m.isPinned);

  const getConversationName = (conv: Conversation) => {
    if (conv.isGroup) return conv.name || "Group Chat";
    const otherUser = conv.participants.find(p => p.id !== currentUserId);
    return otherUser?.name || "Unknown";
  };

  const getConversationAvatar = (conv: Conversation) => {
    if (conv.isGroup) return conv.name?.substring(0, 2).toUpperCase() || "GC";
    const otherUser = conv.participants.find(p => p.id !== currentUserId);
    return otherUser?.name.split(' ').map(n => n[0]).join('').toUpperCase() || "??";
  };

  const isUserOnline = (conv: Conversation) => {
    if (conv.isGroup) return false;
    const otherUser = conv.participants.find(p => p.id !== currentUserId);
    return otherUser?.online || false;
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
                  <AvatarFallback className="bg-primary text-primary-foreground">JD</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">John Doe</p>
                  <p className="text-xs text-muted-foreground truncate">john@example.com</p>
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
              </ScrollArea>
            </div>

            {selectedChat && selectedConversation ? (
              <div className="flex-1 flex flex-col">
                <div className="p-4 border-b flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className={selectedConversation.isGroup ? "bg-chart-2/10 text-chart-2" : "bg-primary/10 text-primary"}>
                        {getConversationAvatar(selectedConversation)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold">{getConversationName(selectedConversation)}</p>
                      {!selectedConversation.isGroup && isUserOnline(selectedConversation) && (
                        <p className="text-xs text-chart-3">Online</p>
                      )}
                      {selectedConversation.isGroup && (
                        <p className="text-xs text-muted-foreground">{selectedConversation.participants.length} members</p>
                      )}
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
                      const isMe = msg.senderId === currentUserId;
                      return (
                        <div
                          key={msg.id}
                          className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}
                          data-testid={`message-${msg.id}`}
                        >
                          {!isMe && (
                            <Avatar className="h-8 w-8">
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
                  <div className="px-4 py-2 text-sm text-muted-foreground">
                    {Array.from(typingUsers)[0]} is typing...
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

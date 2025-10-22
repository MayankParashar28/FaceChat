import { useState } from "react";
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

type Message = {
  id: string;
  sender: string;
  content: string;
  time: string;
  isMe: boolean;
  status: "sent" | "delivered" | "seen";
  isPinned?: boolean;
};

type Conversation = {
  id: string;
  name: string;
  lastMessage: string;
  time: string;
  unread: number;
  avatar: string;
  online: boolean;
  isGroup: boolean;
};

export default function Chats() {
  const [selectedChat, setSelectedChat] = useState<string | null>("1");
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  const conversations: Conversation[] = [
    { id: "1", name: "Sarah Johnson", lastMessage: "See you in the meeting!", time: "2m ago", unread: 2, avatar: "SJ", online: true, isGroup: false },
    { id: "2", name: "Team Standup", lastMessage: "Mike: Thanks everyone", time: "1h ago", unread: 0, avatar: "TS", online: false, isGroup: true },
    { id: "3", name: "Mike Chen", lastMessage: "Can you review the PR?", time: "3h ago", unread: 1, avatar: "MC", online: true, isGroup: false },
    { id: "4", name: "Project Alpha", lastMessage: "Alex: Updated the timeline", time: "Yesterday", unread: 0, avatar: "PA", online: false, isGroup: true },
    { id: "5", name: "Alex Rivera", lastMessage: "You: Sounds good!", time: "2d ago", unread: 0, avatar: "AR", online: false, isGroup: false }
  ];

  const [messages, setMessages] = useState<Message[]>([
    { id: "1", sender: "Sarah Johnson", content: "Hey! How are you doing?", time: "10:30 AM", isMe: false, status: "seen" },
    { id: "2", sender: "You", content: "I'm great! Just finished the presentation.", time: "10:32 AM", isMe: true, status: "seen" },
    { id: "3", sender: "Sarah Johnson", content: "Awesome! Can you share the slides with the team?", time: "10:33 AM", isMe: false, status: "seen", isPinned: true },
    { id: "4", sender: "You", content: "Sure, I'll send them over right now.", time: "10:35 AM", isMe: true, status: "delivered" },
    { id: "5", sender: "Sarah Johnson", content: "See you in the meeting!", time: "10:37 AM", isMe: false, status: "seen" }
  ]);

  const sidebarItems = [
    { title: "Dashboard", icon: LayoutDashboard, url: "/dashboard" },
    { title: "Chats", icon: MessageSquare, url: "/chats" },
    { title: "Settings", icon: Settings, url: "/settings" }
  ];

  const emojis = ["😊", "😂", "❤️", "👍", "🎉", "🔥", "✨", "👏"];

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      const newMessage: Message = {
        id: String(messages.length + 1),
        sender: "You",
        content: message,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isMe: true,
        status: "sent"
      };
      setMessages([...messages, newMessage]);
      setMessage("");
      console.log("Message sent:", message);
      
      setTimeout(() => {
        setMessages(prev => prev.map(msg => 
          msg.id === newMessage.id ? { ...msg, status: "delivered" } : msg
        ));
      }, 1000);
      
      setTimeout(() => {
        setMessages(prev => prev.map(msg => 
          msg.id === newMessage.id ? { ...msg, status: "seen" } : msg
        ));
      }, 2000);
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    setMessage(message + emoji);
  };

  const handlePinMessage = (messageId: string) => {
    setMessages(messages.map(msg => 
      msg.id === messageId ? { ...msg, isPinned: !msg.isPinned } : msg
    ));
    console.log("Toggled pin for message:", messageId);
  };

  const handleFileAttach = () => {
    console.log("File attachment clicked");
  };

  const handleTyping = (value: string) => {
    setMessage(value);
    if (!isTyping && value) {
      setIsTyping(true);
      console.log("User started typing");
      setTimeout(() => setIsTyping(false), 3000);
    }
  };

  const filteredConversations = conversations.filter(conv =>
    conv.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedConversation = conversations.find(c => c.id === selectedChat);
  const pinnedMessages = messages.filter(m => m.isPinned);

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
                            {conv.avatar}
                          </AvatarFallback>
                        </Avatar>
                        {conv.online && !conv.isGroup && (
                          <div className="absolute bottom-0 right-0 w-3 h-3 bg-chart-3 border-2 border-background rounded-full" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className="font-medium text-sm truncate">{conv.name}</p>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{conv.time}</span>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{conv.lastMessage}</p>
                      </div>
                      {conv.unread > 0 && (
                        <Badge className="h-5 min-w-5 flex items-center justify-center px-1.5">
                          {conv.unread}
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
                        {selectedConversation.avatar}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold">{selectedConversation.name}</p>
                      {!selectedConversation.isGroup && selectedConversation.online && (
                        <p className="text-xs text-chart-3">Online</p>
                      )}
                      {selectedConversation.isGroup && (
                        <p className="text-xs text-muted-foreground">3 members</p>
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
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex gap-3 ${msg.isMe ? 'flex-row-reverse' : ''}`}
                        data-testid={`message-${msg.id}`}
                      >
                        {!msg.isMe && (
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">
                              {msg.sender.split(' ').map(n => n[0]).join('')}
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <div className={`flex flex-col ${msg.isMe ? 'items-end' : 'items-start'} max-w-[70%]`}>
                          {!msg.isMe && (
                            <span className="text-xs font-medium text-muted-foreground mb-1">{msg.sender}</span>
                          )}
                          <div className="group relative">
                            <div
                              className={`rounded-lg px-4 py-2 ${
                                msg.isMe
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
                                onClick={() => handlePinMessage(msg.id)}
                                data-testid={`button-pin-${msg.id}`}
                              >
                                <Pin className={`h-3 w-3 ${msg.isPinned ? 'fill-current' : ''}`} />
                              </Button>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-muted-foreground">{msg.time}</span>
                            {msg.isMe && (
                              <span className="text-xs text-muted-foreground">
                                {msg.status === "sent" && <Check className="h-3 w-3" />}
                                {msg.status === "delivered" && <CheckCheck className="h-3 w-3" />}
                                {msg.status === "seen" && <CheckCheck className="h-3 w-3 text-primary" />}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                {isTyping && (
                  <div className="px-4 py-2 text-sm text-muted-foreground">
                    {selectedConversation.name} is typing...
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

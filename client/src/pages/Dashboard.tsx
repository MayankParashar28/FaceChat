import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Video, Plus, Users, Clock, Settings, LogOut, LayoutDashboard, MessageSquare, Search, Loader2 } from "lucide-react";
import { LogoMark } from "@/components/LogoMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth";
import { getAvatarUrl, getInitials } from "@/lib/utils";
import { getQueryFn } from "@/lib/queryClient";

interface Meeting {
  _id: string;
  title: string;
  participants: string[] | { _id: string; name: string }[];
  startTime: string | Date;
  endTime?: string | Date;
  analytics?: {
    emotionData?: {
      emotion: string;
      percentage: number;
    }[];
  };
}

// Format time ago (e.g., "2 hours ago", "Yesterday", "3 days ago")
function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months} month${months > 1 ? 's' : ''} ago`;
  }
  const years = Math.floor(diffDays / 365);
  return `${years} year${years > 1 ? 's' : ''} ago`;
}

// Calculate duration in minutes
function calculateDuration(startTime: Date, endTime?: Date): string {
  if (!endTime) {
    const duration = Math.floor((new Date().getTime() - startTime.getTime()) / (1000 * 60));
    return `${duration}m`;
  }
  const duration = Math.floor((endTime.getTime() - startTime.getTime()) / (1000 * 60));
  if (duration < 60) return `${duration}m`;
  const hours = Math.floor(duration / 60);
  const mins = duration % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// Get emotion from analytics or return default
function getEmotion(meeting: Meeting): string {
  if (meeting.analytics?.emotionData && meeting.analytics.emotionData.length > 0) {
    // Get the emotion with highest percentage
    const topEmotion = meeting.analytics.emotionData.reduce((prev, current) =>
      (prev.percentage > current.percentage) ? prev : current
    );
    return topEmotion.emotion;
  }
  return "Completed";
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const [roomId, setRoomId] = useState("");

  // Fetch user's recent meetings
  const { data: meetings, isLoading: meetingsLoading } = useQuery<Meeting[]>({
    queryKey: ["/api/meetings?limit=10"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!user, // Only fetch when user is logged in
    refetchOnWindowFocus: false,
  });

  const createCall = () => {
    // Generate a random room ID
    const newRoomId = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    setLocation(`/call/${newRoomId}`);
  };

  const joinCall = () => {
    if (roomId.trim()) {
      setLocation(`/call/${roomId.trim()}`);
    }
  };

  const sidebarItems = [
    { title: "Dashboard", icon: LayoutDashboard, url: "/dashboard" },
    { title: "Chats", icon: MessageSquare, url: "/chats" },
    { title: "Settings", icon: Settings, url: "/settings" }
  ];

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
              <LogoMark className="h-8 w-8" />
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
                  <AvatarImage
                    src={getAvatarUrl(user?.photoURL, user?.uid, user?.email)}
                    alt={user?.displayName || user?.email || "User avatar"}
                  />
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {getInitials(user?.displayName, user?.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user?.displayName || "User"}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8" 
                  onClick={logout}
                  data-testid="button-logout"
                >
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
              <div className="relative hidden sm:block w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Search calls, contacts..." 
                  className="pl-10" 
                  data-testid="input-search"
                />
              </div>
            </div>
            <ThemeToggle />
          </header>

          <main className="flex-1 overflow-auto p-6">
            <div className="max-w-6xl mx-auto space-y-8">
              <div>
                <h1 className="text-3xl font-bold mb-2">Welcome back, {user?.displayName}</h1>
                <p className="text-muted-foreground">Ready to connect with your team?</p>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <Card className="hover-elevate">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Plus className="w-5 h-5" />
                      Create New Call
                    </CardTitle>
                    <CardDescription>
                      Start an instant video call with AI-powered features
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button onClick={createCall} className="w-full" data-testid="button-create-call">
                      <Video className="w-4 h-4 mr-2" />
                      Start Video Call
                    </Button>
                  </CardContent>
                </Card>

                <Card className="hover-elevate">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-5 h-5" />
                      Join Call
                    </CardTitle>
                    <CardDescription>
                      Enter a room ID to join an existing call
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Input 
                      placeholder="Enter room ID" 
                      value={roomId}
                      onChange={(e) => setRoomId(e.target.value)}
                      data-testid="input-room-id"
                    />
                    <Button onClick={joinCall} variant="outline" className="w-full" data-testid="button-join-call">
                      Join Room
                    </Button>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="w-5 h-5" />
                    Recent Calls
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {meetingsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      <span className="ml-2 text-muted-foreground">Loading meetings...</span>
                    </div>
                  ) : !meetings || meetings.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Video className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p className="text-sm">No recent calls yet</p>
                      <p className="text-xs mt-1">Start or join a call to see it here</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {meetings.map((meeting) => {
                        const participantCount = Array.isArray(meeting.participants) 
                          ? meeting.participants.length 
                          : 0;
                        const startTime = new Date(meeting.startTime);
                        const endTime = meeting.endTime ? new Date(meeting.endTime) : undefined;
                        const duration = calculateDuration(startTime, endTime);
                        const timeAgo = endTime ? formatTimeAgo(endTime) : formatTimeAgo(startTime);
                        const emotion = getEmotion(meeting);

                        return (
                          <div 
                            key={meeting._id} 
                            className="flex items-center justify-between p-4 rounded-lg border hover-elevate cursor-pointer"
                            onClick={() => setLocation(`/summary/${meeting._id}`)}
                            data-testid={`call-item-${meeting._id}`}
                          >
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                <Video className="w-5 h-5 text-primary" />
                              </div>
                              <div>
                                <p className="font-medium">{meeting.title || "Untitled Call"}</p>
                                <p className="text-sm text-muted-foreground">
                                  {participantCount} participant{participantCount !== 1 ? 's' : ''} • {duration} • {timeAgo}
                                </p>
                              </div>
                            </div>
                            <Badge variant="secondary">{emotion}</Badge>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

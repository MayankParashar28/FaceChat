import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Video, Plus, Users, Clock, Settings, LogOut, LayoutDashboard, MessageSquare, Search } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const [roomId, setRoomId] = useState("");

  const recentCalls = [
    { id: "1", title: "Team Standup", participants: 5, duration: "24m", time: "2 hours ago", emotion: "Positive" },
    { id: "2", title: "Client Meeting", participants: 3, duration: "45m", time: "Yesterday", emotion: "Engaged" },
    { id: "3", title: "1-on-1 with Sarah", participants: 2, duration: "18m", time: "2 days ago", emotion: "Focused" }
  ];

  const createCall = () => {
    const newRoomId = Math.random().toString(36).substring(2, 10);
    console.log("Created room:", newRoomId);
    setLocation(`/call/${newRoomId}`);
  };

  const joinCall = () => {
    if (roomId.trim()) {
      console.log("Joining room:", roomId);
      setLocation(`/call/${roomId}`);
    }
  };

  const sidebarItems = [
    { title: "Dashboard", icon: LayoutDashboard, url: "/dashboard" },
    { title: "Chats", icon: MessageSquare, url: "/dashboard" },
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
                  <AvatarImage src="" />
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
                <h1 className="text-3xl font-bold mb-2">Welcome back, John</h1>
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
                  <div className="space-y-4">
                    {recentCalls.map((call) => (
                      <div 
                        key={call.id} 
                        className="flex items-center justify-between p-4 rounded-lg border hover-elevate cursor-pointer"
                        onClick={() => setLocation(`/summary/${call.id}`)}
                        data-testid={`call-item-${call.id}`}
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Video className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium">{call.title}</p>
                            <p className="text-sm text-muted-foreground">
                              {call.participants} participants • {call.duration} • {call.time}
                            </p>
                          </div>
                        </div>
                        <Badge variant="secondary">{call.emotion}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Settings as SettingsIcon, LogOut, LayoutDashboard, MessageSquare, Camera, Mic, Monitor, Palette } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/lib/auth";
import { LogoMark } from "@/components/LogoMark";

export default function Settings() {
  const [, setLocation] = useLocation();
  const { theme } = useTheme();
  const { user, logout } = useAuth();
  const [autoJoinAudio, setAutoJoinAudio] = useState(true);
  const [autoJoinVideo, setAutoJoinVideo] = useState(true);
  const [backgroundBlur, setBackgroundBlur] = useState(false);
  const [emotionDetection, setEmotionDetection] = useState(true);
  const [videoQuality, setVideoQuality] = useState("hd");
  const [audioQuality, setAudioQuality] = useState("high");

  const sidebarItems = [
    { title: "Dashboard", icon: LayoutDashboard, url: "/dashboard" },
    { title: "Chats", icon: MessageSquare, url: "/chats" },
    { title: "Settings", icon: SettingsIcon, url: "/settings" }
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
              <Button 
                variant="ghost" 
                className="w-full justify-start gap-2"
                onClick={logout}
                data-testid="button-logout"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </Button>
            </div>
          </SidebarContent>
        </Sidebar>

        <div className="flex flex-col flex-1">
          <header className="flex items-center justify-between gap-4 p-4 border-b">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>

          <main className="flex-1 overflow-auto p-6">
            <div className="max-w-4xl mx-auto space-y-6">
              <div>
                <h1 className="text-3xl font-bold mb-2">Settings</h1>
                <p className="text-muted-foreground">Manage your camera, microphone, and call preferences</p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Camera className="w-5 h-5" />
                    Video Settings
                  </CardTitle>
                  <CardDescription>Configure your camera and video quality preferences</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="auto-video">Auto-join with video</Label>
                      <p className="text-sm text-muted-foreground">Automatically turn on camera when joining calls</p>
                    </div>
                    <Switch 
                      id="auto-video" 
                      checked={autoJoinVideo}
                      onCheckedChange={setAutoJoinVideo}
                      data-testid="switch-auto-video"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="blur">Background blur</Label>
                      <p className="text-sm text-muted-foreground">Apply blur effect to your background</p>
                    </div>
                    <Switch 
                      id="blur" 
                      checked={backgroundBlur}
                      onCheckedChange={setBackgroundBlur}
                      data-testid="switch-background-blur"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="video-quality">Video Quality</Label>
                    <Select value={videoQuality} onValueChange={setVideoQuality}>
                      <SelectTrigger id="video-quality" data-testid="select-video-quality">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sd">Standard Definition (480p)</SelectItem>
                        <SelectItem value="hd">High Definition (720p)</SelectItem>
                        <SelectItem value="full-hd">Full HD (1080p)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mic className="w-5 h-5" />
                    Audio Settings
                  </CardTitle>
                  <CardDescription>Configure your microphone and audio quality</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="auto-audio">Auto-join with audio</Label>
                      <p className="text-sm text-muted-foreground">Automatically unmute when joining calls</p>
                    </div>
                    <Switch 
                      id="auto-audio" 
                      checked={autoJoinAudio}
                      onCheckedChange={setAutoJoinAudio}
                      data-testid="switch-auto-audio"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="audio-quality">Audio Quality</Label>
                    <Select value={audioQuality} onValueChange={setAudioQuality}>
                      <SelectTrigger id="audio-quality" data-testid="select-audio-quality">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Standard</SelectItem>
                        <SelectItem value="high">High Quality</SelectItem>
                        <SelectItem value="studio">Studio Quality</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Monitor className="w-5 h-5" />
                    AI Features
                  </CardTitle>
                  <CardDescription>Configure AI-powered features</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="emotion">Emotion Detection</Label>
                      <p className="text-sm text-muted-foreground">Real-time emotion analysis during calls</p>
                    </div>
                    <Switch 
                      id="emotion" 
                      checked={emotionDetection}
                      onCheckedChange={setEmotionDetection}
                      data-testid="switch-emotion-detection"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Palette className="w-5 h-5" />
                    Appearance
                  </CardTitle>
                  <CardDescription>Customize the look and feel</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Theme</Label>
                      <p className="text-sm text-muted-foreground">Currently using {theme} mode</p>
                    </div>
                    <ThemeToggle />
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

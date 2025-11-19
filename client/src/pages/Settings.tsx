import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Settings as SettingsIcon, LogOut, LayoutDashboard, MessageSquare, User, Camera, Mic, Monitor, Palette, ChevronRight, Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/lib/auth";
import { LogoMark } from "@/components/LogoMark";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarUrl, getInitials } from "@/lib/utils";
import { motion } from "framer-motion";

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
    { title: "Profile", icon: User, url: "/profile" },
    { title: "Settings", icon: SettingsIcon, url: "/settings" }
  ];

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: {
        type: "spring",
        stiffness: 100,
        damping: 15
      }
    }
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full bg-background/95 backdrop-blur-3xl overflow-hidden">
        {/* Background Gradients */}
        <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/10 blur-[100px] animate-pulse-glow" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-500/10 blur-[100px] animate-pulse-glow animation-delay-500" />
        </div>

        <Sidebar className="border-r border-white/10 bg-white/5 backdrop-blur-xl">
          <SidebarContent className="p-6">
            <div className="flex items-center gap-3 px-2 mb-10">
              <div className="relative">
                <div className="absolute inset-0 bg-primary/20 blur-md rounded-full" />
                <LogoMark className="h-8 w-8 relative z-10" />
              </div>
              <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
                FaceCall
              </span>
            </div>

            <SidebarGroup>
              <SidebarGroupLabel className="text-xs uppercase tracking-widest text-muted-foreground/70 mb-4">Menu</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="space-y-2">
                  {sidebarItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild className="hover:bg-white/10 transition-colors rounded-xl p-3">
                        <a href={item.url} className="flex items-center gap-3">
                          <item.icon className="w-5 h-5 opacity-70" />
                          <span className="font-medium">{item.title}</span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <div className="mt-auto pt-6 border-t border-white/10">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors cursor-pointer group">
                <Avatar className="h-10 w-10 border-2 border-primary/20 group-hover:border-primary/50 transition-colors">
                  <AvatarImage src={getAvatarUrl(user?.photoURL, user?.uid, user?.email)} />
                  <AvatarFallback>{getInitials(user?.displayName, user?.email)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{user?.displayName || "User"}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity" onClick={logout}>
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </SidebarContent>
        </Sidebar>

        <div className="flex flex-col flex-1 h-full overflow-hidden relative">
          <header className="flex items-center justify-between gap-4 p-6 border-b border-white/5 bg-white/5 backdrop-blur-sm z-10">
            <div className="flex items-center gap-4">
              <SidebarTrigger />
              <h1 className="text-xl font-semibold">Settings</h1>
            </div>
            <ThemeToggle />
          </header>

          <main className="flex-1 overflow-auto p-6 md:p-10">
            <motion.div
              className="max-w-4xl mx-auto space-y-8"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              <motion.div variants={itemVariants}>
                <h1 className="text-4xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">Preferences</h1>
                <p className="text-lg text-muted-foreground">Manage your camera, microphone, and call experience.</p>
              </motion.div>

              <motion.div variants={itemVariants} className="grid gap-6">
                {/* Video Settings */}
                <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md overflow-hidden">
                  <div className="p-6 border-b border-white/10 bg-white/5">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500">
                        <Camera className="w-6 h-6" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold">Video Settings</h2>
                        <p className="text-sm text-muted-foreground">Configure your camera and visual preferences</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-6 space-y-6">
                    <div className="flex items-center justify-between group">
                      <div className="space-y-1">
                        <Label htmlFor="auto-video" className="text-base font-medium group-hover:text-primary transition-colors">Auto-join with video</Label>
                        <p className="text-sm text-muted-foreground">Automatically turn on camera when joining calls</p>
                      </div>
                      <Switch
                        id="auto-video"
                        checked={autoJoinVideo}
                        onCheckedChange={setAutoJoinVideo}
                        className="data-[state=checked]:bg-blue-500"
                      />
                    </div>

                    <div className="flex items-center justify-between group">
                      <div className="space-y-1">
                        <Label htmlFor="blur" className="text-base font-medium group-hover:text-primary transition-colors">Background blur</Label>
                        <p className="text-sm text-muted-foreground">Apply a subtle blur effect to your background</p>
                      </div>
                      <Switch
                        id="blur"
                        checked={backgroundBlur}
                        onCheckedChange={setBackgroundBlur}
                        className="data-[state=checked]:bg-blue-500"
                      />
                    </div>

                    <div className="space-y-3 pt-2">
                      <Label htmlFor="video-quality" className="text-base font-medium">Video Quality</Label>
                      <Select value={videoQuality} onValueChange={setVideoQuality}>
                        <SelectTrigger id="video-quality" className="h-12 bg-white/5 border-white/10 focus:ring-blue-500/20 rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-background/95 backdrop-blur-xl border-white/10">
                          <SelectItem value="sd">Standard Definition (480p)</SelectItem>
                          <SelectItem value="hd">High Definition (720p)</SelectItem>
                          <SelectItem value="full-hd">Full HD (1080p)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Audio Settings */}
                <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md overflow-hidden">
                  <div className="p-6 border-b border-white/10 bg-white/5">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500">
                        <Mic className="w-6 h-6" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold">Audio Settings</h2>
                        <p className="text-sm text-muted-foreground">Configure your microphone and sound</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-6 space-y-6">
                    <div className="flex items-center justify-between group">
                      <div className="space-y-1">
                        <Label htmlFor="auto-audio" className="text-base font-medium group-hover:text-primary transition-colors">Auto-join with audio</Label>
                        <p className="text-sm text-muted-foreground">Automatically unmute when joining calls</p>
                      </div>
                      <Switch
                        id="auto-audio"
                        checked={autoJoinAudio}
                        onCheckedChange={setAutoJoinAudio}
                        className="data-[state=checked]:bg-emerald-500"
                      />
                    </div>

                    <div className="space-y-3 pt-2">
                      <Label htmlFor="audio-quality" className="text-base font-medium">Audio Quality</Label>
                      <Select value={audioQuality} onValueChange={setAudioQuality}>
                        <SelectTrigger id="audio-quality" className="h-12 bg-white/5 border-white/10 focus:ring-emerald-500/20 rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-background/95 backdrop-blur-xl border-white/10">
                          <SelectItem value="standard">Standard</SelectItem>
                          <SelectItem value="high">High Quality</SelectItem>
                          <SelectItem value="studio">Studio Quality</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* AI Features */}
                <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md overflow-hidden">
                  <div className="p-6 border-b border-white/10 bg-white/5">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-purple-500/10 text-purple-500">
                        <Sparkles className="w-6 h-6" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold">AI Features</h2>
                        <p className="text-sm text-muted-foreground">Smart capabilities powered by FaceCall AI</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-6 space-y-6">
                    <div className="flex items-center justify-between group">
                      <div className="space-y-1">
                        <Label htmlFor="emotion" className="text-base font-medium group-hover:text-primary transition-colors">Emotion Detection</Label>
                        <p className="text-sm text-muted-foreground">Real-time emotion analysis during calls</p>
                      </div>
                      <Switch
                        id="emotion"
                        checked={emotionDetection}
                        onCheckedChange={setEmotionDetection}
                        className="data-[state=checked]:bg-purple-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Appearance */}
                <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md overflow-hidden">
                  <div className="p-6 border-b border-white/10 bg-white/5">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-orange-500/10 text-orange-500">
                        <Palette className="w-6 h-6" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold">Appearance</h2>
                        <p className="text-sm text-muted-foreground">Customize the look and feel</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-6">
                    <div className="flex items-center justify-between group">
                      <div className="space-y-1">
                        <Label className="text-base font-medium group-hover:text-primary transition-colors">Theme</Label>
                        <p className="text-sm text-muted-foreground">Currently using <span className="capitalize font-medium text-foreground">{theme}</span> mode</p>
                      </div>
                      <ThemeToggle />
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Video,
  Plus,
  Users,
  Clock,
  Settings,
  LogOut,
  LayoutDashboard,
  MessageSquare,
  Search,
  Loader2,
  RefreshCw,
  User,
  CalendarPlus,
  Sparkles,
  Activity,
  ArrowUpRight,
  Zap,
  BarChart3,
  Calendar
} from "lucide-react";
import { LogoMark } from "@/components/LogoMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth";
import { getAvatarUrl, getInitials } from "@/lib/utils";
import { getQueryFn } from "@/lib/queryClient";
import { auth } from "@/lib/firebase";

// --- Types ---
interface UserProfile {
  _id: string;
  name: string;
  username: string;
  email: string;
  avatar?: string;
}

type MeetingParticipant = string | { _id?: string; name?: string; email?: string };

interface UserMeeting {
  _id: string;
  hostId: string | { _id?: string; name?: string; email?: string };
  participants: MeetingParticipant[];
  startTime: string;
}

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

// --- Helper Functions ---
function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  return `${diffDays}d ago`;
}

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

function getDurationMinutes(startTime: Date, endTime?: Date): number {
  if (!startTime) return 0;
  const end = endTime || new Date();
  return Math.max(1, Math.floor((end.getTime() - startTime.getTime()) / (1000 * 60)));
}

function getEmotion(meeting: Meeting): string {
  if (meeting.analytics?.emotionData && meeting.analytics.emotionData.length > 0) {
    const topEmotion = meeting.analytics.emotionData.reduce((prev, current) =>
      (prev.percentage > current.percentage) ? prev : current
    );
    return topEmotion.emotion;
  }
  return "Completed";
}

// --- Components ---

const StatCard = ({ icon: Icon, label, value, trend, delay }: { icon: any, label: string, value: string | number, trend?: string, delay: number }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.4 }}
    className="glass-card p-4 rounded-xl relative overflow-hidden group"
  >
    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
      <Icon className="w-16 h-16" />
    </div>
    <div className="relative z-10">
      <div className="flex items-center gap-2 mb-1 text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold text-foreground">{value}</span>
        {trend && <span className="text-xs text-emerald-500 mb-1">{trend}</span>}
      </div>
    </div>
  </motion.div>
);

const ActionButton = ({ icon: Icon, label, onClick, variant = "primary", delay }: { icon: any, label: string, onClick: () => void, variant?: "primary" | "secondary", delay: number }) => (
  <motion.button
    initial={{ opacity: 0, scale: 0.9 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ delay, duration: 0.3 }}
    whileHover={{ scale: 1.02 }}
    whileTap={{ scale: 0.98 }}
    onClick={onClick}
    className={`
      relative overflow-hidden rounded-xl p-3 flex flex-col items-center justify-center gap-2 w-full h-24 transition-all
      ${variant === "primary"
        ? "bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/20"
        : "bg-card hover:bg-accent/50 border border-border/50 text-card-foreground"}
    `}
  >
    <div className={`p-3 rounded-full ${variant === "primary" ? "bg-white/20" : "bg-primary/10"}`}>
      <Icon className={`w-6 h-6 ${variant === "primary" ? "text-white" : "text-primary"}`} />
    </div>
    <span className="font-medium text-sm">{label}</span>
    {variant === "primary" && (
      <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/10 to-white/0 opacity-0 hover:opacity-100 transition-opacity duration-500" />
    )}
  </motion.button>
);

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const [roomId, setRoomId] = useState("");
  const queryClient = useQueryClient();

  const { data: profileData } = useQuery<UserProfile>({
    queryKey: ["/api/users/me"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!user?.uid,
    staleTime: 30000,
  });

  const { data: meetings, isLoading: meetingsLoading, refetch } = useQuery<Meeting[]>({
    queryKey: ["/api/meetings?limit=10"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!user,
    refetchOnWindowFocus: true,
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const {
    data: userMeetings,
    isLoading: userMeetingsLoading,
    isFetching: userMeetingsFetching,
    refetch: refetchUserMeetings,
  } = useQuery<UserMeeting[]>({
    queryKey: ["user-meetings", profileData?._id],
    queryFn: async () => {
      if (!profileData?._id) return [];
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");
      const response = await fetch(`/api/users/${profileData._id}/meetings`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error("Failed to load user meetings");
      return response.json();
    },
    enabled: !!profileData?._id,
    refetchOnWindowFocus: true,
    staleTime: 30000,
    refetchInterval: 60000,
  });

  useEffect(() => {
    if (user) {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings?limit=10"] });
      refetch();
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          queryClient.invalidateQueries({ queryKey: ["/api/meetings?limit=10"] });
          refetch();
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  }, [user, refetch, queryClient]);

  const startQuickAction = (mode: "instant" | "invite" | "schedule") => {
    const newRoomId = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    const params = new URLSearchParams();
    params.set("mode", mode);
    if (quickActionInviteIds.length) params.set("invite", quickActionInviteIds.join(","));
    setLocation(`/call/${newRoomId}?${params.toString()}`);
  };

  const createCall = () => {
    const newRoomId = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    setLocation(`/call/${newRoomId}`);
  };

  const joinCall = () => {
    if (roomId.trim()) setLocation(`/call/${roomId.trim()}`);
  };

  const filteredMeetings = (meetings || []).filter((meeting) => {
    const participantCount = Array.isArray(meeting.participants) ? meeting.participants.length : 0;
    return participantCount >= 2;
  });

  const extractId = (value: any): string => {
    if (!value) return "";
    if (typeof value === "string") return value;
    return value._id || value.id || "";
  };

  const { topCollaborators, collaboratorCount } = useMemo(() => {
    if (!profileData?._id || !userMeetings) return { topCollaborators: [], collaboratorCount: 0 };
    const userId = profileData._id;
    const collaboratorMap = new Map<string, { id: string; name: string; email?: string; count: number }>();

    const register = (p: any) => {
      const id = extractId(p);
      if (!id || id === userId) return;
      let name = "Collaborator";
      let email: string | undefined;
      if (p && typeof p === "object") {
        name = p.name || p.email || name;
        email = p.email;
      }
      const existing = collaboratorMap.get(id);
      if (existing) existing.count += 1;
      else collaboratorMap.set(id, { id, name, email, count: 1 });
    };

    userMeetings.forEach((m) => {
      const hostId = extractId(m.hostId);
      if (hostId && hostId !== userId) register(m.hostId);
      (m.participants || []).forEach(register);
    });

    return {
      topCollaborators: Array.from(collaboratorMap.values()).sort((a, b) => b.count - a.count).slice(0, 5),
      collaboratorCount: collaboratorMap.size,
    };
  }, [profileData?._id, userMeetings]);

  const quickActionInviteIds = topCollaborators.map((c) => c.id).filter(Boolean);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weeklyMeetings = filteredMeetings.filter((m) => new Date(m.startTime) >= weekAgo).length;
  const totalDuration = filteredMeetings.reduce((acc, m) => acc + getDurationMinutes(new Date(m.startTime), m.endTime ? new Date(m.endTime) : undefined), 0);
  const avgDuration = filteredMeetings.length ? Math.round(totalDuration / filteredMeetings.length) : 0;

  const sidebarItems = [
    { title: "Dashboard", icon: LayoutDashboard, url: "/dashboard" },
    { title: "Chats", icon: MessageSquare, url: "/chats" },
    { title: "Profile", icon: User, url: "/profile" },
    { title: "Settings", icon: Settings, url: "/settings" }
  ];

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-background/80 backdrop-blur-3xl overflow-hidden">
        {/* Background Gradients */}
        <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/10 blur-[100px] animate-pulse-glow" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-500/10 blur-[100px] animate-pulse-glow animation-delay-500" />
        </div>

        <Sidebar className="border-r border-white/10 bg-black/20 backdrop-blur-xl">
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
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/5 transition-colors cursor-pointer group">
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
          <header className="flex items-center justify-between gap-4 p-6 border-b border-white/5 bg-white/[0.02] backdrop-blur-sm z-10">
            <div className="flex items-center gap-4">
              <SidebarTrigger />
              <div className="relative hidden sm:block w-96 group">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                <Input
                  placeholder="Search meetings, transcripts, people..."
                  className="pl-11 bg-white/[0.02] border-white/10 focus:bg-white/5 transition-all rounded-full"
                />
              </div>
            </div>
            <ThemeToggle />
          </header>

          <main className="flex-1 overflow-y-auto p-6 scrollbar-hide">
            <div className="max-w-7xl mx-auto space-y-8 pb-10">

              {/* Hero Section */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative rounded-3xl overflow-hidden p-6"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-purple-500/10 to-background z-0" />
                <div className="absolute inset-0 backdrop-blur-3xl z-0" />
                <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
                  <div className="space-y-2 max-w-2xl">
                    <h1 className="text-3xl font-bold tracking-tight text-white drop-shadow-sm">
                      Hello, <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-purple-400">{user?.displayName?.split(' ')[0] || "Creator"}</span>
                    </h1>
                    <p className="text-base text-white/80 font-medium">
                      Ready to collaborate? Your studio is prepped.
                    </p>
                  </div>

                  <div className="flex gap-4">
                    <div className="text-right hidden md:block">
                      <p className="text-3xl font-bold">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                      <p className="text-sm text-muted-foreground">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Quick Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={Video} label="Weekly Calls" value={weeklyMeetings} trend="+12% vs last week" delay={0.1} />
                <StatCard icon={Users} label="Collaborators" value={collaboratorCount} trend="Active network" delay={0.2} />
                <StatCard icon={Clock} label="Avg Duration" value={`${avgDuration}m`} trend="Optimal focus" delay={0.3} />
                <StatCard icon={Activity} label="Engagement" value="High" trend="Top 10% of users" delay={0.4} />
              </div>

              {/* Main Content Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Left Column: Actions & Recent */}
                <div className="lg:col-span-2 space-y-8">

                  {/* Quick Actions */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <ActionButton icon={Zap} label="Instant Meeting" onClick={createCall} variant="primary" delay={0.5} />
                    <ActionButton icon={CalendarPlus} label="Schedule" onClick={() => startQuickAction("schedule")} variant="secondary" delay={0.6} />
                    <ActionButton icon={Users} label="Join Room" onClick={() => document.getElementById('join-input')?.focus()} variant="secondary" delay={0.7} />
                    <ActionButton icon={BarChart3} label="View Analytics" onClick={() => { }} variant="secondary" delay={0.8} />
                  </div>

                  {/* Recent Meetings List */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-semibold flex items-center gap-2">
                        <Clock className="w-5 h-5 text-primary" />
                        Recent Sessions
                      </h2>
                      <Button variant="ghost" size="sm" onClick={() => refetch()} className="hover:bg-white/5">
                        <RefreshCw className={`w-4 h-4 ${meetingsLoading ? 'animate-spin' : ''}`} />
                      </Button>
                    </div>

                    <div className="space-y-3">
                      <AnimatePresence>
                        {meetingsLoading ? (
                          <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
                        ) : filteredMeetings.length === 0 ? (
                          <div className="text-center py-10 text-muted-foreground bg-white/5 rounded-2xl border border-white/5">
                            <p>No recent calls found.</p>
                          </div>
                        ) : (
                          filteredMeetings.slice(0, 5).map((meeting, i) => (
                            <motion.div
                              key={meeting._id}
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: i * 0.1 }}
                              className="group relative overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] p-3 hover:bg-white/5 transition-all cursor-pointer"
                              onClick={() => setLocation(`/summary/${meeting._id}`)}
                            >
                              <div className="flex items-center justify-between relative z-10">
                                <div className="flex items-center gap-4">
                                  <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center text-primary font-bold text-lg">
                                    {meeting.title.charAt(0).toUpperCase()}
                                  </div>
                                  <div>
                                    <div>
                                      <h3 className="font-bold text-lg text-white group-hover:text-primary transition-colors">{meeting.title || "Untitled Session"}</h3>
                                      <div className="flex items-center gap-3 text-sm text-white/60 font-medium">
                                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {formatTimeAgo(new Date(meeting.startTime))}</span>
                                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {calculateDuration(new Date(meeting.startTime), meeting.endTime ? new Date(meeting.endTime) : undefined)}</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <Badge variant="outline" className="bg-white/5 border-white/10">{getEmotion(meeting)}</Badge>
                                  <ArrowUpRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                                </div>
                              </div>
                              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 pointer-events-none" />
                            </motion.div>
                          ))
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* Right Column: Join & Insights */}
                <div className="space-y-8">
                  {/* Join Card */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.6 }}
                    className="glass-panel p-5 rounded-2xl space-y-4 relative overflow-hidden"
                  >
                    <div className="absolute top-0 right-0 w-32 h-32 bg-primary/20 blur-[60px] rounded-full" />
                    <div>
                      <h3 className="text-lg font-bold text-white mb-1">Join a Room</h3>
                      <p className="text-sm text-white/60 font-medium">Enter a code to jump into a meeting.</p>
                    </div>
                    <div className="space-y-3">
                      <Input
                        id="join-input"
                        placeholder="e.g. room-123"
                        value={roomId}
                        onChange={(e) => setRoomId(e.target.value)}
                        className="bg-black/20 border-white/10 text-center text-lg tracking-wider font-mono h-12"
                      />
                      <Button onClick={joinCall} className="w-full h-12 text-base font-medium shadow-lg shadow-primary/20">
                        Join Now
                      </Button>
                    </div>
                  </motion.div>

                  {/* Top Collaborators */}
                  <div className="glass-panel p-5 rounded-2xl space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Users className="w-5 h-5 text-primary" />
                      <span className="text-white">Top Collaborators</span>
                    </h3>
                    <div className="space-y-4">
                      {topCollaborators.length > 0 ? (
                        topCollaborators.map((collab, i) => (
                          <div key={collab.id} className="flex items-center justify-between group">
                            <div className="flex items-center gap-3">
                              <Avatar className="h-10 w-10 border border-white/10">
                                <AvatarFallback className="bg-primary/10 text-primary">{getInitials(collab.name)}</AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-medium text-sm group-hover:text-primary transition-colors">{collab.name}</p>
                                <p className="text-xs text-muted-foreground">{collab.count} sessions</p>
                              </div>
                            </div>
                            <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Video className="w-4 h-4" />
                            </Button>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">No collaborators yet.</p>
                      )}
                    </div>
                    {topCollaborators.length > 0 && (
                      <Button variant="outline" className="w-full border-white/10 hover:bg-white/5" onClick={() => startQuickAction("invite")}>
                        Invite All
                      </Button>
                    )}
                  </div>
                </div>

              </div>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

import { useState, useEffect, useMemo, type CSSProperties } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Settings, LogOut, LayoutDashboard, MessageSquare, User, Mail, Calendar, Phone, Edit2, Save, X, Camera, CheckCircle2, Loader2, RefreshCw, Shield, Activity } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth";
import { LogoMark } from "@/components/LogoMark";
import { getAvatarUrl, getInitials } from "@/lib/utils";
import { getQueryFn } from "@/lib/queryClient";
import { auth } from "@/lib/firebase";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";

interface UserProfile {
  _id: string;
  name: string;
  username: string;
  email: string;
  avatar?: string;
  bio?: string;
  phone?: string;
  dateOfBirth?: string;
  isEmailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

type MeetingParticipant = string | { _id?: string; name?: string; email?: string };

interface UserMeeting {
  _id: string;
  hostId: string | { _id?: string };
  participants: MeetingParticipant[];
  startTime: string;
  status?: string;
}

export default function Profile() {
  const [, setLocation] = useLocation();
  const { user: authUser, logout } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch user profile from MongoDB with real-time updates
  const { data: profile, isLoading, error, refetch, isFetching } = useQuery<UserProfile>({
    queryKey: ["/api/users/me"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!authUser?.uid,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    staleTime: 30000,
    refetchInterval: 60000,
    retry: 2,
    retryDelay: 1000,
  });

  // Log errors for debugging
  useEffect(() => {
    if (error) {
      console.error("[Profile] Error fetching profile:", error);
    }
  }, [error]);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    username: "",
    bio: "",
    phone: "",
    dateOfBirth: "",
    avatar: "",
  });

  // Update form data when profile loads
  useEffect(() => {
    if (profile) {
      setFormData({
        name: profile.name || "",
        username: profile.username || "",
        bio: profile.bio || "",
        phone: profile.phone || "",
        dateOfBirth: profile.dateOfBirth ? new Date(profile.dateOfBirth).toISOString().split("T")[0] : "",
        avatar: profile.avatar || "",
      });
    }
  }, [profile]);

  const {
    data: userMeetings,
    isLoading: isMeetingsLoading,
    isFetching: isMeetingsFetching,
    error: meetingsError,
    refetch: refetchMeetings,
  } = useQuery<UserMeeting[]>({
    queryKey: ["/api/users", profile?._id, "meetings"],
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      const response = await fetch(`/api/users/${profile?._id}/meetings`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to fetch meetings");
      }

      return response.json();
    },
    enabled: !!profile?._id,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const extractId = (value: string | { _id?: string } | null | undefined): string => {
    if (!value) return "";
    if (typeof value === "string") return value;
    return value._id || "";
  };

  const computedStats = useMemo(() => {
    if (!profile?._id || !userMeetings) {
      return { friends: 0, groups: 0, meetingsHosted: 0 };
    }

    const userId = profile._id;
    const friendIds = new Set<string>();
    let groupCount = 0;
    let hostedCount = 0;

    userMeetings.forEach((meeting) => {
      const hostId = extractId(meeting.hostId);
      if (hostId === userId) {
        hostedCount += 1;
      }

      const participantIds = (meeting.participants || [])
        .map((participant) => extractId(participant as MeetingParticipant))
        .filter((id) => id && id !== userId);

      participantIds.forEach((id) => friendIds.add(id));

      const uniqueOthers = new Set(participantIds);
      if (hostId && hostId !== userId) {
        uniqueOthers.add(hostId);
      }

      if (uniqueOthers.size >= 2) {
        groupCount += 1;
      }
    });

    return {
      friends: friendIds.size,
      groups: groupCount,
      meetingsHosted: hostedCount,
    };
  }, [profile?._id, userMeetings]);

  const statsLoading = (isMeetingsLoading || isMeetingsFetching) && !userMeetings;

  const getBaseAvatarUrl = () => {
    return (
      formData.avatar ||
      profile?.avatar ||
      authUser?.photoURL ||
      getAvatarUrl(authUser?.photoURL, authUser?.uid, authUser?.email) ||
      `https://api.dicebear.com/7.x/initials/svg?seed=${profile?.username || profile?._id || "user"}`
    );
  };

  const handleAvatarRefresh = () => {
    const baseUrl = getBaseAvatarUrl();
    const randomToken = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

    let updatedUrl = baseUrl;
    try {
      const url = new URL(baseUrl);
      url.searchParams.set("refresh", randomToken);
      updatedUrl = url.toString();
    } catch {
      updatedUrl = baseUrl.includes("?")
        ? `${baseUrl}&refresh=${randomToken}`
        : `${baseUrl}?refresh=${randomToken}`;
    }

    setFormData((prev) => ({
      ...prev,
      avatar: updatedUrl,
    }));
  };

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (data: Partial<UserProfile>) => {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      const response = await fetch("/api/users/me", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        credentials: "include",
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update profile");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users/me"] });
      setIsEditing(false);
      toast({
        title: "Profile updated",
        description: "Your profile has been successfully updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateProfileMutation.mutateAsync({
        name: formData.name,
        username: formData.username,
        bio: formData.bio,
        phone: formData.phone,
        dateOfBirth: formData.dateOfBirth ? new Date(formData.dateOfBirth).toISOString() : undefined,
        avatar: formData.avatar,
      });
    } catch (error) {
      console.error("Error updating profile:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (profile) {
      setFormData({
        name: profile.name || "",
        username: profile.username || "",
        bio: profile.bio || "",
        phone: profile.phone || "",
        dateOfBirth: profile.dateOfBirth ? new Date(profile.dateOfBirth).toISOString().split("T")[0] : "",
        avatar: profile.avatar || "",
      });
    }
    setIsEditing(false);
  };

  const sidebarItems = [
    { title: "Dashboard", icon: LayoutDashboard, url: "/dashboard" },
    { title: "Chats", icon: MessageSquare, url: "/chats" },
    { title: "Profile", icon: User, url: "/profile" },
    { title: "Settings", icon: Settings, url: "/settings" },
  ];

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  const displayName = profile?.name || authUser?.displayName || "User";
  const displayEmail = profile?.email || authUser?.email || "";
  const avatarUrl =
    (isEditing ? formData.avatar : profile?.avatar) ||
    authUser?.photoURL ||
    getAvatarUrl(authUser?.photoURL, authUser?.uid, authUser?.email);
  const statsReady = !!userMeetings;
  const profileStats = computedStats;
  const statsCards = [
    { label: "Friends", value: statsReady ? profileStats.friends : "—" },
    { label: "Groups", value: statsReady ? profileStats.groups : "—" },
    { label: "Meetings Hosted", value: statsReady ? profileStats.meetingsHosted : "—" },
  ];
  const statsStatusText = statsReady ? "Live stats from your recent meetings." : "Gathering stats...";

  const memberSinceText = profile?.createdAt
    ? (() => {
      const diffMs = Date.now() - new Date(profile.createdAt).getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays < 1) return "Joined today";
      if (diffDays === 1) return "Joined yesterday";
      if (diffDays < 30) return `Joined ${diffDays} days ago`;
      const diffMonths = Math.floor(diffDays / 30);
      if (diffMonths < 12) return `Joined ${diffMonths} month${diffMonths > 1 ? "s" : ""} ago`;
      const diffYears = Math.floor(diffMonths / 12);
      return `Joined ${diffYears} year${diffYears > 1 ? "s" : ""} ago`;
    })()
    : "Member";

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
    <SidebarProvider style={style as CSSProperties}>
      <div className="flex h-screen w-full bg-background/95 backdrop-blur-3xl overflow-hidden">
        {/* Background Gradients */}
        <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/10 blur-[100px] animate-pulse-glow" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-emerald-500/10 blur-[100px] animate-pulse-glow animation-delay-500" />
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
                  <AvatarImage src={getAvatarUrl(authUser?.photoURL, authUser?.uid, authUser?.email)} />
                  <AvatarFallback>{getInitials(authUser?.displayName, authUser?.email)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{authUser?.displayName || "User"}</p>
                  <p className="text-xs text-muted-foreground truncate">{authUser?.email}</p>
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
              <h1 className="text-xl font-semibold">Profile</h1>
            </div>
            <ThemeToggle />
          </header>

          <main className="flex-1 overflow-auto p-6 md:p-10">
            <div className="max-w-5xl mx-auto space-y-8">
              {isLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
                </div>
              ) : error ? (
                <Alert variant="destructive" className="bg-red-500/10 border-red-500/20 text-red-200">
                  <AlertDescription>
                    <div className="space-y-2">
                      <p className="font-semibold">
                        {error instanceof Error ? error.message : "Failed to load profile. Please try again."}
                      </p>
                      <Button onClick={() => refetch()} variant="outline" className="mt-2 border-red-500/30 hover:bg-red-500/20">Retry</Button>
                    </div>
                  </AlertDescription>
                </Alert>
              ) : (
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  className="space-y-8"
                >
                  {/* Profile Header Card */}
                  <motion.div variants={itemVariants} className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 backdrop-blur-3xl p-8 shadow-2xl">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-50 pointer-events-none" />
                    <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -mr-32 -mt-32 pointer-events-none" />

                    <div className="relative flex flex-col lg:flex-row lg:items-start lg:justify-between gap-8">
                      <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
                        <div className="relative group">
                          <div className="absolute inset-0 bg-primary/30 blur-xl rounded-full opacity-70 group-hover:opacity-100 transition-opacity" />
                          <Avatar className="relative h-32 w-32 border-4 border-white/10 shadow-2xl">
                            <AvatarImage src={avatarUrl} alt={displayName} className="object-cover" />
                            <AvatarFallback className="text-3xl bg-background/50 backdrop-blur">
                              {getInitials(displayName, displayEmail)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="absolute -bottom-2 -right-2 h-6 w-6 rounded-full border-2 border-background bg-emerald-500 shadow-lg ring-2 ring-background/50 animate-pulse" />
                        </div>

                        <div className="text-center sm:text-left space-y-2">
                          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                            <h1 className="text-4xl font-bold tracking-tight">{displayName}</h1>
                            {profile?.isEmailVerified && (
                              <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                Verified
                              </Badge>
                            )}
                          </div>
                          <p className="text-lg text-muted-foreground">@{profile?.username || "username"}</p>
                          <div className="flex items-center justify-center sm:justify-start gap-4 text-sm text-muted-foreground/80 pt-2">
                            <span className="flex items-center gap-1.5">
                              <Mail className="w-4 h-4" />
                              {displayEmail}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <Calendar className="w-4 h-4" />
                              {memberSinceText}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
                        <Button
                          variant="outline"
                          className="gap-2 border-white/10 hover:bg-white/10 bg-transparent backdrop-blur-sm"
                          onClick={handleAvatarRefresh}
                          disabled={!profile}
                        >
                          <Camera className="w-4 h-4" />
                          Shuffle Avatar
                        </Button>
                        {!isEditing ? (
                          <Button onClick={() => setIsEditing(true)} className="gap-2 shadow-lg shadow-primary/20">
                            <Edit2 className="w-4 h-4" />
                            Edit Profile
                          </Button>
                        ) : (
                          <div className="flex gap-2">
                            <Button variant="ghost" onClick={handleCancel} disabled={isSaving} className="hover:bg-white/10">
                              Cancel
                            </Button>
                            <Button onClick={handleSave} disabled={isSaving} className="gap-2 min-w-[100px]">
                              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                              Save
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8 pt-8 border-t border-white/10">
                      {statsCards.map((stat) => (
                        <div
                          key={stat.label}
                          className="group relative overflow-hidden rounded-2xl border border-white/5 bg-white/5 p-4 hover:bg-white/10 transition-all duration-300"
                        >
                          <div className="relative z-10">
                            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{stat.label}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <p className="text-2xl font-bold text-foreground">
                                {statsLoading ? "—" : stat.value}
                              </p>
                              {statsLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                            </div>
                          </div>
                          <div className="absolute -right-4 -bottom-4 w-16 h-16 bg-primary/5 rounded-full blur-xl group-hover:bg-primary/10 transition-colors" />
                        </div>
                      ))}
                    </div>
                  </motion.div>

                  <div className="grid gap-8 lg:grid-cols-3">
                    {/* Profile Details Form */}
                    <motion.div variants={itemVariants} className="lg:col-span-2 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md p-6 md:p-8">
                      <div className="flex items-center justify-between mb-8">
                        <div>
                          <h2 className="text-xl font-semibold flex items-center gap-2">
                            <User className="w-5 h-5 text-primary" />
                            Profile Details
                          </h2>
                          <p className="text-sm text-muted-foreground mt-1">Manage your personal information</p>
                        </div>
                        {isEditing && (
                          <Badge variant="outline" className="border-primary/50 text-primary animate-pulse">
                            Editing Mode
                          </Badge>
                        )}
                      </div>

                      <div className="space-y-8">
                        <div className="grid gap-6 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="name" className={isEditing ? "text-primary" : ""}>Full Name</Label>
                            {isEditing ? (
                              <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="bg-white/5 border-white/10 focus:border-primary/50"
                              />
                            ) : (
                              <p className="text-lg font-medium">{profile?.name || "Not set"}</p>
                            )}
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="username" className={isEditing ? "text-primary" : ""}>Username</Label>
                            {isEditing ? (
                              <Input
                                id="username"
                                value={formData.username}
                                onChange={(e) => setFormData({ ...formData, username: e.target.value.toLowerCase() })}
                                className="bg-white/5 border-white/10 focus:border-primary/50"
                              />
                            ) : (
                              <p className="text-lg font-medium">@{profile?.username || "username"}</p>
                            )}
                          </div>
                        </div>

                        <div className="grid gap-6 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label>Email Address</Label>
                            <div className="flex items-center gap-2">
                              <p className="text-lg font-medium text-muted-foreground">{displayEmail}</p>
                              {profile?.isEmailVerified && (
                                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                              )}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="phone" className={isEditing ? "text-primary" : ""}>Phone Number</Label>
                            {isEditing ? (
                              <Input
                                id="phone"
                                type="tel"
                                value={formData.phone}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                className="bg-white/5 border-white/10 focus:border-primary/50"
                                placeholder="+1 (555) 000-0000"
                              />
                            ) : (
                              <p className="text-lg font-medium">{profile?.phone || "Not set"}</p>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="bio" className={isEditing ? "text-primary" : ""}>Bio</Label>
                          {isEditing ? (
                            <Textarea
                              id="bio"
                              value={formData.bio}
                              onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                              className="bg-white/5 border-white/10 focus:border-primary/50 min-h-[100px]"
                              placeholder="Tell us about yourself..."
                              maxLength={500}
                            />
                          ) : (
                            <p className="text-base leading-relaxed text-muted-foreground">
                              {profile?.bio || "No bio provided yet."}
                            </p>
                          )}
                        </div>
                      </div>
                    </motion.div>

                    {/* Account Snapshot */}
                    <motion.div variants={itemVariants} className="space-y-6">
                      <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md p-6">
                        <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
                          <Shield className="w-5 h-5 text-emerald-500" />
                          Account Status
                        </h3>
                        <div className="space-y-4">
                          <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Membership</p>
                            <p className="font-medium">{memberSinceText}</p>
                          </div>
                          <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Last Active</p>
                            <p className="font-medium">
                              {profile?.updatedAt ? new Date(profile.updatedAt).toLocaleDateString() : "Just now"}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md p-6">
                        <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
                          <Activity className="w-5 h-5 text-blue-500" />
                          Engagement
                        </h3>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-colors">
                            <span className="text-sm text-muted-foreground">Hosted Rooms</span>
                            <span className="font-bold">{profileStats.meetingsHosted}</span>
                          </div>
                          <div className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-colors">
                            <span className="text-sm text-muted-foreground">Collaborators</span>
                            <span className="font-bold">{profileStats.friends}</span>
                          </div>
                          <div className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-colors">
                            <span className="text-sm text-muted-foreground">Group Sessions</span>
                            <span className="font-bold">{profileStats.groups}</span>
                          </div>
                        </div>

                        <Button
                          variant="outline"
                          className="w-full mt-6 border-white/10 hover:bg-white/10"
                          onClick={() => {
                            refetch();
                            refetchMeetings();
                          }}
                          disabled={isFetching || isMeetingsFetching}
                        >
                          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
                          Sync Data
                        </Button>
                      </div>
                    </motion.div>
                  </div>
                </motion.div>
              )}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

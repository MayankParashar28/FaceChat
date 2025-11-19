import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { User, Phone, Edit2, Save, X, Camera, CheckCircle2, Loader2, RefreshCw, Calendar } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getAvatarUrl, getInitials } from "@/lib/utils";
import { getQueryFn } from "@/lib/queryClient";
import { auth } from "@/lib/firebase";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import Layout, { GlassCard } from "@/components/Layout";

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
  const { user: authUser } = useAuth();
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
    staleTime: 30000, // Consider data stale after 30 seconds
    refetchInterval: 60000, // Auto-refetch every 60 seconds for real-time updates
    retry: 2, // Retry failed requests 2 times
    retryDelay: 1000, // Wait 1 second between retries
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

  useEffect(() => {
    if (meetingsError) {
      console.error("[Profile] Error fetching user meetings:", meetingsError);
    }
  }, [meetingsError]);

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

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : error ? (
          <Alert variant="destructive" className="bg-red-500/10 border-red-500/20 text-red-500">
            <AlertDescription>
              <div className="space-y-2">
                <p className="font-semibold">
                  {error instanceof Error ? error.message : "Failed to load profile. Please try again."}
                </p>
              </div>
            </AlertDescription>
            <div className="flex gap-2 mt-4">
              <Button
                onClick={async () => {
                  await refetch();
                }}
                variant="outline"
                className="bg-background/50"
              >
                Retry
              </Button>
              <Button
                variant="outline"
                className="bg-background/50"
                onClick={() => setLocation("/dashboard")}
              >
                Go to Dashboard
              </Button>
            </div>
          </Alert>
        ) : (
          <>
            {/* Header Card with Gradient and Avatar */}
            <GlassCard className="relative overflow-hidden p-8 border-primary/20">
              <div className="absolute inset-0 opacity-30 blur-3xl pointer-events-none bg-[radial-gradient(circle_at_top_right,_var(--primary),_transparent_50%)]" />

              <div className="relative space-y-8">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex items-center gap-6">
                    <div className="relative group">
                      <div className="absolute inset-0 rounded-full bg-primary/30 blur-xl group-hover:bg-primary/50 transition-all duration-500" />
                      <Avatar className="relative h-28 w-28 border-4 border-background/50 shadow-2xl ring-2 ring-white/10">
                        <AvatarImage src={avatarUrl} alt={displayName} className="object-cover" />
                        <AvatarFallback className="text-3xl bg-primary/20 text-primary">
                          {getInitials(displayName, displayEmail)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="absolute bottom-1 right-1 h-5 w-5 rounded-full border-2 border-background bg-emerald-500 shadow-lg animate-pulse"></span>
                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <h1 className="text-3xl font-bold tracking-tight">{displayName}</h1>
                        {profile?.isEmailVerified && (
                          <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Verified
                          </Badge>
                        )}
                        {isFetching && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground animate-pulse">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Syncing
                          </span>
                        )}
                      </div>
                      <p className="text-base text-muted-foreground">
                        @{profile?.username || "username"} · {displayEmail}
                      </p>
                      <p className="text-xs uppercase tracking-widest text-primary/80 font-medium mt-2">
                        {memberSinceText}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      className="gap-2 bg-white/5 border-white/10 hover:bg-white/10"
                      onClick={handleAvatarRefresh}
                      disabled={!profile}
                    >
                      <Camera className="w-4 h-4" />
                      Shuffle Avatar
                    </Button>
                    {!isEditing ? (
                      <Button onClick={() => setIsEditing(true)} data-testid="button-edit-profile" className="gap-2 shadow-lg shadow-primary/20">
                        <Edit2 className="w-4 h-4" />
                        Edit Profile
                      </Button>
                    ) : (
                      <>
                        <Button variant="ghost" onClick={handleCancel} disabled={isSaving} className="gap-2">
                          <X className="w-4 h-4" />
                          Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={isSaving} data-testid="button-save-profile" className="gap-2 shadow-lg shadow-primary/20">
                          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                          {isSaving ? "Saving..." : "Save Changes"}
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {statsCards.map((stat) => (
                    <div
                      key={stat.label}
                      className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm hover:bg-white/10 transition-colors"
                    >
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">{stat.label}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <p className="text-3xl font-bold text-foreground">
                          {statsLoading ? "—" : stat.value}
                        </p>
                        {statsLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                  <div className="flex items-center gap-2">
                    {isMeetingsFetching && <Loader2 className="w-3 h-3 animate-spin" />}
                    <span>{statsStatusText}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs hover:bg-white/5"
                    onClick={() => refetchMeetings()}
                    disabled={isMeetingsFetching}
                  >
                    <RefreshCw className={`w-3 h-3 mr-1 ${isMeetingsFetching ? "animate-spin" : ""}`} />
                    Sync stats
                  </Button>
                </div>
              </div>
            </GlassCard>

            <div className="grid gap-6 lg:grid-cols-3">
              {/* Profile Details Form */}
              <GlassCard className="lg:col-span-2">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-semibold">Profile Details</h2>
                    <p className="text-sm text-muted-foreground">Manage your personal information</p>
                  </div>
                  {isEditing && (
                    <Badge variant="outline" className="bg-primary/5 border-primary/20 text-primary animate-pulse">
                      Editing Mode
                    </Badge>
                  )}
                </div>

                <div className="space-y-8">
                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="name" className="flex items-center gap-2">
                        <User className="w-4 h-4 text-primary" />
                        Full Name
                      </Label>
                      {isEditing ? (
                        <Input
                          id="name"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          required
                          className="bg-white/5 border-white/10 focus:bg-white/10"
                        />
                      ) : (
                        <p className="text-sm font-medium p-2 rounded-md bg-white/5 border border-transparent">{profile?.name || "Not set"}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="username" className="flex items-center gap-2">
                        <span className="text-primary font-bold">@</span>
                        Username
                      </Label>
                      {isEditing ? (
                        <Input
                          id="username"
                          value={formData.username}
                          onChange={(e) => setFormData({ ...formData, username: e.target.value.toLowerCase() })}
                          required
                          className="bg-white/5 border-white/10 focus:bg-white/10"
                        />
                      ) : (
                        <p className="text-sm font-medium p-2 rounded-md bg-white/5 border border-transparent">@{profile?.username || "username"}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <span className="text-primary">✉️</span>
                        Email
                      </Label>
                      <div className="p-2 rounded-md bg-white/5 border border-white/10 flex items-center justify-between">
                        <p className="text-sm font-medium">{displayEmail}</p>
                        {profile?.isEmailVerified && (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground px-1">Email cannot be changed directly.</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone" className="flex items-center gap-2">
                        <Phone className="w-4 h-4 text-primary" />
                        Phone
                      </Label>
                      {isEditing ? (
                        <Input
                          id="phone"
                          type="tel"
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          placeholder="+1234567890"
                          className="bg-white/5 border-white/10 focus:bg-white/10"
                        />
                      ) : (
                        <p className="text-sm font-medium p-2 rounded-md bg-white/5 border border-transparent">{profile?.phone || "Not set"}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="dateOfBirth" className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-primary" />
                        Date of Birth
                      </Label>
                      {isEditing ? (
                        <Input
                          id="dateOfBirth"
                          type="date"
                          value={formData.dateOfBirth}
                          onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                          className="bg-white/5 border-white/10 focus:bg-white/10"
                        />
                      ) : (
                        <p className="text-sm font-medium p-2 rounded-md bg-white/5 border border-transparent">
                          {profile?.dateOfBirth
                            ? new Date(profile.dateOfBirth).toLocaleDateString()
                            : "Not set"}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bio" className="flex items-center gap-2">
                        <span className="text-primary">📝</span>
                        Bio
                      </Label>
                      {isEditing ? (
                        <Textarea
                          id="bio"
                          value={formData.bio}
                          onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                          placeholder="Tell others how you host, collaborate, or create..."
                          rows={4}
                          maxLength={500}
                          className="bg-white/5 border-white/10 focus:bg-white/10 resize-none"
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground p-3 rounded-md bg-white/5 border border-transparent min-h-[6rem] whitespace-pre-wrap">
                          {profile?.bio || "No bio yet."}
                        </p>
                      )}
                      {isEditing && (
                        <p className="text-xs text-muted-foreground text-right">
                          {formData.bio.length}/500 characters
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </GlassCard>

              {/* Account Snapshot */}
              <GlassCard className="h-fit bg-white/5">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold">Account Snapshot</h2>
                  <p className="text-xs text-muted-foreground">Live system data for your workspace</p>
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Membership</p>
                    <p className="text-lg font-semibold mt-1">
                      {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString() : "N/A"}
                    </p>
                    <p className="text-xs text-primary/80 mt-1">{memberSinceText}</p>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Last updated</p>
                    <p className="font-medium mt-1">
                      {profile?.updatedAt ? new Date(profile.updatedAt).toLocaleString() : "N/A"}
                    </p>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Engagement</p>
                    <ul className="space-y-2 text-sm">
                      <li className="flex items-center justify-between">
                        <span className="text-muted-foreground">Hosted Rooms</span>
                        <span className="font-medium">{profileStats.meetingsHosted}</span>
                      </li>
                      <li className="flex items-center justify-between">
                        <span className="text-muted-foreground">Collaborators</span>
                        <span className="font-medium">{profileStats.friends}</span>
                      </li>
                      <li className="flex items-center justify-between">
                        <span className="text-muted-foreground">Group Sessions</span>
                        <span className="font-medium">{profileStats.groups}</span>
                      </li>
                    </ul>
                  </div>

                  <Button
                    variant="outline"
                    className="w-full justify-center gap-2 bg-white/5 border-white/10 hover:bg-white/10"
                    onClick={() => {
                      refetch();
                      refetchMeetings();
                    }}
                  >
                    <RefreshCw className="w-4 h-4" />
                    Refresh Data
                  </Button>
                </div>
              </GlassCard>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Calendar,
  CheckCircle2,
  Copy,
  Edit2,
  Loader2,
  Plus,
  QrCode,
  Save,
  Share2,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getAvatarUrl, getInitials } from "@/lib/utils";
import { getAuthToken, getQueryFn } from "@/lib/queryClient";
import { auth } from "@/lib/firebase";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface UserProfile {
  _id: string;
  name: string;
  username: string;
  email: string;
  avatar?: string;
  bio?: string;
  phone?: string;
  location?: string;
  website?: string;
  isEmailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProfileStats {
  friends: number;
  groups: number;
  meetingsHosted: number;
}

/** The fields this page edits, in the order they appear. */
interface ProfileForm {
  name: string;
  username: string;
  bio: string;
  location: string;
  website: string;
  phone: string;
}

const PROVIDERS = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
] as const;

const EMPTY_FORM: ProfileForm = {
  name: "",
  username: "",
  bio: "",
  location: "",
  website: "",
  phone: "",
};

function formToState(profile: UserProfile | undefined): ProfileForm {
  if (!profile) return EMPTY_FORM;
  return {
    name: profile.name || "",
    username: profile.username || "",
    bio: profile.bio || "",
    location: profile.location || "",
    website: profile.website || "",
    phone: profile.phone || "",
  };
}

function describeMembership(createdAt: string | undefined): string {
  if (!createdAt) return "Member";
  const diffDays = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
  if (diffDays < 1) return "Joined today";
  if (diffDays === 1) return "Joined yesterday";
  if (diffDays < 30) return `Joined ${diffDays} days ago`;
  const months = Math.floor(diffDays / 30);
  if (months < 12) return `Joined ${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `Joined ${years} year${years === 1 ? "" : "s"} ago`;
}

/** A read-only field in the details card. */
function ReadField({ label, value, href }: { label: string; value?: string; href?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {value ? (
        href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block truncate text-sm text-primary hover:underline"
          >
            {value}
          </a>
        ) : (
          <p className="mt-1 truncate text-sm text-foreground">{value}</p>
        )
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Not set</p>
      )}
    </div>
  );
}

export default function Profile() {
  const { user: authUser, linkGoogleAccount, linkGithubAccount } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [linkingProvider, setLinkingProvider] = useState<"google" | "github" | null>(null);
  const [linkedProviders, setLinkedProviders] = useState({ google: false, github: false });

  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);

  const {
    data: profile,
    isLoading,
    error,
    refetch,
  } = useQuery<UserProfile>({
    queryKey: ["/api/users/me"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!authUser?.uid,
    staleTime: 30_000,
    retry: 2,
    retryDelay: 1000,
  });

  // Counted server-side. See GET /api/users/me/stats — this used to pull down
  // every meeting the user had ever joined just to estimate three numbers.
  const { data: stats } = useQuery<ProfileStats>({
    queryKey: ["/api/users/me/stats"],
    queryFn: async () => {
      const token = await getAuthToken();
      if (!token) throw new Error("Not authenticated");
      const response = await fetch("/api/users/me/stats", {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Failed to fetch profile stats");
      }
      return response.json();
    },
    enabled: !!profile?._id,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (profile) setForm(formToState(profile));
  }, [profile]);

  // Which sign-in providers Firebase has on this account.
  useEffect(() => {
    const current = auth.currentUser;
    const ids = (current?.providerData || []).map((p) => p?.providerId).filter(Boolean);
    setLinkedProviders({
      google: ids.includes("google.com"),
      github: ids.includes("github.com"),
    });
  }, [authUser?.uid]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: ProfileForm) => {
      const token = await getAuthToken();
      if (!token) throw new Error("Not authenticated");
      const response = await fetch("/api/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Failed to update profile");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users/me"] });
      setIsEditing(false);
      toast({ title: "Profile updated", description: "Your changes have been saved." });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = () => updateProfileMutation.mutate(form);

  const handleCancel = () => {
    setForm(formToState(profile));
    setIsEditing(false);
  };

  const handleLinkProvider = async (provider: "google" | "github") => {
    setLinkingProvider(provider);
    try {
      if (provider === "google") {
        await linkGoogleAccount();
      } else {
        await linkGithubAccount();
      }
      await auth.currentUser?.reload();
      const ids = (auth.currentUser?.providerData || []).map((p) => p?.providerId).filter(Boolean);
      setLinkedProviders({
        google: ids.includes("google.com"),
        github: ids.includes("github.com"),
      });
      toast({
        title: "Account linked",
        description: `Your ${provider === "google" ? "Google" : "GitHub"} account is connected.`,
      });
    } catch (err: any) {
      toast({
        title: "Linking failed",
        description: err?.message || "Could not link that account.",
        variant: "destructive",
      });
    } finally {
      setLinkingProvider(null);
    }
  };

  const generateInviteMutation = useMutation({
    mutationFn: async () => {
      const token = await getAuthToken();
      if (!token) throw new Error("Not authenticated");
      const response = await fetch("/api/invites/generate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "standard" }),
      });
      if (!response.ok) throw new Error("Failed to generate invite");
      return response.json();
    },
    onSuccess: (data) => {
      setInviteCode(data.code);
      setInviteExpiresAt(data.expiresAt);
      toast({ title: "Invite created", description: "Share this link with someone." });
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message || "Could not generate an invite.",
        variant: "destructive",
      });
    },
  });

  // GhostLinks are created from the chat page; this dialog only makes the
  // standard, lasting invite.
  const handleGenerateInvite = () => generateInviteMutation.mutate();

  const inviteUrl = inviteCode ? `${window.location.origin}/invite/${inviteCode}` : "";

  const copyInviteToClipboard = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    toast({ title: "Copied", description: "Invite link copied to your clipboard." });
  };

  const handleShare = async () => {
    if (!inviteUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join me on AI Meet", url: inviteUrl });
        return;
      } catch {
        // Dismissed, or sharing is unavailable — fall back to the clipboard.
      }
    }
    copyInviteToClipboard();
  };

  const displayName = profile?.name || authUser?.displayName || "User";
  const displayEmail = profile?.email || authUser?.email || "";
  const avatarUrl =
    profile?.avatar || authUser?.photoURL || getAvatarUrl(authUser?.photoURL, authUser?.uid);
  const membership = describeMembership(profile?.createdAt);

  const statCards = [
    { label: "Connections", value: stats?.friends },
    { label: "Group chats", value: stats?.groups },
    { label: "Meetings hosted", value: stats?.meetingsHosted },
  ];

  const websiteHref = profile?.website
    ? /^https?:\/\//i.test(profile.website)
      ? profile.website
      : `https://${profile.website}`
    : undefined;

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <Skeleton className="h-8 w-32" />
        <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Skeleton className="h-20 w-20 shrink-0 rounded-full" />
            <div className="w-full space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <div className="mt-6 grid grid-cols-3 gap-3 border-t border-border/60 pt-6">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-80 rounded-2xl lg:col-span-2" />
          <Skeleton className="h-36 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-7xl">
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{error instanceof Error ? error.message : "Could not load your profile."}</span>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mx-auto w-full max-w-7xl space-y-6"
    >
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How you appear to the people you connect with.
        </p>
      </header>

      {/* Identity. The name, handle and join date live here and nowhere else:
          repeating them in a sidebar card only made the page look fuller. */}
      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar className="h-20 w-20 shrink-0 border border-border">
              <AvatarImage src={avatarUrl} alt={displayName} className="object-cover" />
              <AvatarFallback className="text-xl">
                {getInitials(displayName, displayEmail)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 space-y-1">
              <h2 className="truncate text-xl font-semibold tracking-tight">{displayName}</h2>
              <p className="truncate text-sm text-muted-foreground">
                @{profile?.username || "username"}
              </p>
              <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {membership}
              </p>
            </div>
          </div>

          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" className="shrink-0 gap-2">
                <QrCode className="h-4 w-4" aria-hidden="true" />
                Create invite
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Share an invite</DialogTitle>
                <DialogDescription>
                  Anyone who opens this link connects with you for good. The link can be opened for
                  24 hours.
                </DialogDescription>
              </DialogHeader>

              {!inviteCode ? (
                <Button
                  onClick={handleGenerateInvite}
                  disabled={generateInviteMutation.isPending}
                  className="gap-2"
                >
                  {generateInviteMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  )}
                  Generate invite link
                </Button>
              ) : (
                <div className="space-y-4">
                  {/* Drawn here, not fetched. This used to be an <img> at
                      api.qrserver.com with the invite URL in the query string,
                      which handed every invite anyone generated to a third
                      party — and put it in that service's logs — to render a
                      picture the browser can draw itself.

                      White stays hardcoded: a QR needs a light quiet zone to
                      scan, so inverting it in dark mode would break it. */}
                  <div className="flex justify-center">
                    <div className="rounded-lg border border-border bg-white p-3">
                      <QRCodeSVG
                        value={inviteUrl}
                        size={152}
                        level="M"
                        marginSize={0}
                        title={`QR code for ${inviteUrl}`}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Invite link
                    </Label>
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-1.5">
                      <span className="flex-1 select-all truncate px-2 text-sm">{inviteUrl}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        onClick={copyInviteToClipboard}
                        aria-label="Copy invite link"
                      >
                        <Copy className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>

                  <Button className="w-full gap-2" onClick={handleShare}>
                    <Share2 className="h-4 w-4" aria-hidden="true" />
                    Share
                  </Button>

                  {/* A fixed expiry rather than a countdown: the old one was
                      computed once and sat there going stale. */}
                  {inviteExpiresAt && (
                    <p className="text-center text-xs text-muted-foreground">
                      Can be opened until{" "}
                      {new Date(inviteExpiresAt).toLocaleString(undefined, {
                        day: "numeric",
                        month: "short",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  )}

                  <Button
                    variant="ghost"
                    className="h-8 w-full text-xs text-muted-foreground"
                    onClick={() => {
                      setInviteCode(null);
                      setInviteExpiresAt(null);
                    }}
                  >
                    Create another
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>

        <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-border/60 pt-6">
          {statCards.map((stat) => (
            <div key={stat.label} className="rounded-xl border border-border/60 bg-muted/40 p-3">
              <dt className="text-[11px] font-medium uppercase leading-tight tracking-wide text-muted-foreground">
                {stat.label}
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{stat.value ?? "\u2014"}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Details */}
        <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm sm:p-6 lg:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">Profile details</h2>
              <p className="mt-1 text-sm text-muted-foreground">Your bio and contact details.</p>
            </div>
            {!isEditing && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-2"
                onClick={() => setIsEditing(true)}
              >
                <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
                Edit
              </Button>
            )}
          </div>

          {/* Email is set by the sign-in provider, so it shows in both modes
              and is never an input. */}
          <div className="mt-6 min-w-0 border-b border-border/60 pb-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Email
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="truncate text-sm">{displayEmail || "Not set"}</span>
              <Badge
                variant={profile?.isEmailVerified ? "secondary" : "outline"}
                className="gap-1 font-normal"
              >
                {profile?.isEmailVerified && (
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                )}
                {profile?.isEmailVerified ? "Verified" : "Not verified"}
              </Badge>
            </div>
          </div>

          {isEditing ? (
            <div className="mt-5 space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Full name</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  value={form.bio}
                  onChange={(e) => setForm({ ...form, bio: e.target.value })}
                  placeholder="A sentence or two about you."
                  className="min-h-24"
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <Input
                    id="location"
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    placeholder="City, Country"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    value={form.website}
                    onChange={(e) => setForm({ ...form, website: e.target.value })}
                    placeholder="example.com"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone number</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+1 555 000 0000"
                />
                <p className="text-xs text-muted-foreground">
                  Only people you are connected with can see this.
                </p>
              </div>

              <div className="flex justify-end gap-2 border-t border-border/60 pt-5">
                <Button
                  variant="ghost"
                  onClick={handleCancel}
                  disabled={updateProfileMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={updateProfileMutation.isPending}
                  className="gap-2"
                >
                  {updateProfileMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="h-4 w-4" aria-hidden="true" />
                  )}
                  Save changes
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-5">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Bio
                </p>
                <p
                  className={`mt-1 whitespace-pre-wrap text-sm ${
                    profile?.bio ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {profile?.bio || "Not set"}
                </p>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <ReadField label="Location" value={profile?.location} />
                <ReadField label="Website" value={profile?.website} href={websiteHref} />
              </div>

              <ReadField label="Phone number" value={profile?.phone} />
            </div>
          )}
        </section>

        {/* Connected accounts */}
        <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-semibold">Connected accounts</h2>
          <p className="mt-1 text-sm text-muted-foreground">Link a provider to sign in with it.</p>
          <div className="mt-4 space-y-2">
            {PROVIDERS.map(({ id, label }) => (
              <div
                key={id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/40 p-3"
              >
                <span className="text-sm font-medium">{label}</span>
                {linkedProviders[id] ? (
                  <Badge variant="secondary" className="gap-1 font-normal">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                    Connected
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleLinkProvider(id)}
                    disabled={linkingProvider === id}
                    className="gap-1.5"
                  >
                    {linkingProvider === id && (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    )}
                    Connect
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </motion.div>
  );
}

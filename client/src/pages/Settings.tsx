import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Button } from "@/components/ui/button";

import { Camera, Mic, Palette, ShieldAlert, Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/components/ThemeProvider";
import { motion } from "framer-motion";
import { useSettings } from "@/lib/settings";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { DeleteAccountDialog } from "@/components/DeleteAccountDialog";

export default function Settings() {
  const { theme } = useTheme();
  const { toast } = useToast();
  const { settings, updateSettings } = useSettings();
  const { logout } = useAuth();
  const [, navigate] = useLocation();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: {
        type: "spring",
        stiffness: 100,
        damping: 15,
      },
    },
  };

  return (
    <div className="flex-1 overflow-auto p-6 md:p-10">
      <motion.div
        className="max-w-4xl mx-auto space-y-8"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVariants}>
          <h1 className="text-4xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
            Preferences
          </h1>
          <p className="text-lg text-muted-foreground">
            Manage your camera, microphone, and call experience.
          </p>
        </motion.div>

        <motion.div variants={itemVariants} className="grid gap-6">
          {/* Video Settings */}
          <div className="rounded-3xl border border-border bg-muted/40 backdrop-blur-md overflow-hidden">
            <div className="p-6 border-b border-border bg-muted/40">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500">
                  <Camera className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Video Settings</h2>
                  <p className="text-sm text-muted-foreground">
                    Configure your camera and visual preferences
                  </p>
                </div>
              </div>
            </div>
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between group">
                <div className="space-y-1">
                  <Label
                    htmlFor="auto-video"
                    className="text-base font-medium group-hover:text-primary transition-colors"
                  >
                    Auto-join with video
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically turn on camera when joining calls
                  </p>
                </div>
                <Switch
                  id="auto-video"
                  checked={settings.autoJoinVideo}
                  onCheckedChange={(checked) => {
                    updateSettings({ autoJoinVideo: checked });
                    toast({
                      title: "Settings saved",
                      description: checked
                        ? "Video will auto-join on calls"
                        : "Video will be off by default",
                    });
                  }}
                  className="data-[state=checked]:bg-blue-500"
                />
              </div>

              <div className="space-y-3 pt-2">
                <Label htmlFor="video-quality" className="text-base font-medium">
                  Video Quality
                </Label>
                <Select
                  value={settings.videoQuality}
                  onValueChange={(value: "sd" | "hd" | "full-hd") => {
                    updateSettings({ videoQuality: value });
                    toast({
                      title: "Settings saved",
                      description: `Video quality set to ${value.toUpperCase()}`,
                    });
                  }}
                >
                  <SelectTrigger
                    id="video-quality"
                    className="h-12 bg-muted/40 border-border focus:ring-blue-500/20 rounded-xl"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background/95 backdrop-blur-xl border-border">
                    <SelectItem value="sd">Standard Definition (480p)</SelectItem>
                    <SelectItem value="hd">High Definition (720p)</SelectItem>
                    <SelectItem value="full-hd">Full HD (1080p)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Audio Settings */}
          <div className="rounded-3xl border border-border bg-muted/40 backdrop-blur-md overflow-hidden">
            <div className="p-6 border-b border-border bg-muted/40">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500">
                  <Mic className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Audio Settings</h2>
                  <p className="text-sm text-muted-foreground">
                    Configure your microphone and sound
                  </p>
                </div>
              </div>
            </div>
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between group">
                <div className="space-y-1">
                  <Label
                    htmlFor="auto-audio"
                    className="text-base font-medium group-hover:text-primary transition-colors"
                  >
                    Auto-join with audio
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically unmute when joining calls
                  </p>
                </div>
                <Switch
                  id="auto-audio"
                  checked={settings.autoJoinAudio}
                  onCheckedChange={(checked) => {
                    updateSettings({ autoJoinAudio: checked });
                    toast({
                      title: "Settings saved",
                      description: checked
                        ? "Audio will auto-join on calls"
                        : "Audio will be muted by default",
                    });
                  }}
                  className="data-[state=checked]:bg-emerald-500"
                />
              </div>

              <div className="space-y-3 pt-2">
                <Label htmlFor="audio-quality" className="text-base font-medium">
                  Audio Quality
                </Label>
                <Select
                  value={settings.audioQuality}
                  onValueChange={(value: "standard" | "high" | "studio") => {
                    updateSettings({ audioQuality: value });
                    toast({
                      title: "Settings saved",
                      description: `Audio quality set to ${value}`,
                    });
                  }}
                >
                  <SelectTrigger
                    id="audio-quality"
                    className="h-12 bg-muted/40 border-border focus:ring-emerald-500/20 rounded-xl"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background/95 backdrop-blur-xl border-border">
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="high">High Quality</SelectItem>
                    <SelectItem value="studio">Studio Quality</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* AI Features */}
          <div className="rounded-3xl border border-border bg-muted/40 backdrop-blur-md overflow-hidden">
            <div className="p-6 border-b border-border bg-muted/40">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-purple-500/10 text-purple-500">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">AI Features</h2>
                  <p className="text-sm text-muted-foreground">
                    Smart capabilities powered by FaceCall AI
                  </p>
                </div>
              </div>
            </div>
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between group">
                <div className="space-y-1">
                  <Label
                    htmlFor="emotion"
                    className="text-base font-medium group-hover:text-primary transition-colors"
                  >
                    Emotion Detection
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Real-time emotion analysis during calls
                  </p>
                </div>
                <Switch
                  id="emotion"
                  checked={settings.emotionDetection}
                  onCheckedChange={(checked) => {
                    updateSettings({ emotionDetection: checked });
                    toast({
                      title: "Settings saved",
                      description: checked
                        ? "Emotion detection enabled"
                        : "Emotion detection disabled",
                    });
                  }}
                  className="data-[state=checked]:bg-purple-500"
                />
              </div>
            </div>
          </div>

          {/* Appearance */}
          <div className="rounded-3xl border border-border bg-muted/40 backdrop-blur-md overflow-hidden">
            <div className="p-6 border-b border-border bg-muted/40">
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
                  <Label className="text-base font-medium group-hover:text-primary transition-colors">
                    Theme
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Currently using{" "}
                    <span className="capitalize font-medium text-foreground">{theme}</span> mode
                  </p>
                </div>
                <ThemeToggle />
              </div>
            </div>
          </div>

          {/* Account */}
          <div className="rounded-3xl border border-destructive/30 bg-destructive/5 backdrop-blur-md overflow-hidden">
            <div className="p-6 border-b border-destructive/30 bg-destructive/5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-destructive/10 text-destructive">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Account</h2>
                  <p className="text-sm text-muted-foreground">Actions here cannot be undone</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <Label className="text-base font-medium">Delete account</Label>
                  <p className="text-sm text-muted-foreground">
                    Removes your profile, messages, connections and hosted meetings for good.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  onClick={() => setDeleteOpen(true)}
                  className="sm:shrink-0"
                >
                  Delete account
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>

      <DeleteAccountDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={async () => {
          setDeleteOpen(false);
          toast({
            title: "Account deleted",
            description: "Everything tied to it has been removed.",
          });
          // The account is gone, so the session token points at nothing; sign
          // out locally and leave, or every request from here answers 401.
          await logout();
          navigate("/");
        }}
      />
    </div>
  );
}

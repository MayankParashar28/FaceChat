import { useLocation, useRoute } from "wouter";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Clock, Users, Smile, CheckCircle, Download, Star, ArrowLeft,
  Loader2, AlertCircle, Sparkles, Zap, Heart, ThumbsUp, Brain,
  Share2, Calendar, LogOut
} from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";
import { motion } from "framer-motion";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface MeetingParticipant {
  _id?: string;
  name?: string;
  email?: string;
  avatar?: string;
}

interface MeetingAnalytics {
  totalDuration?: number;
  participantCount?: number;
  engagementScore?: number;
  reactions?: Record<string, number>;
  emotionData?: {
    emotion?: string;
    percentage?: number;
    timestamp?: string;
    count?: number;
  }[];
}

interface MeetingDetail {
  _id: string;
  title: string;
  startTime: string;
  endTime?: string;
  status: "scheduled" | "active" | "ended";
  roomId: string;
  participants: (MeetingParticipant | string)[];
  analytics?: MeetingAnalytics;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
}

function normalizeParticipants(participants: (MeetingParticipant | string)[] = []) {
  return participants.map((participant, index) => {
    if (typeof participant === "string") {
      return {
        id: participant,
        name: `Participant ${index + 1}`,
        attended: true,
      };
    }

    return {
      id: participant._id || `participant-${index}`,
      name: participant.name || participant.email || `Participant ${index + 1}`,
      attended: true,
    };
  });
}

// Helper to get icon and color for emotions


export default function CallSummary() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/summary/:callId");

  const callId = params?.callId;
  const isValidCallId = Boolean(callId && callId !== "new");

  const { data: meeting, isLoading, isError, error } = useQuery<MeetingDetail>({
    queryKey: [`/api/meetings/${callId}`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: isValidCallId,
  });

  const summaryData = useMemo(() => {
    if (!meeting) {
      return null;
    }

    const participants = normalizeParticipants(meeting.participants);
    const participantCount = meeting.analytics?.participantCount || participants.length;
    const attendedCount = participants.filter((p) => p.attended).length;
    const attendanceRate = participantCount ? Math.round((attendedCount / participantCount) * 100) : 0;

    const startTime = meeting.startTime ? new Date(meeting.startTime) : null;
    const endTime = meeting.endTime ? new Date(meeting.endTime) : undefined;
    const durationMinutes = (() => {
      // 1. If we have explicit start and end times, calculate from them
      if (startTime && endTime) {
        return Math.max(1, Math.ceil((endTime.getTime() - startTime.getTime()) / (1000 * 60)));
      }

      // 2. If we have a stored total duration > 0, use it
      if (meeting.analytics?.totalDuration && meeting.analytics.totalDuration > 0) {
        return meeting.analytics.totalDuration;
      }

      // 3. If active/no end time, calculate from now
      if (startTime) {
        return Math.max(1, Math.ceil((new Date().getTime() - startTime.getTime()) / (1000 * 60)));
      }

      return 0;
    })();

    const formattedDuration = durationMinutes !== null && durationMinutes !== undefined ? formatDuration(durationMinutes) : "—";

    // Aggregate emotion data
    const emotionMap = new Map<string, number>();
    (meeting.analytics?.emotionData || []).forEach(item => {
      const e = item.emotion || "Neutral";
      const count = item.count || 1;
      emotionMap.set(e, (emotionMap.get(e) || 0) + count);
    });

    const totalEmotions = Array.from(emotionMap.values()).reduce((a, b) => a + b, 0);
    const aggregatedEmotions = Array.from(emotionMap.entries()).map(([emotion, count]) => ({
      emotion,
      percentage: totalEmotions ? Math.round((count / totalEmotions) * 100) : 0,
    })).sort((a, b) => b.percentage - a.percentage);

    // Find top emotion
    const topEmotion = aggregatedEmotions.length > 0 ? aggregatedEmotions[0] : { emotion: "Neutral", percentage: 0 };

    // Process reactions
    const reactions = Object.entries(meeting.analytics?.reactions || {})
      .map(([emoji, count]) => ({ emoji, count }))
      .sort((a, b) => b.count - a.count);

    return {
      title: meeting.title || "Call Summary",
      date: startTime ? startTime.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : "",
      duration: formattedDuration,
      participants,
      emotions: aggregatedEmotions,
      reactions,
      topEmotion,
      stats: {
        totalParticipants: participantCount,
        attendanceRate,
        avgEngagement: meeting.analytics?.engagementScore ?? 0,
      },
    };
  }, [meeting]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background/95 backdrop-blur-3xl flex items-center justify-center">
        <div className="relative">
          <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full animate-pulse" />
          <Loader2 className="h-12 w-12 animate-spin text-primary relative z-10" />
        </div>
      </div>
    );
  }

  if (!isValidCallId || isError || !summaryData) {
    return (
      <div className="min-h-screen bg-background/95 backdrop-blur-3xl flex items-center justify-center p-6">
        <Card className="max-w-md w-full border-border/50 bg-card/95 backdrop-blur-xl">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
              <AlertCircle className="h-6 w-6 text-red-400" />
            </div>
            <CardTitle className="text-foreground">Unable to load summary</CardTitle>
            <CardDescription className="text-muted-foreground">
              {(error as Error)?.message || "The call summary could not be found or is still processing."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button onClick={() => setLocation("/dashboard")} variant="outline" className="border-border/50 hover:bg-accent hover:text-accent-foreground">
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }



  return (

    <div className="relative min-h-screen overflow-auto bg-background">
      {/* Background Gradients */}
      <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:50px_50px]" />
      <div className="absolute top-0 left-0 w-full h-[500px] bg-primary/10 blur-[100px] rounded-full opacity-50 pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-full h-[500px] bg-blue-500/10 blur-[100px] rounded-full opacity-50 pointer-events-none" />

      <div className="max-w-5xl mx-auto space-y-8 pb-32 p-6 relative z-10">
        <div className="max-w-5xl mx-auto space-y-8 pb-24">

          {/* Title Section */}
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/60">
              {summaryData?.title}
            </h1>
            <p className="text-muted-foreground">Call Summary & Analytics</p>
          </div>



          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: "Duration", value: summaryData?.duration, icon: Clock, color: "text-blue-400" },
              { label: "Participants", value: summaryData?.stats.totalParticipants, icon: Users, color: "text-green-400" },
              { label: "Engagement", value: `${summaryData?.stats.avgEngagement}%`, icon: Zap, color: "text-yellow-400" },
            ].map((stat, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 + 0.2 }}
              >
                <Card className="border-border/50 bg-card/40 backdrop-blur-md hover:bg-accent/50 transition-all duration-300 hover:scale-[1.02] hover:shadow-lg group">
                  <CardContent className="p-6 flex items-center gap-5">
                    <div className={`p-4 rounded-2xl bg-background/50 ${stat.color} group-hover:scale-110 transition-transform duration-300`}>
                      <stat.icon className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">{stat.label}</p>
                      <p className="text-3xl font-bold text-foreground tracking-tight">{stat.value}</p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Emotion Breakdown */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              <Card className="h-full border-border/50 bg-card/50 backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <Brain className="w-5 h-5 text-primary" />
                    Emotion Breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {summaryData?.emotions.map((item, index) => (
                    <div key={index} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-foreground font-medium">{item.emotion}</span>
                        <span className="text-muted-foreground">{item.percentage}%</span>
                      </div>
                      <div className="h-2 bg-secondary/50 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${item.percentage}%` }}
                          transition={{ duration: 1, delay: 0.5 + index * 0.1 }}
                          className={`h-full rounded-full bg-gradient-to-r ${index === 0 ? 'from-primary to-primary/60' : 'from-secondary to-secondary/60'
                            }`}
                        />
                      </div>
                    </div>
                  ))}
                  {(!summaryData?.emotions || summaryData.emotions.length === 0) && (
                    <p className="text-muted-foreground text-center py-8">No emotion data available</p>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Reactions & Participants Stack */}
            <div className="space-y-8">
              {/* Top Reactions */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.4 }}
              >
                <Card className="border-border/50 bg-card/50 backdrop-blur-xl">
                  <CardHeader>
                    <CardTitle className="text-foreground flex items-center gap-2">
                      <Smile className="w-5 h-5 text-primary" />
                      Top Reactions
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-4">
                      {summaryData?.reactions.map((reaction, index) => (
                        <div key={index} className="flex flex-col items-center p-3 bg-secondary/20 rounded-xl min-w-[80px]">
                          <span className="text-3xl mb-1">{reaction.emoji}</span>
                          <span className="text-sm font-medium text-foreground">{reaction.count}</span>
                        </div>
                      ))}
                      {(!summaryData?.reactions || summaryData.reactions.length === 0) && (
                        <p className="text-muted-foreground w-full text-center py-4">No reactions recorded</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Participants List */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.5 }}
              >
                <Card className="h-full border-border/50 bg-card/50 backdrop-blur-xl">
                  <CardHeader>
                    <CardTitle className="text-foreground flex items-center gap-2">
                      <Users className="w-5 h-5 text-primary" />
                      Attendees
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                      {summaryData?.participants.map((participant, index) => (
                        <div
                          key={participant.id || index}
                          className="flex items-center justify-between p-3 rounded-xl bg-card/30 border border-border/50 hover:bg-accent/50 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <Avatar className="h-10 w-10 border border-border/50">
                              <AvatarFallback className="bg-primary/20 text-primary">
                                {participant.name
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")
                                  .toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium text-foreground">{participant.name}</span>
                          </div>
                          {participant.attended ? (
                            <Badge variant="secondary" className="bg-green-500/10 text-green-400 border-green-500/20">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Present
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-secondary/50 text-muted-foreground">
                              Absent
                            </Badge>
                          )}
                        </div>
                      ))}
                      {(!summaryData?.participants || summaryData.participants.length === 0) && (
                        <p className="text-muted-foreground text-center py-8">No participants recorded</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </div>
          </div>
          {/* Floating Action Dock */}
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50">
            <div className="flex items-center justify-between bg-background/80 backdrop-blur-2xl border border-border/50 p-2 rounded-full shadow-2xl ring-1 ring-white/10">
              <Button variant="ghost" className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-xl">
                <Download className="w-4 h-4 mr-2" />
                Recording
              </Button>
              <div className="w-px h-6 bg-border/50" />
              <Button
                variant="ghost"
                className="hover:bg-accent hover:text-accent-foreground text-muted-foreground"
                onClick={() => {
                  const text = `Check out my call summary: ${window.location.href}`;
                  if (navigator.share) {
                    navigator.share({ title: 'FaceCall Summary', text, url: window.location.href }).catch(console.error);
                  } else {
                    navigator.clipboard.writeText(text);
                    alert("Link copied to clipboard!");
                  }
                }}
              >
                <Share2 className="w-4 h-4 mr-2" />
                Share
              </Button>
              <div className="w-px h-6 bg-border/50" />

              <Dialog>
                <DialogTrigger asChild>
                  <Button className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl shadow-lg shadow-primary/20">
                    <Star className="w-4 h-4 mr-2" />
                    Rate Call
                  </Button>
                </DialogTrigger>
                <DialogContent className="glass-panel border-white/10 sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Rate Quality</DialogTitle>
                    <DialogDescription>How was the audio and video quality?</DialogDescription>
                  </DialogHeader>
                  <div className="flex justify-center gap-2 py-6">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Button
                        key={star}
                        variant="ghost"
                        size="lg"
                        className="hover:scale-110 transition-transform p-2"
                        onClick={() => {
                          // Mock backend call (rating logic)
                          // In a real app we'd save this to DB
                        }}
                      >
                        <Star className="w-8 h-8 fill-yellow-400 text-yellow-400" />
                      </Button>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2">
                    <DialogTrigger asChild>
                      <Button variant="ghost">Skip</Button>
                    </DialogTrigger>
                    <DialogTrigger asChild>
                      <Button>Submit Feedback</Button>
                    </DialogTrigger>
                  </div>
                </DialogContent>
              </Dialog>

              <div className="w-px h-6 bg-border/50" />

              <Button
                variant="ghost"
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl"
                onClick={() => setLocation("/dashboard")}
              >
                <LogOut className="w-4 h-4 mr-2" />
                Dashboard
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

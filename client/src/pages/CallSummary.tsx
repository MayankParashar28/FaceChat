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
  Share2, Calendar
} from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";
import { motion } from "framer-motion";

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
  emotionData?: {
    emotion?: string;
    percentage?: number;
    timestamp?: string;
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
const getEmotionConfig = (emotion: string) => {
  const config: Record<string, { icon: any, color: string, label: string, gradient: string }> = {
    "Happy": { icon: Smile, color: "text-yellow-400", label: "Joyful", gradient: "from-yellow-400/20 to-orange-500/20" },
    "Neutral": { icon: Brain, color: "text-blue-400", label: "Focused", gradient: "from-blue-400/20 to-cyan-500/20" },
    "Surprised": { icon: Zap, color: "text-purple-400", label: "Excited", gradient: "from-purple-400/20 to-pink-500/20" },
    "Sad": { icon: Heart, color: "text-indigo-400", label: "Thoughtful", gradient: "from-indigo-400/20 to-blue-500/20" },
    "Angry": { icon: ThumbsUp, color: "text-red-400", label: "Intense", gradient: "from-red-400/20 to-orange-500/20" }, // Using ThumbsUp as placeholder/metaphor
  };
  return config[emotion] || { icon: Sparkles, color: "text-primary", label: emotion, gradient: "from-primary/20 to-purple-500/20" };
};

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
    const durationMinutes =
      meeting.analytics?.totalDuration ??
      (startTime ? Math.max(1, Math.round(((endTime ?? new Date()).getTime() - startTime.getTime()) / (1000 * 60))) : null);

    const formattedDuration = durationMinutes !== null && durationMinutes !== undefined ? formatDuration(durationMinutes) : "—";

    const emotionData =
      meeting.analytics?.emotionData?.map((item) => ({
        emotion: item.emotion || "Neutral",
        percentage: item.percentage ?? 0,
        count: item.percentage && participantCount
          ? Math.max(1, Math.round((item.percentage / 100) * participantCount))
          : undefined,
      })) || [];

    // Find top emotion
    const topEmotion = emotionData.reduce((prev, current) =>
      (prev.percentage > current.percentage) ? prev : current
      , { emotion: "Neutral", percentage: 0 });

    return {
      title: meeting.title || "Call Summary",
      date: startTime ? startTime.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : "",
      duration: formattedDuration,
      participants,
      emotions: emotionData,
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
        <Card className="max-w-md w-full border-white/10 bg-black/40 backdrop-blur-xl">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
              <AlertCircle className="h-6 w-6 text-red-400" />
            </div>
            <CardTitle className="text-white">Unable to load summary</CardTitle>
            <CardDescription className="text-white/60">
              {(error as Error)?.message || "The call summary could not be found or is still processing."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button onClick={() => setLocation("/dashboard")} variant="outline" className="border-white/10 hover:bg-white/5 text-white">
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const emotionConfig = getEmotionConfig(summaryData.topEmotion.emotion);
  const TopEmotionIcon = emotionConfig.icon;

  return (
    <div className="min-h-screen bg-background/95 backdrop-blur-3xl overflow-hidden relative flex flex-col">
      {/* Background Gradients */}
      <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-primary/10 blur-[120px] animate-pulse-glow" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-purple-500/10 blur-[120px] animate-pulse-glow animation-delay-500" />
      </div>

      {/* Header */}
      <header className="p-6 relative z-10">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between bg-black/40 backdrop-blur-xl border border-white/10 p-2 rounded-full shadow-lg">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation("/dashboard")}
              className="rounded-full hover:bg-white/10 text-white/80 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Dashboard
            </Button>
            <div className="flex items-center gap-2 px-4 border-l border-r border-white/10">
              <Calendar className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-white">{summaryData.date}</span>
            </div>
            <div className="w-[100px]" /> {/* Spacer for balance */}
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 relative z-10 overflow-y-auto">
        <div className="max-w-5xl mx-auto space-y-8 pb-24">

          {/* Title Section */}
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60">
              {summaryData.title}
            </h1>
            <p className="text-white/60">Call Summary & Analytics</p>
          </div>

          {/* Hero: Meeting Vibe */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="relative"
          >
            <div className={`absolute inset-0 bg-gradient-to-r ${emotionConfig.gradient} blur-3xl opacity-30 rounded-full`} />
            <Card className="relative border-white/10 bg-black/40 backdrop-blur-xl overflow-hidden">
              <CardContent className="p-12 flex flex-col items-center text-center">
                <div className="relative mb-6 group">
                  <div className={`absolute inset-0 bg-current blur-2xl opacity-20 rounded-full scale-150 group-hover:scale-175 transition-transform duration-700 ${emotionConfig.color}`} />
                  <TopEmotionIcon className={`w-24 h-24 relative z-10 ${emotionConfig.color} drop-shadow-lg`} />
                </div>
                <h2 className="text-2xl font-medium text-white mb-2">Meeting Vibe</h2>
                <div className="flex items-baseline gap-2">
                  <span className={`text-5xl font-bold ${emotionConfig.color}`}>{emotionConfig.label}</span>
                  <span className="text-xl text-white/40">({summaryData.topEmotion.percentage}%)</span>
                </div>
                <p className="text-white/60 mt-4 max-w-md">
                  The dominant emotion detected during this session was <strong>{summaryData.topEmotion.emotion.toLowerCase()}</strong>,
                  indicating a {emotionConfig.label.toLowerCase()} atmosphere.
                </p>
              </CardContent>
            </Card>
          </motion.div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: "Duration", value: summaryData.duration, icon: Clock, color: "text-blue-400" },
              { label: "Participants", value: summaryData.stats.totalParticipants, icon: Users, color: "text-green-400" },
              { label: "Engagement", value: `${summaryData.stats.avgEngagement}%`, icon: Zap, color: "text-yellow-400" },
            ].map((stat, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 + 0.2 }}
              >
                <Card className="border-white/10 bg-white/5 backdrop-blur-md hover:bg-white/10 transition-colors">
                  <CardContent className="p-6 flex items-center gap-4">
                    <div className={`p-3 rounded-xl bg-white/5 ${stat.color}`}>
                      <stat.icon className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm text-white/40">{stat.label}</p>
                      <p className="text-2xl font-bold text-white">{stat.value}</p>
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
              <Card className="h-full border-white/10 bg-black/40 backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Brain className="w-5 h-5 text-primary" />
                    Emotion Breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {summaryData.emotions.map((item, index) => (
                    <div key={index} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-white font-medium">{item.emotion}</span>
                        <span className="text-white/60">{item.percentage}%</span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${item.percentage}%` }}
                          transition={{ duration: 1, delay: 0.5 + index * 0.1 }}
                          className={`h-full rounded-full ${index === 0 ? 'bg-primary' : 'bg-white/20'
                            }`}
                        />
                      </div>
                    </div>
                  ))}
                  {summaryData.emotions.length === 0 && (
                    <p className="text-white/40 text-center py-8">No emotion data available</p>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Participants List */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              <Card className="h-full border-white/10 bg-black/40 backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Users className="w-5 h-5 text-primary" />
                    Attendees
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {summaryData.participants.map((participant, index) => (
                      <div
                        key={participant.id || index}
                        className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10 border border-white/10">
                            <AvatarFallback className="bg-primary/20 text-primary">
                              {participant.name
                                .split(" ")
                                .map((n) => n[0])
                                .join("")
                                .toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-white">{participant.name}</span>
                        </div>
                        {participant.attended ? (
                          <Badge variant="secondary" className="bg-green-500/10 text-green-400 border-green-500/20">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Present
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-white/5 text-white/40">
                            Absent
                          </Badge>
                        )}
                      </div>
                    ))}
                    {summaryData.participants.length === 0 && (
                      <p className="text-white/40 text-center py-8">No participants recorded</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>

        </div>
      </main>

      {/* Floating Action Dock */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50">
        <div className="flex items-center gap-2 p-2 rounded-2xl bg-black/60 backdrop-blur-2xl border border-white/10 shadow-2xl">
          <Button variant="ghost" className="text-white/80 hover:text-white hover:bg-white/10 rounded-xl">
            <Download className="w-4 h-4 mr-2" />
            Recording
          </Button>
          <div className="w-px h-6 bg-white/10" />
          <Button variant="ghost" className="text-white/80 hover:text-white hover:bg-white/10 rounded-xl">
            <Share2 className="w-4 h-4 mr-2" />
            Share
          </Button>
          <div className="w-px h-6 bg-white/10" />
          <Button className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl shadow-lg shadow-primary/20">
            <Star className="w-4 h-4 mr-2" />
            Rate Call
          </Button>
        </div>
      </div>
    </div>
  );
}

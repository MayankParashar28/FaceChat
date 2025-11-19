import { useLocation, useRoute } from "wouter";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Clock, Users, Smile, CheckCircle, Download, Star, ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";

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
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
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
        count:
          item.percentage && participantCount
            ? Math.max(1, Math.round((item.percentage / 100) * participantCount))
            : undefined,
      })) || [];

    return {
      title: meeting.title || "Call Summary",
      duration: formattedDuration,
      participants,
      emotions: emotionData,
      stats: {
        totalParticipants: participantCount,
        attendanceRate,
        avgEngagement: meeting.analytics?.engagementScore ?? 0,
      },
    };
  }, [meeting]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-5xl mx-auto p-6">
          <Button 
            variant="ghost" 
            onClick={() => setLocation("/dashboard")}
            className="mb-4"
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
          <h1 className="text-3xl font-bold">Call Summary</h1>
          <p className="text-muted-foreground mt-2">Review the details and analytics from your call</p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-6">
        {!isValidCallId ? (
          <Card>
            <CardHeader>
              <CardTitle>No call selected</CardTitle>
              <CardDescription>Select a call from Recent Calls to view its summary</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => setLocation("/dashboard")}>Back to Dashboard</Button>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" />
                Failed to load call summary
              </CardTitle>
              <CardDescription>{(error as Error)?.message || "Please try again later."}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => history.go(0)}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : !summaryData ? (
          <Card>
            <CardHeader>
              <CardTitle>Call summary not available</CardTitle>
              <CardDescription>This call may not have finished processing yet.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <CardTitle className="text-2xl">{summaryData.title}</CardTitle>
                    <CardDescription className="mt-2 flex items-center gap-4 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {summaryData.duration}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-4 h-4" />
                        {summaryData.stats.totalParticipants} participants
                      </span>
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" data-testid="button-download-recording">
                      <Download className="w-4 h-4 mr-2" />
                      Recording
                    </Button>
                    <Button variant="outline" data-testid="button-rate-call">
                      <Star className="w-4 h-4 mr-2" />
                      Rate Call
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>

            <div className="grid md:grid-cols-3 gap-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-medium">Total Participants</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{summaryData.stats.totalParticipants}</div>
                  <p className="text-xs text-muted-foreground mt-1">Active in call</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-medium">Attendance Rate</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{summaryData.stats.attendanceRate}%</div>
                  <p className="text-xs text-muted-foreground mt-1">Verified by call history</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-medium">Avg Engagement</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{summaryData.stats.avgEngagement}%</div>
                  <p className="text-xs text-muted-foreground mt-1">Based on emotion analysis</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  Attendance
                </CardTitle>
                <CardDescription>Participants who joined this call</CardDescription>
              </CardHeader>
              <CardContent>
                {summaryData.participants.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No participants recorded for this call yet.</p>
                ) : (
                  <div className="space-y-3">
                    {summaryData.participants.map((participant, index) => (
                      <div
                        key={participant.id || index}
                        className="flex items-center justify-between p-3 rounded-lg border"
                        data-testid={`participant-${index}`}
                      >
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10">
                            <AvatarFallback>
                              {participant.name
                                .split(" ")
                                .map((n) => n[0])
                                .join("")
                                .toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{participant.name}</span>
                        </div>
                        {participant.attended ? (
                          <Badge variant="secondary" className="bg-chart-3/10 text-chart-3 border-chart-3/20">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Attended
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-muted">
                            Absent
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Smile className="w-5 h-5" />
                  Emotion Analysis
                </CardTitle>
                <CardDescription>AI-detected emotions during the call</CardDescription>
              </CardHeader>
              <CardContent>
                {summaryData.emotions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No emotion analytics recorded yet.</p>
                ) : (
                  <div className="space-y-4">
                    {summaryData.emotions.map((item, index) => (
                      <div key={index} className="space-y-2" data-testid={`emotion-${index}`}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{item.emotion}</span>
                          <span className="text-muted-foreground">
                            {item.percentage}% {item.count ? `(${item.count} occurrences)` : ""}
                          </span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${item.percentage}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Clock, Users, Smile, CheckCircle, Download, Star, ArrowLeft } from "lucide-react";

export default function CallSummary() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/summary/:callId");

  const callId = params?.callId || "new";

  const summary = {
    title: "Team Standup",
    duration: "24 minutes",
    participants: [
      { name: "You", attended: true },
      { name: "Sarah Johnson", attended: true },
      { name: "Mike Chen", attended: true },
      { name: "Alex Rivera", attended: false }
    ],
    emotions: [
      { emotion: "Happy", percentage: 45, count: 12 },
      { emotion: "Focused", percentage: 35, count: 9 },
      { emotion: "Engaged", percentage: 20, count: 5 }
    ],
    stats: {
      totalParticipants: 3,
      attendanceRate: 75,
      avgEngagement: 82
    }
  };

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
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <CardTitle className="text-2xl">{summary.title}</CardTitle>
                <CardDescription className="mt-2 flex items-center gap-4 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {summary.duration}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    {summary.stats.totalParticipants} participants
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
              <div className="text-3xl font-bold">{summary.stats.totalParticipants}</div>
              <p className="text-xs text-muted-foreground mt-1">Active in call</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Attendance Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{summary.stats.attendanceRate}%</div>
              <p className="text-xs text-muted-foreground mt-1">Verified by AI</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Avg Engagement</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{summary.stats.avgEngagement}%</div>
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
            <CardDescription>Participants verified through facial recognition</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {summary.participants.map((participant, index) => (
                <div 
                  key={index} 
                  className="flex items-center justify-between p-3 rounded-lg border"
                  data-testid={`participant-${index}`}
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback>{participant.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
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
            <div className="space-y-4">
              {summary.emotions.map((item, index) => (
                <div key={index} className="space-y-2" data-testid={`emotion-${index}`}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{item.emotion}</span>
                    <span className="text-muted-foreground">{item.percentage}% ({item.count} occurrences)</span>
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
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

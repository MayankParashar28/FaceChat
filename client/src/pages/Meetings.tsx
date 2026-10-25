import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import {
  Calendar as CalendarIcon,
  Plus,
  Clock,
  Video,
  User,
  Loader2,
  CalendarPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import { endOfMonth, format, isSameDay, startOfMonth } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface Meeting {
  _id: string;
  title: string;
  startTime: string; // ISO string — the slot it was booked for
  actualStartTime?: string; // when the call actually began
  endTime?: string;
  roomId: string;
  participants: unknown[];
  status: "scheduled" | "active" | "ended";
  analytics?: { totalDuration?: number };
}

interface MeetingTotals {
  upcoming: number;
  totalMinutes: number;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * How long the call lasted, in the same order of precedence the server uses
 * for "Time in calls" beside the calendar, so a row and the total cannot
 * disagree: the duration measured when the call ended, else the span from when
 * the call actually began — not from the slot it was booked for, which for a
 * meeting held hours late measured the wait rather than the call.
 */
function durationMinutes(meeting: Meeting): number | null {
  // A meeting that has not ended has no duration, and the status badge beside
  // this already says so. A restarted meeting still carries the previous
  // session's figure, so endTime decides, not the figure.
  if (!meeting.endTime) return null;
  if (meeting.analytics?.totalDuration && meeting.analytics.totalDuration > 0) {
    return meeting.analytics.totalDuration;
  }
  const start = new Date(meeting.actualStartTime ?? meeting.startTime).getTime();
  const minutes = Math.round((new Date(meeting.endTime).getTime() - start) / 60000);
  return minutes > 0 ? minutes : 0;
}

/** Minutes as something readable: "0m", "45m", "3h 20m". */
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

const STATUS_LABEL: Record<Meeting["status"], string> = {
  scheduled: "Scheduled",
  active: "In progress",
  ended: "Ended",
};

export default function Meetings() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [date, setDate] = useState<Date | undefined>(new Date());
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [newMeetingTitle, setNewMeetingTitle] = useState("");
  const [newMeetingTime, setNewMeetingTime] = useState("10:00");

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);

  // The meetings in the month on screen.
  //
  // This used to ask for "/api/meetings" with no parameters, which returns the
  // ten most recent. Any day outside those ten showed as empty however many
  // meetings it held, and paging back a month showed nothing at all.
  const { data: meetings = [], isLoading } = useQuery<Meeting[]>({
    queryKey: ["/api/meetings", monthStart.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams({
        from: monthStart.toISOString(),
        to: monthEnd.toISOString(),
      });
      const res = await apiRequest("GET", `/api/meetings?${params}`);
      return res.json();
    },
    enabled: !!user,
  });

  // Totals across every meeting, not just the month in view.
  const { data: totals } = useQuery<MeetingTotals>({
    queryKey: ["/api/meetings/stats"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/meetings/stats");
      return res.json();
    },
    enabled: !!user,
  });

  // Create meeting mutation
  const createMeetingMutation = useMutation({
    mutationFn: async (data: { title: string; startTime: string }) => {
      // Use the shared apiRequest helper so auth works for both Firebase and
      // DB (email/password) logins, and mark the meeting as scheduled.
      const res = await apiRequest("POST", "/api/meetings", {
        ...data,
        status: "scheduled",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/meetings/stats"] });
      // The dashboard's recent-calls list keys off the URL it fetches, so the
      // prefix above does not reach it.
      queryClient.invalidateQueries({ queryKey: ["/api/meetings?limit=10"] });
      setIsScheduleOpen(false);
      setNewMeetingTitle("");
      setNewMeetingTime("10:00");
      toast({
        title: "Meeting Scheduled",
        description: "Your meeting has been successfully scheduled.",
      });
    },
    onError: (error: Error) => {
      console.error("Meeting creation error:", error);
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const selectedDateMeetings = meetings.filter(
    (m) => date && isSameDay(new Date(m.startTime), date)
  );

  const addToGoogleCalendar = (meeting: Meeting) => {
    const startTime = new Date(meeting.startTime);
    const endTime = meeting.endTime
      ? new Date(meeting.endTime)
      : new Date(startTime.getTime() + 60 * 60 * 1000); // Default to 1 hour

    const formatTime = (date: Date) => date.toISOString().replace(/-|:|\.\d\d\d/g, "");

    const url = new URL("https://calendar.google.com/calendar/render");
    url.searchParams.append("action", "TEMPLATE");
    url.searchParams.append("text", meeting.title);
    url.searchParams.append("dates", `${formatTime(startTime)}/${formatTime(endTime)}`);
    url.searchParams.append(
      "details",
      `Join meeting: ${window.location.origin}/call/${meeting.roomId}`
    );

    window.open(url.toString(), "_blank");
  };

  // Days with something on them, so the calendar marks them instead of being
  // a plain date picker.
  const daysWithMeetings = meetings.map((m) => new Date(m.startTime));

  return (
    <div className="flex flex-col h-full w-full overflow-hidden relative">
      <header className="flex items-center justify-between gap-4 p-6 border-b border-border bg-card/60 backdrop-blur-sm z-10">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Meetings</h1>
        </div>
        <div className="flex items-center gap-4">
          <Dialog open={isScheduleOpen} onOpenChange={setIsScheduleOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 shadow-lg shadow-primary/20">
                <Plus className="w-4 h-4" />
                Schedule meeting
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] glass-panel border-border">
              <DialogHeader>
                <DialogTitle>Schedule meeting</DialogTitle>
                {/* The dialog has no date field of its own — it uses whichever
                    day the calendar has selected, so it has to say which. */}
                <DialogDescription>
                  {date
                    ? `On ${format(date, "EEEE, MMMM d, yyyy")}. Pick another day in the calendar to change it.`
                    : "Select a day in the calendar first."}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-1 md:grid-cols-4 items-start md:items-center gap-2 md:gap-4">
                  <Label htmlFor="title" className="text-left md:text-right">
                    Title
                  </Label>
                  <Input
                    id="title"
                    value={newMeetingTitle}
                    onChange={(e) => setNewMeetingTitle(e.target.value)}
                    className="col-span-1 md:col-span-3"
                    placeholder="Team Sync"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 items-start md:items-center gap-2 md:gap-4">
                  <Label htmlFor="time" className="text-left md:text-right">
                    Time
                  </Label>
                  <Input
                    id="time"
                    type="time"
                    value={newMeetingTime}
                    onChange={(e) => setNewMeetingTime(e.target.value)}
                    className="col-span-1 md:col-span-3"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => {
                    if (!newMeetingTitle.trim()) {
                      toast({
                        variant: "destructive",
                        title: "Title required",
                        description: "Give the meeting a name so you can recognise it later.",
                      });
                      return;
                    }
                    if (!date) {
                      toast({
                        variant: "destructive",
                        title: "Date required",
                        description: "Please select a date.",
                      });
                      return;
                    }
                    const [hours, minutes] = newMeetingTime.split(":").map(Number);
                    const selectedDate = new Date(date);
                    selectedDate.setHours(hours, minutes, 0, 0);

                    if (selectedDate.getTime() <= Date.now()) {
                      toast({
                        variant: "destructive",
                        title: "That time has passed",
                        description: "Pick a date and time in the future.",
                      });
                      return;
                    }

                    createMeetingMutation.mutate({
                      title: newMeetingTitle.trim(),
                      startTime: selectedDate.toISOString(),
                    });
                  }}
                  disabled={createMeetingMutation.isPending || !newMeetingTitle.trim()}
                >
                  {createMeetingMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Schedule
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6 scrollbar-hide">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Calendar Section */}
          <div className="lg:col-span-4 space-y-6">
            <Card className="bg-card border border-border/30 shadow-sm rounded-2xl overflow-hidden">
              <CardContent className="p-4 flex justify-center">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  month={month}
                  onMonthChange={setMonth}
                  modifiers={{ hasMeeting: daysWithMeetings }}
                  // A marker drawn with the day's own border: the project's
                  // hover-elevate/toggle-elevate utilities already own ::before
                  // and ::after on this button, so a dot drawn as a pseudo-
                  // element restyles the elevation overlay instead.
                  modifiersClassNames={{
                    hasMeeting:
                      "font-semibold border-b-2 border-b-primary aria-selected:border-b-primary-foreground",
                  }}
                  className="rounded-md border-none"
                />
              </CardContent>
            </Card>

            <Card className="bg-card border border-border/30 shadow-sm rounded-2xl p-6 space-y-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="p-3 rounded-full bg-primary/10 text-primary">
                  <Video className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Upcoming</p>
                  <p className="text-2xl font-bold">{totals ? totals.upcoming : "—"}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-primary/10 text-primary">
                  <Clock className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Time in calls</p>
                  <p className="text-2xl font-bold">
                    {totals ? formatDuration(totals.totalMinutes) : "—"}
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* Meetings List Section */}
          <div className="lg:col-span-8 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {date ? format(date, "MMMM d, yyyy") : "All Meetings"}
              </h2>
              <span className="text-sm text-muted-foreground">
                {plural(selectedDateMeetings.length, "meeting")}
              </span>
            </div>

            <div className="space-y-4">
              {isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {selectedDateMeetings.length > 0 ? (
                    selectedDateMeetings.map((meeting) => {
                      const minutes = durationMinutes(meeting);
                      return (
                        <motion.div
                          key={meeting._id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="group relative overflow-hidden rounded-xl p-4 hover:bg-accent/30 transition-all cursor-pointer flex items-center justify-between border-b border-border/20 last:border-0"
                        >
                          <div className="flex items-center gap-4">
                            <div className="flex flex-col items-center justify-center w-16 h-16 rounded-lg bg-muted/40 border border-border">
                              <span className="text-sm font-bold text-primary">
                                {format(new Date(meeting.startTime), "h:mm")}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(meeting.startTime), "a")}
                              </span>
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-lg group-hover:text-primary transition-colors">
                                  {meeting.title || "Untitled Meeting"}
                                </h3>
                                <Badge
                                  variant={meeting.status === "active" ? "default" : "secondary"}
                                  className="shrink-0"
                                >
                                  {STATUS_LABEL[meeting.status]}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                                {minutes !== null && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {formatDuration(minutes)}
                                  </span>
                                )}
                                <span className="flex items-center gap-1">
                                  {/* The real number. This used to fall back to 1
                                    for a meeting nobody had joined yet, so an
                                    empty room reported a participant. */}
                                  <User className="w-3 h-3" />
                                  {plural(meeting.participants?.length ?? 0, "participant")}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="outline"
                              size="icon"
                              className="border-primary/20 hover:bg-primary/10 hover:text-primary"
                              title="Add to Google Calendar"
                              onClick={() => addToGoogleCalendar(meeting)}
                            >
                              <CalendarPlus className="w-4 h-4" />
                            </Button>
                            {meeting.status !== "ended" && (
                              <Button
                                variant="outline"
                                className="border-primary/20 hover:bg-primary/10 hover:text-primary"
                                onClick={() => setLocation(`/call/${meeting.roomId}`)}
                              >
                                Join
                              </Button>
                            )}
                          </div>
                        </motion.div>
                      );
                    })
                  ) : (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex flex-col items-center justify-center py-12 px-4 text-center bg-card/30 rounded-2xl border border-border/20 border-dashed"
                    >
                      <div className="bg-primary/5 p-4 rounded-full mb-4">
                        <CalendarIcon className="w-8 h-8 text-primary/40" />
                      </div>
                      <h3 className="text-base font-semibold text-foreground mb-1">
                        No meetings scheduled
                      </h3>
                      <p className="text-sm text-muted-foreground max-w-[250px] mb-6">
                        You have no meetings scheduled for this day.
                      </p>
                      <Button
                        onClick={() => setIsScheduleOpen(true)}
                        variant="outline"
                        className="gap-2 border-primary/20 hover:bg-primary/5 hover:text-primary"
                      >
                        <Plus className="w-4 h-4" />
                        Schedule meeting
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

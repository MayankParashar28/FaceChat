import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { getQueryFn } from "@/lib/queryClient";
import { auth } from "@/lib/firebase"; // Add this import
import { Calendar as CalendarIcon, Plus, Clock, Video, User, Loader2, CalendarPlus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format, isSameDay } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface Meeting {
    _id: string;
    title: string;
    startTime: string; // ISO string
    endTime?: string;
    roomId: string;
    participants: any[];
    status: "scheduled" | "active" | "ended";
}

export default function Meetings() {
    const [, setLocation] = useLocation();
    const { user } = useAuth();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [date, setDate] = useState<Date | undefined>(new Date());
    const [isScheduleOpen, setIsScheduleOpen] = useState(false);
    const [newMeetingTitle, setNewMeetingTitle] = useState("");
    const [newMeetingTime, setNewMeetingTime] = useState("10:00");

    // Fetch meetings
    const { data: meetings = [], isLoading } = useQuery<Meeting[]>({
        queryKey: ["/api/meetings"],
        queryFn: getQueryFn({ on401: "throw" }),
        enabled: !!user,
    });

    // Create meeting mutation
    const createMeetingMutation = useMutation({
        mutationFn: async (data: { title: string; startTime: string }) => {
            const token = await auth.currentUser?.getIdToken();
            if (!token) throw new Error("User not authenticated");

            const res = await fetch("/api/meetings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(data),
            });

            const result = await res.json();

            if (!res.ok) {
                throw new Error(result.error || result.message || "Failed to schedule meeting");
            }

            return result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
            setIsScheduleOpen(false);
            setNewMeetingTitle("");
            setNewMeetingTime("10:00");
            toast({ title: "Meeting Scheduled", description: "Your meeting has been successfully scheduled." });
        },
        onError: (error: Error) => {
            console.error("Meeting creation error:", error);
            toast({ variant: "destructive", title: "Error", description: error.message });
        }
    });

    const handleSchedule = () => {
        if (!date || !newMeetingTitle) return;

        const [hours, minutes] = newMeetingTime.split(":").map(Number);
        const meetingDate = new Date(date);
        meetingDate.setHours(hours, minutes);

        createMeetingMutation.mutate({
            title: newMeetingTitle,
            startTime: meetingDate.toISOString(),
        });
    };

    const selectedDateMeetings = meetings.filter(m =>
        date && isSameDay(new Date(m.startTime), date)
    );

    const addToGoogleCalendar = (meeting: Meeting) => {
        const startTime = new Date(meeting.startTime);
        const endTime = meeting.endTime ? new Date(meeting.endTime) : new Date(startTime.getTime() + 60 * 60 * 1000); // Default to 1 hour

        const formatTime = (date: Date) => date.toISOString().replace(/-|:|\.\d\d\d/g, "");

        const url = new URL("https://calendar.google.com/calendar/render");
        url.searchParams.append("action", "TEMPLATE");
        url.searchParams.append("text", meeting.title);
        url.searchParams.append("dates", `${formatTime(startTime)}/${formatTime(endTime)}`);
        url.searchParams.append("details", `Join meeting: ${window.location.origin}/call/${meeting.roomId}`);

        window.open(url.toString(), "_blank");
    };

    // Stats Logic
    const upcomingCount = meetings.filter(m => new Date(m.startTime) > new Date()).length;

    // Calculate total hours from ended meetings (assuming duration stored or calculated difference)
    // Detailed analytics is better for this, but simplistic estimation here:
    const totalDurationMinutes = meetings.reduce((acc, m) => {
        if (m.endTime) {
            return acc + (new Date(m.endTime).getTime() - new Date(m.startTime).getTime()) / (1000 * 60);
        }
        return acc;
    }, 0);
    const totalHours = (totalDurationMinutes / 60).toFixed(1);

    return (
        <div className="flex flex-col h-full w-full overflow-hidden relative">
            <header className="flex items-center justify-between gap-4 p-6 border-b border-white/5 bg-white/[0.02] backdrop-blur-sm z-10">
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
                        <DialogContent className="sm:max-w-[425px] glass-panel border-white/10">
                            <DialogHeader>
                                <DialogTitle>Schedule meeting</DialogTitle>
                                <DialogDescription>
                                    Create a new meeting event.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="title" className="text-right">
                                        Title
                                    </Label>
                                    <Input
                                        id="title"
                                        value={newMeetingTitle}
                                        onChange={(e) => setNewMeetingTitle(e.target.value)}
                                        className="col-span-3 bg-white/5 border-white/10"
                                        placeholder="Team Sync"
                                    />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="time" className="text-right">
                                        Time
                                    </Label>
                                    <Input
                                        id="time"
                                        type="time"
                                        value={newMeetingTime}
                                        onChange={(e) => setNewMeetingTime(e.target.value)}
                                        className="col-span-3 bg-white/5 border-white/10"
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button
                                    onClick={() => {
                                        if (!date) {
                                            toast({ variant: "destructive", title: "Error", description: "Please select a date." });
                                            return;
                                        }
                                        const [hours, minutes] = newMeetingTime.split(":").map(Number);
                                        const selectedDate = new Date(date);
                                        selectedDate.setHours(hours, minutes);

                                        createMeetingMutation.mutate({
                                            title: newMeetingTitle,
                                            startTime: selectedDate.toISOString()
                                        });
                                    }}
                                    disabled={createMeetingMutation.isPending}
                                >
                                    {createMeetingMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
                        <Card className="bg-card dark:bg-white/[0.03] border border-border/30 shadow-sm rounded-2xl overflow-hidden">
                            <CardContent className="p-4 flex justify-center">
                                <Calendar
                                    mode="single"
                                    selected={date}
                                    onSelect={setDate}
                                    className="rounded-md border-none"
                                />
                            </CardContent>
                        </Card>

                        <Card className="bg-card dark:bg-white/[0.03] border border-border/30 shadow-sm rounded-2xl p-6 space-y-6">
                            <div className="flex items-center gap-4 mb-4">
                                <div className="p-3 rounded-full bg-primary/10 text-primary">
                                    <Video className="w-6 h-6" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-muted-foreground">Upcoming</p>
                                    <p className="text-2xl font-bold">{upcomingCount}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="p-3 rounded-full bg-primary/10 text-primary">
                                    <Clock className="w-6 h-6" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-muted-foreground">Total Hours</p>
                                    <p className="text-2xl font-bold">{totalHours}</p>
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
                                {selectedDateMeetings.length} meetings
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
                                        selectedDateMeetings.map((meeting) => (
                                            <motion.div
                                                key={meeting._id}
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, scale: 0.95 }}
                                                className="group relative overflow-hidden rounded-xl p-4 hover:bg-accent/30 transition-all cursor-pointer flex items-center justify-between border-b border-border/20 last:border-0"
                                            >
                                                <div className="flex items-center gap-4">
                                                    <div className="flex flex-col items-center justify-center w-16 h-16 rounded-lg bg-white/5 border border-white/10">
                                                        <span className="text-sm font-bold text-primary">
                                                            {format(new Date(meeting.startTime), "h:mm")}
                                                        </span>
                                                        <span className="text-xs text-muted-foreground">
                                                            {format(new Date(meeting.startTime), "a")}
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <h3 className="font-semibold text-lg group-hover:text-primary transition-colors">
                                                            {meeting.title || "Untitled Meeting"}
                                                        </h3>
                                                        <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                                                            <span className="flex items-center gap-1">
                                                                <Clock className="w-3 h-3" />
                                                                {meeting.endTime
                                                                    ? `${Math.round((new Date(meeting.endTime).getTime() - new Date(meeting.startTime).getTime()) / 60000)}m`
                                                                    : "Scheduled"}
                                                            </span>
                                                            <span className="flex items-center gap-1">
                                                                <User className="w-3 h-3" /> {meeting.participants?.length || 1} Participants
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
                                                    <Button
                                                        variant="outline"
                                                        className="border-primary/20 hover:bg-primary/10 hover:text-primary"
                                                        onClick={() => setLocation(`/call/${meeting.roomId}`)}
                                                    >
                                                        Join
                                                    </Button>
                                                </div>
                                            </motion.div>
                                        ))
                                    ) : (
                                        <motion.div
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            className="flex flex-col items-center justify-center py-12 px-4 text-center bg-card/30 rounded-2xl border border-border/20 border-dashed"
                                        >
                                            <div className="bg-primary/5 p-4 rounded-full mb-4">
                                                <CalendarIcon className="w-8 h-8 text-primary/40" />
                                            </div>
                                            <h3 className="text-base font-semibold text-foreground mb-1">No meetings scheduled</h3>
                                            <p className="text-sm text-muted-foreground max-w-[250px] mb-6">
                                                You have no meetings scheduled for this day.
                                            </p>
                                            <Button onClick={() => setIsScheduleOpen(true)} variant="outline" className="gap-2 border-primary/20 hover:bg-primary/5 hover:text-primary">
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

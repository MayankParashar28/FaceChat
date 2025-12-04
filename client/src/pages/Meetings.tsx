import { useState } from "react";
import { useLocation } from "wouter";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogoMark } from "@/components/LogoMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth";
import { getAvatarUrl, getInitials } from "@/lib/utils";
import { LayoutDashboard, MessageSquare, User, Settings, LogOut, Calendar as CalendarIcon, Plus, Clock, Video, BarChart3, Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";

// Mock data for meetings
const initialMeetings = [
    { id: 1, title: "Project Kickoff", date: new Date(new Date().setHours(10, 0, 0, 0)), duration: 60, participants: ["Alice", "Bob"] },
    { id: 2, title: "Design Review", date: new Date(new Date().setDate(new Date().getDate() + 1)), duration: 45, participants: ["Charlie", "Dave"] },
    { id: 3, title: "Weekly Sync", date: new Date(new Date().setDate(new Date().getDate() + 2)), duration: 30, participants: ["Team"] },
];

export default function Meetings() {
    const [, setLocation] = useLocation();
    const { user, logout } = useAuth();
    const [date, setDate] = useState<Date | undefined>(new Date());
    const [meetings, setMeetings] = useState(initialMeetings);
    const [isScheduleOpen, setIsScheduleOpen] = useState(false);
    const [newMeetingTitle, setNewMeetingTitle] = useState("");
    const [newMeetingTime, setNewMeetingTime] = useState("10:00");

    const sidebarItems = [
        { title: "Dashboard", icon: LayoutDashboard, url: "/dashboard" },
        { title: "Chats", icon: MessageSquare, url: "/chats" },
        { title: "Meetings", icon: CalendarIcon, url: "/meetings" },
        { title: "Analytics", icon: BarChart3, url: "/analytics" },
        { title: "Profile", icon: User, url: "/profile" },
        { title: "Settings", icon: Settings, url: "/settings" }
    ];

    const handleSchedule = () => {
        if (!date || !newMeetingTitle) return;

        const [hours, minutes] = newMeetingTime.split(":").map(Number);
        const meetingDate = new Date(date);
        meetingDate.setHours(hours, minutes);

        const newMeeting = {
            id: Math.random(),
            title: newMeetingTitle,
            date: meetingDate,
            duration: 60, // Default duration
            participants: ["You"]
        };

        setMeetings([...meetings, newMeeting].sort((a, b) => a.date.getTime() - b.date.getTime()));
        setIsScheduleOpen(false);
        setNewMeetingTitle("");
        setNewMeetingTime("10:00");
    };

    const selectedDateMeetings = meetings.filter(m =>
        date && m.date.toDateString() === date.toDateString()
    );

    return (
        <SidebarProvider>
            <div className="flex h-screen w-full bg-background/80 backdrop-blur-3xl overflow-hidden">
                {/* Background Gradients */}
                <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none">
                    <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/5 blur-[100px] animate-pulse-glow" />
                    <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-primary/5 blur-[100px] animate-pulse-glow animation-delay-500" />
                </div>

                <Sidebar className="border-r border-white/5 bg-white/[0.03] backdrop-blur-2xl">
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
                                            <SidebarMenuButton asChild className={`hover:bg-white/[0.08] hover:shadow-sm transition-all duration-200 rounded-xl p-3 group-data-[state=expanded]:w-full ${item.url === '/meetings' ? 'bg-primary/10 text-primary' : ''}`}>
                                                <a href={item.url} className="flex items-center gap-3">
                                                    <item.icon className={`w-5 h-5 ${item.url === '/meetings' ? 'opacity-100' : 'opacity-70'}`} />
                                                    <span className="font-medium">{item.title}</span>
                                                </a>
                                            </SidebarMenuButton>
                                        </SidebarMenuItem>
                                    ))}
                                </SidebarMenu>
                            </SidebarGroupContent>
                        </SidebarGroup>

                        <div className="mt-auto pt-6 border-t border-white/10">
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/5 transition-colors cursor-pointer group">
                                <Avatar className="h-10 w-10 border-2 border-primary/20 group-hover:border-primary/50 transition-colors">
                                    <AvatarImage src={getAvatarUrl(user?.photoURL, user?.uid, user?.email)} />
                                    <AvatarFallback>{getInitials(user?.displayName, user?.email)}</AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold truncate">{user?.displayName || "User"}</p>
                                    <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                                </div>
                                <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity" onClick={logout}>
                                    <LogOut className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </SidebarContent>
                </Sidebar>

                <div className="flex flex-col flex-1 h-full overflow-hidden relative">
                    <header className="flex items-center justify-between gap-4 p-6 border-b border-white/5 bg-white/[0.02] backdrop-blur-sm z-10">
                        <div className="flex items-center gap-4">
                            <SidebarTrigger />
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
                                        <Button onClick={handleSchedule}>Schedule</Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                            <ThemeToggle />
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
                                            <p className="text-2xl font-bold">{meetings.filter(m => m.date > new Date()).length}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 rounded-full bg-primary/10 text-primary">
                                            <Clock className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-muted-foreground">Total Hours</p>
                                            <p className="text-2xl font-bold">12.5</p>
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
                                    <AnimatePresence mode="popLayout">
                                        {selectedDateMeetings.length > 0 ? (
                                            selectedDateMeetings.map((meeting) => (
                                                <motion.div
                                                    key={meeting.id}
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, scale: 0.95 }}
                                                    className="group relative overflow-hidden rounded-xl p-4 hover:bg-accent/30 transition-all cursor-pointer flex items-center justify-between border-b border-border/20 last:border-0"
                                                >
                                                    <div className="flex items-center gap-4">
                                                        <div className="flex flex-col items-center justify-center w-16 h-16 rounded-lg bg-white/5 border border-white/10">
                                                            <span className="text-sm font-bold text-primary">
                                                                {format(meeting.date, "h:mm")}
                                                            </span>
                                                            <span className="text-xs text-muted-foreground">
                                                                {format(meeting.date, "a")}
                                                            </span>
                                                        </div>
                                                        <div>
                                                            <h3 className="font-semibold text-lg group-hover:text-primary transition-colors">
                                                                {meeting.title}
                                                            </h3>
                                                            <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                                                                <span className="flex items-center gap-1">
                                                                    <Clock className="w-3 h-3" /> {meeting.duration}m
                                                                </span>
                                                                <span className="flex items-center gap-1">
                                                                    <User className="w-3 h-3" /> {meeting.participants.join(", ")}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <Button variant="outline" className="opacity-0 group-hover:opacity-100 transition-opacity border-primary/20 hover:bg-primary/10 hover:text-primary">
                                                        Join
                                                    </Button>
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
                                </div>
                            </div>
                        </div>
                    </main>
                </div>
            </div>
        </SidebarProvider>
    );
}

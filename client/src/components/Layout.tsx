import { useLocation } from "wouter";
import {
    LayoutDashboard,
    MessageSquare,
    Calendar,
    BarChart3,
    User,
    Settings,
    LogOut,
    Search,
    Bell
} from "lucide-react";
import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
    SidebarTrigger
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogoMark } from "@/components/LogoMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth";
import { getAvatarUrl, getInitials } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { auth } from "@/lib/firebase";

interface LayoutProps {
    children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
    const [location] = useLocation();
    const { user, logout } = useAuth();

    // Fetch notifications to get unread count
    const { data: notifications = [] } = useQuery({
        queryKey: ["notifications"],
        queryFn: async () => {
            if (!auth.currentUser) return [];
            const token = await auth.currentUser.getIdToken();
            const res = await fetch("/api/notifications", {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) return [];
            return res.json();
        },
        enabled: !!user,
        refetchInterval: 10000 // Poll every 10s
    });

    const unreadCount = notifications.filter((n: any) => !n.isRead).length;

    const sidebarItems = [
        { title: "Dashboard", icon: LayoutDashboard, url: "/dashboard" },
        { title: "Chats", icon: MessageSquare, url: "/chats" },
        { title: "Meetings", icon: Calendar, url: "/meetings" },
        { title: "Notifications", icon: Bell, url: "/notifications", badge: unreadCount },
        { title: "Analytics", icon: BarChart3, url: "/analytics" },
        { title: "Profile", icon: User, url: "/profile" },
        { title: "Settings", icon: Settings, url: "/settings" }
    ];

    return (
        <SidebarProvider defaultOpen={false}>
            <div className="flex h-screen w-full bg-background/80 backdrop-blur-3xl overflow-hidden">
                {/* Background Gradients */}
                <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none">
                    <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/5 blur-[100px] animate-pulse-glow" />
                    <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-primary/5 blur-[100px] animate-pulse-glow animation-delay-500" />
                </div>

                <Sidebar className="border-r border-white/5 bg-white/[0.03] backdrop-blur-2xl" collapsible="offcanvas">
                    <SidebarContent className="p-4 md:p-6">
                        <div className="flex items-center gap-3 px-2 mb-8 md:mb-10">
                            <div className="relative">
                                <div className="absolute inset-0 bg-primary/20 blur-md rounded-full" />
                                <LogoMark className="h-6 w-6 md:h-8 md:w-8 relative z-10" />
                            </div>
                            <span className="text-lg md:text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70 group-data-[collapsible=icon]:hidden">
                                FaceCall
                            </span>
                        </div>

                        <SidebarGroup>
                            <SidebarGroupLabel className="text-xs uppercase tracking-widest text-muted-foreground/70 mb-4 group-data-[collapsible=icon]:hidden">Menu</SidebarGroupLabel>
                            <SidebarGroupContent>
                                <SidebarMenu className="space-y-2">
                                    {sidebarItems.map((item) => (
                                        <SidebarMenuItem key={item.title}>
                                            <SidebarMenuButton
                                                asChild
                                                isActive={location === item.url}
                                                className="hover:bg-white/[0.08] hover:shadow-sm transition-all duration-200 rounded-xl p-3 group-data-[state=expanded]:w-full data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
                                                tooltip={item.title}
                                            >
                                                <a href={item.url} className="flex items-center gap-3 relative">
                                                    <item.icon className="w-5 h-5 opacity-70" />
                                                    <span className="font-medium group-data-[collapsible=icon]:hidden flex-1">{item.title}</span>
                                                    {item.badge !== undefined && item.badge > 0 && (
                                                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:top-0 group-data-[collapsible=icon]:right-0">
                                                            {item.badge}
                                                        </span>
                                                    )}
                                                </a>
                                            </SidebarMenuButton>
                                        </SidebarMenuItem>
                                    ))}
                                </SidebarMenu>
                            </SidebarGroupContent>
                        </SidebarGroup>

                        <div className="mt-auto pt-6 border-t border-white/10 group-data-[collapsible=icon]:hidden">
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/5 transition-colors cursor-pointer group">
                                <Avatar className="h-9 w-9 md:h-10 md:w-10 border-2 border-primary/20 group-hover:border-primary/50 transition-colors">
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
                    <header className="flex items-center justify-between gap-4 p-4 md:p-6 border-b border-white/5 bg-white/[0.02] backdrop-blur-sm z-10 h-16 md:h-auto">
                        <div className="flex items-center gap-4">
                            <SidebarTrigger />
                            <div className="relative hidden md:block w-72 lg:w-96 group">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                                <Input
                                    placeholder="Search..."
                                    className="pl-11 bg-white/[0.02] border-white/10 focus:bg-white/5 transition-all rounded-full h-9 md:h-10 text-sm"
                                />
                            </div>
                        </div>
                        <ThemeToggle />
                    </header>

                    <main className="flex-1 overflow-y-auto px-4 py-6 md:p-6 scrollbar-hide w-full">
                        {children}
                    </main>
                </div>
            </div>
        </SidebarProvider>
    );
}

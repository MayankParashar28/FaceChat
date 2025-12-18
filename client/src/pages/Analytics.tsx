import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell } from "recharts";
import { motion } from "framer-motion";
import { Clock, Users, Video, TrendingUp, ArrowUpRight, ArrowDownRight, Loader2, AlertCircle, Smile } from "lucide-react";

interface AnalyticsData {
    totalCalls: number;
    totalDuration: number;
    uniqueParticipants: number;
    avgSentiment: string;
    activityData: { name: string; calls: number; duration: number }[];
    emotionData: { name: string; value: number }[];
    topReactions: { emoji: string; count: number }[];
}

export default function Analytics() {
    const { data: analytics, isLoading, isError, error } = useQuery<AnalyticsData>({
        queryKey: ["/api/meetings/analytics"],
        queryFn: getQueryFn({ on401: "throw" }),
    });

    if (isLoading) {
        return (
            <div className="min-h-screen bg-background/95 backdrop-blur-3xl flex items-center justify-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary relative z-10" />
            </div>
        );
    }

    if (isError) {
        return (
            <div className="min-h-screen bg-background/95 backdrop-blur-3xl flex items-center justify-center p-6">
                <Card className="max-w-md w-full border-border/50 bg-card/95 backdrop-blur-xl">
                    <CardHeader className="text-center">
                        <div className="mx-auto w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
                            <AlertCircle className="h-6 w-6 text-red-400" />
                        </div>
                        <CardTitle className="text-foreground">Unable to load analytics</CardTitle>
                        <CardDescription className="text-muted-foreground">
                            {(error as Error)?.message || "There was an error loading your analytics data."}
                        </CardDescription>
                    </CardHeader>
                </Card>
            </div>
        );
    }

    const activityData = analytics?.activityData || [];
    // Ensure we have data for charts even if empty
    const safeActivityData = activityData.length > 0 ? activityData : [
        { name: "Mon", calls: 0, duration: 0 },
        { name: "Tue", calls: 0, duration: 0 },
        { name: "Wed", calls: 0, duration: 0 },
        { name: "Thu", calls: 0, duration: 0 },
        { name: "Fri", calls: 0, duration: 0 },
        { name: "Sat", calls: 0, duration: 0 },
        { name: "Sun", calls: 0, duration: 0 },
    ];

    return (
        <div className="p-6 space-y-8 max-w-7xl mx-auto">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight">Analytics Dashboard</h1>
                <p className="text-muted-foreground">
                    Insights into your communication patterns and meeting effectiveness.
                </p>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { title: "Total Calls", value: analytics?.totalCalls || 0, change: "—", icon: Video, trend: "neutral" },
                    { title: "Meeting Minutes", value: analytics?.totalDuration || 0, change: "—", icon: Clock, trend: "neutral" },
                    { title: "Unique Participants", value: analytics?.uniqueParticipants || 0, change: "—", icon: Users, trend: "neutral" },
                    { title: "Avg. Sentiment", value: analytics?.avgSentiment || "N/A", change: "—", icon: TrendingUp, trend: "neutral" },
                ].map((stat, i) => (
                    <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                    >
                        <Card className="glass-card">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    {stat.title}
                                </CardTitle>
                                <stat.icon className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{stat.value}</div>
                                <p className="text-xs text-muted-foreground flex items-center mt-1">
                                    {stat.trend === "up" ? (
                                        <ArrowUpRight className="h-3 w-3 text-green-500 mr-1" />
                                    ) : stat.trend === "down" ? (
                                        <ArrowDownRight className="h-3 w-3 text-red-500 mr-1" />
                                    ) : null}
                                    <span className={stat.trend === "up" ? "text-green-500" : stat.trend === "down" ? "text-red-500" : ""}>
                                        {stat.change}
                                    </span>
                                </p>
                            </CardContent>
                        </Card>
                    </motion.div>
                ))}
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.2 }}
                >
                    <Card className="glass-panel h-[400px]">
                        <CardHeader>
                            <CardTitle>Weekly Activity</CardTitle>
                            <CardDescription>Calls and duration over the last 7 days</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[320px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={safeActivityData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                                    <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                        itemStyle={{ color: '#fff' }}
                                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                    />
                                    <Bar dataKey="calls" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.3 }}
                >
                    <Card className="glass-panel h-[400px]">
                        <CardHeader>
                            <CardTitle>Meeting Duration Trends</CardTitle>
                            <CardDescription>Total minutes spent in meetings</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[320px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={safeActivityData}>
                                    <defs>
                                        <linearGradient id="colorDuration" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8} />
                                            <stop offset="95%" stopColor="#8884d8" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                                    <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                        itemStyle={{ color: '#fff' }}
                                    />
                                    <Area type="monotone" dataKey="duration" stroke="#8884d8" fillOpacity={1} fill="url(#colorDuration)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </motion.div>
            </div>

            {/* Detailed Breakdown Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Emotion Distribution */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                >
                    <Card className="glass-panel h-[350px]">
                        <CardHeader>
                            <CardTitle>Emotion Distribution</CardTitle>
                            <CardDescription>Overall sentiment across all meetings</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[270px] flex items-center justify-center">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={analytics?.emotionData || []}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={5}
                                        dataKey="value"
                                    >
                                        {(analytics?.emotionData || []).map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'][index % 5]} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                        itemStyle={{ color: '#fff' }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </motion.div>

                {/* Top Reactions */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                >
                    <Card className="glass-panel h-[350px]">
                        <CardHeader>
                            <CardTitle>Top Reactions</CardTitle>
                            <CardDescription>Most frequently used emojis in your calls</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-wrap gap-4 justify-center py-8">
                                {(analytics?.topReactions || []).map((reaction, index) => (
                                    <div key={index} className="flex flex-col items-center justify-center p-4 bg-white/5 rounded-2xl min-w-[100px] border border-white/10 hover:bg-white/10 transition-colors">
                                        <span className="text-4xl mb-2 filter drop-shadow-lg">{reaction.emoji}</span>
                                        <span className="text-sm font-medium text-muted-foreground">{reaction.count} used</span>
                                    </div>
                                ))}
                                {(!analytics?.topReactions || analytics.topReactions.length === 0) && (
                                    <div className="flex flex-col items-center justify-center text-muted-foreground h-full">
                                        <span className="text-4xl mb-2 opacity-50">😶</span>
                                        <p>No reactions yet</p>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>
            </div>
        </div>
    );
}

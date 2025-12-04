import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, AreaChart, Area } from "recharts";
import { motion } from "framer-motion";
import { Calendar, Clock, Users, Video, TrendingUp, ArrowUpRight, ArrowDownRight } from "lucide-react";

// Mock data for charts
const activityData = [
    { name: "Mon", calls: 4, duration: 120 },
    { name: "Tue", calls: 3, duration: 90 },
    { name: "Wed", calls: 6, duration: 180 },
    { name: "Thu", calls: 2, duration: 45 },
    { name: "Fri", calls: 5, duration: 150 },
    { name: "Sat", calls: 1, duration: 30 },
    { name: "Sun", calls: 0, duration: 0 },
];

const emotionData = [
    { name: "Happy", value: 65 },
    { name: "Neutral", value: 20 },
    { name: "Surprised", value: 10 },
    { name: "Other", value: 5 },
];

export default function Analytics() {
    const { user } = useAuth();

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
                    { title: "Total Calls", value: "42", change: "+12%", icon: Video, trend: "up" },
                    { title: "Meeting Minutes", value: "1,240", change: "+5%", icon: Clock, trend: "up" },
                    { title: "Unique Participants", value: "86", change: "-2%", icon: Users, trend: "down" },
                    { title: "Avg. Sentiment", value: "Positive", change: "Stable", icon: TrendingUp, trend: "neutral" },
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
                                    <span className="ml-1">from last month</span>
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
                                <BarChart data={activityData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                                    <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                        itemStyle={{ color: '#fff' }}
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
                                <AreaChart data={activityData}>
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
        </div>
    );
}

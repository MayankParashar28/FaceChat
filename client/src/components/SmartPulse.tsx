import { motion } from "framer-motion";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Sparkles, Zap, Heart, Frown, Meh } from "lucide-react";

interface SmartPulseProps {
    sentiment: "Happy" | "Neutral" | "Sad" | "Surprised" | "Angry";
    engagement: number; // 0-100
    className?: string;
}

export function SmartPulse({ sentiment, engagement, className }: SmartPulseProps) {
    const config = useMemo(() => {
        switch (sentiment) {
            case "Happy":
                return {
                    gradient: "from-yellow-400 to-orange-500",
                    shadow: "shadow-orange-500/50",
                    duration: 2,
                    icon: Heart,
                };
            case "Surprised":
                return {
                    gradient: "from-purple-400 to-pink-500",
                    shadow: "shadow-pink-500/50",
                    duration: 1.5,
                    icon: Sparkles,
                };
            case "Angry":
                return {
                    gradient: "from-red-500 to-rose-600",
                    shadow: "shadow-red-500/50",
                    duration: 0.8,
                    icon: Zap,
                };
            case "Sad":
                return {
                    gradient: "from-indigo-400 to-blue-500",
                    shadow: "shadow-indigo-400/50",
                    duration: 3,
                    icon: Frown,
                };
            case "Neutral":
            default:
                return {
                    gradient: "from-blue-400 to-cyan-500",
                    shadow: "shadow-cyan-400/50",
                    duration: 2.5,
                    icon: Meh,
                };
        }
    }, [sentiment]);

    // Calculate scale based on engagement (0-100 -> 1-1.5)
    const scale = 1 + (engagement / 100) * 0.4;
    const Icon = config.icon;

    return (
        <div className={cn("relative flex items-center justify-center w-16 h-16 group", className)}>
            {/* Ambient Energy Field */}
            <motion.div
                animate={{
                    opacity: [0.3, 0.6, 0.3],
                    scale: [1, 1.2, 1],
                }}
                transition={{
                    duration: 3,
                    repeat: Infinity,
                    ease: "easeInOut",
                }}
                className={cn("absolute inset-0 rounded-full blur-2xl opacity-40 bg-gradient-to-r", config.gradient)}
            />

            {/* Orbital Ring 1 - Fast */}
            <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0 rounded-full border-[1px] border-transparent border-t-white/40 border-r-white/10"
            />

            {/* Orbital Ring 2 - Slow Counter-rotate */}
            <motion.div
                animate={{ rotate: -360 }}
                transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
                className="absolute inset-[2px] rounded-full border-[1px] border-transparent border-b-white/30 border-l-white/10"
            />

            {/* Pulse Wave */}
            <motion.div
                animate={{
                    scale: [1, 1 + (scale - 1) * 2, 1],
                    opacity: [0.2, 0, 0.2],
                    borderWidth: ["1px", "0px", "1px"]
                }}
                transition={{
                    duration: config.duration,
                    repeat: Infinity,
                    ease: "easeOut",
                }}
                className={cn("absolute inset-2 rounded-full border border-white/50", config.shadow)}
            />

            {/* Central Orb */}
            <motion.div
                whileHover={{ scale: 1.1 }}
                layoutId="smart-pulse-orb"
                className={cn(
                    "relative w-10 h-10 rounded-full flex items-center justify-center z-10",
                    "shadow-[0_0_15px_rgba(255,255,255,0.3)] backdrop-blur-sm border border-white/40",
                    "bg-gradient-to-br from-white/20 to-black/10",
                    config.shadow
                )}
            >
                {/* Inner Gradient Ball */}
                <div className={cn("absolute inset-1 rounded-full opacity-80 bg-gradient-to-tr", config.gradient)} />

                {/* Icon */}
                <Icon className="relative w-5 h-5 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]" />
            </motion.div>

            {/* Holographic Tooltip (Right Side) */}
            <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-[-10px] group-hover:translate-x-0 pointer-events-none z-30">
                <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-lg p-3 shadow-2xl min-w-[140px]">
                    {/* Decorative Corner Accents */}
                    <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-white/50 rounded-tl-sm" />
                    <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-white/50 rounded-br-sm" />

                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-white/60 text-[10px] uppercase tracking-wider font-semibold">Mood</span>
                            <span className={cn("text-xs font-bold bg-clip-text text-transparent bg-gradient-to-r", config.gradient)}>
                                {sentiment}
                            </span>
                        </div>

                        <div className="space-y-1">
                            <div className="flex items-center justify-between text-[10px] text-white/50 uppercase tracking-wider">
                                <span>Intensity</span>
                                <span>{engagement}%</span>
                            </div>
                            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${engagement}%` }}
                                    transition={{ duration: 1, ease: "easeOut" }}
                                    className={cn("h-full rounded-full bg-gradient-to-r", config.gradient)}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

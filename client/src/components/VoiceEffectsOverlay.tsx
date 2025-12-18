
import { useEffect, useState, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Flame, Snowflake, Heart, Zap, Lightbulb, Laugh } from "lucide-react";
import { cn } from "@/lib/utils";

interface VoiceEffectsOverlayProps {
    transcript: string;
    className?: string;
    isEnabled?: boolean;
}

type EffectType = "fire" | "ice" | "love" | "idea" | "funny" | "electric" | null;

interface ActiveEffect {
    id: string;
    type: EffectType;
    x: number;
    y: number;
    scale: number;
    rotation: number;
}

const KEYWORDS: Record<string, EffectType> = {
    "fire": "fire", "hot": "fire", "burn": "fire", "flame": "fire", "lit": "fire",
    "ice": "ice", "try": "ice", "cold": "ice", "freeze": "ice", "chill": "ice", "snow": "ice", "cool": "ice",
    "love": "love", "like": "love", "heart": "love", "cute": "love", "amazing": "love",
    "idea": "idea", "smart": "idea", "brilliant": "idea", "think": "idea", "light": "idea",
    "lol": "funny", "haha": "funny", "funny": "funny", "laugh": "funny",
    "shock": "electric", "power": "electric", "energy": "electric", "fast": "electric", "zap": "electric"
};

// Particle configs
const EFFECT_CONFIGS = {
    fire: {
        icon: Flame,
        color: "text-orange-500",
        gradient: "from-red-500 to-yellow-500",
        count: 15,
        sound: "/sounds/fire.mp3"
    },
    ice: {
        icon: Snowflake,
        color: "text-cyan-400",
        gradient: "from-blue-400 to-cyan-200",
        count: 20,
        sound: "/sounds/ice.mp3"
    },
    love: {
        icon: Heart,
        color: "text-pink-500",
        gradient: "from-pink-500 to-rose-400",
        count: 12,
        sound: "/sounds/pop.mp3"
    },
    idea: {
        icon: Lightbulb,
        color: "text-yellow-400",
        gradient: "from-yellow-300 to-amber-200",
        count: 8,
        sound: "/sounds/ding.mp3"
    },
    funny: {
        icon: Laugh,
        color: "text-yellow-300",
        gradient: "from-yellow-400 to-orange-300",
        count: 10,
        sound: "/sounds/laugh.mp3"
    },
    electric: {
        icon: Zap,
        color: "text-violet-400",
        gradient: "from-violet-500 to-fuchsia-400",
        count: 8,
        sound: "/sounds/zap.mp3"
    }
};

export const VoiceEffectsOverlay = memo(({ transcript, className, isEnabled = true }: VoiceEffectsOverlayProps) => {
    const [activeEffects, setActiveEffects] = useState<ActiveEffect[]>([]);
    const [screenOverlay, setScreenOverlay] = useState<EffectType>(null);
    const [lastProcessedLength, setLastProcessedLength] = useState(0);

    useEffect(() => {
        if (!isEnabled || !transcript || transcript.length <= lastProcessedLength) return;

        // Get only the new part of the transcript
        const newText = transcript.slice(lastProcessedLength).toLowerCase();
        setLastProcessedLength(transcript.length);

        // Check for keywords in the last few words
        const words = newText.split(/\s+/).filter(w => w.length > 2); // Ignore short words

        // Find matching effects (prioritize most recent word)
        let triggeredEffect: EffectType = null;

        for (const word of words.reverse()) {
            // Remove punctuation
            const cleanWord = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
            if (KEYWORDS[cleanWord]) {
                triggeredEffect = KEYWORDS[cleanWord];
                break;
            }
        }

        if (triggeredEffect) {
            triggerEffect(triggeredEffect);
        }

    }, [transcript, isEnabled]);

    const triggerEffect = (type: EffectType) => {
        if (!type) return;

        // 1. Trigger Screen Overlay (Background Tint/Border)
        setScreenOverlay(type);
        setTimeout(() => setScreenOverlay(null), 2000);

        // 2. Spawn Particles
        const config = EFFECT_CONFIGS[type as keyof typeof EFFECT_CONFIGS];
        const newParticles: ActiveEffect[] = [];

        for (let i = 0; i < config.count; i++) {
            newParticles.push({
                id: Math.random().toString(36),
                type,
                x: Math.random() * 100, // %
                y: 100 + Math.random() * 20, // Start below screen
                scale: 0.5 + Math.random() * 1.5,
                rotation: Math.random() * 360
            });
        }

        setActiveEffects(prev => [...prev, ...newParticles]);

        // Cleanup particles after animation
        setTimeout(() => {
            setActiveEffects(prev => prev.filter(p => !newParticles.find(np => np.id === p.id)));
        }, 4000);
    };

    return (
        <div className={cn("absolute inset-0 pointer-events-none overflow-hidden z-40", className)}>
            {/* Screen Tint Overlay */}
            <AnimatePresence>
                {screenOverlay && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.2 }}
                        exit={{ opacity: 0 }}
                        className={cn(
                            "absolute inset-0 bg-gradient-to-b mix-blend-overlay",
                            EFFECT_CONFIGS[screenOverlay as keyof typeof EFFECT_CONFIGS].gradient
                        )}
                    />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {activeEffects.map((effect) => {
                    const config = EFFECT_CONFIGS[effect.type as keyof typeof EFFECT_CONFIGS];
                    const Icon = config.icon;

                    return (
                        <motion.div
                            key={effect.id}
                            initial={{
                                left: `${effect.x}%`,
                                top: "110%",
                                opacity: 0,
                                scale: 0,
                                rotate: effect.rotation
                            }}
                            animate={{
                                top: "-10%", // Float up off screen
                                opacity: [0, 1, 1, 0],
                                scale: effect.scale, // Scale is number
                                rotate: effect.rotation + 180, // Spin while floating
                                x: Math.random() * 100 - 50 // Drift
                            }}
                            transition={{
                                duration: 3 + Math.random(),
                                ease: "easeOut"
                            }}
                            className={cn("absolute", config.color)}
                        >
                            <Icon className="w-8 h-8 drop-shadow-lg" />
                        </motion.div>
                    );
                })}
            </AnimatePresence>
        </div>
    );
});

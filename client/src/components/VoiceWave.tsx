import React from 'react';
import { motion } from 'framer-motion';

interface VoiceWaveProps {
    volume: number; // 0-100
    isSpeaking: boolean;
    color?: string;
    className?: string;
}

export const VoiceWave: React.FC<VoiceWaveProps> = ({ volume, isSpeaking, color = "#22c55e", className = "" }) => {
    // WhatsApp style: ~5 bars that bounce based on volume
    const bars = [1, 2, 3, 4, 5];

    // Scale height based on volume
    // If not speaking, small static height. If speaking, random * volume.

    return (
        <div className={`flex items-end justify-center gap-[2px] h-6 ${className}`}>
            {bars.map((i) => {
                // Pseudo-random factor for each bar to look organic
                // We use volume as the base multiplier
                const randomFactor = Math.random() * 0.5 + 0.5; // 0.5 - 1.0
                const height = isSpeaking ? Math.max(4, (volume / 100) * 24 * randomFactor) : 4;

                return (
                    <motion.div
                        key={i}
                        initial={{ height: 4 }}
                        animate={{ height }}
                        transition={{ type: "spring", stiffness: 300, damping: 20 }}
                        style={{ backgroundColor: color }}
                        className="w-1 rounded-full opacity-80"
                    />
                );
            })}
        </div>
    );
};

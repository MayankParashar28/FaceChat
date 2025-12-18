import { useState, useEffect, useRef } from 'react';

interface AudioAnalysisResult {
    volume: number; // 0-100
    isSpeaking: boolean;
}

export function useAudioAnalysis(stream: MediaStream | null): AudioAnalysisResult {
    const [volume, setVolume] = useState(0);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const requestRef = useRef<number>();
    const lastRun = useRef<number>(0);

    useEffect(() => {
        if (!stream) {
            setVolume(0);
            setIsSpeaking(false);
            return;
        }

        // Initialize Audio Context
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }

        const audioContext = audioContextRef.current;

        // Create Analyser
        analyserRef.current = audioContext.createAnalyser();
        analyserRef.current.fftSize = 256;

        // Create Source
        try {
            sourceRef.current = audioContext.createMediaStreamSource(stream);
            sourceRef.current.connect(analyserRef.current);
        } catch (err) {
            console.error("Error creating media stream source:", err);
            return;
        }

        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const analyze = () => {
            if (!analyserRef.current) return;

            analyserRef.current.getByteFrequencyData(dataArray);

            // Throttle state updates to ~10fps (100ms) to reduce React re-renders
            // The requestAnimationFrame keeps the loop alive, but we only calculate/set state occasionally
            const now = Date.now();
            if (now - lastRun.current >= 100) {
                lastRun.current = now;

                // Calculate average volume
                let sum = 0;
                for (let i = 0; i < bufferLength; i++) {
                    sum += dataArray[i];
                }
                const average = sum / bufferLength;

                // Normalize volume (0-100)
                const normalizedVolume = Math.min(100, Math.round(average * 2.5));

                // Only update state if volume changes significantly to further save renders
                if (Math.abs(normalizedVolume - volume) > 2) {
                    setVolume(normalizedVolume);
                    setIsSpeaking(normalizedVolume > 10);
                }
            }

            requestRef.current = requestAnimationFrame(analyze);
        };

        analyze();

        return () => {
            if (requestRef.current) {
                cancelAnimationFrame(requestRef.current);
            }
            if (sourceRef.current) {
                sourceRef.current.disconnect();
            }
            // We don't close the audio context here as it might be expensive to recreate
            // or we might want to reuse it. But for this hook's lifecycle, disconnecting source is key.
        };
    }, [stream]);

    return { volume, isSpeaking };
}

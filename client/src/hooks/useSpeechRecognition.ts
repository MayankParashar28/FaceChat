import { useState, useEffect, useCallback } from 'react';

export interface SpeechRecognitionHook {
    isListening: boolean;
    transcript: string;
    startRecognition: () => void;
    stopRecognition: () => void;
    resetTranscript: () => void;
    error: string | null;
}

export function useSpeechRecognition(): SpeechRecognitionHook {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [recognition, setRecognition] = useState<any>(null);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            // @ts-ignore - webkitSpeechRecognition is not standard yet
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

            if (SpeechRecognition) {
                const recognitionInstance = new SpeechRecognition();
                recognitionInstance.continuous = true;
                recognitionInstance.interimResults = true;
                recognitionInstance.lang = 'en-US';

                recognitionInstance.onstart = () => setIsListening(true);
                recognitionInstance.onend = () => setIsListening(false);

                recognitionInstance.onresult = (event: any) => {
                    let finalTranscript = '';
                    let interimTranscript = '';

                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        if (event.results[i].isFinal) {
                            finalTranscript += event.results[i][0].transcript;
                        } else {
                            interimTranscript += event.results[i][0].transcript;
                        }
                    }

                    // We primarily want the latest interim result for "live" feel, 
                    // or the final result if it's done. 
                    // For a caption stream, we might just want to return the latest chunk.
                    // But usually, 'transcript' state holds the accumulated text.
                    // For captions, we typically want "current sentence".

                    // Let's expose the raw combined text for now.
                    // The component can decide when to clear it (e.g. after a few seconds of silence).
                    // Append final results to state, keep interim for live feedback if needed
                    // For simply detecting keywords, we can just append final results
                    if (finalTranscript) {
                        setTranscript(prev => prev + ' ' + finalTranscript);
                    }
                };

                recognitionInstance.onerror = (event: any) => {
                    console.error('Speech recognition error', event.error);
                    setError(event.error);
                    setIsListening(false);
                };

                setRecognition(recognitionInstance);
            } else {
                setError('Speech Recognition API not supported in this browser.');
            }
        }
    }, []);

    const startRecognition = useCallback(() => {
        if (recognition && !isListening) {
            try {
                recognition.start();
                setError(null);
            } catch (e) {
                console.error("Failed to start recognition", e);
            }
        }
    }, [recognition, isListening]);

    const stopRecognition = useCallback(() => {
        if (recognition && isListening) {
            recognition.stop();
        }
    }, [recognition, isListening]);

    const resetTranscript = useCallback(() => {
        setTranscript('');
    }, []);

    return {
        isListening,
        transcript,
        startRecognition,
        stopRecognition,
        resetTranscript,
        error
    };
}

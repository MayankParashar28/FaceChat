import { useState, useEffect, useRef } from 'react';
import * as faceapi from 'face-api.js';

// Define the expressions we care about
export type FaceExpression = "Happy" | "Neutral" | "Sad" | "Surprised" | "Angry";

interface FaceExpressionResult {
    expression: FaceExpression;
    confidence: number;
    isLoaded: boolean;
}

export function useFaceExpression(videoRef: React.RefObject<HTMLVideoElement>): FaceExpressionResult {
    const [expression, setExpression] = useState<FaceExpression>("Neutral");
    const [confidence, setConfidence] = useState(0);
    const [isLoaded, setIsLoaded] = useState(false);
    const requestRef = useRef<number>();

    useEffect(() => {
        const loadModels = async () => {
            const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';

            try {
                await Promise.all([
                    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
                    faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
                ]);
                setIsLoaded(true);
            } catch (err) {
                console.error("Error loading face-api models:", err);
            }
        };

        loadModels();
    }, []);

    useEffect(() => {
        if (!isLoaded || !videoRef.current) return;

        const detectExpression = async () => {
            if (!videoRef.current || videoRef.current.paused || videoRef.current.ended) {
                requestRef.current = requestAnimationFrame(detectExpression);
                return;
            }

            try {
                // Use TinyFaceDetector for better performance with adjusted options
                const detections = await faceapi
                    .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
                    .withFaceExpressions();

                if (detections) {
                    const expressions = detections.expressions;

                    // Find the dominant expression
                    // Custom sorting to prioritize active emotions over Neutral
                    // If a non-neutral emotion is > 0.3, pick it even if Neutral is higher (up to a point)
                    const sorted = Object.entries(expressions).sort((a, b) => {
                        const [exprA, confA] = a;
                        const [exprB, confB] = b;

                        // Boost non-neutral expressions
                        const scoreA = exprA === 'neutral' ? confA * 0.4 : confA;
                        const scoreB = exprB === 'neutral' ? confB * 0.4 : confB;

                        return scoreB - scoreA;
                    });

                    const topExpression = sorted[0];

                    if (topExpression) {
                        const [expr, conf] = topExpression;

                        // Map face-api expressions to our types
                        let mappedExpr: FaceExpression = "Neutral";
                        if (expr === "happy") mappedExpr = "Happy";
                        else if (expr === "sad") mappedExpr = "Sad";
                        else if (expr === "angry") mappedExpr = "Angry";
                        else if (expr === "surprised") mappedExpr = "Surprised";
                        else if (expr === "neutral") mappedExpr = "Neutral";
                        // We can map others like 'fearful' or 'disgusted' if needed, or default to Neutral

                        // Only update if confidence is decent, otherwise stick to previous or Neutral
                        if (conf > 0.3) {
                            setExpression(mappedExpr);
                            setConfidence(conf);
                        }
                    }
                }
            } catch (err) {
                console.error("Face detection error:", err);
            }

            // Throttle: Run detection every 500ms instead of every frame to save CPU
            setTimeout(() => {
                requestRef.current = requestAnimationFrame(detectExpression);
            }, 500);
        };

        detectExpression();

        return () => {
            if (requestRef.current) {
                cancelAnimationFrame(requestRef.current);
            }
        };
    }, [isLoaded, videoRef]);

    return { expression, confidence, isLoaded };
}

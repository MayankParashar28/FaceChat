import { useState, useEffect } from "react";
import * as faceapi from "face-api.js";

// Define the expressions we care about
export type FaceExpression = "Happy" | "Neutral" | "Sad" | "Surprised" | "Angry";

export type FaceExpressionStatus = "loading" | "ready" | "unavailable";

interface FaceExpressionResult {
  expression: FaceExpression;
  confidence: number;
  isLoaded: boolean;
  status: FaceExpressionStatus;
}

const MODEL_URL = "https://justadudewhohacks.github.io/face-api.js/models";

// Minimum gap between runs. Detection costs ~30-60ms on WebGL but ~700ms on the
// CPU fallback, and the CPU backend blocks the main thread — so the real gap is
// scaled to the last run's cost (see nextDelay) and this is only the floor.
const DETECT_INTERVAL_MS = 500;

// On a slow backend, leave this much idle time per unit of inference time so the
// video and UI still get the main thread.
const IDLE_RATIO = 3;

/**
 * Pick a TensorFlow backend, falling back to CPU when WebGL is unavailable.
 *
 * face-api.js lets tfjs choose on its own, and tfjs only tries WebGL. On a
 * machine without it (hardware acceleration off, an older GPU, some embedded
 * browsers) every detection threw "WebGL is not supported on this device" and
 * the hook sat on its initial Neutral forever.
 */
async function initBackend(): Promise<boolean> {
  const tf = faceapi.tf;
  for (const backend of ["webgl", "cpu"]) {
    try {
      if (await tf.setBackend(backend)) {
        await tf.ready();
        return true;
      }
    } catch {
      // Try the next one.
    }
  }
  return false;
}

/** A video element can only be fed to the detector once it has real pixels. */
function isVideoReady(video: HTMLVideoElement | null): video is HTMLVideoElement {
  return !!video && !video.paused && !video.ended && video.readyState >= 2 && video.videoWidth > 0;
}

export function useFaceExpression(
  videoRef: React.RefObject<HTMLVideoElement>
): FaceExpressionResult {
  const [expression, setExpression] = useState<FaceExpression>("Neutral");
  const [confidence, setConfidence] = useState(0);
  const [status, setStatus] = useState<FaceExpressionStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (delay: number, fn: () => void) => {
      if (cancelled) return;
      timer = setTimeout(fn, delay);
    };

    // Starts at the floor and adapts once we have measured the backend.
    let nextDelay = DETECT_INTERVAL_MS;

    const detect = async () => {
      if (cancelled) return;

      const video = videoRef.current;
      // The video element mounts and starts playing well after the models
      // finish loading, so keep polling instead of giving up — the previous
      // version bailed out of the effect and never detected anything.
      if (!isVideoReady(video)) {
        schedule(DETECT_INTERVAL_MS, detect);
        return;
      }

      const startedAt = performance.now();
      try {
        const detection = await faceapi
          .detectSingleFace(
            video,
            new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })
          )
          .withFaceExpressions();

        if (cancelled) return;

        if (detection) {
          // Neutral dominates almost every frame, so weight it down rather than
          // taking the raw argmax — otherwise the mood never visibly changes.
          const [expr, conf] = Object.entries(detection.expressions).sort(
            ([exprA, confA], [exprB, confB]) =>
              (exprB === "neutral" ? confB * 0.4 : confB) -
              (exprA === "neutral" ? confA * 0.4 : confA)
          )[0];

          const mapped: Record<string, FaceExpression> = {
            happy: "Happy",
            sad: "Sad",
            angry: "Angry",
            surprised: "Surprised",
            neutral: "Neutral",
          };

          if (conf > 0.3 && mapped[expr]) {
            setExpression(mapped[expr]);
            setConfidence(conf);
          }
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Face detection error:", err);
        // A throwing detector will throw on every frame; stop rather than
        // flooding the console once per interval for the whole call.
        setStatus("unavailable");
        return;
      }

      nextDelay = Math.max(DETECT_INTERVAL_MS, (performance.now() - startedAt) * IDLE_RATIO);
      schedule(nextDelay, detect);
    };

    const start = async () => {
      try {
        if (!(await initBackend())) {
          throw new Error("No TensorFlow backend available (WebGL and CPU both failed)");
        }
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
        ]);
        if (cancelled) return;
        setStatus("ready");
        detect();
      } catch (err) {
        if (cancelled) return;
        console.error("Emotion detection unavailable:", err);
        setStatus("unavailable");
      }
    };

    start();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [videoRef]);

  return { expression, confidence, isLoaded: status === "ready", status };
}

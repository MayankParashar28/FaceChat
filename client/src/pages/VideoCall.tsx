import { useState, useEffect, useRef, memo, forwardRef } from "react";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PhoneOff,
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff,
  MonitorUp,
  MessageSquare,
  Users,
  Sparkles,
  Copy,
  Check,
  Send,
  X,
  Captions,
  Smile,
  Pin,
  PinOff,
  MoreHorizontal,
  Settings,
} from "lucide-react";
import { VoiceWave } from "@/components/VoiceWave";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { io, Socket } from "socket.io-client";
import { useAuth } from "@/lib/auth";
import { auth } from "@/lib/firebase";
import { getInitials } from "@/lib/utils";
import { getAuthToken } from "@/lib/queryClient";
import { motion, AnimatePresence } from "framer-motion";
import { useSettings } from "@/lib/settings";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SmartPulse } from "@/components/SmartPulse";
import { useAudioAnalysis } from "@/hooks/useAudioAnalysis";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useFaceExpression } from "@/hooks/useFaceExpression";
import { VoiceEffectsOverlay } from "@/components/VoiceEffectsOverlay";
import { useMediaDevices } from "@/hooks/useMediaDevices";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import SimplePeer, { Instance as PeerInstance } from "simple-peer";

// Polyfill for simple-peer in browser environment if needed,
// though vite-plugin-node-polyfills should handle most of it.
import process from "process";
window.process = process;

type Participant = {
  socketId: string;
  userId: string;
  name: string;
  avatar?: string;
  isLocal: boolean;
  isVideoOn: boolean;
  isAudioOn: boolean;
  stream?: MediaStream;
  peer?: PeerInstance;
  status?: "connecting" | "connected" | "failed";
  emotion?: "Happy" | "Neutral" | "Sad" | "Surprised" | "Angry";
  engagement?: number;
};

type ChatMessage = {
  id: string;
  socketId: string;
  userId?: string;
  sender: string;
  avatar?: string;
  message: string;
  time: string;
  isLocal?: boolean;
};

// Local Video Component
const LocalVideo = memo(
  ({
    stream,
    isVideoOn,
    videoRef,
    volume,
  }: {
    stream: MediaStream | null;
    isVideoOn: boolean;
    videoRef: React.RefObject<HTMLVideoElement>;
    volume: number;
  }) => {
    useEffect(() => {
      if (videoRef.current && stream) {
        videoRef.current.srcObject = stream;
      }
    }, [stream, videoRef, isVideoOn]);

    return (
      <>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover rounded-2xl transition-opacity duration-300 opacity-100"
        />
        {isVideoOn && (
          <div className="absolute bottom-4 right-4 z-10 pointer-events-none">
            <VoiceWave volume={volume} isSpeaking={volume > 10} />
          </div>
        )}
      </>
    );
  }
);

/**
 * ICE servers for WebRTC. Google STUN handles most home networks; a TURN relay
 * is required for users behind symmetric NAT (many mobile/corporate networks).
 * TURN is added only when VITE_TURN_URL is configured at build time.
 */
const TURN_URL = import.meta.env.VITE_TURN_URL;
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
  ...(TURN_URL
    ? [
        {
          urls: TURN_URL,
          username: import.meta.env.VITE_TURN_USERNAME,
          credential: import.meta.env.VITE_TURN_CREDENTIAL,
        } as RTCIceServer,
      ]
    : []),
];

// Mood colours, shared by the tile chip and the participant list so one mood
// always reads the same wherever it appears.
const MOOD_CHIP: Record<string, string> = {
  Happy: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  Surprised: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
  Angry: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  Sad: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  Neutral: "bg-muted text-muted-foreground",
};

const moodChipClass = (mood: string) => MOOD_CHIP[mood] ?? MOOD_CHIP.Neutral;

const REACTION_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🎉", "👏", "🔥"];

// One source of truth for toolbar control styling.
//
// Button already ships `hover-elevate`, which paints a translucent ::after over
// the whole control on hover. The old classes added `hover:bg-accent` on top of
// that, so two different hover treatments stacked and the winner depended on
// Tailwind's output order. Hover is left to the component; the pressed state
// uses the design system's own `toggle-elevate`, which paints *behind* the
// icon instead of over it.
const toolbarButton = (active = false) =>
  [
    "shrink-0 rounded-xl md:rounded-2xl w-10 h-10 md:w-12 md:h-12 md:[&_svg]:size-5",
    active ? "toggle-elevate toggle-elevated text-primary" : "text-foreground",
  ].join(" ");

// getDisplayMedia is absent on most mobile browsers (notably iOS Safari);
// offering the control there just produces an error nobody can act on.
const canShareScreen =
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

// Remote Video Component
const RemoteVideo = memo(
  ({ stream, isVideoOn }: { stream: MediaStream | undefined; isVideoOn: boolean }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const { volume, isSpeaking } = useAudioAnalysis(stream || null);

    useEffect(() => {
      if (videoRef.current && stream) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch((e) => console.error("[RemoteVideo] Play error:", e));
      }
    }, [stream]);

    return (
      <>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover rounded-2xl transition-opacity duration-300 opacity-100"
        />
        {isVideoOn && (
          <div className="absolute bottom-4 right-4 z-10 pointer-events-none">
            <VoiceWave volume={volume} isSpeaking={isSpeaking} />
          </div>
        )}
      </>
    );
  }
);

// Remote Participant Video Wrapper

type RemoteParticipantVideoProps = {
  participant: Participant;
  onPin?: (id: string) => void;
  isPinned?: boolean;
  isSpotlightMode?: boolean;
  className?: string;
  /** For the local tile: lets the parent own the <video> ref so face/emotion
   *  detection can read real frames from the displayed local video. */
  externalVideoRef?: React.RefObject<HTMLVideoElement>;
};

const RemoteParticipantVideo = memo(
  forwardRef<HTMLDivElement, RemoteParticipantVideoProps>(
    ({ participant, onPin, isPinned, className, externalVideoRef }, ref) => {
      const { volume } = useAudioAnalysis(participant.stream || null);
      const localVideoRef = useRef<HTMLVideoElement>(null);

      // Default to aspect-video if no class provided (backward compatibility)
      // If className is provided (e.g. for full screen), we don't force aspect-video.
      const baseClasses = className ? className : "w-full aspect-video";

      return (
        <motion.div
          ref={ref}
          layout
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          className={`relative ${baseClasses} bg-card rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.18)] group transition-all duration-300 ${participant.isAudioOn && volume > 20 && !participant.isLocal ? "ring-2 ring-primary shadow-md" : "ring-1 ring-border"}`}
        >
          {/* Video Element */}
          {participant.isLocal ? (
            <LocalVideo
              stream={participant.stream || null}
              isVideoOn={participant.isVideoOn}
              videoRef={externalVideoRef || localVideoRef}
              volume={volume}
            />
          ) : (
            <RemoteVideo stream={participant.stream} isVideoOn={participant.isVideoOn} />
          )}

          {/* Status Indicator */}
          {!participant.isLocal && participant.status === "connecting" && (
            <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-20">
              <div className="text-muted-foreground text-sm animate-pulse">Connecting...</div>
            </div>
          )}

          {/* Fallback Avatar */}
          {!participant.isVideoOn && (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-card via-card to-muted">
              <Avatar className="h-[38%] w-auto aspect-square max-h-24 min-h-10 ring-4 ring-background shadow-lg">
                <AvatarImage src={participant.avatar} />
                <AvatarFallback className="bg-primary text-white text-2xl">
                  {getInitials(participant.name)}
                </AvatarFallback>
              </Avatar>
            </div>
          )}

          {/* Overlay Info */}
          <div className="absolute bottom-3 left-3 right-3 flex justify-between items-center z-30 pointer-events-none">
            <div className="flex items-center gap-2 bg-background/85 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-border text-foreground font-medium text-xs shadow-sm">
              <span>
                {participant.name}
                {participant.isLocal && participant.name !== "You" && " (You)"}
              </span>
              {participant.emotion && (
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${moodChipClass(participant.emotion)}`}
                >
                  {participant.emotion}
                </span>
              )}
            </div>
            <div className="flex gap-1.5 pointer-events-auto">
              {onPin && (
                <Button
                  size="icon"
                  variant="ghost"
                  className={`h-7 w-7 md:h-8 md:w-8 rounded-full ${isPinned ? "bg-primary/15 text-primary" : "bg-background/80 text-foreground hover:bg-accent"}`}
                  onClick={() => onPin(participant.socketId)}
                >
                  {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                </Button>
              )}
              {!participant.isAudioOn && (
                <div className="p-1.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
                  <MicOff className="w-3.5 h-3.5" />
                </div>
              )}
              {!participant.isVideoOn && (
                <div className="p-1.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
                  <VideoOff className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          </div>
        </motion.div>
      );
    }
  )
);

export default function VideoCall() {
  const [, params] = useRoute("/call/:roomId");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { settings, updateSettings } = useSettings();
  const { toast } = useToast();

  const [socket, setSocket] = useState<Socket | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  // Initialize participants with a placeholder for the local user immediately
  const [participants, setParticipants] = useState<Map<string, Participant>>(() => {
    const map = new Map();
    // We don't have user object fully yet probably, but we can set a placeholder
    // creating a better optimistic UI
    map.set("local", {
      socketId: "local",
      userId: "", // Will update when user loads
      name: "You",
      avatar: "",
      isLocal: true,
      isVideoOn: settings.autoJoinVideo,
      isAudioOn: settings.autoJoinAudio,
      stream: undefined, // Stream is loading
      status: "connecting",
      isLoading: true, // Custom flag for UI
    } as any);
    return map;
  });
  const roomId = params?.roomId || "";
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [meetingId] = useState<string | null>(null);

  // Outgoing-call context (set by Chats when starting a call): show a
  // "Ringing…" state until the other side answers or declines.
  const callQuery =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const isOutgoing = callQuery?.get("outgoing") === "1";
  const outgoingName = callQuery?.get("name") || "";
  const [isRinging, setIsRinging] = useState(isOutgoing);

  // Fetch initial chat history for the room via HTTP
  useEffect(() => {
    if (!roomId) return;
    fetch(`/api/meetings/room/${encodeURIComponent(roomId)}/messages`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          const formatted: ChatMessage[] = data.map((m: any) => ({
            id: m._id ? m._id.toString() : Date.now().toString(),
            socketId: "",
            userId: m.senderId?.firebaseUid || m.senderId?._id?.toString() || "",
            sender: m.senderId?.name || "Participant",
            avatar: m.senderId?.avatar,
            message: m.content,
            time: m.timestamp
              ? new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            isLocal:
              m.senderId?.firebaseUid === user?.uid || m.senderId?._id === (user as any)?._id,
          }));
          setChatMessages(formatted);
        }
      })
      .catch((err) => console.error("Error fetching room chat history:", err));
  }, [roomId, user]);

  // UI State
  const [isMicOn, setIsMicOn] = useState(settings.autoJoinAudio);
  const [isVideoOn, setIsVideoOn] = useState(settings.autoJoinVideo);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("chat");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  const [, setIsRecording] = useState(false);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [showCaptions, setShowCaptions] = useState(false);
  const [showReactionsMenu, setShowReactionsMenu] = useState(false);

  const [reactions, setReactions] = useState<{ id: string; emoji: string; x: number }[]>([]);

  // Captions State
  const { transcript, startRecognition } = useSpeechRecognition();
  const [captions, setCaptions] = useState<{
    userId: string;
    userName?: string;
    text: string;
    timestamp: number;
  } | null>(null);

  // Toasts default to the bottom-right corner, where the control bar and the
  // side panel live. Inset them while this page is mounted so neither is covered.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--toast-bottom-inset", "8rem");
    root.style.setProperty("--toast-right-inset", isSidebarOpen ? "26rem" : "0rem");
    return () => {
      root.style.removeProperty("--toast-bottom-inset");
      root.style.removeProperty("--toast-right-inset");
    };
  }, [isSidebarOpen]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRecorderRef = useRef<MediaRecorder | null>(null); // Dedicated recorder for captions
  const recordedChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<Map<string, PeerInstance>>(new Map());
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Face/emotion detection on the local video (throttled to ~500ms in the hook).
  // localVideoRef is handed to the local tile via externalVideoRef so this reads
  // real frames from the displayed video element.
  const { expression, confidence, status: emotionStatus } = useFaceExpression(localVideoRef);
  const { videoDevices, audioInputDevices, audioOutputDevices } = useMediaDevices();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Below md the toolbar keeps only the primary controls; the rest move into an
  // overflow menu. Rendered rather than CSS-hidden so crossing the breakpoint
  // cannot leave that menu open with no trigger to anchor to.
  const isCompactToolbar = !useMediaQuery("(min-width: 768px)");
  const [pinnedSocketId, setPinnedSocketId] = useState<string | null>(null);
  const lastSentEmotionRef = useRef<{ emotion: string; timestamp: number }>({
    emotion: "",
    timestamp: 0,
  });
  const callStartTimeRef = useRef<number | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  // The video track peers are actually receiving: the camera normally, the
  // screen while sharing. simple-peer's replaceTrack needs the exact track in
  // flight, which localStream alone cannot tell us during a screen share.
  const sentVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  // Lets the browser's "Stop sharing" bar reach the current handler instead of
  // the one captured when the share started.
  const stopScreenShareRef = useRef<() => void>(() => {});

  // Sync ref with state
  useEffect(() => {
    localStreamRef.current = localStream;
    // While sharing, the screen track is the one in flight — don't clobber it.
    if (!screenStreamRef.current) {
      sentVideoTrackRef.current = localStream?.getVideoTracks()[0] ?? null;
    }

    // If stream changes (and exists), update all existing peers
    if (localStream) {
      peersRef.current.forEach((peer) => {
        // Simple way to ensure stream is sent:
        // We can't easily check if stream is already added in SimplePeer API without accessing internals
        // But if we track it, we can manage it.
        // For now, assume if the peer exists and we have a NEW stream, we might need to replace tracks.
        // But simpler: just addStream if it's the first time, or rely on the initial createPeer.

        // This effect mainly handles the case where stream loads AFTER connection
        // Check internal _senderTracks to see if we are sending?
        // Note: accessing private/internal props is risky.

        // Better approach: When peer is created, we attach the CURRENT stream.
        // If stream changes later, we should use replaceTrack (complex) or renegotiate.
        // For this fix, we focus on connection stability.
        // Let's assume user connects -> stream loads -> we add stream.

        // If peer was created without stream, we need addStream
        // If peer was created without stream, we need addStream
        // Check if any senders exist to determine if we're already sending tracks
        const pc = (peer as any)._pc;
        if (pc && pc.getSenders) {
          if (pc.getSenders().length === 0) {
            peer.addStream(localStream);
          } else {
            // We already have senders, try to replace tracks
            const senders = pc.getSenders();
            const videoSender = senders.find((s: any) => s.track?.kind === "video");
            const audioSender = senders.find((s: any) => s.track?.kind === "audio");

            const newVideoTrack = localStream.getVideoTracks()[0];
            const newAudioTrack = localStream.getAudioTracks()[0];

            if (videoSender && newVideoTrack)
              videoSender
                .replaceTrack(newVideoTrack)
                .catch((e: any) => console.log("Replace video track error", e));
            if (audioSender && newAudioTrack)
              audioSender
                .replaceTrack(newAudioTrack)
                .catch((e: any) => console.log("Replace audio track error", e));
          }
        } else {
          // Fallback/Safety if API mismatch, just try adding if it seems empty (risky but better than crashing)
          // But actually, if getSenders calls failed, we might be in a weird state.
          // Safe default: use addStream if we think we haven't added it.
          // Better: checking _senderTracks on simple-peer internals if possible, but let's stick to standard PC checks.
          // For now, if no PC or no getSenders (unlikely on modern browser), we skip to avoid error.
          console.warn("Could not check peer connection state for stream.");
        }
      });
    }
  }, [localStream]);

  // Debug Face Detection - Removed
  // useEffect(() => { ... }, []);

  // --- Start Local Speech Recognition for Effects ---
  useEffect(() => {
    startRecognition();
  }, [startRecognition]);

  // --- Live Captions Logic (Server-Side Streaming) ---
  //
  // Microphone audio is cut into ~1.5s clips and sent to the server, which runs
  // them through Whisper. This only runs while captions are switched on: it was
  // previously tied to the mic alone, so every call uploaded its audio for
  // transcription whether or not anyone had asked for captions.
  useEffect(() => {
    if (!showCaptions || !isMicOn || !socket || !roomId || !localStream) return;

    // The recorder restarts itself after each clip (each one needs its own file
    // header). Without this flag, the stop() in cleanup fires onstop, which
    // starts another recorder — the loop outlived the effect.
    let cancelled = false;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;

    const startRecordingLoop = () => {
      if (cancelled) return;
      try {
        const audioTrack = localStream.getAudioTracks()[0];
        if (!audioTrack || !audioTrack.enabled) return;

        const mediaStream = new MediaStream([audioTrack]);
        let mimeType = "audio/webm;codecs=opus";
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = "audio/webm";
          if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "";
        }

        const recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
        audioStreamRecorderRef.current = recorder;

        recorder.ondataavailable = (event) => {
          if (!cancelled && event.data && event.data.size > 0 && socket.connected) {
            socket.emit("call:audio-stream", { roomId, audioData: event.data });
          }
        };

        recorder.onstop = () => {
          if (!cancelled && socket.connected && localStream.active) {
            startRecordingLoop();
          }
        };

        recorder.start();
        stopTimer = setTimeout(() => {
          if (recorder.state === "recording") recorder.stop();
        }, 1500);
      } catch (error) {
        console.error("Error in audio loop:", error);
      }
    };

    // Let the track settle before the first clip.
    const timer = setTimeout(startRecordingLoop, 1000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (stopTimer) clearTimeout(stopTimer);
      const recorder = audioStreamRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* recorder already stopped */
        }
      }
      audioStreamRecorderRef.current = null;
    };
  }, [showCaptions, isMicOn, socket, roomId, localStream]);

  useEffect(() => {
    if (!socket) return;

    const handleCaption = (data: { userId: string; text: string; timestamp: number }) => {
      setCaptions(data);
      // Auto-clear after 3 seconds
      setTimeout(() => {
        setCaptions((prev) => (prev?.timestamp === data.timestamp ? null : prev));
      }, 3000);
    };

    socket.on("call:caption", handleCaption);
    return () => {
      socket.off("call:caption", handleCaption);
    };
  }, [socket]);

  // --- Socket Logic ---
  // Consolidating all socket connection and event logic into one effect to prevent race conditions
  useEffect(() => {
    // Only wait for Room ID and User. Do NOT wait for localStream.
    if (!roomId || !user) return;

    // 1. Initialize Socket
    const newSocket = io(window.location.origin, {
      transports: ["websocket", "polling"],
      reconnection: true,
      auth: {
        firebaseToken: "pending", // Will be sent in user:online
      },
    });

    setSocket(newSocket);
    socketRef.current = newSocket;

    // 2. Setup Connection Handlers
    const handleConnect = async () => {
      console.log("Socket connected:", newSocket.id);
      if (!user?.uid || !roomId) return;

      try {
        let token = await auth.currentUser?.getIdToken();
        if (!token) {
          token = user.uid;
        }
        newSocket.emit("user:online", { firebaseToken: token });
      } catch (e) {
        console.error("Error getting token:", e);
      }

      console.log("Emitting call:join for room:", roomId, "userId:", user.uid);
      newSocket.emit("call:join", { roomId, userId: user.uid });
    };

    newSocket.on("connect", handleConnect);
    newSocket.on("disconnect", () => console.log("Socket disconnected"));

    // 3. Event Listeners

    // A: Error Handling
    newSocket.on("call:error", (data: { message: string }) => {
      console.error("Call Error:", data.message);
      toast({ variant: "destructive", title: "Connection Error", description: data.message });
      // Only redirect if it's a critical join error
      if (data.message.includes("already joined")) {
        setTimeout(() => setLocation("/dashboard"), 2000);
      }
    });

    // A2: Outgoing-call outcome (we are the caller, waiting for an answer)
    newSocket.on("call:accepted", () => {
      setIsRinging(false);
    });

    newSocket.on("call:declined", () => {
      setIsRinging(false);
      toast({
        title: "Call declined",
        description: `${outgoingName || "They"} declined your call.`,
      });
      setTimeout(() => setLocation("/chats"), 800);
    });

    // B: Existing participants (We join)
    newSocket.on(
      "call:existing-users",
      ({ participants: existingUsers, startTime }: { participants: any[]; startTime?: string }) => {
        console.log("Existing users received:", existingUsers.length);

        if (startTime) {
          console.log("Syncing timer with server time:", startTime);
          callStartTimeRef.current = new Date(startTime).getTime();
          setCallDuration(0); // Trigger update
        } else {
          callStartTimeRef.current = null;
          setCallDuration(0);
        }

        existingUsers.forEach((user) => {
          createPeer(
            user.socketId,
            user.userId,
            user.userName,
            user.userAvatar,
            true,
            localStreamRef.current
          );
        });
      }
    );

    // C: New user joined (We are existing)
    newSocket.on("call:user-joined", ({ socketId, userId, userName, userAvatar }) => {
      console.log("New user joined:", socketId);
      setIsRinging(false);
      createPeer(socketId, userId, userName, userAvatar, false, localStreamRef.current);
    });

    // D: Meeting Activated
    newSocket.on("call:meeting-active", ({ startTime }: { startTime: string }) => {
      console.log("Meeting Activated! Syncing timer:", startTime);
      callStartTimeRef.current = new Date(startTime).getTime();
      setCallDuration(0);
    });

    // E: Signaling
    newSocket.on("call:signal", ({ signal, senderId }) => {
      const peer = peersRef.current.get(senderId);
      if (peer) {
        peer.signal(signal);
      } else {
        // Handle late signal / non-initiator case
        console.log("Received signal for new peer:", senderId);
        createPeer(senderId, senderId, "Connecting...", "", false, localStreamRef.current);
        // Wait a tick for peer to be created in map? createPeer is sync but state update is async
        // peersRef is a Ref so it's sync.
        const newPeer = peersRef.current.get(senderId);
        if (newPeer) newPeer.signal(signal);
      }
    });

    // F: User Left
    newSocket.on("call:user-left", ({ socketId }) => {
      const peer = peersRef.current.get(socketId);
      if (peer) peer.destroy();
      peersRef.current.delete(socketId);
      setParticipants((prev) => {
        const newMap = new Map(prev);
        newMap.delete(socketId);
        return newMap;
      });
    });

    // G: Chat & Media
    newSocket.on("call:chat-history", (history: ChatMessage[]) => {
      if (Array.isArray(history) && history.length > 0) {
        setChatMessages(
          history.map((m) => ({
            ...m,
            isLocal: m.userId === user?.uid,
          }))
        );
        setTimeout(
          () =>
            chatScrollRef.current
              ?.querySelector("[data-radix-scroll-area-viewport]")
              ?.scrollTo({ top: 99999, behavior: "smooth" }),
          100
        );
      }
    });

    newSocket.on("call:chat-message", (msg: ChatMessage) => {
      setChatMessages((prev) => [
        ...prev,
        { ...msg, isLocal: msg.socketId === newSocket.id || msg.userId === user?.uid },
      ]);
      setTimeout(
        () =>
          chatScrollRef.current
            ?.querySelector("[data-radix-scroll-area-viewport]")
            ?.scrollTo({ top: 99999, behavior: "smooth" }),
        100
      );
    });

    newSocket.on("call:media-toggled", ({ socketId, mediaType, enabled }) => {
      setParticipants((prev) => {
        const newMap = new Map(prev);
        const p = newMap.get(socketId);
        if (p) {
          const updatedP = { ...p };
          if (mediaType === "video") updatedP.isVideoOn = enabled;
          if (mediaType === "audio") updatedP.isAudioOn = enabled;
          newMap.set(socketId, updatedP);
        }
        return newMap;
      });
    });

    newSocket.on("call:reaction", ({ emoji }) => {
      const id = Date.now().toString() + Math.random();
      const x = Math.random() * 80 + 10;
      setReactions((prev) => [...prev, { id, emoji, x }]);
      setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 2000);
    });

    // Captions
    newSocket.on("call:emotion", ({ socketId, emotion, percentage }) => {
      setParticipants((prev) => {
        const p = prev.get(socketId);
        if (!p) return prev;
        const newMap = new Map(prev);
        newMap.set(socketId, { ...p, emotion, engagement: percentage });
        return newMap;
      });
    });

    // Clean up listeners on unmount
    return () => {
      console.log("Cleaning up socket");
      newSocket.disconnect();
      peersRef.current.forEach((p) => p.destroy());
      peersRef.current.clear();
      peersRef.current.clear();
    };
  }, [roomId, user]); // Removed localStream dependency to prevent reconnects

  // Track latest expression/confidence in a ref so the interval can access it without stale closures
  const latestExpressionRef = useRef(expression);
  const latestConfidenceRef = useRef(confidence);

  useEffect(() => {
    latestExpressionRef.current = expression;
    latestConfidenceRef.current = confidence;
  }, [expression, confidence]);

  // Emit emotion data to server (sampled every 1s)
  useEffect(() => {
    if (!socket || !roomId || !settings.emotionDetection || emotionStatus !== "ready") return;

    const sampleAndEmit = () => {
      const currentSentiment = latestExpressionRef.current;
      const currentConfidence = latestConfidenceRef.current;
      const now = Date.now();
      const isDifferent = currentSentiment !== lastSentEmotionRef.current.emotion;
      const timeSinceLast = now - lastSentEmotionRef.current.timestamp;

      // Emit if changed (with small debounce) or heartbeat needed
      if ((isDifferent && timeSinceLast > 1000) || timeSinceLast > 5000) {
        socket.emit("call:emotion", {
          roomId,
          emotion: currentSentiment,
          percentage: Math.round(currentConfidence * 100),
        });
        lastSentEmotionRef.current = { emotion: currentSentiment, timestamp: now };
      }
    };

    const timer = setInterval(sampleAndEmit, 1000);
    return () => clearInterval(timer);
  }, [socket, roomId, settings.emotionDetection, emotionStatus]);

  // --- Initialization ---

  // 1. Initialize Local Media
  useEffect(() => {
    const initMedia = async () => {
      try {
        const qualityConstraints = {
          sd: { width: { ideal: 640 }, height: { ideal: 480 } },
          hd: { width: { ideal: 1280 }, height: { ideal: 720 } },
          "full-hd": { width: { ideal: 1920 }, height: { ideal: 1080 } },
        };

        const selectedQuality =
          qualityConstraints[settings.videoQuality as keyof typeof qualityConstraints] ||
          qualityConstraints["sd"];

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            ...selectedQuality,
            frameRate: { max: 30 },
            facingMode: settings.videoDeviceId ? undefined : "user",
            deviceId: settings.videoDeviceId ? { exact: settings.videoDeviceId } : undefined,
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            deviceId: settings.audioDeviceId ? { exact: settings.audioDeviceId } : undefined,
          },
        });

        // Apply initial settings
        stream.getAudioTracks().forEach((t) => (t.enabled = settings.autoJoinAudio));
        stream.getVideoTracks().forEach((t) => (t.enabled = settings.autoJoinVideo));

        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Add local participant
        setParticipants((prev) => {
          const newMap = new Map(prev);
          newMap.set("local", {
            socketId: "local",
            userId: user?.uid || "",
            name: user?.displayName || "You",
            avatar: user?.photoURL || "",
            isLocal: true,
            isVideoOn: settings.autoJoinVideo,
            isAudioOn: settings.autoJoinAudio,
            stream: stream,
          });
          return newMap;
        });
      } catch (err) {
        console.error("Error accessing media devices:", err);
        toast({
          title: "Media Error",
          description: "Could not access camera/microphone.",
          variant: "destructive",
        });
      }
    };

    initMedia();

    return () => {
      // Cleanup local stream on unmount
      localStream?.getTracks().forEach((track) => track.stop());
    };
  }, [
    settings.videoQuality,
    settings.audioQuality,
    settings.videoDeviceId,
    settings.audioDeviceId,
  ]); // Re-run when devices change

  // Old effect removed in favor of consolidated one

  // --- Helper: Create Peer ---
  function createPeer(
    targetSocketId: string,
    userId: string,
    name: string,
    avatar: string,
    initiator: boolean,
    stream: MediaStream | null
  ) {
    // Avoid duplicate peers
    if (peersRef.current.has(targetSocketId)) return;

    const peer = new SimplePeer({
      initiator,
      trickle: true,
      stream: stream || undefined,
      config: {
        iceServers: ICE_SERVERS,
      },
    });

    peer.on("signal", (signal) => {
      socketRef.current?.emit("call:signal", {
        targetSocketId,
        signal,
        roomId, // Server needs room ID to verify or route? Usually just targetId is enough for direct routing, but server implementation varies.
      });
    });

    peer.on("stream", (remoteStream) => {
      console.log("Received stream from:", targetSocketId);
      setParticipants((prev) => {
        const newMap = new Map(prev);
        // Update or create participant
        newMap.set(targetSocketId, {
          socketId: targetSocketId,
          userId,
          name: name || "User",
          avatar,
          isLocal: false,
          isVideoOn: true, // Assume on initially
          isAudioOn: true,
          stream: remoteStream,
          peer,
          status: "connected",
        });
        return newMap;
      });
    });

    peer.on("connect", () => {
      console.log("Peer connected:", targetSocketId);
    });

    peer.on("error", (err) => {
      console.error("Peer error with " + targetSocketId, err);
    });

    peersRef.current.set(targetSocketId, peer);

    // Add placeholder participant until stream arrives
    setParticipants((prev) => {
      const newMap = new Map(prev);
      if (!newMap.has(targetSocketId)) {
        newMap.set(targetSocketId, {
          socketId: targetSocketId,
          userId,
          name: name || "User",
          avatar,
          isLocal: false,
          isVideoOn: true,
          isAudioOn: true,
          stream: undefined, // Waiting for stream
          peer,
          status: "connecting",
        });
      }
      return newMap;
    });
  }

  // --- Actions ---
  const toggleMic = () => {
    if (!localStream) return;
    const enabled = !isMicOn;
    localStream.getAudioTracks().forEach((t) => (t.enabled = enabled));
    setIsMicOn(enabled);

    // Update local participant state
    setParticipants((prev) => {
      const newMap = new Map(prev);
      const p = newMap.get("local");
      if (p) {
        newMap.set("local", { ...p, isAudioOn: enabled });
      }
      return newMap;
    });

    socket?.emit("call:toggle-media", { roomId, mediaType: "audio", enabled });
  };

  const toggleVideo = () => {
    if (!localStream) return;
    const enabled = !isVideoOn;
    localStream.getVideoTracks().forEach((t) => (t.enabled = enabled));
    setIsVideoOn(enabled);

    // Update local participant state in map so UI reflects change
    setParticipants((prev) => {
      const newMap = new Map(prev);
      const p = newMap.get("local");
      if (p) {
        newMap.set("local", { ...p, isVideoOn: enabled });
      }
      return newMap;
    });

    socket?.emit("call:toggle-media", { roomId, mediaType: "video", enabled });
  };

  /**
   * Swap the video track every peer is receiving.
   *
   * simple-peer's replaceTrack needs the track it is *currently* sending as the
   * first argument, so the track in flight is tracked explicitly rather than
   * guessed from localStream (which still holds the camera track while a screen
   * is being shared). A peer that joined with the camera off has no track to
   * replace, so failures are per-peer and must not abort the rest.
   */
  const replaceOutgoingVideoTrack = (nextTrack: MediaStreamTrack) => {
    const current = sentVideoTrackRef.current;
    if (!current || !localStream) return;
    peersRef.current.forEach((peer) => {
      try {
        peer.replaceTrack(current, nextTrack, localStream);
      } catch (err) {
        console.warn("Could not replace video track on a peer:", err);
      }
    });
    sentVideoTrackRef.current = nextTrack;
  };

  const setLocalPreviewStream = (stream: MediaStream) => {
    setParticipants((prev) => {
      const local = prev.get("local");
      if (!local) return prev;
      const newMap = new Map(prev);
      newMap.set("local", { ...local, stream });
      return newMap;
    });
  };

  const stopScreenShare = () => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;

    const cameraTrack = localStream?.getVideoTracks()[0];
    if (cameraTrack) replaceOutgoingVideoTrack(cameraTrack);
    if (localStream) setLocalPreviewStream(localStream);

    setIsScreenSharing(false);
  };

  const startScreenShare = async () => {
    try {
      // audio is best-effort: browsers that cannot capture system audio simply
      // return a stream without an audio track.
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      screenStreamRef.current = screenStream;
      const screenTrack = screenStream.getVideoTracks()[0];

      // The browser's own "Stop sharing" bar ends the track. The old handler
      // called toggleScreenShare(), which closed over isScreenSharing === false
      // and so started a *second* share instead of stopping.
      screenTrack.onended = () => stopScreenShareRef.current();

      replaceOutgoingVideoTrack(screenTrack);
      setLocalPreviewStream(screenStream);
      setIsScreenSharing(true);
    } catch (err) {
      screenStreamRef.current = null;
      // Dismissing the picker is a normal outcome, not an error worth a toast.
      if (err instanceof DOMException && err.name === "NotAllowedError") return;
      console.error("Screen share failed", err);
      toast({
        title: "Could not share screen",
        description: err instanceof Error ? err.message : "Your browser refused the request.",
        variant: "destructive",
      });
    }
  };

  stopScreenShareRef.current = stopScreenShare;

  const toggleScreenShare = () => (isScreenSharing ? stopScreenShare() : startScreenShare());

  const togglePanel = (tab: "chat" | "participants") => {
    if (isSidebarOpen && activeTab === tab) {
      setIsSidebarOpen(false);
    } else {
      setIsSidebarOpen(true);
      setActiveTab(tab);
    }
  };

  const endCall = async () => {
    try {
      if (meetingId) {
        const token = await getAuthToken();
        if (token) {
          await fetch(`/api/meetings/${meetingId}/status`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ status: "ended" }),
          });
        }
        setLocation(`/summary/${meetingId}`);
      } else {
        setLocation("/dashboard");
      }
    } catch (error) {
      console.error("Error ending call:", error);
      setLocation("/dashboard");
    }
  };

  const copyInviteLink = () => {
    // Copy only Room ID code
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    toast({
      title: "Room ID Copied!",
      description: "Code copied to clipboard.",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !socket) return;
    socket.emit("call:chat-message", {
      roomId,
      message,
      userId: user?.uid,
      sender: user?.displayName || "User",
      avatar: user?.photoURL || "",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    });
    setMessage("");
  };

  // Unwired feature (no UI control yet); kept for future use.
  const _startRecording = async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { mediaSource: "screen" } as any,
        audio: true,
      });

      // Combine screen audio with local microphone audio
      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();

      // Add screen audio
      screenStream.getAudioTracks().forEach((track) => {
        const source = audioContext.createMediaStreamSource(new MediaStream([track]));
        source.connect(destination);
      });

      // Add local microphone audio if available
      if (localStream && localStream.getAudioTracks().length > 0) {
        localStream.getAudioTracks().forEach((track) => {
          const source = audioContext.createMediaStreamSource(new MediaStream([track]));
          source.connect(destination);
        });
      }

      // Create a new stream with screen video and combined audio
      const combinedStream = new MediaStream([
        ...screenStream.getVideoTracks(),
        ...destination.stream.getAudioTracks(),
      ]);

      const recorder = new MediaRecorder(combinedStream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `recording - ${new Date().toISOString()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        recordedChunksRef.current = [];
        setIsRecording(false);
        combinedStream.getTracks().forEach((t) => t.stop()); // Stop all tracks from the combined stream
        screenStream.getTracks().forEach((t) => t.stop()); // Ensure original screen stream tracks are stopped
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);

      // Handle user stopping share via browser UI
      screenStream.getVideoTracks()[0].onended = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      };
    } catch (err) {
      console.error("Recording failed", err);
      toast({
        title: "Recording Error",
        description: "Failed to start recording. Make sure you grant screen and audio permissions.",
        variant: "destructive",
      });
    }
  };

  const _stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const sendReaction = (emoji: string) => {
    setShowReactionsMenu(false);
    socket?.emit("call:reaction", { roomId, emoji });
    const id = Date.now().toString() + Math.random();
    const x = Math.random() * 80 + 10;
    setReactions((prev) => [...prev, { id, emoji, x }]);
    setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== id));
    }, 2000);
  };

  const _toggleMusic = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(
        "https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112191.mp3"
      );
      audioRef.current.loop = true;
      audioRef.current.volume = 0.2; // Low volume background
    }

    if (isMusicPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch((e) => console.error("Audio play failed", e));
    }
    setIsMusicPlaying(!isMusicPlaying);
  };

  // --- Timer ---
  // --- Timer ---
  useEffect(() => {
    const i = setInterval(() => {
      if (callStartTimeRef.current) {
        setCallDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
      } else {
        setCallDuration(0);
      }
    }, 1000);
    return () => clearInterval(i);
  }, []);

  const formatDuration = (s: number) => {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${min}:${sec.toString().padStart(2, "0")} `;
  };

  // --- Render ---
  const participantsList = Array.from(participants.values());
  const hasMultipleParticipants = participantsList.length > 1;

  // Dynamic Grid / Layout Logic
  const getGridClass = () => {
    // Both Mobile & Desktop: If Multiple, Local is floating. Grid only holds Remotes.
    // Effective Count = Remotes Count.
    const effectiveCount = hasMultipleParticipants
      ? participantsList.length - 1
      : participantsList.length;

    if (pinnedSocketId) return "flex flex-col md:flex-row w-full h-full";

    // Mobile Base (Grid)
    let mobileClass = "";
    if (effectiveCount === 1) mobileClass = "grid grid-cols-1 grid-rows-1";
    else if (effectiveCount === 2)
      mobileClass = "grid grid-cols-1 grid-rows-2"; // Stack 2 vertical on mobile
    else if (effectiveCount <= 4) mobileClass = "grid grid-cols-2 grid-rows-2";
    else mobileClass = "grid grid-cols-2 auto-rows-fr"; // 3+ columns flow

    // Desktop Base (Flex or Grid)
    // For desktop, let's stick to flex for now as it centers nicely, or precise grid
    let desktopClass = "md:grid md:grid-cols-2 md:grid-rows-1"; // Default for small counts
    if (effectiveCount === 1) desktopClass = "md:flex md:items-center md:justify-center";
    else if (effectiveCount === 2) desktopClass = "md:grid md:grid-cols-2 md:grid-rows-1";
    else if (effectiveCount <= 4) desktopClass = "md:grid md:grid-cols-2 md:grid-rows-2";
    else desktopClass = "md:grid md:grid-cols-3 md:auto-rows-fr";

    return `${mobileClass} ${desktopClass} w-full h-full`;
  };

  return (
    <div className="h-screen w-full bg-gradient-to-b from-muted/40 via-background to-muted/60 overflow-hidden relative font-sans">
      {/* Outgoing call: waiting for the other side to pick up */}
      {isRinging && (
        <div className="absolute top-20 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-2.5 rounded-full border border-border bg-card/95 px-4 py-2 text-foreground shadow-sm backdrop-blur-sm">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-sm font-medium">
              Ringing{outgoingName ? ` ${outgoingName}` : ""}…
            </span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="absolute top-4 md:top-6 left-0 right-0 z-50 flex justify-center items-center pointer-events-none px-4">
        <div className="pointer-events-auto bg-card/90 backdrop-blur-md px-4 py-1.5 md:px-5 md:py-2 rounded-full flex gap-3 md:gap-4 text-foreground border border-border items-center shadow-[0_2px_12px_-4px_rgba(0,0,0,0.12)] overflow-hidden max-w-full">
          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            <span className="w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
            <span className="font-semibold tracking-wide text-sm md:text-lg truncate max-w-[100px] md:max-w-none">
              {roomId}
            </span>
          </div>
          <div className="h-4 md:h-5 w-px bg-border shrink-0" />
          <span className="font-mono text-xs md:text-base text-muted-foreground shrink-0">
            {formatDuration(callDuration)}
          </span>
          <div className="hidden md:block h-5 w-px bg-border shrink-0" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 md:h-9 md:w-9 rounded-full hover:bg-accent transition-colors shrink-0"
                onClick={copyInviteLink}
              >
                {copied ? (
                  <Check className="w-4 h-4 md:w-5 md:h-5 text-emerald-600" />
                ) : (
                  <Copy className="w-4 h-4 md:w-5 md:h-5 text-muted-foreground" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Copy Link</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Video Grid. Padding is split rather than using the p-* shorthand:
          pinned mode needs its own top inset so the filmstrip clears the header,
          and a shorthand would fight it depending on which rule Tailwind emits
          last. */}
      <div
        className={`w-full h-full relative overflow-hidden bg-transparent px-2 md:px-4 pb-24 md:pb-32 gap-2 md:gap-3 transition-[padding] duration-300 ${
          pinnedSocketId ? "pt-20 md:pt-24" : "pt-2 md:pt-4"
        } ${isSidebarOpen ? "lg:pr-[27rem]" : ""} ${getGridClass()}`}
      >
        <AnimatePresence mode="popLayout">
          {/* Default Grid Mode */}
          {!pinnedSocketId &&
            participantsList.map((p) => {
              // WhatsApp Style Logic
              const isLocal = p.isLocal;
              const isAlone = participantsList.length === 1;
              const isOneOnOne = participantsList.length === 2;

              // Class Construction
              let containerClass = "overflow-hidden transition-all duration-500 "; // No base position

              if (isLocal && !isAlone) {
                // Local & Others present: Floating PIP (bottom-right)
                // Stacked higher on mobile to avoid controls
                // The side panel owns the right edge while it is open, so the
                // self-view steps aside instead of hiding behind it.
                containerClass +=
                  "fixed bottom-24 right-4 w-28 md:bottom-32 md:w-64 md:right-8 aspect-[3/4] md:aspect-video z-[60] rounded-2xl shadow-[0_8px_32px_-8px_rgba(0,0,0,0.35)] ring-1 ring-border object-cover transition-[right] duration-300 " +
                  (isSidebarOpen ? "lg:right-[27rem] " : "");
              } else if (isAlone || (isOneOnOne && !isLocal)) {
                // The only face on screen: centred 16:9 card on desktop, full
                // bleed on mobile where there is no room to spare.
                containerClass +=
                  "col-span-full row-span-full w-full h-full z-0 md:h-auto md:max-h-full md:aspect-video";
              } else if (p.isLocal) {
                // Fallback for local
                return null;
              } else {
                // Group Remote or Fallback: Grid Cell
                containerClass += "relative w-full h-full";
              }

              return (
                <div key={p.socketId} className={containerClass}>
                  <RemoteParticipantVideo
                    externalVideoRef={localVideoRef}
                    participant={p}
                    onPin={setPinnedSocketId}
                    isPinned={false}
                    className="w-full h-full object-cover"
                  />
                </div>
              );
            })}

          {/* Pinned Mode */}
          {pinnedSocketId && (
            <>
              {/* Spotlight (Pinned User) */}
              <div className="flex-1 min-h-0 min-w-0 flex items-center justify-center">
                {(() => {
                  const pinnedUser = participantsList.find((p) => p.socketId === pinnedSocketId);
                  if (!pinnedUser) return null;
                  return (
                    <div className="relative w-full h-full md:h-auto md:max-h-full md:aspect-video">
                      <RemoteParticipantVideo
                        externalVideoRef={localVideoRef}
                        participant={pinnedUser}
                        onPin={() => setPinnedSocketId(null)} // Unpin
                        isPinned={true}
                        isSpotlightMode={true}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  );
                })()}
              </div>

              {/* Filmstrip (Others) */}
              <div className="h-28 md:h-auto md:w-56 shrink-0 flex md:flex-col gap-2 md:gap-3 overflow-x-auto md:overflow-x-hidden md:overflow-y-auto p-1">
                {participantsList
                  .filter((p) => p.socketId !== pinnedSocketId)
                  .map((p) => (
                    <div key={p.socketId} className="w-40 md:w-full aspect-video relative shrink-0">
                      <RemoteParticipantVideo
                        externalVideoRef={localVideoRef}
                        participant={p}
                        onPin={setPinnedSocketId}
                        isPinned={false}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
              </div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Captions Overlay Moved to Bottom - duplicate removed */}

      {/* Controls */}
      <div className="absolute bottom-4 md:bottom-10 left-0 right-0 md:left-1/2 md:-translate-x-1/2 z-50 flex justify-center p-2 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-1 md:gap-2 p-1.5 md:p-2 bg-card/90 backdrop-blur-md rounded-2xl border border-border shadow-[0_4px_24px_-8px_rgba(0,0,0,0.22)] max-w-[calc(100vw-1rem)]">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isMicOn ? "ghost" : "destructive"}
                size="icon"
                aria-label={isMicOn ? "Mute microphone" : "Unmute microphone"}
                aria-pressed={!isMicOn}
                className={toolbarButton()}
                onClick={toggleMic}
              >
                {isMicOn ? <Mic /> : <MicOff />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isMicOn ? "Mute Microphone" : "Unmute Microphone"}</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isVideoOn ? "ghost" : "destructive"}
                size="icon"
                aria-label={isVideoOn ? "Turn off camera" : "Turn on camera"}
                aria-pressed={!isVideoOn}
                className={toolbarButton()}
                onClick={toggleVideo}
              >
                {isVideoOn ? <VideoIcon /> : <VideoOff />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isVideoOn ? "Turn Off Camera" : "Turn On Camera"}</p>
            </TooltipContent>
          </Tooltip>

          {/* Screen share is unavailable on most mobile browsers, so it lives in
              the overflow menu there rather than taking a primary slot. */}
          {canShareScreen && !isCompactToolbar && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={isScreenSharing ? "Stop sharing screen" : "Share screen"}
                  aria-pressed={isScreenSharing}
                  className={toolbarButton(isScreenSharing)}
                  onClick={toggleScreenShare}
                >
                  <MonitorUp />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isScreenSharing ? "Stop Sharing" : "Share Screen"}</p>
              </TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Chat"
                aria-pressed={isSidebarOpen && activeTab === "chat"}
                className={toolbarButton(isSidebarOpen && activeTab === "chat")}
                onClick={() => togglePanel("chat")}
              >
                <MessageSquare />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Chat</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Participants"
                aria-pressed={isSidebarOpen && activeTab === "participants"}
                className={toolbarButton(isSidebarOpen && activeTab === "participants")}
                onClick={() => togglePanel("participants")}
              >
                <Users />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Participants</p>
            </TooltipContent>
          </Tooltip>

          {/* Reactions — available at every width. */}
          <Popover open={showReactionsMenu} onOpenChange={setShowReactionsMenu}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Send a reaction"
                    aria-pressed={showReactionsMenu}
                    className={toolbarButton(showReactionsMenu)}
                  >
                    <Smile />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>Reactions</p>
              </TooltipContent>
            </Tooltip>
            <PopoverContent side="top" align="center" className="z-[80] w-auto p-2">
              <div className="flex gap-1">
                {REACTION_EMOJI.map((emoji) => (
                  <button
                    key={emoji}
                    aria-label={`React with ${emoji}`}
                    onClick={() => sendReaction(emoji)}
                    className="p-2 hover:bg-accent rounded-xl text-xl leading-none transition-transform active:scale-95"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {!isCompactToolbar && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={showCaptions ? "Hide captions" : "Show captions"}
                  aria-pressed={showCaptions}
                  className={toolbarButton(showCaptions)}
                  onClick={() => setShowCaptions(!showCaptions)}
                >
                  <Captions />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{showCaptions ? "Hide Captions" : "Show Captions"}</p>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Everything that does not fit a phone's toolbar. */}
          {isCompactToolbar && (
            <Popover>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="More options"
                      className={toolbarButton()}
                    >
                      <MoreHorizontal />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>More</p>
                </TooltipContent>
              </Tooltip>
              <PopoverContent side="top" align="end" className="z-[80] w-52 p-1">
                {canShareScreen && (
                  <button
                    onClick={toggleScreenShare}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-accent transition-colors"
                  >
                    <MonitorUp className="w-4 h-4 shrink-0" />
                    {isScreenSharing ? "Stop sharing" : "Share screen"}
                  </button>
                )}
                <button
                  onClick={() => setShowCaptions(!showCaptions)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-accent transition-colors"
                >
                  <Captions className="w-4 h-4 shrink-0" />
                  {showCaptions ? "Hide captions" : "Show captions"}
                </button>
                <button
                  onClick={() => setIsSettingsOpen(true)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-accent transition-colors"
                >
                  <Settings className="w-4 h-4 shrink-0" />
                  Settings
                </button>
              </PopoverContent>
            </Popover>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="destructive"
                aria-label="End call"
                className="rounded-xl md:rounded-2xl px-3 md:px-6 h-10 md:h-12 shrink-0 md:[&_svg]:size-5"
                onClick={endCall}
              >
                <PhoneOff />
                <span className="hidden md:inline">End</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>End Call &amp; View Summary</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Sidebar (Chat & Participants) */}
      {isSidebarOpen && (
        <div className="absolute top-20 md:top-24 right-0 md:right-6 bottom-32 md:bottom-28 w-full md:w-96 bg-card md:rounded-2xl border-l md:border border-border flex flex-col z-[70] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.25)] overflow-hidden animate-in slide-in-from-right-10 fade-in duration-300">
          <div className="p-4 border-b border-border flex justify-between items-center">
            <h3 className="text-foreground font-medium">
              {activeTab === "chat" ? "Group Chat" : "Participants"}
            </h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={() => setIsSidebarOpen(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="px-4 pt-2">
              <TabsList className="w-full bg-muted">
                <TabsTrigger value="chat" className="flex-1">
                  Chat
                </TabsTrigger>
                <TabsTrigger value="participants" className="flex-1">
                  People ({participants.size})
                </TabsTrigger>
                <TabsTrigger value="info" className="flex-1">
                  Info
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent
              value="chat"
              className="flex-1 data-[state=active]:flex flex-col min-h-0 mt-0"
            >
              <div className="flex-1 p-4 overflow-y-auto space-y-4" ref={chatScrollRef}>
                {chatMessages.length === 0 && (
                  <div className="text-center text-foreground/30 text-sm mt-10">
                    No messages yet. Start the conversation!
                  </div>
                )}
                {chatMessages.map((m) => (
                  <div key={m.id} className={`flex gap-3 ${m.isLocal ? "flex-row-reverse" : ""}`}>
                    {!m.isLocal && (
                      <Avatar className="h-8 w-8 border border-border">
                        <AvatarImage src={m.avatar} />
                        <AvatarFallback className="text-[10px] bg-indigo-500 text-foreground">
                          {getInitials(m.sender)}
                        </AvatarFallback>
                      </Avatar>
                    )}

                    <div
                      className={`flex flex-col max-w-[75%] ${m.isLocal ? "items-end" : "items-start"}`}
                    >
                      <div
                        className={`flex items-baseline gap-2 mb-1 ${m.isLocal ? "flex-row-reverse" : ""}`}
                      >
                        <span className="text-xs text-muted-foreground font-medium">
                          {m.isLocal ? "You" : m.sender}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{m.time}</span>
                      </div>
                      <div
                        className={`p-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                          m.isLocal
                            ? "bg-blue-600 text-foreground rounded-tr-sm"
                            : "bg-accent/60 text-foreground border border-border rounded-tl-sm"
                        }`}
                      >
                        {m.message}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <form
                onSubmit={sendMessage}
                className="p-3 border-t border-border flex gap-2 items-center bg-muted/30"
              >
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="bg-muted border-border text-foreground rounded-xl focus:border-blue-500/50"
                  placeholder="Type a message..."
                />
                <Button
                  type="submit"
                  size="icon"
                  className="bg-blue-600 hover:bg-blue-700 rounded-xl"
                  disabled={!message.trim()}
                >
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="participants" className="flex-1 overflow-y-auto p-2 mt-0">
              <div className="space-y-1">
                {Array.from(participants.values()).map((p) => (
                  <div
                    key={p.socketId}
                    className="flex items-center gap-3 p-3 rounded-xl hover:bg-muted transition-colors"
                  >
                    <Avatar className="h-10 w-10 border border-border">
                      <AvatarImage src={p.avatar} />
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {getInitials(p.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">
                          {p.name}
                          {p.isLocal && p.name !== "You" && " (You)"}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground capitalize">
                        {p.isLocal ? "Host" : "Participant"}
                      </span>
                    </div>
                    {/* The animated mood widget needs room to read, so it lives
                        here rather than floating over the video. */}
                    {p.emotion && (
                      <div className="w-9 h-9 flex items-center justify-center shrink-0">
                        <div className="scale-[0.55] origin-center">
                          <SmartPulse
                            sentiment={p.emotion}
                            engagement={p.engagement || 0}
                            showLabel={false}
                          />
                        </div>
                      </div>
                    )}
                    <div className="flex gap-1">
                      {!p.isAudioOn ? (
                        <div className="p-2 rounded-full bg-red-500/20 text-red-400">
                          <MicOff className="w-3 h-3" />
                        </div>
                      ) : (
                        <div className="p-2 rounded-full bg-green-500/20 text-green-400">
                          <Mic className="w-3 h-3" />
                        </div>
                      )}
                      {!p.isVideoOn ? (
                        <div className="p-2 rounded-full bg-red-500/20 text-red-400">
                          <VideoOff className="w-3 h-3" />
                        </div>
                      ) : (
                        <div className="p-2 rounded-full bg-green-500/20 text-green-400">
                          <VideoIcon className="w-3 h-3" />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
            <TabsContent value="info" className="flex-1 p-4 space-y-6 mt-0">
              <div className="space-y-4">
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Room Details
                  </h4>
                  <div className="p-4 rounded-xl bg-muted border border-border space-y-4">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1.5 block">Room ID</label>
                      <div className="flex items-center gap-2 bg-muted/50 p-2 rounded-lg border border-border">
                        <code className="text-sm font-mono text-foreground flex-1 truncate">
                          {roomId}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          onClick={copyInviteLink}
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Invite
                  </h4>
                  <div className="p-4 rounded-xl bg-muted border border-border">
                    <Button
                      className="w-full bg-primary hover:bg-primary/90"
                      onClick={copyInviteLink}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Invitation Link
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Helper Components */}
      {/* Debug UI Removed */}
      <AnimatePresence>
        {reactions.map((r) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: 0, scale: 0.5, filter: "blur(0px)" }}
            animate={{
              opacity: [0, 1, 1, 0],
              y: -300,
              scale: [0.5, 1.5, 2],
              filter: ["blur(0px)", "blur(2px)", "blur(8px)"],
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2.5, ease: "easeOut" }}
            className="absolute bottom-28 left-1/2 pointer-events-none text-5xl z-40"
            style={{
              marginLeft: `${((r.x % 13) - 6) * 14}px`,
            }}
          >
            {r.emoji}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Voice Reactive Effects Overlay */}
      <VoiceEffectsOverlay transcript={transcript} isEnabled={true} />

      {/* Captions Toggle */}
      <AnimatePresence>
        {showCaptions && captions && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            className="absolute bottom-28 md:bottom-32 left-1/2 -translate-x-1/2 z-40 max-w-3xl w-full px-6 flex justify-center pointer-events-none"
          >
            <div className="bg-black/60 backdrop-blur-md rounded-2xl p-4 text-center border border-white/10 shadow-2xl">
              <div className="flex items-center justify-center gap-2 mb-1">
                <Sparkles className="w-3 h-3 text-primary animate-pulse" />
                <span className="text-xs font-medium text-primary uppercase tracking-wider">
                  {captions.userName || "Speaker"}
                </span>
              </div>
              <p className="text-lg md:text-xl font-medium text-white/90 leading-relaxed">
                {captions.text}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Dialog */}
      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Call Settings</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {/* Camera Selection */}
            <div className="space-y-2">
              <Label>Camera</Label>
              <Select
                value={settings.videoDeviceId}
                onValueChange={(val) => updateSettings({ videoDeviceId: val })}
              >
                <SelectTrigger className="w-full bg-muted border-border text-foreground">
                  <SelectValue placeholder="Select Camera" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-border text-foreground">
                  {videoDevices.map((device) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${device.deviceId.slice(0, 5)}...`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Microphone Selection */}
            <div className="space-y-2">
              <Label>Microphone</Label>
              <Select
                value={settings.audioDeviceId}
                onValueChange={(val) => updateSettings({ audioDeviceId: val })}
              >
                <SelectTrigger className="w-full bg-muted border-border text-foreground">
                  <SelectValue placeholder="Select Microphone" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-border text-foreground">
                  {audioInputDevices.map((device) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Output Selection (Chrome only usually) */}
            {audioOutputDevices.length > 0 && (
              <div className="space-y-2">
                <Label>Speaker</Label>
                <Select
                  value={settings.audioOutputDeviceId}
                  onValueChange={(val) => updateSettings({ audioOutputDeviceId: val })}
                >
                  <SelectTrigger className="w-full bg-muted border-border text-foreground">
                    <SelectValue placeholder="Select Speaker" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-border text-foreground">
                    {audioOutputDevices.map((device) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label || `Speaker ${device.deviceId.slice(0, 5)}...`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

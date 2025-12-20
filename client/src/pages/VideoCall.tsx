
import { useState, useEffect, useRef, useMemo, useCallback, memo, forwardRef } from "react";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PhoneOff, Mic, MicOff, Video as VideoIcon, VideoOff, MonitorUp, MessageSquare, Users, Sparkles, Copy, Check, Send, X, Music, Info, Captions, Smile, Settings, LogOut, LayoutGrid, Maximize2, Pin, PinOff } from "lucide-react";
import { VoiceWave } from "@/components/VoiceWave";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { io, Socket } from "socket.io-client";
import { useAuth } from "@/lib/auth";
import { auth } from "@/lib/firebase";
import { getAvatarUrl, getInitials } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useSettings } from "@/lib/settings";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SmartPulse } from "@/components/SmartPulse";
import { useAudioAnalysis } from "@/hooks/useAudioAnalysis";
import { useFaceExpression } from "@/hooks/useFaceExpression";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { VoiceEffectsOverlay } from "@/components/VoiceEffectsOverlay";
import { useMediaDevices } from "@/hooks/useMediaDevices";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
  status?: 'connecting' | 'connected' | 'failed';
  emotion?: "Happy" | "Neutral" | "Sad" | "Surprised" | "Angry";
  engagement?: number;
};


type ChatMessage = {
  id: string;
  socketId: string;
  sender: string;
  avatar?: string;
  message: string;
  time: string;
  isLocal?: boolean;
};

// Local Video Component
const LocalVideo = memo(({ stream, isVideoOn, videoRef, volume }: { stream: MediaStream | null; isVideoOn: boolean; videoRef: React.RefObject<HTMLVideoElement>; volume: number }) => {
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
        className="w-full h-full object-cover rounded-[2rem] transition-opacity duration-300 opacity-100"
      />
      {isVideoOn && (
        <div className="absolute bottom-4 right-4 z-10 pointer-events-none">
          <VoiceWave volume={volume} isSpeaking={volume > 10} />
        </div>
      )}
    </>
  );
});

// Remote Video Component
const RemoteVideo = memo(({ stream, isVideoOn }: { stream: MediaStream | undefined; isVideoOn: boolean }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { volume, isSpeaking } = useAudioAnalysis(stream || null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => console.error("[RemoteVideo] Play error:", e));
    }
  }, [stream]);

  return (
    <>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-cover rounded-[2rem] transition-opacity duration-300 opacity-100"
      />
      {isVideoOn && (
        <div className="absolute bottom-4 right-4 z-10 pointer-events-none">
          <VoiceWave volume={volume} isSpeaking={isSpeaking} />
        </div>
      )}
    </>
  );
});

// Remote Participant Video Wrapper

type RemoteParticipantVideoProps = {
  participant: Participant;
  onPin?: (id: string) => void;
  isPinned?: boolean;
  isSpotlightMode?: boolean;
  className?: string;
};

const RemoteParticipantVideo = memo(forwardRef<HTMLDivElement, RemoteParticipantVideoProps>(({ participant, onPin, isPinned, isSpotlightMode, className }, ref) => {
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
      className={`relative ${baseClasses} bg-black/50 rounded-2xl md:rounded-[2rem] overflow-hidden shadow-2xl group transition-all duration-300 ${participant.isAudioOn && (volume > 20 && !participant.isLocal) ? 'border-2 border-green-500 shadow-[0_0_30px_rgba(34,197,94,0.3)]' : 'border border-white/10'}`}
    >
      {/* Video Element */}
      {participant.isLocal ? (
        <LocalVideo stream={participant.stream || null} isVideoOn={participant.isVideoOn} videoRef={localVideoRef} volume={volume} />
      ) : (
        <RemoteVideo stream={participant.stream} isVideoOn={participant.isVideoOn} />
      )}

      {/* Smart Pulse Indicator (Remote Only) */}
      {!participant.isLocal && participant.emotion && (
        <div className="absolute top-4 left-4 z-50 transform scale-75 md:scale-90">
          <SmartPulse
            sentiment={participant.emotion}
            engagement={participant.engagement || 0}
            className="!w-16 !h-16"
          />
        </div>
      )}

      {/* Status Indicator */}
      {!participant.isLocal && participant.status === 'connecting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
          <div className="text-white text-sm font-light animate-pulse">Connecting...</div>
        </div>
      )}

      {/* Fallback Avatar */}
      {!participant.isVideoOn && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/5">
          <Avatar className="h-24 w-24 border-4 border-white/10">
            <AvatarImage src={participant.avatar} />
            <AvatarFallback className="bg-primary text-white text-2xl">{getInitials(participant.name)}</AvatarFallback>
          </Avatar>
        </div>
      )}

      {/* Overlay Info */}
      <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-white font-medium bg-black/60 px-2 py-1 rounded-md text-sm">{participant.name} {participant.isLocal && "(You)"}</span>
        <div className="flex gap-2">
          {onPin && (
            <Button
              size="icon"
              variant="ghost"
              className={`h-8 w-8 rounded-full ${isPinned ? 'bg-blue-500/20 text-blue-400' : 'bg-black/40 text-white hover:bg-white/20'}`}
              onClick={() => onPin(participant.socketId)}
            >
              {isPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
            </Button>
          )}
          {!participant.isAudioOn && <MicOff className="w-4 h-4 text-red-500" />}
          {!participant.isVideoOn && <VideoOff className="w-4 h-4 text-red-500" />}
        </div>
      </div>
    </motion.div>
  );
}));


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
      status: 'connecting',
      isLoading: true // Custom flag for UI
    } as any);
    return map;
  });
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [meetingId, setMeetingId] = useState<string | null>(null);

  // UI State
  const [isMicOn, setIsMicOn] = useState(settings.autoJoinAudio);
  const [isVideoOn, setIsVideoOn] = useState(settings.autoJoinVideo);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("chat");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  const [isRecording, setIsRecording] = useState(false);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [showCaptions, setShowCaptions] = useState(false);
  const [showReactionsMenu, setShowReactionsMenu] = useState(false);

  const [reactions, setReactions] = useState<{ id: string; emoji: string; x: number }[]>([]);

  // Captions State
  const { isListening, transcript, startRecognition, stopRecognition, resetTranscript } = useSpeechRecognition();
  const [captions, setCaptions] = useState<{ userId: string; userName?: string; text: string; timestamp: number } | null>(null);

  useEffect(() => {
    if (captions) console.log("Caption Received:", captions);
  }, [captions]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRecorderRef = useRef<MediaRecorder | null>(null); // Dedicated recorder for captions
  const recordedChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const roomId = params?.roomId || "";
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<Map<string, PeerInstance>>(new Map());
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const { volume } = useAudioAnalysis(localStream);

  // Face Expression Hook - Removed for performance as ref was not attached
  // const { expression, confidence, isLoaded: isFaceModelLoaded } = useFaceExpression(localVideoRef);
  const expression = "Neutral"; // Fallback
  const confidence = 0;
  const isFaceModelLoaded = false;
  const { videoDevices, audioInputDevices, audioOutputDevices } = useMediaDevices();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [pinnedSocketId, setPinnedSocketId] = useState<string | null>(null);
  const sentiment = expression; // Simplified for now
  const lastSentEmotionRef = useRef<{ emotion: string; timestamp: number }>({ emotion: "", timestamp: 0 });
  const callStartTimeRef = useRef<number | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Sync ref with state
  useEffect(() => {
    localStreamRef.current = localStream;

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
        if (!(peer as any)._pc.getLocalStreams().length) {
          peer.addStream(localStream);
        } else {
          // If we already have a stream, replacing tracks is cleaner but complex.
          // We'll skip complex replacement for now to avoid breaking existing logic,
          // focusing on the "connects then loads" case.
          const senders = (peer as any)._pc.getSenders();
          const videoSender = senders.find((s: any) => s.track?.kind === 'video');
          const audioSender = senders.find((s: any) => s.track?.kind === 'audio');

          const newVideoTrack = localStream.getVideoTracks()[0];
          const newAudioTrack = localStream.getAudioTracks()[0];

          if (videoSender && newVideoTrack) videoSender.replaceTrack(newVideoTrack);
          if (audioSender && newAudioTrack) audioSender.replaceTrack(newAudioTrack);
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
  useEffect(() => {
    // Cleanup previous recorder
    if (audioStreamRecorderRef.current && audioStreamRecorderRef.current.state !== "inactive") {
      try {
        audioStreamRecorderRef.current.stop();
      } catch (e) {
        // ignore
      }
    }

    if (!isMicOn || !socket || !roomId || !localStream || !settings.autoJoinAudio) return;

    // Small delay to ensure stream is ready and prevent rapid toggling issues
    const startRecordingLoop = () => {
      try {
        const audioTrack = localStream.getAudioTracks()[0];
        if (!audioTrack || !audioTrack.enabled) return;

        const mediaStream = new MediaStream([audioTrack]);
        let mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/webm';
          if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';
        }

        const recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
        audioStreamRecorderRef.current = recorder;

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0 && socket.connected) {
            socket.emit("call:audio-stream", { roomId, audioData: event.data });
          }
        };

        // Recursive restart to ensure valid file headers
        recorder.onstop = () => {
          if (isMicOn && socket?.connected && localStream?.active) {
            startRecordingLoop();
          }
        };

        recorder.start();
        // Stop after 1.5 seconds to reduce lag (3s was too slow)
        setTimeout(() => {
          if (recorder.state === 'recording') recorder.stop();
        }, 1500);

      } catch (error) {
        console.error("Error in audio loop:", error);
      }
    };

    // Small delay to ensure stream is ready
    const timer = setTimeout(() => {
      console.log("🎙️ Starting audio loop for captions...");
      startRecordingLoop();
    }, 1000);

    return () => {
      clearTimeout(timer);
      if (audioStreamRecorderRef.current && audioStreamRecorderRef.current.state !== "inactive") {
        try {
          audioStreamRecorderRef.current.stop();
        } catch (e) { }
      }
    };
  }, [isMicOn, socket, roomId, localStream, settings.autoJoinAudio]);


  useEffect(() => {
    if (!socket) return;

    const handleCaption = (data: { userId: string; text: string; timestamp: number }) => {
      setCaptions(data);
      // Auto-clear after 3 seconds
      setTimeout(() => {
        setCaptions(prev => (prev?.timestamp === data.timestamp ? null : prev));
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
      transports: ['websocket', 'polling'],
      reconnection: true,
      auth: {
        firebaseToken: "pending" // Will be sent in user:online
      }
    });

    setSocket(newSocket);
    socketRef.current = newSocket;

    // 2. Setup Connection Handlers
    const handleConnect = async () => {
      console.log("Socket connected:", newSocket.id);
      try {
        const token = await auth.currentUser?.getIdToken();
        if (token) {
          newSocket.emit("user:online", { firebaseToken: token });
          console.log("Emitting call:join for room:", roomId);
          newSocket.emit("call:join", { roomId, userId: user.uid });
        }
      } catch (e) {
        console.error("Error getting token:", e);
      }
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

    // B: Existing participants (We join)
    newSocket.on("call:existing-users", ({ participants: existingUsers, startTime }: { participants: any[], startTime?: string }) => {
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
        createPeer(user.socketId, user.userId, user.userName, user.userAvatar, true, localStreamRef.current);
      });
    });

    // C: New user joined (We are existing)
    newSocket.on("call:user-joined", ({ socketId, userId, userName, userAvatar }) => {
      console.log("New user joined:", socketId);
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
      setParticipants(prev => {
        const newMap = new Map(prev);
        newMap.delete(socketId);
        return newMap;
      });
    });

    // G: Chat & Media
    newSocket.on("call:chat-message", (msg: ChatMessage) => {
      setChatMessages(prev => [...prev, { ...msg, isLocal: msg.socketId === newSocket.id }]);
      setTimeout(() => chatScrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')?.scrollTo({ top: 99999, behavior: 'smooth' }), 100);
    });

    newSocket.on("call:media-toggled", ({ socketId, mediaType, enabled }) => {
      setParticipants(prev => {
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

    newSocket.on("call:reaction", ({ socketId, emoji }) => {
      const id = Date.now().toString() + Math.random();
      const x = Math.random() * 80 + 10;
      setReactions(prev => [...prev, { id, emoji, x }]);
      setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 2000);
    });

    // Captions
    newSocket.on("call:caption", (data) => {
      setCaptions(data);
      setTimeout(() => setCaptions(prev => (prev?.timestamp === data.timestamp ? null : prev)), 3000);
    });

    newSocket.on("call:emotion", ({ socketId, emotion, percentage }) => {
      console.log(`[DEBUG] Received emotion from ${socketId}: ${emotion} (${percentage}%)`);
      setParticipants(prev => {
        const p = prev.get(socketId);
        // Debug
        if (!p) console.warn(`[DEBUG] Participant ${socketId} not found in map`);

        if (p) {
          // FORCE UPDATE for debugging - remove the threshold check temporarily or log it
          console.log(`[DEBUG] Updating participant ${p.name} emotion to ${emotion}`);
          const newMap = new Map(prev);
          newMap.set(socketId, { ...p, emotion, engagement: percentage });
          return newMap;
        }
        return prev;
      });
    });

    // Clean up listeners on unmount
    return () => {
      console.log("Cleaning up socket");
      newSocket.disconnect();
      peersRef.current.forEach(p => p.destroy());
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
    if (!socket || !roomId || !settings.emotionDetection) return;

    const sampleAndEmit = () => {
      const currentSentiment = latestExpressionRef.current;
      const currentConfidence = latestConfidenceRef.current;
      const now = Date.now();
      const isDifferent = currentSentiment !== lastSentEmotionRef.current.emotion;
      const timeSinceLast = now - lastSentEmotionRef.current.timestamp;

      // Emit if changed (with small debounce) or heartbeat needed
      if ((isDifferent && timeSinceLast > 1000) || timeSinceLast > 5000) {
        console.log(`[DEBUG] Auto - Emitting: ${currentSentiment}`);
        socket.emit("call:emotion", {
          roomId,
          emotion: currentSentiment,
          percentage: Math.round(currentConfidence * 100)
        });
        lastSentEmotionRef.current = { emotion: currentSentiment, timestamp: now };
      }
    };

    const timer = setInterval(sampleAndEmit, 1000);
    return () => clearInterval(timer);
  }, [socket, roomId, settings.emotionDetection]);

  // --- Initialization ---

  // 1. Initialize Local Media
  useEffect(() => {
    const initMedia = async () => {
      try {
        const qualityConstraints = {
          "sd": { width: { ideal: 640 }, height: { ideal: 480 } },
          "hd": { width: { ideal: 1280 }, height: { ideal: 720 } },
          "full-hd": { width: { ideal: 1920 }, height: { ideal: 1080 } }
        };

        const selectedQuality = qualityConstraints[settings.videoQuality as keyof typeof qualityConstraints] || qualityConstraints["sd"];

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            ...selectedQuality,
            frameRate: { max: 30 },
            facingMode: settings.videoDeviceId ? undefined : "user",
            deviceId: settings.videoDeviceId ? { exact: settings.videoDeviceId } : undefined
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            deviceId: settings.audioDeviceId ? { exact: settings.audioDeviceId } : undefined
          }
        });

        // Apply initial settings
        stream.getAudioTracks().forEach(t => t.enabled = settings.autoJoinAudio);
        stream.getVideoTracks().forEach(t => t.enabled = settings.autoJoinVideo);

        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Add local participant
        setParticipants(prev => {
          const newMap = new Map(prev);
          newMap.set("local", {
            socketId: "local",
            userId: user?.uid || "",
            name: user?.displayName || "You",
            avatar: user?.photoURL || "",
            isLocal: true,
            isVideoOn: settings.autoJoinVideo,
            isAudioOn: settings.autoJoinAudio,
            stream: stream
          });
          return newMap;
        });

      } catch (err) {
        console.error("Error accessing media devices:", err);
        toast({
          title: "Media Error",
          description: "Could not access camera/microphone.",
          variant: "destructive"
        });
      }
    };

    initMedia();

    return () => {
      // Cleanup local stream on unmount
      localStream?.getTracks().forEach(track => track.stop());
    };
  }, [settings.videoQuality, settings.audioQuality, settings.videoDeviceId, settings.audioDeviceId]); // Re-run when devices change

  // Old effect removed in favor of consolidated one

  // --- Helper: Create Peer ---
  function createPeer(targetSocketId: string, userId: string, name: string, avatar: string, initiator: boolean, stream: MediaStream | null) {
    // Avoid duplicate peers
    if (peersRef.current.has(targetSocketId)) return;

    const peer = new SimplePeer({
      initiator,
      trickle: true,
      stream: stream || undefined,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
        ]
      }
    });

    peer.on("signal", (signal) => {
      socketRef.current?.emit("call:signal", {
        targetSocketId,
        signal,
        roomId // Server needs room ID to verify or route? Usually just targetId is enough for direct routing, but server implementation varies.
      });
    });

    peer.on("stream", (remoteStream) => {
      console.log("Received stream from:", targetSocketId);
      setParticipants(prev => {
        const newMap = new Map(prev);
        // Update or create participant
        const existing = newMap.get(targetSocketId);
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
          status: 'connected'
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
    setParticipants(prev => {
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
          status: 'connecting'
        });
      }
      return newMap;
    });
  }

  // --- Actions ---
  const toggleMic = () => {
    if (!localStream) return;
    const enabled = !isMicOn;
    localStream.getAudioTracks().forEach(t => t.enabled = enabled);
    setIsMicOn(enabled);

    // Update local participant state
    setParticipants(prev => {
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
    localStream.getVideoTracks().forEach(t => t.enabled = enabled);
    setIsVideoOn(enabled);

    // Update local participant state in map so UI reflects change
    setParticipants(prev => {
      const newMap = new Map(prev);
      const p = newMap.get("local");
      if (p) {
        newMap.set("local", { ...p, isVideoOn: enabled });
      }
      return newMap;
    });

    socket?.emit("call:toggle-media", { roomId, mediaType: "video", enabled });
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      // Stop screen share
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;

      // Revert to camera
      if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
          peersRef.current.forEach(peer => {
            const sender = peer.streams[0]?.getVideoTracks()[0]; // Replaces current track
            // SimplePeer replaceTrack is complex, easier to just remove/add stream or replace track if supported
            // For simple-peer, replaceTrack is usually handled by:
            if (peer.replaceTrack && sender) {
              peer.replaceTrack(sender, videoTrack, localStream!);
            }
          });

          // Update local participant
          setParticipants(prev => {
            const newMap = new Map(prev);
            const local = newMap.get("local");
            if (local) newMap.set("local", { ...local, stream: localStream });
            return newMap;
          });
        }
      }
      setIsScreenSharing(false);
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screenStream;
        const screenTrack = screenStream.getVideoTracks()[0];

        screenTrack.onended = () => toggleScreenShare(); // Handle "Stop Sharing" browser UI

        if (localStream) {
          const cameraTrack = localStream.getVideoTracks()[0];
          peersRef.current.forEach(peer => {
            // Replace camera track with screen track
            // Note: simple-peer wrapper for RTCPeerConnection.replaceTrack
            const sender = peer.streams[0]?.getVideoTracks()[0]; // Current track being sent
            // If existing connection has a video track, replace it
            // Note: simple-peer exposes the raw RTCPeerConnection as peer._pc, but standard API is replaceTrack on sender
            // peer.replaceTrack(oldTrack, newTrack, stream)
            if (cameraTrack) {
              peer.replaceTrack(cameraTrack, screenTrack, localStream!);
            }
          });

          // Update local view to show screen share
          setParticipants(prev => {
            const newMap = new Map(prev);
            const local = newMap.get("local");
            if (local) newMap.set("local", { ...local, stream: screenStream });
            return newMap;
          });
        }
        setIsScreenSharing(true);
      } catch (err) {
        console.error("Screen share failed", err);
      }
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
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    setMessage("");
  };

  const startRecording = async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { mediaSource: "screen" } as any,
        audio: true
      });

      // Combine screen audio with local microphone audio
      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();

      // Add screen audio
      screenStream.getAudioTracks().forEach(track => {
        const source = audioContext.createMediaStreamSource(new MediaStream([track]));
        source.connect(destination);
      });

      // Add local microphone audio if available
      if (localStream && localStream.getAudioTracks().length > 0) {
        localStream.getAudioTracks().forEach(track => {
          const source = audioContext.createMediaStreamSource(new MediaStream([track]));
          source.connect(destination);
        });
      }

      // Create a new stream with screen video and combined audio
      const combinedStream = new MediaStream([
        ...screenStream.getVideoTracks(),
        ...destination.stream.getAudioTracks()
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
        combinedStream.getTracks().forEach(t => t.stop()); // Stop all tracks from the combined stream
        screenStream.getTracks().forEach(t => t.stop()); // Ensure original screen stream tracks are stopped
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
        variant: "destructive"
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const sendReaction = (emoji: string) => {
    socket?.emit("call:reaction", { roomId, emoji });
    const id = Date.now().toString() + Math.random();
    const x = Math.random() * 80 + 10;
    setReactions(prev => [...prev, { id, emoji, x }]);
    setTimeout(() => {
      setReactions(prev => prev.filter(r => r.id !== id));
    }, 2000);
  };

  const toggleMusic = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio("https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112191.mp3");
      audioRef.current.loop = true;
      audioRef.current.volume = 0.2; // Low volume background
    }

    if (isMusicPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(e => console.error("Audio play failed", e));
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
    return `${min}:${sec.toString().padStart(2, '0')} `;
  };

  // --- Render ---
  const participantsList = Array.from(participants.values());
  const localParticipant = participantsList.find(p => p.isLocal);
  const otherParticipants = participantsList.filter(p => !p.isLocal);
  const hasMultipleParticipants = participantsList.length > 1;

  // Dynamic Grid / Layout Logic
  const getGridClass = () => {
    // Both Mobile & Desktop: If Multiple, Local is floating. Grid only holds Remotes.
    // Effective Count = Remotes Count.
    const effectiveCount = hasMultipleParticipants ? participantsList.length - 1 : participantsList.length;

    if (pinnedSocketId) return "flex-col md:flex-row";

    // Mobile Base (Grid)
    let mobileClass = "";
    if (effectiveCount === 1) mobileClass = "grid grid-cols-1 grid-rows-1";
    else if (effectiveCount === 2) mobileClass = "grid grid-cols-1 grid-rows-2";
    else if (effectiveCount <= 4) mobileClass = "grid grid-cols-2 grid-rows-2";
    else mobileClass = "grid grid-cols-2";

    // Desktop Base (Flex)
    let desktopClass = "md:flex md:flex-wrap md:justify-center md:content-center";

    return `${mobileClass} ${desktopClass}`;
  };


  return (
    <div className="h-screen w-full bg-background/95 backdrop-blur-3xl overflow-hidden relative">
      {/* Smart Pulse */}
      <div className="absolute top-24 left-4 z-50 hidden md:block">
        <SmartPulse sentiment={sentiment} engagement={Math.max(20, volume)} />
      </div>

      {/* Header */}
      <div className="absolute top-12 md:top-6 left-0 right-0 z-50 flex justify-center items-center pointer-events-none px-4">
        <div className="pointer-events-auto bg-black/40 backdrop-blur-md px-4 py-2 md:px-6 md:py-3 rounded-full flex gap-3 md:gap-6 text-white border border-white/10 items-center shadow-2xl transition-all hover:bg-black/50 overflow-hidden max-w-full">
          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            <span className="w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
            <span className="font-semibold tracking-wide text-sm md:text-lg truncate max-w-[100px] md:max-w-none">{roomId}</span>
          </div>
          <div className="h-4 md:h-5 w-px bg-white/20 shrink-0" />
          <span className="font-mono text-xs md:text-base opacity-90 shrink-0">{formatDuration(callDuration)}</span>
          <div className="hidden md:block h-5 w-px bg-white/20 shrink-0" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 md:h-9 md:w-9 rounded-full hover:bg-white/10 transition-colors shrink-0" onClick={copyInviteLink}>
                {copied ? <Check className="w-4 h-4 md:w-5 md:h-5 text-green-400" /> : <Copy className="w-4 h-4 md:w-5 md:h-5 text-white/90" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>Copy Link</p></TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Video Grid */}
      <div className="w-full h-full relative overflow-hidden bg-black">
        <AnimatePresence mode="popLayout">
          {/* Default Grid Mode */}
          {!pinnedSocketId && participantsList.map((p) => {
            // WhatsApp Style Logic
            const isLocal = p.isLocal;
            const isAlone = participantsList.length === 1;
            const isOneOnOne = participantsList.length === 2;
            const isGroup = participantsList.length > 2;

            // Class Construction - preventing conflicts
            let containerClass = "overflow-hidden transition-all duration-500 "; // No base position

            if (isLocal && !isAlone) {
              // Local & Others present: Floating PIP (bottom-right)
              // STRICTLY FIXED. Remove 'relative' to avoid conflict.
              containerClass += "fixed !bottom-20 !right-4 w-24 md:w-56 aspect-[3/4] md:aspect-video z-[60] rounded-xl shadow-2xl border border-white/20 ring-1 ring-black/50 object-cover";
            }
            else if (isAlone) {
              // Alone: Local User is Full Screen
              containerClass += "absolute inset-0 w-full h-full z-0";
            }
            else if (isOneOnOne && !isLocal) {
              // One-on-One Remote: Full Screen
              containerClass += "absolute inset-0 w-full h-full z-0";
            }
            else {
              // Group Remote or Fallback: Grid Cell
              containerClass += "relative w-full h-full bg-zinc-900";
            }

            return (
              <div
                key={p.socketId}
                className={containerClass}
              >
                <RemoteParticipantVideo
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
              <div className="flex-1 w-full h-full min-h-0 flex items-center justify-center">
                {(() => {
                  const pinnedUser = participantsList.find(p => p.socketId === pinnedSocketId);
                  if (!pinnedUser) return null;
                  return (
                    <div className="w-full h-full relative aspect-video max-h-[80vh]">
                      <RemoteParticipantVideo
                        participant={pinnedUser}
                        onPin={() => setPinnedSocketId(null)} // Unpin
                        isPinned={true}
                        isSpotlightMode={true}
                      />
                    </div>
                  );
                })()}
              </div>

              {/* Filmstrip (Others) */}
              <div className="h-32 md:h-full md:w-64 flex md:flex-col gap-4 overflow-auto p-2">
                {participantsList.filter(p => p.socketId !== pinnedSocketId).map(p => (
                  <div key={p.socketId} className="min-w-[160px] md:min-w-0 md:w-full aspect-video relative shrink-0">
                    <RemoteParticipantVideo
                      participant={p}
                      onPin={setPinnedSocketId}
                      isPinned={false}
                    />
                  </div>
                ))}
              </div>
            </>
          )}

        </AnimatePresence>
      </div >

      {/* Captions Overlay Moved to Bottom - duplicate removed */}

      {/* Controls */}
      <div className="absolute bottom-4 md:bottom-10 left-0 right-0 md:left-1/2 md:-translate-x-1/2 z-50 flex justify-center md:gap-4 p-2 pointer-events-none">
        <div className="pointer-events-auto flex gap-3 md:gap-4 p-2 md:p-4 bg-black/80 md:bg-black/60 backdrop-blur-2xl rounded-2xl md:rounded-[2.5rem] border border-white/10 shadow-2xl transition-all hover:scale-105 hover:bg-black/90 md:hover:bg-black/70 overflow-x-auto max-w-[95vw] [&::-webkit-scrollbar]:hidden">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isMicOn ? "secondary" : "destructive"}
                size="icon"
                className="rounded-xl md:rounded-2xl w-8 h-8 md:w-12 md:h-12 shrink-0 transition-all duration-200"
                onClick={toggleMic}
              >
                {isMicOn ? <Mic className="w-4 h-4 md:w-5 md:h-5" /> : <MicOff className="w-4 h-4 md:w-5 md:h-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isMicOn ? "Mute Microphone" : "Unmute Microphone"}</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isVideoOn ? "secondary" : "destructive"}
                size="icon"
                size="icon"
                className="rounded-xl md:rounded-2xl w-8 h-8 md:w-12 md:h-12 shrink-0 transition-all duration-200"
                onClick={toggleVideo}
              >
                {isVideoOn ? <VideoIcon className="w-4 h-4 md:w-5 md:h-5" /> : <VideoOff className="w-4 h-4 md:w-5 md:h-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isVideoOn ? "Turn Off Camera" : "Turn On Camera"}</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isScreenSharing ? "secondary" : "ghost"}
                size="icon"
                size="icon"
                className={`text-white hover:bg-white/10 rounded-xl md:rounded-2xl w-8 h-8 md:w-12 md:h-12 shrink-0 transition-all duration-200 ${isScreenSharing ? 'bg-blue-500 text-white' : ''}`}
                onClick={toggleScreenShare}
              >
                <MonitorUp className="w-4 h-4 md:w-5 md:h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isScreenSharing ? "Stop Sharing" : "Share Screen"}</p>
            </TooltipContent>
          </Tooltip>



          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isSidebarOpen && activeTab === "chat" ? "secondary" : "ghost"}
                size="icon"
                size="icon"
                className={`text-white hover:bg-white/10 rounded-xl md:rounded-2xl w-8 h-8 md:w-12 md:h-12 shrink-0 transition-all duration-200 ${isSidebarOpen && activeTab === "chat" ? "bg-white/20" : ""}`}
                onClick={() => {
                  if (isSidebarOpen && activeTab === "chat") {
                    setIsSidebarOpen(false);
                  } else {
                    setIsSidebarOpen(true);
                    setActiveTab("chat");
                  }
                }}
              >
                <MessageSquare className="w-4 h-4 md:w-5 md:h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Chat</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isSidebarOpen && activeTab === "participants" ? "secondary" : "ghost"}
                size="icon"
                size="icon"
                className={`text-white hover:bg-white/10 rounded-xl md:rounded-2xl w-8 h-8 md:w-12 md:h-12 shrink-0 transition-all duration-200 ${isSidebarOpen && activeTab === "participants" ? "bg-white/20" : ""}`}
                onClick={() => {
                  if (isSidebarOpen && activeTab === "participants") {
                    setIsSidebarOpen(false);
                  } else {
                    setIsSidebarOpen(true);
                    setActiveTab("participants");
                  }
                }}
              >
                <Users className="w-4 h-4 md:w-5 md:h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Participants</p>
            </TooltipContent>
          </Tooltip>

          {/* Mobile Reactions */}
          <div className="relative md:hidden shrink-0">
            <AnimatePresence>
              {showReactionsMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 p-2 bg-background/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl flex gap-1 min-w-max"
                >
                  {["👍", "❤️", "😂", "😮", "😢", "🎉", "👏", "🔥"].map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => {
                        if (socket && roomId) {
                          socket.emit("call:reaction", { roomId, emoji });
                          // Show locally
                          const id = Date.now().toString() + Math.random();
                          const x = Math.random() * 80 + 10;
                          setReactions(prev => [...prev, { id, emoji, x }]);
                          setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 2000);
                          setShowReactionsMenu(false);
                        }
                      }}
                      className="p-2 hover:bg-white/10 rounded-xl text-xl transition-transform active:scale-95"
                    >
                      {emoji}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  size="icon"
                  className={`text-white hover:bg-white/10 rounded-xl w-8 h-8 shrink-0 transition-all duration-200 ${showReactionsMenu ? "bg-white/20" : ""}`}
                  onClick={() => setShowReactionsMenu(!showReactionsMenu)}
                >
                  <Smile className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Reactions</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showCaptions ? "secondary" : "ghost"}
                size="icon"
                size="icon"
                className={`text-white hover:bg-white/10 rounded-xl md:rounded-2xl w-8 h-8 md:w-12 md:h-12 shrink-0 transition-all duration-200 ${showCaptions ? "bg-white/20" : ""}`}
                onClick={() => setShowCaptions(!showCaptions)}
              >
                <Captions className="w-4 h-4 md:w-5 md:h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{showCaptions ? "Hide Captions" : "Show Captions"}</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="destructive"
                variant="destructive"
                className="rounded-xl md:rounded-2xl px-4 md:px-6 h-8 md:h-12 bg-red-600 hover:bg-red-700 transition-all duration-200 shrink-0"
                onClick={async () => {
                  try {
                    if (meetingId) {
                      // 1. Attempt to end the meeting on the server
                      const token = await auth.currentUser?.getIdToken();
                      if (token) {
                        await fetch(`/api/meetings/${meetingId}/status`, {
                          method: "PATCH",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`
                          },
                          body: JSON.stringify({ status: "ended" })
                        });
                      }
                      // 2. Redirect to summary
                      setLocation(`/summary/${meetingId}`);
                    } else {
                      // Fallback if meetingId load failed
                      setLocation("/dashboard");
                    }
                  } catch (error) {
                    console.error("Error ending call:", error);
                    setLocation("/dashboard");
                  }
                }}
              >
                <PhoneOff className="mr-2 w-4 h-4 md:w-5 md:h-5" /> <span className="hidden md:inline">End</span>
              </Button >
            </TooltipTrigger >
            <TooltipContent>
              <p>End Call & View Summary</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Right Side Vertical Reaction Bar */}
      <div className={`absolute right-12 top-1/2 -translate-y-1/2 z-40 hidden md:flex flex-col gap-3 p-3 bg-black/40 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl transition-all duration-300 ${isSidebarOpen ? 'translate-x-32 opacity-0 pointer-events-none' : 'translate-x-0 opacity-100'}`}>
        {
          ["👍", "❤️", "😂", "😮", "😢", "🎉", "👏", "🔥"].map((emoji) => (
            <button
              key={emoji}
              onClick={() => {
                if (socket && roomId) {
                  socket.emit("call:reaction", { roomId, emoji });
                  // Show locally
                  const id = Date.now().toString() + Math.random();
                  const x = Math.random() * 80 + 10;
                  setReactions(prev => [...prev, { id, emoji, x }]);
                  setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 2000);
                }
              }}
              className="p-2 hover:bg-white/20 rounded-full text-2xl transition-transform hover:scale-125 active:scale-95"
            >
              {emoji}
            </button>
          ))
        }
      </div>

      {/* Sidebar (Chat & Participants) */}
      {
        isSidebarOpen && (
          <div className="absolute top-20 md:top-24 right-0 md:right-6 bottom-32 md:bottom-28 w-full md:w-96 bg-black/95 md:bg-black/90 backdrop-blur-xl md:rounded-3xl border-l md:border border-white/10 flex flex-col z-[70] shadow-2xl overflow-hidden animate-in slide-in-from-right-10 fade-in duration-300">
            <div className="p-4 border-b border-white/10 flex justify-between items-center">
              <h3 className="text-white font-medium">
                {activeTab === "chat" ? "Group Chat" : "Participants"}
              </h3>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-white/50 hover:text-white" onClick={() => setIsSidebarOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
              <div className="px-4 pt-2">
                <TabsList className="w-full bg-white/5">
                  <TabsTrigger value="chat" className="flex-1">Chat</TabsTrigger>
                  <TabsTrigger value="participants" className="flex-1">People ({participants.size})</TabsTrigger>
                  <TabsTrigger value="info" className="flex-1">Info</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="chat" className="flex-1 flex flex-col min-h-0 mt-0">
                <div className="flex-1 p-4 overflow-y-auto space-y-4" ref={chatScrollRef}>
                  {chatMessages.length === 0 && (
                    <div className="text-center text-white/30 text-sm mt-10">No messages yet. Start the conversation!</div>
                  )}
                  {chatMessages.map(m => (
                    <div key={m.id} className={`flex gap-3 ${m.isLocal ? 'flex-row-reverse' : ''}`}>
                      {!m.isLocal && (
                        <Avatar className="h-8 w-8 border border-white/10">
                          <AvatarImage src={m.avatar} />
                          <AvatarFallback className="text-[10px] bg-indigo-500 text-white">{getInitials(m.sender)}</AvatarFallback>
                        </Avatar>
                      )}

                      <div className={`flex flex-col max-w-[75%] ${m.isLocal ? 'items-end' : 'items-start'}`}>
                        <div className={`flex items-baseline gap-2 mb-1 ${m.isLocal ? 'flex-row-reverse' : ''}`}>
                          <span className="text-xs text-white/70 font-medium">{m.isLocal ? 'You' : m.sender}</span>
                          <span className="text-[10px] text-white/40">{m.time}</span>
                        </div>
                        <div className={`p-3 rounded-2xl text-sm leading-relaxed shadow-sm ${m.isLocal
                          ? 'bg-blue-600 text-white rounded-tr-sm'
                          : 'bg-white/10 text-white border border-white/10 rounded-tl-sm'
                          }`}>
                          {m.message}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <form onSubmit={sendMessage} className="p-3 border-t border-white/10 flex gap-2 items-center bg-black/50">
                  <Input
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    className="bg-white/5 border-white/10 text-white rounded-xl focus:border-blue-500/50"
                    placeholder="Type a message..."
                  />
                  <Button type="submit" size="icon" className="bg-blue-600 hover:bg-blue-700 rounded-xl" disabled={!message.trim()}>
                    <Send className="w-4 h-4" />
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="participants" className="flex-1 overflow-y-auto p-2 mt-0">
                <div className="space-y-1">
                  {Array.from(participants.values()).map((p) => (
                    <div key={p.socketId} className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors">
                      <Avatar className="h-10 w-10 border border-white/10">
                        <AvatarImage src={p.avatar} />
                        <AvatarFallback className="bg-primary text-white">{getInitials(p.name)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white truncate">{p.name} {p.isLocal && "(You)"}</span>
                        </div>
                        <span className="text-xs text-white/40 capitalize">{p.isLocal ? "Host" : "Participant"}</span>
                      </div>
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
                    <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Room Details</h4>
                    <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-4">
                      <div>
                        <label className="text-xs text-white/40 mb-1.5 block">Room ID</label>
                        <div className="flex items-center gap-2 bg-black/20 p-2 rounded-lg border border-white/5">
                          <code className="text-sm font-mono text-white flex-1 truncate">{roomId}</code>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-white/50 hover:text-white" onClick={copyInviteLink}>
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider">Invite</h4>
                    <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                      <Button className="w-full bg-primary hover:bg-primary/90" onClick={copyInviteLink}>
                        <Copy className="w-4 h-4 mr-2" />
                        Copy Invitation Link
                      </Button>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )
      }

      {/* Helper Components */}
      {/* Debug UI Removed */}
      <AnimatePresence>
        {reactions.map(r => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: 0, scale: 0.5, filter: "blur(0px)" }}
            animate={{
              opacity: [0, 1, 1, 0],
              y: -300,
              scale: [0.5, 1.5, 2],
              filter: ["blur(0px)", "blur(2px)", "blur(8px)"]
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2.5, ease: "easeOut" }}
            className="absolute bottom-32 pointer-events-none text-6xl"
            style={{
              right: `${(r.x % 15) + 6}%`,
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
            className="absolute bottom-[15%] left-1/2 -translate-x-1/2 z-50 max-w-3xl w-full px-6 flex justify-center pointer-events-none"
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
        <DialogContent className="sm:max-w-[425px] bg-black/90 border-white/10 text-white">
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
                <SelectTrigger className="w-full bg-white/5 border-white/10 text-white">
                  <SelectValue placeholder="Select Camera" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-white/10 text-white">
                  {videoDevices.map(device => (
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
                <SelectTrigger className="w-full bg-white/5 border-white/10 text-white">
                  <SelectValue placeholder="Select Microphone" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-white/10 text-white">
                  {audioInputDevices.map(device => (
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
                  <SelectTrigger className="w-full bg-white/5 border-white/10 text-white">
                    <SelectValue placeholder="Select Speaker" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10 text-white">
                    {audioOutputDevices.map(device => (
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
    </div >
  );
}

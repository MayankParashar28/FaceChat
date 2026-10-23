import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { io, type Socket } from "socket.io-client";
import { Phone, PhoneOff, Video } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { getAuthToken } from "@/lib/queryClient";
import { getInitials } from "@/lib/utils";

interface IncomingCall {
  fromUserId: string;
  fromName?: string;
  fromAvatar?: string;
  roomId: string;
  callType: "audio" | "video";
}

const RING_TIMEOUT_MS = 30000;

/**
 * App-level incoming-call handler. Keeps a lightweight socket connected for the
 * logged-in user and shows a ringing modal whenever another user calls them,
 * on any page. Accept joins the call room; Decline notifies the caller.
 */
export default function IncomingCallManager() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const socketRef = useRef<Socket | null>(null);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Connect a presence socket so the server can route incoming calls to us.
  useEffect(() => {
    if (!user?.uid) return;

    const socket = io(window.location.origin, {
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("connect", async () => {
      const token = await getAuthToken();
      if (token) socket.emit("user:online", { firebaseToken: token });
    });

    socket.on("call:incoming", (data: IncomingCall) => {
      if (data?.roomId) setIncoming(data);
    });

    // Caller hung up before we answered — stop ringing.
    socket.on("call:cancelled", () => {
      setIncoming(null);
    });

    return () => {
      socket.off("call:incoming");
      socket.off("call:cancelled");
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user?.uid]);

  const clearIncoming = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIncoming(null);
  }, []);

  // Auto-dismiss + soft ring tone while ringing.
  useEffect(() => {
    if (!incoming) return;

    timeoutRef.current = setTimeout(clearIncoming, RING_TIMEOUT_MS);

    let ctx: AudioContext | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        ctx = new AudioCtx();
        const beep = () => {
          if (!ctx) return;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = 480;
          gain.gain.setValueAtTime(0.0001, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.45);
        };
        beep();
        interval = setInterval(beep, 1500);
      }
    } catch {
      /* audio not available — visual ring still shows */
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (interval) clearInterval(interval);
      if (ctx) ctx.close().catch(() => {});
    };
  }, [incoming, clearIncoming]);

  const accept = () => {
    if (!incoming) return;
    const roomId = incoming.roomId;
    // Tell the caller we picked up so they stop ringing and the chat logs it.
    socketRef.current?.emit("call:accept", {
      roomId,
      toUserId: incoming.fromUserId,
    });
    clearIncoming();
    setLocation(`/call/${roomId}`);
  };

  const decline = () => {
    if (incoming && socketRef.current) {
      socketRef.current.emit("call:decline", {
        toUserId: incoming.fromUserId,
        roomId: incoming.roomId,
      });
    }
    clearIncoming();
  };

  return (
    <AnimatePresence>
      {incoming && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          role="dialog"
          aria-label="Incoming call"
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-card p-8 text-center shadow-2xl"
          >
            <p className="mb-1 text-sm font-medium text-muted-foreground">
              Incoming {incoming.callType === "video" ? "video" : "voice"} call
            </p>
            <div className="relative mx-auto my-6 w-fit">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" />
              <Avatar className="relative h-24 w-24 border-2 border-primary/40">
                <AvatarImage src={incoming.fromAvatar} alt={incoming.fromName || "Caller"} />
                <AvatarFallback className="text-2xl">
                  {getInitials(incoming.fromName || "?")}
                </AvatarFallback>
              </Avatar>
            </div>
            <h2 className="mb-8 text-xl font-bold">{incoming.fromName || "Someone"}</h2>
            <div className="flex items-center justify-center gap-10">
              <div className="flex flex-col items-center gap-2">
                <Button
                  onClick={decline}
                  size="icon"
                  className="h-14 w-14 rounded-full bg-red-500 hover:bg-red-600"
                  aria-label="Decline call"
                >
                  <PhoneOff className="h-6 w-6" />
                </Button>
                <span className="text-xs text-muted-foreground">Decline</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Button
                  onClick={accept}
                  size="icon"
                  className="h-14 w-14 rounded-full bg-emerald-500 hover:bg-emerald-600"
                  aria-label="Accept call"
                >
                  {incoming.callType === "video" ? (
                    <Video className="h-6 w-6" />
                  ) : (
                    <Phone className="h-6 w-6" />
                  )}
                </Button>
                <span className="text-xs text-muted-foreground">Accept</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

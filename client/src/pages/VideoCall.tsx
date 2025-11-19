import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Mic, MicOff, Video as VideoIcon, VideoOff, MonitorUp, PhoneOff, MessageSquare, Users, Sparkles, Copy, Check, Send, X, MoreVertical, Smile } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { io, Socket } from "socket.io-client";
import { useAuth } from "@/lib/auth";
import { auth } from "@/lib/firebase";
import { getAvatarUrl, getInitials } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

type Participant = {
  socketId: string;
  userId: string;
  name: string;
  avatar?: string;
  isLocal: boolean;
  isVideoOn: boolean;
  isAudioOn: boolean;
  stream?: MediaStream;
};

type ChatMessage = {
  id: string;
  socketId: string;
  userId: string;
  sender: string;
  avatar?: string;
  message: string;
  time: string;
  isLocal?: boolean;
};

export default function VideoCall() {
  const [, params] = useRoute("/call/:roomId");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [participants, setParticipants] = useState<Map<string, Participant>>(new Map());
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const roomId = params?.roomId || "";
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const socketRef = useRef<Socket | null>(null);
  const callStartTimeRef = useRef<number>(Date.now());
  const iceCandidateQueueRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Initialize socket and media
  useEffect(() => {
    if (!roomId || !user?.uid) return;

    const newSocket = io(window.location.origin, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      timeout: 20000
    });

    newSocket.on("connect", async () => {
      console.log("Socket connected for video call, socket ID:", newSocket.id);

      // Get Firebase token and join call room
      try {
        const firebaseUser = auth.currentUser;
        if (firebaseUser) {
          const token = await firebaseUser.getIdToken();
          newSocket.emit("user:online", { firebaseToken: token });

          // Join the call room
          console.log("Joining call room:", roomId);
          newSocket.emit("call:join", { roomId, userId: user.uid });
        }
      } catch (error) {
        console.error("Failed to join call:", error);
      }
    });

    newSocket.on("disconnect", (reason) => {
      console.log("Socket disconnected:", reason);
      if (reason === "io server disconnect") {
        newSocket.connect();
      }
    });

    newSocket.on("reconnect", async (attemptNumber) => {
      console.log("Socket reconnected after", attemptNumber, "attempts");
      try {
        const firebaseUser = auth.currentUser;
        if (firebaseUser && roomId) {
          const token = await firebaseUser.getIdToken();
          newSocket.emit("user:online", { firebaseToken: token });
          newSocket.emit("call:join", { roomId, userId: user.uid });
          console.log("Rejoined call room after reconnection");
        }
      } catch (error) {
        console.error("Failed to rejoin call after reconnection:", error);
      }
    });

    // Handle existing users in the room
    newSocket.on("call:existing-users", async ({ participants: participantData }: {
      participants: Array<{ socketId: string; userId: string; userName?: string; userAvatar?: string }>
    }) => {
      console.log("Existing users in room:", participantData);

      setParticipants(prev => {
        const newMap = new Map(prev);
        participantData.forEach(({ socketId, userId, userName, userAvatar }) => {
          newMap.set(socketId, {
            socketId,
            userId,
            name: userName || "Participant",
            avatar: userAvatar,
            isLocal: false,
            isVideoOn: true,
            isAudioOn: true
          });
        });
        return newMap;
      });

      const waitForLocalMedia = () => {
        return new Promise<void>((resolve) => {
          if (localStreamRef.current) {
            resolve();
          } else {
            const checkInterval = setInterval(() => {
              if (localStreamRef.current) {
                clearInterval(checkInterval);
                resolve();
              }
            }, 100);
            setTimeout(() => {
              clearInterval(checkInterval);
              resolve();
            }, 5000);
          }
        });
      };

      await waitForLocalMedia();

      for (const { socketId } of participantData) {
        await createPeerConnection(socketId, true);
      }
    });

    // Handle new user joining
    newSocket.on("call:user-joined", async ({ socketId, userId, userName, userAvatar }: {
      socketId: string;
      userId: string;
      userName?: string;
      userAvatar?: string;
    }) => {
      console.log("User joined:", socketId, userId);

      setParticipants(prev => {
        const newMap = new Map(prev);
        newMap.set(socketId, {
          socketId,
          userId,
          name: userName || "Participant",
          avatar: userAvatar,
          isLocal: false,
          isVideoOn: true,
          isAudioOn: true
        });
        return newMap;
      });

      const waitForLocalMedia = () => {
        return new Promise<void>((resolve) => {
          if (localStreamRef.current) {
            resolve();
          } else {
            const checkInterval = setInterval(() => {
              if (localStreamRef.current) {
                clearInterval(checkInterval);
                resolve();
              }
            }, 100);
            setTimeout(() => {
              clearInterval(checkInterval);
              resolve();
            }, 5000);
          }
        });
      };

      await waitForLocalMedia();
      await createPeerConnection(socketId, true);
    });

    // Handle user leaving
    newSocket.on("call:user-left", ({ socketId }: { socketId: string }) => {
      console.log("User left:", socketId);
      closePeerConnection(socketId);
      setParticipants(prev => {
        const newMap = new Map(prev);
        newMap.delete(socketId);
        return newMap;
      });
    });

    // Helper function to process queued ICE candidates
    const processQueuedIceCandidates = async (socketId: string, pc: RTCPeerConnection) => {
      const queuedCandidates = iceCandidateQueueRef.current.get(socketId);
      if (queuedCandidates && queuedCandidates.length > 0) {
        console.log(`Processing ${queuedCandidates.length} queued ICE candidates for ${socketId}`);
        for (const candidate of queuedCandidates) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (error) {
            console.error("Error adding queued ICE candidate:", error);
          }
        }
        iceCandidateQueueRef.current.delete(socketId);
      }
    };

    // WebRTC signaling handlers
    newSocket.on("call:offer", async ({ offer, socketId }: { offer: RTCSessionDescriptionInit; socketId: string }) => {
      console.log("Received offer from:", socketId);
      let pc = peerConnectionsRef.current.get(socketId);

      if (!pc) {
        const waitForLocalMedia = () => {
          return new Promise<void>((resolve) => {
            if (localStreamRef.current) {
              resolve();
            } else {
              const checkInterval = setInterval(() => {
                if (localStreamRef.current) {
                  clearInterval(checkInterval);
                  resolve();
                }
              }, 100);
              setTimeout(() => {
                clearInterval(checkInterval);
                resolve();
              }, 5000);
            }
          });
        };

        await waitForLocalMedia();
        await createPeerConnection(socketId, false);
        pc = peerConnectionsRef.current.get(socketId);
      }

      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          await processQueuedIceCandidates(socketId, pc);

          const answer = await pc.createAnswer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
          });
          await pc.setLocalDescription(answer);
          newSocket.emit("call:answer", {
            roomId,
            answer: {
              type: answer.type,
              sdp: answer.sdp
            },
            targetSocketId: socketId
          });
        } catch (error) {
          console.error("Error handling offer:", error);
        }
      }
    });

    newSocket.on("call:answer", async ({ answer, socketId }: { answer: RTCSessionDescriptionInit; socketId: string }) => {
      console.log("Received answer from:", socketId);
      const pc = peerConnectionsRef.current.get(socketId);
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          await processQueuedIceCandidates(socketId, pc);
        } catch (error) {
          console.error("Error handling answer:", error);
        }
      }
    });

    newSocket.on("call:ice-candidate", async ({ candidate, socketId }: { candidate: RTCIceCandidateInit; socketId: string }) => {
      const pc = peerConnectionsRef.current.get(socketId);
      if (pc && candidate) {
        try {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } else {
            const queue = iceCandidateQueueRef.current.get(socketId) || [];
            queue.push(candidate);
            iceCandidateQueueRef.current.set(socketId, queue);
          }
        } catch (error) {
          console.error("Error adding ICE candidate:", error);
          const queue = iceCandidateQueueRef.current.get(socketId) || [];
          queue.push(candidate);
          iceCandidateQueueRef.current.set(socketId, queue);
        }
      }
    });

    newSocket.on("call:media-toggled", ({ socketId, mediaType, enabled }: {
      socketId: string;
      mediaType: "audio" | "video";
      enabled: boolean
    }) => {
      setParticipants(prev => {
        const newMap = new Map(prev);
        const participant = newMap.get(socketId);
        if (participant) {
          if (mediaType === "audio") {
            participant.isAudioOn = enabled;
          } else {
            participant.isVideoOn = enabled;
          }
          newMap.set(socketId, participant);
        }
        return newMap;
      });
    });

    newSocket.on("call:chat-message", (messageData: ChatMessage) => {
      const isLocal = messageData.socketId === newSocket.id;

      setChatMessages(prev => {
        const exists = prev.some(msg => msg.id === messageData.id);
        if (exists) return prev;

        return [...prev, {
          ...messageData,
          isLocal,
          time: new Date(messageData.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }];
      });

      setTimeout(() => {
        if (chatScrollRef.current) {
          const viewport = chatScrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
          if (viewport) {
            viewport.scrollTop = viewport.scrollHeight;
          }
        }
      }, 100);
    });

    newSocket.on("error", (error) => {
      console.error("Socket error:", error);
    });

    setSocket(newSocket);
    socketRef.current = newSocket;

    initializeLocalMedia().then(() => {
      console.log("Local media initialized");
    });

    return () => {
      newSocket.emit("call:leave", { roomId });
      newSocket.close();
      cleanup();
      setChatMessages([]);
    };
  }, [roomId, user?.uid]);

  // Call duration timer
  useEffect(() => {
    const interval = setInterval(() => {
      setCallDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Ensure local video stream is attached to video element
  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
      localVideoRef.current.play().catch(console.error);
    }
  }, [participants]);

  const initializeLocalMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 60 },
          facingMode: "user"
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(console.error);
      }

      setParticipants(prev => {
        const newMap = new Map(prev);
        newMap.set("local", {
          socketId: "local",
          userId: user?.uid || "",
          name: user?.displayName || user?.username || "You",
          avatar: user?.photoURL || getAvatarUrl(user?.email || ""),
          isLocal: true,
          isVideoOn: true,
          isAudioOn: true,
          stream
        });
        return newMap;
      });
    } catch (error) {
      console.error("Error accessing media devices:", error);
      setParticipants(prev => {
        const newMap = new Map(prev);
        newMap.set("local", {
          socketId: "local",
          userId: user?.uid || "",
          name: user?.displayName || user?.username || "You",
          avatar: user?.photoURL || getAvatarUrl(user?.email || ""),
          isLocal: true,
          isVideoOn: false,
          isAudioOn: false
        });
        return newMap;
      });
    }
  };

  const createPeerConnection = async (socketId: string, isInitiator: boolean) => {
    if (peerConnectionsRef.current.has(socketId)) {
      const existingPc = peerConnectionsRef.current.get(socketId);
      if (existingPc && (existingPc.connectionState === 'closed' || existingPc.connectionState === 'failed')) {
        existingPc.close();
        peerConnectionsRef.current.delete(socketId);
      } else {
        return;
      }
    }

    const configuration: RTCConfiguration = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require"
    };

    const pc = new RTCPeerConnection(configuration);
    peerConnectionsRef.current.set(socketId, pc);

    if (localStreamRef.current) {
      const tracks = localStreamRef.current.getTracks();
      tracks.forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });

      setTimeout(() => {
        if (localStreamRef.current) {
          const videoTracks = localStreamRef.current.getVideoTracks();
          videoTracks.forEach(videoTrack => {
            const sender = pc.getSenders().find(s => s.track === videoTrack);
            if (sender && 'setParameters' in sender) {
              try {
                const params = (sender as RTCRtpSender).getParameters();
                if (params.encodings && params.encodings[0]) {
                  params.encodings[0].maxBitrate = 2500000;
                  params.encodings[0].maxFramerate = 30;
                  (sender as RTCRtpSender).setParameters(params).catch(console.error);
                }
              } catch (error) {
                console.warn("Could not optimize video track:", error);
              }
            }
          });
        }
      }, 100);
    }

    pc.ontrack = (event) => {
      let remoteStream: MediaStream | null = null;

      if (event.streams && event.streams.length > 0) {
        remoteStream = event.streams[0];
      } else if (event.track) {
        remoteStream = new MediaStream([event.track]);
      }

      if (!remoteStream) return;

      const updateParticipantWithStream = (stream: MediaStream) => {
        setParticipants(prev => {
          const newMap = new Map(prev);
          const participant = newMap.get(socketId);
          const videoTrack = stream.getVideoTracks()[0];
          const audioTrack = stream.getAudioTracks()[0];

          const updatedParticipant: Participant = participant ? {
            ...participant,
            stream: stream,
            isVideoOn: videoTrack ? videoTrack.enabled : false,
            isAudioOn: audioTrack ? audioTrack.enabled : false
          } : {
            socketId,
            userId: "",
            name: "Participant",
            isLocal: false,
            isVideoOn: videoTrack ? videoTrack.enabled : false,
            isAudioOn: audioTrack ? audioTrack.enabled : false,
            stream: stream
          };

          newMap.set(socketId, updatedParticipant);
          return newMap;
        });
      };

      updateParticipantWithStream(remoteStream);

      remoteStream.getVideoTracks().forEach(track => {
        track.onended = () => {
          setParticipants(prev => {
            const newMap = new Map(prev);
            const participant = newMap.get(socketId);
            if (participant) {
              participant.isVideoOn = false;
              newMap.set(socketId, participant);
            }
            return newMap;
          });
        };

        track.onmute = () => {
          setParticipants(prev => {
            const newMap = new Map(prev);
            const participant = newMap.get(socketId);
            if (participant) {
              participant.isVideoOn = false;
              newMap.set(socketId, participant);
            }
            return newMap;
          });
        };

        track.onunmute = () => {
          setParticipants(prev => {
            const newMap = new Map(prev);
            const participant = newMap.get(socketId);
            if (participant) {
              participant.isVideoOn = true;
              newMap.set(socketId, participant);
            }
            return newMap;
          });
        };
      });

      remoteStream.getAudioTracks().forEach(track => {
        track.onended = () => {
          setParticipants(prev => {
            const newMap = new Map(prev);
            const participant = newMap.get(socketId);
            if (participant) {
              participant.isAudioOn = false;
              newMap.set(socketId, participant);
            }
            return newMap;
          });
        };

        track.onmute = () => {
          setParticipants(prev => {
            const newMap = new Map(prev);
            const participant = newMap.get(socketId);
            if (participant) {
              participant.isAudioOn = false;
              newMap.set(socketId, participant);
            }
            return newMap;
          });
        };

        track.onunmute = () => {
          setParticipants(prev => {
            const newMap = new Map(prev);
            const participant = newMap.get(socketId);
            if (participant) {
              participant.isAudioOn = true;
              newMap.set(socketId, participant);
            }
            return newMap;
          });
        };
      });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        const candidateData = event.candidate.toJSON ? event.candidate.toJSON() : {
          candidate: event.candidate.candidate,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          sdpMid: event.candidate.sdpMid
        };
        socketRef.current.emit("call:ice-candidate", {
          roomId,
          candidate: candidateData,
          targetSocketId: socketId
        });
      }
    };

    if (isInitiator) {
      try {
        if (!localStreamRef.current) return;
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        await pc.setLocalDescription(offer);
        socketRef.current?.emit("call:offer", {
          roomId,
          offer: {
            type: offer.type,
            sdp: offer.sdp
          },
          targetSocketId: socketId
        });
      } catch (error) {
        console.error("Error creating offer:", error);
      }
    }
  };

  const closePeerConnection = (socketId: string) => {
    const pc = peerConnectionsRef.current.get(socketId);
    if (pc) {
      pc.close();
      peerConnectionsRef.current.delete(socketId);
    }
    iceCandidateQueueRef.current.delete(socketId);
  };

  const cleanup = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }

    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
  };

  const toggleMic = useCallback(() => {
    if (localStreamRef.current) {
      const newState = !isMicOn;
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = newState;
      });
      setIsMicOn(newState);
      socket?.emit("call:toggle-media", { roomId, mediaType: "audio", enabled: newState });
    }
  }, [isMicOn, roomId, socket]);

  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const newState = !isVideoOn;
      localStreamRef.current.getVideoTracks().forEach(track => {
        track.enabled = newState;
      });
      setIsVideoOn(newState);
      socket?.emit("call:toggle-media", { roomId, mediaType: "video", enabled: newState });
    }
  }, [isVideoOn, roomId, socket]);

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
        screenStreamRef.current = null;
      }

      if (localStreamRef.current) {
        const videoTrack = localStreamRef.current.getVideoTracks()[0];
        if (videoTrack) {
          peerConnectionsRef.current.forEach(pc => {
            const sender = pc.getSenders().find(s => s.track?.kind === "video");
            if (sender && videoTrack) {
              sender.replaceTrack(videoTrack);
            }
          });
        }
      }

      setIsScreenSharing(false);
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screenStream;

        const videoTrack = screenStream.getVideoTracks()[0];
        peerConnectionsRef.current.forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === "video");
          if (sender && videoTrack) {
            sender.replaceTrack(videoTrack);
          }
        });

        videoTrack.onended = () => {
          toggleScreenShare();
        };

        setIsScreenSharing(true);
      } catch (error) {
        console.error("Error sharing screen:", error);
      }
    }
  };

  const endCall = useCallback(() => {
    cleanup();
    socket?.emit("call:leave", { roomId });
    setChatMessages([]);
    setLocation("/dashboard");
  }, [roomId, socket, setLocation]);

  const sendMessage = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const messageText = message.trim();

    if (!messageText || !socket || !socket.connected || !user?.uid || !roomId) return;

    try {
      socket.emit("call:chat-message", {
        roomId,
        message: messageText,
        userId: user.uid
      });

      setMessage("");

      setTimeout(() => {
        if (chatScrollRef.current) {
          const viewport = chatScrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
          if (viewport) {
            viewport.scrollTop = viewport.scrollHeight;
          }
        }
      }, 100);
    } catch (error) {
      console.error("Error sending message:", error);
    }
  }, [message, socket, roomId, user]);

  const copyRoomId = useCallback(() => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [roomId]);

  const formatDuration = useCallback((seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const reactions = useMemo(() => ["👍", "👏", "❤️", "😂", "🎉", "🤔"], []);

  const currentSocketId = socketRef.current?.id;

  const participantsList = useMemo(() => {
    return Array.from(participants.values()).filter(p => {
      if (p.isLocal) return true;
      if (currentSocketId && p.socketId === currentSocketId) return false;
      return true;
    });
  }, [participants, currentSocketId]);

  const getGridCols = useCallback((count: number) => {
    if (count === 1) return "grid-cols-1";
    if (count === 2) return "grid-cols-1 md:grid-cols-2";
    if (count === 3) return "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";
    if (count === 4) return "grid-cols-1 md:grid-cols-2 lg:grid-cols-2";
    if (count <= 6) return "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";
    if (count <= 9) return "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";
    return "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
  }, []);

  const gridCols = useMemo(() => getGridCols(participantsList.length), [participantsList.length, getGridCols]);

  return (
    <div className="h-screen w-full bg-background/95 backdrop-blur-3xl overflow-hidden relative">
      {/* Background Gradients */}
      <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/10 blur-[100px] animate-pulse-glow" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-500/10 blur-[100px] animate-pulse-glow animation-delay-500" />
      </div>

      {/* Floating Header */}
      <div className="absolute top-4 left-4 right-4 z-50 flex justify-between pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-3 bg-black/40 backdrop-blur-xl border border-white/10 p-2 rounded-full shadow-lg">
          <div className="flex items-center gap-2 px-2">
            <Badge variant="outline" className="bg-white/5 border-white/10 text-white/80 font-mono">
              {roomId}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 hover:bg-white/10 rounded-full"
              onClick={copyRoomId}
            >
              {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            </Button>
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2 px-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm font-medium font-mono text-white/90">{formatDuration(callDuration)}</span>
          </div>
        </div>

        <div className="pointer-events-auto">
          <Badge variant="secondary" className="bg-black/40 backdrop-blur-xl border-white/10 text-white/80 gap-1.5 py-1.5 px-3 rounded-full shadow-lg">
            <Sparkles className="w-3 h-3 text-purple-400" />
            AI Enhanced
          </Badge>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="absolute inset-0 pt-20 pb-24 px-4 md:px-8 flex items-center justify-center">
        {participantsList.length === 0 ? (
          <div className="text-center space-y-4">
            <div className="relative inline-block">
              <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full animate-pulse" />
              <div className="relative bg-white/5 backdrop-blur-xl border border-white/10 p-8 rounded-full">
                <Users className="w-12 h-12 text-white/50" />
              </div>
            </div>
            <p className="text-xl font-medium text-white/70">Waiting for others to join...</p>
            <Button variant="outline" className="bg-white/5 border-white/10 hover:bg-white/10" onClick={copyRoomId}>
              Copy Invite Link
            </Button>
          </div>
        ) : (
          <div className={`w-full h-full grid ${gridCols} gap-4`} style={{ gridAutoRows: 'minmax(0, 1fr)' }}>
            <AnimatePresence>
              {participantsList.map((participant) => (
                <motion.div
                  key={participant.socketId}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="relative overflow-hidden rounded-3xl bg-black/40 border border-white/10 shadow-2xl group"
                >
                  {participant.isLocal ? (
                    <>
                      <video
                        ref={participant.socketId === "local" ? localVideoRef : null}
                        autoPlay
                        muted
                        playsInline
                        className="absolute inset-0 w-full h-full object-cover transform scale-x-[-1]"
                        style={{ display: isVideoOn ? 'block' : 'none' }}
                      />
                      {!isVideoOn && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/5 backdrop-blur-sm">
                          <Avatar className="h-24 w-24 border-4 border-white/10 shadow-xl">
                            <AvatarImage src={participant.avatar} alt={participant.name} />
                            <AvatarFallback className="text-3xl bg-primary/20 text-primary">
                              {getInitials(participant.name, user?.email)}
                            </AvatarFallback>
                          </Avatar>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <RemoteVideo
                        stream={participant.stream}
                        socketId={participant.socketId}
                      />
                      {!participant.isVideoOn && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/5 backdrop-blur-sm z-10">
                          <Avatar className="h-24 w-24 border-4 border-white/10 shadow-xl">
                            <AvatarImage src={participant.avatar} alt={participant.name} />
                            <AvatarFallback className="text-3xl bg-primary/20 text-primary">
                              {getInitials(participant.name, user?.email)}
                            </AvatarFallback>
                          </Avatar>
                        </div>
                      )}
                      {!participant.stream && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-20">
                          <div className="flex flex-col items-center gap-2">
                            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            <p className="text-xs text-white/50">Connecting...</p>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Participant Overlay */}
                  <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white shadow-sm">{participant.name}</span>
                        {participant.isLocal && <span className="text-xs text-white/50">(You)</span>}
                      </div>
                      <div className="flex gap-2">
                        {!participant.isAudioOn && (
                          <div className="p-1.5 rounded-full bg-red-500/20 text-red-400 backdrop-blur-md">
                            <MicOff className="w-3 h-3" />
                          </div>
                        )}
                        {!participant.isVideoOn && (
                          <div className="p-1.5 rounded-full bg-red-500/20 text-red-400 backdrop-blur-md">
                            <VideoOff className="w-3 h-3" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Speaking Indicator */}
                  {/* Note: In a real app, we'd detect audio levels. For now, we can simulate or just use active state */}
                  <div className="absolute inset-0 border-2 border-primary/0 transition-colors duration-300 pointer-events-none rounded-3xl" />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Sidebars */}
      <AnimatePresence>
        {showChat && (
          <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="absolute top-20 right-4 bottom-24 w-80 bg-black/60 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden z-40"
          >
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/5">
              <h3 className="font-semibold text-white">Chat</h3>
              <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-white/10 rounded-full" onClick={() => setShowChat(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <ScrollArea className="flex-1 p-4" ref={chatScrollRef}>
              <div className="space-y-4">
                {chatMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-center space-y-2">
                    <MessageSquare className="w-8 h-8 text-white/20" />
                    <p className="text-sm text-white/40">No messages yet</p>
                  </div>
                ) : (
                  chatMessages.map((msg) => (
                    <div key={msg.id} className={`flex gap-3 ${msg.isLocal ? 'flex-row-reverse' : ''}`}>
                      <Avatar className="h-8 w-8 shrink-0 border border-white/10">
                        <AvatarImage src={msg.avatar ? getAvatarUrl(msg.avatar) : undefined} />
                        <AvatarFallback className="text-xs bg-white/10 text-white/80">{getInitials(msg.sender)}</AvatarFallback>
                      </Avatar>
                      <div className={`flex flex-col gap-1 ${msg.isLocal ? 'items-end' : 'items-start'} max-w-[75%]`}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-white/60">{msg.isLocal ? 'You' : msg.sender}</span>
                          <span className="text-[10px] text-white/30">{msg.time}</span>
                        </div>
                        <div className={`rounded-2xl px-4 py-2 text-sm ${msg.isLocal
                            ? 'bg-primary text-primary-foreground rounded-tr-none'
                            : 'bg-white/10 text-white rounded-tl-none'
                          }`}>
                          {msg.message}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>

            <form onSubmit={sendMessage} className="p-3 bg-white/5 border-t border-white/10">
              <div className="relative">
                <Input
                  placeholder="Type a message..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="pr-10 bg-black/20 border-white/10 focus:border-primary/50 rounded-xl text-white placeholder:text-white/30"
                  disabled={!socket}
                />
                <Button
                  type="submit"
                  size="icon"
                  className="absolute right-1 top-1 h-8 w-8 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary"
                  disabled={!socket || !message.trim()}
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </form>
          </motion.div>
        )}

        {showParticipants && (
          <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="absolute top-20 right-4 bottom-24 w-80 bg-black/60 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden z-40"
          >
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/5">
              <h3 className="font-semibold text-white">Participants ({participantsList.length})</h3>
              <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-white/10 rounded-full" onClick={() => setShowParticipants(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <ScrollArea className="flex-1 p-2">
              <div className="space-y-1">
                {participantsList.map((participant) => (
                  <div key={participant.socketId} className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors">
                    <Avatar className="h-10 w-10 border border-white/10">
                      <AvatarImage src={participant.avatar} alt={participant.name} />
                      <AvatarFallback className="bg-white/10 text-white/80">
                        {getInitials(participant.name, user?.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-white truncate">{participant.name}</p>
                      <p className="text-xs text-white/40 truncate">{participant.isLocal ? "You" : "Participant"}</p>
                    </div>
                    <div className="flex gap-1">
                      {!participant.isAudioOn && <MicOff className="w-4 h-4 text-red-400" />}
                      {!participant.isVideoOn && <VideoOff className="w-4 h-4 text-red-400" />}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Control Dock */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-50">
        <div className="flex items-center gap-3 p-2 rounded-3xl bg-black/60 backdrop-blur-2xl border border-white/10 shadow-2xl">
          <div className="flex items-center gap-2 px-2 border-r border-white/10 pr-4">
            <Button
              variant={isMicOn ? "secondary" : "destructive"}
              size="icon"
              onClick={toggleMic}
              className={`h-12 w-12 rounded-2xl transition-all duration-300 ${isMicOn ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20'}`}
            >
              {isMicOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </Button>
            <Button
              variant={isVideoOn ? "secondary" : "destructive"}
              size="icon"
              onClick={toggleVideo}
              className={`h-12 w-12 rounded-2xl transition-all duration-300 ${isVideoOn ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20'}`}
            >
              {isVideoOn ? <VideoIcon className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </Button>
          </div>

          <div className="flex items-center gap-2 px-2">
            <Button
              variant={isScreenSharing ? "default" : "ghost"}
              size="icon"
              onClick={toggleScreenShare}
              className={`h-12 w-12 rounded-2xl hover:bg-white/10 ${isScreenSharing ? 'bg-primary text-primary-foreground' : 'text-white/80'}`}
            >
              <MonitorUp className="h-5 w-5" />
            </Button>
            <Button
              variant={showChat ? "default" : "ghost"}
              size="icon"
              onClick={() => { setShowChat(!showChat); setShowParticipants(false); }}
              className={`h-12 w-12 rounded-2xl hover:bg-white/10 ${showChat ? 'bg-primary text-primary-foreground' : 'text-white/80'}`}
            >
              <MessageSquare className="h-5 w-5" />
            </Button>
            <Button
              variant={showParticipants ? "default" : "ghost"}
              size="icon"
              onClick={() => { setShowParticipants(!showParticipants); setShowChat(false); }}
              className={`h-12 w-12 rounded-2xl hover:bg-white/10 ${showParticipants ? 'bg-primary text-primary-foreground' : 'text-white/80'}`}
            >
              <Users className="h-5 w-5" />
            </Button>

            <div className="relative group">
              <Button variant="ghost" size="icon" className="h-12 w-12 rounded-2xl hover:bg-white/10 text-white/80">
                <Smile className="h-5 w-5" />
              </Button>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 hidden group-hover:flex items-center gap-1 p-2 bg-black/80 backdrop-blur-xl border border-white/10 rounded-full shadow-xl">
                {reactions.map((reaction, i) => (
                  <button
                    key={i}
                    onClick={() => console.log("Reaction:", reaction)}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors text-xl hover:scale-125 transform duration-200"
                  >
                    {reaction}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="pl-4 border-l border-white/10">
            <Button
              variant="destructive"
              onClick={endCall}
              className="h-12 px-6 rounded-2xl bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20 font-medium"
            >
              <PhoneOff className="h-5 w-5 mr-2" />
              End
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Component for remote video streams - memoized for performance
const RemoteVideo = memo(function RemoteVideo({ stream, socketId }: { stream?: MediaStream; socketId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    let cleanup: (() => void) | null = null;

    const playVideo = () => {
      if (playPromiseRef.current) {
        playPromiseRef.current.catch(() => { });
        playPromiseRef.current = null;
      }

      const attemptPlay = async () => {
        try {
          if (!stream || stream.getTracks().length === 0) {
            return;
          }

          if (videoElement.readyState === 0 && videoElement.srcObject) {
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => {
                videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
                resolve();
              }, 2000);

              const onLoadedMetadata = () => {
                clearTimeout(timeout);
                videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
                resolve();
              };

              const onLoadedData = () => {
                clearTimeout(timeout);
                videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
                videoElement.removeEventListener('loadeddata', onLoadedData);
                resolve();
              };

              videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
              videoElement.addEventListener('loadeddata', onLoadedData);
              cleanup = () => {
                clearTimeout(timeout);
                videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
                videoElement.removeEventListener('loadeddata', onLoadedData);
              };
            });
          }

          if (videoElement.srcObject === stream && !videoElement.paused) {
            return;
          }

          if (videoElement.srcObject === stream) {
            playPromiseRef.current = videoElement.play();
            await playPromiseRef.current;
            playPromiseRef.current = null;
          }
        } catch (error: any) {
          if (error.name === 'AbortError') {
            playPromiseRef.current = null;
            setTimeout(() => {
              if (videoElement.srcObject === stream && videoElement.paused) {
                videoElement.play().catch((retryError: any) => {
                  if (retryError.name !== 'AbortError' && retryError.name !== 'NotAllowedError') {
                    console.warn("Error retrying play:", retryError);
                  }
                });
              }
            }, 200);
          } else if (error.name !== 'NotAllowedError') {
            playPromiseRef.current = null;
          } else {
            playPromiseRef.current = null;
          }
        }
      };

      attemptPlay();
    };

    if (stream && stream.getTracks().length > 0) {
      if (playPromiseRef.current) {
        playPromiseRef.current.catch(() => { });
        playPromiseRef.current = null;
      }

      if (videoElement.srcObject !== stream) {
        videoElement.srcObject = stream;
      }

      videoElement.style.display = 'block';
      playVideo();
    } else {
      videoElement.srcObject = null;
      videoElement.style.display = 'none';
      if (playPromiseRef.current) {
        playPromiseRef.current.catch(() => { });
        playPromiseRef.current = null;
      }
    }

    return () => {
      if (cleanup) {
        cleanup();
      }
      if (playPromiseRef.current) {
        playPromiseRef.current.catch(() => { });
        playPromiseRef.current = null;
      }
    };
  }, [stream, socketId]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={false}
      className="absolute inset-0 w-full h-full object-cover"
      style={{
        display: stream ? 'block' : 'none',
        zIndex: 0,
        pointerEvents: 'none'
      }}
      onLoadedMetadata={() => {
        if (videoRef.current && videoRef.current.paused) {
          videoRef.current.play().catch((error: any) => {
            if (error.name !== 'AbortError' && error.name !== 'NotAllowedError') {
              console.warn("Error playing remote video on loadedmetadata:", error);
            }
          });
        }
      }}
      onCanPlay={() => {
        if (videoRef.current && videoRef.current.paused && videoRef.current.srcObject) {
          setTimeout(() => {
            if (videoRef.current && videoRef.current.paused && videoRef.current.srcObject) {
              videoRef.current.play().catch((error: any) => {
                if (error.name !== 'AbortError' && error.name !== 'NotAllowedError') {
                  console.warn("Error playing remote video on canplay:", error);
                }
              });
            }
          }, 50);
        }
      }}
    />
  );
}, (prevProps, nextProps) => {
  return prevProps.stream?.id === nextProps.stream?.id &&
    prevProps.socketId === nextProps.socketId;
});

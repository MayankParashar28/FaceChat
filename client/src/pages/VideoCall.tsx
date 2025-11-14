import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Mic, MicOff, Video as VideoIcon, VideoOff, MonitorUp, PhoneOff, MessageSquare, Users, Sparkles, Copy, Check } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { io, Socket } from "socket.io-client";
import { useAuth } from "@/lib/auth";
import { auth } from "@/lib/firebase";
import { getAvatarUrl, getInitials } from "@/lib/utils";

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
      transports: ['websocket', 'polling']
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

    newSocket.on("disconnect", () => {
      console.log("Socket disconnected");
    });

    newSocket.on("connect_error", (error) => {
      console.error("Socket connection error:", error);
    });

    // Handle existing users in the room
    newSocket.on("call:existing-users", async ({ participants: participantData }: { 
      participants: Array<{ socketId: string; userId: string; userName?: string; userAvatar?: string }> 
    }) => {
      console.log("Existing users in room:", participantData);
      
      // Add all existing participants
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
      
      // Wait for local media to be ready before creating peer connections
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
            // Timeout after 5 seconds
            setTimeout(() => {
              clearInterval(checkInterval);
              resolve();
            }, 5000);
          }
        });
      };
      
      await waitForLocalMedia();
      
      // Create peer connections for all existing users (we are the initiator)
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
      
      // Add participant first
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
      
      // Wait for local media to be ready before creating peer connection
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
            // Timeout after 5 seconds
            setTimeout(() => {
              clearInterval(checkInterval);
              resolve();
            }, 5000);
          }
        });
      };
      
      await waitForLocalMedia();
      
      // Create peer connection (we are the initiator for new joiners)
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
      
      // Create peer connection if it doesn't exist
      if (!pc) {
        console.log("Creating peer connection for incoming offer from", socketId);
        // Wait for local media to be ready before creating peer connection
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
          console.log("Setting remote description (offer) for", socketId);
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          console.log("Remote description set, creating answer for", socketId);
          // Process any queued ICE candidates
          await processQueuedIceCandidates(socketId, pc);
          
          const answer = await pc.createAnswer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
          });
          await pc.setLocalDescription(answer);
          console.log("Answer created and sent to", socketId);
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
          console.log("Setting remote description (answer) for", socketId);
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          console.log("Remote description set successfully for", socketId);
          // Process any queued ICE candidates
          await processQueuedIceCandidates(socketId, pc);
        } catch (error) {
          console.error("Error handling answer:", error);
        }
      } else {
        console.warn("No peer connection found for answer from", socketId);
      }
    });

    newSocket.on("call:ice-candidate", async ({ candidate, socketId }: { candidate: RTCIceCandidateInit; socketId: string }) => {
      console.log("Received ICE candidate from:", socketId);
      const pc = peerConnectionsRef.current.get(socketId);
      if (pc && candidate) {
        try {
          // Check if remote description is set
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } else {
            // Queue the candidate if remote description isn't set yet
            console.log("Queueing ICE candidate for", socketId, "until remote description is set");
            const queue = iceCandidateQueueRef.current.get(socketId) || [];
            queue.push(candidate);
            iceCandidateQueueRef.current.set(socketId, queue);
          }
        } catch (error) {
          console.error("Error adding ICE candidate:", error);
          // If it fails, queue it anyway as a fallback
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

    // Handle incoming chat messages
    newSocket.on("call:chat-message", (messageData: ChatMessage) => {
      console.log("=== RECEIVED CHAT MESSAGE FROM SERVER ===");
      console.log("Message data:", messageData);
      console.log("Current socket ID:", newSocket.id);
      console.log("Message socket ID:", messageData.socketId);
      
      const isLocal = messageData.socketId === newSocket.id;
      console.log("Is local message:", isLocal);
      
      setChatMessages(prev => {
        console.log("Current messages count:", prev.length);
        console.log("Previous messages:", prev);
        
        // Check if message already exists to prevent duplicates
        const exists = prev.some(msg => msg.id === messageData.id);
        if (exists) {
          console.log("Duplicate message detected, skipping");
          return prev;
        }
        
        console.log("Adding new message to chat");
        const newMessages = [...prev, {
          ...messageData,
          isLocal,
          time: new Date(messageData.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }];
        console.log("New messages count:", newMessages.length);
        console.log("New messages:", newMessages);
        return newMessages;
      });
      
      // Auto-scroll to bottom when new message arrives
      setTimeout(() => {
        if (chatScrollRef.current) {
          const viewport = chatScrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
          if (viewport) {
            viewport.scrollTop = viewport.scrollHeight;
          }
        }
      }, 100);
    });
    
    // Add error handler for socket events
    newSocket.on("error", (error) => {
      console.error("Socket error:", error);
    });

    setSocket(newSocket);
    socketRef.current = newSocket;

    // Initialize local media first, then handle existing users
    initializeLocalMedia().then(() => {
      console.log("Local media initialized, ready for peer connections");
    });

    // Cleanup on unmount
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
      // Optimize video constraints for better performance
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
      
      // Set video source immediately
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(console.error);
      }

      // Add local participant
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
      // Still add local participant even if media fails
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
    // Don't create duplicate peer connections
    if (peerConnectionsRef.current.has(socketId)) {
      const existingPc = peerConnectionsRef.current.get(socketId);
      console.log("Peer connection already exists for", socketId, "- reusing existing connection");
      
      // If connection is closed or failed, remove it and create a new one
      if (existingPc && (existingPc.connectionState === 'closed' || existingPc.connectionState === 'failed')) {
        console.log("Existing connection is closed/failed, removing and creating new one");
        existingPc.close();
        peerConnectionsRef.current.delete(socketId);
      } else {
        // Connection exists and is valid, just return
        return;
      }
    }
    
    // Optimize WebRTC configuration for performance
    const configuration: RTCConfiguration = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ],
      // Optimize for performance
      iceCandidatePoolSize: 10,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require"
    };

    console.log("Creating peer connection for", socketId, "isInitiator:", isInitiator, "localStream:", !!localStreamRef.current);
    const pc = new RTCPeerConnection(configuration);
    peerConnectionsRef.current.set(socketId, pc);

    // Add connection state change handlers for debugging
    pc.onconnectionstatechange = () => {
      console.log(`Peer connection state changed for ${socketId}:`, pc.connectionState);
      if (pc.connectionState === "failed") {
        console.error(`Connection failed for ${socketId}, attempting to restart...`);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`ICE connection state changed for ${socketId}:`, pc.iceConnectionState);
    };

    // Add local stream tracks with optimized settings
    if (localStreamRef.current) {
      const tracks = localStreamRef.current.getTracks();
      console.log(`Adding ${tracks.length} tracks to peer connection for ${socketId}`);
      tracks.forEach(track => {
        console.log(`Adding ${track.kind} track (enabled: ${track.enabled}) to ${socketId}`);
        pc.addTrack(track, localStreamRef.current!);
      });
      
      // Optimize video track settings after tracks are added
      setTimeout(() => {
        if (localStreamRef.current) {
          const videoTracks = localStreamRef.current.getVideoTracks();
          videoTracks.forEach(videoTrack => {
            const sender = pc.getSenders().find(s => s.track === videoTrack);
            if (sender && 'setParameters' in sender) {
              try {
                const params = (sender as RTCRtpSender).getParameters();
                if (params.encodings && params.encodings[0]) {
                  params.encodings[0].maxBitrate = 2500000; // 2.5 Mbps max
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
    } else {
      console.warn("Local stream not available when creating peer connection for", socketId);
    }

    // Handle remote stream
    pc.ontrack = (event) => {
      console.log("Received remote stream from:", socketId, event);
      console.log("Event streams:", event.streams.length, "Event tracks:", event.track);
      
      // Get the stream from the event
      let remoteStream: MediaStream | null = null;
      
      if (event.streams && event.streams.length > 0) {
        remoteStream = event.streams[0];
      } else if (event.track) {
        // If no stream, create one from the track
        remoteStream = new MediaStream([event.track]);
      }
      
      if (!remoteStream) {
        console.warn("No remote stream in event.streams or event.track");
        return;
      }
      
      console.log("Remote stream tracks:", remoteStream.getTracks().map(t => ({ 
        kind: t.kind, 
        enabled: t.enabled, 
        readyState: t.readyState,
        id: t.id
      })));
      
      // Update participant with stream
      const updateParticipantWithStream = (stream: MediaStream) => {
        setParticipants(prev => {
          const newMap = new Map(prev);
          const participant = newMap.get(socketId);
          const videoTrack = stream.getVideoTracks()[0];
          const audioTrack = stream.getAudioTracks()[0];
          
          // Create a new participant object to ensure React detects the change
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
          console.log("✅ Updated participant with stream:", socketId, { 
            videoOn: updatedParticipant.isVideoOn, 
            audioOn: updatedParticipant.isAudioOn,
            hasStream: !!updatedParticipant.stream,
            streamId: updatedParticipant.stream?.id,
            trackCount: updatedParticipant.stream?.getTracks().length
          });
          return newMap;
        });
      };
      
      updateParticipantWithStream(remoteStream);
      
      // Listen for track state changes
      remoteStream.getVideoTracks().forEach(track => {
        track.onended = () => {
          console.log("Video track ended for", socketId);
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
          console.log("Video track muted for", socketId);
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
          console.log("Video track unmuted for", socketId);
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
          console.log("Audio track ended for", socketId);
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
          console.log("Audio track muted for", socketId);
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
          console.log("Audio track unmuted for", socketId);
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

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        // RTCIceCandidate has toJSON() method, but we'll use it safely
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

    // Create and send offer if initiator
    if (isInitiator) {
      try {
        if (!localStreamRef.current) {
          console.warn("Cannot create offer: local stream not available");
          return;
        }
        console.log("Creating offer for", socketId);
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        await pc.setLocalDescription(offer);
        console.log("Offer created and local description set for", socketId);
        socketRef.current?.emit("call:offer", {
          roomId,
          offer: {
            type: offer.type,
            sdp: offer.sdp
          },
          targetSocketId: socketId
        });
        // Note: We can't process queued ICE candidates here because we don't have remote description yet
        // They will be processed when we receive the answer
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
    // Clean up queued ICE candidates
    iceCandidateQueueRef.current.delete(socketId);
  };

  const cleanup = () => {
    // Stop all media streams
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }

    // Close all peer connections
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
      // Stop screen sharing
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
        screenStreamRef.current = null;
      }
      
      // Switch back to camera
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
      // Start screen sharing
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screenStream;

        // Replace video track in all peer connections
        const videoTrack = screenStream.getVideoTracks()[0];
        peerConnectionsRef.current.forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === "video");
          if (sender && videoTrack) {
            sender.replaceTrack(videoTrack);
          }
        });

        // Stop screen share when user stops sharing
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
    
    if (!messageText) {
      console.log("Message is empty");
      return;
    }
    
    if (!socket) {
      console.error("Socket is not connected");
      return;
    }
    
    if (!socket.connected) {
      console.error("Socket is not connected yet");
      return;
    }
    
    if (!user?.uid) {
      console.error("User UID is missing");
      return;
    }
    
    if (!roomId) {
      console.error("Room ID is missing");
      return;
    }
    
    try {
      console.log("Sending message:", { roomId, message: messageText, userId: user.uid });
      console.log("Socket ID:", socket.id);
      console.log("Socket connected:", socket.connected);
      
      // Emit message to server, which will broadcast to all participants
      socket.emit("call:chat-message", {
        roomId,
        message: messageText,
        userId: user.uid
      }, (response: any) => {
        console.log("Emit callback response:", response);
      });
      
      console.log("Message emitted, waiting for server response...");
      setMessage("");
      
      // Auto-scroll to bottom after sending
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
  
  // Get current socket ID to filter out self from remote participants
  const currentSocketId = socketRef.current?.id;
  
  // Memoize participants list to avoid unnecessary re-renders
  const participantsList = useMemo(() => {
    return Array.from(participants.values()).filter(p => {
      // Always show local participant
      if (p.isLocal) return true;
      // Don't show remote participants that match our socket ID (shouldn't happen, but safety check)
      if (currentSocketId && p.socketId === currentSocketId) return false;
      return true;
    });
  }, [participants, currentSocketId]);

  // Memoize grid layout calculation
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
    <div className="h-screen bg-background flex flex-col">
      <header className="p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">AI Meet Call</h1>
          <div className="flex items-center gap-2">
            <code className="px-2 py-1 rounded bg-muted text-sm font-mono">{roomId}</code>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8"
              onClick={copyRoomId}
              data-testid="button-copy-room-id"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Sparkles className="w-3 h-3" />
            AI Active
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{formatDuration(callDuration)}</span>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 p-4 md:p-6 overflow-auto">
          {participantsList.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <p className="text-muted-foreground">Waiting for participants to join...</p>
              </div>
            </div>
          ) : (
          <div className={`h-full grid ${gridCols} gap-3 md:gap-4`} style={{ gridAutoRows: 'minmax(0, 1fr)' }}>
              {participantsList.map((participant) => (
              <Card 
                key={participant.socketId} 
                className="relative overflow-hidden bg-muted flex items-center justify-center min-h-0"
                data-testid={`video-${participant.socketId}`}
                style={{ aspectRatio: '16/9' }}
              >
                {participant.isLocal ? (
                  <>
                    <video
                      ref={participant.socketId === "local" ? localVideoRef : null}
                      autoPlay
                      muted
                      playsInline
                      className="absolute inset-0 w-full h-full object-cover"
                      style={{ display: isVideoOn ? 'block' : 'none' }}
                    />
                    {!isVideoOn && (
                      <>
                <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-chart-2/20" />
                <Avatar className="h-20 w-20 relative z-10">
                          <AvatarImage src={participant.avatar} alt={participant.name} />
                          <AvatarFallback className="text-2xl">
                            {getInitials(participant.name, user?.email)}
                          </AvatarFallback>
                        </Avatar>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <RemoteVideo 
                      stream={participant.stream}
                      socketId={participant.socketId}
                    />
                    {!participant.isVideoOn && (
                      <>
                        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-chart-2/20 z-10" />
                        <Avatar className="h-20 w-20 relative z-20">
                          <AvatarImage src={participant.avatar} alt={participant.name} />
                          <AvatarFallback className="text-2xl">
                            {getInitials(participant.name, user?.email)}
                          </AvatarFallback>
                </Avatar>
                      </>
                    )}
                    {!participant.stream && (
                      <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 10, pointerEvents: 'none' }}>
                        <div className="text-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                          <p className="text-sm text-muted-foreground">Connecting...</p>
                        </div>
                      </div>
                    )}
                  </>
                )}
                
                <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between gap-2 z-20">
                  <div className="flex items-center gap-2 bg-background/90 backdrop-blur-md rounded-lg px-2.5 py-1.5 border border-border/50">
                    <span className="text-xs md:text-sm font-medium truncate max-w-[120px] md:max-w-none">{participant.name}</span>
                    {!participant.isLocal && (
                      <Badge variant="outline" className="text-xs border-chart-2 text-chart-2 shrink-0">
                        <Sparkles className="w-3 h-3 mr-1" />
                        AI
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!participant.isAudioOn && (
                      <Badge variant="secondary" className="text-xs shrink-0">
                        <MicOff className="w-3 h-3 mr-1" />
                        Muted
                      </Badge>
                    )}
                    {(participant.isLocal && !isVideoOn) || (!participant.isLocal && !participant.isVideoOn) ? (
                      <Badge variant="secondary" className="text-xs shrink-0">
                        <VideoOff className="w-3 h-3 mr-1" />
                        Camera Off
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
          )}
        </div>

        {showChat && (
          <div className="w-80 border-l flex flex-col bg-background">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold">Chat</h3>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8"
                onClick={() => setShowChat(false)}
                data-testid="button-close-chat"
              >
                ✕
              </Button>
            </div>
            <ScrollArea className="flex-1 p-4" ref={chatScrollRef}>
              <div className="space-y-4">
                {(() => {
                  console.log("Rendering chat messages, count:", chatMessages.length);
                  console.log("Chat messages:", chatMessages);
                  return null;
                })()}
                {chatMessages.length === 0 ? (
                  <div className="text-center text-muted-foreground text-sm py-8">
                    No messages yet. Start the conversation!
                  </div>
                ) : (
                  chatMessages.map((msg) => (
                    <div 
                      key={msg.id} 
                      className={`flex gap-3 ${msg.isLocal ? 'flex-row-reverse' : ''}`}
                      data-testid={`chat-message-${msg.id}`}
                    >
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarImage src={msg.avatar ? getAvatarUrl(msg.avatar) : undefined} />
                        <AvatarFallback className="text-xs">
                          {getInitials(msg.sender)}
                        </AvatarFallback>
                      </Avatar>
                      <div className={`flex flex-col gap-1 ${msg.isLocal ? 'items-end' : 'items-start'} flex-1 min-w-0`}>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{msg.isLocal ? 'You' : msg.sender}</span>
                          <span className="text-xs text-muted-foreground">{msg.time}</span>
                        </div>
                        <div className={`rounded-lg p-3 text-sm max-w-[85%] break-words ${
                          msg.isLocal 
                            ? 'bg-primary text-primary-foreground' 
                            : 'bg-muted'
                        }`}>
                          {msg.message}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
            <form onSubmit={sendMessage} className="p-4 border-t">
              <div className="flex gap-2">
                <Input 
                  placeholder="Type a message..." 
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  data-testid="input-chat-message"
                  disabled={!socket}
                />
                <Button 
                  type="submit" 
                  data-testid="button-send-message"
                  disabled={!socket || !message.trim()}
                >
                  Send
                </Button>
              </div>
            </form>
          </div>
        )}

        {showParticipants && (
          <div className="w-80 border-l flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold">Participants ({participantsList.length})</h3>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8"
                onClick={() => setShowParticipants(false)}
                data-testid="button-close-participants"
              >
                ✕
              </Button>
            </div>
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-2">
                {participantsList.map((participant) => (
                  <div 
                    key={participant.socketId} 
                    className="flex items-center gap-3 p-3 rounded-lg hover-elevate"
                    data-testid={`participant-${participant.socketId}`}
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={participant.avatar} alt={participant.name} />
                      <AvatarFallback>
                        {getInitials(participant.name, user?.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{participant.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {!participant.isAudioOn && (
                          <Badge variant="outline" className="text-xs">
                            <MicOff className="w-3 h-3" />
                          </Badge>
                        )}
                        {!participant.isVideoOn && (
                          <Badge variant="outline" className="text-xs">
                            <VideoOff className="w-3 h-3" />
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>

      <div className="p-6 border-t bg-card/50 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {reactions.map((reaction, i) => (
                <Button 
                  key={i} 
                  variant="ghost" 
                  size="icon"
                  onClick={() => console.log("Reaction:", reaction)}
                  data-testid={`button-reaction-${i}`}
                >
                  {reaction}
                </Button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button 
                variant={isMicOn ? "secondary" : "destructive"} 
                size="icon"
                onClick={toggleMic}
                data-testid="button-toggle-mic"
              >
                {isMicOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
              </Button>
              <Button 
                variant={isVideoOn ? "secondary" : "destructive"} 
                size="icon"
                onClick={toggleVideo}
                data-testid="button-toggle-video"
              >
                {isVideoOn ? <VideoIcon className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
              </Button>
              <Button 
                variant={isScreenSharing ? "default" : "secondary"} 
                size="icon"
                onClick={toggleScreenShare}
                data-testid="button-screen-share"
              >
                <MonitorUp className="h-5 w-5" />
              </Button>
              <Button 
                variant="secondary" 
                size="icon"
                onClick={() => setShowChat(!showChat)}
                data-testid="button-toggle-chat"
              >
                <MessageSquare className="h-5 w-5" />
              </Button>
              <Button 
                variant="secondary" 
                size="icon"
                onClick={() => setShowParticipants(!showParticipants)}
                data-testid="button-toggle-participants"
              >
                <Users className="h-5 w-5" />
              </Button>
              <Button 
                variant="secondary" 
                size="icon"
                onClick={() => console.log("AI features")}
                data-testid="button-ai-features"
              >
                <Sparkles className="h-5 w-5" />
              </Button>
            </div>

            <Button 
              variant="destructive" 
              onClick={endCall}
              data-testid="button-end-call"
            >
              <PhoneOff className="h-5 w-5 mr-2" />
              End Call
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
      // Cancel any pending play promise
      if (playPromiseRef.current) {
        playPromiseRef.current.catch(() => {});
        playPromiseRef.current = null;
      }

      const attemptPlay = async () => {
        try {
          // Check if stream has tracks
          if (!stream || stream.getTracks().length === 0) {
            console.warn("Stream has no tracks for", socketId);
            return;
          }

          // For MediaStream, we don't need to wait for metadata - it's a live stream
          // Just check if the video element is ready
          if (videoElement.readyState === 0 && videoElement.srcObject) {
            // Wait for metadata only if we have a srcObject but no readyState
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => {
                videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
                // Don't reject, just resolve - live streams might not fire loadedmetadata
                console.log("Metadata timeout for", socketId, "- attempting to play anyway");
                resolve();
              }, 2000); // Reduced timeout for live streams
              
              const onLoadedMetadata = () => {
                clearTimeout(timeout);
                videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
                resolve();
              };
              
              // Also listen for loadeddata which fires earlier
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
            // Already playing, no need to play again
            console.log("Video already playing for", socketId);
            return;
          }

          if (videoElement.srcObject === stream) {
            // For live streams, we can try to play immediately
            playPromiseRef.current = videoElement.play();
            await playPromiseRef.current;
            console.log("Remote video playing successfully for", socketId);
            playPromiseRef.current = null;
          }
        } catch (error: any) {
          // AbortError is expected when stream changes, retry after a short delay
          if (error.name === 'AbortError') {
            console.log("Play interrupted for", socketId, "- retrying...");
            playPromiseRef.current = null;
            // Retry after a short delay
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
            console.warn("Error playing remote video:", error);
            playPromiseRef.current = null;
          } else {
            playPromiseRef.current = null;
          }
        }
      };

      attemptPlay();
    };

    if (stream && stream.getTracks().length > 0) {
      console.log("Setting remote video stream for", socketId, stream, "tracks:", stream.getTracks().length, "active:", stream.active);
      
      // Cancel any pending play promise before setting new stream
      if (playPromiseRef.current) {
        playPromiseRef.current.catch(() => {});
        playPromiseRef.current = null;
      }
      
      // Only set srcObject if it's different to avoid unnecessary reloads
      if (videoElement.srcObject !== stream) {
        videoElement.srcObject = stream;
      }
      
      // Make sure video is visible
      videoElement.style.display = 'block';
      
      // For live MediaStreams, we can try to play immediately
      // The video element should handle the stream automatically
      playVideo();
    } else {
      console.log("No stream or stream has no tracks for", socketId);
      videoElement.srcObject = null;
      videoElement.style.display = 'none';
      // Cancel any pending play promise
      if (playPromiseRef.current) {
        playPromiseRef.current.catch(() => {});
        playPromiseRef.current = null;
      }
    }

    return () => {
      if (cleanup) {
        cleanup();
      }
      // Cancel any pending play promise on cleanup
      if (playPromiseRef.current) {
        playPromiseRef.current.catch(() => {});
        playPromiseRef.current = null;
      }
    };
  }, [stream, socketId]);

  // Always render video element, even if stream is not available yet
  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={false}
      className="absolute inset-0 w-full h-full object-cover"
      data-testid={`remote-video-${socketId}`}
      style={{ 
        display: stream ? 'block' : 'none',
        zIndex: 0,
        pointerEvents: 'none'
      }}
      onLoadedMetadata={() => {
        console.log("Remote video metadata loaded for", socketId);
        // Ensure video plays when metadata is loaded
        if (videoRef.current && videoRef.current.paused) {
          videoRef.current.play().catch((error: any) => {
            // Ignore AbortError and NotAllowedError
            if (error.name !== 'AbortError' && error.name !== 'NotAllowedError') {
              console.warn("Error playing remote video on loadedmetadata:", error);
            }
          });
        }
      }}
      onCanPlay={() => {
        console.log("Remote video can play for", socketId);
        if (videoRef.current && videoRef.current.paused && videoRef.current.srcObject) {
          // Use a small delay to avoid conflicts with other play attempts
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
      onPlay={() => {
        console.log("Remote video started playing for", socketId);
      }}
      onPlaying={() => {
        console.log("Remote video is playing for", socketId);
      }}
    />
  );
}, (prevProps, nextProps) => {
  // Custom comparison: only re-render if stream actually changed
  return prevProps.stream?.id === nextProps.stream?.id && 
         prevProps.socketId === nextProps.socketId;
});


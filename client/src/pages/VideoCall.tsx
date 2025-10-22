import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Mic, MicOff, Video as VideoIcon, VideoOff, MonitorUp, PhoneOff, MessageSquare, Users, Smile, Sparkles, Copy, Check } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default function VideoCall() {
  const [, params] = useRoute("/call/:roomId");
  const [, setLocation] = useLocation();
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const roomId = params?.roomId || "demo";

  const participants = [
    { id: "1", name: "You", emotion: "Focused", isLocal: true },
    { id: "2", name: "Sarah Johnson", emotion: "Happy", isLocal: false },
    { id: "3", name: "Mike Chen", emotion: "Engaged", isLocal: false }
  ];

  const chatMessages = [
    { id: "1", sender: "Sarah Johnson", message: "Great presentation!", time: "10:23 AM" },
    { id: "2", sender: "Mike Chen", message: "Can you share those slides?", time: "10:24 AM" }
  ];

  const endCall = () => {
    console.log("Ending call...");
    setLocation("/summary/new");
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      console.log("Sending message:", message);
      setMessage("");
    }
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const reactions = ["👍", "👏", "❤️", "😂", "🎉", "🤔"];

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
          <span className="text-sm text-muted-foreground">00:12:34</span>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 p-6 overflow-auto">
          <div className="h-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
            {participants.map((participant) => (
              <Card 
                key={participant.id} 
                className="relative overflow-hidden bg-muted flex items-center justify-center aspect-video"
                data-testid={`video-${participant.id}`}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-chart-2/20" />
                <Avatar className="h-20 w-20 relative z-10">
                  <AvatarFallback className="text-2xl">{participant.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                </Avatar>
                
                <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
                  <div className="flex items-center gap-2 bg-background/80 backdrop-blur-sm rounded-lg px-3 py-1">
                    <span className="text-sm font-medium">{participant.name}</span>
                    {!participant.isLocal && (
                      <Badge variant="outline" className="text-xs border-chart-2 text-chart-2">
                        <Sparkles className="w-3 h-3 mr-1" />
                        {participant.emotion}
                      </Badge>
                    )}
                  </div>
                  {participant.isLocal && !isVideoOn && (
                    <Badge variant="secondary" className="text-xs">Camera Off</Badge>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>

        {showChat && (
          <div className="w-80 border-l flex flex-col">
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
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {chatMessages.map((msg) => (
                  <div key={msg.id} className="space-y-1" data-testid={`chat-message-${msg.id}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{msg.sender}</span>
                      <span className="text-xs text-muted-foreground">{msg.time}</span>
                    </div>
                    <div className="bg-muted rounded-lg p-3 text-sm">{msg.message}</div>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <form onSubmit={sendMessage} className="p-4 border-t">
              <div className="flex gap-2">
                <Input 
                  placeholder="Type a message..." 
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  data-testid="input-chat-message"
                />
                <Button type="submit" data-testid="button-send-message">Send</Button>
              </div>
            </form>
          </div>
        )}

        {showParticipants && (
          <div className="w-80 border-l flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold">Participants ({participants.length})</h3>
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
                {participants.map((participant) => (
                  <div 
                    key={participant.id} 
                    className="flex items-center gap-3 p-3 rounded-lg hover-elevate"
                    data-testid={`participant-${participant.id}`}
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarFallback>{participant.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{participant.name}</p>
                      {!participant.isLocal && (
                        <p className="text-xs text-muted-foreground">{participant.emotion}</p>
                      )}
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
                onClick={() => setIsMicOn(!isMicOn)}
                data-testid="button-toggle-mic"
              >
                {isMicOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
              </Button>
              <Button 
                variant={isVideoOn ? "secondary" : "destructive"} 
                size="icon"
                onClick={() => setIsVideoOn(!isVideoOn)}
                data-testid="button-toggle-video"
              >
                {isVideoOn ? <VideoIcon className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
              </Button>
              <Button 
                variant="secondary" 
                size="icon"
                onClick={() => console.log("Screen share")}
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

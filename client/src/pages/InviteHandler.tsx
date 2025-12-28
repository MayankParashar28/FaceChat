import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getAvatarUrl, getInitials } from "@/lib/utils";
import { auth } from "@/lib/firebase";

export default function InviteHandler() {
    const [, params] = useRoute("/invite/:code");
    const [, setLocation] = useLocation();
    const { user, loading: isAuthLoading } = useAuth();
    const { toast } = useToast();
    const code = params?.code;

    const { data: invite, isLoading: isInviteLoading, error: inviteError } = useQuery({
        queryKey: ["invite", code],
        queryFn: async () => {
            const res = await fetch(`/api/invites/${code}`);
            if (!res.ok) throw new Error("Invite not found or expired");
            return res.json();
        },
        enabled: !!code,
        retry: false
    });

    const acceptMutation = useMutation({
        mutationFn: async () => {
            const token = await auth.currentUser?.getIdToken();
            if (!token) throw new Error("Not authenticated");

            const res = await fetch(`/api/invites/${code}/accept`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || "Failed to accept invite");
            }
            return res.json();
        },
        onSuccess: (data) => {
            toast({ title: "Connected!", description: "You are now connected." });
            // Redirect to chat with the new connection or dashboard
            setLocation("/chats");
        },
        onError: (error: Error) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    if (isAuthLoading || isInviteLoading) {
        return (
            <div className="flex h-screen items-center justify-center bg-background">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (inviteError || !invite) {
        return (
            <div className="flex h-screen items-center justify-center bg-background p-4">
                <Card className="max-w-md w-full border-destructive/50 bg-destructive/5">
                    <CardHeader className="text-center">
                        <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
                        <CardTitle className="text-destructive">Invalid Invite</CardTitle>
                        <CardDescription>
                            This invite link is invalid, expired, or has already been used maximum times.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex justify-center">
                        <Button onClick={() => setLocation("/")}>Go Home</Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (!user) {
        // If user is not logged in, redirect to login with return url
        // For simplicity, we can show a login prompt or specific message
        return (
            <div className="flex h-screen items-center justify-center bg-background p-4">
                <Card className="max-w-md w-full">
                    <CardHeader className="text-center">
                        <Avatar className="w-20 h-20 mx-auto mb-4">
                            <AvatarImage src={getAvatarUrl(invite.creator.avatar)} />
                            <AvatarFallback>{getInitials(invite.creator.name)}</AvatarFallback>
                        </Avatar>
                        <CardTitle>Join {invite.creator.name} on FaceCallAI</CardTitle>
                        <CardDescription>
                            You need to sign in to accept this invitation.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Button className="w-full" onClick={() => setLocation(`/login?redirect=/invite/${code}`)}>
                            Sign In to Accept
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="flex h-screen items-center justify-center bg-background p-4 relative overflow-hidden">
            {/* Background blobs */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[100px]" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[100px]" />

            <Card className="max-w-md w-full border-border/50 backdrop-blur-xl bg-background/50 shadow-2xl relative z-10">
                <CardHeader className="text-center pb-2">
                    <Avatar className="w-24 h-24 mx-auto mb-6 ring-4 ring-background shadow-xl">
                        <AvatarImage src={getAvatarUrl(invite.creator.avatar)} />
                        <AvatarFallback>{getInitials(invite.creator.name)}</AvatarFallback>
                    </Avatar>
                    <CardTitle className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-500 to-blue-500">
                        {invite.creator.name}
                    </CardTitle>
                    <CardDescription className="text-base mt-2">
                        has invited you to connect on FaceCallAI
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 pt-6">
                    <div className="text-center text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg border border-border/50">
                        Accepting will add them to your connections and allow messaging.
                    </div>
                    <Button
                        size="lg"
                        className="w-full text-lg font-medium shadow-lg hover:shadow-xl transition-all"
                        onClick={() => acceptMutation.mutate()}
                        disabled={acceptMutation.isPending}
                    >
                        {acceptMutation.isPending ? (
                            <>
                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                Connecting...
                            </>
                        ) : (
                            <>
                                <CheckCircle2 className="mr-2 h-5 w-5" />
                                Accept Invite
                            </>
                        )}
                    </Button>
                    <Button variant="ghost" className="w-full" onClick={() => setLocation("/dashboard")}>
                        Cancel
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}

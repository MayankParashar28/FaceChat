import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, AlertCircle, CheckCircle2, Loader2, RefreshCw, ArrowLeft, Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LogoMark } from "@/components/LogoMark";
import { auth } from "@/lib/firebase";
import { applyActionCode } from "firebase/auth";
import { motion, AnimatePresence } from "framer-motion";

export default function EmailVerification() {
  const [, setLocation] = useLocation();
  const { user, loading: authLoading, resendEmailVerification, logout } = useAuth();
  const [email, setEmail] = useState("");
  const [isResending, setIsResending] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [resendAttempts, setResendAttempts] = useState(0);
  const maxResendAttempts = 2;

  // Get email from user or URL params
  useEffect(() => {
    setEmail(user?.email || new URLSearchParams(window.location.search).get("email") || "");
  }, [user]);

  // Update MongoDB with verified status
  const updateMongoDBStatus = async (userEmail: string) => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) return;

      const token = await currentUser.getIdToken(true);
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: userEmail,
          isEmailVerified: true,
        }),
      });

      if (!response.ok && response.status !== 429) {
        console.error('Failed to update MongoDB:', response.status);
      }
    } catch (error) {
      console.error('Error updating MongoDB:', error);
    }
  };

  // Handle Firebase email verification action code from URL
  const handleEmailVerification = async (actionCode: string) => {
    setIsChecking(true);
    setError("");
    setSuccess("");

    try {
      await applyActionCode(auth, actionCode);

      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("User not found");
      }

      await currentUser.reload();

      if (!currentUser.emailVerified) {
        throw new Error("Email verification failed. Please try again.");
      }

      await updateMongoDBStatus(currentUser.email || "");

      setSuccess("Email verified successfully! Redirecting...");
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 1000);
    } catch (error: any) {
      console.error("Error verifying email:", error);
      setError(error.message || "Failed to verify email. The link may have expired.");
      setIsChecking(false);
    }
  };

  // Check if already verified and redirect
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setLocation("/login");
      return;
    }

    if (user.isEmailVerified || user.emailVerified) {
      window.location.href = "/dashboard";
    }
  }, [user, authLoading, setLocation]);

  // Check verification status every 3 seconds (fallback if email link clicked in another tab)
  useEffect(() => {
    if (!user || user.emailVerified || user.isEmailVerified) return;

    const checkInterval = setInterval(async () => {
      try {
        const currentUser = auth.currentUser;
        if (currentUser && !currentUser.emailVerified) {
          await currentUser.reload();
          if (currentUser.emailVerified) {
            await updateMongoDBStatus(currentUser.email || "");
            window.location.href = "/dashboard";
          }
        }
      } catch (error) {
        console.error("Error checking verification:", error);
      }
    }, 3000);

    return () => clearInterval(checkInterval);
  }, [user]);

  // Handle Firebase email verification action code from URL (when user clicks link in email)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get("mode");
    const actionCode = urlParams.get("oobCode");

    if (mode === "verifyEmail" && actionCode) {
      handleEmailVerification(actionCode);
    }
  }, []);

  // Countdown timer for resend
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleCheckVerification = async (e?: React.MouseEvent) => {
    e?.preventDefault();

    setIsChecking(true);
    setError("");
    setSuccess("");

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("User not authenticated");
      }

      await currentUser.reload();

      if (currentUser.emailVerified) {
        await updateMongoDBStatus(currentUser.email || "");
        setSuccess("Email verified successfully! Redirecting...");
        setTimeout(() => {
          window.location.href = "/dashboard";
        }, 1000);
      } else {
        setError("Email not verified yet. Please check your inbox and click the verification link.");
        setIsChecking(false);
      }
    } catch (error: any) {
      setError(error.message || "Failed to check verification status");
      setIsChecking(false);
    }
  };

  const handleResend = async (e?: React.MouseEvent) => {
    e?.preventDefault();

    if (countdown > 0 || isResending) return;

    if (resendAttempts >= maxResendAttempts) {
      setError(`You've reached the maximum of ${maxResendAttempts} resend attempts per signup. Please contact support if you need help.`);
      return;
    }

    setIsResending(true);
    setError("");
    setSuccess("");

    try {
      await resendEmailVerification();
      setResendAttempts(prev => prev + 1);
      setSuccess(`New verification email sent! Check your inbox and click the verification link. (${resendAttempts + 1}/${maxResendAttempts} attempts used)`);
      setCountdown(60);
    } catch (error: any) {
      if (error.message?.includes("too many") || error.message?.includes("Too many") || error.code === 'auth/too-many-requests') {
        setError(`Too many requests. Please wait a few minutes before requesting another email. (${resendAttempts}/${maxResendAttempts} attempts used)`);
        setCountdown(60);
      } else {
        setError(error.message || "Failed to resend verification email");
      }
    } finally {
      setIsResending(false);
    }
  };

  const handleBackToLogin = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      await logout();
      setLocation("/login");
    } catch (error) {
      console.error("Error signing out:", error);
      setLocation("/login");
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="relative">
          <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full animate-pulse" />
          <div className="relative bg-black/40 backdrop-blur-xl p-8 rounded-full border border-white/10">
            <LogoMark className="h-12 w-12 animate-spin-slow" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background/95 backdrop-blur-3xl overflow-hidden relative flex flex-col">
      {/* Background Gradients */}
      <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-primary/10 blur-[120px] animate-pulse-glow" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-purple-500/10 blur-[120px] animate-pulse-glow animation-delay-500" />
      </div>

      <nav className="p-6 relative z-10">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => window.location.href = "/"}>
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
              <LogoMark className="h-10 w-10 relative z-10" />
            </div>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">AI Meet</span>
          </div>
          <ThemeToggle />
        </div>
      </nav>

      <div className="flex-1 flex items-center justify-center p-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <Card className="border-white/10 bg-black/40 backdrop-blur-xl shadow-2xl overflow-hidden">
            <CardHeader className="space-y-4 text-center pb-8 pt-8">
              <div className="flex items-center justify-center w-20 h-20 rounded-full bg-white/5 border border-white/10 mx-auto mb-2 relative group">
                <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <Mail className="w-8 h-8 text-primary relative z-10" />
                <div className="absolute -top-1 -right-1 w-6 h-6 bg-primary rounded-full flex items-center justify-center border-2 border-black">
                  <Sparkles className="w-3 h-3 text-white" />
                </div>
              </div>
              <CardTitle className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60">
                Verify Your Email
              </CardTitle>
              <CardDescription className="text-white/60 text-base">
                We've sent a magic link to <br />
                <span className="text-white font-medium">{email}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="px-8 pb-8">
              <AnimatePresence mode="wait">
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-6"
                  >
                    <Alert variant="destructive" className="bg-red-500/10 border-red-500/20 text-red-400">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  </motion.div>
                )}
                {success && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-6"
                  >
                    <Alert className="bg-green-500/10 border-green-500/20 text-green-400">
                      <CheckCircle2 className="h-4 w-4" />
                      <AlertDescription>{success}</AlertDescription>
                    </Alert>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="space-y-6">
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
                  <p className="text-sm text-white/60">
                    Click the link in your email, then click below:
                  </p>
                </div>

                <Button
                  onClick={handleCheckVerification}
                  className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-lg shadow-primary/20 transition-all hover:scale-[1.02]"
                  disabled={isChecking}
                >
                  {isChecking ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Verifying...</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4" />
                      <span>I've Verified My Email</span>
                    </div>
                  )}
                </Button>

                <div className="space-y-4 pt-4 border-t border-white/10">
                  <div className="text-center space-y-2">
                    <p className="text-sm text-white/40">
                      Didn't receive the email?
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleResend}
                      disabled={isResending || countdown > 0 || resendAttempts >= maxResendAttempts}
                      className="w-full h-10 rounded-lg hover:bg-white/5 text-white/80"
                    >
                      {isResending ? (
                        <div className="flex items-center gap-2">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>Sending...</span>
                        </div>
                      ) : countdown > 0 ? (
                        <span className="text-primary">Resend available in {countdown}s</span>
                      ) : (
                        "Resend Verification Email"
                      )}
                    </Button>
                  </div>

                  <div className="text-center space-y-2">
                    <p className="text-xs text-white/30">
                      Check your spam folder if you don't see the email
                    </p>
                    {resendAttempts >= maxResendAttempts && (
                      <p className="text-xs text-red-400">
                        Max attempts reached ({maxResendAttempts}/{maxResendAttempts})
                      </p>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleBackToLogin}
                      className="text-white/40 hover:text-white hover:bg-transparent transition-colors"
                    >
                      <ArrowLeft className="h-3 w-3 mr-2" />
                      Back to Login
                    </Button>
                  </div>
                </div>

                {window.location.search.includes("oobCode") && isChecking && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-primary/10 border border-primary/20 rounded-xl p-4 flex items-center gap-3"
                  >
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <p className="text-xs text-primary">
                      <strong>Verifying...</strong> Please wait while we verify your email.
                    </p>
                  </motion.div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

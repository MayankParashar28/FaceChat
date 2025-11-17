import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, AlertCircle, CheckCircle2, Loader2, RefreshCw, ArrowLeft } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LogoMark } from "@/components/LogoMark";
import { auth } from "@/lib/firebase";
import { applyActionCode } from "firebase/auth";

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // Check resend attempts limit
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
      setCountdown(60); // 60 second countdown
    } catch (error: any) {
      // Check if it's a rate limit error from Firebase
      if (error.message?.includes("too many") || error.message?.includes("Too many") || error.code === 'auth/too-many-requests') {
        setError(`Too many requests. Please wait a few minutes before requesting another email. (${resendAttempts}/${maxResendAttempts} attempts used)`);
        setCountdown(60); // Start countdown even on error
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
      // Sign out the user first so they can log in with a different account
      await logout();
      // Then navigate to login page
      setLocation("/login");
    } catch (error) {
      console.error("Error signing out:", error);
      // Even if logout fails, still navigate to login
      setLocation("/login");
    }
  };

  // Show loading while checking authentication
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-chart-2/5 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-chart-2/5 flex flex-col">
      <nav className="p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => window.location.href = "/"}>
            <LogoMark className="h-8 w-8" />
            <span className="text-xl font-semibold">AI Meet</span>
          </div>
          <ThemeToggle />
        </div>
      </nav>

      <div className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mx-auto mb-4">
              <Mail className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-2xl font-bold text-center">Verify Your Email</CardTitle>
            <CardDescription className="text-center">
              We've sent a verification email to
              <br />
              <strong>{email}</strong>
              <br />
              <br />
              Please check your inbox and click the verification link to verify your email address.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {success && (
              <Alert className="mb-4 border-green-500 bg-green-50 dark:bg-green-950">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800 dark:text-green-200">{success}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-4">
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  After clicking the verification link in your email, click the button below to continue.
                </p>
              </div>

              <Button 
                onClick={handleCheckVerification}
                className="w-full" 
                disabled={isChecking}
              >
                {isChecking ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Checking...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    I've Verified My Email
                  </>
                )}
              </Button>

              <div className="mt-4 text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  Didn't receive the email?
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResend}
                  disabled={isResending || countdown > 0 || resendAttempts >= maxResendAttempts}
                  className="w-full"
                >
                  {isResending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : countdown > 0 ? (
                    `Resend email in ${countdown}s`
                  ) : (
                    "Resend Verification Email"
                  )}
                </Button>
              </div>

              <div className="mt-6 pt-4 border-t text-center space-y-2">
                <p className="text-xs text-muted-foreground">
                  Check your spam folder if you don't see the email
                </p>
                {resendAttempts >= maxResendAttempts && (
                  <p className="text-xs text-destructive">
                    Maximum resend attempts reached ({maxResendAttempts}/{maxResendAttempts})
                  </p>
                )}
                {resendAttempts > 0 && resendAttempts < maxResendAttempts && (
                  <p className="text-xs text-muted-foreground">
                    {resendAttempts}/{maxResendAttempts} resend attempts used
                  </p>
                )}
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={handleBackToLogin}
                  className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Login
                </Button>
              </div>

              
              {/* Show loading state when verifying from link */}
              {window.location.search.includes("oobCode") && isChecking && (
                <Alert className="mt-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <AlertDescription className="text-xs">
                    <strong>Verifying...</strong> Please wait while we verify your email.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Scan, Mail, Lock, User, AlertCircle, CheckCircle2, ArrowRight, Sparkles, Eye, EyeOff } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LogoMark } from "@/components/LogoMark";
import { validatePassword, getPasswordStrengthColor } from "@/lib/passwordValidation";
import { motion, AnimatePresence } from "framer-motion";
import { FaGoogle, FaGithub } from "react-icons/fa";
import { authenticateWebAuthn, isWebAuthnSupported } from "@/lib/webauthn";

export default function Login() {
  const [, setLocation] = useLocation();
  const { user, loading, signIn, signUp, checkUsername, getUsernameSuggestions, resetPassword, signInWithGoogle, signInWithGithub } = useAuth();
  const [email, setEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [isFaceScanning, setIsFaceScanning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [usernameSuggestions, setUsernameSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [passwordValidation, setPasswordValidation] = useState<{ errors: string[]; strength: "weak" | "medium" | "strong" } | null>(null);

  // Password visibility
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);

  // Forgot Password State
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetStatus, setResetStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [resetError, setResetError] = useState("");

  // Redirect to dashboard if user is already logged in
  useEffect(() => {
    if (!loading && user) {
      setLocation("/dashboard");
    }
  }, [user, loading, setLocation]);

  // Show loading while checking authentication
  if (loading) {
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

  // Don't show login form if user is already logged in (redirecting)
  if (user) {
    return null;
  }

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      await signIn(email, loginPassword);
      setLocation("/dashboard");
    } catch (error: any) {
      setError(error.message || "Login failed");
      setIsSubmitting(false);
    }
  };

  const handlePasswordChange = (value: string) => {
    setSignupPassword(value);
    if (value.length > 0) {
      const validation = validatePassword(value);
      setPasswordValidation({
        errors: validation.errors,
        strength: validation.strength,
      });
    } else {
      setPasswordValidation(null);
    }
  };

  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !signupPassword || !name || !username) {
      setError("Please fill in all fields");
      return;
    }

    if (username.length < 3) {
      setError("Username must be at least 3 characters");
      return;
    }

    const passwordValidationResult = validatePassword(signupPassword);
    if (!passwordValidationResult.isValid) {
      setError(passwordValidationResult.errors[0] || "Password does not meet requirements");
      return;
    }

    setIsSubmitting(true);
    setError("");
    setUsernameError("");

    try {
      await signUp(email, signupPassword, name, username);
      setTimeout(() => {
        setLocation(`/verify-email?email=${encodeURIComponent(email)}`);
      }, 1000);
    } catch (error: any) {
      setError(error.message || "Signup failed");
      setIsSubmitting(false);
    }
  };

  const handleUsernameChange = async (value: string) => {
    setUsername(value);
    setUsernameError("");
    setShowSuggestions(false);

    if (value.length >= 3) {
      try {
        const usernameCheck = await checkUsername(value);
        if (!usernameCheck.available) {
          setUsernameError(usernameCheck.message);
          const suggestions = await getUsernameSuggestions(value);
          setUsernameSuggestions(suggestions);
          setShowSuggestions(true);
        }
      } catch (error) {
        console.error('Error checking username:', error);
      }
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setUsername(suggestion);
    setUsernameError("");
    setShowSuggestions(false);
  };

  const handleFaceLogin = async () => {
    setIsFaceScanning(true);
    setError("");

    try {
      // Check if supported
      const supported = await isWebAuthnSupported();
      if (!supported) {
        throw new Error("Face ID / Touch ID is not supported on this device.");
      }

      await authenticateWebAuthn();
      // In a real app, we would verify the credential with the server here
      // For now, we'll simulate a successful login if the biometric check passes
      setTimeout(() => {
        setIsFaceScanning(false);
        setLocation("/dashboard");
      }, 1000);
    } catch (error: any) {
      setIsFaceScanning(false);
      console.error("Face login error:", error);
      setError(error.message || "Face ID login failed. Please try again.");
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail) return;

    setResetStatus("sending");
    setResetError("");

    try {
      await resetPassword(resetEmail);
      setResetStatus("sent");
    } catch (error: any) {
      setResetStatus("error");
      setResetError(error.message);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      await signInWithGoogle();
      setLocation("/dashboard");
    } catch (error: any) {
      setError(error.message || "Google login failed");
    }
  };

  const handleGithubLogin = async () => {
    try {
      await signInWithGithub();
      setLocation("/dashboard");
    } catch (error: any) {
      setError(error.message || "Github login failed");
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-background transition-colors duration-300">
      {/* Left Side - Branding & Visuals (Theme Aware) */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col justify-between p-12 transition-colors duration-300">
        {/* Background Effects */}
        <div className="absolute inset-0 z-0">
          <div className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] rounded-full bg-primary/10 dark:bg-primary/20 blur-[120px] animate-pulse-glow will-change-transform" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[70%] h-[70%] rounded-full bg-purple-500/10 dark:bg-purple-500/20 blur-[120px] animate-pulse-glow animation-delay-500 will-change-transform" />
          <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-[0.03] dark:opacity-20 invert dark:invert-0" />
        </div>

        {/* Logo & Brand */}
        <div className="relative z-10">
          <Link href="/">
            <div className="flex items-center gap-3 cursor-pointer group w-fit">
              <div className="relative">
                <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                <LogoMark className="h-12 w-12 relative z-10" />
              </div>
              <span className="text-2xl font-bold text-foreground dark:text-white">AI Meet</span>
            </div>
          </Link>
        </div>

        {/* Hero Text */}
        <div className="relative z-10 space-y-6 max-w-lg">
          <h1 className="text-5xl font-bold leading-tight text-foreground dark:text-white">
            Experience the <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-purple-600 dark:to-purple-400">
              Future of Connection
            </span>
          </h1>
          <p className="text-lg text-muted-foreground dark:text-white/60 leading-relaxed">
            Join the next generation of video conferencing. AI-powered features, crystal clear quality, and secure connections.
          </p>

          <div className="flex gap-4 pt-4">
            <div className="flex -space-x-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="w-10 h-10 rounded-full border-2 border-background dark:border-black bg-background/50 dark:bg-white/10 backdrop-blur-md flex items-center justify-center text-xs text-foreground dark:text-white font-medium shadow-sm">
                  {i}
                </div>
              ))}
            </div>
            <div className="flex flex-col justify-center">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Sparkles key={i} className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                ))}
              </div>
              <span className="text-sm text-muted-foreground dark:text-white/60">Trusted by thousands</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 text-sm text-muted-foreground dark:text-white/40">
          © 2024 FaceCallAI. All rights reserved.
        </div>
      </div>

      {/* Right Side - Login Form (Theme Aware) */}
      <div className="w-full lg:w-1/2 bg-transparent flex flex-col relative">
        {/* Mobile Header */}
        <div className="lg:hidden p-6 flex justify-between items-center">
          <Link href="/">
            <div className="flex items-center gap-2">
              <LogoMark className="h-8 w-8" />
              <span className="font-bold text-lg">AI Meet</span>
            </div>
          </Link>
          <ThemeToggle />
        </div>

        {/* Desktop Theme Toggle */}
        <div className="hidden lg:flex absolute top-6 right-6 z-20">
          <ThemeToggle />
        </div>

        <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="w-full max-w-md space-y-8"
          >
            <div className="text-center space-y-2">
              <h2 className="text-3xl font-bold tracking-tight">Welcome back</h2>
              <p className="text-muted-foreground">
                Enter your details to access your account
              </p>
            </div>

            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                </motion.div>
              )}
            </AnimatePresence>

            <Tabs defaultValue="login" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-8">
                <TabsTrigger value="login">Login</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="space-y-6">
                <Button
                  className="w-full h-12 rounded-xl bg-gradient-to-r from-primary/20 to-purple-500/20 hover:from-primary/30 hover:to-purple-500/30 border border-white/10 text-foreground dark:text-white transition-all group relative overflow-hidden"
                  variant="outline"
                  onClick={handleFaceLogin}
                  disabled={isFaceScanning}
                  data-testid="button-face-login"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                  <Scan className={`w-5 h-5 mr-2 ${isFaceScanning ? 'animate-pulse text-primary' : 'text-muted-foreground dark:text-white/80'}`} />
                  {isFaceScanning ? "Scanning Face..." : "Login with Face ID"}
                </Button>

                <div className="grid grid-cols-2 gap-4">
                  <Button
                    variant="outline"
                    className="h-12 rounded-xl border-2 border-primary/10 hover:bg-primary/5 hover:border-primary/30 transition-all"
                    onClick={handleGoogleLogin}
                  >
                    <FaGoogle className="w-4 h-4 mr-2" />
                    Google
                  </Button>
                  <Button
                    variant="outline"
                    className="h-12 rounded-xl border-2 border-primary/10 hover:bg-primary/5 hover:border-primary/30 transition-all"
                    onClick={handleGithubLogin}
                  >
                    <FaGithub className="w-4 h-4 mr-2" />
                    GitHub
                  </Button>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-4 text-muted-foreground">Or continue with email</span>
                  </div>
                </div>

                <form onSubmit={handleEmailLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <div className="relative group">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        className="pl-10 h-12"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">Password</Label>
                      <button
                        type="button"
                        onClick={() => setShowForgotPassword(true)}
                        className="text-xs text-primary hover:text-primary/80 transition-colors"
                      >
                        Forgot Password?
                      </button>
                    </div>
                    <div className="relative group">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                      <Input
                        id="password"
                        type={showLoginPassword ? "text" : "password"}
                        placeholder="••••••••"
                        className="pl-10 pr-10 h-12"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword((prev) => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
                        aria-label={showLoginPassword ? "Hide password" : "Show password"}
                      >
                        {showLoginPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <Button
                    type="submit"
                    className="w-full h-12 rounded-xl font-medium shadow-lg shadow-primary/20 transition-all hover:scale-[1.02]"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Signing In...</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span>Sign In</span>
                        <ArrowRight className="w-4 h-4" />
                      </div>
                    )}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <Button
                    variant="outline"
                    className="h-12 rounded-xl border-2 border-primary/10 hover:bg-primary/5 hover:border-primary/30 transition-all"
                    onClick={handleGoogleLogin}
                  >
                    <FaGoogle className="w-4 h-4 mr-2" />
                    Google
                  </Button>
                  <Button
                    variant="outline"
                    className="h-12 rounded-xl border-2 border-primary/10 hover:bg-primary/5 hover:border-primary/30 transition-all"
                    onClick={handleGithubLogin}
                  >
                    <FaGithub className="w-4 h-4 mr-2" />
                    GitHub
                  </Button>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-4 text-muted-foreground">Or sign up with email</span>
                  </div>
                </div>

                <form onSubmit={handleEmailSignup} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="signup-name">Full Name</Label>
                      <div className="relative group">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                        <Input
                          id="signup-name"
                          type="text"
                          placeholder="John Doe"
                          className="pl-10 h-12"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-username">Username</Label>
                      <div className="relative group">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                        <Input
                          id="signup-username"
                          type="text"
                          placeholder="johndoe"
                          className="pl-10 h-12"
                          value={username}
                          onChange={(e) => handleUsernameChange(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                  </div>

                  {usernameError && (
                    <p className="text-sm text-red-500 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {usernameError}
                    </p>
                  )}

                  <AnimatePresence>
                    {showSuggestions && usernameSuggestions.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="p-3 rounded-xl bg-muted/50 border"
                      >
                        <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-primary" /> Suggestions:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {usernameSuggestions.map((suggestion, index) => (
                            <button
                              key={index}
                              type="button"
                              className="px-2 py-1 text-xs bg-background hover:bg-muted border rounded-lg text-foreground transition-colors"
                              onClick={() => handleSuggestionClick(suggestion)}
                            >
                              @{suggestion}
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <div className="relative group">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="you@example.com"
                        className="pl-10 h-12"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <div className="relative group">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                      <Input
                        id="signup-password"
                        type={showSignupPassword ? "text" : "password"}
                        placeholder="••••••••"
                        className="pl-10 pr-10 h-12"
                        value={signupPassword}
                        onChange={(e) => handlePasswordChange(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowSignupPassword((prev) => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
                        aria-label={showSignupPassword ? "Hide password" : "Show password"}
                      >
                        {showSignupPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    <AnimatePresence>
                      {passwordValidation && signupPassword.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="space-y-2 pt-2"
                        >
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                              <div
                                className={`h-full transition-all duration-500 ${passwordValidation.strength === 'strong' ? 'w-full bg-green-500' :
                                  passwordValidation.strength === 'medium' ? 'w-2/3 bg-yellow-500' :
                                    'w-1/3 bg-red-500'
                                  }`}
                              />
                            </div>
                            <span className={`text-xs font-medium ${getPasswordStrengthColor(passwordValidation.strength)}`}>
                              {passwordValidation.strength.toUpperCase()}
                            </span>
                          </div>
                          {passwordValidation.errors.length > 0 && (
                            <ul className="text-xs text-muted-foreground space-y-1">
                              {passwordValidation.errors.slice(0, 2).map((error, index) => (
                                <li key={index} className="flex items-center gap-1">
                                  <div className="w-1 h-1 rounded-full bg-muted-foreground" />
                                  {error}
                                </li>
                              ))}
                            </ul>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-12 rounded-xl font-medium shadow-lg shadow-primary/20 transition-all hover:scale-[1.02]"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Creating Account...</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span>Create Account</span>
                        <ArrowRight className="w-4 h-4" />
                      </div>
                    )}
                  </Button>
                  <p className="text-xs text-center text-muted-foreground">
                    By signing up, you agree to our Terms & Privacy Policy
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </motion.div>
        </div>
      </div>

      <Dialog open={showForgotPassword} onOpenChange={setShowForgotPassword}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Enter your email address and we'll send you a link to reset your password.
            </DialogDescription>
          </DialogHeader>

          {resetStatus === "sent" ? (
            <div className="py-6 text-center space-y-4">
              <div className="mx-auto w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-green-500" />
              </div>
              <div className="space-y-2">
                <p className="font-medium">Check your email</p>
                <p className="text-sm text-muted-foreground">
                  We've sent a password reset link to <span className="font-medium text-foreground">{resetEmail}</span>
                </p>
              </div>
              <Button
                onClick={() => {
                  setShowForgotPassword(false);
                  setResetStatus("idle");
                  setResetEmail("");
                }}
                className="w-full"
              >
                Back to Login
              </Button>
            </div>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email">Email Address</Label>
                <Input
                  id="reset-email"
                  type="email"
                  placeholder="you@example.com"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                />
              </div>

              {resetStatus === "error" && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{resetError}</AlertDescription>
                </Alert>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowForgotPassword(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={resetStatus === "sending" || !resetEmail}
                >
                  {resetStatus === "sending" ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                      Sending...
                    </>
                  ) : (
                    "Send Reset Link"
                  )}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

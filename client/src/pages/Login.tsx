import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, Lock, User, AlertCircle, ArrowRight, Sparkles, Eye, EyeOff } from "lucide-react";

import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth";
import { takeAuthError } from "@/lib/sessionCredential";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LogoMark } from "@/components/LogoMark";
import { validatePassword, getPasswordStrengthColor } from "@/lib/passwordValidation";
import { motion, AnimatePresence } from "framer-motion";

export default function Login() {
  const [, setLocation] = useLocation();
  const { user, loading, signIn, signUp, signInWithGoogle, checkUsername, getUsernameSuggestions } =
    useAuth();
  const [email, setEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [usernameSuggestions, setUsernameSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [passwordValidation, setPasswordValidation] = useState<{
    errors: string[];
    strength: "weak" | "medium" | "strong";
  } | null>(null);

  // Password visibility
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);

  /**
   * Google sign-in.
   *
   * This button was on the page until it was removed in Aug 2026, which left
   * accounts created through Google with no way back in: they hold no password,
   * so the email/password form could never work for them. The provider itself
   * never went away — signInWithGoogle has been wired up in lib/auth the whole
   * time, just unreachable from here.
   *
   * No redirect on success: the effect below already sends a signed-in user to
   * the dashboard.
   */
  const handleGoogleSignIn = async () => {
    setError("");
    setIsGoogleSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      const code = err?.code ?? "";
      // Closing the popup is not an error worth shouting about.
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        return;
      }
      // Firebase's own text for this is "Firebase: Error (auth/popup-blocked)",
      // which tells nobody what to do about it.
      setError(
        code === "auth/popup-blocked"
          ? "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again."
          : err?.message || "Could not sign in with Google. Please try again."
      );
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  // A sign-in the auth provider had to undo leaves its reason behind.
  useEffect(() => {
    const rejected = takeAuthError();
    if (rejected) setError(rejected);
  }, []);

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
          <div className="relative bg-card/80 backdrop-blur-xl p-8 rounded-full border border-border">
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
        console.error("Error checking username:", error);
      }
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setUsername(suggestion);
    setUsernameError("");
    setShowSuggestions(false);
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
            Join the next generation of video conferencing. AI-powered features, crystal clear
            quality, and secure connections.
          </p>
        </div>

        {/* Footer */}
        <div className="relative z-10 text-sm text-muted-foreground dark:text-white/40">
          © 2026 AI Meet
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
              <p className="text-muted-foreground">Enter your details to access your account</p>
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
                <form onSubmit={handleEmailLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email or Username</Label>
                    <div className="relative group">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                      <Input
                        id="email"
                        type="text"
                        placeholder="Email or Username"
                        className="pl-10 h-12"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
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
                        <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
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
                                className={`h-full transition-all duration-500 ${
                                  passwordValidation.strength === "strong"
                                    ? "w-full bg-green-500"
                                    : passwordValidation.strength === "medium"
                                      ? "w-2/3 bg-yellow-500"
                                      : "w-1/3 bg-red-500"
                                }`}
                              />
                            </div>
                            <span
                              className={`text-xs font-medium ${getPasswordStrengthColor(passwordValidation.strength)}`}
                            >
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
                        <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                        <span>Creating Account...</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span>Create Account</span>
                        <ArrowRight className="w-4 h-4" />
                      </div>
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            {/* Outside the tabs: with Google, signing in and signing up are
                the same action. */}
            <div className="mt-6 space-y-4">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full h-12 rounded-xl font-medium"
                onClick={handleGoogleSignIn}
                disabled={isGoogleSubmitting || isSubmitting}
              >
                {isGoogleSubmitting ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin" />
                    <span>Opening Google…</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.27-4.74 3.27-8.09Z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
                      />
                    </svg>
                    <span>Continue with Google</span>
                  </div>
                )}
              </Button>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Scan, Mail, Lock, User, AlertCircle, CheckCircle2, ArrowRight, Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LogoMark } from "@/components/LogoMark";
import { validatePassword, getPasswordStrengthColor } from "@/lib/passwordValidation";
import { motion, AnimatePresence } from "framer-motion";

export default function Login() {
  const [, setLocation] = useLocation();
  const { user, loading, signIn, signUp, checkUsername, getUsernameSuggestions } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [isFaceScanning, setIsFaceScanning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [usernameSuggestions, setUsernameSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [passwordValidation, setPasswordValidation] = useState<{ errors: string[]; strength: "weak" | "medium" | "strong" } | null>(null);

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
      await signIn(email, password);
      setLocation("/dashboard");
    } catch (error: any) {
      setError(error.message || "Login failed");
      setIsSubmitting(false);
    }
  };

  const handlePasswordChange = (value: string) => {
    setPassword(value);
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

    if (!email || !password || !name || !username) {
      setError("Please fill in all fields");
      return;
    }

    if (username.length < 3) {
      setError("Username must be at least 3 characters");
      return;
    }

    const passwordValidationResult = validatePassword(password);
    if (!passwordValidationResult.isValid) {
      setError(passwordValidationResult.errors[0] || "Password does not meet requirements");
      return;
    }

    setIsSubmitting(true);
    setError("");
    setUsernameError("");

    try {
      await signUp(email, password, name, username);
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

  const handleFaceLogin = () => {
    setIsFaceScanning(true);
    setTimeout(() => {
      setIsFaceScanning(false);
      setLocation("/dashboard");
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-background/95 backdrop-blur-3xl overflow-hidden relative flex flex-col">
      {/* Background Gradients */}
      <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-primary/10 blur-[120px] animate-pulse-glow" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-purple-500/10 blur-[120px] animate-pulse-glow animation-delay-500" />
      </div>

      <nav className="p-6 relative z-10">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href="/">
            <div className="flex items-center gap-3 cursor-pointer group" data-testid="link-home">
              <div className="relative">
                <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                <LogoMark className="h-10 w-10 relative z-10" />
              </div>
              <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">AI Meet</span>
            </div>
          </Link>
          <ThemeToggle />
        </div>
      </nav>

      <div className="flex-1 flex items-center justify-center p-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <Card className="border-white/10 bg-black/40 backdrop-blur-xl shadow-2xl overflow-hidden">
            <CardHeader className="space-y-2 text-center pb-8 pt-8">
              <CardTitle className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60">
                Welcome Back
              </CardTitle>
              <CardDescription className="text-white/60 text-base">
                Enter the future of communication
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
              </AnimatePresence>

              <Tabs defaultValue="login" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-8 bg-white/5 p-1 rounded-2xl border border-white/5">
                  <TabsTrigger
                    value="login"
                    className="rounded-xl data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all"
                    data-testid="tab-login"
                  >
                    Login
                  </TabsTrigger>
                  <TabsTrigger
                    value="signup"
                    className="rounded-xl data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all"
                    data-testid="tab-signup"
                  >
                    Sign Up
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="login" className="space-y-6">
                  <Button
                    className="w-full h-12 rounded-xl bg-gradient-to-r from-primary/20 to-purple-500/20 hover:from-primary/30 hover:to-purple-500/30 border border-white/10 text-white transition-all group relative overflow-hidden"
                    variant="outline"
                    onClick={handleFaceLogin}
                    disabled={isFaceScanning}
                    data-testid="button-face-login"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                    <Scan className={`w-5 h-5 mr-2 ${isFaceScanning ? 'animate-pulse text-primary' : 'text-white/80'}`} />
                    {isFaceScanning ? "Scanning Face..." : "Login with Face ID"}
                  </Button>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-white/10" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-black/40 px-4 text-white/40 backdrop-blur-xl">Or continue with email</span>
                    </div>
                  </div>

                  <form onSubmit={handleEmailLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-white/80">Email</Label>
                      <div className="relative group">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 group-focus-within:text-primary transition-colors" />
                        <Input
                          id="email"
                          type="email"
                          placeholder="you@example.com"
                          className="pl-10 h-12 bg-white/5 border-white/10 focus:border-primary/50 focus:bg-white/10 rounded-xl text-white placeholder:text-white/20 transition-all"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          data-testid="input-email"
                          required
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password" className="text-white/80">Password</Label>
                      <div className="relative group">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 group-focus-within:text-primary transition-colors" />
                        <Input
                          id="password"
                          type="password"
                          placeholder="••••••••"
                          className="pl-10 h-12 bg-white/5 border-white/10 focus:border-primary/50 focus:bg-white/10 rounded-xl text-white placeholder:text-white/20 transition-all"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          data-testid="input-password"
                          required
                        />
                      </div>
                    </div>
                    <Button
                      type="submit"
                      className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-lg shadow-primary/20 transition-all hover:scale-[1.02]"
                      data-testid="button-submit-login"
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

                <TabsContent value="signup" className="space-y-4">
                  <form onSubmit={handleEmailSignup} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="signup-name" className="text-white/80">Full Name</Label>
                        <div className="relative group">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 group-focus-within:text-primary transition-colors" />
                          <Input
                            id="signup-name"
                            type="text"
                            placeholder="John Doe"
                            className="pl-10 h-12 bg-white/5 border-white/10 focus:border-primary/50 focus:bg-white/10 rounded-xl text-white placeholder:text-white/20 transition-all"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            data-testid="input-signup-name"
                            required
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="signup-username" className="text-white/80">Username</Label>
                        <div className="relative group">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 group-focus-within:text-primary transition-colors" />
                          <Input
                            id="signup-username"
                            type="text"
                            placeholder="johndoe"
                            className="pl-10 h-12 bg-white/5 border-white/10 focus:border-primary/50 focus:bg-white/10 rounded-xl text-white placeholder:text-white/20 transition-all"
                            value={username}
                            onChange={(e) => handleUsernameChange(e.target.value)}
                            data-testid="input-signup-username"
                            required
                          />
                        </div>
                      </div>
                    </div>

                    {usernameError && (
                      <p className="text-sm text-red-400 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> {usernameError}
                      </p>
                    )}

                    <AnimatePresence>
                      {showSuggestions && usernameSuggestions.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="p-3 rounded-xl bg-white/5 border border-white/10"
                        >
                          <p className="text-xs text-white/60 mb-2 flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-primary" /> Suggestions:
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {usernameSuggestions.map((suggestion, index) => (
                              <button
                                key={index}
                                type="button"
                                className="px-2 py-1 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/80 transition-colors"
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
                      <Label htmlFor="signup-email" className="text-white/80">Email</Label>
                      <div className="relative group">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 group-focus-within:text-primary transition-colors" />
                        <Input
                          id="signup-email"
                          type="email"
                          placeholder="you@example.com"
                          className="pl-10 h-12 bg-white/5 border-white/10 focus:border-primary/50 focus:bg-white/10 rounded-xl text-white placeholder:text-white/20 transition-all"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          data-testid="input-signup-email"
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="signup-password" className="text-white/80">Password</Label>
                      <div className="relative group">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 group-focus-within:text-primary transition-colors" />
                        <Input
                          id="signup-password"
                          type="password"
                          placeholder="••••••••"
                          className="pl-10 h-12 bg-white/5 border-white/10 focus:border-primary/50 focus:bg-white/10 rounded-xl text-white placeholder:text-white/20 transition-all"
                          value={password}
                          onChange={(e) => handlePasswordChange(e.target.value)}
                          data-testid="input-signup-password"
                          required
                        />
                      </div>

                      <AnimatePresence>
                        {passwordValidation && password.length > 0 && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="space-y-2 pt-2"
                          >
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
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
                              <ul className="text-xs text-white/40 space-y-1">
                                {passwordValidation.errors.slice(0, 2).map((error, index) => (
                                  <li key={index} className="flex items-center gap-1">
                                    <div className="w-1 h-1 rounded-full bg-white/40" />
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
                      className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-lg shadow-primary/20 transition-all hover:scale-[1.02]"
                      data-testid="button-submit-signup"
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
                    <p className="text-xs text-center text-white/40">
                      By signing up, you agree to our Terms & Privacy Policy
                    </p>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

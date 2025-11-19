import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Video, Sparkles, Users, Shield, BarChart3, Zap, ArrowRight, Play, Globe, Lock, Smile, MessageSquare, Star, CheckCircle2, TrendingUp, Brain, Headphones, Camera } from "lucide-react";
import { LogoMark } from "@/components/LogoMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";

export default function Landing() {
  const { user, loading } = useAuth();
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [activeFeature, setActiveFeature] = useState(0);
  const { scrollYProgress } = useScroll();

  // Game state
  const [gameActive, setGameActive] = useState(false);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [gameIcons, setGameIcons] = useState<Array<{ id: number; x: number; y: number; icon: any; color: string }>>([]);
  const [highScore, setHighScore] = useState(() => {
    if (typeof window !== 'undefined') {
      return parseInt(localStorage.getItem('aiMeetGameHighScore') || '0');
    }
    return 0;
  });

  const y1 = useTransform(scrollYProgress, [0, 1], [0, -200]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, -100]);
  const y3 = useTransform(scrollYProgress, [0, 1], [0, -50]);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.3], [1, 0.95]);

  const gameIconTypes = [
    { icon: Sparkles, color: "from-violet-500 to-purple-500" },
    { icon: Shield, color: "from-blue-500 to-cyan-500" },
    { icon: Users, color: "from-emerald-500 to-teal-500" },
    { icon: Video, color: "from-pink-500 to-rose-500" },
    { icon: Star, color: "from-yellow-500 to-amber-500" },
  ];

  // Game logic
  const startGame = () => {
    setGameActive(true);
    setScore(0);
    setTimeLeft(30);
    spawnIcons();
  };

  const spawnIcons = () => {
    const icons = Array.from({ length: 5 }, (_, i) => {
      const iconType = gameIconTypes[Math.floor(Math.random() * gameIconTypes.length)];
      return {
        id: Date.now() + i,
        x: Math.random() * 80 + 10,
        y: Math.random() * 70 + 15,
        icon: iconType.icon,
        color: iconType.color
      };
    });
    setGameIcons(icons);
  };

  const catchIcon = (id: number) => {
    setScore(prev => prev + 10);
    setGameIcons(prev => prev.filter(icon => icon.id !== id));

    // Spawn new icon
    setTimeout(() => {
      if (gameActive) {
        const iconType = gameIconTypes[Math.floor(Math.random() * gameIconTypes.length)];
        setGameIcons(prev => [...prev, {
          id: Date.now(),
          x: Math.random() * 80 + 10,
          y: Math.random() * 70 + 15,
          icon: iconType.icon,
          color: iconType.color
        }]);
      }
    }, 200);
  };

  const endGame = () => {
    setGameActive(false);
    if (score > highScore) {
      setHighScore(score);
      if (typeof window !== 'undefined') {
        localStorage.setItem('aiMeetGameHighScore', score.toString());
      }
    }
    setGameIcons([]);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({
        x: (e.clientX / window.innerWidth - 0.5) * 20,
        y: (e.clientY / window.innerHeight - 0.5) * 20,
      });
    };
    window.addEventListener("mousemove", handleMouseMove);

    const interval = setInterval(() => {
      setActiveFeature((prev) => (prev + 1) % 6);
    }, 3000);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      clearInterval(interval);
    };
  }, []);

  // Game timer
  useEffect(() => {
    if (gameActive && timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    } else if (timeLeft === 0 && gameActive) {
      endGame();
    }
  }, [gameActive, timeLeft]);

  const features = [
    {
      icon: Sparkles,
      title: "AI Emotion Detection",
      description: "Real-time emotion analysis to understand participant engagement and sentiment during calls.",
      color: "from-violet-500 to-purple-500"
    },
    {
      icon: Shield,
      title: "Facial Recognition",
      description: "Secure authentication and attendance tracking using advanced facial recognition technology.",
      color: "from-blue-500 to-cyan-500"
    },
    {
      icon: Users,
      title: "Smart Collaboration",
      description: "Seamless video calls with up to 6 participants, screen sharing, and intelligent backgrounds.",
      color: "from-emerald-500 to-teal-500"
    },
    {
      icon: BarChart3,
      title: "Call Analytics",
      description: "Detailed post-call summaries with emotion stats, attendance reports, and engagement metrics.",
      color: "from-orange-500 to-red-500"
    },
    {
      icon: Zap,
      title: "Instant Filters",
      description: "Apply AI-powered filters and background blur in real-time for professional appearance.",
      color: "from-yellow-500 to-amber-500"
    },
    {
      icon: Video,
      title: "HD Quality",
      description: "Crystal-clear video and audio with adaptive quality for smooth calling experience.",
      color: "from-pink-500 to-rose-500"
    }
  ];

  const testimonials = [
    { name: "Sarah Johnson", role: "Product Manager", company: "TechCorp", text: "The emotion detection feature helped us understand our team's engagement in a whole new way!", rating: 5 },
    { name: "Mike Chen", role: "CEO", company: "StartupX", text: "Best video calling platform we've used. The AI features are game-changing.", rating: 5 },
    { name: "Emily Rodriguez", role: "Team Lead", company: "Innovate Inc", text: "Facial recognition for attendance saves us hours every week. Incredibly useful!", rating: 5 },
  ];

  const useCases = [
    { icon: Brain, title: "Remote Teams", desc: "Track engagement and collaboration" },
    { icon: Headphones, title: "Customer Support", desc: "Understand client satisfaction" },
    { icon: Camera, title: "Online Classes", desc: "Monitor student attentiveness" },
    { icon: TrendingUp, title: "Sales Calls", desc: "Analyze prospect interest levels" },
  ];

  return (
    <div className="min-h-screen bg-background overflow-hidden relative">
      {/* Enhanced Animated Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-violet-500/20 rounded-full blur-3xl animate-pulse [animation-delay:1s]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse [animation-delay:2s]" />
        <div className="absolute top-1/4 right-1/3 w-64 h-64 bg-emerald-500/15 rounded-full blur-3xl animate-pulse [animation-delay:0.5s]" />
        <div className="absolute bottom-1/4 left-1/3 w-64 h-64 bg-pink-500/15 rounded-full blur-3xl animate-pulse [animation-delay:1.5s]" />

        {/* Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:4rem_4rem]" />
      </div>

      {/* Navigation */}
      <motion.nav
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-background/60 border-b border-white/10"
      >
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <motion.div
            className="flex items-center gap-3"
            whileHover={{ scale: 1.05 }}
          >
            <LogoMark className="h-10 w-10" />
            <span className="text-2xl font-bold bg-gradient-to-r from-primary to-violet-500 bg-clip-text text-transparent">
              AI Meet
            </span>
          </motion.div>

          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm font-medium hover:text-primary transition-colors">Features</a>
            <a href="#demo" className="text-sm font-medium hover:text-primary transition-colors">Demo</a>
            <a href="#testimonials" className="text-sm font-medium hover:text-primary transition-colors">Testimonials</a>
          </div>

          <div className="flex items-center gap-3">
            {!loading && !user && (
              <>
                <Link href="/login">
                  <Button variant="ghost">Login</Button>
                </Link>
                <Link href="/login">
                  <Button className="gap-2">
                    Sign Up <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
              </>
            )}
            {!loading && user && (
              <Link href="/dashboard">
                <Button>Dashboard</Button>
              </Link>
            )}
            <ThemeToggle />
          </div>
        </div>
      </motion.nav>

      {/* Hero Section */}
      <section className="pt-40 pb-20 px-6 relative">
        <motion.div
          style={{ opacity, scale }}
          className="max-w-7xl mx-auto"
        >
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left Content */}
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
            >
              <motion.div
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-primary/20 to-violet-500/20 border border-primary/20 text-sm font-medium mb-8"
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="bg-gradient-to-r from-primary to-violet-500 bg-clip-text text-transparent">
                  AI-Powered Video Calling
                </span>
              </motion.div>

              <h1 className="text-6xl lg:text-7xl font-bold mb-8 leading-tight">
                <span className="block">Connect</span>
                <span className="block">Smarter.</span>
                <span className="block bg-gradient-to-r from-primary via-violet-500 to-blue-500 bg-clip-text text-transparent">
                  With AI.
                </span>
              </h1>

              <p className="text-xl text-muted-foreground mb-10 leading-relaxed">
                Experience the future of video communication with intelligent features like{" "}
                <span className="text-foreground font-medium">emotion detection</span>,{" "}
                <span className="text-foreground font-medium">facial recognition</span>, and{" "}
                <span className="text-foreground font-medium">smart attendance</span>.
              </p>

              <div className="flex flex-wrap gap-4 mb-12">
                <Link href="/dashboard">
                  <Button size="lg" className="px-8 h-14 text-lg gap-2 shadow-xl shadow-primary/20">
                    <Play className="w-5 h-5" fill="currentColor" />
                    Start Video Call
                  </Button>
                </Link>
                <Link href="/dashboard">
                  <Button size="lg" variant="outline" className="px-8 h-14 text-lg gap-2">
                    Join Room
                    <ArrowRight className="w-5 h-5" />
                  </Button>
                </Link>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-8 pt-8 border-t border-white/10">
                {[
                  { value: "50K+", label: "Active Users" },
                  { value: "1M+", label: "Meetings" },
                  { value: "99.9%", label: "Uptime" }
                ].map((stat, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 + i * 0.1 }}
                  >
                    <div className="text-3xl font-bold bg-gradient-to-r from-primary to-violet-500 bg-clip-text text-transparent">
                      {stat.value}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">{stat.label}</div>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Right 3D Visualization - Enhanced */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8 }}
              className="relative perspective-1000"
              style={{
                transform: `rotateY(${mousePosition.x}deg) rotateX(${-mousePosition.y}deg)`,
                transition: "transform 0.3s ease-out"
              }}
            >
              <div className="relative w-full h-[600px]">
                {/* Main 3D Card */}
                <motion.div
                  className="absolute inset-0 rounded-3xl bg-gradient-to-br from-primary/20 via-violet-500/20 to-blue-500/20 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden"
                  style={{
                    transform: "translateZ(50px)",
                    transformStyle: "preserve-3d"
                  }}
                  animate={{
                    boxShadow: [
                      "0 25px 50px -12px rgba(139, 92, 246, 0.25)",
                      "0 25px 50px -12px rgba(59, 130, 246, 0.25)",
                      "0 25px 50px -12px rgba(139, 92, 246, 0.25)",
                    ]
                  }}
                  transition={{ duration: 3, repeat: Infinity }}
                >
                  {/* Floating Icons */}
                  {[
                    { Icon: Globe, delay: 0, x: "15%", y: "15%", rotate: 15 },
                    { Icon: Shield, delay: 0.5, x: "75%", y: "12%", rotate: -10 },
                    { Icon: Smile, delay: 1, x: "12%", y: "75%", rotate: 20 },
                    { Icon: Sparkles, delay: 1.5, x: "78%", y: "78%", rotate: -15 },
                    { Icon: MessageSquare, delay: 0.8, x: "50%", y: "10%", rotate: 5 },
                    { Icon: Star, delay: 1.2, x: "85%", y: "45%", rotate: -20 },
                  ].map((item, i) => (
                    <motion.div
                      key={i}
                      className="absolute"
                      style={{
                        left: item.x,
                        top: item.y,
                        transform: `translateZ(${100 + i * 15}px) rotate(${item.rotate}deg)`
                      }}
                      animate={{
                        y: [0, -20, 0],
                        rotate: [item.rotate, item.rotate + 10, item.rotate],
                      }}
                      transition={{
                        duration: 3 + i * 0.5,
                        repeat: Infinity,
                        delay: item.delay
                      }}
                    >
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/40 to-violet-500/40 backdrop-blur-sm border border-white/20 flex items-center justify-center shadow-xl">
                        <item.Icon className="w-7 h-7 text-white" />
                      </div>
                    </motion.div>
                  ))}

                  {/* Center Video Icon */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <motion.div
                      animate={{
                        scale: [1, 1.1, 1],
                        rotate: [0, 5, 0, -5, 0],
                      }}
                      transition={{ duration: 4, repeat: Infinity }}
                      className="w-32 h-32 rounded-full bg-gradient-to-br from-primary to-violet-500 flex items-center justify-center shadow-2xl"
                      style={{ transform: "translateZ(100px)" }}
                    >
                      <Video className="w-16 h-16 text-white" />
                    </motion.div>
                  </div>

                  {/* Particles */}
                  {Array.from({ length: 30 }).map((_, i) => (
                    <motion.div
                      key={i}
                      className="absolute w-2 h-2 rounded-full bg-primary/40"
                      style={{
                        left: `${Math.random() * 100}%`,
                        top: `${Math.random() * 100}%`,
                      }}
                      animate={{
                        y: [0, -30, 0],
                        opacity: [0.2, 0.8, 0.2],
                      }}
                      transition={{
                        duration: 2 + Math.random() * 2,
                        repeat: Infinity,
                        delay: Math.random() * 2,
                      }}
                    />
                  ))}
                </motion.div>

                {/* Background Glow */}
                <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-violet-500/20 blur-3xl -z-10 animate-pulse" />
              </div>
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* Use Cases - New Section */}
      <section className="py-20 px-6 relative">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl font-bold mb-4">Perfect For Every Team</h2>
            <p className="text-lg text-muted-foreground">Trusted by professionals across industries</p>
          </motion.div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {useCases.map((useCase, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                whileHover={{ y: -10, scale: 1.05 }}
                className="relative group"
              >
                <div className="p-6 rounded-2xl bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-white/10 text-center">
                  <motion.div
                    className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gradient-to-br from-primary to-violet-500 flex items-center justify-center shadow-lg"
                    whileHover={{ rotate: 360 }}
                    transition={{ duration: 0.6 }}
                  >
                    <useCase.icon className="w-8 h-8 text-white" />
                  </motion.div>
                  <h3 className="font-bold mb-2">{useCase.title}</h3>
                  <p className="text-sm text-muted-foreground">{useCase.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Interactive Demo Section - New */}
      <section id="demo" className="py-32 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-violet-500/5 to-blue-500/5" />

        <motion.div
          style={{ y: y3 }}
          className="max-w-7xl mx-auto relative z-10"
        >
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-20"
          >
            <h2 className="text-5xl font-bold mb-6">
              See AI Meet <span className="bg-gradient-to-r from-primary via-violet-500 to-blue-500 bg-clip-text text-transparent">In Action</span>
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Watch how our AI-powered features transform your video calling experience
            </p>
          </motion.div>

          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Demo Preview */}
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="relative"
            >
              <div className="relative aspect-video rounded-3xl overflow-hidden border-2 border-white/10 shadow-2xl">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-violet-500/30 to-blue-500/30 backdrop-blur-sm" />

                {/* Simulated UI */}
                <div className="relative h-full p-6 flex flex-col">
                  <div className="flex gap-3 mb-4">
                    {[1, 2, 3].map((i) => (
                      <motion.div
                        key={i}
                        className="flex-1 aspect-video rounded-xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10 flex items-center justify-center"
                        animate={{ scale: [1, 1.05, 1] }}
                        transition={{ duration: 2, delay: i * 0.3, repeat: Infinity }}
                      >
                        <Camera className="w-8 h-8 text-white/50" />
                      </motion.div>
                    ))}
                  </div>

                  {/* Simulated active feature display */}
                  <div className="flex-1 flex items-center justify-center">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={activeFeature}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="text-center"
                      >
                        {(() => {
                          const ActiveIcon = features[activeFeature].icon;
                          return (
                            <>
                              <div className={`w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-r ${features[activeFeature].color} flex items-center justify-center shadow-xl`}>
                                <ActiveIcon className="w-10 h-10 text-white" />
                              </div>
                              <h3 className="text-2xl font-bold text-white mb-2">{features[activeFeature].title}</h3>
                              <p className="text-white/80 text-sm">{features[activeFeature].description}</p>
                            </>
                          );
                        })()}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>

                {/* Corner Accent */}
                <div className="absolute top-4 right-4">
                  <div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center shadow-lg shadow-green-500/50">
                    <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  </div>
                </div>
              </div>

              {/* Floating Indicator */}
              <motion.div
                className="absolute -bottom-6 -right-6 px-6 py-3 rounded-full bg-card border-2 border-primary shadow-xl"
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-sm font-medium">Live Demo</span>
                </div>
              </motion.div>
            </motion.div>

            {/* Feature List */}
            <motion.div
              initial={{ opacity: 0, x: 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="space-y-4"
            >
              {features.map((feature, i) => (
                <motion.div
                  key={i}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${activeFeature === i
                    ? "bg-card/80 border-primary shadow-lg shadow-primary/10"
                    : "border-white/10 hover:border-white/20"
                    }`}
                  onClick={() => setActiveFeature(i)}
                  whileHover={{ x: 10 }}
                >
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-r ${feature.color} flex items-center justify-center flex-shrink-0`}>
                      <feature.icon className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-bold mb-1">{feature.title}</h4>
                      <p className="text-sm text-muted-foreground">{feature.description}</p>
                    </div>
                    <CheckCircle2 className={`w-5 h-5 flex-shrink-0 ${activeFeature === i ? "text-primary" : "text-muted-foreground/30"}`} />
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* Features Section with 3D Cards */}
      <section id="features" className="py-32 px-6 relative">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-20"
          >
            <h2 className="text-5xl font-bold mb-6">
              Powered by{" "}
              <span className="bg-gradient-to-r from-primary via-violet-500 to-blue-500 bg-clip-text text-transparent">
                Advanced AI
              </span>
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Discover intelligent features that transform your video calling experience
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 50 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ y: -10, scale: 1.02 }}
                className="group relative"
              >
                <div className={`absolute -inset-1 bg-gradient-to-r ${feature.color} opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-500 rounded-2xl`} />
                <div className="relative p-8 rounded-2xl bg-card/80 backdrop-blur-sm border border-white/10 h-full hover:border-white/20 transition-colors">
                  <motion.div
                    className={`w-16 h-16 rounded-xl bg-gradient-to-r ${feature.color} flex items-center justify-center mb-6 shadow-lg`}
                    whileHover={{ rotate: 360 }}
                    transition={{ duration: 0.6 }}
                  >
                    <feature.icon className="w-8 h-8 text-white" />
                  </motion.div>
                  <h3 className="text-2xl font-bold mb-3">{feature.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{feature.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials - New 3D Cards */}
      <section id="testimonials" className="py-32 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-violet-500/5 to-transparent" />

        <motion.div
          style={{ y: y2 }}
          className="max-w-7xl mx-auto relative z-10"
        >
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-20"
          >
            <h2 className="text-5xl font-bold mb-6">Loved by Teams Worldwide</h2>
            <p className="text-xl text-muted-foreground">See what our users say about AI Meet</p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {testimonials.map((testimonial, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 50, rotateY: -15 }}
                whileInView={{ opacity: 1, y: 0, rotateY: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15 }}
                whileHover={{ y: -15, rotateY: 5, scale: 1.05 }}
                className="group relative"
                style={{ transformStyle: "preserve-3d" }}
              >
                <div className="absolute -inset-1 bg-gradient-to-r from-primary to-violet-500 opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-500 rounded-2xl" />
                <div className="relative p-8 rounded-2xl bg-card border border-white/10 group-hover:border-white/20 transition-colors">
                  <div className="flex gap-1 mb-4">
                    {Array.from({ length: testimonial.rating }).map((_, j) => (
                      <Star key={j} className="w-5 h-5 fill-yellow-500 text-yellow-500" />
                    ))}
                  </div>
                  <p className="text-lg mb-6 leading-relaxed">"{testimonial.text}"</p>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-violet-500 flex items-center justify-center text-white font-bold">
                      {testimonial.name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-bold">{testimonial.name}</div>
                      <div className="text-sm text-muted-foreground">{testimonial.role} at {testimonial.company}</div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Interactive Game Section - NEW */}
      <section className="py-32 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-violet-500/10 to-blue-500/10" />

        <div className="max-w-6xl mx-auto relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-5xl font-bold mb-6">
              Try Our{" "}
              <span className="bg-gradient-to-r from-primary via-violet-500 to-blue-500 bg-clip-text text-transparent">
                Feature Catch Game!
              </span>
            </h2>
            <p className="text-xl text-muted-foreground">Click the icons as fast as you can before time runs out!</p>
          </motion.div>

          {!gameActive ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center"
            >
              <div className="max-w-md mx-auto p-8 rounded-3xl bg-card/80 backdrop-blur-sm border border-white/10 mb-8">
                <div className="mb-6">
                  <div className="text-6xl font-bold bg-gradient-to-r from-primary to-violet-500 bg-clip-text text-transparent mb-2">
                    {highScore}
                  </div>
                  <div className="text-sm text-muted-foreground">High Score</div>
                </div>
                <Button
                  onClick={startGame}
                  size="lg"
                  className="px-10 h-14 text-lg gap-3 shadow-xl shadow-primary/30"
                >
                  <Play className="w-5 h-5" fill="currentColor" />
                  Start Game
                </Button>
              </div>

              <div className="text-sm text-muted-foreground">
                💡 Tip: Click the floating AI feature icons to score points. Each icon is worth 10 points!
              </div>
            </motion.div>
          ) : (
            <div className="relative">
              {/* Game HUD */}
              <div className="flex justify-between items-center mb-8">
                <div className="flex gap-6">
                  <div className="px-6 py-3 rounded-full bg-card border-2 border-primary">
                    <div className="flex items-center gap-2">
                      <Star className="w-5 h-5 text-yellow-500" fill="currentColor" />
                      <span className="text-2xl font-bold">{score}</span>
                    </div>
                  </div>
                  <div className="px-6 py-3 rounded-full bg-card border-2 border-violet-500">
                    <div className="flex items-center gap-2">
                      <div className="text-2xl font-bold">{timeLeft}s</div>
                    </div>
                  </div>
                </div>
                <Button
                  onClick={endGame}
                  variant="outline"
                  size="sm"
                >
                  End Game
                </Button>
              </div>

              {/* Game Area */}
              <div className="relative aspect-video rounded-3xl bg-card/50 backdrop-blur-sm border-2 border-white/10 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-violet-500/5 to-blue-500/5" />

                {/* Grid Background */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:2rem_2rem]" />

                {/* Floating Icons */}
                <AnimatePresence>
                  {gameIcons.map((iconData) => {
                    const IconComponent = iconData.icon;
                    return (
                      <motion.button
                        key={iconData.id}
                        initial={{ scale: 0, rotate: -180 }}
                        animate={{ scale: 1, rotate: 0 }}
                        exit={{ scale: 0, rotate: 180 }}
                        whileHover={{ scale: 1.2 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => catchIcon(iconData.id)}
                        className={`absolute w-16 h-16 rounded-2xl bg-gradient-to-br ${iconData.color} flex items-center justify-center shadow-2xl cursor-pointer hover:shadow-primary/50 transition-shadow`}
                        style={{
                          left: `${iconData.x}%`,
                          top: `${iconData.y}%`,
                        }}
                      >
                        <IconComponent className="w-8 h-8 text-white" />
                      </motion.button>
                    );
                  })}
                </AnimatePresence>

                {/* Center Message when no icons */}
                {gameIcons.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-muted-foreground">Click fast!</div>
                  </div>
                )}
              </div>

              {/* Progress Bar */}
              <div className="mt-6">
                <div className="h-2 bg-card rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-primary to-violet-500"
                    initial={{ width: "100%" }}
                    animate={{ width: `${(timeLeft / 30) * 100}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-32 px-6 relative">
        <motion.div
          style={{ y: y2 }}
          className="max-w-6xl mx-auto"
        >
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-20"
          >
            <h2 className="text-5xl font-bold mb-6">Get Started in Seconds</h2>
            <p className="text-xl text-muted-foreground">Simple steps to begin your AI-powered meetings</p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-12 relative">
            <div className="hidden md:block absolute top-1/2 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent -translate-y-1/2" />

            {[
              { step: "01", title: "Sign Up", desc: "Create your account with email or facial recognition", icon: Lock },
              { step: "02", title: "Start or Join", desc: "Create a new call or join using a room ID", icon: Video },
              { step: "03", title: "Connect", desc: "Enjoy AI-powered video calls with smart features", icon: Sparkles }
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 50 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.2 }}
                className="relative"
              >
                <motion.div
                  whileHover={{ scale: 1.05, rotateY: 10 }}
                  className="relative z-10 text-center group"
                  style={{ transformStyle: "preserve-3d" }}
                >
                  <div className="relative mx-auto mb-8">
                    <motion.div
                      className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary to-violet-500 flex items-center justify-center mx-auto shadow-2xl shadow-primary/30 relative z-10"
                      animate={{
                        boxShadow: [
                          "0 20px 40px -10px rgba(139, 92, 246, 0.3)",
                          "0 20px 40px -10px rgba(59, 130, 246, 0.3)",
                          "0 20px 40px -10px rgba(139, 92, 246, 0.3)",
                        ]
                      }}
                      transition={{ duration: 3, repeat: Infinity }}
                      style={{ transform: "translateZ(30px)" }}
                    >
                      <item.icon className="w-12 h-12 text-white" />
                    </motion.div>
                    <div className="absolute -top-2 -right-2 w-12 h-12 rounded-lg bg-background border-2 border-primary flex items-center justify-center text-primary font-bold z-20">
                      {item.step}
                    </div>
                  </div>
                  <h3 className="text-2xl font-bold mb-3">{item.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{item.desc}</p>
                </motion.div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* CTA Section */}
      <section className="py-32 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-violet-500/20 to-blue-500/20" />
        <motion.div
          style={{ y: y1 }}
          className="max-w-5xl mx-auto text-center relative z-10"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
          >
            <h2 className="text-6xl font-bold mb-6">
              Ready to Transform <br />
              <span className="bg-gradient-to-r from-primary via-violet-500 to-blue-500 bg-clip-text text-transparent">
                Your Calls?
              </span>
            </h2>
            <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
              Join thousands using AI to make video calls smarter and more productive.
            </p>
            <Link href="/login">
              <Button size="lg" className="px-10 h-16 text-lg gap-3 shadow-2xl shadow-primary/30">
                Get Started Free
                <ArrowRight className="w-5 h-5" />
              </Button>
            </Link>
          </motion.div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="py-16 px-6 border-t border-white/10 relative z-10">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <LogoMark className="h-8 w-8" />
              <span className="text-xl font-bold">AI Meet</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © 2025 AI Meet. Transforming video communication with AI.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

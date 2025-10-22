import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Video, Sparkles, Users, Shield, BarChart3, Zap } from "lucide-react";
import heroImage from "@assets/generated_images/AI_video_call_hero_illustration_778de1ae.png";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Landing() {
  const features = [
    {
      icon: Sparkles,
      title: "AI Emotion Detection",
      description: "Real-time emotion analysis to understand participant engagement and sentiment during calls."
    },
    {
      icon: Shield,
      title: "Facial Recognition",
      description: "Secure authentication and attendance tracking using advanced facial recognition technology."
    },
    {
      icon: Users,
      title: "Smart Collaboration",
      description: "Seamless video calls with up to 6 participants, screen sharing, and intelligent backgrounds."
    },
    {
      icon: BarChart3,
      title: "Call Analytics",
      description: "Detailed post-call summaries with emotion stats, attendance reports, and engagement metrics."
    },
    {
      icon: Zap,
      title: "Instant Filters",
      description: "Apply AI-powered filters and background blur in real-time for professional appearance."
    },
    {
      icon: Video,
      title: "HD Quality",
      description: "Crystal-clear video and audio with adaptive quality for smooth calling experience."
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-lg bg-background/80 border-b">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Video className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-semibold">AI Meet</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm font-medium hover-elevate px-3 py-2 rounded-lg" data-testid="link-features">Features</a>
            <a href="#how-it-works" className="text-sm font-medium hover-elevate px-3 py-2 rounded-lg" data-testid="link-how-it-works">How It Works</a>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost" data-testid="button-login">Login</Button>
            </Link>
            <Link href="/login">
              <Button data-testid="button-signup">Sign Up</Button>
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </nav>

      <section className="pt-32 pb-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
                <Sparkles className="w-4 h-4" />
                AI-Powered Video Calling
              </div>
              <h1 className="text-5xl lg:text-6xl font-bold mb-6">
                Connect Smarter.<br />Call Smarter.<br />
                <span className="text-primary">With AI.</span>
              </h1>
              <p className="text-lg text-muted-foreground mb-8">
                Experience the future of video communication with intelligent features like emotion detection, 
                facial recognition, and smart attendance tracking.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link href="/dashboard">
                  <Button size="lg" className="px-8" data-testid="button-start-call">
                    <Video className="w-5 h-5 mr-2" />
                    Start Video Call
                  </Button>
                </Link>
                <Link href="/dashboard">
                  <Button size="lg" variant="outline" className="px-8" data-testid="button-join-room">
                    Join Room
                  </Button>
                </Link>
              </div>
            </div>
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-chart-2/20 blur-3xl" />
              <img 
                src={heroImage} 
                alt="AI-powered video calling interface" 
                className="relative rounded-2xl w-full"
              />
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="py-20 px-6 bg-card/50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4">Powered by Advanced AI</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Discover intelligent features that transform your video calling experience
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <div 
                key={index} 
                className="p-6 rounded-xl bg-card border hover-elevate" 
                data-testid={`card-feature-${index}`}
              >
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                <p className="text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="py-20 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-4xl font-bold mb-12">Get Started in Seconds</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: "1", title: "Sign Up", desc: "Create your account with email or facial recognition" },
              { step: "2", title: "Start or Join", desc: "Create a new call or join using a room ID" },
              { step: "3", title: "Connect", desc: "Enjoy AI-powered video calls with smart features" }
            ].map((item) => (
              <div key={item.step} className="text-center" data-testid={`step-${item.step}`}>
                <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground text-2xl font-bold flex items-center justify-center mx-auto mb-4">
                  {item.step}
                </div>
                <h3 className="text-xl font-semibold mb-2">{item.title}</h3>
                <p className="text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-6 bg-gradient-to-r from-primary to-chart-2">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-bold text-primary-foreground mb-4">
            Ready to Transform Your Calls?
          </h2>
          <p className="text-lg text-primary-foreground/90 mb-8">
            Join thousands using AI to make video calls smarter and more productive.
          </p>
          <Link href="/login">
            <Button size="lg" variant="secondary" className="px-8" data-testid="button-get-started">
              Get Started Free
            </Button>
          </Link>
        </div>
      </section>

      <footer className="py-12 px-6 border-t">
        <div className="max-w-7xl mx-auto text-center text-sm text-muted-foreground">
          <p>© 2025 AI Meet. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

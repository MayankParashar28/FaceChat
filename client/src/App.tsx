import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/lib/auth";
import ProtectedRoute from "@/components/ProtectedRoute";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import EmailVerification from "@/pages/EmailVerification";
import Dashboard from "@/pages/Dashboard";
import Chats from "@/pages/Chats";
import { lazy, Suspense } from "react";
import VideoCall from "@/pages/VideoCall";
// Lazy load VideoCall for better initial load performance
// const VideoCall = lazy(() => import("@/pages/VideoCall"));
import CallSummary from "@/pages/CallSummary";
import Settings from "@/pages/Settings";
import Profile from "@/pages/Profile";
import Analytics from "@/pages/Analytics";
import Meetings from "@/pages/Meetings";
import VerifyEmail from "@/pages/EmailVerification";
import NotFound from "@/pages/not-found";
import Layout from "@/components/Layout";
import { ServerStatus } from "@/components/ServerStatus";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/login" component={Login} />
      <Route path="/verify-email" component={EmailVerification} />

      <Route path="/dashboard">
        <ProtectedRoute>
          <Layout>
            <Dashboard />
          </Layout>
        </ProtectedRoute>
      </Route>

      <Route path="/chats">
        <ProtectedRoute>
          <Layout>
            <Chats />
          </Layout>
        </ProtectedRoute>
      </Route>

      <Route path="/call/:roomId">
        <ProtectedRoute>
          <VideoCall />
        </ProtectedRoute>
      </Route>

      <Route path="/summary/:callId">
        <ProtectedRoute>
          <Layout>
            <CallSummary />
          </Layout>
        </ProtectedRoute>
      </Route>

      <Route path="/settings">
        <ProtectedRoute>
          <Layout>
            <Settings />
          </Layout>
        </ProtectedRoute>
      </Route>

      <Route path="/profile">
        <ProtectedRoute>
          <Layout>
            <Profile />
          </Layout>
        </ProtectedRoute>
      </Route>

      <Route path="/analytics">
        <ProtectedRoute>
          <Layout>
            <Analytics />
          </Layout>
        </ProtectedRoute>
      </Route>

      <Route path="/meetings">
        <ProtectedRoute>
          <Layout>
            <Meetings />
          </Layout>
        </ProtectedRoute>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <ServerStatus />
            <Router />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;

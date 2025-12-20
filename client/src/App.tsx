import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/lib/auth";
import ProtectedRoute from "@/components/ProtectedRoute";
import { lazy, Suspense } from "react";
import { ServerStatus } from "@/components/ServerStatus";
import { Loader2 } from "lucide-react";

// Lazy load pages for better performance
const Landing = lazy(() => import("@/pages/Landing"));
const Login = lazy(() => import("@/pages/Login"));
const EmailVerification = lazy(() => import("@/pages/EmailVerification"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Chats = lazy(() => import("@/pages/Chats"));
const VideoCall = lazy(() => import("@/pages/VideoCall"));
const CallSummary = lazy(() => import("@/pages/CallSummary"));
const Settings = lazy(() => import("@/pages/Settings"));
const Profile = lazy(() => import("@/pages/Profile"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const Meetings = lazy(() => import("@/pages/Meetings"));
const NotFound = lazy(() => import("@/pages/not-found"));
const Layout = lazy(() => import("@/components/Layout"));

import { PageSkeleton } from "@/components/PageSkeleton";

// Loading fallback component
// const PageLoader = () => (
//   <div className="flex h-screen w-full items-center justify-center bg-background text-primary">
//     <Loader2 className="h-10 w-10 animate-spin" />
//   </div>
// );

function Router() {
  return (
    <Suspense fallback={<PageSkeleton />}>
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
    </Suspense>
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

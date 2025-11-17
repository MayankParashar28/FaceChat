import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useEffect } from "react";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && !user) {
      // Redirect to login if not authenticated
      setLocation("/login");
    } else if (!loading && user && !user.isEmailVerified && !user.emailVerified) {
      // Redirect to email verification if email is not verified
      const email = user.email || "";
      setLocation(`/verify-email?email=${encodeURIComponent(email)}`);
    }
  }, [user, loading, setLocation]);

  // Show loading spinner while checking authentication
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Show nothing while redirecting
  if (!user) {
    return null;
  }

  // Redirect if email not verified (handled in useEffect, but check again here)
  if (!user.isEmailVerified && !user.emailVerified) {
    return null;
  }

  // Render the protected content
  return <>{children}</>;
}

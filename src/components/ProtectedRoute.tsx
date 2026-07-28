import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Spinner } from "./ui/Spinner";
import { Button } from "./ui/Button";
import type { UserRole } from "../types/database";

interface ProtectedRouteProps {
  allowedRoles: UserRole[];
  children: ReactNode;
}

/**
 * This is a client-side convenience layer only — it makes the app
 * redirect smoothly instead of flashing the wrong dashboard. The
 * REAL security boundary is Row Level Security on the database
 * tables themselves. Never rely on this component alone to protect
 * sensitive data; RLS policies must independently enforce the same
 * rules server-side, since a determined user could otherwise bypass
 * client-side checks entirely.
 */
export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const { session, profile, loading, signOut } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size={32} />
      </div>
    );
  }

  if (!session || !profile) {
    return <Navigate to="/login" replace />;
  }

  if (profile.is_active === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy-25 px-4">
        <div className="bg-white rounded-2xl shadow-lg border border-red-100 p-8 max-w-sm w-full text-center flex flex-col gap-4">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto text-2xl">
            🚫
          </div>
          <div>
            <h2 className="text-lg font-semibold text-navy-700 mb-1">Account Deactivated</h2>
            <p className="text-sm text-navy-400">
              Your account has been deactivated. Please contact your administrator to regain access.
            </p>
          </div>
          <Button variant="ghost" onClick={signOut} className="w-full">
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  if (!allowedRoles.includes(profile.role)) {
    if (profile.role === "admin") return <Navigate to="/admin" replace />;
    if (profile.role === "teacher" || profile.role === "performance_coach") {
      return <Navigate to="/teacher" replace />;
    }
    if (profile.role === "student") return <Navigate to="/student" replace />;
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/Button";
import { TextInput } from "../components/ui/Input";
import { Card } from "../components/ui/Card";

export default function LoginPage() {
  const { signInWithUsername, session, profile, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    searchParams.get("reason") === "session_expired"
      ? "Your session has expired. Please sign in again."
      : null
  );
  const [submitting, setSubmitting] = useState(false);

  // Already logged in — redirect straight to the right dashboard
  // based on role. No manual "choose dashboard" step, by design:
  // role-based access means the system decides, not the person.
  if (!loading && session && profile) {
    if (profile.role === "admin") return <Navigate to="/admin" replace />;
    if (
      profile.role === "teacher" ||
      profile.role === "performance_coach" ||
      profile.role === "college_counselor"
    ) {
      return <Navigate to="/teacher" replace />;
    }
    if (profile.role === "student") return <Navigate to="/student" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await signInWithUsername(username, password);
    setSubmitting(false);
    if (error) setError(error);
  }

  return (
    <div className="min-h-screen flex bg-white">
      {/* Left: brand panel, matching the site's gradient signature */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-navy-700 via-navy-600 to-sky-300 items-center justify-center px-12">
        <div className="relative z-10 max-w-md text-white">
          <img src="/ascend-now.png" alt="AscendNow" className="h-10 w-auto mb-4" />
          <h1 className="mt-8 text-4xl font-extrabold leading-tight">
            Welcome back to your dashboard.
          </h1>
          <p className="mt-4 text-navy-100 text-lg">
            Manage sessions, teachers, and programs — all in one place.
          </p>
        </div>
        {/* decorative shapes, echoing the hero graphic's circles */}
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-lime-300/30" />
        <div className="absolute bottom-10 left-10 w-24 h-24 rounded-full bg-sky-200/30" />
        <div className="absolute top-1/3 right-1/4 w-10 h-10 rounded-full bg-lime-300/50" />
      </div>

      {/* Right: login form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <Card className="w-full max-w-sm p-8">
          <div className="lg:hidden mb-8 flex justify-center">
            <div className="bg-white border border-navy-100 rounded-2xl overflow-hidden inline-flex items-center px-3 py-1.5 shadow-sm">
              <img src="/logo.png" alt="AscendNow" className="h-9 w-auto" />
            </div>
          </div>

          <h2 className="text-xl font-bold text-navy-700">Sign in</h2>
          <p className="text-sm text-navy-300 mt-1 mb-6">
            Enter your username and password to continue.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <TextInput
              label="Username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. rana.m"
              required
              autoComplete="username"
            />
            <TextInput
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <Button type="submit" className="mt-2 w-full" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="text-xs text-navy-300 mt-6 text-center">
            Accounts are created by an administrator. Contact your admin if you need access.
          </p>
        </Card>
      </div>
    </div>
  );
}

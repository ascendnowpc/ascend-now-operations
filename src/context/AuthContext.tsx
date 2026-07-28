import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import { invokeEdgeFunction, describeFunctionError } from "../lib/edgeFunctions";
import type { AppUser } from "../types/database";

interface AuthContextValue {
  session: Session | null;
  profile: AppUser | null;
  loading: boolean;
  signInWithUsername: (username: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  updateUsername: (newUsername: string) => Promise<{ error: string | null }>;
  updateFullName: (newFullName: string) => Promise<{ error: string | null }>;
  updateEmail: (newEmail: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  // The id of the user we currently have loaded. Used to ignore the redundant
  // auth events Supabase fires on every tab focus / token refresh (see below).
  const currentUserIdRef = useRef<string | null>(null);

  // Whenever we have a logged-in session, fetch the matching row from
  // public.users — this is where role lives, which drives every
  // redirect and permission check in the app.
  async function loadProfile(userId: string) {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("[auth] Failed to load user profile:", error.message);
      setProfile(null);
      return;
    }

    setProfile(data as AppUser);
  }

  useEffect(() => {
    // On first load, check if there's already an active session
    // (e.g. the person refreshed the page while logged in).
    supabase.auth.getSession().then(({ data: { session } }) => {
      currentUserIdRef.current = session?.user?.id ?? null;
      setSession(session);
      if (session?.user) {
        loadProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // Keep session + profile in sync whenever the logged-in user actually
    // changes (real login / logout).
    //
    // Supabase also fires onAuthStateChange with SIGNED_IN / TOKEN_REFRESHED
    // every time the tab regains focus or the access token silently refreshes.
    // Blindly calling setSession + loadProfile on those events re-rendered the
    // whole tree and refetched the current page for the *same* user, which made
    // long pages (e.g. the Coordinator's Log form) appear to reload and jump
    // back to the top whenever you switched tabs. We only own session.user.id
    // for gating here — the token itself is managed internally by the supabase
    // client — so ignore any event where the user hasn't changed.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      const newUserId = newSession?.user?.id ?? null;
      if (newUserId === currentUserIdRef.current) return;
      currentUserIdRef.current = newUserId;
      setSession(newSession);
      if (newSession?.user) {
        loadProfile(newSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  // The login form collects a username (not email), per the design
  // decision that people log in with a username while Supabase Auth
  // still verifies against the underlying email + password. So we
  // look up the matching email first, then hand off to Supabase.
  async function signInWithUsername(username: string, password: string) {
    const { data: email, error: lookupError } = await supabase.rpc(
      "get_email_for_username",
      { p_username: username }
    );

    if (lookupError || !email) {
      return { error: "We couldn't find an account with that username." };
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      return { error: "Incorrect username or password." };
    }

    // Block deactivated accounts from logging in
    const { data: { session: newSession } } = await supabase.auth.getSession();
    if (newSession?.user) {
      const { data: userRow } = await supabase
        .from("users")
        .select("is_active")
        .eq("id", newSession.user.id)
        .single();
      if (userRow && !userRow.is_active) {
        await supabase.auth.signOut();
        return { error: "Your account has been deactivated. Please contact an administrator." };
      }
    }

    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function updateUsername(newUsername: string) {
    if (!session?.user) return { error: "Not authenticated." };
    const { data, error } = await supabase
      .from("users")
      .update({ username: newUsername })
      .eq("id", session.user.id)
      .select()
      .single();
    if (error) return { error: error.message };
    if (data) setProfile((prev) => (prev ? { ...prev, username: newUsername } : null));
    return { error: null };
  }

  // Updates the display name on the user's own public.users row. Admins have
  // no separate profile table (the `admins` row is just a marker), so their
  // name lives here in `users.full_name`. RLS lets an admin write their own
  // users row, and the prevent_self_privilege_escalation trigger only blocks
  // role/is_active changes, so a plain full_name update is allowed.
  async function updateFullName(newFullName: string) {
    if (!session?.user) return { error: "Not authenticated." };
    const { data, error } = await supabase
      .from("users")
      .update({ full_name: newFullName })
      .eq("id", session.user.id)
      .select()
      .single();
    if (error) return { error: error.message };
    if (data) setProfile((prev) => (prev ? { ...prev, full_name: newFullName } : null));
    return { error: null };
  }

  // Changes the user's email everywhere it lives — `auth.users.email` (the
  // real login credential + password-reset destination), `public.users.email`
  // (what `get_email_for_username` resolves for username-based login and the
  // sidebar identity badge), and `teachers.email` (contact info) — via the
  // `update-user-email` edge function, which does all three with service-role
  // in one shot. This MUST keep the auth email in sync: login resolves
  // username -> email and signs in with it, so if only `public.users.email`
  // changed (as this used to do), the resolver would hand Auth an address it
  // no longer recognises and lock the account out. Doing it directly from the
  // client isn't possible — the browser can't set the Auth email without
  // Supabase's confirmation round-trip, so the edge function (service-role,
  // `email_confirm: true`) owns the change.
  async function updateEmail(newEmail: string) {
    if (!session?.user) return { error: "Not authenticated." };
    const { data, error } = await invokeEdgeFunction("update-user-email", {
      body: { newEmail },
    });
    if (error) return { error: await describeFunctionError(error) };
    if (data?.error) return { error: data.error };
    setProfile((prev) => (prev ? { ...prev, email: newEmail } : null));
    return { error: null };
  }

  async function updatePassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error?.message ?? null };
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, signInWithUsername, signOut, updateUsername, updateFullName, updateEmail, updatePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

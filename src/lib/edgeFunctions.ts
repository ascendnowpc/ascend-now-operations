import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

// supabase-js only gives a generic "non-2xx status code" message on
// FunctionsHttpError — the actual `{ error: "..." }` body our edge functions
// return has to be read off the raw Response in `error.context`.
export async function describeFunctionError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.clone().json();
      if (body?.error) return body.error as string;
    } catch {
      // context wasn't JSON (e.g. a raw 404/502 from the gateway, not our function)
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof FunctionsHttpError && error.context.status === 401;
}

// A local access token can look valid (not yet expired) while the
// server-side session behind it has already been invalidated — e.g. the
// same account signed in elsewhere, or a revoked session. Plain table reads
// don't notice (PostgREST only checks the JWT signature/expiry), but our
// edge functions re-verify the caller via auth.getUser(), which also checks
// session liveness and 401s in that case. Refreshing mints a fresh token
// bound to a live session; only if that also fails is the refresh token
// itself dead, meaning there's nothing left to do but force a clean re-login.
async function recoverExpiredSession(): Promise<boolean> {
  const { data, error } = await supabase.auth.refreshSession();
  return !error && !!data.session;
}

// Drop-in replacement for `supabase.functions.invoke`: same call signature
// and return shape, so existing callers can swap it in unchanged. On a 401 it
// refreshes the session and retries once before giving up, and if the
// session truly can't be revived, signs out and sends the user back to the
// login page instead of leaving them staring at a bare "Unauthorized" error.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors supabase.functions.invoke's own `T = any` default, so untyped call sites keep behaving exactly as before
export async function invokeEdgeFunction<T = any>(
  name: string,
  options?: Parameters<typeof supabase.functions.invoke<T>>[1]
): ReturnType<typeof supabase.functions.invoke<T>> {
  const first = await supabase.functions.invoke<T>(name, options);
  if (!isUnauthorized(first.error)) return first;

  if (await recoverExpiredSession()) {
    const retry = await supabase.functions.invoke<T>(name, options);
    if (!isUnauthorized(retry.error)) return retry;
  }

  await supabase.auth.signOut();
  window.location.assign("/login?reason=session_expired");
  return first;
}

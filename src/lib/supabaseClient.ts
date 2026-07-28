import { createClient } from "@supabase/supabase-js";

// These come from Vercel environment variables (or a local .env file
// during development). Nothing is hardcoded here — drop your project
// URL and anon/public key into the env vars below and this just works.
//
// Required env vars:
//   VITE_SUPABASE_URL       — your Supabase project URL
//   VITE_SUPABASE_ANON_KEY  — your Supabase anon/public key
//
// Do NOT put the service_role key in frontend env vars — that key
// must only ever live server-side (e.g. in a Supabase Edge Function),
// since it bypasses Row Level Security entirely.

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Loud warning rather than a silent failure — easier to debug
  // a missing .env file than a blank screen with no explanation.
  console.warn(
    "[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
      "Add them to a .env file locally, or as environment variables in Vercel."
  );
}

export const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "");

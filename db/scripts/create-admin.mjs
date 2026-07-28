// =========================================================
// create-admin.mjs
// =========================================================
// Run with: node create-admin.mjs
//
// Creates a complete admin account: the login (auth.users), which
// automatically triggers the matching public.users row, then the
// admins row.
//
// REQUIRES the service_role key — never the anon key. The
// service_role key bypasses RLS entirely, so:
//   - Never put it in frontend code or a .env file that ships to
//     the browser (no VITE_ prefix, never in Vercel's frontend env).
//   - Only run this script locally or from a secure server context.
// =========================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "YOUR_SUPABASE_PROJECT_URL";
const SERVICE_ROLE_KEY = "YOUR_SERVICE_ROLE_KEY"; // from Supabase Dashboard > Settings > API

const ADMIN_EMAIL = "admin@yourcompany.com";
const ADMIN_PASSWORD = "ChangeThisToAStrongPassword123!";
const ADMIN_USERNAME = "admin";
const ADMIN_FULL_NAME = "Admin User";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  // Step 1: create the actual login account. This insert into
  // auth.users automatically fires the create_user_profile trigger,
  // which creates the matching public.users row with the role
  // passed in user_metadata below.
  const { data: userData, error: userError } = await supabase.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
    user_metadata: {
      username: ADMIN_USERNAME,
      full_name: ADMIN_FULL_NAME,
      role: "admin",
    },
  });

  if (userError) {
    console.error("Failed to create login account:", userError.message);
    return;
  }

  const newUserId = userData.user.id;
  console.log("Login account created:", newUserId);

  // Step 2: create the matching admins row.
  const { data: adminRow, error: adminError } = await supabase.rpc("create_admin_profile", {
    p_user_id: newUserId,
  });

  if (adminError) {
    console.error("Failed to create admins row:", adminError.message);
    return;
  }

  console.log("Admin profile created. admins.id =", adminRow);
  console.log("\nDone — you can now log in with:");
  console.log("  username:", ADMIN_USERNAME);
  console.log("  password:", ADMIN_PASSWORD);
}

main();

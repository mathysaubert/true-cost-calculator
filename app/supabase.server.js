import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  throw new Error(
    "Variables d'environnement manquantes : SUPABASE_URL et SUPABASE_SERVICE_KEY sont requis."
  );
}

// Server-side only client — uses the service key (bypasses RLS).
// Never import this file from client-side code.
export const supabase = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

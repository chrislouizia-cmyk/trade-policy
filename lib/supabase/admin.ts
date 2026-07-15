import 'server-only';
import { createClient } from '@supabase/supabase-js';

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const missing = [!url && 'Supabase URL', !serviceRoleKey && 'Supabase service role/secret key'].filter(Boolean);
  if (missing.length) {
    throw new Error(`Missing server configuration: ${missing.join(' and ')}. Add it to .env.local and restart npm run dev.`);
  }
  return createClient(url!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

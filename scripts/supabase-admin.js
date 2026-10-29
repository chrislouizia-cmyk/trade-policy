const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envFile = path.join(process.cwd(), '.env.local');
const raw = fs.readFileSync(envFile, 'utf8');
const env = {};
for (const line of raw.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx > -1) env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) {
    console.error('LIST_USERS_ERROR', error);
    process.exit(1);
  }
  for (const user of data.users.slice(0, 20)) {
    console.log(JSON.stringify({
      id: user.id,
      email: user.email,
      confirmed: Boolean(user.email_confirmed_at),
      created_at: user.created_at,
    }));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

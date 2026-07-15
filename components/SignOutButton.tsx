'use client';
import { createClient } from '@/lib/supabase/client';
export default function SignOutButton(){return <button onClick={async()=>{await createClient().auth.signOut();location.href='/login';}}>Sign out</button>}

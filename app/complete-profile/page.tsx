import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import CompleteProfileForm from '@/components/CompleteProfileForm';
export default async function CompleteProfilePage(){const s=await createClient();const {data:{user}}=await s.auth.getUser();if(!user)redirect('/client/login');const {data:profile}=await s.from('profiles').select('*').eq('id',user.id).maybeSingle();if(profile?.profile_completed)redirect('/');return <main className="login-shell"><CompleteProfileForm email={user.email??''} current={profile??{id:user.id}}/></main>}

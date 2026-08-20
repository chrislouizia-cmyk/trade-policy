import {redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import HQOnboardingForm from '@/components/hq/HQOnboardingForm';

export default async function Page(){
 const supabase=await createClient(),{data:{user}}=await supabase.auth.getUser();
 if(!user)redirect('/hq/login');
 const {data:identity,error}=await supabase.rpc('current_staff_invitation_onboarding_v1');
 if(error||!identity){const {data:route}=await supabase.rpc('staff_workspace_route');redirect(route?String(route):'/hq/login?error=access')}
 return <main className="auth-page hq-login-page"><section className="auth-card portal-auth-card"><img src="/brand/trade-police-mark.png" alt="Trade Police" className="brand-mark" width={42} height={42} /><span className="eyebrow">EMPLOYEE INVITATION</span><h1>Secure your HQ account</h1><p>Set your password to accept the invitation and activate your employee membership.</p><HQOnboardingForm identity={identity}/></section></main>;
}

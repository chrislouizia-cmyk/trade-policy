'use client';
import {FormEvent,useState} from 'react';
import {createClient} from '@/lib/supabase/client';

export default function HQOnboardingForm({identity}:{identity:{name:string;email:string;role:string}}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setMessage('');const form=new FormData(event.currentTarget),password=String(form.get('password')??''),confirm=String(form.get('confirm')??'');
  if(password.length<8){setMessage('Password must contain at least 8 characters.');setBusy(false);return}
  if(password!==confirm){setMessage('Passwords do not match.');setBusy(false);return}
  const {error}=await createClient().auth.updateUser({password});
  if(error){setMessage(error.message);setBusy(false);return}
  const response=await fetch('/api/hq/staff/onboarding',{method:'POST'}),result=await response.json();
  if(!response.ok){setMessage(result.error??'Employee onboarding could not be completed.');setBusy(false);return}
  window.location.replace(String(result.route||'/hq'));
 }
 return <form className="auth-form" onSubmit={submit}><div className="settings-list"><div className="event-row"><span>Name</span><strong>{identity.name}</strong></div><div className="event-row"><span>Email</span><strong>{identity.email}</strong></div><div className="event-row"><span>Role</span><strong>{identity.role.replaceAll('_',' ')}</strong></div></div><label>New password<input name="password" type="password" minLength={8} autoComplete="new-password" required/></label><label>Confirm password<input name="confirm" type="password" minLength={8} autoComplete="new-password" required/></label><button className="primary" disabled={busy}>{busy?'Activating account…':'Activate HQ account'}</button>{message&&<p className="error">{message}</p>}</form>;
}

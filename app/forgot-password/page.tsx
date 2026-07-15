'use client';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage(){
  const [message,setMessage]=useState('');
  const [loading,setLoading]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); setLoading(true); setMessage('');
    const fd=new FormData(e.currentTarget); const email=String(fd.get('email'));
    const supabase=createClient();
    const redirectTo=`${location.origin}/auth/callback?next=/reset-password`;
    const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo});
    setMessage(error?.message||'Recovery email sent. Open it on this device, then choose a new password.');
    setLoading(false);
  }
  return <main className="login-shell"><form className="card login-card" onSubmit={submit}><div className="brand">TRADE POLICE</div><h1>Recover password</h1><p className="muted">Enter the email used for your Trade Police account.</p><label>Email<input name="email" type="email" required/></label><button className="primary" disabled={loading}>{loading?'Sending…':'Send recovery email'}</button>{message&&<p className="warning">{message}</p>}<Link className="link-button" href="/login">Back to sign in</Link></form></main>
}

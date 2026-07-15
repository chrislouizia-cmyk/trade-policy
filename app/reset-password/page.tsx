'use client';
import { FormEvent, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function ResetPasswordPage(){
  const [message,setMessage]=useState('');
  const [loading,setLoading]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); setLoading(true); setMessage('');
    const fd=new FormData(e.currentTarget); const password=String(fd.get('password')); const confirm=String(fd.get('confirm'));
    if(password!==confirm){setMessage('Passwords do not match.');setLoading(false);return;}
    const supabase=createClient();
    const {error}=await supabase.auth.updateUser({password});
    if(error)setMessage(error.message); else {setMessage('Password updated. Redirecting…'); setTimeout(()=>location.href='/validate',800);}
    setLoading(false);
  }
  return <main className="login-shell"><form className="card login-card" onSubmit={submit}><div className="brand">TRADE POLICE</div><h1>Choose a new password</h1><p className="muted">Use at least 8 characters.</p><label>New password<input name="password" type="password" minLength={8} required/></label><label>Confirm password<input name="confirm" type="password" minLength={8} required/></label><button className="primary" disabled={loading}>{loading?'Saving…':'Update password'}</button>{message&&<p className="warning">{message}</p>}</form></main>
}

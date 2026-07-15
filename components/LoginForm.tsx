'use client';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function LoginForm({next}:{next:string}){
  const [mode,setMode]=useState<'login'|'signup'>('login');
  const [message,setMessage]=useState('');
  const [loading,setLoading]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setLoading(true);setMessage('');
    const fd=new FormData(e.currentTarget);const email=String(fd.get('email'));const password=String(fd.get('password'));
    const supabase=createClient();
    if(mode==='signup'){
      const {error}=await supabase.auth.signUp({email,password,options:{emailRedirectTo:`${location.origin}/auth/callback?next=${encodeURIComponent(next)}`}});
      setMessage(error?.message||'Account created. Check your email if confirmation is enabled.');
    }else{
      const {error}=await supabase.auth.signInWithPassword({email,password});
      if(error)setMessage(error.message);else location.href=next;
    }
    setLoading(false);
  }
  const hqLogin=next==='/hq';
  return <main className={`login-shell ${hqLogin?'hq-auth-shell':''}`}><form className="card login-card" onSubmit={submit}><div className="brand">{hqLogin?'TRADE POLICE HQ':'TRADE POLICE'}</div><h1>{mode==='login'?'Sign in':'Create account'}</h1><p className="muted">{hqLogin?'Private company access. Staff permissions are verified after sign in.':'Private trading intelligence, protected by your own account.'}</p><label>Email<input name="email" type="email" required/></label><label>Password<input name="password" type="password" minLength={8} required/></label><button className="primary" disabled={loading}>{loading?'Please wait…':mode==='login'?'Sign in':'Create account'}</button>{message&&<p className="warning">{message}</p>}{mode==='login'&&<Link className="link-button" href="/forgot-password">Forgot password?</Link>}{!hqLogin&&<button type="button" className="link-button" onClick={()=>setMode(mode==='login'?'signup':'login')}>{mode==='login'?'Create a new account':'I already have an account'}</button>}</form></main>
}

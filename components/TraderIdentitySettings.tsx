'use client';

import {FormEvent,useState} from 'react';
import {useRouter} from 'next/navigation';
import {createClient} from '@/lib/supabase/client';

export default function TraderIdentitySettings({userId,experienceLevel,traderType}:{userId:string;experienceLevel:string|null;traderType:string|null}){
  const router=useRouter();
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState('');
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setSaving(true);setMessage('');
    const form=new FormData(event.currentTarget);
    const {error}=await createClient().from('profiles').update({experience_level:String(form.get('experience_level')||''),trader_type:String(form.get('trader_type')||''),updated_at:new Date().toISOString()}).eq('id',userId);
    setSaving(false);setMessage(error?error.message:'Trading profile updated.');
    if(!error)router.refresh();
  }
  return <form className="trader-identity-settings" onSubmit={save}>
    <label>Experience<select name="experience_level" defaultValue={experienceLevel??''} required><option value="" disabled>Select</option><option>Beginner</option><option>Intermediate</option><option>Advanced</option><option>Professional</option></select></label>
    <label>Trading style<select name="trader_type" defaultValue={traderType??''} required><option value="" disabled>Select</option><option>Scalper</option><option>Day trader</option><option>Swing trader</option><option>Position trader</option></select></label>
    <button className="secondary" disabled={saving}>{saving?'Saving…':'Save profile'}</button>
    {message?<p className={message==='Trading profile updated.'?'success':'error'} role="status">{message}</p>:null}
  </form>;
}

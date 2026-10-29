'use client';

import {useEffect,useId,useRef,useState} from 'react';
import SignOutButton from '@/components/SignOutButton';

export default function HQProfileMenu({displayName,role}:{displayName:string;role:string}){
  const [open,setOpen]=useState(false);
  const popoverId=useId();
  const trigger=useRef<HTMLButtonElement>(null);
  const root=useRef<HTMLDivElement>(null);

  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);trigger.current?.focus()}};
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)};
  },[open]);

  return <div className="hq-profile-menu" ref={root}>
    <button className="hq-profile-trigger" ref={trigger} type="button" aria-label={`Account menu for ${displayName}`} aria-controls={open?popoverId:undefined} aria-expanded={open} onClick={()=>setOpen(value=>!value)}><span><strong>{displayName}</strong><small>{role.replaceAll('_',' ')}</small></span><b aria-hidden="true">⌄</b></button>
    {open&&<div className="hq-profile-popover" id={popoverId}><strong>{displayName}</strong><span>{role.replaceAll('_',' ')}</span><a href="/profile">Profile</a><SignOutButton portal="hq" /></div>}
  </div>;
}

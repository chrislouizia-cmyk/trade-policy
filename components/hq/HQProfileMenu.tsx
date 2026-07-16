'use client';

import {useEffect,useRef,useState} from 'react';
import SignOutButton from '@/components/SignOutButton';

export default function HQProfileMenu({displayName,role}:{displayName:string;role:string}){
  const [open,setOpen]=useState(false);
  const root=useRef<HTMLDivElement>(null);

  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false)};
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)};
  },[open]);

  return <div className="hq-profile-menu" ref={root}>
    <button className="hq-profile-trigger" type="button" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><span><strong>{displayName}</strong><small>{role.replaceAll('_',' ')}</small></span><b aria-hidden="true">⌄</b></button>
    {open&&<div className="hq-profile-popover" role="menu"><strong>{displayName}</strong><span>{role.replaceAll('_',' ')}</span><a href="/profile" role="menuitem">Profile</a><SignOutButton /></div>}
  </div>;
}

'use client';

import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';

const shortcuts=[['Alt + D','Dashboard','/dashboard'],['Alt + V','Decision','/validate'],['Alt + H','History','/history'],['Alt + S','Strategies','/profile'],['Alt + A','Analytics','/analytics']] as const;

export default function KeyboardShortcuts(){
  const router=useRouter(),[open,setOpen]=useState(false);
  useEffect(()=>{function keydown(event:KeyboardEvent){const target=event.target as HTMLElement|null,isField=target?.matches('input, textarea, select, [contenteditable="true"]');if(event.key==='Escape')return setOpen(false);if(event.key==='?'&&!isField){event.preventDefault();setOpen(value=>!value);return}if(!event.altKey||isField)return;const match=shortcuts.find(([, ,href])=>href===({d:'/dashboard',v:'/validate',h:'/history',s:'/profile',a:'/analytics'} as Record<string,string>)[event.key.toLowerCase()]);if(match){event.preventDefault();router.push(match[2])}}window.addEventListener('keydown',keydown);return()=>window.removeEventListener('keydown',keydown)},[router]);
  return <div className="shortcut-control"><button type="button" className="shortcut-trigger" aria-label="View keyboard shortcuts" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>⌨ <span>Shortcuts</span></button>{open&&<div className="shortcut-popover" role="dialog" aria-label="Keyboard shortcuts"><div><strong>Move around faster</strong><button type="button" aria-label="Close shortcuts" onClick={()=>setOpen(false)}>×</button></div>{shortcuts.map(([keys,label])=><p key={keys}><span>{label}</span><kbd>{keys}</kbd></p>)}<small>Press ? to open or close this guide.</small></div>}</div>;
}

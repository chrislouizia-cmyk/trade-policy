'use client';

import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {useLocale} from '@/components/i18n/LocaleProvider';

const shortcuts=[['Alt + D','shortcuts.dashboard','/dashboard'],['Alt + V','shortcuts.decision','/validate'],['Alt + H','shortcuts.history','/history'],['Alt + S','shortcuts.strategies','/profile'],['Alt + A','shortcuts.analytics','/analytics']] as const;

export default function KeyboardShortcuts(){
  const router=useRouter(),[open,setOpen]=useState(false);
  const {t}=useLocale();
  useEffect(()=>{function keydown(event:KeyboardEvent){const target=event.target as HTMLElement|null,isField=target?.matches('input, textarea, select, [contenteditable="true"]');if(event.key==='Escape')return setOpen(false);if(event.key==='?'&&!isField){event.preventDefault();setOpen(value=>!value);return}if(!event.altKey||isField)return;const match=shortcuts.find(([, ,href])=>href===({d:'/dashboard',v:'/validate',h:'/history',s:'/profile',a:'/analytics'} as Record<string,string>)[event.key.toLowerCase()]);if(match){event.preventDefault();router.push(match[2])}}window.addEventListener('keydown',keydown);return()=>window.removeEventListener('keydown',keydown)},[router]);
  return <div className="shortcut-control"><button type="button" className="shortcut-trigger" aria-label={t('shortcuts.view')} aria-expanded={open} onClick={()=>setOpen(value=>!value)}>⌨ <span>{t('shortcuts.button')}</span></button>{open&&<div className="shortcut-popover" role="dialog" aria-label={t('shortcuts.dialog')}><div><strong>{t('shortcuts.title')}</strong><button type="button" aria-label={t('shortcuts.close')} onClick={()=>setOpen(false)}>×</button></div>{shortcuts.map(([keys,label])=><p key={keys}><span>{t(label)}</span><kbd>{keys}</kbd></p>)}<small>{t('shortcuts.hint')}</small></div>}</div>;
}

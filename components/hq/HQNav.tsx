'use client';

import {usePathname} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';

const navigationGroups = [
  {label:'Command',icon:'⌁',links:[['Overview','/hq','hq.view']]},
  {label:'People & company',icon:'○',links:[['Customers','/hq/customers','customers.view_metadata'],['Team','/hq/team','staff.view'],['Company','/hq/organizations','organizations.view']]},
  {label:'Growth',icon:'↗',links:[['Sales','/hq/sales','sales.view'],['Beta','/hq/private-beta','beta.manage'],['Affiliates','/hq/affiliates','affiliate.manage'],['Marketplace','/hq/marketplace','marketplace.lab']]},
  {label:'Trust & operations',icon:'◇',links:[['Compliance','/hq/compliance','compliance.view'],['Support','/hq/support','support.view'],['System Operations','/hq/system','system.health'],['Constitution','/hq/constitution','hq.view']]},
] as const;

export default function HQNav({permissions}:{permissions:string[]}){
  const pathname=usePathname();
  const navRef=useRef<HTMLElement>(null);
  const [openGroup,setOpenGroup]=useState<{label:string;path:string}|null>(null);
  useEffect(()=>{
    const closeFromOutside=(event:PointerEvent)=>{if(navRef.current&&!navRef.current.contains(event.target as Node))setOpenGroup(null)};
    const closeFromEscape=(event:KeyboardEvent)=>{if(event.key==='Escape'){const summary=navRef.current?.querySelector<HTMLElement>('details[open] > summary');setOpenGroup(null);summary?.focus()}};
    document.addEventListener('pointerdown',closeFromOutside);
    document.addEventListener('keydown',closeFromEscape);
    return ()=>{document.removeEventListener('pointerdown',closeFromOutside);document.removeEventListener('keydown',closeFromEscape)};
  },[]);
  const isActive=(href:string)=>href==='/hq'?pathname==='/hq':pathname===href||pathname.startsWith(`${href}/`);
  const link=([label,href]:readonly [string,string,string])=><a className={isActive(href)?'active':undefined} aria-current={isActive(href)?'page':undefined} key={`${href}-${label}`} href={href}>{label}</a>;
  const groups=navigationGroups.map(group=>({...group,links:group.links.filter(([, ,permission])=>permissions.includes(permission))})).filter(group=>group.links.length>0);
  return <nav ref={navRef} className="hq-command-nav" aria-label="Trade Police HQ">
    {groups.map(group=>{
      const active=group.links.some(([,href])=>isActive(href));
      if(group.links.length===1){const item=group.links[0];return <a className={`hq-command-home ${active?'active':''}`} aria-current={active?'page':undefined} key={group.label} href={item[1]}><span aria-hidden="true">{group.icon}</span><strong>{group.label==='Command'?group.label:item[0]}</strong></a>}
      const expanded=openGroup?.label===group.label&&openGroup.path===pathname;
      return <details className="hq-command-group" key={group.label} open={expanded}>
        <summary className={active?'active':undefined} aria-expanded={expanded} onClick={(event)=>{event.preventDefault();setOpenGroup(expanded?null:{label:group.label,path:pathname})}}><span aria-hidden="true">{group.icon}</span><strong>{group.label}</strong><i aria-hidden="true">+</i></summary>
        <div>{group.links.map(link)}</div>
      </details>;
    })}
  </nav>;
}

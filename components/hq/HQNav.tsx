'use client';

import {usePathname} from 'next/navigation';

const allLinks = [
  ['Overview','/hq','hq.view'],
  ['Customers','/hq/customers','customers.view_metadata'],
  ['Team','/hq/team','staff.view'],
  ['Company','/hq/organizations','organizations.view'],
  ['Sales','/hq/sales','sales.view'],
  ['Compliance','/hq/compliance','compliance.view'],
  ['Support','/hq/support','support.view'],
  ['System','/hq/system','system.health'],
  ['Constitution','/hq/constitution','hq.view'],
] as const;

const primaryMobileLabels=new Set(['Overview','Customers','Sales','Compliance']);

export default function HQNav({permissions}:{permissions:string[]}){
  const pathname=usePathname();
  const links=allLinks.filter(([, , permission])=>permissions.includes(permission));
  const isActive=(href:string)=>href==='/hq'?pathname==='/hq':pathname.startsWith(href);
  const link=([label,href]:readonly [string,string,string])=><a className={isActive(href)?'active':undefined} aria-current={isActive(href)?'page':undefined} key={`${href}-${label}`} href={href}>{label}</a>;
  const mobilePrimary=links.filter(([label])=>primaryMobileLabels.has(label));
  const mobileMore=links.filter(([label])=>!primaryMobileLabels.has(label));
  const operations=links.find(([label])=>label==='System');
  const desktopPrimary=[...mobilePrimary.slice(0,3),...(operations?[operations]:[]),...mobilePrimary.slice(3)];
  const desktopMore=links.filter(item=>!desktopPrimary.includes(item));
  const desktopMoreActive=desktopMore.some(([,href])=>isActive(href));
  const mobileMoreActive=mobileMore.some(([,href])=>isActive(href));
  return <>
    <nav className="hq-nav hq-desktop-nav" aria-label="Trade Police HQ">{desktopPrimary.map(item=>item[0]==='System'?link(['Operations',item[1],item[2]]):link(item))}{desktopMore.length>0&&<details className="hq-more-menu hq-desktop-more"><summary className={desktopMoreActive?'active':undefined}>More</summary><div>{desktopMore.map(link)}</div></details>}</nav>
    <nav className="hq-mobile-nav" aria-label="Trade Police HQ mobile navigation">
      {mobilePrimary.map(link)}
      {mobileMore.length>0&&<details className="hq-more-menu"><summary className={mobileMoreActive?'active':undefined}>More</summary><div>{mobileMore.map(link)}</div></details>}
    </nav>
  </>;
}

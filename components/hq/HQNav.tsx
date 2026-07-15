'use client';

import { usePathname } from 'next/navigation';

const allLinks = [
  ['Mission Control','/hq','hq.view','⌂'],
  ['Customers','/hq/customers','customers.view_metadata','◎'],
  ['Team & Access','/hq/team','staff.view','◫'],
  ['Organizations','/hq/organizations','organizations.view','◇'],
  ['Sales','/hq/sales','sales.view','↗'],
  ['Compliance','/hq/compliance','compliance.view','✓'],
  ['Support','/hq/support','support.view','?'],
  ['System Health','/hq/system','system.health','◉'],
  ['Constitution','/hq/constitution','hq.view','§'],
] as const;

export default function HQNav({permissions}:{permissions:string[]}){
  const pathname = usePathname();
  return <nav className="hq-sidebar-nav" aria-label="Trade Police HQ">
    {allLinks
      .filter(([, , permission])=>permissions.includes(permission))
      .map(([label,href,,icon])=>{
        const active = href === '/hq' ? pathname === '/hq' : pathname.startsWith(href);
        return <a key={href} href={href} className={active?'active':''}>
          <span className="hq-nav-icon" aria-hidden>{icon}</span>
          <span>{label}</span>
        </a>;
      })}
  </nav>;
}

const allLinks = [
  ['Overview','/hq','hq.view'],
  ['Customers','/hq/customers','customers.view_metadata'],
  ['Team','/hq/team','staff.view'],
  ['Organizations','/hq/organizations','organizations.view'],
  ['Sales','/hq/sales','sales.view'],
  ['Compliance','/hq/compliance','compliance.view'],
  ['Support','/hq/support','support.view'],
  ['System','/hq/system','system.health'],
  ['Constitution','/hq/constitution','hq.view'],
] as const;
export default function HQNav({permissions}:{permissions:string[]}){
  return <nav className="hq-nav" aria-label="Trade Police HQ">
    {allLinks.filter(([, , permission])=>permissions.includes(permission)).map(([label,href])=><a key={href} href={href}>{label}</a>)}
  </nav>;
}

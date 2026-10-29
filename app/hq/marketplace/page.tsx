import {HQShell} from '@/lib/hq-page';import {getHQMarketplaceContext} from '@/lib/server/hq-marketplace';import MarketplaceLab from '@/components/hq/MarketplaceLab';
export default async function Page(){const {role,displayName,permissions}=await getHQMarketplaceContext();return <HQShell role={role} displayName={displayName} permissions={permissions}><MarketplaceLab/></HQShell>}

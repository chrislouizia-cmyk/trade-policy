import 'server-only';
import {redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import {getUserDisplayName} from '@/lib/user-display-name';
import type {MarketplaceListingSummary,MarketplaceReleasePreview} from '@/lib/marketplace/contracts';

export async function getHQMarketplaceContext(){
  const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)redirect('/hq/login');
  const [{data:owner},{data:sales},{data:compliance},{data:role},{data:permissions}]=await Promise.all([
    supabase.rpc('is_owner'),supabase.rpc('has_staff_permission',{p_permission:'sales.view'}),supabase.rpc('has_staff_permission',{p_permission:'compliance.view'}),supabase.rpc('current_staff_role'),supabase.rpc('current_staff_permissions'),
  ]);
  if(!(owner||sales||compliance))redirect('/hq/login?error=access');
  return {supabase,user,role:String(role??'HQ'),displayName:await getUserDisplayName(supabase,user),permissions:(permissions??[]).map((row:any)=>String(row.permission_key))};
}

const strings=(value:unknown)=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string').slice(0,12):[];
const text=(value:unknown)=>typeof value==='string'?value.slice(0,160):null;
export function sanitizeMarketplaceListing(row:any):MarketplaceListingSummary{
  const m=row.sanitized_metadata&&typeof row.sanitized_metadata==='object'?row.sanitized_metadata:{};
  const counts=m.ruleCounts&&typeof m.ruleCounts==='object'?m.ruleCounts:{};
  const n=(key:string)=>Number.isFinite(Number(counts[key]))?Math.max(0,Number(counts[key])):0;
  return {listingId:String(row.id),releaseId:String(row.release_id),strategyName:text(m.strategyName)??'Unnamed strategy',creatorName:text(m.creatorName),category:text(m.category),instruments:strings(m.instruments),timeframeRoles:{macro:text(m.macroTimeframe),execution:text(m.executionTimeframe)},ruleCounts:{total:n('total'),required:n('required'),optional:n('optional'),automatic:n('automatic'),manual:n('manual'),external:n('external')},compatibility:m.compatibility==='COMPATIBLE'||m.compatibility==='UNAVAILABLE'?m.compatibility:'NEEDS_REVIEW',displayPriceCents:3000,creatorShareCents:1500,platformShareCents:1500,commerceEnabled:false};
}
export function toMarketplacePreview(row:any):MarketplaceReleasePreview{
  const ranking=Array.isArray(row.marketplace_release_rankings)?row.marketplace_release_rankings[0]:null;
  return {releaseId:String(row.release_id),releaseVersion:Number(row.marketplace_strategy_releases?.release_version??0),creatorName:sanitizeMarketplaceListing(row).creatorName,listing:sanitizeMarketplaceListing(row),reviewStatus:row.review_status,usage:{installs:Number(row.install_count??0),analyses:Number(row.analysis_count??0),decisions:Number(row.decision_count??0),trades:Number(row.trade_count??0)},scores:{performance:ranking?.performance_score==null?null:Number(ranking.performance_score),marketplaceReadiness:ranking?.marketplace_readiness_score==null?null:Number(ranking.marketplace_readiness_score),scoreVersion:ranking?.score_version??null}};
}

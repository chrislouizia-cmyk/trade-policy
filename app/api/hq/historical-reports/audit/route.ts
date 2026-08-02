import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiError } from '@/lib/server/public-error';
import { HISTORICAL_REPORT_SCHEMA_REGISTRY } from '@/lib/historical-decisions/version-registry';

export const dynamic='force-dynamic';
export async function GET(){const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return apiError('UNAUTHORIZED','Authentication required.',401);const {data:allowed}=await supabase.rpc('has_staff_permission',{p_permission:'system.health'});if(!allowed)return apiError('FORBIDDEN','System health permission required.',403);try{const {data,error}=await createAdminClient().rpc('private_beta_report_operations_summary');if(error)throw error;return NextResponse.json({dryRun:true,supportedVersions:Object.keys(HISTORICAL_REPORT_SCHEMA_REGISTRY),schemaVersions:data?.schemaVersions??{},reportCount:Number(data?.reportCount??0),migratedCount:0},{headers:{'Cache-Control':'private, no-store'}})}catch{return apiError('SCHEMA_AUDIT_UNAVAILABLE','Historical report schema audit is unavailable.',503)}}

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiError } from '@/lib/server/public-error';

export const runtime='nodejs';export const dynamic='force-dynamic';
function authorized(request:Request){const secret=process.env.CRON_SECRET,header=request.headers.get('authorization');if(!secret||!header?.startsWith('Bearer '))return false;const provided=Buffer.from(header.slice(7)),expected=Buffer.from(secret);return provided.length===expected.length&&timingSafeEqual(provided,expected)}
export async function GET(request:Request){if(!process.env.CRON_SECRET)return apiError('CLEANUP_NOT_CONFIGURED','Scheduled cleanup is not configured.',503);if(!authorized(request))return apiError('UNAUTHORIZED','Unauthorized.',401);const dryRun=new URL(request.url).searchParams.get('dryRun')==='true';try{const {data,error}=await createAdminClient().rpc('cleanup_expired_decision_report_sources',{p_dry_run:dryRun});const result=Array.isArray(data)?data[0]:data;if(error||!result)throw error??new Error('Cleanup unavailable');return NextResponse.json({dryRun,expiredCount:Number(result.expired_count??0),deletedCount:Number(result.deleted_count??0),reportsDeleted:0,checkedAt:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}})}catch{console.error('Decision source cleanup failed.');return apiError('CLEANUP_UNAVAILABLE','Scheduled cleanup could not be completed.',503)}}

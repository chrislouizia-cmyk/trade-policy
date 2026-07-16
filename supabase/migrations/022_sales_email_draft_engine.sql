-- Trade Police V21 — auditable Sales email context and prompt snapshots.

alter table public.sales_email_drafts add column if not exists customer_context jsonb not null default '{}'::jsonb;
alter table public.sales_email_drafts add column if not exists prompt_snapshot jsonb not null default '{}'::jsonb;
alter table public.sales_email_drafts add column if not exists model_metadata jsonb not null default '{}'::jsonb;
alter table public.sales_email_drafts add column if not exists internal_rationale text;
alter table public.sales_email_drafts add column if not exists recommended_follow_up_date date;
create index if not exists sales_email_drafts_created_by_idx on public.sales_email_drafts(created_by,updated_at desc);
create index if not exists sales_email_drafts_template_idx on public.sales_email_drafts(template_type,updated_at desc);

create or replace function public.staff_sales_email_context(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.has_staff_permission('sales.view') or not public.has_staff_permission('customers.view_metadata') then raise exception 'Sales customer visibility permission denied'; end if;
 select jsonb_build_object(
  'customerId',p.id,'firstName',nullif(p.first_name,''),'displayName',coalesce(nullif(p.display_name,''),'Unnamed customer'),'email',p.email,
  'plan',upper(coalesce(p.plan,'FREE')),'contactStatus',case when coalesce(c.contacted_at,p.last_contacted_at) is null then 'NEVER_CONTACTED' else 'CONTACTED' end,
  'lastContactedAt',coalesce(c.contacted_at,p.last_contacted_at),'nextFollowUpAt',f.due_at,'lastActivityAt',u.last_activity_at,
  'activeStrategyName',s.active_strategy,'strategyCount',coalesce(s.strategy_count,0),'accountCount',coalesce(a.account_count,0),
  'analysisCount',coalesce(u.analysis_count,0),'openTrades',coalesce(t.open_trades,0),'closedTrades',coalesce(t.closed_trades,0),
  'betaStatus',coalesce(p.is_beta_tester,false),'latestContactSummary',c.summary,'latestContactOutcome',c.outcome,
  'queueReason',case when f.due_at<now() then 'Follow-up overdue' when s.active_strategy is null then 'No active strategy' when coalesce(u.analysis_count,0)=0 then 'No first analysis' when u.last_activity_at<now()-interval '60 days' then 'Dormant customer' else null end,
  'lifecycle',case when u.last_activity_at>=now()-interval '30 days' and coalesce(u.analysis_count,0)>=10 and coalesce(a.account_count,0)>0 and s.active_strategy is not null then 'RETAINED' when u.last_activity_at>=now()-interval '7 days' and coalesce(u.analysis_count,0)>=3 and coalesce(a.account_count,0)>0 then 'ENGAGED' when u.last_activity_at>=now()-interval '30 days' and coalesce(u.analysis_count,0)>0 and coalesce(a.account_count,0)>0 and s.active_strategy is not null then 'ACTIVATED' when p.created_at>=now()-interval '7 days' and coalesce(u.analysis_count,0)=0 and coalesce(a.account_count,0)=0 and s.active_strategy is null then 'NEW' when s.active_strategy is null or coalesce(u.analysis_count,0)=0 then 'ONBOARDING' when u.last_activity_at>=now()-interval '60 days' then 'AT_RISK' else 'DORMANT' end
 ) into result
 from public.profiles p
 left join lateral (select contacted_at,summary,upper(outcome) outcome from public.sales_contacts where customer_id=p.id order by contacted_at desc limit 1)c on true
 left join lateral (select due_at from public.customer_follow_ups where customer_user_id=p.id and upper(status)='OPEN' order by due_at limit 1)f on true
 left join lateral (select max(created_at) last_activity_at,count(*) filter(where event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS')) analysis_count from public.usage_events where user_id=p.id)u on true
 left join lateral (select count(*) strategy_count,max(name) filter(where is_default) active_strategy from public.strategy_profiles where user_id=p.id and not coalesce(is_archived,false))s on true
 left join lateral (select count(*) account_count from public.trading_accounts where user_id=p.id and not coalesce(is_archived,false))a on true
 left join lateral (select count(*) filter(where upper(status)='OPEN') open_trades,count(*) filter(where upper(status)='CLOSED') closed_trades from public.active_trades where user_id=p.id)t on true
 where p.id=p_customer_id;
 return result;
end;$$;

create or replace function public.staff_sales_save_draft_v2(p_id uuid,p_customer_id uuid,p_recipient_email text,p_subject text,p_body text,p_template_type text,p_tone text,p_language text,p_status text,p_customer_context jsonb,p_prompt_snapshot jsonb,p_model_metadata jsonb,p_internal_rationale text default null,p_recommended_follow_up_date date default null,p_generated_by_ai boolean default false,p_safety_flags text[] default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_context jsonb; v_status text:=upper(p_status);
begin
 if not public.has_staff_permission('sales.manage') or not public.has_staff_permission('customers.view_metadata') then raise exception 'Sales customer management permission denied'; end if;
 if v_status not in ('DRAFT','READY_FOR_REVIEW','APPROVED','ARCHIVED') then raise exception 'Invalid draft status'; end if;
 v_context:=public.staff_sales_email_context(p_customer_id);
 if v_context is null or lower(v_context->>'email')<>lower(trim(p_recipient_email)) then raise exception 'Recipient does not match permitted customer'; end if;
 if p_customer_context is distinct from v_context then raise exception 'Customer context is stale; reload before saving'; end if;
 if nullif(trim(p_subject),'') is null or nullif(trim(p_body),'') is null then raise exception 'Subject and body are required'; end if;
 if p_id is null then
  insert into public.sales_email_drafts(customer_id,created_by,recipient_email,subject,body,template_type,tone,language,status,customer_context,prompt_snapshot,model_metadata,internal_rationale,recommended_follow_up_date,generated_by_ai,safety_flags)
  values(p_customer_id,auth.uid(),trim(p_recipient_email),trim(p_subject),trim(p_body),upper(p_template_type),upper(p_tone),upper(p_language),v_status,v_context,p_prompt_snapshot,p_model_metadata,p_internal_rationale,p_recommended_follow_up_date,p_generated_by_ai,p_safety_flags) returning id into v_id;
 else
  update public.sales_email_drafts set recipient_email=trim(p_recipient_email),subject=trim(p_subject),body=trim(p_body),template_type=upper(p_template_type),tone=upper(p_tone),language=upper(p_language),status=v_status,customer_context=v_context,prompt_snapshot=p_prompt_snapshot,model_metadata=p_model_metadata,internal_rationale=p_internal_rationale,recommended_follow_up_date=p_recommended_follow_up_date,generated_by_ai=p_generated_by_ai,safety_flags=p_safety_flags,updated_at=now() where id=p_id and customer_id=p_customer_id and status<>'SENT' returning id into v_id;
  if v_id is null then raise exception 'Editable draft not found'; end if;
 end if;
 return public.staff_sales_draft(v_id);
end;$$;

create or replace function public.staff_sales_archive_draft(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.has_staff_permission('sales.manage') or not public.has_staff_permission('customers.view_metadata') then raise exception 'Sales customer management permission denied'; end if;
 update public.sales_email_drafts set status='ARCHIVED',updated_at=now() where id=p_id and status<>'SENT' returning to_jsonb(sales_email_drafts) into result;
 if result is null then raise exception 'Archivable draft not found'; end if;
 return result;
end;$$;

create or replace function public.staff_sales_email_drafts_v2(p_query text default '',p_page integer default 1,p_page_size integer default 25,p_status text default 'ALL',p_template text default 'ALL',p_language text default 'ALL',p_customer_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$ declare result jsonb; begin
 if not public.has_staff_permission('sales.view') or not public.has_staff_permission('customers.view_metadata') then raise exception 'Sales customer visibility permission denied'; end if;
 with filtered as (select d.*,p.display_name,p.email customer_email,count(*) over() total_count from public.sales_email_drafts d join public.profiles p on p.id=d.customer_id where (nullif(trim(p_query),'') is null or concat_ws(' ',p.display_name,p.email,d.subject,d.body) ilike '%'||trim(p_query)||'%') and (upper(p_status)='ALL' or upper(d.status)=upper(p_status)) and (upper(p_template)='ALL' or upper(d.template_type)=upper(p_template)) and (upper(p_language)='ALL' or upper(d.language)=upper(p_language)) and (p_customer_id is null or d.customer_id=p_customer_id) order by d.updated_at desc limit greatest(1,least(p_page_size,100)) offset (greatest(p_page,1)-1)*greatest(1,least(p_page_size,100))) select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(filtered)-'total_count'),'[]'::jsonb),'total',coalesce(max(total_count),0),'page',greatest(p_page,1),'pageSize',greatest(1,least(p_page_size,100))) into result from filtered; return result;
end;$$;

revoke all on function public.staff_sales_email_context(uuid),public.staff_sales_save_draft_v2(uuid,uuid,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,text,date,boolean,text[]),public.staff_sales_archive_draft(uuid),public.staff_sales_email_drafts_v2(text,integer,integer,text,text,text,uuid) from public;
grant execute on function public.staff_sales_email_context(uuid),public.staff_sales_save_draft_v2(uuid,uuid,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,text,date,boolean,text[]),public.staff_sales_archive_draft(uuid),public.staff_sales_email_drafts_v2(text,integer,integer,text,text,text,uuid) to authenticated;
notify pgrst, 'reload schema';

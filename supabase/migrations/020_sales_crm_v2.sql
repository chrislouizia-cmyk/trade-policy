-- Trade Police V21 — permission-scoped Sales CRM contacts, follow-ups and drafts.

create table if not exists public.sales_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  contact_type text not null check (contact_type in ('EMAIL','CALL','WHATSAPP','MEETING','OTHER')),
  subject text,
  summary text not null,
  outcome text not null check (outcome in ('NO_RESPONSE','INTERESTED','NEEDS_HELP','FOLLOW_UP_REQUIRED','NOT_INTERESTED','RESOLVED')),
  contacted_at timestamptz not null,
  contacted_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.sales_email_drafts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  recipient_email text not null,
  subject text not null default '',
  body text not null default '',
  template_type text not null,
  tone text not null,
  language text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','READY_FOR_REVIEW','APPROVED','SENT','ARCHIVED')),
  generated_by_ai boolean not null default false,
  safety_flags text[] not null default '{}',
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_contacts_customer_date_idx on public.sales_contacts(customer_id,contacted_at desc);
create index if not exists sales_contacts_contacted_by_idx on public.sales_contacts(contacted_by,contacted_at desc);
create index if not exists sales_email_drafts_customer_idx on public.sales_email_drafts(customer_id,updated_at desc);
create index if not exists sales_email_drafts_status_idx on public.sales_email_drafts(status,updated_at desc);
create index if not exists customer_follow_ups_customer_status_idx on public.customer_follow_ups(customer_user_id,status,due_at);

alter table public.sales_contacts enable row level security;
alter table public.sales_email_drafts enable row level security;
revoke all on public.sales_contacts,public.sales_email_drafts from anon,authenticated;

-- PostgreSQL does not allow CREATE OR REPLACE to rename input arguments on an
-- existing function. Remove only the five-argument CRM RPC signature so a
-- stale pre-release variant cannot remain in the PostgREST schema cache.
drop function if exists public.staff_sales_crm_v2(text,integer,integer,text,text);

create or replace function public.staff_sales_crm_v2(p_query text default '',p_page integer default 1,p_page_size integer default 25,p_plan text default 'ALL',p_contact text default 'ALL')
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not public.has_staff_permission('sales.view') then raise exception 'Sales workspace permission denied'; end if;
  p_page:=greatest(p_page,1); p_page_size:=greatest(1,least(p_page_size,100));
  with base as (
    select p.id customer_id,p.email,coalesce(nullif(p.display_name,''),'Unnamed customer') display_name,
      upper(coalesce(p.plan,'FREE')) plan,upper(coalesce(p.subscription_status,'INACTIVE')) subscription_status,
      coalesce(p.is_beta_tester,false) is_beta_tester,p.created_at,p.last_contacted_at,
      (select max(u.created_at) from public.usage_events u where u.user_id=p.id) last_activity_at,
      (select count(*) from public.usage_events u where u.user_id=p.id and u.event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS')) analysis_count,
      (select count(*) from public.trading_accounts a where a.user_id=p.id and not a.is_archived) account_count,
      (select count(*) from public.strategy_profiles s where s.user_id=p.id and s.is_default and not coalesce(s.is_archived,false)) active_strategy_count,
      (select min(f.due_at) from public.customer_follow_ups f where f.customer_user_id=p.id and f.status='OPEN') next_follow_up_at,
      (select d.id from public.sales_email_drafts d where d.customer_id=p.id and d.status in ('DRAFT','READY_FOR_REVIEW') order by d.updated_at desc limit 1) draft_id,
      (select d.updated_at from public.sales_email_drafts d where d.customer_id=p.id and d.status in ('DRAFT','READY_FOR_REVIEW') order by d.updated_at desc limit 1) draft_updated_at
    from public.profiles p
  ), derived as (
    select *,case
      when created_at>=now()-interval '7 days' and last_contacted_at is null then 'NEW'
      when active_strategy_count=0 or analysis_count=0 then 'ONBOARDING'
      when last_activity_at>=now()-interval '7 days' and analysis_count>=3 then 'ENGAGED'
      when last_activity_at>=now()-interval '30 days' then 'ACTIVATED'
      when last_activity_at>=now()-interval '60 days' then 'AT_RISK'
      else 'DORMANT' end lifecycle
    from base
  ), filtered as (
    select * from derived where
      (nullif(trim(p_query),'') is null or concat_ws(' ',display_name,email,plan,subscription_status,lifecycle) ilike '%'||trim(p_query)||'%')
      and (upper(coalesce(p_plan,'ALL'))='ALL' or plan=upper(p_plan))
      and (upper(coalesce(p_contact,'ALL'))='ALL' or (upper(p_contact)='NEVER' and last_contacted_at is null) or (upper(p_contact)='DUE' and next_follow_up_at<=now()))
  ), counted as (select *,count(*) over() total_count from filtered), paged as (
    select * from counted order by coalesce(next_follow_up_at,'infinity'::timestamptz),coalesce(last_activity_at,created_at) desc
    limit p_page_size offset (p_page-1)*p_page_size
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(paged)-'total_count') from paged),'[]'::jsonb),
    'total',coalesce((select max(total_count) from counted),0),'page',p_page,'pageSize',p_page_size,
    'metrics',jsonb_build_object(
      'total',(select count(*) from base),'neverContacted',(select count(*) from base where last_contacted_at is null),
      'followUpDue',(select count(*) from base where next_follow_up_at<=now()),
      'contactedThisWeek',(select count(*) from public.sales_contacts where contacted_at>=date_trunc('week',now())),
      'activeCustomers',(select count(*) from base where last_activity_at>=now()-interval '30 days'),
      'privateBeta',(select count(*) from base where is_beta_tester)
    ),
    'recentContacts',coalesce((select jsonb_agg(x) from (select c.id,c.customer_id,p.display_name,p.email,c.contact_type,c.outcome,c.summary,c.contacted_at from public.sales_contacts c join public.profiles p on p.id=c.customer_id order by c.contacted_at desc limit 8)x),'[]'::jsonb),
    'recentDrafts',coalesce((select jsonb_agg(x) from (select d.id,d.customer_id,p.display_name,d.recipient_email,d.subject,d.template_type,d.status,d.updated_at from public.sales_email_drafts d join public.profiles p on p.id=d.customer_id order by d.updated_at desc limit 6)x),'[]'::jsonb)
  ) into result;
  return result;
end;$$;

create or replace function public.staff_sales_record_contact(p_customer_id uuid,p_contact_type text,p_contacted_at timestamptz,p_summary text,p_outcome text,p_follow_up_at timestamptz default null,p_follow_up_note text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not public.has_staff_permission('sales.manage') then raise exception 'Sales manage permission denied'; end if;
  if not exists(select 1 from public.profiles where id=p_customer_id) then raise exception 'Customer not found'; end if;
  insert into public.sales_contacts(customer_id,contact_type,summary,outcome,contacted_at,contacted_by)
  values(p_customer_id,upper(p_contact_type),trim(p_summary),upper(p_outcome),p_contacted_at,auth.uid()) returning id into v_id;
  update public.profiles set last_contacted_at=p_contacted_at,assigned_sales_user_id=coalesce(assigned_sales_user_id,auth.uid()) where id=p_customer_id;
  if p_follow_up_at is not null then insert into public.customer_follow_ups(customer_user_id,assigned_to,due_at,channel,summary) values(p_customer_id,auth.uid(),p_follow_up_at,case when upper(p_contact_type) in ('EMAIL','PHONE','WHATSAPP','OTHER') then case when upper(p_contact_type)='CALL' then 'PHONE' else upper(p_contact_type) end else 'OTHER' end,p_follow_up_note); end if;
  return v_id;
end;$$;

create or replace function public.staff_sales_schedule_follow_up(p_customer_id uuid,p_due_at timestamptz,p_note text,p_priority text default 'NORMAL')
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not public.has_staff_permission('sales.manage') then raise exception 'Sales manage permission denied'; end if;
  if not exists(select 1 from public.profiles where id=p_customer_id) then raise exception 'Customer not found'; end if;
  insert into public.customer_follow_ups(customer_user_id,assigned_to,due_at,summary) values(p_customer_id,auth.uid(),p_due_at,concat('[',case when upper(p_priority)='HIGH' then 'HIGH' else 'NORMAL' end,'] ',trim(p_note))) returning id into v_id;
  return v_id;
end;$$;

create or replace function public.staff_sales_save_draft(p_id uuid,p_customer_id uuid,p_recipient_email text,p_subject text,p_body text,p_template_type text,p_tone text,p_language text,p_status text default 'DRAFT',p_generated_by_ai boolean default false,p_safety_flags text[] default '{}')
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not public.has_staff_permission('sales.manage') then raise exception 'Sales manage permission denied'; end if;
  if not exists(select 1 from public.profiles where id=p_customer_id and lower(email)=lower(trim(p_recipient_email))) then raise exception 'Recipient does not match customer'; end if;
  if p_id is null then
    insert into public.sales_email_drafts(customer_id,created_by,recipient_email,subject,body,template_type,tone,language,status,generated_by_ai,safety_flags)
    values(p_customer_id,auth.uid(),trim(p_recipient_email),p_subject,p_body,upper(p_template_type),upper(p_tone),upper(p_language),upper(p_status),p_generated_by_ai,p_safety_flags) returning id into v_id;
  else
    update public.sales_email_drafts set recipient_email=trim(p_recipient_email),subject=p_subject,body=p_body,template_type=upper(p_template_type),tone=upper(p_tone),language=upper(p_language),status=upper(p_status),generated_by_ai=p_generated_by_ai,safety_flags=p_safety_flags,updated_at=now(),sent_at=case when upper(p_status)='SENT' then coalesce(sent_at,now()) else sent_at end where id=p_id returning id into v_id;
    if v_id is null then raise exception 'Draft not found'; end if;
  end if;
  return v_id;
end;$$;

create or replace function public.staff_sales_drafts(p_query text default '',p_page integer default 1,p_page_size integer default 25,p_status text default 'ALL',p_template text default 'ALL')
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.has_staff_permission('sales.view') then raise exception 'Sales workspace permission denied'; end if;
 with f as (select d.*,p.display_name,p.email customer_email,count(*) over() total_count from public.sales_email_drafts d join public.profiles p on p.id=d.customer_id where (nullif(trim(p_query),'') is null or concat_ws(' ',p.display_name,p.email,d.subject,d.body) ilike '%'||trim(p_query)||'%') and (upper(p_status)='ALL' or d.status=upper(p_status)) and (upper(p_template)='ALL' or d.template_type=upper(p_template)) order by d.updated_at desc limit greatest(1,least(p_page_size,100)) offset (greatest(p_page,1)-1)*greatest(1,least(p_page_size,100)))
 select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(f)-'total_count'),'[]'::jsonb),'total',coalesce(max(total_count),0),'page',greatest(p_page,1),'pageSize',greatest(1,least(p_page_size,100))) into result from f; return result;
end;$$;

create or replace function public.staff_sales_delete_draft(p_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin if not public.has_staff_permission('sales.manage') then raise exception 'Sales manage permission denied'; end if; delete from public.sales_email_drafts where id=p_id and status<>'SENT'; end;$$;

create or replace function public.staff_sales_customer_context(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.has_staff_permission('sales.view') then raise exception 'Sales workspace permission denied'; end if;
 select jsonb_build_object('customer_id',p.id,'email',p.email,'display_name',coalesce(nullif(p.display_name,''),'Unnamed customer'),'plan',upper(coalesce(p.plan,'FREE')),'created_at',p.created_at,'last_contacted_at',p.last_contacted_at,'last_activity_at',(select max(u.created_at) from public.usage_events u where u.user_id=p.id),'analysis_count',(select count(*) from public.usage_events u where u.user_id=p.id and u.event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS')),'account_count',(select count(*) from public.trading_accounts a where a.user_id=p.id and not a.is_archived),'active_strategy_count',(select count(*) from public.strategy_profiles s where s.user_id=p.id and s.is_default and not coalesce(s.is_archived,false)),'next_follow_up_at',(select min(f.due_at) from public.customer_follow_ups f where f.customer_user_id=p.id and f.status='OPEN')) into result from public.profiles p where p.id=p_customer_id;
 return result;
end;$$;

create or replace function public.staff_sales_draft(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.has_staff_permission('sales.view') then raise exception 'Sales workspace permission denied'; end if;
 select to_jsonb(d) || jsonb_build_object('display_name',p.display_name,'customer_email',p.email) into result from public.sales_email_drafts d join public.profiles p on p.id=d.customer_id where d.id=p_id;
 return result;
end;$$;

revoke all on function public.staff_sales_crm_v2(text,integer,integer,text,text),public.staff_sales_record_contact(uuid,text,timestamptz,text,text,timestamptz,text),public.staff_sales_schedule_follow_up(uuid,timestamptz,text,text),public.staff_sales_save_draft(uuid,uuid,text,text,text,text,text,text,text,boolean,text[]),public.staff_sales_drafts(text,integer,integer,text,text),public.staff_sales_delete_draft(uuid),public.staff_sales_customer_context(uuid),public.staff_sales_draft(uuid) from public;
grant execute on function public.staff_sales_crm_v2(text,integer,integer,text,text),public.staff_sales_record_contact(uuid,text,timestamptz,text,text,timestamptz,text),public.staff_sales_schedule_follow_up(uuid,timestamptz,text,text),public.staff_sales_save_draft(uuid,uuid,text,text,text,text,text,text,text,boolean,text[]),public.staff_sales_drafts(text,integer,integer,text,text),public.staff_sales_delete_draft(uuid),public.staff_sales_customer_context(uuid),public.staff_sales_draft(uuid) to authenticated;

notify pgrst, 'reload schema';

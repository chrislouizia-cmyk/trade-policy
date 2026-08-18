-- Auditable, idempotent delivery lifecycle for persisted HQ sales drafts.
alter table public.sales_email_drafts
  add column if not exists sent_by uuid references auth.users(id) on delete set null,
  add column if not exists delivery_provider text,
  add column if not exists provider_message_id text,
  add column if not exists delivery_attempts integer not null default 0,
  add column if not exists delivery_error_code text,
  add column if not exists pre_send_status text;

alter table public.sales_email_drafts drop constraint if exists sales_email_drafts_status_check;
alter table public.sales_email_drafts add constraint sales_email_drafts_status_check check (status in ('DRAFT','READY_FOR_REVIEW','APPROVED','SENDING','SENT','ARCHIVED'));

create table if not exists public.sales_email_delivery_audit (
  id uuid primary key default gen_random_uuid(), draft_id uuid not null references public.sales_email_drafts(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null, provider text not null, outcome text not null check (outcome in ('RESERVED','SENT','FAILED')),
  provider_message_id text, error_code text, created_at timestamptz not null default now()
);
alter table public.sales_email_delivery_audit enable row level security;
revoke all on public.sales_email_delivery_audit from public,anon,authenticated;

create or replace function public.staff_sales_reserve_draft_send(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.sales_email_drafts%rowtype;
begin
 if not public.has_staff_permission('sales.manage') or not public.has_staff_permission('customers.view_metadata') then raise exception 'Sales customer management permission denied'; end if;
 select * into d from public.sales_email_drafts where id=p_id for update;
 if not found then raise exception 'Draft not found'; end if;
 if d.status='SENT' then raise exception 'Draft already sent'; end if;
 if d.status='SENDING' then raise exception 'Draft is already sending'; end if;
 if d.status='ARCHIVED' then raise exception 'Archived drafts cannot be sent'; end if;
 if nullif(trim(d.recipient_email),'') is null then raise exception 'Recipient is required'; end if;
 if nullif(trim(d.subject),'') is null or nullif(trim(d.body),'') is null then raise exception 'Subject and body are required'; end if;
 update public.sales_email_drafts set pre_send_status=status,status='SENDING',delivery_attempts=delivery_attempts+1,delivery_error_code=null,updated_at=now() where id=p_id returning * into d;
 insert into public.sales_email_delivery_audit(draft_id,actor_id,provider,outcome) values(d.id,auth.uid(),'GMAIL','RESERVED');
 return jsonb_build_object('recipient_email',d.recipient_email,'subject',d.subject,'body',d.body);
end;$$;

create or replace function public.staff_sales_complete_draft_send(p_id uuid,p_provider text,p_provider_message_id text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.sales_email_drafts%rowtype;
begin
 if not public.has_staff_permission('sales.manage') then raise exception 'Sales manage permission denied'; end if;
 update public.sales_email_drafts set status='SENT',pre_send_status=null,sent_at=now(),sent_by=auth.uid(),delivery_provider=upper(p_provider),provider_message_id=p_provider_message_id,delivery_error_code=null,updated_at=now() where id=p_id and status='SENDING' returning * into d;
 if not found then raise exception 'Send reservation is no longer valid'; end if;
 insert into public.sales_email_delivery_audit(draft_id,actor_id,provider,outcome,provider_message_id) values(d.id,auth.uid(),upper(p_provider),'SENT',p_provider_message_id);
 return public.staff_sales_draft(d.id);
end;$$;

create or replace function public.staff_sales_fail_draft_send(p_id uuid,p_error_code text) returns void language plpgsql security definer set search_path=public as $$
declare d public.sales_email_drafts%rowtype;
begin
 if not public.has_staff_permission('sales.manage') then raise exception 'Sales manage permission denied'; end if;
 update public.sales_email_drafts set status=coalesce(pre_send_status,'DRAFT'),pre_send_status=null,delivery_error_code=left(coalesce(p_error_code,'DELIVERY_FAILED'),120),updated_at=now() where id=p_id and status='SENDING' returning * into d;
 if found then insert into public.sales_email_delivery_audit(draft_id,actor_id,provider,outcome,error_code) values(d.id,auth.uid(),'GMAIL','FAILED',d.delivery_error_code); end if;
end;$$;

revoke all on function public.staff_sales_reserve_draft_send(uuid),public.staff_sales_complete_draft_send(uuid,text,text),public.staff_sales_fail_draft_send(uuid,text) from public;
grant execute on function public.staff_sales_reserve_draft_send(uuid),public.staff_sales_complete_draft_send(uuid,text,text),public.staff_sales_fail_draft_send(uuid,text) to authenticated;
notify pgrst,'reload schema';

-- Trade Police v9 beta experience: feedback, onboarding and safe account adjustments.

alter table public.trading_accounts add column if not exists peak_balance numeric;
alter table public.trading_accounts add column if not exists archived_at timestamptz;
update public.trading_accounts set peak_balance = greatest(initial_balance, current_balance) where peak_balance is null;
alter table public.trading_accounts alter column peak_balance set default 0;

create table if not exists public.beta_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feedback_type text not null check (feedback_type in ('ISSUE','FEEDBACK','FEATURE')),
  page_path text,
  browser text,
  message text not null,
  ease_score integer check (ease_score between 1 and 10),
  screenshot_path text,
  status text not null default 'OPEN' check (status in ('OPEN','REVIEWING','RESOLVED','CLOSED')),
  created_at timestamptz not null default now()
);

alter table public.beta_feedback enable row level security;
drop policy if exists beta_feedback_own on public.beta_feedback;
create policy beta_feedback_own on public.beta_feedback
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
grant select, insert, update on public.beta_feedback to authenticated;

create or replace function public.adjust_trading_account(
  p_account_id uuid,
  p_entry_type text,
  p_amount numeric,
  p_description text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_account public.trading_accounts%rowtype;
  v_signed_amount numeric;
  v_new_balance numeric;
begin
  if p_entry_type not in ('DEPOSIT','WITHDRAWAL','FEE','COMMISSION','SWAP','MANUAL_ADJUSTMENT') then
    raise exception 'Unsupported account adjustment';
  end if;
  if p_amount is null or p_amount < 0 then raise exception 'Amount must be zero or greater'; end if;

  select * into v_account from public.trading_accounts
  where id = p_account_id and user_id = auth.uid() and is_archived = false
  for update;
  if not found then raise exception 'Trading account not found'; end if;

  v_signed_amount := case when p_entry_type in ('WITHDRAWAL','FEE','COMMISSION','SWAP') then -p_amount else p_amount end;
  v_new_balance := v_account.current_balance + v_signed_amount;
  if v_new_balance < 0 then raise exception 'Adjustment would create a negative balance'; end if;

  update public.trading_accounts
  set current_balance = v_new_balance,
      peak_balance = greatest(coalesce(peak_balance, initial_balance), v_new_balance),
      updated_at = now()
  where id = v_account.id;

  insert into public.account_ledger(user_id,account_id,entry_type,amount,balance_before,balance_after,description)
  values(auth.uid(),v_account.id,p_entry_type,v_signed_amount,v_account.current_balance,v_new_balance,p_description);

  return jsonb_build_object('balance_before',v_account.current_balance,'balance_after',v_new_balance,'amount',v_signed_amount);
end;
$$;
grant execute on function public.adjust_trading_account(uuid,text,numeric,text) to authenticated;

create or replace function public.archive_trading_account(p_account_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.trading_accounts
  set is_archived = true, is_active = false, archived_at = now(), updated_at = now()
  where id = p_account_id and user_id = auth.uid();
  if not found then raise exception 'Trading account not found'; end if;
end;
$$;
grant execute on function public.archive_trading_account(uuid) to authenticated;

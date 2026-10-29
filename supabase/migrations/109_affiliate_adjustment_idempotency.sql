-- 109_affiliate_adjustment_idempotency.sql
-- System-generated Stripe refund / chargeback adjustments.
-- Economic truth remains append-only.

alter table public.affiliate_commission_adjustments
  alter column created_by drop not null;

alter table public.affiliate_commission_adjustments
  add column if not exists source_type text;

alter table public.affiliate_commission_adjustments
  add column if not exists source_id text;

alter table public.affiliate_commission_adjustments
  add column if not exists source_amount_minor integer;

alter table public.affiliate_commission_adjustments
  add column if not exists source_total_minor integer;

alter table public.affiliate_commission_adjustments
  add column if not exists metadata jsonb not null default '{}'::jsonb;


do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'affiliate_adjustments_amount_positive_check'
      and conrelid = 'public.affiliate_commission_adjustments'::regclass
  ) then
    alter table public.affiliate_commission_adjustments
      add constraint affiliate_adjustments_amount_positive_check
      check (amount_minor > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'affiliate_adjustments_source_amount_check'
      and conrelid = 'public.affiliate_commission_adjustments'::regclass
  ) then
    alter table public.affiliate_commission_adjustments
      add constraint affiliate_adjustments_source_amount_check
      check (
        source_amount_minor is null
        or source_amount_minor > 0
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'affiliate_adjustments_source_total_check'
      and conrelid = 'public.affiliate_commission_adjustments'::regclass
  ) then
    alter table public.affiliate_commission_adjustments
      add constraint affiliate_adjustments_source_total_check
      check (
        source_total_minor is null
        or source_total_minor > 0
      );
  end if;
end
$$;


create unique index if not exists affiliate_adjustments_source_uidx
  on public.affiliate_commission_adjustments(source_type, source_id)
  where source_type is not null
    and source_id is not null;


create index if not exists affiliate_adjustments_commission_idx
  on public.affiliate_commission_adjustments(commission_id);


create or replace function public.protect_affiliate_adjustment_truth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'AFFILIATE_ADJUSTMENT_LEDGER_APPEND_ONLY';
  end if;

  if old.commission_id is distinct from new.commission_id
     or old.adjustment_type is distinct from new.adjustment_type
     or old.amount_minor is distinct from new.amount_minor
     or old.currency is distinct from new.currency
     or old.reason is distinct from new.reason
     or old.created_at is distinct from new.created_at
     or old.created_by is distinct from new.created_by
     or old.source_type is distinct from new.source_type
     or old.source_id is distinct from new.source_id
     or old.source_amount_minor is distinct from new.source_amount_minor
     or old.source_total_minor is distinct from new.source_total_minor
     or old.metadata is distinct from new.metadata
  then
    raise exception 'AFFILIATE_ADJUSTMENT_ECONOMIC_TRUTH_IMMUTABLE';
  end if;

  return new;
end;
$$;


drop trigger if exists affiliate_adjustments_protect_update_trigger
  on public.affiliate_commission_adjustments;

create trigger affiliate_adjustments_protect_update_trigger
before update on public.affiliate_commission_adjustments
for each row
execute function public.protect_affiliate_adjustment_truth();


drop trigger if exists affiliate_adjustments_protect_delete_trigger
  on public.affiliate_commission_adjustments;

create trigger affiliate_adjustments_protect_delete_trigger
before delete on public.affiliate_commission_adjustments
for each row
execute function public.protect_affiliate_adjustment_truth();


create or replace function public.record_affiliate_system_adjustment(
  p_stripe_invoice_id text,
  p_source_type text,
  p_source_id text,
  p_source_amount_minor integer,
  p_source_total_minor integer,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commission public.affiliate_commissions%rowtype;
  v_existing_id uuid;
  v_source_type text;
  v_already_adjusted integer := 0;
  v_same_type_adjusted integer := 0;
  v_same_type_source_amount integer := 0;
  v_remaining integer := 0;
  v_target_adjustment integer := 0;
  v_adjustment integer := 0;
  v_id uuid;
begin
  if nullif(trim(p_stripe_invoice_id), '') is null
     or nullif(trim(p_source_type), '') is null
     or nullif(trim(p_source_id), '') is null
     or p_source_amount_minor is null
     or p_source_amount_minor <= 0
     or p_source_total_minor is null
     or p_source_total_minor <= 0
     or p_source_amount_minor > p_source_total_minor
  then
    raise exception 'INVALID_AFFILIATE_ADJUSTMENT_INPUT';
  end if;

  v_source_type := upper(trim(p_source_type));

  -- Business idempotency before any financial work.
  select id
  into v_existing_id
  from public.affiliate_commission_adjustments
  where source_type = v_source_type
    and source_id = trim(p_source_id)
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  -- Serialize all financial reversals for this commission.
  select *
  into v_commission
  from public.affiliate_commissions
  where stripe_invoice_id = trim(p_stripe_invoice_id)
  for update;

  if not found then
    return null;
  end if;

  select
    coalesce(sum(amount_minor), 0)::integer,
    coalesce(
      sum(amount_minor) filter (
        where source_type = v_source_type
      ),
      0
    )::integer,
    coalesce(
      sum(source_amount_minor) filter (
        where source_type = v_source_type
      ),
      0
    )::integer
  into
    v_already_adjusted,
    v_same_type_adjusted,
    v_same_type_source_amount
  from public.affiliate_commission_adjustments
  where commission_id = v_commission.id;

  v_remaining :=
    greatest(
      v_commission.commission_amount_minor - v_already_adjusted,
      0
    );

  if v_remaining <= 0 then
    return null;
  end if;

  /*
   * Calculate each source type against its cumulative reversed principal.
   *
   * Example:
   * 33.33% refund + 33.33% refund + 33.34% refund
   * must equal exactly 100% of the original commission.
   *
   * This avoids one-cent drift caused by independently rounding each
   * partial financial reversal.
   */
  v_target_adjustment :=
    round(
      v_commission.commission_amount_minor::numeric
      * least(
          v_same_type_source_amount + p_source_amount_minor,
          p_source_total_minor
        )::numeric
      / p_source_total_minor::numeric
    )::integer;

  v_adjustment :=
    least(
      greatest(
        v_target_adjustment - v_same_type_adjusted,
        0
      ),
      v_remaining
    );

  if v_adjustment <= 0 then
    return null;
  end if;

  insert into public.affiliate_commission_adjustments(
    commission_id,
    adjustment_type,
    amount_minor,
    currency,
    reason,
    created_by,
    source_type,
    source_id,
    source_amount_minor,
    source_total_minor,
    metadata
  )
  values (
    v_commission.id,
    v_source_type,
    v_adjustment,
    v_commission.currency,
    coalesce(nullif(trim(p_reason), ''), 'Stripe financial reversal'),
    null,
    v_source_type,
    trim(p_source_id),
    p_source_amount_minor,
    p_source_total_minor,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id
    into v_id
    from public.affiliate_commission_adjustments
    where source_type = v_source_type
      and source_id = trim(p_source_id)
    limit 1;
  end if;

  return v_id;
end;
$$;


revoke all
on function public.record_affiliate_system_adjustment(
  text,
  text,
  text,
  integer,
  integer,
  text,
  jsonb
)
from public, anon, authenticated;

grant execute
on function public.record_affiliate_system_adjustment(
  text,
  text,
  text,
  integer,
  integer,
  text,
  jsonb
)
to service_role;


revoke all
on function public.protect_affiliate_adjustment_truth()
from public, anon, authenticated;

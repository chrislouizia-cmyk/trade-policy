import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/108_affiliate_foundation.sql'),
  'utf8',
)

const sql = migration
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()

test('uses the discovered canonical affiliate schema, not affiliate_accounts', () => {
  for (const table of [
    'affiliate_profiles',
    'affiliate_referral_touches',
    'affiliate_referrals',
    'affiliate_commissions',
    'affiliate_commission_adjustments',
    'affiliate_payouts',
    'affiliate_payout_items',
    'affiliate_audit_events',
  ]) {
    assert.match(sql, new RegExp(`public\\.${table}`))
  }

  assert.doesNotMatch(sql, /public\.affiliate_accounts/)
  assert.doesNotMatch(sql, /affiliate_account_id/)
})

test('affiliate profiles require approval before attribution', () => {
  assert.match(
    sql,
    /status text not null default 'pending'/,
  )

  assert.match(
    sql,
    /status in \( 'pending', 'approved', 'rejected', 'suspended', 'paused', 'disabled' \)/,
  )

  assert.match(
    sql,
    /status = 'approved'/,
  )
})

test('referral attribution is first-touch and self-referral protected', () => {
  assert.match(
    sql,
    /create or replace function public\.bind_affiliate_referral/,
  )

  assert.match(
    sql,
    /affiliate_self_referral/,
  )

  assert.match(
    sql,
    /cookie_expires_at > v_now/,
  )

  assert.match(
    sql,
    /is_active = true/,
  )

  assert.match(
    sql,
    /is_self_referral = false/,
  )

  assert.match(
    sql,
    /where referred_user_id = p_referred_user_id/,
  )

  assert.match(
    sql,
    /order by first_touch_at asc/,
  )
})

test('referral economic origin becomes immutable', () => {
  assert.match(
    sql,
    /create or replace function public\.protect_affiliate_referral_truth/,
  )

  for (const field of [
    'old.affiliate_id is distinct from new.affiliate_id',
    'old.referred_user_id is distinct from new.referred_user_id',
    'old.touch_id is distinct from new.touch_id',
    'old.attributed_at is distinct from new.attributed_at',
    'old.account_created_at is distinct from new.account_created_at',
    'old.immutable_at is distinct from new.immutable_at',
  ]) {
    assert.ok(sql.includes(field), `missing immutable field check: ${field}`)
  }

  assert.match(sql, /affiliate_referral_attribution_immutable/)
})

test('first successful payment can only be established once', () => {
  assert.match(
    sql,
    /old\.first_successful_payment_at is not null/,
  )

  assert.match(
    sql,
    /affiliate_first_payment_immutable/,
  )
})

test('database owns the fixed 10 percent commission calculation', () => {
  assert.match(
    sql,
    /alter column commission_rate set default 0\.100000/,
  )

  assert.match(
    sql,
    /v_commission := round\(p_eligible_amount_minor::numeric \* 0\.10\)::integer/,
  )

  assert.match(
    sql,
    /0\.100000/,
  )
})

test('commission eligibility is fixed to twelve months from first successful payment', () => {
  assert.match(
    sql,
    /v_window_end := v_first_payment \+ interval '12 months'/,
  )

  assert.match(
    sql,
    /p_eligible_from >= v_window_end/,
  )

  assert.match(
    sql,
    /affiliate_commission_outside_eligibility_window/,
  )
})

test('first paid invoice starts the clock exactly once', () => {
  assert.match(
    sql,
    /coalesce\(v_referral\.first_successful_payment_at, p_eligible_from\)/,
  )

  assert.match(
    sql,
    /if v_referral\.first_successful_payment_at is null then/,
  )

  assert.match(
    sql,
    /first_successful_payment_at = v_first_payment/,
  )
})

test('Stripe invoice id is the economic commission idempotency key', () => {
  assert.match(
    sql,
    /create unique index if not exists affiliate_commissions_invoice_uidx on public\.affiliate_commissions\(stripe_invoice_id\)/,
  )

  assert.match(
    sql,
    /on conflict \(stripe_invoice_id\) do nothing/,
  )

  assert.match(
    sql,
    /where stripe_invoice_id = p_stripe_invoice_id/,
  )
})

test('commission lineage must match referral affiliate', () => {
  assert.match(
    sql,
    /v_referral\.affiliate_id <> p_affiliate_id/,
  )

  assert.match(
    sql,
    /affiliate_commission_lineage_mismatch/,
  )
})

test('commission ledger economic truth cannot be rewritten or deleted', () => {
  assert.match(
    sql,
    /create or replace function public\.protect_affiliate_commission_truth/,
  )

  assert.match(
    sql,
    /if tg_op = 'delete' then/,
  )

  assert.match(
    sql,
    /affiliate_commission_ledger_append_only/,
  )

  for (const field of [
    'old.affiliate_id is distinct from new.affiliate_id',
    'old.referral_id is distinct from new.referral_id',
    'old.stripe_invoice_id is distinct from new.stripe_invoice_id',
    'old.currency is distinct from new.currency',
    'old.eligible_amount_minor is distinct from new.eligible_amount_minor',
    'old.commission_amount_minor is distinct from new.commission_amount_minor',
    'old.commission_rate is distinct from new.commission_rate',
    'old.eligible_from is distinct from new.eligible_from',
    'old.eligible_until is distinct from new.eligible_until',
    'old.hold_until is distinct from new.hold_until',
    'old.created_at is distinct from new.created_at',
  ]) {
    assert.ok(sql.includes(field), `missing commission truth field: ${field}`)
  }

  assert.match(
    sql,
    /affiliate_commission_economic_truth_immutable/,
  )

  assert.match(
    sql,
    /before delete on public\.affiliate_commissions/,
  )
})

test('commission maturity preserves the hold period', () => {
  assert.match(
    sql,
    /where status = 'pending' and hold_until <= now\(\)/,
  )

  assert.match(
    sql,
    /status = 'available'/,
  )

  assert.match(
    sql,
    /commission matured after hold period/,
  )
})

test('refunds and reversals are represented as adjustments', () => {
  assert.match(
    sql,
    /public\.affiliate_commission_adjustments/,
  )

  assert.match(
    sql,
    /a\.commission_id = c\.id/,
  )

  assert.match(
    sql,
    /c\.commission_amount_minor - coalesce/,
  )

  assert.match(
    sql,
    /revoke all on function public\.record_affiliate_adjustment\( uuid, text, integer, text, text, uuid \) from public, anon, authenticated/,
  )

  assert.match(
    sql,
    /grant execute on function public\.record_affiliate_adjustment\( uuid, text, integer, text, text, uuid \) to service_role/,
  )
})

test('affiliate balances use net commission after adjustments', () => {
  assert.match(
    sql,
    /create or replace function public\.affiliate_balances/,
  )

  assert.match(
    sql,
    /commission_net as/,
  )

  assert.match(
    sql,
    /greatest\( c\.commission_amount_minor - coalesce/,
  )
})

test('payouts preserve exact commission lineage through payout items', () => {
  assert.match(
    sql,
    /public\.affiliate_payout_items/,
  )

  assert.match(
    sql,
    /commission_id uuid not null references public\.affiliate_commissions\(id\) on delete restrict/,
  )

  assert.match(
    sql,
    /create unique index if not exists affiliate_payout_items_commission_uidx on public\.affiliate_payout_items\(commission_id\)/,
  )
})

test('all affiliate tables have RLS enabled', () => {
  for (const table of [
    'affiliate_profiles',
    'affiliate_referral_touches',
    'affiliate_referrals',
    'affiliate_commissions',
    'affiliate_commission_adjustments',
    'affiliate_payouts',
    'affiliate_payout_items',
    'affiliate_audit_events',
  ]) {
    assert.ok(
      sql.includes(`alter table public.${table} enable row level security`),
      `RLS not explicitly enabled for ${table}`,
    )
  }
})

test('authenticated affiliate reads are ownership scoped', () => {
  assert.match(
    sql,
    /create policy "affiliate profiles select own"/,
  )

  assert.match(
    sql,
    /auth\.uid\(\)/,
  )

  assert.match(
    sql,
    /create policy "affiliate referrals select own affiliate"/,
  )

  assert.match(
    sql,
    /create policy "affiliate commissions select own affiliate"/,
  )

  assert.match(
    sql,
    /create policy "affiliate payouts select own affiliate"/,
  )

  assert.match(
    sql,
    /create policy "affiliate payout items select own affiliate"/,
  )
})

test('financial mutation functions are restricted to service_role', () => {
  for (const fn of [
    'record_affiliate_commission',
    'mature_affiliate_commissions',
    'record_affiliate_adjustment',
    'create_affiliate_payout',
    'record_affiliate_payout_item',
    'record_affiliate_audit_event',
  ]) {
    assert.ok(
      sql.includes(`grant execute on function public.${fn}`),
      `missing explicit grant for ${fn}`,
    )
  }

  assert.match(
    sql,
    /record_affiliate_commission[\s\S]*to service_role/,
  )
})

test('unsafe legacy direct attribution is no longer callable by clients', () => {
  assert.match(
    sql,
    /revoke all on function public\.attribute_affiliate_referral\(uuid, uuid, uuid\) from public, anon, authenticated/,
  )
})

test('trusted referral binding is service-role only', () => {
  assert.match(
    sql,
    /revoke all on function public\.bind_affiliate_referral\( text, uuid, text, timestamptz \) from public, anon, authenticated/,
  )

  assert.match(
    sql,
    /grant execute on function public\.bind_affiliate_referral\( text, uuid, text, timestamptz \) to service_role/,
  )
})


test('invoice replay is resolved before first-payment clock mutation', () => {
  const replayLookup = sql.indexOf(
    'where stripe_invoice_id = p_stripe_invoice_id limit 1;'
  )
  const referralLock = sql.indexOf(
    'from public.affiliate_referrals where id = p_referral_id for update;'
  )
  const firstPaymentMutation = sql.indexOf(
    'first_successful_payment_at = v_first_payment'
  )

  assert.ok(replayLookup >= 0, 'missing pre-mutation invoice replay lookup')
  assert.ok(referralLock >= 0, 'missing referral lock')
  assert.ok(firstPaymentMutation >= 0, 'missing first-payment mutation')

  assert.ok(
    replayLookup < referralLock,
    'invoice replay must be resolved before referral locking/mutation'
  )

  assert.ok(
    replayLookup < firstPaymentMutation,
    'invoice replay must be resolved before first-payment clock mutation'
  )
})

test('affiliate balance SECURITY DEFINER prevents cross-affiliate reads', () => {
  assert.match(
    sql,
    /v_caller uuid := auth\.uid\(\)/,
  )

  assert.match(
    sql,
    /coalesce\(auth\.role\(\), ''\) = 'service_role'/,
  )

  assert.match(
    sql,
    /ap\.id = p_affiliate_id and ap\.user_id = v_caller/,
  )

  assert.match(
    sql,
    /affiliate_balance_forbidden/,
  )
})

test('one referral may earn multiple invoice commissions', () => {
  assert.match(
    sql,
    /drop constraint if exists affiliate_commissions_referral_id_key/,
  )

  assert.doesNotMatch(
    sql,
    /create unique index[^;]*affiliate_commissions[^;]*\(referral_id\)/,
  )

  assert.match(
    sql,
    /create unique index if not exists affiliate_commissions_invoice_uidx on public\.affiliate_commissions\(stripe_invoice_id\)/,
  )
})

test('canonical statuses support the actual affiliate lifecycle', () => {
  assert.match(
    sql,
    /status in \( 'attributed', 'earning', 'rejected', 'disputed' \)/,
  )

  assert.match(
    sql,
    /status in \( 'pending', 'available', 'paid', 'reversed', 'void' \)/,
  )

  assert.match(
    sql,
    /status in \( 'pending', 'approved', 'rejected', 'suspended', 'paused', 'disabled' \)/,
  )
})

test('financial affiliate lineage does not cascade-delete', () => {
  for (const fragment of [
    'references auth.users(id) on delete restrict',
    'references public.affiliate_profiles(id) on delete restrict',
    'references public.affiliate_commissions(id) on delete restrict',
    'references public.affiliate_payouts(id) on delete restrict',
  ]) {
    assert.ok(
      sql.includes(fragment),
      `missing deletion protection: ${fragment}`,
    )
  }
})

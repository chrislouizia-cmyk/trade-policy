-- Let strategies retain rules evaluated by brokers, calendars, indicators, or other systems.
-- Existing AUTOMATIC and MANUAL values remain valid and keep their original meaning.

alter table public.strategy_rules
  drop constraint if exists strategy_rules_evaluation_mode_check;

alter table public.strategy_rules
  add constraint strategy_rules_evaluation_mode_check
  check (evaluation_mode in ('AUTOMATIC','MANUAL','EXTERNAL'));

notify pgrst, 'reload schema';

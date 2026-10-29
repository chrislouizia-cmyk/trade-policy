-- Repair production drift left by the original CREATE TABLE IF NOT EXISTS.
-- Some environments already had customer_notes without its staff author column,
-- so the table creation succeeded without bringing the existing table up to the
-- canonical Customer 360 contract.

alter table public.customer_notes
  add column if not exists staff_user_id uuid;

do $$
begin
  alter table public.customer_notes
    add constraint customer_notes_staff_user_id_fkey
    foreign key (staff_user_id)
    references auth.users(id)
    on delete set null;
exception
  when duplicate_object then null;
end;
$$;

comment on column public.customer_notes.staff_user_id is
  'Staff identity that created the internal customer note; null only for legacy or deleted staff records.';

notify pgrst, 'reload schema';

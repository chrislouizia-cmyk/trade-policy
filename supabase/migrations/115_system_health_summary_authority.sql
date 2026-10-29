create or replace function public.staff_private_beta_report_operations_summary_v1()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_staff_permission('system.health') then
    raise exception 'System health permission denied';
  end if;

  return public.private_beta_report_operations_summary();
end;
$$;

revoke all on function public.staff_private_beta_report_operations_summary_v1()
  from public, anon;

grant execute on function public.staff_private_beta_report_operations_summary_v1()
  to authenticated;

notify pgrst, 'reload schema';

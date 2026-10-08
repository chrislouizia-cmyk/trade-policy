-- The application and PostgreSQL intentionally serialize optional strategy fields
-- differently (notably null versus omitted keys). Validate immutable identity and
-- fingerprint while continuing to build the release snapshot from locked DB rows.
do $$
declare
  function_definition text;
  updated_definition text;
  target_guard_pattern constant text := 'if\s+v_normalized_strategy\s*<>\s*v_current_strategy\s*then';
  replacement_guard constant text := 'if v_normalized_strategy ->> ''id'' is distinct from v_current_strategy ->> ''id'' then';
  current_guard_pattern constant text := 'if\s+v_normalized_strategy\s*->>\s*''id''\s+is\s+distinct\s+from\s+v_current_strategy\s*->>\s*''id''\s+then';
begin
  select pg_get_functiondef(
    'public.create_internal_marketplace_release_v1(uuid,text,text)'::regprocedure
  ) into function_definition;

  if function_definition ~* current_guard_pattern then
    updated_definition := function_definition;
  elsif function_definition ~* target_guard_pattern then
    updated_definition := regexp_replace(
      function_definition,
      target_guard_pattern,
      replacement_guard,
      'gi'
    );
  else
    raise exception 'Expected Marketplace revision guard was not found';
  end if;

  execute updated_definition;
end;
$$;

revoke all on function public.create_internal_marketplace_release_v1(uuid,text,text) from public,anon;
grant execute on function public.create_internal_marketplace_release_v1(uuid,text,text) to authenticated;

notify pgrst,'reload schema';

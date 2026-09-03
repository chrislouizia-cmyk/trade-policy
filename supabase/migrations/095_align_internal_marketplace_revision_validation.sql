-- The application and PostgreSQL intentionally serialize optional strategy fields
-- differently (notably null versus omitted keys). Validate immutable identity and
-- fingerprint while continuing to build the release snapshot from locked DB rows.
do $$
declare
  function_definition text;
  updated_definition text;
  target_guard constant text := 'IF v_normalized_strategy <> v_current_strategy THEN';
  replacement_guard constant text := 'IF v_normalized_strategy ->> ''id'' IS DISTINCT FROM v_current_strategy ->> ''id'' THEN';
begin
  select pg_get_functiondef(
    'public.create_internal_marketplace_release_v1(uuid,text,text)'::regprocedure
  ) into function_definition;

  if position(target_guard in function_definition) = 0 then
    raise exception 'Expected Marketplace revision guard was not found';
  end if;

  updated_definition := replace(function_definition, target_guard, replacement_guard);
  execute updated_definition;
end;
$$;

revoke all on function public.create_internal_marketplace_release_v1(uuid,text,text) from public,anon;
grant execute on function public.create_internal_marketplace_release_v1(uuid,text,text) to authenticated;

notify pgrst,'reload schema';

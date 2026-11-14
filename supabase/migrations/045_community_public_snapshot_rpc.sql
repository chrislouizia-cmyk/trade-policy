-- Public curated strategy snapshots, without exposing private share tables.
create or replace function public.get_community_strategy_snapshot(p_share_code uuid)
returns jsonb language sql stable security definer
set search_path = '' as $$
  select v.snapshot_json
  from public.strategy_shares s
  join public.strategy_share_versions v
    on v.share_id=s.id and v.version=s.current_version
  where s.share_code=p_share_code
    and s.share_code='baf23429-d2f4-4173-974d-4a4a7b766e3d'::uuid
    and s.status='ACTIVE' and s.license_code='PERSONAL_USE_V1'
  limit 1
$$;
revoke all on function public.get_community_strategy_snapshot(uuid) from public;
grant execute on function public.get_community_strategy_snapshot(uuid) to anon,authenticated;
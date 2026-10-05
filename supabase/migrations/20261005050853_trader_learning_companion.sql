begin;
create table public.trader_memories (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 category text not null check(category in ('PREFERENCE','CORRECTION','NOTE')),
 content text not null check(length(content) between 1 and 1000),
 created_at timestamptz not null default now()
);
create table public.trader_learning_snapshots (
 user_id uuid primary key references auth.users(id) on delete cascade,
 fingerprint text not null, summary jsonb not null, updated_at timestamptz not null default now()
);
create table public.trader_companion_sessions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 messages jsonb not null default '[]'::jsonb check(jsonb_typeof(messages)='array'),
 version integer not null default 0, updated_at timestamptz not null default now()
);
create table public.trader_companion_runs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid references public.trader_companion_sessions(id) on delete cascade,
 source text not null check(source in ('OPENAI','DETERMINISTIC')), model text, failure_code text,
 evidence_ids jsonb not null default '[]'::jsonb, response jsonb not null,
 created_at timestamptz not null default now()
);
create index trader_memories_owner_time on public.trader_memories(user_id,created_at desc);
create index trader_companion_runs_owner_time on public.trader_companion_runs(user_id,created_at desc);
alter table public.trader_memories enable row level security;
alter table public.trader_learning_snapshots enable row level security;
alter table public.trader_companion_sessions enable row level security;
alter table public.trader_companion_runs enable row level security;
revoke all on public.trader_memories,public.trader_learning_snapshots,public.trader_companion_sessions,public.trader_companion_runs from public,anon,authenticated;
grant select on public.trader_memories,public.trader_learning_snapshots,public.trader_companion_sessions,public.trader_companion_runs to authenticated;
grant all on public.trader_memories,public.trader_learning_snapshots,public.trader_companion_sessions,public.trader_companion_runs to service_role;
create policy memories_owner_read on public.trader_memories for select to authenticated using(user_id=(select auth.uid()));
create policy learning_owner_read on public.trader_learning_snapshots for select to authenticated using(user_id=(select auth.uid()));
create policy companion_session_owner_read on public.trader_companion_sessions for select to authenticated using(user_id=(select auth.uid()));
create policy companion_runs_owner_read on public.trader_companion_runs for select to authenticated using(user_id=(select auth.uid()));
alter table public.strategy_copilot_sessions add column canonical_draft jsonb;
alter table public.strategy_copilot_sessions add column version integer not null default 0;
-- Persist conversation, explicit memory and provenance together; reject stale replies.
create function public.save_trader_companion_turn(p_user_id uuid,p_session_id uuid,p_version integer,p_messages jsonb,p_source text,p_model text,p_failure_code text,p_evidence_ids jsonb,p_response jsonb,p_memory_category text default null,p_memory_content text default null)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 update public.trader_companion_sessions set messages=p_messages,version=version+1,updated_at=now()
 where id=p_session_id and user_id=p_user_id and version=p_version;
 if not found then return false; end if;
 if p_memory_category is not null then
  insert into public.trader_memories(user_id,category,content) values(p_user_id,p_memory_category,p_memory_content);
 end if;
 insert into public.trader_companion_runs(user_id,session_id,source,model,failure_code,evidence_ids,response)
 values(p_user_id,p_session_id,p_source,p_model,p_failure_code,p_evidence_ids,p_response);
 return true;
end;$$;
revoke all on function public.save_trader_companion_turn(uuid,uuid,integer,jsonb,text,text,text,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.save_trader_companion_turn(uuid,uuid,integer,jsonb,text,text,text,jsonb,jsonb,text,text) to service_role;
commit;

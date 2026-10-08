-- Keep customer signup atomic and ensure every customer auth identity receives a profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.raw_user_meta_data->>'account_type', 'customer') <> 'staff' then
    insert into public.profiles (id, email, display_name)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name')
    )
    on conflict (id) do update
      set email = excluded.email,
          display_name = coalesce(public.profiles.display_name, excluded.display_name),
          updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

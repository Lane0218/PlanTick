create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  passphrase_lookup_hash text not null unique,
  passphrase_hash text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  device_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, device_user_id)
);

create index if not exists workspace_members_device_user_id_idx
  on public.workspace_members(device_user_id);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy "members can read joined workspaces"
on public.workspaces
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspaces.id
      and wm.device_user_id = auth.uid()
  )
);

create policy "members can read their memberships"
on public.workspace_members
for select
to authenticated
using (device_user_id = auth.uid());

create or replace function public.create_workspace_with_member(
  p_user_id uuid,
  p_passphrase text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_lookup_hash text;
  v_passphrase_hash text;
begin
  if p_passphrase is null or char_length(trim(p_passphrase)) < 6 then
    raise exception 'Passphrase must be at least 6 characters.';
  end if;

  v_lookup_hash := encode(extensions.digest(trim(p_passphrase), 'sha256'), 'hex');
  v_passphrase_hash := extensions.crypt(trim(p_passphrase), extensions.gen_salt('bf'));

  insert into public.workspaces (
    passphrase_lookup_hash,
    passphrase_hash
  )
  values (
    v_lookup_hash,
    v_passphrase_hash
  )
  returning id into v_workspace_id;

  insert into public.workspace_members (
    workspace_id,
    device_user_id
  )
  values (
    v_workspace_id,
    p_user_id
  )
  on conflict do nothing;

  return v_workspace_id;
end;
$$;

create or replace function public.join_workspace_with_passphrase(
  p_user_id uuid,
  p_passphrase text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_lookup_hash text;
begin
  if p_passphrase is null or char_length(trim(p_passphrase)) < 6 then
    raise exception 'Passphrase must be at least 6 characters.';
  end if;

  v_lookup_hash := encode(extensions.digest(trim(p_passphrase), 'sha256'), 'hex');

  select id
    into v_workspace_id
  from public.workspaces
  where passphrase_lookup_hash = v_lookup_hash
    and passphrase_hash = extensions.crypt(trim(p_passphrase), passphrase_hash)
  limit 1;

  if v_workspace_id is null then
    raise exception 'Invalid passphrase.';
  end if;

  insert into public.workspace_members (
    workspace_id,
    device_user_id
  )
  values (
    v_workspace_id,
    p_user_id
  )
  on conflict do nothing;

  return v_workspace_id;
end;
$$;

grant execute on function public.create_workspace_with_member(uuid, text) to service_role;
grant execute on function public.join_workspace_with_passphrase(uuid, text) to service_role;

create or replace function public.create_workspace_with_member(
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
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Missing authenticated user.';
  end if;

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
    v_user_id
  )
  on conflict do nothing;

  return v_workspace_id;
end;
$$;

create or replace function public.join_workspace_with_passphrase(
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
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Missing authenticated user.';
  end if;

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
    v_user_id
  )
  on conflict do nothing;

  return v_workspace_id;
end;
$$;

revoke all on function public.create_workspace_with_member(uuid, text) from public;
revoke all on function public.join_workspace_with_passphrase(uuid, text) from public;

grant execute on function public.create_workspace_with_member(text) to authenticated;
grant execute on function public.join_workspace_with_passphrase(text) to authenticated;

create or replace function public.rotate_workspace_passphrase(
  p_workspace_id uuid,
  p_new_passphrase text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_lookup_hash text;
  v_passphrase_hash text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Missing authenticated user.';
  end if;

  if p_workspace_id is null then
    raise exception 'Missing workspace id.';
  end if;

  if p_new_passphrase is null or char_length(trim(p_new_passphrase)) < 6 then
    raise exception 'Passphrase must be at least 6 characters.';
  end if;

  if not exists (
    select 1
    from public.workspace_members
    where workspace_id = p_workspace_id
      and device_user_id = v_user_id
  ) then
    raise exception 'Workspace access denied.';
  end if;

  v_lookup_hash := encode(extensions.digest(trim(p_new_passphrase), 'sha256'), 'hex');
  v_passphrase_hash := extensions.crypt(trim(p_new_passphrase), extensions.gen_salt('bf'));

  update public.workspaces
  set passphrase_lookup_hash = v_lookup_hash,
      passphrase_hash = v_passphrase_hash
  where id = p_workspace_id;

  if not found then
    raise exception 'Workspace not found.';
  end if;

  return p_workspace_id;
end;
$$;

revoke all on function public.rotate_workspace_passphrase(uuid, text) from public;
grant execute on function public.rotate_workspace_passphrase(uuid, text) to authenticated;

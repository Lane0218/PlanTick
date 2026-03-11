drop policy if exists "members can read joined workspaces" on public.workspaces;

create policy "members can read joined workspaces"
on public.workspaces
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspaces.id
      and wm.device_user_id = (select auth.uid())
  )
);

drop policy if exists "members can read their memberships" on public.workspace_members;

create policy "members can read their memberships"
on public.workspace_members
for select
to authenticated
using (device_user_id = (select auth.uid()));

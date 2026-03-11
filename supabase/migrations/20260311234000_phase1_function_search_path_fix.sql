create or replace function public.set_entity_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create or replace function public.ensure_todo_category_workspace()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.category_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.categories c
    where c.id = new.category_id
      and c.workspace_id = new.workspace_id
  ) then
    raise exception 'Todo category does not belong to the same workspace.';
  end if;

  return new;
end;
$$;

create or replace function public.set_entity_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create or replace function public.ensure_todo_category_workspace()
returns trigger
language plpgsql
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

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  color text not null,
  updated_at timestamptz not null default timezone('utc', now()),
  deleted boolean not null default false
);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  category_id uuid references public.categories(id) on delete set null,
  due_date date,
  completed boolean not null default false,
  note text not null default '',
  recurrence_type text,
  updated_at timestamptz not null default timezone('utc', now()),
  deleted boolean not null default false,
  constraint todos_recurrence_type_check
    check (recurrence_type is null or recurrence_type in ('daily', 'weekly', 'monthly'))
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  date date not null,
  start_at timestamptz,
  end_at timestamptz,
  note text not null default '',
  updated_at timestamptz not null default timezone('utc', now()),
  deleted boolean not null default false,
  constraint events_time_range_check
    check (end_at is null or start_at is null or end_at >= start_at)
);

create index if not exists categories_workspace_id_idx
  on public.categories(workspace_id);

create index if not exists categories_workspace_updated_at_idx
  on public.categories(workspace_id, updated_at desc);

create index if not exists todos_workspace_id_idx
  on public.todos(workspace_id);

create index if not exists todos_workspace_updated_at_idx
  on public.todos(workspace_id, updated_at desc);

create index if not exists todos_workspace_due_date_idx
  on public.todos(workspace_id, due_date);

create index if not exists todos_category_id_idx
  on public.todos(category_id);

create index if not exists events_workspace_id_idx
  on public.events(workspace_id);

create index if not exists events_workspace_updated_at_idx
  on public.events(workspace_id, updated_at desc);

create index if not exists events_workspace_date_idx
  on public.events(workspace_id, date);

alter table public.categories enable row level security;
alter table public.todos enable row level security;
alter table public.events enable row level security;

drop policy if exists "members can manage categories" on public.categories;
create policy "members can manage categories"
on public.categories
for all
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = categories.workspace_id
      and wm.device_user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = categories.workspace_id
      and wm.device_user_id = (select auth.uid())
  )
);

drop policy if exists "members can manage todos" on public.todos;
create policy "members can manage todos"
on public.todos
for all
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = todos.workspace_id
      and wm.device_user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = todos.workspace_id
      and wm.device_user_id = (select auth.uid())
  )
);

drop policy if exists "members can manage events" on public.events;
create policy "members can manage events"
on public.events
for all
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = events.workspace_id
      and wm.device_user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = events.workspace_id
      and wm.device_user_id = (select auth.uid())
  )
);

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at
before update on public.categories
for each row
execute function public.set_entity_updated_at();

drop trigger if exists todos_set_updated_at on public.todos;
create trigger todos_set_updated_at
before update on public.todos
for each row
execute function public.set_entity_updated_at();

drop trigger if exists todos_category_workspace_check on public.todos;
create trigger todos_category_workspace_check
before insert or update on public.todos
for each row
execute function public.ensure_todo_category_workspace();

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
before update on public.events
for each row
execute function public.set_entity_updated_at();

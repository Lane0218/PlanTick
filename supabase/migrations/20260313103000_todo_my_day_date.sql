alter table public.todos
  add column if not exists my_day_date date;

create index if not exists todos_workspace_my_day_date_idx
  on public.todos(workspace_id, my_day_date);

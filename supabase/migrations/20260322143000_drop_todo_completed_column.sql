create index if not exists todos_workspace_completed_on_idx
  on public.todos(workspace_id, completed_on);

alter table public.todos
  drop column if exists completed;

alter table public.todos
  add column if not exists completed_on date;

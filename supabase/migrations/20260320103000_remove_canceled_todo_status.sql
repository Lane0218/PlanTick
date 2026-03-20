update public.todos
set status = 'blocked'
where status = 'canceled';

alter table public.todos
  drop constraint if exists todos_status_check;

alter table public.todos
  add constraint todos_status_check
  check (status in ('not_started', 'in_progress', 'completed', 'blocked'));

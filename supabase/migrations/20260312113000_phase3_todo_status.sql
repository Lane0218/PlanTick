alter table public.todos
  add column if not exists status text;

update public.todos
set status = case
  when completed then 'completed'
  else 'not_started'
end
where status is null;

alter table public.todos
  alter column status set default 'not_started';

alter table public.todos
  alter column status set not null;

alter table public.todos
  drop constraint if exists todos_status_check;

alter table public.todos
  add constraint todos_status_check
  check (status in ('not_started', 'in_progress', 'completed', 'blocked', 'canceled'));

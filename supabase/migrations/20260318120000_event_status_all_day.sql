alter table public.events
  add column if not exists status text not null default 'not_completed',
  add column if not exists all_day boolean not null default true;

update public.events
set
  status = case
    when status = 'completed' then 'completed'
    else 'not_completed'
  end,
  all_day = case
    when start_at is null and end_at is null then true
    else false
  end;

alter table public.events
  drop constraint if exists events_status_check;

alter table public.events
  add constraint events_status_check
    check (status in ('not_completed', 'completed'));

alter table public.categories
  add column if not exists sort_order integer;

with ordered_categories as (
  select
    id,
    row_number() over (
      partition by workspace_id
      order by name asc, updated_at asc, id asc
    ) - 1 as next_sort_order
  from public.categories
  where sort_order is null
)
update public.categories categories
set sort_order = ordered_categories.next_sort_order
from ordered_categories
where categories.id = ordered_categories.id;

update public.categories
set sort_order = 0
where sort_order is null;

alter table public.categories
  alter column sort_order set default 0;

alter table public.categories
  alter column sort_order set not null;

create index if not exists categories_workspace_sort_order_idx
  on public.categories(workspace_id, sort_order asc, updated_at desc);

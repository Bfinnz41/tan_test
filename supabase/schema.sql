-- Recipe Shopping List App schema
-- Run this in the Supabase SQL editor.

-- =========================================
-- Profiles (auto-created on user signup)
-- =========================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "Anyone can read profiles by email" on profiles
  for select using (true);

create policy "Users can update own profile" on profiles
  for update using (auth.uid() = id);

-- Auto-insert profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', new.email));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================
-- Recipes
-- =========================================
create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  ingredients jsonb not null default '[]'::jsonb,
  instructions text,
  servings text,
  notes text,
  is_favorite boolean not null default false,
  source_url text,
  parent_recipe_id uuid references recipes(id) on delete set null,
  modification_request text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recipes_user_id_idx on recipes(user_id);
create index if not exists recipes_favorite_idx on recipes(user_id, is_favorite) where is_favorite = true;

alter table recipes enable row level security;

create policy "Users can read own recipes" on recipes
  for select using (auth.uid() = user_id);

create policy "Users can insert own recipes" on recipes
  for insert with check (auth.uid() = user_id);

create policy "Users can update own recipes" on recipes
  for update using (auth.uid() = user_id);

create policy "Users can delete own recipes" on recipes
  for delete using (auth.uid() = user_id);

-- =========================================
-- Shopping lists
-- =========================================
create table if not exists shopping_lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Shopping List',
  created_at timestamptz not null default now()
);

create index if not exists shopping_lists_owner_idx on shopping_lists(owner_id);

alter table shopping_lists enable row level security;

-- =========================================
-- List shares
-- =========================================
create table if not exists list_shares (
  list_id uuid not null references shopping_lists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null default 'edit' check (permission in ('edit', 'view')),
  created_at timestamptz not null default now(),
  primary key (list_id, user_id)
);

create index if not exists list_shares_user_idx on list_shares(user_id);

alter table list_shares enable row level security;

-- Now define list policies that reference list_shares
create policy "Read lists user owns or has shared" on shopping_lists
  for select using (
    owner_id = auth.uid()
    or exists (
      select 1 from list_shares
      where list_shares.list_id = shopping_lists.id
        and list_shares.user_id = auth.uid()
    )
  );

create policy "Insert own lists" on shopping_lists
  for insert with check (owner_id = auth.uid());

create policy "Update lists user owns" on shopping_lists
  for update using (owner_id = auth.uid());

create policy "Delete lists user owns" on shopping_lists
  for delete using (owner_id = auth.uid());

create policy "Read shares for accessible lists" on list_shares
  for select using (
    user_id = auth.uid()
    or exists (select 1 from shopping_lists where id = list_shares.list_id and owner_id = auth.uid())
  );

create policy "Owner can add shares" on list_shares
  for insert with check (
    exists (select 1 from shopping_lists where id = list_shares.list_id and owner_id = auth.uid())
  );

create policy "Owner can remove shares" on list_shares
  for delete using (
    exists (select 1 from shopping_lists where id = list_shares.list_id and owner_id = auth.uid())
    or user_id = auth.uid()
  );

-- =========================================
-- Shopping list items
-- =========================================
create table if not exists shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references shopping_lists(id) on delete cascade,
  name text not null,
  quantity text,
  unit text,
  category text,
  notes text,
  checked boolean not null default false,
  checked_by uuid references auth.users(id) on delete set null,
  checked_at timestamptz,
  recipe_ids uuid[] not null default array[]::uuid[],
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists list_items_list_idx on shopping_list_items(list_id);

alter table shopping_list_items enable row level security;

create policy "Read items in accessible lists" on shopping_list_items
  for select using (
    exists (
      select 1 from shopping_lists l
      where l.id = shopping_list_items.list_id
        and (l.owner_id = auth.uid()
             or exists (select 1 from list_shares where list_id = l.id and user_id = auth.uid()))
    )
  );

create policy "Insert items into accessible lists" on shopping_list_items
  for insert with check (
    exists (
      select 1 from shopping_lists l
      where l.id = shopping_list_items.list_id
        and (l.owner_id = auth.uid()
             or exists (select 1 from list_shares where list_id = l.id and user_id = auth.uid() and permission = 'edit'))
    )
  );

create policy "Update items in accessible lists" on shopping_list_items
  for update using (
    exists (
      select 1 from shopping_lists l
      where l.id = shopping_list_items.list_id
        and (l.owner_id = auth.uid()
             or exists (select 1 from list_shares where list_id = l.id and user_id = auth.uid() and permission = 'edit'))
    )
  );

create policy "Delete items from accessible lists" on shopping_list_items
  for delete using (
    exists (
      select 1 from shopping_lists l
      where l.id = shopping_list_items.list_id
        and (l.owner_id = auth.uid()
             or exists (select 1 from list_shares where list_id = l.id and user_id = auth.uid() and permission = 'edit'))
    )
  );

-- Enable realtime for collaborative check-off
alter publication supabase_realtime add table shopping_list_items;
alter publication supabase_realtime add table shopping_lists;

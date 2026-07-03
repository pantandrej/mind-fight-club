-- Club listings: player/team ads posted via "Найти команду" tab
create table if not exists club_listings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  type        text not null check (type in ('player','team')),
  name        text not null,
  text        text not null,
  city        text,
  created_at  timestamptz default now()
);

alter table club_listings enable row level security;

-- Anyone can read listings
create policy "listings_select" on club_listings for select using (true);

-- Authenticated users can insert their own
create policy "listings_insert" on club_listings for insert
  with check (auth.uid() = user_id);

-- Users can delete their own
create policy "listings_delete" on club_listings for delete
  using (auth.uid() = user_id);

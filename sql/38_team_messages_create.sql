-- Create team_messages table if it doesn't exist yet (chat)
create table if not exists team_messages (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null,
  user_id     uuid references auth.users(id) on delete cascade,
  display_name text,
  content     text,
  sticker_id  text,
  msg_type    text not null default 'text' check (msg_type in ('text','sticker','system')),
  created_at  timestamptz default now()
);

create index if not exists idx_team_messages_team
  on team_messages(team_id, created_at desc);

alter table team_messages enable row level security;

-- Drop old policies if they exist
drop policy if exists "team_messages_select" on team_messages;
drop policy if exists "team_messages_insert" on team_messages;
drop policy if exists "team members read messages"  on team_messages;
drop policy if exists "team members send messages"  on team_messages;

-- Any authenticated user can read and write (team_id scoped in app)
create policy "team_messages_select" on team_messages
  for select using (auth.role() = 'authenticated');

create policy "team_messages_insert" on team_messages
  for insert with check (auth.uid() = user_id);

-- Enable realtime for this table
alter publication supabase_realtime add table team_messages;

-- Fix team_messages RLS: allow any authenticated user to read/write
-- (team membership check via team_members can silently block if table is empty)

-- Drop old restrictive policies
drop policy if exists "team members read messages"  on team_messages;
drop policy if exists "team members send messages"  on team_messages;
drop policy if exists "team_messages_select"        on team_messages;
drop policy if exists "team_messages_insert"        on team_messages;

-- Anyone authenticated can read messages (team_id is still a required filter in app)
create policy "team_messages_select" on team_messages
  for select using (auth.role() = 'authenticated');

-- Authenticated users can insert their own messages
create policy "team_messages_insert" on team_messages
  for insert with check (auth.uid() = user_id);

-- Also ensure leaderboard_clubs view exists (safe re-create)
create or replace view leaderboard_clubs as
select
  row_number() over (order by coalesce(t.total_neurons,0) desc) as rank,
  t.id,
  t.name,
  t.emoji          as avatar_emoji,
  t.city,
  coalesce(t.total_neurons, 0) as total_xp,
  count(tm.user_id)::int       as members_count
from teams t
left join team_members tm on tm.team_id = t.id
group by t.id, t.name, t.emoji, t.city, t.total_neurons
order by total_xp desc
limit 100;

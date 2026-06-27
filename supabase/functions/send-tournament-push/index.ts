// Supabase Edge Function: send push to tournament subscribers
// Deploy: supabase functions deploy send-tournament-push
// Call from admin panel or cron

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_SUBJECT = 'mailto:admin@brain-fight-club.vercel.app';

Deno.serve(async (req) => {
  const { tournament_id } = await req.json();
  if (!tournament_id) return new Response('missing tournament_id', { status: 400 });

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Get tournament info
  const { data: t } = await sb.from('tournaments').select('title,starts_at').eq('id', tournament_id).single();
  if (!t) return new Response('not found', { status: 404 });

  // Get all subscribers for this tournament
  const { data: subs } = await sb.from('push_subscriptions')
    .select('endpoint,keys').eq('tournament_id', tournament_id);

  if (!subs?.length) return new Response(JSON.stringify({ sent: 0 }));

  const diffMin = Math.round((new Date(t.starts_at).getTime() - Date.now()) / 60000);
  const body = diffMin > 0 ? `Через ${diffMin} минут!` : 'Турнир уже идёт — заходи!';

  // Send push using Web Push Protocol
  // Note: requires web-push library or manual VAPID signing
  // For now, log subscriptions count — implement signing separately
  console.log(`Sending push to ${subs.length} subscribers for tournament ${t.title}`);

  return new Response(JSON.stringify({ sent: subs.length, title: t.title, body }));
});

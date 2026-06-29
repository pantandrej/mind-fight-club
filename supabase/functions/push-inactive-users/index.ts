// Supabase Edge Function — push-inactive-users
// Sends push notifications to users inactive for 3+ days.
// Meant to be called by Supabase cron (pg_cron) once per day.
//
// Deploy:
//   supabase functions deploy push-inactive-users --no-verify-jwt
//
// Schedule via Supabase Dashboard → Database → Extensions → pg_cron:
//   SELECT cron.schedule('push-inactive-daily', '0 10 * * *',
//     $$SELECT net.http_post(
//       'https://nhmidxkohjpcnhjucuuh.supabase.co/functions/v1/push-inactive-users',
//       '{}', '{"Content-Type":"application/json","Authorization":"Bearer SERVICE_ROLE_KEY"}'
//     )$$);

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT     = Deno.env.get('VAPID_SUBJECT') || 'mailto:hi@brainfight.club';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Find users with push subscriptions who haven't played in 3+ days
  const threeDaysAgo = new Date(Date.now() - 3 * 86400_000).toISOString();
  const { data: inactive } = await sb.rpc('get_inactive_users_with_push', { cutoff: threeDaysAgo });
  if (!inactive?.length) {
    return new Response(JSON.stringify({ ok: true, sent: 0 }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const messages = [
    'Твои нейроны скучают по тебе 🧠',
    'Соперники тренируются без тебя ⚔️',
    'Ты не играл 3 дня — пора вернуться!',
    'Ты в 3 вопросах от нового рекорда 🔥',
  ];

  let sent = 0;
  const staleIds: string[] = [];

  for (const user of inactive) {
    const msg = messages[Math.floor(Math.random() * messages.length)];
    for (const sub of (user.subscriptions || [])) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify({ title: 'Brain Fight Club', body: msg, url: '/', tag: 'inactive-reminder' }),
        );
        sent++;
      } catch (e: any) {
        if (e.statusCode === 410 || e.statusCode === 404) staleIds.push(sub.id);
      }
    }
  }

  // Clean stale subscriptions
  if (staleIds.length) await sb.from('push_subscriptions').delete().in('id', staleIds);

  return new Response(JSON.stringify({ ok: true, sent, stale_removed: staleIds.length }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});

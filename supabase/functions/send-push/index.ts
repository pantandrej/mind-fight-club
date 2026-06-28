// Supabase Edge Function — send-push
// Sends a Web Push notification to one user or all subscribers of a tournament.
//
// Required Supabase secrets (set via `supabase secrets set`):
//   VAPID_PUBLIC_KEY   — same as VAPID_PUBLIC in pwa.js
//   VAPID_PRIVATE_KEY  — your VAPID private key (keep secret)
//   VAPID_SUBJECT      — mailto:you@example.com  (or your app URL)
//   SUPABASE_URL       — set automatically by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — set automatically by Supabase
//
// Payload shapes accepted:
//   { user_id, title, body, url?, tag? }          → push one user
//   { tournament_id, title, body, url?, tag? }     → push all tournament subscribers

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const { user_id, tournament_id, title, body: msgBody, url, tag } = body;

    if (!title || !msgBody) {
      return new Response(JSON.stringify({ ok: false, reason: 'missing title or body' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate caller is authenticated (service role or authenticated user)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, reason: 'unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Set VAPID details
    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@brainfight.club',
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!,
    );

    // Fetch subscriptions from DB
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let query = sb.from('push_subscriptions').select('endpoint, keys, user_id');
    if (user_id)       query = query.eq('user_id', user_id);
    else if (tournament_id) query = query.eq('tournament_id', tournament_id);
    else return new Response(JSON.stringify({ ok: false, reason: 'need user_id or tournament_id' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

    const { data: subs, error } = await query;
    if (error) throw error;
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'no_subscriptions' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = JSON.stringify({
      title,
      body:  msgBody,
      url:   url  || '/',
      tag:   tag  || 'bfc-push',
      icon:  '/icon-192.png',
      badge: '/icon-192.png',
    });

    // Send to all matching subscriptions; collect stale ones for cleanup
    const staleEndpoints: string[] = [];
    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys as { p256dh: string; auth: string } },
          payload,
        ).catch(err => {
          // 410 Gone = subscription expired
          if (err.statusCode === 410) staleEndpoints.push(sub.endpoint);
          throw err;
        })
      )
    );

    // Remove stale subscriptions
    if (staleEndpoints.length) {
      await sb.from('push_subscriptions').delete().in('endpoint', staleEndpoints);
    }

    const sent = results.filter(r => r.status === 'fulfilled').length;
    return new Response(JSON.stringify({ ok: true, sent, total: subs.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    console.error('[send-push]', e);
    return new Response(JSON.stringify({ ok: false, reason: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

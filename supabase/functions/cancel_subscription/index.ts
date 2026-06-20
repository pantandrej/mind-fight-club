// ── cancel_subscription Edge Function ────────────────────────────
// Sets cancel_at_period_end=true. Premium stays active until period ends.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization' } });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

  // Find active subscription
  const { data: sub } = await supabase.from('subscriptions')
    .select('id, plan, status, current_period_end, cancel_at_period_end')
    .eq('user_id', user.id)
    .eq('plan', 'premium')
    .eq('status', 'active')
    .single();

  if (!sub) return json({ error: 'No active Premium subscription found' }, 404);
  if (sub.cancel_at_period_end) return json({ message: 'Already set to cancel', period_end: sub.current_period_end }, 200);

  const { error: updErr } = await supabase.from('subscriptions').update({
    cancel_at_period_end: true,
    canceled_at:          new Date().toISOString(),
    updated_at:           new Date().toISOString(),
  }).eq('id', sub.id);

  if (updErr) return json({ error: updErr.message }, 500);

  // Analytics
  await supabase.from('analytics_events').insert({
    user_id:    user.id,
    event_name: 'premium_cancelled',
    properties: { subscription_id: sub.id, period_end: sub.current_period_end },
  }).then(() => {}).catch(() => {});

  return json({
    message:    'Auto-renewal cancelled. Premium active until period end.',
    period_end: sub.current_period_end,
  });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

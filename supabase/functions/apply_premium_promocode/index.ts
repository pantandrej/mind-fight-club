// ── apply_premium_promocode Edge Function ─────────────────────────
// Activates Premium via promo code. For testing and early users.
// Each user can use each code only once.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PROMO_CODES: Record<string, { days: number; description: string }> = {
  'EARLYPREMIUM': { days: 30,  description: 'Early access — 30 days' },
  'FOUNDER':      { days: 365, description: 'Founder — 1 year' },
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json();
  const code = (body.code ?? '').toUpperCase().trim();
  const promo = PROMO_CODES[code];
  if (!promo) return json({ error: 'Invalid or expired promo code' }, 400);

  // Check if user already used this code
  const { count } = await supabase.from('analytics_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('event_name', 'premium_promocode_applied')
    .eq('properties->>code', code);

  if ((count ?? 0) > 0) return json({ error: 'Promo code already used by this account' }, 409);

  // Activate Premium
  const now     = new Date();
  const end     = new Date(now);
  end.setDate(end.getDate() + promo.days);

  const { error: subErr } = await supabase.from('subscriptions').upsert({
    user_id:              user.id,
    plan:                 'premium',
    status:               'active',
    provider:             'promocode',
    amount_rub:           0,
    current_period_start: now.toISOString(),
    current_period_end:   end.toISOString(),
    next_charge_at:       null,
    cancel_at_period_end: false,
    updated_at:           now.toISOString(),
  }, { onConflict: 'user_id' });

  if (subErr) return json({ error: subErr.message }, 500);

  // Analytics
  await supabase.from('analytics_events').insert({
    user_id:    user.id,
    event_name: 'premium_promocode_applied',
    properties: { code, days: promo.days, period_end: end.toISOString() },
  }).then(() => {}).catch(() => {});

  return json({
    message:    `BFC Premium активирован на ${promo.days} дней ✅`,
    period_end: end.toISOString(),
  });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

// ── create_yookassa_payment Edge Function ─────────────────────────
// Creates a YooKassa payment and returns confirmation_url.
// Frontend NEVER activates Premium — only the webhook does.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const YOOKASSA_API = 'https://api.yookassa.ru/v3/payments';

const PLANS = {
  monthly: { productType: 'premium_monthly', amount: 299,  description: 'BFC Premium — 30 дней',        recurring: true  },
  yearly:  { productType: 'premium_yearly',  amount: 1490, description: 'BFC Premium Year — 365 дней',  recurring: false },
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Auth ──────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

  // ── Plan ──────────────────────────────────────────────────────────
  const body = await req.json().catch(() => ({}));
  const plan = PLANS[body.plan as keyof typeof PLANS];
  if (!plan) return json({ error: 'Invalid plan. Use "monthly" or "yearly"' }, 400);

  const siteUrl   = Deno.env.get('SITE_URL') ?? 'https://brain-fight-club.vercel.app';
  const returnUrl = `${siteUrl}/?premium_return=1`;

  // ── Create local payment record (pending) ─────────────────────────
  const { data: payment, error: payErr } = await supabase
    .from('payments')
    .insert({
      user_id:      user.id,
      provider:     'yookassa',
      amount_rub:   plan.amount,
      currency:     'RUB',
      status:       'pending',
      product_type: plan.productType,
      description:  plan.description,
    })
    .select('id')
    .single();

  if (payErr || !payment) return json({ error: 'Failed to create payment record' }, 500);

  // ── YooKassa API call ─────────────────────────────────────────────
  const shopId    = Deno.env.get('YOOKASSA_SHOP_ID')!;
  const secretKey = Deno.env.get('YOOKASSA_SECRET_KEY')!;

  let yk: Record<string, unknown>;
  let errText: string | undefined;

  try {
    const ykRes = await fetch(YOOKASSA_API, {
      method: 'POST',
      headers: {
        'Authorization':  'Basic ' + btoa(`${shopId}:${secretKey}`),
        'Content-Type':   'application/json',
        'Idempotence-Key': `${user.id}-${payment.id}`,
      },
      body: JSON.stringify({
        amount:              { value: plan.amount.toFixed(2), currency: 'RUB' },
        capture:             true,
        description:         plan.description,
        confirmation:        { type: 'redirect', return_url: returnUrl },
        save_payment_method: plan.recurring,
        metadata: {
          user_id:          user.id,
          local_payment_id: payment.id,
          product:          plan.productType,
          recurring:        String(plan.recurring),
        },
      }),
    });

    if (!ykRes.ok) {
      errText = await ykRes.text();
      throw new Error(`YooKassa HTTP ${ykRes.status}: ${errText}`);
    }
    yk = await ykRes.json();

  } catch (e) {
    console.error('YooKassa error:', e);
    // Mark local payment as failed — don't leave it stuck as pending
    await supabase.from('payments').update({
      status:      'failed',
      raw_payload: { error: String(e), detail: errText },
      updated_at:  new Date().toISOString(),
    }).eq('id', payment.id);
    return json({ error: 'YooKassa API error', detail: errText ?? String(e) }, 502);
  }

  const confirmationUrl   = (yk.confirmation as Record<string, unknown>)?.confirmation_url as string;
  const providerPaymentId = yk.id as string;

  // ── Save YooKassa IDs to payment ──────────────────────────────────
  await supabase.from('payments').update({
    provider_payment_id: providerPaymentId,
    confirmation_url:    confirmationUrl,
    raw_payload:         yk,
    updated_at:          new Date().toISOString(),
  }).eq('id', payment.id);

  // ── Analytics ─────────────────────────────────────────────────────
  await supabase.from('analytics_events').insert({
    user_id:    user.id,
    event_name: 'premium_checkout_created',
    properties: { plan: body.plan, amount: plan.amount, payment_id: payment.id },
  }).then(() => {}).catch(() => {});

  return json({ confirmation_url: confirmationUrl, payment_id: payment.id });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

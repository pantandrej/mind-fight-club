// ── run_subscription_renewals Edge Function ───────────────────────
// Called daily by Supabase Cron. Charges monthly Premium subscribers.
// Protected by CRON_SECRET header to prevent unauthorized invocation.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const YOOKASSA_API = 'https://api.yookassa.ru/v3/payments';

Deno.serve(async (req: Request) => {
  // ── CRON_SECRET guard ────────────────────────────────────────────
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret) {
    const incoming = req.headers.get('x-cron-secret');
    if (incoming !== cronSecret) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const now = new Date();

  // ── Find subscriptions due for renewal ───────────────────────────
  const { data: subs, error } = await supabase
    .from('subscriptions')
    .select('id, user_id, provider_payment_method_id, amount_rub, current_period_end, next_charge_at')
    .eq('plan', 'premium')
    .eq('status', 'active')
    .eq('cancel_at_period_end', false)
    .eq('provider', 'yookassa')
    .eq('amount_rub', 299)
    .not('provider_payment_method_id', 'is', null)
    .lte('next_charge_at', now.toISOString());

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!subs?.length) return new Response(JSON.stringify({ renewed: 0, failed: 0, skipped: 0 }), { status: 200 });

  const shopId    = Deno.env.get('YOOKASSA_SHOP_ID')!;
  const secretKey = Deno.env.get('YOOKASSA_SECRET_KEY')!;

  let renewed = 0, failed = 0, skipped = 0;

  for (const sub of subs) {
    // ── Idempotency: skip if already pending/succeeded this period ──
    const { count } = await supabase
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('subscription_id', sub.id)
      .in('status', ['pending', 'succeeded'])
      .gte('created_at', sub.current_period_end);

    if ((count ?? 0) > 0) { skipped++; continue; }

    // ── Create pending payment record ─────────────────────────────
    const { data: pay, error: payErr } = await supabase.from('payments').insert({
      user_id:         sub.user_id,
      subscription_id: sub.id,
      provider:        'yookassa',
      amount_rub:      299,
      currency:        'RUB',
      status:          'pending',
      product_type:    'premium_monthly_renewal',
      description:     'BFC Premium — продление',
    }).select('id').single();

    if (payErr || !pay) { failed++; continue; }

    // ── Charge via YooKassa ───────────────────────────────────────
    let yk: Record<string, unknown>;
    try {
      const ykRes = await fetch(YOOKASSA_API, {
        method: 'POST',
        headers: {
          'Authorization':  'Basic ' + btoa(`${shopId}:${secretKey}`),
          'Content-Type':   'application/json',
          'Idempotence-Key': `renewal-${sub.id}-${pay.id}`,
        },
        body: JSON.stringify({
          amount:            { value: '299.00', currency: 'RUB' },
          capture:           true,
          description:       'BFC Premium — продление',
          payment_method_id: sub.provider_payment_method_id,
          metadata: {
            user_id:         sub.user_id,
            subscription_id: sub.id,
            product:         'premium_monthly_renewal',
            renewal:         'true',
          },
        }),
      });
      yk = await ykRes.json();
    } catch (e) {
      console.error('YooKassa request failed for sub', sub.id, e);
      await supabase.from('payments').update({ status: 'failed', updated_at: now.toISOString() }).eq('id', pay.id);
      failed++; continue;
    }

    // Update payment record
    await supabase.from('payments').update({
      provider_payment_id: yk.id as string,
      status: yk.status === 'succeeded' ? 'succeeded' : yk.status === 'canceled' ? 'canceled' : 'pending',
      raw_payload: yk,
      updated_at:  now.toISOString(),
    }).eq('id', pay.id);

    if (yk.status === 'succeeded') {
      const newEnd = new Date(now); newEnd.setDate(newEnd.getDate() + 30);
      await supabase.from('subscriptions').update({
        current_period_start: now.toISOString(),
        current_period_end:   newEnd.toISOString(),
        next_charge_at:       newEnd.toISOString(),
        last_payment_id:      pay.id,
        updated_at:           now.toISOString(),
      }).eq('id', sub.id);

      await supabase.from('analytics_events').insert({
        user_id: sub.user_id, event_name: 'premium_renewal_succeeded',
        properties: { subscription_id: sub.id },
      }).then(() => {}).catch(() => {});
      renewed++;

    } else if (yk.status === 'canceled' || yk.status === 'failed') {
      const isPeriodOver = new Date(sub.current_period_end) < now;
      await supabase.from('subscriptions').update({
        status: isPeriodOver ? 'past_due' : 'active',
        updated_at: now.toISOString(),
      }).eq('id', sub.id);

      await supabase.from('analytics_events').insert({
        user_id: sub.user_id, event_name: 'premium_renewal_failed',
        properties: { subscription_id: sub.id, yk_status: yk.status },
      }).then(() => {}).catch(() => {});
      failed++;
    }
    // If pending — webhook will handle the final state
  }

  return new Response(JSON.stringify({ renewed, failed, skipped, total: subs.length }), { status: 200 });
});

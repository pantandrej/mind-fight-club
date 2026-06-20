// ── yookassa_webhook Edge Function ────────────────────────────────
// Receives YooKassa webhook events, activates/cancels Premium.
// This is the ONLY place that sets plan='premium' — NEVER the frontend.
//
// Idempotency: if event exists and processed=true → skip (200 OK)
//              if event exists and processed=false → retry processing
//              if event is new → create and process

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return new Response('Bad JSON', { status: 400 }); }

  const eventType         = payload.event as string;
  const ykPayment         = (payload.object ?? {}) as Record<string, unknown>;
  const providerPaymentId = ykPayment.id as string;

  // ── Idempotency: check existing event ────────────────────────────
  const { data: existingEvent } = await supabase
    .from('billing_events')
    .select('id, processed')
    .eq('provider', 'yookassa')
    .eq('provider_payment_id', providerPaymentId)
    .eq('event_type', eventType)
    .maybeSingle();

  if (existingEvent?.processed === true) {
    // Already successfully processed — safe to return 200 without reprocessing
    return new Response('OK', { status: 200 });
  }

  let eventId: string;

  if (!existingEvent) {
    // New event — insert it
    const { data: inserted, error: insErr } = await supabase
      .from('billing_events')
      .insert({
        provider:            'yookassa',
        event_type:          eventType,
        provider_payment_id: providerPaymentId,
        payload,
        processed:           false,
      })
      .select('id')
      .single();

    if (insErr) {
      // Race condition: another instance inserted first — retry check
      const { data: raceCheck } = await supabase
        .from('billing_events')
        .select('id, processed')
        .eq('provider_payment_id', providerPaymentId)
        .eq('event_type', eventType)
        .maybeSingle();
      if (raceCheck?.processed === true) return new Response('OK', { status: 200 });
      eventId = raceCheck?.id ?? '';
    } else {
      eventId = inserted.id;
    }
  } else {
    // Exists but not processed — retry
    eventId = existingEvent.id;
    console.log(`Retrying unprocessed event ${eventId} for ${providerPaymentId}`);
  }

  // ── Process event ─────────────────────────────────────────────────
  let processingError: string | null = null;

  try {
    if (eventType === 'payment.succeeded') {
      await handlePaymentSucceeded(supabase, ykPayment, providerPaymentId);
    } else if (eventType === 'payment.canceled') {
      await handlePaymentCanceled(supabase, providerPaymentId);
    }

    // Mark as processed
    await supabase.from('billing_events').update({
      processed:  true,
      error:      null,
      updated_at: new Date().toISOString(),
    }).eq('id', eventId);

  } catch (e) {
    processingError = String(e);
    console.error('webhook processing error:', processingError);
    await supabase.from('billing_events').update({
      error:      processingError,
      updated_at: new Date().toISOString(),
    }).eq('id', eventId);
    // Return 500 so YooKassa retries — processed stays false
    return new Response('Processing error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
});

async function handlePaymentSucceeded(
  supabase: ReturnType<typeof createClient>,
  ykPayment: Record<string, unknown>,
  providerPaymentId: string,
) {
  // Find local payment
  const { data: localPay } = await supabase.from('payments')
    .select('id, user_id, product_type, subscription_id, amount_rub')
    .eq('provider_payment_id', providerPaymentId)
    .single();

  if (!localPay) {
    throw new Error(`Payment not found for provider_payment_id: ${providerPaymentId}`);
  }

  // ── Verify amount and currency (security: prevent activation on wrong amount) ──
  const ykAmount   = (ykPayment.amount as Record<string, unknown> | undefined);
  const ykValue    = parseFloat((ykAmount?.value as string) ?? '0');
  const ykCurrency = (ykAmount?.currency as string)?.toUpperCase() ?? '';

  if (ykCurrency !== 'RUB') throw new Error(`Invalid currency: ${ykCurrency}`);
  if (Math.abs(ykValue - localPay.amount_rub) > 0.01) {
    throw new Error(`Amount mismatch: expected ${localPay.amount_rub} RUB, got ${ykValue} ${ykCurrency}`);
  }

  // ── Verify payment status ──────────────────────────────────────────
  if (ykPayment.status !== 'succeeded') {
    throw new Error(`Unexpected payment status: ${ykPayment.status}`);
  }

  const paymentMethod    = (ykPayment.payment_method as Record<string, unknown> | undefined);
  const paymentMethodId  = paymentMethod?.id as string | undefined;
  const now              = new Date();

  // Update local payment
  await supabase.from('payments').update({
    status:                     'succeeded',
    provider_payment_method_id: paymentMethodId ?? null,
    raw_payload:                ykPayment,
    updated_at:                 now.toISOString(),
  }).eq('id', localPay.id);

  const isMonthly = localPay.product_type?.includes('monthly');
  const isYearly  = localPay.product_type?.includes('yearly');
  if (!isMonthly && !isYearly) throw new Error(`Unknown product_type: ${localPay.product_type}`);

  const periodEnd = new Date(now);
  if (isMonthly) periodEnd.setDate(periodEnd.getDate() + 30);
  else            periodEnd.setDate(periodEnd.getDate() + 365);

  const nextCharge = isMonthly ? periodEnd.toISOString() : null;

  // Upsert subscription — service_role bypasses RLS (frontend cannot do this)
  const { error: subErr } = await supabase.from('subscriptions').upsert({
    user_id:                    localPay.user_id,
    plan:                       'premium',
    status:                     'active',
    provider:                   'yookassa',
    provider_payment_method_id: isMonthly ? (paymentMethodId ?? null) : null,
    amount_rub:                 isMonthly ? 299 : 1490,
    current_period_start:       now.toISOString(),
    current_period_end:         periodEnd.toISOString(),
    next_charge_at:             nextCharge,
    cancel_at_period_end:       false,
    last_payment_id:            localPay.id,
    updated_at:                 now.toISOString(),
  }, { onConflict: 'user_id' });

  if (subErr) throw new Error(`Subscription upsert failed: ${subErr.message}`);

  // Analytics
  await supabase.from('analytics_events').insert({
    user_id:    localPay.user_id,
    event_name: 'premium_activated',
    properties: { product: localPay.product_type, period_end: periodEnd.toISOString(), provider_payment_id: providerPaymentId },
  }).then(() => {}).catch(() => {});

  console.log(`Premium activated for user ${localPay.user_id} until ${periodEnd.toISOString()}`);
}

async function handlePaymentCanceled(
  supabase: ReturnType<typeof createClient>,
  providerPaymentId: string,
) {
  await supabase.from('payments').update({
    status:     'canceled',
    updated_at: new Date().toISOString(),
  }).eq('provider_payment_id', providerPaymentId);
  // DO NOT activate Premium on cancellation
}

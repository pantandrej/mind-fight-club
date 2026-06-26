# Edge Functions — деплой

## Предварительно: SQL миграции

Перед деплоем функций запусти в Supabase SQL Editor (в порядке):
1. `sql/06_schema_billing.sql` — таблицы payments, subscriptions, billing_events

## Переменные окружения

В Supabase Dashboard → Project Settings → Edge Functions → Secrets добавь:

```
YOOKASSA_SHOP_ID       = <ID магазина из личного кабинета ЮKassa>
YOOKASSA_SECRET_KEY    = <секретный ключ из ЮKassa>
SITE_URL               = https://brain-fight-club.vercel.app
```

`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` добавляются автоматически.

## Деплой через Supabase CLI

```bash
# Установи CLI если нет
npm install -g supabase

# Войди в аккаунт
supabase login

# Ссылка с проектом
supabase link --project-ref nhmidxkohjpcnhjucuuh

# Деплой всех функций
supabase functions deploy create_yookassa_payment
supabase functions deploy yookassa_webhook
supabase functions deploy cancel_subscription
supabase functions deploy apply_premium_promocode
supabase functions deploy run_subscription_renewals
```

## Webhook в ЮKassa

В личном кабинете ЮKassa → Настройки магазина → HTTP-уведомления:

URL для уведомлений:
```
https://nhmidxkohjpcnhjucuuh.supabase.co/functions/v1/yookassa_webhook
```

События для подписки:
- `payment.succeeded`
- `payment.canceled`

## Проверка

После деплоя открой Premium-экран в приложении → нажми "Оформить за 299 ₽" → должен открыться виджет оплаты ЮKassa.

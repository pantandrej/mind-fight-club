# send-push Edge Function

Отправляет Web Push уведомление одному пользователю или всем подписчикам турнира.

## Деплой (один раз)

### 1. Сгенерировать VAPID ключи

```bash
npx web-push generate-vapid-keys
```

Скопируй Public Key и Private Key из вывода.

> Public Key уже вставлен в `js/pwa.js` как `VAPID_PUBLIC`.
> Если генерируешь новую пару — обнови и там тоже.

### 2. Добавить секреты в Supabase

```bash
supabase secrets set VAPID_PUBLIC_KEY="БАЛ...ваш_публичный_ключ..."
supabase secrets set VAPID_PRIVATE_KEY="ваш_приватный_ключ"
supabase secrets set VAPID_SUBJECT="mailto:admin@brainfight.club"
```

### 3. Задеплоить функцию

```bash
supabase functions deploy send-push --no-verify-jwt
```

`--no-verify-jwt` нужен потому что функция проверяет auth header сама
(клиент передаёт Supabase anon key через `sb.functions.invoke`).

## Как вызывается

**Из matchmaking.js** — когда найден соперник в случайном баттле:
```js
sendPushToUser(opp.user_id, { title: '⚔️ Вызов!', body: '...', url: '/?duel=CODE' })
```

**Из legacy.js** — когда админ запускает официальный турнир:
```js
sendPushToTournament(tournamentId, { title: '🏆 Турнир начался!', ... })
```

## Payload

```json
{ "user_id": "uuid",        "title": "...", "body": "...", "url": "/", "tag": "bfc-push" }
{ "tournament_id": "uuid",  "title": "...", "body": "...", "url": "/", "tag": "bfc-push" }
```

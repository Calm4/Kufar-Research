# Kufar rental monitor

Мониторинг новых объявлений об аренде квартир на Kufar (re.kufar.by) с
уведомлениями в Telegram. Cloudflare Worker на TypeScript, состояние
(просмотренные id) — в Workers KV. Планировщик — внешний бесплатный
пинг-сервис (см. ниже), а не Cloudflare Cron Trigger и не GitHub Actions
(почему — см. `STATUS.md`).

## Структура

```
src/
  env.ts             — типы окружения (Env)
  hotness.ts         — чистая логика: haversine, оценка "горячести", формат сообщения
  kufar.ts           — чистый парсинг HTML/__NEXT_DATA__ (без сети)
  fetcher.ts         — единственное место с сетевым fetch() к Kufar
  telegram.ts        — отправка в Telegram (с одним ретраем), рассылка по подписчикам
  subscribers.ts     — чтение/запись списка подписчиков в KV
  telegram-webhook.ts — обработка входящих апдейтов от Telegram (/start → подписка)
  state.ts           — чтение/запись KV (seen_ids, last_run, авторизация)
  monitor.ts         — оркестрация: fetch → parse → diff → notify → save
  debug.ts           — форматирование /?debug=1 отчёта
  index.ts           — Worker entry (роутинг, HTTP)
  *.test.ts          — тесты на чистую логику (Node test runner)
```

## Деплой

1. Установи зависимости и Wrangler (локально, из `devDependencies`):

   ```bash
   npm install
   npx wrangler login
   ```

2. Создай KV namespace и подставь его id в `wrangler.toml`
   (`kv_namespaces[0].id`), если ещё не создан:

   ```bash
   npx wrangler kv namespace create KUFAR_KV
   ```

3. Задай секреты (не хранятся в репозитории):

   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put ADMIN_TOKEN
   ```

   - `ADMIN_TOKEN` — любая длинная случайная строка. **Обязателен на каждый
     запрос** (`?token=...`) — без него Worker отвечает `401`. Это защищает
     `/`, `/status`, `/?debug=1`, `/?resetLast=N` и `/telegram-webhook` от
     посторонних с URL.

4. При необходимости поменяй `SEARCH_URL` в `wrangler.toml` (город,
   валюта, размер страницы и т.д.).

5. Задеплой:

   ```bash
   npm run deploy
   ```

   Либо просто запушь в `main` — настроен автодеплой через Cloudflare
   Workers Builds (Git-интеграция).

## Подписка через /start (обязательно, иначе никто не получит уведомлений)

Бот никого не знает по умолчанию — уведомления получают только те, кто хоть
раз написал ему `/start`. Раньше был один жёстко заданный `TELEGRAM_CHAT_ID`;
теперь это список подписчиков в KV (`src/subscribers.ts`), и добавляет в него
только реальный `/start`.

Чтобы это заработало, нужно один раз зарегистрировать webhook — иначе
Telegram просто не будет присылать Worker'у входящие сообщения:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://kufarresearch.calm4.workers.dev/telegram-webhook?token=<ADMIN_TOKEN>"
```

После этого:

1. Открой бота в Telegram, нажми `/start` (или отправь `/start` вручную).
2. Бот должен ответить подтверждением подписки.
3. Каждый, кто так сделает, начнёт получать уведомления о новых объявлениях.

Проверить, что webhook зарегистрирован: `.../getWebhookInfo` (тем же
токеном бота) — поле `url` должно совпадать с адресом выше.

## Настройка планировщика (обязательно, иначе фон не работает)

Worker сам по себе ничего не опрашивает по расписанию — нужен внешний
пинг раз в 5 минут. Например, [cron-job.org](https://cron-job.org)
(бесплатно, без ограничения по количеству запусков на нужном интервале):

1. Зарегистрируйся, создай новую задачу (Cronjob).
2. URL: `https://kufarresearch.calm4.workers.dev/?token=<твой ADMIN_TOKEN>`
3. Интервал: каждые 5 минут.
4. Сохрани — готово, дальше сервис сам будет дёргать Worker.

Проверить, что реально работает, можно в любой момент, открыв
`.../status?token=...` (см. ниже) — там видно время последнего запуска.

## Проверка после деплоя

1. Открой `https://.../?token=...` в браузере — вернёт текстовый отчёт:
   HTTP-статус, размер HTML, сколько объявлений найдено, сколько новых.
2. **Первый запуск особый**: если ключ `seen_ids` в KV ещё не существует,
   Worker только инициализирует базу найденными id и НЕ шлёт уведомления
   (иначе при первом запуске в Telegram улетит сразу ~30 сообщений). Все
   последующие запуски будут присылать только реально новые id.
3. `.../status?token=...` — когда последний раз реально прошёл прогон
   (полезно, чтобы проверить, что внешний cron действительно настроен и
   бьёт по нужному URL).
4. `.../?debug=1&token=...` — если `Найдено объявлений: 0`, покажет
   фрагмент HTML/JSON, чтобы понять, что изменилось в разметке Kufar.
5. `.../?resetLast=3&token=...` — сбрасывает последние N id из базы, чтобы
   проверить отправку в Telegram без ожидания реального нового объявления.

## Локальная разработка и тесты

```bash
npm run typecheck   # tsc, без сети
npm test            # чистая логика: парсинг, оценка "горячести"
npm run dev         # wrangler dev — локальный запуск с реальными secrets/KV
```

## Логи

```bash
npx wrangler tail
```

Или Cloudflare Dashboard → Workers & Pages → kufarresearch → Observability.

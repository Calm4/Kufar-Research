# Kufar rental monitor

Cloudflare Worker that polls a Kufar (`re.kufar.by`) real-estate rental
search page on a cron schedule, tracks previously seen listing ids in
Workers KV, and sends a Telegram message for every new listing.

## Files

- `worker.js` — `scheduled` (cron) and `fetch` (manual/diagnostic) handlers.
- `wrangler.toml` — cron trigger, KV binding, `SEARCH_URL` var.

## 1. Setup & deploy

```bash
npm install

# Login to Cloudflare (opens a browser)
npx wrangler login

# Create the KV namespace, then copy the returned "id" into wrangler.toml
# (replace REPLACE_WITH_KV_NAMESPACE_ID)
npx wrangler kv namespace create KUFAR_KV

# Set secrets (never put these in wrangler.toml or commit them)
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID

# Deploy
npx wrangler deploy
```

`SEARCH_URL` in `wrangler.toml` defaults to Gomel rentals; edit it (or the
city/query params) for a different search — no code changes needed.

## 2. Manual test after deploy

Open (or curl) the deployed worker's URL:

```bash
curl https://kufar-rental-monitor.<your-subdomain>.workers.dev/
```

This runs the exact same fetch+parse+diff logic as the cron job and
returns a plain-text report: how many listings were found on the page,
how many are new, and (if any are new) sends the Telegram messages right
away. Safe to call repeatedly — ids get marked "seen" after the first run,
so a second call should report 0 new.

**If "Найдено объявлений" is 0**, the id-extraction regex doesn't match
the real HTML Kufar is returning to Cloudflare's IPs. Use the diagnostic
endpoint to see the actual response:

```bash
curl "https://kufar-rental-monitor.<your-subdomain>.workers.dev/debug-html"
curl "https://kufar-rental-monitor.<your-subdomain>.workers.dev/debug-html?offset=4000&length=8000"
```

It reports `html length`, how many raw `/vi/` substrings exist, and how
many the current regex matched — plus a slice of the HTML you can page
through with `offset`/`length`. Things to check if it's 0:

- **Blocked/challenge page**: if `html length` is small (a few KB) and
  looks like a Cloudflare/anti-bot challenge or an empty JS shell instead
  of a real search results page, Kufar is likely blocking Cloudflare
  Workers' outbound IPs specifically. In that case headers alone won't
  fix it — the options are: a residential/rotating proxy in front of the
  fetch, a different origin (Kufar's public search API, if reachable),
  or a third-party fetch/proxy service. Report back what `/debug-html`
  shows and we'll pick an approach.
- **Different URL shape**: if `/vi/` appears (`occurrences of "/vi/"` > 0)
  but `listings matched by current regex` is 0, the path structure
  changed (e.g. extra segment, different category slug, escaped slashes
  in an embedded JSON blob). Paste a snippet from `/debug-html` back and
  the regex in `extractListings()` (`worker.js`) gets adjusted to match.
- **IDs only in embedded JSON, no `<a href>`**: also visible in the
  `/debug-html` snippet — look for the id near fields like `"adId"` or
  `"id"` inside a `<script>` block instead of inside `href="...">`.

## 3. Watching it run on cron

```bash
npx wrangler tail
```

Leave this running and wait for the next `*/10 * * * *` tick, or trigger
the cron immediately for local testing with `wrangler dev --test-scheduled`
and hitting `/__scheduled` on the dev server.

## Notes on the KV data model

- Key `seen_ids` holds a JSON array of listing id strings.
- On every run, ids present on the search page but absent from
  `seen_ids` are treated as new, notified, then merged in.
- The array is trimmed to the most recent 800 ids after each update, so
  KV storage doesn't grow unbounded (old ids naturally fall off once
  they're no longer on the first page(s) of results).

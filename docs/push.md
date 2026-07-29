# Push notifications

Web Push, so it works on the same installed PWA the app already ships as — no
native build, no App Store.

```
Postgres trigger  →  send-push edge function  →  browser push service  →  device
   (row changed)        (resolves who, signs)        (Apple/Google/Mozilla)
```

The database only says *what changed*. The edge function decides *who cares* and
does the signing, because a Web Push payload has to be signed with the VAPID
private key and that key has no business inside Postgres.

## What sends a notification

| Trigger | Who gets it | Opens |
|---|---|---|
| New message | Everyone in the thread except the sender | That conversation |
| New reaction | The author of the reacted-to message | That conversation |
| New announcement | The whole roster except its author | Announcements |
| Tee time or starting hole changed | That team's members | My Team |
| Added to a team | The player added | My Team |

Renaming a team deliberately sends nothing — only logistics that change where
someone has to physically be are worth a buzz.

## The iOS constraint

**iOS only delivers Web Push to a PWA that has been added to the home screen**,
on iOS 16.4 or later. In a normal Safari tab the Push API isn't there at all.

The UI treats that as a fixable state rather than a dead end: on iPhone in a tab
the prompt reads "Add to Home Screen" instead of offering a toggle that couldn't
work. Android and desktop have no such restriction.

## Icon badge

The unread count on the home screen icon, via the Badging API. Same platform
gate as push — an installed PWA with notification permission — so anywhere push
works, the badge works, and anywhere it doesn't the calls are simply absent.

It counts unread messages plus reactions other people add to your messages.
Announcements and tee time changes still notify, but there's no read state for
them in the schema to count against.

Two halves, because no single piece of code sees both directions:

- **Up:** the service worker's `push` handler sets it. That's the only code
  running while the app is closed, which is exactly when the count changes.
  Each recipient's number differs, so `send-push` looks them all up in one call
  to `unread_totals()` and sends an individualised payload per device.
- **Down:** the app sets it whenever the inbox loads and after marking a thread
  read. Opening a thread from a notification never touches the inbox, so
  `refreshBadge()` runs there too — otherwise the icon would keep claiming
  unread messages you'd just read.

Zero clears the badge rather than setting it to `0`, which still draws a dot on
some platforms. Signing out clears it too.

The red bubble on the Messages nav tab reads the same count, from
`src/state/unread.ts`. That store is module-level rather than context on
purpose: `FloatingNav` renders on nearly every screen, so per-mount state would
mean a query on every navigation and several realtime subscriptions open at
once — and, worse, the two badges could drift apart and disagree about the same
number.

## Setup

Once per environment. Until it's done, `notify_push()` returns quietly and the
app behaves exactly as it did before push existed — nothing breaks, nothing sends.

### 1. Generate VAPID keys

```bash
npx web-push generate-vapid-keys
```

One keypair, reused forever. **Rotating it unsubscribes every device**, so keep
it somewhere safe. The public half ships in the app bundle (that's fine and by
design); the private half is a signing key and only ever lives in the edge
function's secrets.

### 2. Client env

`.env` locally, and Vercel → Settings → Environment Variables for production:

```
EXPO_PUBLIC_VAPID_PUBLIC_KEY=<public key>
```

Env vars are inlined at build time, so a change here needs a redeploy. Leave it
blank to ship without push — the toggle and prompt hide themselves.

### 3. Edge function secrets

```bash
supabase secrets set \
  VAPID_PUBLIC_KEY=<public key> \
  VAPID_PRIVATE_KEY=<private key> \
  VAPID_SUBJECT=mailto:you@example.com \
  PUSH_HOOK_SECRET=$(openssl rand -hex 32)
```

`PUSH_HOOK_SECRET` is what proves a request to the function actually came from
our database. Keep the value — step 5 needs the same one.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically; don't
set them, and don't put the service role key anywhere else.

### 4. Deploy the function

```bash
supabase functions deploy send-push
```

`supabase/config.toml` already sets `verify_jwt = false` for it — the caller is
Postgres, which has no JWT, and the shared secret is the check instead. If you
deploy without the config file for any reason, pass `--no-verify-jwt`.

### 5. Run the migrations

`0011_push.sql` creates the subscriptions table, its RLS policies, and the four
triggers. `0012_push_config.sql` adds the config table the dispatcher reads.
`0013_unread_totals.sql` adds the per-recipient unread count the badge needs.

### 6. Point the database at it

```sql
insert into push_config (key, value) values
  ('push_hook_url',    'https://<project-ref>.supabase.co/functions/v1/send-push'),
  ('push_hook_secret', '<the PUSH_HOOK_SECRET from step 3>')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

Takes effect on the next trigger — no restart, no waiting for connections to
cycle.

> Config lives in a table rather than `alter database ... set app.x`, which is
> what Supabase's webhook docs suggest. On a managed project the `postgres` role
> isn't a superuser and that statement fails with `42501 permission denied`.

Check it landed (this never returns the secret itself, only whether one is set):

```sql
select * from push_config_status();
```

## Testing

### Desktop Chrome — fastest loop

Everything works in a normal tab, so this is where to iterate.

1. Open the app, sign in, go to **Messages**. The green prompt appears; hit
   **ALLOW** and accept Chrome's permission dialog.
2. Confirm the row landed:
   ```sql
   select user_id, left(endpoint, 60), created_at from push_subscriptions;
   ```
3. Send a message from a second browser (or a private window signed in as
   another player). The notification should appear within a second or two.

To watch it end to end:

```bash
supabase functions logs send-push
```

A successful call returns `{ sent: n, pruned: n }`. `sent: 0` means the payload
resolved but nobody in the recipient list had a registered device.

### iPhone — the one that actually matters

Must be a **real device**; the simulator's push support isn't reliable enough to
trust a negative result.

1. Open the deployed site in Safari.
2. **Share → Add to Home Screen.**
3. Open the app **from the home screen icon**, not from Safari.
4. Messages → **ALLOW**.
5. Background the app entirely (swipe up), then have someone send you a message.

If you'd previously installed the PWA, delete it and clear the site data under
**Settings → Safari → Advanced → Website Data** first — an old cached service
worker won't have the `push` handler in it.

### Firing one by hand

Skips the app entirely, useful for isolating whether the problem is the trigger
or the function:

```bash
curl -X POST 'https://<project-ref>.supabase.co/functions/v1/send-push' \
  -H 'Content-Type: application/json' \
  -H 'x-push-secret: <PUSH_HOOK_SECRET>' \
  -d '{"type":"message","id":"<a real message uuid>"}'
```

## When nothing arrives

Work down this list — it's ordered by how often each one is the answer.

- **Nothing at all on iPhone** — opened from the home screen icon, or from
  Safari? A tab silently can't. This is the usual cause.
- **Stale service worker** — the `push` handler arrived in worker `v2`. A device
  running `v1` receives nothing. Delete the installed app and clear website data.
- **`sent: 0` in the logs** — the event resolved but no recipient had a device
  registered. Check `push_subscriptions` actually has rows for those users.
- **Function never called** — no `push_hook_url` row. Verify with
  `select * from push_config_status();`
- **403 in the function logs** — the `PUSH_HOOK_SECRET` given to the CLI and the
  `push_hook_secret` row disagree.
- **Subscription vanishes on its own** — expected. A 404/410 from the push
  service means that device threw its subscription away, and the row is pruned so
  it isn't retried forever. The device re-registers next time the app opens.

## Notes

- Signing out deletes this device's subscription, so the next person to sign in
  on a shared phone doesn't inherit the last one's alerts.
- Push endpoints rotate without warning, and a stale one fails silently — every
  launch re-asserts the current endpoint (`syncPush()` in `src/app/_layout.tsx`).
- Notifications are collapsed per conversation, so a busy thread replaces its own
  notification rather than stacking twenty on the lock screen.
- Delivery is entirely best-effort and deliberately kept off the scoring path.
  Scores are offline-first and never depend on any of this — see
  [offline.md](offline.md).

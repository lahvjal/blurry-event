# Offline architecture

The mission-critical guarantee: **a golfer can enter and edit scores with no
signal, and a score is never lost** — not by closing the app, not by a dead
battery, not by four hours in a pocket.

```
React / Expo Web PWA
  → IndexedDB (Dexie)        durable local writes
  → sync engine              retry + idempotent upsert
  → Supabase                 system of record
  → realtime leaderboard     nice-to-have, never a dependency
```

## Where things live

| Concern | File |
|---|---|
| Storage contracts, ids, dedupe keys | `src/lib/offline/types.ts` |
| IndexedDB implementation (web) | `src/lib/offline/store.web.ts` |
| AsyncStorage implementation (native) | `src/lib/offline/store.ts` |
| Cached event bundle | `src/lib/offline/snapshot.ts` |
| Queue, retries, connection state | `src/lib/sync.ts` |
| Service worker + manifest wiring | `src/lib/offline/pwa.web.ts`, `public/` |
| Status UI and Sync Now | `src/components/sync-status.tsx` |

Metro resolves `store.web.ts` on web and `store.ts` on native, so the rest of
the app imports one module and never branches on platform.

## Score entry path

`setScore` in `src/state/event.tsx`:

1. Updates React state — the scorecard repaints immediately.
2. `enqueue()` commits the write to IndexedDB.
3. A background flush attempts Supabase.

Nothing in steps 1–2 touches the network, so moving between holes never waits.
Step 3 failing is normal and invisible apart from the status line.

## Why nothing is lost

- The mutation is written to IndexedDB **before** the UI reports success.
- A queued mutation is deleted **only** after Supabase confirms it.
- The queue lives in IndexedDB, so it survives refresh, app closure, and device
  restart. `navigator.storage.persist()` is requested on launch so the browser
  won't evict it under storage pressure.

## Retry triggers

Background Sync is deliberately not the mechanism — iOS doesn't support it.
Retries are driven in-app:

- app launch
- app returning to the foreground (`AppState`) or tab becoming visible
- `NetInfo` reporting the network came back, and the browser `online` event
- a 30-second sweep while the app is open
- the user tapping **Sync Now**

## Connection state

`navigator.onLine` is treated as a hint, never as truth — a phone joined to a
course wifi portal reports online while nothing resolves. The engine tracks two
things: whether the OS claims a network, and whether a request has actually
succeeded. A write that fails on transport flips `serverReachable` false and the
UI says *Offline*, regardless of what the browser claims.

States: `online` · `offline` · `syncing` · `error`.

## Idempotency

Score writes are upserts on `(round_id, hole)`, which the schema already makes
unique. Retrying is therefore safe: the same write applied twice produces the
same row. Messages carry a client-generated `client_id` with a unique
constraint, so a duplicate insert (error `23505`) is treated as success.

The canonical score in this app is **one per round + hole**, where a round
belongs to a team under a scramble and to a participant under solo play. That
differs from a flat event+player+hole model, and is preserved deliberately: it
is what makes a 4-man scramble share one card.

## Editing an existing score

Every queued write carries a `dedupeKey` — `score:<event>:<entrant>:<hole>`.
Re-entering a hole updates the existing queued row rather than appending, so a
golfer changing 5 → 4 → 3 while offline sends exactly one write with the final
value. No duplicate rows, no out-of-order replay.

## Conflict handling: two devices, one hole

Both devices upsert the same `(round_id, hole)`. **The last write to reach
Supabase wins.** Each write also stores `client_updated_at`, the moment the
device recorded it, so the row records which device's entry is present and when
it was taken.

Consequences, stated plainly:

- Two teammates entering different strokes for the same hole → the one that
  syncs later is kept. It is not merged and the earlier value is not preserved.
- A phone that was offline for six holes will, on reconnect, overwrite holes a
  teammate already synced, because its writes arrive later in wall-clock terms
  even though they were taken earlier.

This is a deliberate trade for a one-day event: predictable and easy to explain
beats a correct-but-opaque merge. The practical mitigation is social — one
scorer per group, which is how scrambles are usually run anyway. If that proves
insufficient, the next step is to reject a write whose `client_updated_at` is
older than the stored one, which turns it into last-*recorded*-wins.

## What still needs a connection

By design, and acceptable for this release: messaging, the social feed, photo
upload, the realtime leaderboard, and admin screens. Realtime is never a
dependency for scoring — scores work with it switched off entirely.

## Authentication

Supabase sessions persist locally and refresh in the background, so a golfer who
signed in before the round keeps access through intermittent connectivity.
Signing in for the *first* time still requires a connection; the intended flow is
that players redeem their invite code before arriving.

## Caching policy

The service worker caches the app shell only: HTML, JS, CSS, fonts, icons.
Supabase requests are explicitly never cached — a stale cached score read could
show a golfer the wrong card and let them overwrite a teammate. Application data
belongs in IndexedDB, where the app controls staleness.

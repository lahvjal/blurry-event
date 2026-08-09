import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read(
  'supabase/migrations/20260809231702_preserve_account_chats.sql',
);

test('direct and ordinary custom chats receive durable account membership', () => {
  assert.match(migration, /create table if not exists conversation_account_members/);
  assert.match(migration, /participant\.claimed_by is null[\s\S]*raise exception 'Cannot preserve chats/);
  assert.match(migration, /sender_account_id uuid references auth\.users\(id\) on delete set null/);
  assert.match(migration, /reactor_account_id uuid references auth\.users\(id\) on delete set null/);
});

test('event deletion preserves ordinary chats but removes managed chats', () => {
  assert.match(
    migration,
    /delete from public\.conversations conversation[\s\S]*conversation\.kind = 'event_group' or conversation\.team_id is not null/,
  );
  assert.match(
    migration,
    /foreign key \(event_id\) references events\(id\) on delete set null/g,
  );
  assert.match(migration, /conversations_event_ownership_check/);
  assert.match(migration, /kind <> 'event_group' and team_id is null/);
});

test('account chat authorization is membership-bound and anonymous access is revoked', () => {
  assert.match(
    migration,
    /membership\.account_id = \(select auth\.uid\(\)\)/,
  );
  assert.match(
    migration,
    /sender_account_id = \(select auth\.uid\(\)\)[\s\S]*is_conversation_member\(conversation_id\)/,
  );
  assert.match(
    migration,
    /revoke all on function account_conversation_detail\(uuid\) from public, anon/,
  );
  assert.match(
    migration,
    /grant execute on function account_conversation_detail\(uuid\) to authenticated/,
  );
});

test('new direct and custom chats reject roster placeholders without accounts', () => {
  assert.match(
    migration,
    /if other_account is null then raise exception 'That player has not joined the app yet'/,
  );
  assert.match(
    migration,
    /Everyone in a group must have joined the app/,
  );
  assert.match(migration, /Group members must belong to the same event/);
  assert.match(migration, /Only current event participants can add people/);
});

test('legacy queued messages are normalized against authenticated account membership', () => {
  assert.match(migration, /create or replace function guard_chat_message\(\)/);
  assert.match(migration, /new\.sender_account_id := \(select auth\.uid\(\)\)/);
  assert.match(migration, /if target_event is null then[\s\S]*new\.sender_id := null/);
  const sync = read('src/lib/sync.ts');
  assert.match(sync, /mutation\.payload\.kind === 'message'/);
  assert.match(sync, /payload\.kind === 'score' &&/);
});

test('client uses account routes and account-scoped offline caches', () => {
  const messages = read('src/app/messages.tsx');
  const cache = read('src/lib/offline/chat-cache.ts');
  const chatState = read('src/state/chat.ts');
  const preparation = read('src/lib/offline/preparation.web.ts');
  assert.match(messages, /conversation\.eventOwned/);
  assert.match(messages, /pathname:[\s\S]*'\/chat'/);
  assert.match(cache, /offlineChat\.accountMessages\.v2/);
  assert.match(chatState, /loadOfflineAccountMessages/);
  assert.match(chatState, /subscribeToMessages\(null, null/);
  assert.match(
    preparation,
    /clubSummaries\.filter\(\(item\) => !item\.eventOwned\)/,
  );
  assert.match(preparation, /saveOfflineAccountMessages/);
});

test('reaction identity remains unique and realtime deletes retain account fields', () => {
  assert.match(migration, /message_reactions_account_uniq/);
  assert.match(migration, /add constraint message_reactions_pkey primary key \(id\)/);
  assert.match(migration, /alter table message_reactions replica identity full/);
});

test('push fanout and links use durable account membership for ordinary chats', () => {
  const push = read('supabase/functions/send-push/index.ts');
  assert.match(push, /from\('conversation_account_members'\)/);
  assert.match(push, /sender_account_id/);
  assert.match(push, /`\/chat\?id=\$\{conversation\.id\}/);
});

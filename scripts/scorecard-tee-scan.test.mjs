import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('scorecard editor offers a reviewed scan and multi-tee yardage tabs', async () => {
  const screen = await read('src/app/admin-holes.tsx');
  assert.match(screen, /SCAN \/ UPLOAD SCORECARD/);
  assert.match(screen, /apiExtractScorecard/);
  assert.match(screen, /MAX_SCAN_BYTES = 5 \* 1024 \* 1024/);
  assert.match(screen, /compressScorecardPhoto/);
  assert.match(screen, /ImageManipulator\.SaveFormat\.JPEG/);
  assert.match(screen, /setTeeSets\(cloneTeeSets\(extracted\.teeSets\)\)/);
  assert.match(screen, /TEE YARDAGES/);
  assert.match(screen, /SAVE SCORECARD/);
});

test('client keeps legacy scorecards readable and only falls back for one tee', async () => {
  const api = await read('src/lib/api.ts');
  assert.match(api, /from\('event_tees'\)/);
  assert.match(api, /from\('tee_yardages'\)/);
  assert.match(api, /teeSchemaAvailable/);
  assert.match(api, /teeYardageSets\.length !== 1/);
  assert.match(api, /apply_event_scorecard/);
});

test('migration uses atomic event-admin-only multi-tee application', async () => {
  const migration = await read('supabase/migrations/20260810040639_scorecard_tee_yardages_and_scan.sql');
  assert.match(migration, /create table if not exists event_tees/);
  assert.match(migration, /create table if not exists tee_yardages/);
  assert.match(migration, /create or replace function public\.apply_event_scorecard/);
  assert.match(migration, /not public\.is_event_admin\(p_event_id\)/);
  assert.match(migration, /revoke all on function public\.apply_event_scorecard/);
});

test('scan function authenticates an event admin and never persists the source image', async () => {
  const fn = await read('supabase/functions/extract-scorecard/index.ts');
  assert.match(fn, /caller\.auth\.getUser/);
  assert.match(fn, /caller\.rpc\('is_event_admin'/);
  assert.match(fn, /OPENAI_API_KEY/);
  assert.match(fn, /input_image/);
  assert.doesNotMatch(fn, /storage\.from/);
});

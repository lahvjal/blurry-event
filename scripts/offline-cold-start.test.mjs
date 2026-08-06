import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  hasCompletePreparedEventData,
  selectLocalStartupIdentity,
} from '../src/lib/offline/startup.ts';

test('a prepared account opens without a live stored session', () => {
  assert.deepEqual(selectLocalStartupIdentity('account-a', null), {
    accountId: 'account-a',
    preparedAccountId: 'account-a',
  });
});

test('a different persisted login can never inherit another account receipt', () => {
  assert.deepEqual(selectLocalStartupIdentity('account-a', 'account-b'), {
    accountId: 'account-b',
    preparedAccountId: null,
  });
});

test('prepared event data remains openable across an app-shell build update', () => {
  assert.equal(
    hasCompletePreparedEventData({
      manifestAccountId: 'account-a',
      manifestStatus: 'ready',
      selectedEventIds: ['event-1'],
      accessAccountId: 'account-a',
      accessibleEventIds: new Set(['event-1']),
      snapshotEventIds: new Set(['event-1']),
      // Build fingerprints are deliberately not part of this contract: the
      // service worker installs each shell atomically before it can run.
      buildFingerprint: 'older-ready-build',
    }),
    true,
  );
});

test('missing or cross-account snapshots cannot pass the local startup gate', () => {
  const base = {
    manifestAccountId: 'account-a',
    manifestStatus: 'ready',
    selectedEventIds: ['event-1'],
    accessibleEventIds: new Set(['event-1']),
  };
  assert.equal(
    hasCompletePreparedEventData({
      ...base,
      accessAccountId: 'account-b',
      snapshotEventIds: new Set(['event-1']),
    }),
    false,
  );
  assert.equal(
    hasCompletePreparedEventData({
      ...base,
      accessAccountId: 'account-a',
      snapshotEventIds: new Set(),
    }),
    false,
  );
});

test('startup source orders local data before server refresh and keeps ready refresh non-blocking', () => {
  const eventState = readFileSync('src/state/event.tsx', 'utf8');
  const localRead = eventState.indexOf('const preparedAccess = await loadAccountEventAccess');
  const networkRelease = eventState.indexOf(
    'releaseStartupNetworkAfterRender();',
    localRead,
  );
  const serverRead = eventState.indexOf('access = await fetchAccountEventAccess', localRead);
  assert.ok(
    localRead >= 0 && networkRelease > localRead && serverRead > networkRelease,
  );

  const supabaseClient = readFileSync('src/lib/supabase.ts', 'utf8');
  assert.match(supabaseClient, /await startupNetworkReady;/);
  assert.match(supabaseClient, /display-mode: standalone/);

  const preparationGate = readFileSync(
    'src/state/offline-preparation.web.tsx',
    'utf8',
  );
  assert.match(preparationGate, /state\.isReady \|\|/);

  const accessGate = readFileSync('src/components/pwa-access-gate.web.tsx', 'utf8');
  assert.match(accessGate, /pathname === '\/'/);
  assert.match(accessGate, /router\.replace\('\/event'\)/);
});

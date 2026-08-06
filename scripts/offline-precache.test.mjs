import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const dist = join(root, 'dist');
const workerPath = join(dist, 'sw.js');

function allFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? allFiles(path) : [path];
  });
}

function injectedManifest() {
  const worker = readFileSync(workerPath, 'utf8');
  const match = worker.match(
    /const INJECTED_PRECACHE = (\{"fingerprint":"[a-f0-9]+","entries":\[.*?\]\});\nconst FALLBACK_PRECACHE =/s,
  );
  assert.ok(match, 'the production worker must contain an injected precache manifest');
  return JSON.parse(match[1]);
}

test('offline preparation includes every exported page dependency', () => {
  const manifest = injectedManifest();
  const exportedUrls = allFiles(dist)
    .filter((path) => path !== workerPath && !path.endsWith('.map'))
    .map((path) => `/${relative(dist, path).split(sep).join('/')}`)
    .sort();
  const preparedUrls = manifest.entries
    .map((entry) => entry.url)
    .filter((url) => url !== '/')
    .sort();

  assert.deepEqual(
    preparedUrls,
    exportedUrls,
    'a newly exported route chunk or asset must be part of the initial download',
  );
  assert.ok(
    manifest.entries.some((entry) =>
      /^\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js$/.test(entry.url),
    ),
    'the Expo Router bundle containing every screen must be prepared offline',
  );
  assert.ok(
    manifest.entries.some((entry) => entry.url === '/index.html'),
    'the SPA navigation shell must be prepared offline',
  );
  assert.ok(
    manifest.entries.some((entry) => entry.url === '/'),
    'the root navigation alias must be prepared offline',
  );
});

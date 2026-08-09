import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { join } from 'node:path';

const sourceFiles = readdirSync('src', { recursive: true })
  .filter((path) => /\.(?:ts|tsx)$/.test(path))
  .map((path) => join('src', path));
const allSource = sourceFiles
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');
const login = readFileSync('src/app/index.tsx', 'utf8');

test('login exposes no development sign-in bypass', () => {
  assert.doesNotMatch(allSource, /skip[\s-]*sign[\s-]*in/i);
  assert.doesNotMatch(login, /__DEV__/);
});

test('normal session, password, and invite entry paths remain intact', () => {
  assert.match(login, /supabase\.auth\.getSession\(\)/);
  assert.match(login, /supabase\.auth\.signInWithPassword\(/);
  assert.match(login, /resolveLoginEmail\(login\)/);
  assert.match(login, /router\.replace\('\/event'\)/);
  assert.match(login, /router\.push\('\/invite'\)/);
  assert.match(login, />Member login</);
  assert.match(login, /FIRST TIME\? REDEEM INVITE CODE/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'event-focus.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const moduleUnderTest = { exports: {} };
vm.runInNewContext(
  `(function (exports, module, require) { ${compiled}\n})`,
  { Date },
)(moduleUnderTest.exports, moduleUnderTest, require);

const { selectDefaultEventFocus } = moduleUnderTest.exports;
const now = new Date(2026, 7, 1, 12);
const event = (id, eventDate, lifecycleStatus) => ({
  id,
  name: id,
  courseName: 'Test Course',
  eventDate,
  lifecycleStatus,
  registration: null,
});

assert.equal(
  selectDefaultEventFocus(
    [
      event('ended', '2026-07-30', 'completed'),
      event('upcoming', '2026-08-02', 'published'),
      event('live', '2026-07-01', 'live'),
    ],
    now,
  ).event.id,
  'live',
  'Live must outrank upcoming and ended events',
);

assert.equal(
  selectDefaultEventFocus(
    [
      event('live-far', '2026-08-10', 'live'),
      event('live-near-b', '2026-08-02', 'live'),
      event('live-near-a', '2026-08-02', 'live'),
    ],
    now,
  ).event.id,
  'live-near-a',
  'Multiple Live events use nearest date then stable ID',
);

assert.equal(
  selectDefaultEventFocus(
    [
      event('ended-recent', '2026-07-31', 'completed'),
      event('upcoming-far', '2026-08-20', 'published'),
      event('upcoming-near', '2026-08-03', 'published'),
    ],
    now,
  ).event.id,
  'upcoming-near',
  'An upcoming Published event must always outrank ended events',
);

assert.equal(
  selectDefaultEventFocus(
    [
      event('ended-old', '2026-06-01', 'archived'),
      event('ended-new', '2026-07-31', 'completed'),
    ],
    now,
  ).event.id,
  'ended-new',
  'Ended-only accounts use the most recent event',
);

const emptyFocus = selectDefaultEventFocus([], now);
assert.equal(emptyFocus.event, null);
assert.equal(
  emptyFocus.reason,
  'empty',
  'Zero accessible events produce the Home empty state',
);

console.log('event-focus verification passed');

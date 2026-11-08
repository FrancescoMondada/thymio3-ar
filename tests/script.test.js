import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HALF_MS, HALF_CHOICES, BLINK_HZ, MODES, GROUPS, CIRCLES, buildScript, groupMembers, circleMembers, countOf, isAlternating, isDual, hzOf, windowOf } from '../src/script.js';

const raw = readFileSync(new URL('../src/py/leds_lego.py', import.meta.url), 'utf8');

test('the page and the robot script agree on the half period of the blink', () => {
  const m = raw.match(/^HALF_MS = (\d+)/m);
  assert.ok(m, 'HALF_MS in leds_lego.py');
  assert.equal(Number(m[1]), HALF_MS);
  assert.ok(Math.abs(BLINK_HZ - 1000 / (2 * HALF_MS)) < 1e-12);
  assert.ok(BLINK_HZ >= 2 && BLINK_HZ <= 3, 'a few Hz: a half period lasts about 6 pictures of a camera at 30 a second (7.46 Hz was too fast for a phone)');
  for (const half of HALF_CHOICES) assert.ok(half >= 40 && Number.isInteger(half));
});

test('buildScript writes the mode into the one MODE line and nothing else', () => {
  for (const mode of MODES) {
    const text = buildScript(raw, mode);
    assert.ok(text.includes(`MODE = "${mode}"`));
    assert.equal(text.split('\n').length, raw.split('\n').length);
    assert.equal(text.replace(`MODE = "${mode}"`, 'MODE = "on"'), raw);
  }
});

test('buildScript also writes the half period and the group of LEDs, each in its one line', () => {
  const text = buildScript(raw, 'blink', 400, 2);
  assert.ok(/^HALF_MS = 400/m.test(text) && /^GROUP = 2$/m.test(text) && text.includes('MODE = "blink"'));
  assert.equal(text.split('\n').length, raw.split('\n').length);
  assert.equal(buildScript(raw, 'on', HALF_MS, -1), buildScript(raw, 'on'), 'the defaults');
  assert.throws(() => buildScript(raw, 'blink', 5), /half period/);
  assert.throws(() => buildScript(raw, 'blink', 200, 5), /group/);
  assert.throws(() => buildScript(raw.replace(/^GROUP.*$/m, ''), 'blink'), /GROUP line/);
  assert.throws(() => buildScript(raw.replace(/^CIRCLE.*$/m, ''), 'blink'), /CIRCLE line/);
  assert.throws(() => buildScript(raw, 'blink', 200, 0, 3), /ring/);
  assert.throws(() => buildScript(raw, 'blink', 200, 0, 2), /dual/, 'the dual flash is both groups at once');
  assert.throws(() => buildScript(raw, 'blink', 200, 4, 1), /dual/);
});

test('the ring: even arcs N E S W or odd arcs NE SE SW NW, 4 each, and the alternation of a group and a set', () => {
  assert.deepEqual(CIRCLES, [-1, 0, 1, 2]);
  assert.deepEqual(circleMembers(-1), []);
  assert.deepEqual(circleMembers(0).map((m) => m.i), [0, 2, 4, 6]);
  assert.deepEqual(circleMembers(1).map((m) => m.i), [1, 3, 5, 7]);
  assert.ok(circleMembers(1).every((m) => m.row === 'circle'));
  assert.equal(countOf(0, 1), 8);
  assert.equal(countOf(-2, 1), 4);
  assert.equal(countOf(-1, 0), 20);
  assert.equal(countOf(-2, -1), 0);
  assert.equal(isAlternating(0, 1), true);
  assert.equal(isAlternating(-2, 1), false, 'a ring set alone just blinks');
  assert.equal(isAlternating(0, -1), false);
  const text = buildScript(raw, 'blink', 100, 3, 1);
  assert.ok(/^CIRCLE = 1$/m.test(text) && /^GROUP = 3$/m.test(text) && /^HALF_MS = 100/m.test(text));
  assert.equal(text.split('\n').length, raw.split('\n').length);
});

test('the groups: 4 LEDs each, aligned on one row 16 mm apart, together the 16', () => {
  assert.equal(countOf(-1), 16);
  const seen = new Set();
  for (const g of [0, 1, 2, 3]) {
    const m = groupMembers(g);
    assert.equal(m.length, 4);
    assert.equal(new Set(m.map((l) => l.row)).size, 1, 'one row');
    assert.equal(m[0].row, g < 2 ? 'front' : 'back');
    for (const l of m) { const key = `${l.row}${l.i}`; assert.ok(!seen.has(key), `${key} is in one group only`); seen.add(key); }
    const cols = m.map((l) => l.i).sort((a, b) => a - b);
    for (let k = 1; k < 4; k++) assert.equal(cols[k] - cols[k - 1], 2, `group ${g}: every other LED of the row, 16 mm apart`);
  }
  assert.equal(seen.size, 16);
  assert.deepEqual(GROUPS, [-2, -1, 0, 1, 2, 3, 4]);
  assert.equal(groupMembers(-2).length, 0, 'no Lego LED');
});

test('the dual flash: the front row and the arcs N E S W, then the back row and the arcs NE SE SW NW', () => {
  assert.equal(isDual(4, 2), true);
  assert.equal(isDual(4, 1), false);
  assert.equal(isDual(0, 2), false);
  assert.equal(isAlternating(4, 2), false, 'the sets are lit together in a flash: it is not the row / ring alternation');
  const f0 = [...groupMembers(4, 0), ...circleMembers(2, 0)], f1 = [...groupMembers(4, 1), ...circleMembers(2, 1)];
  assert.deepEqual(groupMembers(4, 0).map((m) => `${m.row}${m.i}`), ['front0', 'front2', 'front4', 'front6']);
  assert.deepEqual(groupMembers(4, 1).map((m) => `${m.row}${m.i}`), ['back0', 'back2', 'back4', 'back6']);
  assert.deepEqual(circleMembers(2, 0).map((m) => m.i), [0, 2, 4, 6]);
  assert.deepEqual(circleMembers(2, 1).map((m) => m.i), [1, 3, 5, 7]);
  assert.equal(f0.length, 8);
  assert.equal(f1.length, 8);
  assert.equal(groupMembers(4).length, 8, 'both flashes together: both rows');
  assert.equal(circleMembers(2).length, 8, 'both flashes together: all the arcs');
  assert.equal(countOf(4, 2), 8, 'points of one flash');
  const text = buildScript(raw, 'blink', 200, 4, 2);
  assert.ok(/^GROUP = 4$/m.test(text) && /^CIRCLE = 2$/m.test(text));
  assert.equal(text.split('\n').length, raw.split('\n').length);
});

test('the window is 2.5 periods of the blink, whatever its speed', () => {
  for (const half of HALF_CHOICES) assert.equal(windowOf(half), 2.5 * (2 * half));
  assert.ok(Math.abs(hzOf(200) - 2.5) < 1e-12);
});

test('buildScript refuses an unknown mode, and a script that has no MODE line', () => {
  assert.throws(() => buildScript(raw, 'strobe'), /unknown LED mode/);
  assert.throws(() => buildScript('print(1)', 'on'), /no MODE line/);
});

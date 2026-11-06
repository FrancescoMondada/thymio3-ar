import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HALF_MS, HALF_CHOICES, BLINK_HZ, MODES, GROUPS, buildScript, groupMembers, countOf, hzOf, windowOf } from '../src/script.js';

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
  assert.throws(() => buildScript(raw, 'blink', 200, 4), /group/);
  assert.throws(() => buildScript(raw.replace(/^GROUP.*$/m, ''), 'blink'), /GROUP line/);
});

test('the quarters: 4 LEDs each (2 front, 2 back), together the 16, and well apart', () => {
  assert.equal(countOf(-1), 16);
  const seen = new Set();
  for (const g of [0, 1, 2, 3]) {
    const m = groupMembers(g);
    assert.equal(m.length, 4);
    assert.equal(m.filter((l) => l.row === 'front').length, 2);
    for (const l of m) { const key = `${l.row}${l.i}`; assert.ok(!seen.has(key), `${key} is in one quarter only`); seen.add(key); }
    // where they are, if the index runs the same way along both rows: columns i, rows 0 (front) and 1 (back), 8 mm apart
    const pos = m.map((l) => [l.i * 8, l.row === 'front' ? 0 : 8]);
    let nearest = Infinity;
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) nearest = Math.min(nearest, Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]));
    assert.ok(nearest >= 17.8, `quarter ${g}: nearest two are ${nearest.toFixed(1)} mm apart (8 mm for neighbours)`);
  }
  assert.equal(seen.size, 16);
  assert.deepEqual(GROUPS, [-1, 0, 1, 2, 3]);
});

test('the window is 2.5 periods of the blink, whatever its speed', () => {
  for (const half of HALF_CHOICES) assert.equal(windowOf(half), 2.5 * (2 * half));
  assert.ok(Math.abs(hzOf(200) - 2.5) < 1e-12);
});

test('buildScript refuses an unknown mode, and a script that has no MODE line', () => {
  assert.throws(() => buildScript(raw, 'strobe'), /unknown LED mode/);
  assert.throws(() => buildScript('print(1)', 'on'), /no MODE line/);
});

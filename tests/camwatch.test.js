import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CameraWatch, pickSettings, capabilitiesText, SHOWN } from '../src/camwatch.js';

test('the first snapshot is the baseline; a change of the picture, of the window or of the orientation is an event with its time', () => {
  const w = new CameraWatch();
  assert.deepEqual(w.observe(1000, { frame: '720x1280', window: '411x782', orientation: 'portrait-primary' }), []);
  assert.deepEqual(w.observe(2000, { frame: '720x1280', window: '411x782', orientation: 'portrait-primary' }), [], 'nothing changed');
  const ev = w.observe(13300, { frame: '1280x720', window: '782x411', orientation: 'landscape-primary' });
  assert.deepEqual(ev.map((e) => e.kind), ['image', 'écran', 'orientation']);
  assert.equal(ev[0].text, 'image 720x1280 → 1280x720');
  assert.ok(Math.abs(ev[0].t - 12.3) < 1e-9, 'seconds since the first snapshot');
  assert.ok(ev.every((e) => SHOWN.has(e.kind)), 'the user is told about all three');
  assert.match(w.line(), /^3 changement\(s\) \(image 1, écran 1, orientation 1\) : 12\.3 s image 720x1280 → 1280x720 ; /);
});

test('the settings of the camera track are read about once a second: a key that is not in a snapshot is not a change; a zoom or an exposure that moves is', () => {
  const w = new CameraWatch();
  w.observe(0, { frame: '720x1280', ...pickSettings({ zoom: 1, exposureMode: 'continuous', width: 720, height: 1280, frameRate: 30, other: 5 }) });
  assert.deepEqual(w.observe(100, { frame: '720x1280' }), [], 'no settings in this picture');
  const ev = w.observe(1100, { frame: '720x1280', ...pickSettings({ zoom: 2.004, exposureMode: 'manual', width: 720, height: 1280, frameRate: 30 }) });
  assert.deepEqual(ev.map((e) => e.text).sort(), ['exposureMode continuous → manual', 'zoom 1 → 2']);
  assert.equal(ev.find((e) => e.text.startsWith('zoom')).kind, 'zoom');
  assert.equal(SHOWN.has(ev.find((e) => e.text.startsWith('exposureMode')).kind), false, 'exposure moves on its own: counted, not shown');
});

test('a note (the track stops, the page goes to the background, the map is erased) is an event too; the report says how many more there were than it lists', () => {
  const w = new CameraWatch({ max: 3 });
  w.observe(0, { frame: '720x1280' });
  for (let i = 1; i <= 5; i++) w.note(i * 1000, 'carte', `carte effacée : l'image a changé de forme (${i})`);
  assert.equal(w.total(), 5);
  assert.equal(w.events.length, 3);
  assert.match(w.line(), /5 changement\(s\) \(carte 5\) : .*\(3\) ; … \(2 de plus\)$/);
  assert.match(new CameraWatch().line(), /aucun changement/);
});

test('what the camera can do is told in a few words, with the zoom range', () => {
  assert.match(capabilitiesText({ zoom: { min: 1, max: 8, step: 0.1 }, exposureMode: ['continuous', 'manual'], iso: { min: 50, max: 3200 } }), /^zoom 1–8, iso 50–3200, exposureMode continuous\/manual$/);
  assert.match(capabilitiesText({}), /rien/);
  assert.match(capabilitiesText(null), /n\/d/);
});

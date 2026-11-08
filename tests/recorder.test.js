import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Recorder, Trace, pickMime, extOf, stampOf, shareFiles, MIMES } from '../src/recorder.js';

// a MediaRecorder that gives a piece a second and a last one at the stop
const fakeMR = (supported) => {
  class MR {
    static isTypeSupported(m) { return supported.includes(m); }
    constructor(stream, opts) { this.stream = stream; this.opts = opts; this.state = 'inactive'; MR.last = this; }
    start(slice) { this.state = 'recording'; this.slice = slice; this.ondataavailable({ data: new Blob(['aaaa']) }); }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['bbbbbb']) }); this.onstop(); }
  }
  return MR;
};

test('the format is the first of the list that the browser supports: hardware H.264 before software VP8 and VP9', () => {
  assert.equal(pickMime(fakeMR(MIMES)), 'video/mp4;codecs=avc1');
  assert.equal(pickMime(fakeMR(['video/webm;codecs=vp9', 'video/webm;codecs=vp8'])), 'video/webm;codecs=vp8');
  assert.equal(pickMime(fakeMR([])), null);
  assert.equal(pickMime(undefined), null);
  assert.equal(extOf('video/mp4;codecs=avc1'), 'mp4');
  assert.equal(extOf('video/webm;codecs=vp8'), 'webm');
});

test('a recording keeps the pieces, asks for the bit rate, and gives one file of the right type at the stop', async () => {
  let now = 1000;
  const MR = fakeMR(['video/webm;codecs=vp8']);
  const r = new Recorder({ MR, bitrate: 8e6, now: () => now });
  assert.equal(r.supported, true);
  assert.equal(r.start({ fake: 'stream' }), true);
  assert.equal(r.start({}), false, 'already recording');
  assert.equal(MR.last.opts.mimeType, 'video/webm;codecs=vp8');
  assert.equal(MR.last.opts.videoBitsPerSecond, 8e6);
  assert.equal(MR.last.slice, 1000);
  now = 13500;
  assert.equal(r.elapsed(), 12500);
  assert.match(r.line(), /^en cours \(13 s/);
  const res = await r.stop();
  assert.equal(res.bytes, 10);
  assert.equal(res.ext, 'webm');
  assert.equal(res.blob.type, 'video/webm');
  assert.equal(res.ms, 12500);
  assert.equal(r.state, 'done');
  assert.match(r.line(), /^12\.5 s, 0\.0 Mo, video\/webm;codecs=vp8, 8 Mbit\/s/);
  assert.equal(await r.stop(), res, 'a second stop gives the same result');
});

test('the recording stops by itself at the longest length; a browser with no format says so; the camera that ends stops it too', async () => {
  const MR = fakeMR(['video/webm']);
  const r = new Recorder({ MR, maxMs: 30 });
  r.start({});
  const res = await r.done;
  assert.equal(r.state, 'done');
  assert.ok(res.bytes > 0);
  assert.throws(() => new Recorder({ MR: fakeMR([]) }).start({}), /ne sait pas enregistrer/);
  assert.match(new Recorder({ MR: fakeMR([]) }).line(), /non disponible/);
  const r2 = new Recorder({ MR });
  r2.start({});
  MR.last.state = 'inactive'; MR.last.onstop();            // the tracks ended: the browser stops the recorder
  assert.equal(r2.state, 'done');
  assert.equal(r2.start({}), true, 'a new recording can follow');
  await r2.stop();
});

test('the trace keeps a row per picture with the time since the recording began, the first picture time, and the events; it is one JSON line after the report', () => {
  const tr = new Trace({ maxRows: 3 });
  assert.equal(tr.active, false);
  tr.add(5000, ['t']);                                      // before begin: nothing
  assert.equal(tr.rows.length, 0);
  tr.begin(10000);
  assert.equal(tr.active, true);
  tr.add(10120, ['a', 0.5, 0.4, 1.2, 4, 4, 3, 50, 270, 480]);
  tr.add(10160, ['t', 0.51, 0.4, 1.2, 4, 4, 3, 50, 270, 480]);
  tr.add(10200, ['l', null, null, null, 0, 0, 3, 50, 270, 480]);
  tr.add(10240, ['l']);                                     // over the limit: counted
  tr.event(10200, 'perte : coast');
  const text = tr.toText('Thymio · rapport\nligne');
  const [head, json] = text.split('\n\nTRACE ');
  assert.equal(head, 'Thymio · rapport\nligne');
  const data = JSON.parse(json);
  assert.equal(data.firstFrameMs, 120);
  assert.deepEqual(data.rows[1], [160, 't', 0.51, 0.4, 1.2, 4, 4, 3, 50, 270, 480]);
  assert.equal(data.rows.length, 3);
  assert.equal(data.dropped, 1);
  assert.deepEqual(data.events, [[200, 'perte : coast']]);
  assert.equal(data.columns.length, data.rows[0].length, 'one column name per value');
});

test('the files go to the share sheet when the browser takes them, otherwise nothing is shared (the page saves them)', async () => {
  const sent = [];
  const nav = { canShare: ({ files }) => files.length > 0, share: async (o) => { sent.push(o); } };
  const f = new File(['x'], 'a.txt', { type: 'text/plain' });
  assert.equal(await shareFiles([f], nav), 'partagé');
  assert.equal(sent[0].files[0].name, 'a.txt');
  assert.equal(await shareFiles([f], {}), null);
  assert.equal(await shareFiles([f], { canShare: () => false, share: async () => {} }), null);
});

test('the file name stamp is the date and the time, with no punctuation', () => {
  assert.equal(stampOf(new Date('2026-11-08T20:00:40.620Z')), '20261108-200040');
});

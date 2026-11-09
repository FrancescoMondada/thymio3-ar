// The figures that tell how a detection did over a recording, from its trace (recorder.js): the same figures for the live run on the phone and for the replay of the
// video on the computer, so that the two can be compared, and the versions of the code compared with each other on the same pictures.
// A row of the trace: [ms, state, cx, cy, scale640, row, ring, motion, angle, W, H]; states: a acquired, t tracked, c coasting, l lost, i idle. An event: [ms, 'a -> l (reason)'].
const MAP = new Set(['a', 't', 'c']);
export function figures(rows, events = []) {
  const n = rows.length;
  if (!n) return { pictures: 0 };
  const withMap = rows.filter((r) => MAP.has(r[1]));
  const confirmed = rows.filter((r) => MAP.has(r[1]) && r[5] != null && r[6] != null && r[5] >= 3 && r[6] >= 3);
  let jumps = 0, pairs = 0, scaleJumps = 0, maxJump = 0;
  for (let i = 1; i < n; i++) {
    const a = rows[i - 1], b = rows[i];
    if (!MAP.has(a[1]) || !MAP.has(b[1]) || a[2] == null || b[2] == null || a[9] !== b[9] || a[10] !== b[10]) continue;
    pairs++;
    const px = Math.hypot((b[2] - a[2]) * b[9], (b[3] - a[3]) * b[10]) * 640 / Math.max(b[9], b[10]);
    maxJump = Math.max(maxJump, px);
    if (px > 60) jumps++;
    if (a[4] && b[4] && (b[4] / a[4] > 1.5 || b[4] / a[4] < 0.667)) scaleJumps++;
  }
  const losses = {}; let nLoss = 0, nAcq = 0, firstMap = null;
  for (const [ms, text] of events) {
    const m = /^(\S+) -> (\S)(?: \((.*)\))?/.exec(text);
    if (!m) continue;
    if (m[2] === 'l' && MAP.has(m[1])) { nLoss++; const why = m[3] || '?'; losses[why] = (losses[why] || 0) + 1; }
    if (m[2] === 'a') nAcq++;
  }
  const first = rows.find((r) => MAP.has(r[1]));
  firstMap = first ? first[0] / 1000 : null;
  const seconds = (rows[n - 1][0] - rows[0][0]) / 1000;
  // runs of pictures with no map
  let longest = 0, run = 0, runStart = 0;
  for (const r of rows) { if (MAP.has(r[1])) { if (run) longest = Math.max(longest, r[0] - runStart); run = 0; } else if (!run) { runStart = r[0]; run = 1; } }
  if (run) longest = Math.max(longest, rows[n - 1][0] - runStart);
  return {
    pictures: n, seconds: Math.round(seconds * 10) / 10,
    mapPct: Math.round((100 * withMap.length) / n), confirmedPct: Math.round((100 * confirmed.length) / n),
    firstMapS: firstMap, acquisitions: nAcq, losses: nLoss, lossesBy: losses, lossesPerMin: seconds ? Math.round((60 * nLoss) / seconds * 10) / 10 : null,
    longestNoMapS: Math.round(longest / 100) / 10, jumps, jumpShare: pairs ? Math.round((1000 * jumps) / pairs) / 10 : null, scaleJumps, maxJumpPx: Math.round(maxJump),
  };
}

// The exposure sweep (main.js) writes an event "exposition : 4.0 ms demandées" at each step; the rows between two such events are one step of the curve "how well is the
// robot followed at this exposure". The first `settleMs` after a change are left out (the camera needs a moment to settle).
export function exposureSegments(events, endMs, settleMs = 1000) {
  const ev = events.filter(([, text]) => /^exposition : /.test(text));
  return ev.map(([ms, text], i) => ({ label: text.replace(/^exposition : /, ''), from: ms + settleMs, to: i + 1 < ev.length ? ev[i + 1][0] : endMs }));
}
export const slice = (rows, from, to) => rows.filter((r) => r[0] >= from && r[0] < to);

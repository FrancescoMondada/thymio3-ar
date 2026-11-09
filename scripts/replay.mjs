// Plays a recording made on the phone (the page's "Enregistrer la vidéo de la caméra") again through the page, in headless Chrome, and measures what the detection did.
//
//   node scripts/replay.mjs recordings/essai.mp4 [--base http://localhost:5180/] [--rate 0.5] [--every 2] [--fond 1] [--live recordings/essai.txt] [--json]
//
// The page must be served (npm run dev, or a build of another version: --base). The clock of the replay is the time of the video, so the result does not depend on the
// speed of this computer, and the same recording gives the same figures for every version of the code: that is what makes two versions comparable.
// With --live (the .txt file the phone gave with the video) the figures of the live run on the phone are printed beside the replay, which tells whether the replay is faithful.
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { figures, exposureSegments, slice } from '../src/figures.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--json'));
if (!file) { console.error('usage: node scripts/replay.mjs <recording.mp4|webm> [--base url] [--rate 0.5] [--every 2] [--fond 1] [--live trace.txt] [--json]'); process.exit(2); }

const base = flag('base', 'http://localhost:5180/').replace(/\/?$/, '/');
const rate = Number(flag('rate', 0.5)), every = Number(flag('every', 2));
const fond = flag('fond', null);

// the page serves the recordings/ folder of the project
const recDir = resolve(here, '..', 'recordings');
mkdirSync(recDir, { recursive: true });
const name = basename(file);
const dest = resolve(recDir, name);
if (resolve(file) !== dest) copyFileSync(file, dest);

const show = (label, f) => console.log(`${label.padEnd(8)} ${f.pictures ? `${f.pictures} images, ${f.seconds} s · carte ${f.mapPct} % · 3+3 confirmés ${f.confirmedPct} % · première carte ${f.firstMapS ?? 'jamais'} s · ${f.acquisitions} départs, ${f.losses} pertes (${f.lossesPerMin}/min ${JSON.stringify(f.lossesBy)}) · plus long trou ${f.longestNoMapS} s · sauts > 60 px : ${f.jumps} (${f.jumpShare} %), max ${f.maxJumpPx} px, sauts d'échelle ${f.scaleJumps}` : 'rien'}`);

// ---- headless Chrome ----
const port = 9400 + Math.floor(Math.random() * 400);
const dir = mkdtempSync(tmpdir() + '/replay-');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--headless=new', '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--window-size=900,1400', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { /* not up yet */ } await sleep(200); }
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');

const url = `${base}?replay=/recordings/${encodeURIComponent(name)}&rate=${rate}&every=${every}${fond != null ? `&fond=${fond}` : ''}`;
await send('Page.navigate', { url });
const evalIn = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
let probe = null;
for (let i = 0; i < 600 && !probe; i++) { await sleep(500); probe = await evalIn('window.thymioAR && window.thymioAR.replayDone ? 1 : 0'); if (probe === 0) probe = null; if (i > 500) break; }
await sleep(800);
const out = await evalIn(`JSON.stringify({ rows: window.thymioAR.trace.rows, events: window.thymioAR.trace.events, build: typeof __BUILD__ === 'string' ? __BUILD__ : (document.getElementById('buildNote') || {}).textContent, report: document.getElementById('report').textContent })`);
ws.close(); chrome.kill();
if (!out) { console.error('la page n\'a rien rendu : le serveur tourne-t-il à', base, '?'); process.exit(1); }
const data = JSON.parse(out);

const replay = figures(data.rows, data.events);
if (args.includes('--json')) { console.log(JSON.stringify({ build: data.build, replay, events: data.events })); process.exit(0); }
console.log(`${name} · page ${data.build || '?'} · vitesse ${rate} · une image sur ${every}${fond != null ? ` · fond=${fond}` : ''}`);
show('rejoué', replay);
const livePath = flag('live', null);
if (livePath && existsSync(livePath)) {
  const t = readFileSync(livePath, 'utf8');
  const j = JSON.parse(t.slice(t.indexOf('TRACE ') + 6));
  show('en direct', figures(j.rows, j.events));
  // an exposure sweep: one line per step, replay beside the live run
  const segs = exposureSegments(j.events, j.rows.length ? j.rows[j.rows.length - 1][0] : 0);
  if (segs.length) {
    console.log('\npar exposition (la première seconde après chaque changement est laissée de côté) : images · carte · 3+3 confirmés');
    for (const sg of segs) {
      const r = figures(slice(data.rows, sg.from, sg.to)), l = figures(slice(j.rows, sg.from, sg.to));
      console.log(`  ${sg.label.padEnd(22)} rejoué ${r.pictures ? `${r.pictures} · ${r.mapPct} % · ${r.confirmedPct} %` : 'rien'}   en direct ${l.pictures ? `${l.pictures} · ${l.mapPct} % · ${l.confirmedPct} %` : 'rien'}`);
    }
  }
}

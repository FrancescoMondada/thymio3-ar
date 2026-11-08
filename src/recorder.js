// A recording of what the camera really sees, to be replayed off the phone.
//
// Until now every test on the phone gave one text report, and the fixes were guesses from it, checked only on scenes that I drew myself. Eighteen rounds of that made
// the detection worse, not better, and nothing could tell a real regression from a change of light, of distance or of hand. A recording fixes the input: the same
// camera pictures can be played again through any version of the code, on the Mac, as often as needed, and the versions compared on the same pictures.
//
// What is recorded is the camera stream itself (MediaRecorder: no extra picture copy, the hardware encoder does the work), plus a small trace of what the live page
// decided picture by picture, so that the replay can be checked against the live run. The page gives both files to the share sheet of the phone.

// the formats tried in order: a hardware H.264 encoder costs the page the least on a phone; VP8 is cheaper than VP9 when the browser must do it in software
export const MIMES = ['video/mp4;codecs=avc1', 'video/webm;codecs=h264', 'video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/mp4', 'video/webm'];

export function pickMime(MR = globalThis.MediaRecorder) {
  if (!MR || typeof MR.isTypeSupported !== 'function') return null;
  return MIMES.find((m) => { try { return MR.isTypeSupported(m); } catch { return false; } }) || null;
}

export const extOf = (mime) => (String(mime).startsWith('video/mp4') ? 'mp4' : 'webm');

// 2026-11-08T20:00:40.620Z -> 20261108-200040
export const stampOf = (date = new Date()) => date.toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-');

export class Recorder {
  constructor({ MR = globalThis.MediaRecorder, bitrate = 8e6, maxMs = 45000, now = () => performance.now() } = {}) {
    Object.assign(this, { MR, bitrate, maxMs, now });
    this.state = 'idle';             // 'idle' | 'recording' | 'done'
    this.result = null;              // { blob, mime, ext, ms, bytes } once done
    this.error = null;
    this.t0 = null;
  }

  get supported() { return !!pickMime(this.MR); }

  elapsed() { return this.state === 'recording' ? this.now() - this.t0 : this.result ? this.result.ms : 0; }

  // stream: the MediaStream of the camera. Throws when the browser has no usable format.
  start(stream) {
    if (this.state === 'recording') return false;
    const mime = pickMime(this.MR);
    if (!mime) throw new Error('ce navigateur ne sait pas enregistrer la vidéo de la caméra');
    this.chunks = []; this.mime = mime; this.error = null; this.result = null;
    const rec = new this.MR(stream, { mimeType: mime, videoBitsPerSecond: this.bitrate });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    rec.onerror = (e) => { this.error = String((e && e.error && e.error.message) || (e && e.message) || 'erreur de l\'enregistreur'); };
    this.done = new Promise((resolve) => { this.finish = resolve; });
    rec.onstop = () => this.close();
    this.rec = rec;
    rec.start(1000);                 // a chunk a second: the pieces are kept by the browser, not rebuilt at the end
    this.t0 = this.now();
    this.state = 'recording';
    this.timer = setTimeout(() => { this.stop(); }, this.maxMs);
    return true;
  }

  // -> the result (a promise: the last piece arrives after the call)
  stop() {
    if (this.state !== 'recording') return Promise.resolve(this.result);
    clearTimeout(this.timer);
    try { if (this.rec.state !== 'inactive') this.rec.stop(); else this.close(); } catch { this.close(); }
    return this.done;
  }

  close() {
    if (this.state !== 'recording') return;
    clearTimeout(this.timer);
    const ms = this.now() - this.t0;
    const type = this.mime.split(';')[0];
    const blob = new Blob(this.chunks, { type });
    this.chunks = [];
    this.result = { blob, mime: this.mime, ext: extOf(this.mime), ms, bytes: blob.size };
    this.state = 'done';
    this.finish(this.result);
  }

  // one line for the report
  line() {
    if (this.state === 'idle') return this.supported ? 'pas d\'enregistrement' : 'non disponible dans ce navigateur';
    if (this.state === 'recording') return `en cours (${(this.elapsed() / 1000).toFixed(0)} s, ${this.mime})`;
    const r = this.result;
    return `${(r.ms / 1000).toFixed(1)} s, ${(r.bytes / 1e6).toFixed(1)} Mo, ${r.mime}, ${this.bitrate / 1e6} Mbit/s demandés${this.error ? ` ; ERREUR : ${this.error}` : ''}`;
  }
}

// What the live page decided, picture by picture, while the camera was being recorded. One row per analysed picture:
//   [ms since the recording began, state (a acquired, t tracked, c coasting, l lost, i idle), cx, cy (centre of the ring, as a share of the picture, or null),
//    scale (px per mm, brought to a picture 640 px long, or null), row LEDs confirmed, ring arcs confirmed, phone motion (deg/s), view angle (deg), analysed W, H]
// and events (a loss with its reason, an acquisition, a size change) with their time. It stays small (about 40 bytes a picture).
export class Trace {
  constructor({ maxRows = 4000, maxEvents = 400 } = {}) { Object.assign(this, { maxRows, maxEvents }); this.reset(); }

  reset() { this.t0 = null; this.firstFrameT = null; this.rows = []; this.events = []; this.dropped = 0; }

  begin(t0) { this.reset(); this.t0 = t0; }

  get active() { return this.t0 != null; }

  // t: the time of the picture on the page's clock (ms)
  add(t, row) {
    if (this.t0 == null) return;
    if (this.firstFrameT == null) this.firstFrameT = Math.round(t - this.t0);
    if (this.rows.length >= this.maxRows) { this.dropped++; return; }
    this.rows.push([Math.round(t - this.t0), ...row]);
  }

  event(t, text) {
    if (this.t0 == null || this.events.length >= this.maxEvents) return;
    this.events.push([Math.round(t - this.t0), text]);
  }

  // the text file given with the video: the report as it was when the recording stopped, then the trace as one JSON line
  toText(header) {
    const json = JSON.stringify({ version: 1, firstFrameMs: this.firstFrameT, columns: ['ms', 'state', 'cx', 'cy', 'scale640', 'row', 'ring', 'motion', 'angle', 'W', 'H'], rows: this.rows, events: this.events, dropped: this.dropped });
    return `${header}\n\nTRACE ${json}\n`;
  }
}

// the share sheet of the phone (Drive, mail, Quick Share, ...) takes files when the page was clicked; otherwise they are saved
export async function shareFiles(files, nav = globalThis.navigator) {
  if (nav && typeof nav.canShare === 'function' && typeof nav.share === 'function' && nav.canShare({ files })) {
    await nav.share({ files, title: 'Thymio AR : enregistrement' });
    return 'partagé';
  }
  return null;
}

export function saveFile(file, doc = globalThis.document) {
  const url = URL.createObjectURL(file);
  const a = doc.createElement('a');
  a.href = url; a.download = file.name; a.style.display = 'none';
  doc.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

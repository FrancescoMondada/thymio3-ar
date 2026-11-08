// The tablet's camera as a <video> that the page reads, and what the browser lets the page set on it (exposure).
//
// `?demo` in the address (or the button on the start screen) replaces the camera by a drawn scene (demo.js) with
// the same <video> interface, so that the whole page can be tried with no camera.

export async function startCamera({ facing = 'environment', width = 1280, height = 720, frameRate = 30 } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    const err = new Error('this browser has no camera access (it needs https)');
    err.name = 'NoCameraApi';
    throw err;
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: facing }, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate } },
  });
  return fromStream(stream, { label: stream.getVideoTracks()[0]?.label || facing });
}

export async function fromStream(stream, { label = '', stopExtra = () => {} } = {}) {
  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.autoplay = true;
  video.srcObject = stream;
  // a video that is in the page keeps getting its frames; hidden, not detached
  Object.assign(video.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(video);
  await video.play();
  const track = stream.getVideoTracks()[0];
  return {
    video,
    stream,
    track,
    label,
    settings: track?.getSettings?.() || {},
    capabilities: track?.getCapabilities?.() || {},
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      stopExtra();
      video.srcObject = null;
      video.remove();
    },
  };
}

// A recording (recorder.js) played again in place of the camera, with the same <video> interface: the page then analyses the very pictures of a test made on a phone.
// The clock is the time of the video, not the wall clock, so that a slow computer gives the same result as a fast one (the speed of the video is lowered: every picture
// is delivered); `every` analyses one picture out of `every` (the phone analysed about 14 of its 30 pictures a second).
export async function startReplay(url, { rate = 0.5, every = 2 } = {}) {
  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.src = url;
  video.playbackRate = rate;
  Object.assign(video.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(video);
  await video.play();
  const cam = {
    video, stream: null, track: null, label: 'ENREGISTREMENT REJOUÉ', replay: true, every: Math.max(1, every), n: 0, finished: false, rate,
    settings: { width: video.videoWidth, height: video.videoHeight, frameRate: 30 },
    capabilities: {},
    stop() { video.pause(); video.removeAttribute('src'); video.remove(); },
  };
  video.addEventListener('ended', () => { cam.finished = true; });
  return cam;
}

// What the camera says it can do about exposure, in words for the page.
export function exposureInfo(cam) {
  const caps = cam.capabilities || {};
  const modes = Array.isArray(caps.exposureMode) ? caps.exposureMode : null;
  const time = caps.exposureTime && typeof caps.exposureTime === 'object' ? caps.exposureTime : null;
  return {
    modes,
    canLock: !!modes && modes.includes('manual'),
    time,                                         // { min, max, step } in units of 100 microseconds (Chrome)
    current: cam.settings?.exposureMode || null,
    currentTime: cam.settings?.exposureTime ?? null,
  };
}

export async function setExposure(cam, { mode, time } = {}) {
  const advanced = {};
  if (mode) advanced.exposureMode = mode;
  if (time != null) advanced.exposureTime = time;
  await cam.track.applyConstraints({ advanced: [advanced] });
  cam.settings = cam.track.getSettings?.() || cam.settings;
}

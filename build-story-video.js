// Records the animated story (dimmed rose video + rising embers + design)
// to BLU2-LIVE-story.mp4. Local-only tool; run: node build-story-video.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');
const ffmpeg = require('ffmpeg-static');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PAGE = 'file:///' + path.resolve('story-video.html').replace(/\\/g, '/');
const OUT = path.resolve('BLU2-LIVE-story.mp4');
const AUDIO = path.resolve('Audio/Better Left Unsaid.wav'); // muxed in if present
const RECORD_MS = 62000;  // capture window (>=60s so the Story video is 60s+)
const W = 1080, H = 1920;

(async () => {
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-frames-'));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--autoplay-policy=no-user-gesture-required',
      '--hide-scrollbars',
      '--mute-audio',
      `--window-size=${W},${H}`,
    ],
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  });

  const page = await browser.newPage();
  await page.goto(PAGE, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const v = document.getElementById('rose-bg');
    if (v) { try { v.currentTime = 4; await v.play(); } catch (e) {} }
  });
  await new Promise(r => setTimeout(r, 900)); // let video + embers get going

  const client = await page.target().createCDPSession();
  // Write frames to disk as they arrive (a 60s capture is ~1800 frames — too
  // many to hold in memory). Keep only the timestamps for the fps calc.
  const timestamps = [];
  let idx = 0;
  client.on('Page.screencastFrame', async (f) => {
    fs.writeFileSync(path.join(framesDir, `f${String(idx).padStart(6, '0')}.jpg`), Buffer.from(f.data, 'base64'));
    timestamps.push(f.metadata.timestamp);
    idx++;
    try { await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) {}
  });

  await client.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await new Promise(r => setTimeout(r, RECORD_MS));
  await client.send('Page.stopScreencast');
  await browser.close();

  if (timestamps.length < 2) { console.error('Not enough frames captured:', timestamps.length); process.exit(1); }

  const span = timestamps[timestamps.length - 1] - timestamps[0];
  const inFps = Math.max(10, Math.min(60, (timestamps.length - 1) / span));
  console.log(`Captured ${timestamps.length} frames over ${span.toFixed(2)}s -> input ${inFps.toFixed(1)}fps`);

  const silent = path.join(framesDir, 'silent.mp4');
  execFileSync(ffmpeg, [
    '-y',
    '-framerate', inFps.toFixed(3),
    '-i', path.join(framesDir, 'f%06d.jpg'),
    '-vf', 'scale=1080:1920:flags=lanczos',
    '-r', '30',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium', '-crf', '21',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    silent,
  ], { stdio: 'inherit' });

  // Mux the track (trimmed to the video length, fade in/out) if present
  if (fs.existsSync(AUDIO)) {
    const fadeOut = Math.max(1, span - 2).toFixed(2);
    execFileSync(ffmpeg, [
      '-y',
      '-i', silent,
      '-i', AUDIO,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k',
      '-af', `afade=t=in:st=0:d=1,afade=t=out:st=${fadeOut}:d=2`,
      '-shortest', '-movflags', '+faststart',
      OUT,
    ], { stdio: 'inherit' });
    console.log('Muxed audio from', AUDIO);
  } else {
    fs.copyFileSync(silent, OUT);
    console.log('No audio at', AUDIO, '— wrote silent video');
  }

  fs.rmSync(framesDir, { recursive: true, force: true });
  console.log('Wrote', OUT);
})();

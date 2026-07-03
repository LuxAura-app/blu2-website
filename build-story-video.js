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
const RECORD_MS = 9000;   // capture window
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
  const frames = [];
  client.on('Page.screencastFrame', async (f) => {
    frames.push({ buf: Buffer.from(f.data, 'base64'), ts: f.metadata.timestamp });
    try { await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) {}
  });

  await client.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await new Promise(r => setTimeout(r, RECORD_MS));
  await client.send('Page.stopScreencast');
  await browser.close();

  if (frames.length < 2) { console.error('Not enough frames captured:', frames.length); process.exit(1); }

  frames.forEach((fr, i) => {
    fs.writeFileSync(path.join(framesDir, `f${String(i).padStart(5, '0')}.jpg`), fr.buf);
  });
  const span = frames[frames.length - 1].ts - frames[0].ts;
  const inFps = Math.max(10, Math.min(60, (frames.length - 1) / span));
  console.log(`Captured ${frames.length} frames over ${span.toFixed(2)}s -> input ${inFps.toFixed(1)}fps`);

  execFileSync(ffmpeg, [
    '-y',
    '-framerate', inFps.toFixed(3),
    '-i', path.join(framesDir, 'f%05d.jpg'),
    '-vf', 'scale=1080:1920:flags=lanczos,format=yuv420p',
    '-r', '30',
    '-c:v', 'libx264', '-profile:v', 'high', '-b:v', '9M',
    '-movflags', '+faststart',
    OUT,
  ], { stdio: 'inherit' });

  fs.rmSync(framesDir, { recursive: true, force: true });
  console.log('Wrote', OUT);
})();

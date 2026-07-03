# Better Left Unsaid 2 — Mali V
Official mixtape landing page and listening party voting site.
Target domain: betterleftunsaid2.com
Label: All Flights Delayed

## Stack
- Static HTML/CSS/JS (single self-contained file)
- Deployed on Vercel via GitHub
- localStorage for vote persistence (prototype phase)

## Project folder
C:\Users\Team Parkins\Projects\BLU2

## Pages
- `index.html` — main mixtape landing + Rate & Review voting (`/`)
- `rsvp.html` — RSVP flow (`/rsvp`)
- `livedj.html` — **BLU2 LIVE** DJ session landing page (`/live` or `/livedj`)
- `flyer.html` — still-flyer canvas (1080×1350, 4:5); also serves a fluid 9:16
  phone layout at ≤900px. Used to render the feed PDF/PNG (`/flyer`)
- `story.html` — 1080×1920 (9:16) canvas used to render the Instagram Story
  still image (`/story`)
- `story-video.html` — animated 9:16 Story page (dimmed burning-rose video +
  rising CSS embers) that `build-story-video.js` screen-records into the Story **video**

## BLU2 LIVE DJ session flyer (Saint Believ3 — Sun July 5, 7:00 PM)
Web page: `livedj.html`. Shareable graphics:
- `BLU2-LIVE-flyer.png` (2160×2700, 4:5) — **Instagram feed post**
- `BLU2-LIVE-story.png` (2160×3840, 9:16) — **Instagram Story (still)**
- `BLU2-LIVE-story.mp4` (1080×1920, 9:16, H.264, ~10s) — **animated Instagram
  Story** (burning-rose video + embers behind the design)
- `BLU2-LIVE-flyer.pdf` (4:5) — print

Both the web page and the flyer use the DJ photo at `img/SaintBeliev3-DJ.JPEG`
(case-sensitive on Vercel). If it's missing they gracefully fall back to the
burning rose. **To swap the photo:** replace that file (ideally a portrait,
subject slightly high in frame), then regenerate the still graphics:

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
# PDF (vector text, 4:5)
"$CHROME" --headless --no-sandbox --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="BLU2-LIVE-flyer.pdf" "file:///C:/Users/Team%20Parkins/Projects/BLU2/flyer.html"
# 2x PNG for the IG feed (2160x2700, 4:5)
"$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1080,1350 \
  --screenshot="BLU2-LIVE-flyer.png" "file:///C:/Users/Team%20Parkins/Projects/BLU2/flyer.html"
# 2x PNG for the IG Story still (2160x3840, 9:16)
"$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1080,1920 \
  --screenshot="BLU2-LIVE-story.png" "file:///C:/Users/Team%20Parkins/Projects/BLU2/story.html"
```

### Animated Story video (`BLU2-LIVE-story.mp4`)
`build-story-video.js` screen-records the animated `story-video.html` (dimmed
burning-rose video + rising CSS embers behind the design) via headless Chrome
(`puppeteer-core`) and encodes it with `ffmpeg-static`. Local-only tooling
(not committed):

```bash
npm i puppeteer-core ffmpeg-static ffprobe-static
node build-story-video.js        # writes BLU2-LIVE-story.mp4 (1080x1920 H.264 + AAC, ~62s)
```

The build muxes `Audio/Better Left Unsaid.wav` (trimmed to the clip length with a
1s fade-in / 2s fade-out → AAC). That WAV is git-ignored (large; already embedded
in the mp4) — keep a copy in `Audio/` locally to regenerate. Capture length =
`RECORD_MS` in `build-story-video.js` (currently 62s).

To tune it: rose prominence = `.rose-bg` opacity + `.rose-veil` in
`story-video.html`; ember count/speed = the `embers-anim` script + `@keyframes
floatUp`; capture length = `RECORD_MS` in `build-story-video.js`.

Edit event copy (date/time/handles) in `flyer.html`, `story.html`,
`story-video.html`, and `livedj.html`. The countdown target lives in
`livedj.html` (`new Date(2026, 6, 5, 19, 0, 0)`).

## To update track list
Edit the TRACKS array in index.html around line 990.

## Admin access
Go to login page → click the hidden dot at bottom center → enter admin code.
- "Sync All Votes (Cloud)" pulls every submission from the shared Google
  Sheet (see `apps-script/SETUP.md`) into the dashboard.
- "Export CSV" then downloads everything as one combined document.

## Cloud vote sync & email
Each submission is also sent to a Google Apps Script Web App, which logs the
vote to a shared Google Sheet and emails the voter's results (CSV + PDF) to
titledtentatively@gmail.com. See `apps-script/SETUP.md` to deploy it and wire
up `SHEET_WEBHOOK_URL` in index.html.

## Future upgrade
Migrate votes to Supabase for persistent cross-device storage.

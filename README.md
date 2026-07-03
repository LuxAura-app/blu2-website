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
  image (`/story`)
- `story-overlay.html` — transparent-background variant of the story, rendered
  to a PNG and composited over the burning-rose video to make the Story **video**

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
Composites the burning-rose video behind a transparent render of the story.
Needs a local ffmpeg (not committed): `npm i ffmpeg-static ffprobe-static`.

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
FF="node_modules/ffmpeg-static/ffmpeg.exe"
# 1) transparent overlay PNG
"$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1080,1920 --default-background-color=00000000 \
  --screenshot="_story-overlay.png" "file:///C:/Users/Team%20Parkins/Projects/BLU2/story-overlay.html"
# 2) composite rose video (background) + overlay -> 10s 1080x1920 H.264
"$FF" -y -ss 4 -t 10 -i "video/Rose_new.mp4" -i "_story-overlay.png" \
  -filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=brightness=-0.05:saturation=1.2,setsar=1[bg];[bg][1:v]overlay=0:0,format=yuv420p[v]" \
  -map "[v]" -r 30 -c:v libx264 -profile:v high -pix_fmt yuv420p -b:v 9M -movflags +faststart "BLU2-LIVE-story.mp4"
rm -f _story-overlay.png
```

Edit event copy (date/time/handles) in `flyer.html`, `story.html`,
`story-overlay.html`, and `livedj.html`. The countdown target lives in
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

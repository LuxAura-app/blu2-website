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
- `flyer.html` — still-flyer canvas (1080×1350, 4:5) used to render the PDF/PNG (`/flyer`)

## BLU2 LIVE DJ session flyer (DJ SaintBeliev3 — Sun July 5, 7:00 PM)
Web page: `livedj.html`. Shareable graphics: `BLU2-LIVE-flyer.pdf` and
`BLU2-LIVE-flyer.png` (2160×2700, post this to Instagram).

Both the web page and the flyer look for a DJ photo at `img/saintbeliev3.jpg`.
Until that file exists they gracefully fall back to the burning rose. **To use a
real photo:** drop a portrait (ideally ~4:5, subject slightly high in frame) at
`img/saintbeliev3.jpg`, then regenerate the still graphics:

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
# PDF (vector text, 4:5)
"$CHROME" --headless --no-sandbox --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="BLU2-LIVE-flyer.pdf" "file:///C:/Users/Team%20Parkins/Projects/BLU2/flyer.html"
# 2x PNG for social posting (2160x2700)
"$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1080,1350 \
  --screenshot="BLU2-LIVE-flyer.png" "file:///C:/Users/Team%20Parkins/Projects/BLU2/flyer.html"
```

Edit event copy (date/time/handles) in both `flyer.html` and `livedj.html`.
The countdown target lives in `livedj.html` (`new Date(2026, 6, 5, 19, 0, 0)`).

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

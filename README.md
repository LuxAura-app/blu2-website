# Better Left Unsaid 2 — Mali V
Official album landing page and listening party voting site.
Target domain: betterleftunsaid2.com
Label: All Flights Delayed

## Stack
- Static HTML/CSS/JS (single self-contained file)
- Deployed on Vercel via GitHub
- localStorage for vote persistence (prototype phase)

## Project folder
C:\Users\Team Parkins\Projects\BLU2

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

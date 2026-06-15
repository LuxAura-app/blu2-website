# Cloud Vote Sync — Setup

This connects the BLU2 listening party survey to a Google Sheet so that:

- Every submission is appended as a row to one shared Sheet (your "all votes
  in one document" for the admin export).
- Every submission emails the voter's results as a CSV + PDF to
  `titledtentatively@gmail.com`.
- Every login (whether or not they finish voting) and every submission adds
  the person's name/email/phone to a `Contacts` tab for future email/text
  marketing campaigns.

## 1. Create the Script

The script in this repo is already pointed at the BLU2 Votes sheet via
`SPREADSHEET_ID`, so the script project does **not** need to be bound to
that sheet. This means you can create it as a **standalone project**,
which avoids the "Apps Script is unavailable" error that the
Extensions → Apps Script menu sometimes throws inside Sheets.

1. Go to [script.google.com](https://script.google.com) and click
   **New project**.
2. Delete the placeholder `Code.gs` contents and paste in the contents of
   `apps-script/Code.gs` from this repo.
3. (Optional) Update `ADMIN_EMAIL` or `ADMIN_PASS` at the top of the script.
   `ADMIN_PASS` must match the `ADMIN_PASS` constant in `index.html`
   (defaults to `maliv2026`). If you're pointing this at a different sheet,
   also update `SPREADSHEET_ID` (the long ID in the sheet's URL between
   `/d/` and `/edit`).
4. Rename the project (top left, "Untitled project") to something like
   `BLU2 Vote Sync`, then save (Ctrl/Cmd+S).

If Extensions → Apps Script works fine for you, that's an equally valid
way to create the project — just make sure the pasted code still includes
the `SPREADSHEET_ID` / `openById` call so it can find the right sheet.

## 2. Deploy as a Web App

1. Click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy**.
5. Authorize the requested permissions (Sheets, Gmail, Drive) — Drive is
   only used briefly to render the PDF summary, then the temp file is
   deleted.
6. Copy the **Web app URL** it gives you (ends in `/exec`).

## 3. Connect the site

1. Open `index.html` and find:
   ```js
   const SHEET_WEBHOOK_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";
   ```
2. Replace the placeholder with the Web App URL from step 2.6.
3. Commit and push.

## How it works

- **On login**: the site `fetch()`s `{ type: "login", user }` to the Web
  App. The script adds/updates a row in the `Contacts` tab — no email is
  sent. This captures everyone who logs in, even if they don't finish
  voting, for future email/text marketing.
- **On submit**: the site `fetch()`s the entry (ratings, vibes, comments,
  track list) to the Web App. The script appends a row to the `Responses`
  sheet, upserts the `Contacts` row, and emails a CSV + PDF summary of that
  person's votes to `titledtentatively@gmail.com`.
- **Contacts tab**: one row per person, keyed by email (case-insensitive).
  Columns are `First, Last, Email, Phone, First Seen, Last Seen, Source`.
  Repeat logins/submissions update the same row instead of duplicating it.
- **Admin → Sync All Votes (Cloud)**: fetches every row from the Sheet
  (authenticated with `ADMIN_PASS`) and merges it into the admin dashboard,
  so **Export CSV** then produces one combined document of every vote ever
  cast, across all devices.
- The Sheet itself is also a complete, always-up-to-date single document —
  you can open it directly in Google Sheets at any time.

## Redeploying after script changes

Apps Script Web App URLs only change if you create a **new deployment**.
If you edit `Code.gs` later, use **Deploy → Manage deployments → Edit →
New version** to update the existing deployment in place (keeps the same
URL).

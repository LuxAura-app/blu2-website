# Cloud Vote Sync — Setup

This connects the BLU2 listening party survey to a Google Sheet so that:

- Every submission is appended as a row to one shared Sheet (your "all votes
  in one document" for the admin export).
- Every submission emails the voter's results as a CSV + PDF to
  `titledtentatively@gmail.com`.

## 1. Create the Sheet + Script

1. Go to [sheets.google.com](https://sheets.google.com) and create a new
   blank spreadsheet. Name it something like `BLU2 Votes`.
2. In the menu, go to **Extensions → Apps Script**.
3. Delete the placeholder `Code.gs` contents and paste in the contents of
   `apps-script/Code.gs` from this repo.
4. (Optional) Update `ADMIN_EMAIL` or `ADMIN_PASS` at the top of the script.
   `ADMIN_PASS` must match the `ADMIN_PASS` constant in `index.html`
   (defaults to `maliv2026`).
5. Save the project (e.g. name it `BLU2 Vote Sync`).

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

- **On submit**: the site `fetch()`s the entry (ratings, vibes, comments,
  track list) to the Web App. The script appends a row to the `Responses`
  sheet and emails a CSV + PDF summary of that person's votes to
  `titledtentatively@gmail.com`.
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

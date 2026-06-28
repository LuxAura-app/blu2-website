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

## RSVP page (rsvp.html)

`rsvp.html` posts to the same Web App with `{ type: "rsvp", ... }`. The
script appends a row to a new `RSVP` sheet tab, upserts the `Contacts`
row, and emails the guest a status-aware confirmation plus `ADMIN_EMAIL`
a notification — both via `GmailApp`, so no third-party email API key
is ever exposed in the static HTML.

- **Admin → Sync All RSVPs (Cloud)**: calls `?pass=...&type=rsvp` and
  merges every RSVP row into the admin dashboard at `rsvp.html#admin`.
- **Reminders**: run `sendReminders(subject, message)` from the Apps
  Script editor (or attach a time-driven trigger for June 24/26/27) to
  email everyone who RSVP'd "going". Gmail's consumer send quota is
  ~100/day.
- **SMS**: not implemented. See the `TODO` comment above `sendReminders`
  in `Code.gs` — Twilio needs a server-side secret, and this Apps
  Script project is the safe place to hold it (Script Properties) once
  there's a Twilio account.

## Newsletter — album release email (July 1, 2026)

> **STATUS — armed.** A time-driven trigger is installed to run
> `sendAlbumReleaseEmail` at **11:00 AM ET on July 1, 2026**, blasting the
> full Contacts list. Confirmed via `checkAlbumReleaseReadiness`
> (`Trigger armed: YES`, `Ready to send: YES`). The trigger is one-shot —
> after it fires you can delete it from the Triggers tab. Do **not** run
> `sendAlbumReleaseEmail` by hand before then unless you mean to send for
> real.

`buildNewsletterEmailHtml()` is a reusable, on-brand HTML email template
(black canvas, orange headline band, burning-rose hero, bulletproof CTA,
socials footer) that matches `index.html` / `rsvp.html`. Reuse it for any
future campaign by passing a different content object — only the copy
changes, never the markup.

`sendAlbumReleaseEmail()` is the first campaign: the "Better Left Unsaid 2
is out" announcement, blasted to the **entire Contacts list** via Resend
(same channel as `sendLocationReveal`). It uses Resend's
`{{RESEND_UNSUBSCRIBE}}` token + `List-Unsubscribe` header for one-click
opt-out (CAN-SPAM compliant).

**Prerequisite:** `RESEND_API_KEY` must be set in **Project Settings →
Script Properties** (already required by `sendLocationReveal`), and the
`party@betterleftunsaid2.com` sender domain must be verified in Resend.

### Schedule the July 1 send (late morning, not midnight)

The blast is timed for **11:00 AM Eastern on July 1, 2026** — late
morning, so it lands when the list is awake and checking their inbox
rather than sleeping through a midnight send (project timezone is
`America/New_York`).

**Option A — one click (recommended).** In the Apps Script editor, select
`createAlbumReleaseTrigger` from the function dropdown and click **Run**.
That installs a one-time time-based trigger at 11:00 AM ET on July 1,
2026. Re-running it is safe — it removes any prior album-release trigger
first, so you won't double-send. Verify under **Triggers** (the clock
icon in the left rail). To shift the time, edit the `new Date(2026, 6, 1,
11, 0, 0)` hour in `createAlbumReleaseTrigger` and run it again.

**Option B — manual UI.** Apps Script editor → **Triggers** (clock icon)
→ **Add Trigger**:
- Function: `sendAlbumReleaseEmail`
- Deployment: Head
- Event source: **Time-driven**
- Type: **Specific date and time**
- Date/time: `2026-07-01 11:00` (interpreted in the project timezone,
  America/New_York)

> Apps Script time-driven triggers fire within a short window (typically a
> few minutes) of the scheduled time, not to the exact second — fine for a
> release-day blast.

### Test send first

Run `sendAlbumReleaseTest` from the editor's function dropdown — it
delivers the exact album-release email (subject prefixed `[TEST]`) to a
single address so you can preview rendering, the CTA, and the unsubscribe
footer. It defaults to `rushell.mg@gmail.com`; to send elsewhere, call
`sendAlbumReleaseTest("someone@example.com")`. This hits Resend, so it
needs `RESEND_API_KEY` set and the sender domain verified.

If you edit `Code.gs`, push it live with `clasp` (see below) so the
trigger runs the updated code.

## Voting invite — "the room is open" blast to RSVP invitees

`sendVotingInviteEmail()` emails everyone who RSVP'd a one-tap invite to
enter the room and rate every track live during the listening party. It
reuses `buildNewsletterEmailHtml()` and the Resend channel; the CTA links
to `https://www.betterleftunsaid2.com`, where they sign in and vote
(voting unlocks at 7 PM ET on June 27).

- **Recipients:** every unique email in the `RSVP` sheet (`getAllRsvpEmails`),
  all statuses, deduped.
- **Send it:** the night of the event, run `sendVotingInviteEmail` from the
  Apps Script editor's function dropdown. Requires `RESEND_API_KEY` and the
  verified sender domain (same setup as the album release).
- **Test first:** run `sendVotingInviteTest` (defaults to
  `rushell.mg@gmail.com`; or `sendVotingInviteTest("you@example.com")`).
  It logs Resend's full response so any failure is diagnosable.

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

### Preferred: use clasp (avoids copy/paste entirely)

This project is linked to the live Apps Script project via `clasp`
(`apps-script/.clasp.json`, scriptId
`1LAUGhzNbRavIBuX8EKuXaK4YofVTykM0ROpGdxj2a9_Smy6kh2wr4ZwU`). `clasp` is
already authenticated on this machine (`~/.clasprc.json`), so future edits
to `Code.gs` are just:

```sh
cd apps-script
clasp push                                    # uploads Code.gs + appsscript.json
clasp create-version "Describe the change"    # creates an immutable version
clasp redeploy <deploymentId> -V <version> -d "Description"
```

The live webhook's deployment ID is `AKfycbzttxDFBLEW-A7cmT90gi_F6VRDPRP19if4aWSkWJydExr4hcrLARYoKZuoeEumI3sN`
(same as `SHEET_WEBHOOK_URL` in `index.html`). Run `clasp list-deployments`
to confirm the deployment ID and current version. This keeps the `/exec`
URL stable, so `index.html` never needs to change.

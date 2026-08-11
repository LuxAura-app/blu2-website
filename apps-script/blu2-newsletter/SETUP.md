# BLU2 Newsletter Mail Merge — Setup

Deployed via `clasp`, authenticated as **titledtentatively@gmail.com** (the account
that owns the recipient Sheet and Drive asset folder this script reads from).

- Script project: https://script.google.com/d/18RnyGLSDvNphyhn_Sstagr3GDmgRMH0R1kIrk-h0X6suOtzurN55Bjyw/edit
- Deployment ID: `AKfycbxDQxktM3Yd6IOEQY-aqFRk-_wAYhAykCFgKpR_JzA8TK895yVnCHk5Q9nET-E7T0vq`
- Web app URL (`UNSUBSCRIBE_WEBAPP_URL` in `Code.gs`):
  `https://script.google.com/macros/s/AKfycbxDQxktM3Yd6IOEQY-aqFRk-_wAYhAykCFgKpR_JzA8TK895yVnCHk5Q9nET-E7T0vq/exec`
- Recipient Sheet: `1tkB8RD0g12uBUuM1Wezbb_vuCWIUn1coBMc2UlDk49U` ("BLU2 Newsletter
  Recipients", 112 people, `Unsubscribed`/`Unsubscribed At` columns)
- Drive image folder: `1mQeNjGr-_NrZrX0jDHo6vXiiQDbB04tt` ("BLU2 Newsletter Assets")

## Two manual steps still needed before a real send

1. **Upload images to the Drive folder.** `assets/` in this folder has 4 of the 5
   required images, recovered directly from the base64 data embedded in the
   `BLU2_Newsletter_*_*.html` preview files (no image zip was actually present
   alongside the script when this was set up):
   - `email_rose.jpg`, `email_wordmark.png`, `email_reel_thumb.jpg`, `email_studio.jpg` ✅ recovered
   - `email_embers.jpg` ❌ **not recoverable from anything in this repo** — it's
     defined in `getInlineImages_()` but never actually referenced by `cid:` in
     any of the 3 email bodies. Even though it's unused visually, `getInlineImages_()`
     still fetches it up front for every send, so a send will fail immediately with
     `Missing image in BLU2 Newsletter Assets: email_embers.jpg` unless *some* file
     by that exact name exists in the Drive folder. Source it separately and upload it
     (any placeholder image works if it's truly unused — but confirm that against the
     3 HTML templates before assuming it's safe to fake).
   Drag all 5 into: https://drive.google.com/drive/folders/1mQeNjGr-_NrZrX0jDHo6vXiiQDbB04tt

2. **Fix web app access in the Apps Script UI.** The manifest (`appsscript.json`)
   correctly declares `"access": "ANYONE_ANONYMOUS"`, but `clasp`/the Apps Script
   API does not reliably apply anonymous web-app access to deployments it creates —
   this is a known API limitation, confirmed here by testing (the deployed `/exec`
   URL currently returns a Google "You need access" / sign-in page instead of the
   `doGet` response, verified against the working BLU2 Vote Sync deployment as a
   sanity check). To fix: open the script project above → **Deploy → Manage
   deployments** → edit the existing deployment → confirm **Who has access: Anyone**
   → **Deploy** (redeploying the *same* deployment ID keeps the URL, which is
   already correctly patched into `Code.gs`). Re-test with a logged-out browser or
   `curl` afterward — a working response is the `doGet` HTML confirmation page, not
   a Google sign-in redirect.

## Verification done so far (no real sends triggered)

- `node --check` on `Code.gs`: no syntax errors.
- All 5 expected functions present: `sendCountdownEmail`, `sendReleaseDayEmail`,
  `sendDayAfterEmail`, `sendTestToMe`, `doGet`.
- `clasp run sendTestToMe` was **not** possible — this account doesn't have the
  Apps Script API execution mode enabled for this project (`Script function not
  found. Please make sure script is deployed as API executable.`). To enable
  CLI-triggered test runs in the future: script.google.com → user settings →
  turn on the Apps Script API, then add an `executionApi` entry to
  `appsscript.json` and redeploy.
- `sendTestToMe` itself has **not** been run yet (needs a human to open the editor
  and click Run, or the Apps Script API step above) — do that after fixing the two
  manual steps, before any real send.

## Send-day flow

1. Open the script project (link above).
2. Pick `sendCountdownEmail` / `sendReleaseDayEmail` / `sendDayAfterEmail` from the
   function dropdown next to **Run**.
3. Click **Run**. First run prompts for Gmail/Drive/Sheets authorization — expected.

## Redeploying after code changes

```sh
cd apps-script/blu2-newsletter
clasp push --force   # --force needed non-interactively; confirms the manifest overwrite prompt
clasp version "Describe the change"
clasp deploy --deploymentId AKfycbxDQxktM3Yd6IOEQY-aqFRk-_wAYhAykCFgKpR_JzA8TK895yVnCHk5Q9nET-E7T0vq -V <version> -d "Description"
```

`clasp create`/`clasp push` must **not** be run from inside `apps-script/` itself —
clasp walks up to the parent directory and finds the *other* project's
`.clasp.json` (`apps-script/.clasp.json`, the BLU2 Vote Sync project) and gets
confused ("Project file already exists."). Always `cd` directly into
`apps-script/blu2-newsletter/` first.

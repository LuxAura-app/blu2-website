# BLU2 Newsletter Mail Merge — Setup

Deployed via `clasp`, authenticated as **titledtentatively@gmail.com**.

- Script project: https://script.google.com/d/18RnyGLSDvNphyhn_Sstagr3GDmgRMH0R1kIrk-h0X6suOtzurN55Bjyw/edit
- Recipient Sheet: `1tkB8RD0g12uBUuM1Wezbb_vuCWIUn1coBMc2UlDk49U` ("BLU2 Newsletter
  Recipients", 112 people, `Unsubscribed`/`Unsubscribed At` columns)

## Sends via Resend Broadcasts, not GmailApp

The original build used `GmailApp.sendEmail()` in a per-recipient loop, with images
attached inline via `cid:`. That hit Gmail's ~100/day personal-account send quota
partway through the first real send (Aug 11 countdown email: 95/112 delivered, 17
failed with `Service invoked too many times for one day: email`). Resend Broadcasts
have no daily send-count ceiling on the free tier — only a 1,000-contact segment cap,
comfortably above this list's 112 — so a full send always goes out in one shot.

**Broadcasts don't support `cid:` inline attachments** (only Resend's transactional
`/emails` endpoint does), so every image is referenced by public HTTPS URL instead:

```
https://www.betterleftunsaid2.com/img/newsletter/email_rose.jpg
https://www.betterleftunsaid2.com/img/newsletter/email_wordmark.png
https://www.betterleftunsaid2.com/img/newsletter/email_studio.jpg
https://www.betterleftunsaid2.com/img/newsletter/email_reel_thumb.jpg
```

These are committed to the main site repo (`img/newsletter/`) and live in production.
`email_embers.jpg` (never referenced by any of the 3 templates) was already dropped
from the code entirely — nothing to source for it.

## One-time setup remaining: RESEND_API_KEY

Not yet set — I can't set this myself, it's a secret. In the script project above:
**Project Settings → Script Properties → Add script property** → name
`RESEND_API_KEY`, value = the same Resend API key used by the BLU2 Vote Sync
project's newsletter sends (same account, same verified sender
`party@betterleftunsaid2.com`). Nothing else needs configuring — `getOrCreateResendSegment_()`
creates the `BLU2 Newsletter` and `BLU2 Newsletter — Test` segments automatically on
first use and caches their IDs in Script Properties too.

## Verification done so far (no real Resend sends triggered)

- `node --check` on `Code.gs`: no syntax errors.
- Confirmed no stray `cid:`/`%%UNSUB_URL%%` remain in any of the 4 email bodies;
  each has the correct image URL count (countdown 2, release day 2, day after 3,
  test 2) and the `{{{RESEND_UNSUBSCRIBE_URL}}}` token.
- All 5 functions present: `sendCountdownEmail`, `sendReleaseDayEmail`,
  `sendDayAfterEmail`, `sendTestToMe`, `doGet`.
- `sendTestToMe` itself has **not** been run yet — needs `RESEND_API_KEY` set first,
  then a human to click Run (scopes changed since the last authorization — Gmail/Drive
  access dropped, `script.external_request` added — so expect a fresh authorization
  prompt on first run).

## Legacy unsubscribe web app — do not remove

`doGet()` and its deployed Web App URL are the **original** GmailApp-era unsubscribe
mechanism:

- Deployment ID: `AKfycbxDQxktM3Yd6IOEQY-aqFRk-_wAYhAykCFgKpR_JzA8TK895yVnCHk5Q9nET-E7T0vq`
- URL: `https://script.google.com/macros/s/AKfycbxDQxktM3Yd6IOEQY-aqFRk-_wAYhAykCFgKpR_JzA8TK895yVnCHk5Q9nET-E7T0vq/exec`

Kept fully intact because the Aug 11 countdown email already went out to 95 real
people with **that** link embedded — it must keep working indefinitely so anyone who
got that specific email can still opt out. New sends (via Resend Broadcasts) use
Resend's own `{{{RESEND_UNSUBSCRIBE_URL}}}` token instead — a completely separate
mechanism where the unsubscribe is recorded on the Resend contact record, not written
back to this Sheet. `syncContactsToResendSegment_()` re-pushes this Sheet's
`Unsubscribed` column into Resend on every send, so anyone who opted out the old way
stays suppressed going forward.

## Send-day flow

1. Open the script project (link above).
2. Pick `sendCountdownEmail` / `sendReleaseDayEmail` / `sendDayAfterEmail` from the
   function dropdown next to **Run**.
3. Click **Run**. First run (after the scope change) prompts for re-authorization —
   expected. Each run syncs all 112 recipients into the `BLU2 Newsletter` Resend
   segment (idempotent — safe to re-run, never creates duplicates), then sends one
   Broadcast to it.

`sendCountdownEmail` is wired up for consistency but not intended to run again for
this campaign — it already partially sent via the old Gmail mechanism (see git
history), and re-running it now would re-send "1 Day Left" to everyone, including
those who already got it, likely on or after release day itself.

## Redeploying after code changes

```sh
cd apps-script/blu2-newsletter
clasp push --force   # --force needed non-interactively; confirms the manifest overwrite prompt
```

No redeploy needed for the legacy web app (`doGet()`'s logic hasn't changed) — `clasp
push` alone is enough, since the editor's **Run** button always executes the latest
pushed code directly, not a pinned deployment version.

`clasp create`/`clasp push` must **not** be run from inside `apps-script/` itself —
clasp walks up to the parent directory and finds the *other* project's
`.clasp.json` (`apps-script/.clasp.json`, the BLU2 Vote Sync project) and gets
confused ("Project file already exists."). Always `cd` directly into
`apps-script/blu2-newsletter/` first.

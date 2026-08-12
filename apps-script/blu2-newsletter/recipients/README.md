# College Radio + AFD DJ recipient lists

Two new lists, separate from the main 112-person BLU2 fan newsletter
(`SHEET_ID` in `Code.gs`). Both are wired into `Code.gs` and live as
Google Sheets in the same Drive folder as the main recipient sheet:

- **College Radio Recipients (BLU2 outreach)** — 173 rows
  https://docs.google.com/spreadsheets/d/1lY7HpXwY-9NtszIY0NEVCXn-qz58Kmdnuvx8fBrjLLY/edit
- **AFD DJ Recipients (BLU2 outreach)** — 107 rows
  https://docs.google.com/spreadsheets/d/1gvjNd_1p9hgmKq6S9iRux9X0zhNwMRcqHC8KyLxU4YE/edit

`college_radio_recipients.csv` / `afd_dj_recipients.csv` in this folder are
local copies of the same data (Email, First, Last, Unsubscribed columns —
same shape as the main newsletter sheet).

## Where each list came from

- **College Radio** — extracted from `College+Radio+Playbook-1.pdf`
  (a purchased CollegeRadioDirectory.com directory). The PDF is a scanned
  table; text extraction (`pdftotext`) frequently split individual email
  addresses across the column-wrap in the original layout (e.g.
  `music@kzsu.stanford` on one visual line, `.edu` starting the next). A
  script rejoined addresses that wrapped this way and flagged anything
  where the rejoined domain didn't end in a recognized TLD.
- **AFD DJ List** — extracted from `AFD DJ List to reach out to.txt`,
  which contained three internal sections ("AFD DJ List", "Emailist",
  "Spotify") with heavy duplication; all three were merged and deduped
  per your direction.

## What "cleanup" means here — read before sending

Per your instruction, cleanup was **syntax validation + deduplication
only**:

- Removed exact duplicates (case-insensitive) — the AFD DJ List section
  alone had 117 raw lines collapsing to 71 unique addresses.
- Rejected anything that isn't syntactically a valid email.
- Auto-corrected 15 addresses in the College Radio list where a PDF
  line-wrap clearly truncated a major freemail domain (e.g.
  `wgremusic@gmail.co` → `wgremusic@gmail.com`) — high-confidence fixes
  only, no institutional domains were guessed at.
- Dropped 9 College Radio addresses where the domain was truncated by
  the PDF wrap and I could **not** safely guess the real domain (listed
  below) rather than risk misdirecting an email to a made-up address.

**What this does NOT mean:** none of these addresses have been confirmed
as currently monitored/active inboxes. A directory compiled "a few years
ago," as you described it, will have some dead mailboxes and staff
turnover no amount of syntax checking can catch. I don't have a way to
verify deliverability without either (a) an email-verification API/service
(ZeroBounce, NeverBounce, Hunter.io, etc. — say the word and I'll wire one
in), or (b) sending real mail and watching Resend's bounce data, which
naturally cleans the list after the first real send. Recommend treating
the first send to each list as the actual validation pass, then pruning
hard bounces from the Sheet afterward.

### College Radio entries dropped for unrecoverable truncated domains

These need a human to check the source PDF page and either fix or discard
— guessing the missing suffix risked sending to the wrong address entirely:

```
contact@coogradio.co        (likely .org or .com — Univ. of Houston area)
dslefkowitz@email.wm        (likely email.wm.edu — William & Mary)
dwood12@ashland.ed          (likely ashland.edu)
hiphop@radio.rutgers        (likely radio.rutgers.edu / rutgers.edu)
music@gtownradio.co         (likely .com or .org — Georgetown)
music@kzsu.stanford         (likely kzsu.stanford.edu)
music@wsum.wisc.ed          (likely wsum.wisc.edu)
radio.music@media.uc        (unclear which UC campus — needs manual lookup)
radio@illanoize.co          (may be genuine as-is — WHPK's Illanoize show)
```

## Overlap between the two lists

4 addresses appear on both lists (`hiphop@wvkr.org`, `info@wrir.org`,
`music@kure885.org`, `wqhsradio@gmail.com`) — they'll get both campaign
emails since the two Sheets are intentionally kept separate (different
content/asks, not deduped against each other).

Note: both sends share a single Resend segment, **BLU2 Outreach**, rather
than getting one each — the Resend account's plan caps segments at 3, and
`BLU2 Newsletter` + `BLU2 Newsletter — Test` already use 2 of them.
`sendSheetBroadcast_` in `Code.gs` re-syncs the shared segment's membership
to exactly the current Sheet immediately before every send (removing
leftovers from the other list's previous send), so recipients still only
get the campaign that's actually for them.

## Send history

Both lists went out for real on 2026-08-12:

- **College Radio** (`sendCollegeRadioAnnounceEmail`, broadcast
  `c87f802b-27fc-4688-929b-b81e479621d9`) — delivered to 172/173.
  `wwsp.music.director.@uwsp.edu` bounced at Resend contact-sync time
  (422, invalid — stray trailing dot before the `@`, present in the
  source PDF, not introduced by extraction). Fixed in the Sheet to
  `wwsp.music.director@uwsp.edu` afterward via a one-time Apps Script
  function (`fixWwspEmailTypo_ONETIME`, since removed from `Code.gs`) —
  it'll be included in any future send to this list, but did not
  receive the 2026-08-12 announcement.
- **AFD DJ List** (`sendDJListAnnounceEmail`, broadcast
  `809b0f56-108e-4c85-a729-0b8b0a940a0a`) — delivered to 107/107. The
  shared-segment cleanup removed exactly 168 leftover members from the
  College Radio send immediately before this one (172 synced minus the
  4 addresses on both lists), confirming no cross-contamination between
  the two campaigns.

Both are one-shot campaign functions — re-running either will re-send to
the full list again. Next real signal on list quality will be Resend's
bounce/open data over the following days; recommend pruning hard bounces
from the Sheets once that's in.

## Growing these lists further

For finding **updated station contacts and new DJs to add**, three options,
roughly in order of effort:

1. **CollegeRadioDirectory.com** is the actual source of the PDF you had —
   they sell dated update packs and post `@College_Radio_Directory`
   updates. Cheapest way to refresh the College Radio list specifically.
2. **Record pools** (DJcity, Urban DJ Pool, ZIPDJ, MyMP3Pool) aren't email
   lists, but they're how a lot of hip-hop/R&B radio and club DJs actually
   discover new music now — getting a track into one of those pools reaches
   DJs directly without needing their email at all. Worth doing alongside
   the cold-email push, not instead of it.
3. **Manual research per station/DJ** (station websites, Twitter/IG bios,
   "submit music" pages) is the only way to find genuinely new contacts,
   and it's inherently a browse-many-pages task. This CLI has web search/fetch
   and could do a batch of it, but Claude Desktop with the Chrome connector
   will be faster for this specific job since it can visually navigate
   station sites, contact forms, and social profiles interactively rather
   than parsing search snippets one query at a time. Recommend: use Desktop
   for the discovery/research legwork, then bring new contacts back here
   (or just tell me the addresses) and I'll add them to the Sheet and
   re-sync to Resend.

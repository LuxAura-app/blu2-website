/**
 * BLU2 — "Better Left Unsaid 2" newsletter mail merge (Resend Broadcasts)
 * -----------------------------------------------------------------------
 * Sends the 3 round-robin newsletters (countdown / release day / day after)
 * to the full, vetted BLU2 recipient list via Resend Broadcasts, with a
 * real one-click unsubscribe link (Resend's own, auto-generated) in every
 * email.
 *
 * WHY RESEND BROADCASTS, NOT GMAILAPP:
 * The original build used GmailApp.sendEmail() in a per-recipient loop,
 * with images attached inline via cid:. That hit Gmail's ~100/day personal
 * account send quota partway through the first real send (Aug 11 countdown
 * email: 95/112 delivered, 17 failed with "Service invoked too many times
 * for one day: email"). Resend Broadcasts have no daily send-count ceiling
 * on the free tier — only a 1,000-contact segment cap, comfortably above
 * this list's 112 — so a full send always goes out in one shot.
 *
 * IMPORTANT — Broadcasts don't support cid: inline attachments (only the
 * transactional /emails endpoint does), so every image is referenced by
 * public HTTPS URL instead, hosted at
 * https://www.betterleftunsaid2.com/img/newsletter/ — see
 * apps-script/blu2-newsletter/SETUP.md for how those got there.
 *
 * ONE-TIME SETUP:
 * 1. Project Settings → Script Properties → add RESEND_API_KEY (the same
 *    Resend account/verified sender used by the BLU2 Vote Sync project's
 *    newsletter sends — party@betterleftunsaid2.com). Never hardcode it.
 * 2. Run sendTestToMe() — syncs your own address into a small test segment
 *    and sends the Release Day email to just you via a real Resend
 *    Broadcast, so you can check rendering and click-test the unsubscribe
 *    flow before any real send.
 * 3. On each send day, run the matching function from the dropdown next to
 *    "Run": sendCountdownEmail() the day before, sendReleaseDayEmail() the
 *    morning of, sendDayAfterEmail() the day after. First run will prompt
 *    you to authorize Sheets access — that's expected.
 *
 * Recipients live in the "BLU2 Newsletter Recipients (full list +
 * unsubscribe tracking)" Sheet — 112 people. Every send re-syncs the full
 * list into a Resend segment (idempotent — safe to run repeatedly, never
 * creates duplicates), carrying over each person's current Unsubscribed
 * status from the Sheet.
 *
 * LEGACY UNSUBSCRIBE WEB APP — DO NOT REMOVE:
 * doGet() below and its deployed Web App URL (UNSUBSCRIBE_WEBAPP_URL) are
 * the *original* GmailApp-era unsubscribe mechanism. They're kept fully
 * intact because the Aug 11 countdown email already went out to 95 real
 * people with THAT link embedded — it must keep working indefinitely so
 * anyone who got that specific email can still opt out. New sends (via
 * Resend Broadcasts) use Resend's own {{{RESEND_UNSUBSCRIBE_URL}}} token
 * instead, which is a completely separate mechanism: those unsubscribes
 * are recorded on the Resend contact record, not written back to this
 * Sheet. syncContactsToResendSegment_() is what keeps Resend aware of
 * anyone who unsubscribed the old way, by re-pushing this Sheet's
 * Unsubscribed column on every send.
 */

var SHEET_ID = '1tkB8RD0g12uBUuM1Wezbb_vuCWIUn1coBMc2UlDk49U';
var UNSUBSCRIBE_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbxDQxktM3Yd6IOEQY-aqFRk-_wAYhAykCFgKpR_JzA8TK895yVnCHk5Q9nET-E7T0vq/exec'; // legacy — see header comment, do not repurpose
var RESEND_FROM_ADDRESS = 'Mali V <party@betterleftunsaid2.com>'; // verified Resend sender (same account as BLU2 Vote Sync)
var RESEND_SEGMENT_NAME = 'BLU2 Newsletter';
var RESEND_SEGMENT_PROP_KEY = 'RESEND_NEWSLETTER_SEGMENT_ID';
var RESEND_TEST_SEGMENT_NAME = 'BLU2 Newsletter \u2014 Test';
var RESEND_TEST_SEGMENT_PROP_KEY = 'RESEND_NEWSLETTER_TEST_SEGMENT_ID';

// College radio + AFD DJ outreach lists \u2014 separate Sheets/segments from the
// main fan newsletter above, built from the College Radio Playbook PDF and
// the "AFD DJ List to reach out to" doc. See recipients/README.md for how
// these were cleaned (syntax + dedupe only \u2014 no deliverability verification
// has been run against either list yet).
var COLLEGE_RADIO_SHEET_ID = '1lY7HpXwY-9NtszIY0NEVCXn-qz58Kmdnuvx8fBrjLLY';
var COLLEGE_RADIO_SEGMENT_NAME = 'BLU2 College Radio';
var COLLEGE_RADIO_SEGMENT_PROP_KEY = 'RESEND_COLLEGE_RADIO_SEGMENT_ID';

var AFD_DJ_SHEET_ID = '1gvjNd_1p9hgmKq6S9iRux9X0zhNwMRcqHC8KyLxU4YE';
var AFD_DJ_SEGMENT_NAME = 'BLU2 AFD DJ List';
var AFD_DJ_SEGMENT_PROP_KEY = 'RESEND_AFD_DJ_SEGMENT_ID';

function getSheet_() {
  return SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
}

/**
 * All recipient rows from the Sheet, including current Unsubscribed
 * status — needed so the Resend sync can correctly carry forward anyone
 * already unsubscribed (including via the legacy Gmail-era link) as
 * unsubscribed in Resend too, so they never receive a Broadcast.
 */
function getAllRecipientRows_() {
  var sheet = getSheet_();
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var emailCol = header.indexOf('Email');
  var firstCol = header.indexOf('First');
  var lastCol = header.indexOf('Last');
  var unsubCol = header.indexOf('Unsubscribed');

  var out = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var email = String(row[emailCol] || '').trim();
    if (!email) continue;
    out.push({
      email: email,
      first: String(row[firstCol] || '').trim(),
      last: String(row[lastCol] || '').trim(),
      unsubscribed: String(row[unsubCol] || '').trim().toUpperCase() === 'TRUE'
    });
  }
  return out;
}

function unsubscribeUrlFor_(email) {
  return UNSUBSCRIBE_WEBAPP_URL + '?email=' + encodeURIComponent(email);
}

/**
 * Same shape as getAllRecipientRows_, but for the College Radio / AFD DJ
 * Sheets, which don't carry the legacy Unsubscribed/Unsubscribed At
 * columns from the Gmail-era list — those two are new, Resend-only lists,
 * so "unsubscribed" always reads false here and is tracked entirely on
 * the Resend contact record going forward.
 */
function getRecipientRowsFromSheetId_(sheetId) {
  var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var emailCol = header.indexOf('Email');
  var firstCol = header.indexOf('First');
  var lastCol = header.indexOf('Last');

  var out = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var email = String(row[emailCol] || '').trim();
    if (!email) continue;
    out.push({
      email: email,
      first: String(row[firstCol] || '').trim(),
      last: String(row[lastCol] || '').trim(),
      unsubscribed: false
    });
  }
  return out;
}

/* ================================================================
   RESEND — segments, contact sync, broadcast send
   ================================================================ */

function getResendApiKey_() {
  var key = PropertiesService.getScriptProperties().getProperty('RESEND_API_KEY');
  if (!key) throw new Error("RESEND_API_KEY isn't set in Project Settings \u2192 Script Properties.");
  return key;
}

/**
 * Returns the Resend segment ID to send to, creating it once and caching
 * the ID in Script Properties so every send (and every retry) reuses the
 * same segment instead of creating a new one each time.
 */
function getOrCreateResendSegment_(apiKey, propKey, segmentName) {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty(propKey);
  if (existing) return existing;

  var res = UrlFetchApp.fetch('https://api.resend.com/segments', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify({ name: segmentName }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    throw new Error('Failed to create Resend segment "' + segmentName + '": ' + res.getContentText());
  }
  var id = JSON.parse(res.getContentText()).id;
  props.setProperty(propKey, id);
  return id;
}

/**
 * Creates (or, if the email already exists as a Resend contact, updates)
 * each recipient, carrying over their current Unsubscribed status from
 * the Sheet, then explicitly ensures segment membership via the dedicated
 * add-to-segment endpoint — the `segments` field on contact creation is
 * not reliable enough to depend on alone (confirmed: a real broadcast
 * send failed with "audience has no contacts" even after a successful
 * create call that included `segments`). Idempotent — safe to call
 * before every send; never creates duplicate contacts or errors on
 * re-adding someone already in the segment.
 */
function syncContactsToResendSegment_(apiKey, segmentId, recipients) {
  var synced = 0, failed = [];
  recipients.forEach(function(r) {
    var contactPayload = {
      email: r.email,
      first_name: r.first,
      last_name: r.last,
      unsubscribed: r.unsubscribed
    };

    var createRes = UrlFetchApp.fetch('https://api.resend.com/contacts', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + apiKey },
      payload: JSON.stringify(contactPayload),
      muteHttpExceptions: true
    });

    if (createRes.getResponseCode() >= 300) {
      // Already exists (or another 4xx) — update its fields instead.
      var updateRes = UrlFetchApp.fetch('https://api.resend.com/contacts/' + encodeURIComponent(r.email), {
        method: 'patch',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + apiKey },
        payload: JSON.stringify(contactPayload),
        muteHttpExceptions: true
      });
      if (updateRes.getResponseCode() >= 300) {
        failed.push(r.email + ': create=' + createRes.getResponseCode() + ' ' + createRes.getContentText() +
          ' | update=' + updateRes.getResponseCode() + ' ' + updateRes.getContentText());
        return;
      }
    }

    // Always explicitly confirm segment membership, regardless of the
    // create/update path above.
    var segRes = UrlFetchApp.fetch(
      'https://api.resend.com/contacts/' + encodeURIComponent(r.email) + '/segments/' + segmentId,
      { method: 'post', headers: { Authorization: 'Bearer ' + apiKey }, muteHttpExceptions: true }
    );
    if (segRes.getResponseCode() < 300) {
      synced++;
    } else {
      failed.push(r.email + ': segment-add=' + segRes.getResponseCode() + ' ' + segRes.getContentText());
    }
  });
  Logger.log('Synced ' + synced + ' / ' + recipients.length + ' contacts to Resend segment ' + segmentId + '.');
  if (failed.length) Logger.log('Sync failures:\n' + failed.join('\n'));
  return { synced: synced, failed: failed };
}

/**
 * Creates and immediately sends (send: true) a Broadcast to the given
 * segment. HTML should use {{{RESEND_UNSUBSCRIBE_URL}}} for the
 * unsubscribe link — Resend fills it in per recipient automatically.
 */
function sendResendBroadcast_(apiKey, segmentId, subject, html) {
  var res = UrlFetchApp.fetch('https://api.resend.com/broadcasts', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify({
      segment_id: segmentId,
      from: RESEND_FROM_ADDRESS,
      subject: subject,
      html: html,
      send: true
    }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    throw new Error('Failed to send Resend broadcast: ' + res.getContentText());
  }
  var broadcastId = JSON.parse(res.getContentText()).id;
  Logger.log('Broadcast sent. Resend broadcast id: ' + broadcastId);
  return broadcastId;
}

/**
 * Syncs every current recipient into the main newsletter segment and
 * sends one broadcast to it. Shared by all 3 real send functions.
 */
function sendNewsletterBroadcast_(subject, html) {
  var apiKey = getResendApiKey_();
  var segmentId = getOrCreateResendSegment_(apiKey, RESEND_SEGMENT_PROP_KEY, RESEND_SEGMENT_NAME);
  var recipients = getAllRecipientRows_();
  syncContactsToResendSegment_(apiKey, segmentId, recipients);
  Utilities.sleep(2000); // give segment membership a moment to propagate before sending
  return sendResendBroadcast_(apiKey, segmentId, subject, html);
}

/**
 * Same as sendNewsletterBroadcast_ but for an arbitrary recipient Sheet +
 * segment — shared by the College Radio and AFD DJ sends below.
 */
function sendSheetBroadcast_(sheetId, segmentPropKey, segmentName, subject, html) {
  var apiKey = getResendApiKey_();
  var segmentId = getOrCreateResendSegment_(apiKey, segmentPropKey, segmentName);
  var recipients = getRecipientRowsFromSheetId_(sheetId);
  syncContactsToResendSegment_(apiKey, segmentId, recipients);
  Utilities.sleep(2000); // give segment membership a moment to propagate before sending
  return sendResendBroadcast_(apiKey, segmentId, subject, html);
}

// ---- The 3 round-robin sends ----

function sendCountdownEmail() {
  // Send the day before release (Tue Aug 11). NOTE: already run once via
  // the old GmailApp mechanism (95/112 delivered before hitting Gmail's
  // daily quota) — see git history. Re-running this via Resend would
  // re-send "1 Day Left" to everyone, including those 95, likely on or
  // after release day itself. Left wired up for completeness/consistency,
  // not intended to run again for this campaign.
  sendNewsletterBroadcast_(
    "1 Day Left \u2014 Better Left Unsaid 2 Streams Tomorrow",
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Better Left Unsaid 2</title></head>\n<body style=\"margin:0;padding:0;background-color:#0a0806;font-family:Georgia,'Times New Roman',serif;\">\n<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;\">1 day left. Better Left Unsaid 2 streams everywhere tomorrow.</div>\n<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background-color:#0a0806;\">\n<tr><td align=\"center\" style=\"padding:32px 16px;\">\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;background-color:#120d0a;border:1px solid #2a1e16;\">\n\n<tr><td align=\"center\" style=\"padding:26px 20px 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:4px;color:#f2994a;text-transform:uppercase;\">Better Left Unsaid 2 &nbsp;/&nbsp; Mali V</td></tr>\n<tr><td align=\"center\" style=\"padding:6px 30px 10px;\"><img src=\"https://www.betterleftunsaid2.com/img/newsletter/email_rose.jpg\" width=\"230\" alt=\"Better Left Unsaid 2\" style=\"display:block;width:230px;max-width:60%;height:auto;border:1px solid #3a281c;\"></td></tr>\n<tr><td align=\"center\" style=\"padding:14px 30px 2px;font-family:Georgia,serif;font-style:italic;font-size:15px;line-height:24px;color:#f4ede1;\">&ldquo;Some things better left unsaid<br>are better off in the past.&rdquo;\n<div style=\"margin-top:6px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#a89a86;text-transform:uppercase;\">&mdash; Mali V</div></td></tr>\n<tr><td align=\"center\" style=\"padding:22px 20px 2px;font-family:Arial,Helvetica,sans-serif;\">\n<div style=\"font-size:56px;line-height:56px;font-weight:bold;color:#f2994a;letter-spacing:1px;\">1 DAY</div>\n<div style=\"font-size:13px;letter-spacing:4px;color:#f4ede1;text-transform:uppercase;margin-top:6px;\">until it streams everywhere</div></td></tr>\n<tr><td align=\"center\" style=\"padding:10px 20px 2px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#f4ede1;\">Wednesday &middot; August 12, 2026</td></tr>\n<tr><td align=\"center\" style=\"padding:16px 30px 6px;font-family:Georgia,serif;font-size:14px;line-height:22px;color:#f4ede1;\">Tomorrow, <strong>Better Left Unsaid 2</strong> goes live on every DSP &mdash; Spotify, Apple Music, Amazon, YouTube Music and more. Set your reminder now so you're first to hear it.</td></tr>\n<tr><td align=\"center\" style=\"padding:8px 24px 4px;\">\n<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr><td align=\"center\" style=\"background-color:#d9642c;background-image:linear-gradient(135deg,#d9642c,#f2994a);border-radius:3px;\">\n<a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"display:inline-block;padding:15px 38px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:2px;color:#0a0806;text-decoration:none;text-transform:uppercase;\">Set My Reminder</a>\n</td></tr></table></td></tr>\n<tr><td align=\"center\" style=\"padding:6px 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" style=\"color:#a89a86;\">distrokid.com/hyperfollow/maliv1/blu-2-2</a></td></tr>\n<tr><td style=\"padding:26px 30px 8px;\"><div style=\"border-top:1px solid #2a1e16;\"></div></td></tr>\n<tr><td align=\"center\" style=\"padding:4px 30px 24px;\"><img src=\"https://www.betterleftunsaid2.com/img/newsletter/email_wordmark.png\" width=\"150\" alt=\"Mali V\" style=\"display:block;width:150px;max-width:45%;height:auto;margin:0 auto;\">\n<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#a89a86;text-transform:uppercase;margin-top:10px;\">Executive Produced by SZZN</div></td></tr>\n\n</table>\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;\">\n<tr><td style=\"padding:20px 20px 4px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#a89a86;\">\nMali V &middot; Better Left Unsaid 2 &middot; Executive Produced by SZZN<br>\nAll Flights Delayed (AFD)\n<tr><td align=\"center\" style=\"padding:14px 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;color:#a89a86;\">\n<a href=\"{{{RESEND_UNSUBSCRIBE_URL}}}\" style=\"color:#a89a86;text-decoration:underline;\">Unsubscribe from BLU2 updates</a>\n</td></tr></td></tr></table></td></tr></table></body></html>"
  );
}

function sendReleaseDayEmail() {
  // Send the morning of release (Wed Aug 12)
  sendNewsletterBroadcast_(
    "It's Here \u2014 Better Left Unsaid 2 Is Out Now",
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Better Left Unsaid 2</title></head>\n<body style=\"margin:0;padding:0;background-color:#0a0806;font-family:Georgia,'Times New Roman',serif;\">\n<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;\">It's here. Better Left Unsaid 2 is streaming on every platform right now.</div>\n<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background-color:#0a0806;\">\n<tr><td align=\"center\" style=\"padding:32px 16px;\">\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;background-color:#120d0a;border:1px solid #2a1e16;\">\n\n<tr><td align=\"center\" style=\"padding:26px 20px 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:4px;color:#f2994a;text-transform:uppercase;\">Out Now &nbsp;/&nbsp; All DSPs</td></tr>\n<tr><td align=\"center\" style=\"padding:6px 20px 10px;\"><img src=\"https://www.betterleftunsaid2.com/img/newsletter/email_wordmark.png\" width=\"260\" alt=\"Mali V - Better Left Unsaid 2\" style=\"display:block;width:260px;max-width:68%;height:auto;\"></td></tr>\n<tr><td align=\"center\" style=\"padding:8px 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:bold;letter-spacing:3px;color:#f2994a;text-transform:uppercase;\">It&rsquo;s Here</td></tr>\n<tr><td align=\"center\" style=\"padding:0 30px 8px;font-family:Georgia,serif;font-size:14px;line-height:22px;color:#f4ede1;\"><strong>Better Left Unsaid 2</strong> by Mali V is streaming everywhere, right now.</td></tr>\n<tr><td align=\"center\" style=\"padding:8px 24px 4px;\">\n<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr><td align=\"center\" style=\"background-color:#d9642c;background-image:linear-gradient(135deg,#d9642c,#f2994a);border-radius:3px;\">\n<a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"display:inline-block;padding:15px 38px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:2px;color:#0a0806;text-decoration:none;text-transform:uppercase;\">Stream Everywhere</a>\n</td></tr></table></td></tr>\n<tr><td align=\"center\" style=\"padding:6px 12px 4px;\"><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Spotify</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Apple Music</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">YouTube Music</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Amazon Music</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Tidal</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Deezer</a></td></tr></table></td></tr>\n<tr><td align=\"center\" style=\"padding:0 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;color:#a89a86;\">one link, every platform &mdash; tap any DSP above</td></tr>\n<tr><td align=\"center\" style=\"padding:20px 30px 6px;\"><img src=\"https://www.betterleftunsaid2.com/img/newsletter/email_rose.jpg\" width=\"150\" alt=\"Better Left Unsaid 2\" style=\"display:block;width:150px;max-width:40%;height:auto;border:1px solid #3a281c;margin:0 auto;\"></td></tr>\n<tr><td align=\"center\" style=\"padding:12px 30px 4px;font-family:Georgia,serif;font-style:italic;font-size:13px;line-height:21px;color:#f4ede1;\">&ldquo;Some things better left unsaid are better off in the past.&rdquo;</td></tr>\n<tr><td style=\"padding:26px 30px 8px;\"><div style=\"border-top:1px solid #2a1e16;\"></div></td></tr>\n<tr><td align=\"center\" style=\"padding:4px 30px 24px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#a89a86;text-transform:uppercase;\">Executive Produced by SZZN &nbsp;&middot;&nbsp; <a href=\"https://www.betterleftunsaid2.com\" style=\"color:#a89a86;\">betterleftunsaid2.com</a></td></tr>\n\n</table>\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;\">\n<tr><td style=\"padding:20px 20px 4px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#a89a86;\">\nMali V &middot; Better Left Unsaid 2 &middot; Executive Produced by SZZN<br>\nAll Flights Delayed (AFD)\n<tr><td align=\"center\" style=\"padding:14px 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;color:#a89a86;\">\n<a href=\"{{{RESEND_UNSUBSCRIBE_URL}}}\" style=\"color:#a89a86;text-decoration:underline;\">Unsubscribe from BLU2 updates</a>\n</td></tr></td></tr></table></td></tr></table></body></html>"
  );
}

function sendDayAfterEmail() {
  // Send the day after release (Thu Aug 13)
  sendNewsletterBroadcast_(
    "Still Out, Still Streaming \u2014 Better Left Unsaid 2",
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Better Left Unsaid 2</title></head>\n<body style=\"margin:0;padding:0;background-color:#0a0806;font-family:Georgia,'Times New Roman',serif;\">\n<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;\">Still out, still streaming, plus the performance reel.</div>\n<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background-color:#0a0806;\">\n<tr><td align=\"center\" style=\"padding:32px 16px;\">\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;background-color:#120d0a;border:1px solid #2a1e16;\">\n\n<tr><td align=\"center\" style=\"padding:26px 20px 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:4px;color:#f2994a;text-transform:uppercase;\">Still Streaming &nbsp;/&nbsp; Mali V</td></tr>\n<tr><td align=\"center\" style=\"padding:6px 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;letter-spacing:2px;color:#f2994a;text-transform:uppercase;\">It&rsquo;s Out. Run It Back.</td></tr>\n<tr><td align=\"center\" style=\"padding:12px 30px 12px;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"display:inline-block;\"><img src=\"https://www.betterleftunsaid2.com/img/newsletter/email_reel_thumb.jpg\" width=\"260\" alt=\"Watch the performance reel\" style=\"display:block;width:260px;max-width:70%;height:auto;border:1px solid #3a281c;\"></a>\n<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#a89a86;text-transform:uppercase;margin-top:8px;\">tap to watch &middot; from the stoop to the board</div></td></tr>\n<tr><td align=\"center\" style=\"padding:2px 30px 6px;font-family:Georgia,serif;font-size:14px;line-height:22px;color:#f4ede1;\"><strong>Better Left Unsaid 2</strong> dropped yesterday on every DSP. If you haven&rsquo;t pressed play yet &mdash; or you have and you&rsquo;re already back for round two &mdash; it&rsquo;s all still right here.</td></tr>\n<tr><td align=\"center\" style=\"padding:8px 24px 4px;\">\n<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr><td align=\"center\" style=\"background-color:#d9642c;background-image:linear-gradient(135deg,#d9642c,#f2994a);border-radius:3px;\">\n<a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"display:inline-block;padding:15px 38px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:2px;color:#0a0806;text-decoration:none;text-transform:uppercase;\">Stream It Again</a>\n</td></tr></table></td></tr>\n<tr><td align=\"center\" style=\"padding:22px 30px 4px;\"><img src=\"https://www.betterleftunsaid2.com/img/newsletter/email_studio.jpg\" width=\"230\" alt=\"Mali V in the studio\" style=\"display:block;width:230px;max-width:60%;height:auto;border:1px solid #3a281c;margin:0 auto;\">\n<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#a89a86;text-transform:uppercase;margin-top:8px;\">From The Board To The World</div></td></tr>\n<tr><td align=\"center\" style=\"padding:16px 30px 6px;\"><img src=\"https://www.betterleftunsaid2.com/img/newsletter/email_rose.jpg\" width=\"120\" alt=\"Better Left Unsaid 2\" style=\"display:block;width:120px;max-width:34%;height:auto;border:1px solid #3a281c;margin:0 auto;\"></td></tr>\n<tr><td style=\"padding:24px 30px 8px;\"><div style=\"border-top:1px solid #2a1e16;\"></div></td></tr>\n<tr><td align=\"center\" style=\"padding:4px 30px 24px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#a89a86;text-transform:uppercase;\">Executive Produced by SZZN &nbsp;&middot;&nbsp; <a href=\"https://www.betterleftunsaid2.com\" style=\"color:#a89a86;\">betterleftunsaid2.com</a></td></tr>\n\n</table>\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;\">\n<tr><td style=\"padding:20px 20px 4px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#a89a86;\">\nMali V &middot; Better Left Unsaid 2 &middot; Executive Produced by SZZN<br>\nAll Flights Delayed (AFD)\n<tr><td align=\"center\" style=\"padding:14px 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;color:#a89a86;\">\n<a href=\"{{{RESEND_UNSUBSCRIBE_URL}}}\" style=\"color:#a89a86;text-decoration:underline;\">Unsubscribe from BLU2 updates</a>\n</td></tr></td></tr></table></td></tr></table></body></html>"
  );
}

// ---- College radio + AFD DJ list sends ----
// Each is a single one-off announcement, not a 3-part campaign like the fan
// newsletter above — college programmers and DJs get pitched once, not
// drip-fed a countdown. Re-running either function re-sends to the full
// list (Resend contact sync is idempotent, but the Broadcast itself is
// not — it will re-deliver to everyone again), so treat these as
// one-time-per-campaign, same as sendCountdownEmail() above.

function sendCollegeRadioAnnounceEmail() {
  sendSheetBroadcast_(
    COLLEGE_RADIO_SHEET_ID,
    COLLEGE_RADIO_SEGMENT_PROP_KEY,
    COLLEGE_RADIO_SEGMENT_NAME,
    "For Your Rotation — Mali V, Better Left Unsaid 2 (Out Now)",
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Better Left Unsaid 2</title></head>\n<body style=\"margin:0;padding:0;background-color:#0a0806;font-family:Georgia,'Times New Roman',serif;\">\n<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;\">Two feature tracks for your format, streaming now — plus the full album.</div>\n<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background-color:#0a0806;\">\n<tr><td align=\"center\" style=\"padding:32px 16px;\">\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;background-color:#120d0a;border:1px solid #2a1e16;\">\n\n<tr><td align=\"center\" style=\"padding:26px 20px 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:4px;color:#f2994a;text-transform:uppercase;\">College Radio Submission &nbsp;/&nbsp; Mali V</td></tr>\n<tr><td align=\"center\" style=\"padding:6px 20px 10px;\"><img src=\"https://www.betterleftunsaid2.com/img/newsletter/email_wordmark.png\" width=\"260\" alt=\"Mali V - Better Left Unsaid 2\" style=\"display:block;width:260px;max-width:68%;height:auto;\"></td></tr>\n<tr><td align=\"center\" style=\"padding:8px 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:bold;letter-spacing:2px;color:#f2994a;text-transform:uppercase;\">Out Now, For Your Format</td></tr>\n<tr><td align=\"center\" style=\"padding:0 30px 10px;font-family:Georgia,serif;font-size:14px;line-height:22px;color:#f4ede1;\">Mali V's new album, <strong>Better Left Unsaid 2</strong>, is streaming everywhere today. We're submitting two tracks from it for your consideration in regular rotation:</td></tr>\n<tr><td style=\"padding:6px 30px 4px;\">\n<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border:1px solid #2a1e16;background-color:#170f0a;\">\n<tr><td style=\"padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#f2994a;text-transform:uppercase;border-bottom:1px solid #2a1e16;white-space:nowrap;\">Track 1</td><td align=\"right\" style=\"padding:14px 18px;font-family:Georgia,serif;font-size:14px;color:#f4ede1;border-bottom:1px solid #2a1e16;\">Better Left Unsaid</td></tr>\n<tr><td style=\"padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#f2994a;text-transform:uppercase;white-space:nowrap;\">Track 2</td><td align=\"right\" style=\"padding:14px 18px;font-family:Georgia,serif;font-size:14px;color:#f4ede1;\">Ecstacy - Ex-To-See</td></tr>\n</table>\n</td></tr>\n<tr><td align=\"center\" style=\"padding:18px 24px 4px;\">\n<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr><td align=\"center\" style=\"background-color:#d9642c;background-image:linear-gradient(135deg,#d9642c,#f2994a);border-radius:3px;\">\n<a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"display:inline-block;padding:15px 38px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:2px;color:#0a0806;text-decoration:none;text-transform:uppercase;\">Stream The Full Album</a>\n</td></tr></table></td></tr>\n<tr><td align=\"center\" style=\"padding:6px 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" style=\"color:#a89a86;\">distrokid.com/hyperfollow/maliv1/blu-2-2</a></td></tr>\n<tr><td align=\"center\" style=\"padding:18px 30px 4px;font-family:Georgia,serif;font-size:14px;line-height:22px;color:#f4ede1;\">For the full story behind the record, high-res art, and more from Mali V, visit <a href=\"https://www.betterleftunsaid2.com\" style=\"color:#f2994a;\">BetterLeftUnsaid2.com</a>.</td></tr>\n<tr><td align=\"center\" style=\"padding:16px 30px 6px;\"><img src=\"https://www.betterleftunsaid2.com/img/newsletter/email_rose.jpg\" width=\"140\" alt=\"Better Left Unsaid 2\" style=\"display:block;width:140px;max-width:38%;height:auto;border:1px solid #3a281c;margin:0 auto;\"></td></tr>\n<tr><td align=\"center\" style=\"padding:12px 30px 4px;font-family:Georgia,serif;font-style:italic;font-size:13px;line-height:21px;color:#f4ede1;\">&ldquo;Some things better left unsaid are better off in the past.&rdquo;</td></tr>\n<tr><td style=\"padding:26px 30px 8px;\"><div style=\"border-top:1px solid #2a1e16;\"></div></td></tr>\n<tr><td align=\"center\" style=\"padding:4px 30px 24px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#a89a86;text-transform:uppercase;\">Executive Produced by SZZN &nbsp;&middot;&nbsp; <a href=\"https://www.betterleftunsaid2.com\" style=\"color:#a89a86;\">betterleftunsaid2.com</a></td></tr>\n\n</table>\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;\">\n<tr><td style=\"padding:20px 20px 4px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#a89a86;\">\nMali V &middot; Better Left Unsaid 2 &middot; Executive Produced by SZZN<br>\nAll Flights Delayed (AFD)\n<tr><td align=\"center\" style=\"padding:14px 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;color:#a89a86;\">\n<a href=\"{{{RESEND_UNSUBSCRIBE_URL}}}\" style=\"color:#a89a86;text-decoration:underline;\">Unsubscribe from BLU2 radio updates</a>\n</td></tr></td></tr></table></td></tr></table></body></html>"
  );
}

function sendDJListAnnounceEmail() {
  sendSheetBroadcast_(
    AFD_DJ_SHEET_ID,
    AFD_DJ_SEGMENT_PROP_KEY,
    AFD_DJ_SEGMENT_NAME,
    "Mali V's New Album, Better Left Unsaid 2, Is Streaming Now",
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Better Left Unsaid 2</title></head>\n<body style=\"margin:0;padding:0;background-color:#0a0806;font-family:Georgia,'Times New Roman',serif;\">\n<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;\">New music from Mali V — two feature singles inside, plus the full album.</div>\n<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background-color:#0a0806;\">\n<tr><td align=\"center\" style=\"padding:32px 16px;\">\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;background-color:#120d0a;border:1px solid #2a1e16;\">\n\n<tr><td align=\"center\" style=\"padding:26px 20px 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:4px;color:#f2994a;text-transform:uppercase;\">New Music &nbsp;/&nbsp; Mali V</td></tr>\n<tr><td align=\"center\" style=\"padding:6px 20px 10px;\"><img src=\"https://www.betterleftunsaid2.com/img/newsletter/email_wordmark.png\" width=\"260\" alt=\"Mali V - Better Left Unsaid 2\" style=\"display:block;width:260px;max-width:68%;height:auto;\"></td></tr>\n<tr><td align=\"center\" style=\"padding:8px 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:bold;letter-spacing:2px;color:#f2994a;text-transform:uppercase;\">Meet Mali V</td></tr>\n<tr><td align=\"center\" style=\"padding:0 30px 10px;font-family:Georgia,serif;font-size:14px;line-height:22px;color:#f4ede1;\">Mali V, executive produced by SZZN, just dropped a new album — <strong>Better Left Unsaid 2</strong> — and it's streaming on every platform today. Two tracks from it we think are worth your ear first:</td></tr>\n<tr><td style=\"padding:6px 30px 4px;\">\n<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border:1px solid #2a1e16;background-color:#170f0a;\">\n<tr><td style=\"padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#f2994a;text-transform:uppercase;border-bottom:1px solid #2a1e16;white-space:nowrap;\">Track 1</td><td align=\"right\" style=\"padding:14px 18px;font-family:Georgia,serif;font-size:14px;color:#f4ede1;border-bottom:1px solid #2a1e16;\">Better Left Unsaid</td></tr>\n<tr><td style=\"padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#f2994a;text-transform:uppercase;white-space:nowrap;\">Track 2</td><td align=\"right\" style=\"padding:14px 18px;font-family:Georgia,serif;font-size:14px;color:#f4ede1;\">Ecstacy - Ex-To-See</td></tr>\n</table>\n</td></tr>\n<tr><td align=\"center\" style=\"padding:18px 24px 4px;\">\n<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr><td align=\"center\" style=\"background-color:#d9642c;background-image:linear-gradient(135deg,#d9642c,#f2994a);border-radius:3px;\">\n<a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"display:inline-block;padding:15px 38px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:2px;color:#0a0806;text-decoration:none;text-transform:uppercase;\">Stream The Full Album</a>\n</td></tr></table></td></tr>\n<tr><td align=\"center\" style=\"padding:6px 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" style=\"color:#a89a86;\">distrokid.com/hyperfollow/maliv1/blu-2-2</a></td></tr>\n<tr><td align=\"center\" style=\"padding:18px 30px 4px;font-family:Georgia,serif;font-size:14px;line-height:22px;color:#f4ede1;\">Get to know the story behind the record at <a href=\"https://www.betterleftunsaid2.com\" style=\"color:#f2994a;\">BetterLeftUnsaid2.com</a> — and if it's in your wheelhouse, we'd love to hear it in the mix.</td></tr>\n<tr><td align=\"center\" style=\"padding:16px 30px 6px;\"><img src=\"https://www.betterleftunsaid2.com/img/newsletter/email_rose.jpg\" width=\"140\" alt=\"Better Left Unsaid 2\" style=\"display:block;width:140px;max-width:38%;height:auto;border:1px solid #3a281c;margin:0 auto;\"></td></tr>\n<tr><td align=\"center\" style=\"padding:12px 30px 4px;font-family:Georgia,serif;font-style:italic;font-size:13px;line-height:21px;color:#f4ede1;\">&ldquo;Some things better left unsaid are better off in the past.&rdquo;</td></tr>\n<tr><td style=\"padding:26px 30px 8px;\"><div style=\"border-top:1px solid #2a1e16;\"></div></td></tr>\n<tr><td align=\"center\" style=\"padding:4px 30px 24px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#a89a86;text-transform:uppercase;\">Executive Produced by SZZN &nbsp;&middot;&nbsp; <a href=\"https://www.betterleftunsaid2.com\" style=\"color:#a89a86;\">betterleftunsaid2.com</a></td></tr>\n\n</table>\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;\">\n<tr><td style=\"padding:20px 20px 4px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#a89a86;\">\nMali V &middot; Better Left Unsaid 2 &middot; Executive Produced by SZZN<br>\nAll Flights Delayed (AFD)\n<tr><td align=\"center\" style=\"padding:14px 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;color:#a89a86;\">\n<a href=\"{{{RESEND_UNSUBSCRIBE_URL}}}\" style=\"color:#a89a86;text-decoration:underline;\">Unsubscribe from AFD updates</a>\n</td></tr></td></tr></table></td></tr></table></body></html>"
  );
}

function sendCollegeRadioTestToMe() {
  var me = Session.getActiveUser().getEmail();
  var apiKey = getResendApiKey_();
  var segmentId = getOrCreateResendSegment_(apiKey, RESEND_TEST_SEGMENT_PROP_KEY, RESEND_TEST_SEGMENT_NAME);
  syncContactsToResendSegment_(apiKey, segmentId, [{ email: me, first: '', last: '', unsubscribed: false }]);
  Utilities.sleep(2000); // give segment membership a moment to propagate before sending
  sendResendBroadcast_(apiKey, segmentId, "[TEST] For Your Rotation — Mali V, Better Left Unsaid 2 (Out Now)", "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Better Left Unsaid 2</title></head>\n<body style=\"margin:0;padding:0;background-color:#0a0806;font-family:Georgia,'Times New Roman',serif;\">\n<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;\">Two feature tracks for your format, streaming now — plus the full album.</div>\n<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background-color:#0a0806;\">\n<tr><td align=\"center\" style=\"padding:32px 16px;\">\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;background-color:#120d0a;border:1px solid #2a1e16;\">\n\n<tr><td align=\"center\" style=\"padding:26px 20px 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:4px;color:#f2994a;text-transform:uppercase;\">College Radio Submission &nbsp;/&nbsp; Mali V</td></tr>\n<tr><td align=\"center\" style=\"padding:6px 20px 10px;\"><img src=\"https://www.betterleftunsaid2.com/img/newsletter/email_wordmark.png\" width=\"260\" alt=\"Mali V - Better Left Unsaid 2\" style=\"display:block;width:260px;max-width:68%;height:auto;\"></td></tr>\n<tr><td align=\"center\" style=\"padding:8px 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:bold;letter-spacing:2px;color:#f2994a;text-transform:uppercase;\">Out Now, For Your Format</td></tr>\n<tr><td align=\"center\" style=\"padding:0 30px 10px;font-family:Georgia,serif;font-size:14px;line-height:22px;color:#f4ede1;\">Mali V's new album, <strong>Better Left Unsaid 2</strong>, is streaming everywhere today. We're submitting two tracks from it for your consideration in regular rotation:</td></tr>\n<tr><td style=\"padding:6px 30px 4px;\">\n<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border:1px solid #2a1e16;background-color:#170f0a;\">\n<tr><td style=\"padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#f2994a;text-transform:uppercase;border-bottom:1px solid #2a1e16;white-space:nowrap;\">Track 1</td><td align=\"right\" style=\"padding:14px 18px;font-family:Georgia,serif;font-size:14px;color:#f4ede1;border-bottom:1px solid #2a1e16;\">Better Left Unsaid</td></tr>\n<tr><td style=\"padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#f2994a;text-transform:uppercase;white-space:nowrap;\">Track 2</td><td align=\"right\" style=\"padding:14px 18px;font-family:Georgia,serif;font-size:14px;color:#f4ede1;\">Ecstacy - Ex-To-See</td></tr>\n</table>\n</td></tr>\n<tr><td align=\"center\" style=\"padding:18px 24px 4px;\">\n<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr><td align=\"center\" style=\"background-color:#d9642c;background-image:linear-gradient(135deg,#d9642c,#f2994a);border-radius:3px;\">\n<a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"display:inline-block;padding:15px 38px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:2px;color:#0a0806;text-decoration:none;text-transform:uppercase;\">Stream The Full Album</a>\n</td></tr></table></td></tr>\n<tr><td align=\"center\" style=\"padding:6px 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" style=\"color:#a89a86;\">distrokid.com/hyperfollow/maliv1/blu-2-2</a></td></tr>\n<tr><td align=\"center\" style=\"padding:18px 30px 4px;font-family:Georgia,serif;font-size:14px;line-height:22px;color:#f4ede1;\">For the full story behind the record, high-res art, and more from Mali V, visit <a href=\"https://www.betterleftunsaid2.com\" style=\"color:#f2994a;\">BetterLeftUnsaid2.com</a>.</td></tr>\n<tr><td align=\"center\" style=\"padding:16px 30px 6px;\"><img src=\"https://www.betterleftunsaid2.com/img/newsletter/email_rose.jpg\" width=\"140\" alt=\"Better Left Unsaid 2\" style=\"display:block;width:140px;max-width:38%;height:auto;border:1px solid #3a281c;margin:0 auto;\"></td></tr>\n<tr><td align=\"center\" style=\"padding:12px 30px 4px;font-family:Georgia,serif;font-style:italic;font-size:13px;line-height:21px;color:#f4ede1;\">&ldquo;Some things better left unsaid are better off in the past.&rdquo;</td></tr>\n<tr><td style=\"padding:26px 30px 8px;\"><div style=\"border-top:1px solid #2a1e16;\"></div></td></tr>\n<tr><td align=\"center\" style=\"padding:4px 30px 24px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#a89a86;text-transform:uppercase;\">Executive Produced by SZZN &nbsp;&middot;&nbsp; <a href=\"https://www.betterleftunsaid2.com\" style=\"color:#a89a86;\">betterleftunsaid2.com</a></td></tr>\n\n</table>\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;\">\n<tr><td style=\"padding:20px 20px 4px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#a89a86;\">\nMali V &middot; Better Left Unsaid 2 &middot; Executive Produced by SZZN<br>\nAll Flights Delayed (AFD)\n<tr><td align=\"center\" style=\"padding:14px 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;color:#a89a86;\">\n<a href=\"{{{RESEND_UNSUBSCRIBE_URL}}}\" style=\"color:#a89a86;text-decoration:underline;\">Unsubscribe from BLU2 radio updates</a>\n</td></tr></td></tr></table></td></tr></table></body></html>");
  Logger.log('Test broadcast sent to ' + me);
}

function sendDJListTestToMe() {
  var me = Session.getActiveUser().getEmail();
  var apiKey = getResendApiKey_();
  var segmentId = getOrCreateResendSegment_(apiKey, RESEND_TEST_SEGMENT_PROP_KEY, RESEND_TEST_SEGMENT_NAME);
  syncContactsToResendSegment_(apiKey, segmentId, [{ email: me, first: '', last: '', unsubscribed: false }]);
  Utilities.sleep(2000); // give segment membership a moment to propagate before sending
  sendResendBroadcast_(apiKey, segmentId, "[TEST] Mali V's New Album, Better Left Unsaid 2, Is Streaming Now", "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Better Left Unsaid 2</title></head>\n<body style=\"margin:0;padding:0;background-color:#0a0806;font-family:Georgia,'Times New Roman',serif;\">\n<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;\">New music from Mali V — two feature singles inside, plus the full album.</div>\n<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background-color:#0a0806;\">\n<tr><td align=\"center\" style=\"padding:32px 16px;\">\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;background-color:#120d0a;border:1px solid #2a1e16;\">\n\n<tr><td align=\"center\" style=\"padding:26px 20px 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:4px;color:#f2994a;text-transform:uppercase;\">New Music &nbsp;/&nbsp; Mali V</td></tr>\n<tr><td align=\"center\" style=\"padding:6px 20px 10px;\"><img src=\"https://www.betterleftunsaid2.com/img/newsletter/email_wordmark.png\" width=\"260\" alt=\"Mali V - Better Left Unsaid 2\" style=\"display:block;width:260px;max-width:68%;height:auto;\"></td></tr>\n<tr><td align=\"center\" style=\"padding:8px 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:bold;letter-spacing:2px;color:#f2994a;text-transform:uppercase;\">Meet Mali V</td></tr>\n<tr><td align=\"center\" style=\"padding:0 30px 10px;font-family:Georgia,serif;font-size:14px;line-height:22px;color:#f4ede1;\">Mali V, executive produced by SZZN, just dropped a new album — <strong>Better Left Unsaid 2</strong> — and it's streaming on every platform today. Two tracks from it we think are worth your ear first:</td></tr>\n<tr><td style=\"padding:6px 30px 4px;\">\n<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border:1px solid #2a1e16;background-color:#170f0a;\">\n<tr><td style=\"padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#f2994a;text-transform:uppercase;border-bottom:1px solid #2a1e16;white-space:nowrap;\">Track 1</td><td align=\"right\" style=\"padding:14px 18px;font-family:Georgia,serif;font-size:14px;color:#f4ede1;border-bottom:1px solid #2a1e16;\">Better Left Unsaid</td></tr>\n<tr><td style=\"padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#f2994a;text-transform:uppercase;white-space:nowrap;\">Track 2</td><td align=\"right\" style=\"padding:14px 18px;font-family:Georgia,serif;font-size:14px;color:#f4ede1;\">Ecstacy - Ex-To-See</td></tr>\n</table>\n</td></tr>\n<tr><td align=\"center\" style=\"padding:18px 24px 4px;\">\n<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr><td align=\"center\" style=\"background-color:#d9642c;background-image:linear-gradient(135deg,#d9642c,#f2994a);border-radius:3px;\">\n<a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"display:inline-block;padding:15px 38px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:2px;color:#0a0806;text-decoration:none;text-transform:uppercase;\">Stream The Full Album</a>\n</td></tr></table></td></tr>\n<tr><td align=\"center\" style=\"padding:6px 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" style=\"color:#a89a86;\">distrokid.com/hyperfollow/maliv1/blu-2-2</a></td></tr>\n<tr><td align=\"center\" style=\"padding:18px 30px 4px;font-family:Georgia,serif;font-size:14px;line-height:22px;color:#f4ede1;\">Get to know the story behind the record at <a href=\"https://www.betterleftunsaid2.com\" style=\"color:#f2994a;\">BetterLeftUnsaid2.com</a> — and if it's in your wheelhouse, we'd love to hear it in the mix.</td></tr>\n<tr><td align=\"center\" style=\"padding:16px 30px 6px;\"><img src=\"https://www.betterleftunsaid2.com/img/newsletter/email_rose.jpg\" width=\"140\" alt=\"Better Left Unsaid 2\" style=\"display:block;width:140px;max-width:38%;height:auto;border:1px solid #3a281c;margin:0 auto;\"></td></tr>\n<tr><td align=\"center\" style=\"padding:12px 30px 4px;font-family:Georgia,serif;font-style:italic;font-size:13px;line-height:21px;color:#f4ede1;\">&ldquo;Some things better left unsaid are better off in the past.&rdquo;</td></tr>\n<tr><td style=\"padding:26px 30px 8px;\"><div style=\"border-top:1px solid #2a1e16;\"></div></td></tr>\n<tr><td align=\"center\" style=\"padding:4px 30px 24px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#a89a86;text-transform:uppercase;\">Executive Produced by SZZN &nbsp;&middot;&nbsp; <a href=\"https://www.betterleftunsaid2.com\" style=\"color:#a89a86;\">betterleftunsaid2.com</a></td></tr>\n\n</table>\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;\">\n<tr><td style=\"padding:20px 20px 4px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#a89a86;\">\nMali V &middot; Better Left Unsaid 2 &middot; Executive Produced by SZZN<br>\nAll Flights Delayed (AFD)\n<tr><td align=\"center\" style=\"padding:14px 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;color:#a89a86;\">\n<a href=\"{{{RESEND_UNSUBSCRIBE_URL}}}\" style=\"color:#a89a86;text-decoration:underline;\">Unsubscribe from AFD updates</a>\n</td></tr></td></tr></table></td></tr></table></body></html>");
  Logger.log('Test broadcast sent to ' + me);
}

// ---- Safe test send (only to your own inbox, real Resend Broadcast + unsubscribe link) ----

function sendTestToMe() {
  var me = Session.getActiveUser().getEmail();
  var apiKey = getResendApiKey_();
  var segmentId = getOrCreateResendSegment_(apiKey, RESEND_TEST_SEGMENT_PROP_KEY, RESEND_TEST_SEGMENT_NAME);
  syncContactsToResendSegment_(apiKey, segmentId, [{ email: me, first: '', last: '', unsubscribed: false }]);
  Utilities.sleep(2000); // give segment membership a moment to propagate before sending
  sendResendBroadcast_(apiKey, segmentId, "[TEST] It's Here \u2014 Better Left Unsaid 2 Is Out Now", "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Better Left Unsaid 2</title></head>\n<body style=\"margin:0;padding:0;background-color:#0a0806;font-family:Georgia,'Times New Roman',serif;\">\n<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;\">It's here. Better Left Unsaid 2 is streaming on every platform right now.</div>\n<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background-color:#0a0806;\">\n<tr><td align=\"center\" style=\"padding:32px 16px;\">\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;background-color:#120d0a;border:1px solid #2a1e16;\">\n\n<tr><td align=\"center\" style=\"padding:26px 20px 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:4px;color:#f2994a;text-transform:uppercase;\">Out Now &nbsp;/&nbsp; All DSPs</td></tr>\n<tr><td align=\"center\" style=\"padding:6px 20px 10px;\"><img src=\"https://www.betterleftunsaid2.com/img/newsletter/email_wordmark.png\" width=\"260\" alt=\"Mali V - Better Left Unsaid 2\" style=\"display:block;width:260px;max-width:68%;height:auto;\"></td></tr>\n<tr><td align=\"center\" style=\"padding:8px 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:bold;letter-spacing:3px;color:#f2994a;text-transform:uppercase;\">It&rsquo;s Here</td></tr>\n<tr><td align=\"center\" style=\"padding:0 30px 8px;font-family:Georgia,serif;font-size:14px;line-height:22px;color:#f4ede1;\"><strong>Better Left Unsaid 2</strong> by Mali V is streaming everywhere, right now.</td></tr>\n<tr><td align=\"center\" style=\"padding:8px 24px 4px;\">\n<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr><td align=\"center\" style=\"background-color:#d9642c;background-image:linear-gradient(135deg,#d9642c,#f2994a);border-radius:3px;\">\n<a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"display:inline-block;padding:15px 38px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:2px;color:#0a0806;text-decoration:none;text-transform:uppercase;\">Stream Everywhere</a>\n</td></tr></table></td></tr>\n<tr><td align=\"center\" style=\"padding:6px 12px 4px;\"><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Spotify</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Apple Music</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">YouTube Music</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Amazon Music</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Tidal</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Deezer</a></td></tr></table></td></tr>\n<tr><td align=\"center\" style=\"padding:0 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;color:#a89a86;\">one link, every platform &mdash; tap any DSP above</td></tr>\n<tr><td align=\"center\" style=\"padding:20px 30px 6px;\"><img src=\"https://www.betterleftunsaid2.com/img/newsletter/email_rose.jpg\" width=\"150\" alt=\"Better Left Unsaid 2\" style=\"display:block;width:150px;max-width:40%;height:auto;border:1px solid #3a281c;margin:0 auto;\"></td></tr>\n<tr><td align=\"center\" style=\"padding:12px 30px 4px;font-family:Georgia,serif;font-style:italic;font-size:13px;line-height:21px;color:#f4ede1;\">&ldquo;Some things better left unsaid are better off in the past.&rdquo;</td></tr>\n<tr><td style=\"padding:26px 30px 8px;\"><div style=\"border-top:1px solid #2a1e16;\"></div></td></tr>\n<tr><td align=\"center\" style=\"padding:4px 30px 24px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#a89a86;text-transform:uppercase;\">Executive Produced by SZZN &nbsp;&middot;&nbsp; <a href=\"https://www.betterleftunsaid2.com\" style=\"color:#a89a86;\">betterleftunsaid2.com</a></td></tr>\n\n</table>\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;\">\n<tr><td style=\"padding:20px 20px 4px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#a89a86;\">\nMali V &middot; Better Left Unsaid 2 &middot; Executive Produced by SZZN<br>\nAll Flights Delayed (AFD)\n<tr><td align=\"center\" style=\"padding:14px 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;color:#a89a86;\">\n<a href=\"{{{RESEND_UNSUBSCRIBE_URL}}}\" style=\"color:#a89a86;text-decoration:underline;\">Unsubscribe from BLU2 updates</a>\n</td></tr></td></tr></table></td></tr></table></body></html>");
  Logger.log('Test broadcast sent to ' + me);
}

// ---- Legacy unsubscribe endpoint (Gmail-era emails only \u2014 see header comment) ----
// A click on the Aug 11 countdown email's unsubscribe link lands here,
// marks that email Unsubscribed=TRUE + stamps the time in the Sheet, and
// shows a plain confirmation page. No auth needed by the clicker. New
// (Resend Broadcast) emails use Resend's own unsubscribe flow instead,
// which does NOT hit this endpoint.

function doGet(e) {
  var email = (e && e.parameter && e.parameter.email) ? String(e.parameter.email).trim().toLowerCase() : '';
  var message;
  if (!email) {
    message = "No email address was provided \u2014 nothing was changed.";
  } else {
    var sheet = getSheet_();
    var data = sheet.getDataRange().getValues();
    var header = data[0];
    var emailCol = header.indexOf('Email');
    var unsubCol = header.indexOf('Unsubscribed');
    var unsubAtCol = header.indexOf('Unsubscribed At');
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][emailCol] || '').trim().toLowerCase() === email) {
        sheet.getRange(i + 1, unsubCol + 1).setValue('TRUE');
        sheet.getRange(i + 1, unsubAtCol + 1).setValue(new Date());
        found = true;
      }
    }
    message = found
      ? "You've been unsubscribed from Better Left Unsaid 2 updates. You won't get any more of these."
      : "That email wasn't on the list \u2014 you're already unsubscribed (or never subscribed).";
  }
  var html = '<html><body style="font-family:Arial,sans-serif;background:#0a0806;color:#f4ede1;' +
    'text-align:center;padding:60px 20px;"><h2 style="color:#f2994a;">Better Left Unsaid 2</h2>' +
    '<p style="font-size:15px;max-width:420px;margin:0 auto;">' + message + '</p></body></html>';
  return HtmlService.createHtmlOutput(html);
}

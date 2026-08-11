/**
 * BLU2 — "Better Left Unsaid 2" newsletter mail merge (with unsubscribe)
 * -----------------------------------------------------------------------
 * Sends the 3 round-robin newsletters (countdown / release day / day after)
 * to the full, vetted BLU2 recipient list, with the brand images embedded
 * inline and a real, working one-click unsubscribe link in every email.
 *
 * ONE-TIME SETUP:
 * 1. script.google.com > New project > paste this whole file in, replacing
 *    Code.gs. (Or add it as a new file inside the existing "BLU2 Vote Sync"
 *    Apps Script project on this Drive account.)
 * 2. Upload the 5 images (delivered alongside this script, in the zip) into
 *    the Drive folder "BLU2 Newsletter Assets" — already created:
 *      email_rose.jpg   email_wordmark.png   email_embers.jpg
 *      email_studio.jpg   email_reel_thumb.jpg
 * 3. Deploy the unsubscribe endpoint: in the Apps Script editor, click
 *    Deploy > New deployment > select type "Web app" > Execute as: Me >
 *    Who has access: Anyone > Deploy. Copy the resulting /exec URL and
 *    paste it into UNSUBSCRIBE_WEBAPP_URL below, then save this file again.
 *    (Skipping this step means the unsubscribe link in the emails won't
 *    work yet — everything else still runs fine.)
 * 4. Run sendTestToMe() first — sends the Release Day email to your own
 *    Gmail only, so you can check rendering and click-test the unsubscribe
 *    link before any real send.
 * 5. On each send day, run the matching function from the dropdown next to
 *    "Run": sendCountdownEmail() the day before, sendReleaseDayEmail() the
 *    morning of, sendDayAfterEmail() the day after. First run will prompt
 *    you to authorize Gmail + Drive + Sheets access — that's expected.
 *
 * Recipients live in the "BLU2 Newsletter Recipients (full list + unsubscribe
 * tracking)" Sheet Claude created — all vetted lists merged, 112 people.
 * Anyone who clicks Unsubscribe gets marked TRUE in that sheet's
 * "Unsubscribed" column with a timestamp, and is automatically skipped on
 * every future send — no manual list-cleaning needed.
 */

var SHEET_ID = '1tkB8RD0g12uBUuM1Wezbb_vuCWIUn1coBMc2UlDk49U';
var IMAGE_FOLDER_ID = '1mQeNjGr-_NrZrX0jDHo6vXiiQDbB04tt';
var FROM_NAME = 'Mali V — Better Left Unsaid 2';
var UNSUBSCRIBE_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbxDQxktM3Yd6IOEQY-aqFRk-_wAYhAykCFgKpR_JzA8TK895yVnCHk5Q9nET-E7T0vq/exec'; // see setup step 3

function getSheet_() {
  return SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
}

function getRecipients_() {
  var sheet = getSheet_();
  var rows = sheet.getDataRange().getValues();
  var header = rows.shift();
  var emailCol = header.indexOf('Email');
  var firstCol = header.indexOf('First');
  var unsubCol = header.indexOf('Unsubscribed');
  var out = [];
  rows.forEach(function(r) {
    var email = String(r[emailCol] || '').trim();
    var unsub = String(r[unsubCol] || '').trim().toUpperCase() === 'TRUE';
    if (email && !unsub) out.push({ email: email, first: String(r[firstCol] || '').trim() });
  });
  return out;
}

function getInlineImages_() {
  var folder = DriveApp.getFolderById(IMAGE_FOLDER_ID);
  function blobFor(name) {
    var files = folder.getFilesByName(name);
    if (!files.hasNext()) throw new Error('Missing image in BLU2 Newsletter Assets: ' + name);
    return files.next().getBlob();
  }
  return {
    img_rose: blobFor('email_rose.jpg'),
    img_wordmark: blobFor('email_wordmark.png'),
    img_embers: blobFor('email_embers.jpg'),
    img_studio: blobFor('email_studio.jpg'),
    img_reel: blobFor('email_reel_thumb.jpg')
  };
}

function unsubscribeUrlFor_(email) {
  return UNSUBSCRIBE_WEBAPP_URL + '?email=' + encodeURIComponent(email);
}

function sendBatch_(subject, htmlTemplate) {
  var recipients = getRecipients_();
  var inlineImages = getInlineImages_();
  var sent = 0, failed = [];
  recipients.forEach(function(r) {
    try {
      var personalized = htmlTemplate.split('%%UNSUB_URL%%').join(unsubscribeUrlFor_(r.email));
      GmailApp.sendEmail(r.email, subject, 'This email requires HTML support to view.', {
        htmlBody: personalized,
        name: FROM_NAME,
        inlineImages: inlineImages
      });
      sent++;
      Utilities.sleep(300); // stay well under Gmail's per-day + per-second sending limits
    } catch (e) {
      failed.push(r.email + ': ' + e.message);
    }
  });
  Logger.log('Sent: ' + sent + ' / ' + recipients.length);
  if (failed.length) Logger.log('Failed:\n' + failed.join('\n'));
}

// ---- The 3 round-robin sends ----

function sendCountdownEmail() {
  // Send the day before release (Tue Aug 11)
  sendBatch_(
    "1 Day Left — Better Left Unsaid 2 Streams Tomorrow",
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Better Left Unsaid 2</title></head>\n<body style=\"margin:0;padding:0;background-color:#0a0806;font-family:Georgia,'Times New Roman',serif;\">\n<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;\">1 day left. Better Left Unsaid 2 streams everywhere tomorrow.</div>\n<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background-color:#0a0806;\">\n<tr><td align=\"center\" style=\"padding:32px 16px;\">\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;background-color:#120d0a;border:1px solid #2a1e16;\">\n\n<tr><td align=\"center\" style=\"padding:26px 20px 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:4px;color:#f2994a;text-transform:uppercase;\">Better Left Unsaid 2 &nbsp;/&nbsp; Mali V</td></tr>\n<tr><td align=\"center\" style=\"padding:6px 30px 10px;\"><img src=\"cid:img_rose\" width=\"230\" alt=\"Better Left Unsaid 2\" style=\"display:block;width:230px;max-width:60%;height:auto;border:1px solid #3a281c;\"></td></tr>\n<tr><td align=\"center\" style=\"padding:14px 30px 2px;font-family:Georgia,serif;font-style:italic;font-size:15px;line-height:24px;color:#f4ede1;\">&ldquo;Some things better left unsaid<br>are better off in the past.&rdquo;\n<div style=\"margin-top:6px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#a89a86;text-transform:uppercase;\">&mdash; Mali V</div></td></tr>\n<tr><td align=\"center\" style=\"padding:22px 20px 2px;font-family:Arial,Helvetica,sans-serif;\">\n<div style=\"font-size:56px;line-height:56px;font-weight:bold;color:#f2994a;letter-spacing:1px;\">1 DAY</div>\n<div style=\"font-size:13px;letter-spacing:4px;color:#f4ede1;text-transform:uppercase;margin-top:6px;\">until it streams everywhere</div></td></tr>\n<tr><td align=\"center\" style=\"padding:10px 20px 2px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#f4ede1;\">Wednesday &middot; August 12, 2026</td></tr>\n<tr><td align=\"center\" style=\"padding:16px 30px 6px;font-family:Georgia,serif;font-size:14px;line-height:22px;color:#f4ede1;\">Tomorrow, <strong>Better Left Unsaid 2</strong> goes live on every DSP &mdash; Spotify, Apple Music, Amazon, YouTube Music and more. Set your reminder now so you're first to hear it.</td></tr>\n<tr><td align=\"center\" style=\"padding:8px 24px 4px;\">\n<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr><td align=\"center\" style=\"background-color:#d9642c;background-image:linear-gradient(135deg,#d9642c,#f2994a);border-radius:3px;\">\n<a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"display:inline-block;padding:15px 38px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:2px;color:#0a0806;text-decoration:none;text-transform:uppercase;\">Set My Reminder</a>\n</td></tr></table></td></tr>\n<tr><td align=\"center\" style=\"padding:6px 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" style=\"color:#a89a86;\">distrokid.com/hyperfollow/maliv1/blu-2-2</a></td></tr>\n<tr><td style=\"padding:26px 30px 8px;\"><div style=\"border-top:1px solid #2a1e16;\"></div></td></tr>\n<tr><td align=\"center\" style=\"padding:4px 30px 24px;\"><img src=\"cid:img_wordmark\" width=\"150\" alt=\"Mali V\" style=\"display:block;width:150px;max-width:45%;height:auto;margin:0 auto;\">\n<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#a89a86;text-transform:uppercase;margin-top:10px;\">Executive Produced by SZZN</div></td></tr>\n\n</table>\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;\">\n<tr><td style=\"padding:20px 20px 4px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#a89a86;\">\nMali V &middot; Better Left Unsaid 2 &middot; Executive Produced by SZZN<br>\nAll Flights Delayed (AFD)<br>\nYou're receiving this because you RSVP'd or signed in at betterleftunsaid2.com.\n<tr><td align=\"center\" style=\"padding:14px 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;color:#a89a86;\">\n<a href=\"%%UNSUB_URL%%\" style=\"color:#a89a86;text-decoration:underline;\">Unsubscribe from BLU2 updates</a>\n</td></tr></td></tr></table></td></tr></table></body></html>"
  );
}

function sendReleaseDayEmail() {
  // Send the morning of release (Wed Aug 12)
  sendBatch_(
    "It's Here — Better Left Unsaid 2 Is Out Now",
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Better Left Unsaid 2</title></head>\n<body style=\"margin:0;padding:0;background-color:#0a0806;font-family:Georgia,'Times New Roman',serif;\">\n<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;\">It's here. Better Left Unsaid 2 is streaming on every platform right now.</div>\n<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background-color:#0a0806;\">\n<tr><td align=\"center\" style=\"padding:32px 16px;\">\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;background-color:#120d0a;border:1px solid #2a1e16;\">\n\n<tr><td align=\"center\" style=\"padding:26px 20px 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:4px;color:#f2994a;text-transform:uppercase;\">Out Now &nbsp;/&nbsp; All DSPs</td></tr>\n<tr><td align=\"center\" style=\"padding:6px 20px 10px;\"><img src=\"cid:img_wordmark\" width=\"260\" alt=\"Mali V - Better Left Unsaid 2\" style=\"display:block;width:260px;max-width:68%;height:auto;\"></td></tr>\n<tr><td align=\"center\" style=\"padding:8px 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:bold;letter-spacing:3px;color:#f2994a;text-transform:uppercase;\">It&rsquo;s Here</td></tr>\n<tr><td align=\"center\" style=\"padding:0 30px 8px;font-family:Georgia,serif;font-size:14px;line-height:22px;color:#f4ede1;\"><strong>Better Left Unsaid 2</strong> by Mali V is streaming everywhere, right now.</td></tr>\n<tr><td align=\"center\" style=\"padding:8px 24px 4px;\">\n<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr><td align=\"center\" style=\"background-color:#d9642c;background-image:linear-gradient(135deg,#d9642c,#f2994a);border-radius:3px;\">\n<a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"display:inline-block;padding:15px 38px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:2px;color:#0a0806;text-decoration:none;text-transform:uppercase;\">Stream Everywhere</a>\n</td></tr></table></td></tr>\n<tr><td align=\"center\" style=\"padding:6px 12px 4px;\"><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Spotify</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Apple Music</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">YouTube Music</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Amazon Music</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Tidal</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Deezer</a></td></tr></table></td></tr>\n<tr><td align=\"center\" style=\"padding:0 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;color:#a89a86;\">one link, every platform &mdash; tap any DSP above</td></tr>\n<tr><td align=\"center\" style=\"padding:20px 30px 6px;\"><img src=\"cid:img_rose\" width=\"150\" alt=\"Better Left Unsaid 2\" style=\"display:block;width:150px;max-width:40%;height:auto;border:1px solid #3a281c;margin:0 auto;\"></td></tr>\n<tr><td align=\"center\" style=\"padding:12px 30px 4px;font-family:Georgia,serif;font-style:italic;font-size:13px;line-height:21px;color:#f4ede1;\">&ldquo;Some things better left unsaid are better off in the past.&rdquo;</td></tr>\n<tr><td style=\"padding:26px 30px 8px;\"><div style=\"border-top:1px solid #2a1e16;\"></div></td></tr>\n<tr><td align=\"center\" style=\"padding:4px 30px 24px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#a89a86;text-transform:uppercase;\">Executive Produced by SZZN &nbsp;&middot;&nbsp; <a href=\"https://www.betterleftunsaid2.com\" style=\"color:#a89a86;\">betterleftunsaid2.com</a></td></tr>\n\n</table>\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;\">\n<tr><td style=\"padding:20px 20px 4px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#a89a86;\">\nMali V &middot; Better Left Unsaid 2 &middot; Executive Produced by SZZN<br>\nAll Flights Delayed (AFD)<br>\nYou're receiving this because you RSVP'd or signed in at betterleftunsaid2.com.\n<tr><td align=\"center\" style=\"padding:14px 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;color:#a89a86;\">\n<a href=\"%%UNSUB_URL%%\" style=\"color:#a89a86;text-decoration:underline;\">Unsubscribe from BLU2 updates</a>\n</td></tr></td></tr></table></td></tr></table></body></html>"
  );
}

function sendDayAfterEmail() {
  // Send the day after release (Thu Aug 13)
  sendBatch_(
    "Still Out, Still Streaming — Better Left Unsaid 2",
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Better Left Unsaid 2</title></head>\n<body style=\"margin:0;padding:0;background-color:#0a0806;font-family:Georgia,'Times New Roman',serif;\">\n<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;\">Still out, still streaming, plus the performance reel.</div>\n<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background-color:#0a0806;\">\n<tr><td align=\"center\" style=\"padding:32px 16px;\">\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;background-color:#120d0a;border:1px solid #2a1e16;\">\n\n<tr><td align=\"center\" style=\"padding:26px 20px 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:4px;color:#f2994a;text-transform:uppercase;\">Still Streaming &nbsp;/&nbsp; Mali V</td></tr>\n<tr><td align=\"center\" style=\"padding:6px 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;letter-spacing:2px;color:#f2994a;text-transform:uppercase;\">It&rsquo;s Out. Run It Back.</td></tr>\n<tr><td align=\"center\" style=\"padding:12px 30px 12px;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"display:inline-block;\"><img src=\"cid:img_reel\" width=\"260\" alt=\"Watch the performance reel\" style=\"display:block;width:260px;max-width:70%;height:auto;border:1px solid #3a281c;\"></a>\n<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#a89a86;text-transform:uppercase;margin-top:8px;\">tap to watch &middot; from the stoop to the board</div></td></tr>\n<tr><td align=\"center\" style=\"padding:2px 30px 6px;font-family:Georgia,serif;font-size:14px;line-height:22px;color:#f4ede1;\"><strong>Better Left Unsaid 2</strong> dropped yesterday on every DSP. If you haven&rsquo;t pressed play yet &mdash; or you have and you&rsquo;re already back for round two &mdash; it&rsquo;s all still right here.</td></tr>\n<tr><td align=\"center\" style=\"padding:8px 24px 4px;\">\n<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr><td align=\"center\" style=\"background-color:#d9642c;background-image:linear-gradient(135deg,#d9642c,#f2994a);border-radius:3px;\">\n<a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"display:inline-block;padding:15px 38px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:2px;color:#0a0806;text-decoration:none;text-transform:uppercase;\">Stream It Again</a>\n</td></tr></table></td></tr>\n<tr><td align=\"center\" style=\"padding:22px 30px 4px;\"><img src=\"cid:img_studio\" width=\"230\" alt=\"Mali V in the studio\" style=\"display:block;width:230px;max-width:60%;height:auto;border:1px solid #3a281c;margin:0 auto;\">\n<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#a89a86;text-transform:uppercase;margin-top:8px;\">From The Board To The World</div></td></tr>\n<tr><td align=\"center\" style=\"padding:16px 30px 6px;\"><img src=\"cid:img_rose\" width=\"120\" alt=\"Better Left Unsaid 2\" style=\"display:block;width:120px;max-width:34%;height:auto;border:1px solid #3a281c;margin:0 auto;\"></td></tr>\n<tr><td style=\"padding:24px 30px 8px;\"><div style=\"border-top:1px solid #2a1e16;\"></div></td></tr>\n<tr><td align=\"center\" style=\"padding:4px 30px 24px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#a89a86;text-transform:uppercase;\">Executive Produced by SZZN &nbsp;&middot;&nbsp; <a href=\"https://www.betterleftunsaid2.com\" style=\"color:#a89a86;\">betterleftunsaid2.com</a></td></tr>\n\n</table>\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;\">\n<tr><td style=\"padding:20px 20px 4px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#a89a86;\">\nMali V &middot; Better Left Unsaid 2 &middot; Executive Produced by SZZN<br>\nAll Flights Delayed (AFD)<br>\nYou're receiving this because you RSVP'd or signed in at betterleftunsaid2.com.\n<tr><td align=\"center\" style=\"padding:14px 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;color:#a89a86;\">\n<a href=\"%%UNSUB_URL%%\" style=\"color:#a89a86;text-decoration:underline;\">Unsubscribe from BLU2 updates</a>\n</td></tr></td></tr></table></td></tr></table></body></html>"
  );
}

// ---- Safe test send (only to your own inbox, real unsubscribe link included) ----

function sendTestToMe() {
  var me = Session.getActiveUser().getEmail();
  var inlineImages = getInlineImages_();
  var personalized = ("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Better Left Unsaid 2</title></head>\n<body style=\"margin:0;padding:0;background-color:#0a0806;font-family:Georgia,'Times New Roman',serif;\">\n<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;\">It's here. Better Left Unsaid 2 is streaming on every platform right now.</div>\n<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background-color:#0a0806;\">\n<tr><td align=\"center\" style=\"padding:32px 16px;\">\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;background-color:#120d0a;border:1px solid #2a1e16;\">\n\n<tr><td align=\"center\" style=\"padding:26px 20px 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:4px;color:#f2994a;text-transform:uppercase;\">Out Now &nbsp;/&nbsp; All DSPs</td></tr>\n<tr><td align=\"center\" style=\"padding:6px 20px 10px;\"><img src=\"cid:img_wordmark\" width=\"260\" alt=\"Mali V - Better Left Unsaid 2\" style=\"display:block;width:260px;max-width:68%;height:auto;\"></td></tr>\n<tr><td align=\"center\" style=\"padding:8px 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:bold;letter-spacing:3px;color:#f2994a;text-transform:uppercase;\">It&rsquo;s Here</td></tr>\n<tr><td align=\"center\" style=\"padding:0 30px 8px;font-family:Georgia,serif;font-size:14px;line-height:22px;color:#f4ede1;\"><strong>Better Left Unsaid 2</strong> by Mali V is streaming everywhere, right now.</td></tr>\n<tr><td align=\"center\" style=\"padding:8px 24px 4px;\">\n<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr><td align=\"center\" style=\"background-color:#d9642c;background-image:linear-gradient(135deg,#d9642c,#f2994a);border-radius:3px;\">\n<a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"display:inline-block;padding:15px 38px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:2px;color:#0a0806;text-decoration:none;text-transform:uppercase;\">Stream Everywhere</a>\n</td></tr></table></td></tr>\n<tr><td align=\"center\" style=\"padding:6px 12px 4px;\"><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Spotify</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Apple Music</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">YouTube Music</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Amazon Music</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Tidal</a></td><td style=\"padding:0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#f4ede1;text-align:center;\"><a href=\"https://distrokid.com/hyperfollow/maliv1/blu-2-2\" target=\"_blank\" style=\"color:#f4ede1;text-decoration:none;border-bottom:1px solid #d9642c;padding-bottom:2px;\">Deezer</a></td></tr></table></td></tr>\n<tr><td align=\"center\" style=\"padding:0 20px 4px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;color:#a89a86;\">one link, every platform &mdash; tap any DSP above</td></tr>\n<tr><td align=\"center\" style=\"padding:20px 30px 6px;\"><img src=\"cid:img_rose\" width=\"150\" alt=\"Better Left Unsaid 2\" style=\"display:block;width:150px;max-width:40%;height:auto;border:1px solid #3a281c;margin:0 auto;\"></td></tr>\n<tr><td align=\"center\" style=\"padding:12px 30px 4px;font-family:Georgia,serif;font-style:italic;font-size:13px;line-height:21px;color:#f4ede1;\">&ldquo;Some things better left unsaid are better off in the past.&rdquo;</td></tr>\n<tr><td style=\"padding:26px 30px 8px;\"><div style=\"border-top:1px solid #2a1e16;\"></div></td></tr>\n<tr><td align=\"center\" style=\"padding:4px 30px 24px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#a89a86;text-transform:uppercase;\">Executive Produced by SZZN &nbsp;&middot;&nbsp; <a href=\"https://www.betterleftunsaid2.com\" style=\"color:#a89a86;\">betterleftunsaid2.com</a></td></tr>\n\n</table>\n<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;\">\n<tr><td style=\"padding:20px 20px 4px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#a89a86;\">\nMali V &middot; Better Left Unsaid 2 &middot; Executive Produced by SZZN<br>\nAll Flights Delayed (AFD)<br>\nYou're receiving this because you RSVP'd or signed in at betterleftunsaid2.com.\n<tr><td align=\"center\" style=\"padding:14px 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;color:#a89a86;\">\n<a href=\"%%UNSUB_URL%%\" style=\"color:#a89a86;text-decoration:underline;\">Unsubscribe from BLU2 updates</a>\n</td></tr></td></tr></table></td></tr></table></body></html>").split('%%UNSUB_URL%%').join(unsubscribeUrlFor_(me));
  GmailApp.sendEmail(me, "[TEST] It's Here — Better Left Unsaid 2 Is Out Now", 'HTML required.', {
    htmlBody: personalized,
    name: FROM_NAME,
    inlineImages: inlineImages
  });
  Logger.log('Test sent to ' + me);
}

// ---- Unsubscribe endpoint ----
// After deploying this as a Web App (setup step 3), a click on the emailed
// link lands here, marks that email Unsubscribed=TRUE + stamps the time,
// and shows a plain confirmation page. No auth needed by the clicker.

function doGet(e) {
  var email = (e && e.parameter && e.parameter.email) ? String(e.parameter.email).trim().toLowerCase() : '';
  var message;
  if (!email) {
    message = "No email address was provided — nothing was changed.";
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
      : "That email wasn't on the list — you're already unsubscribed (or never subscribed).";
  }
  var html = '<html><body style="font-family:Arial,sans-serif;background:#0a0806;color:#f4ede1;' +
    'text-align:center;padding:60px 20px;"><h2 style="color:#f2994a;">Better Left Unsaid 2</h2>' +
    '<p style="font-size:15px;max-width:420px;margin:0 auto;">' + message + '</p></body></html>';
  return HtmlService.createHtmlOutput(html);
}

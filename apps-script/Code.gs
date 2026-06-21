/**
 * BLU2 Listening Party — Vote Sync & Email backend.
 * Deploy as a Google Apps Script Web App pointed at the BLU2 Votes sheet.
 * See SETUP.md for step-by-step deployment instructions.
 */

const SPREADSHEET_ID = "1l_XQQKZ4Sss_qQyA5bLfaHQ2OVh62XwhH1xzwvbHUm4";
const SHEET_NAME     = "Responses";
const RSVP_SHEET_NAME = "RSVP";
const CONTACTS_SHEET_NAME = "Contacts";
const ADMIN_EMAIL    = "titledtentatively@gmail.com";
const ADMIN_PASS     = "maliv2026"; // must match ADMIN_PASS in index.html and rsvp.html
const TRACK_COUNT    = 13;
const EVENT_LABEL    = "BLU2 Listening Party — Saturday, June 27, 2026";

/**
 * Called by the site on login, vote submission, and RSVP submission.
 *
 * - `{ type: "login", user }` — upserts the contact into the Contacts
 *   sheet for future email/text marketing. No email is sent.
 * - `{ type: "rsvp", ... }` — appends a row to the RSVP sheet, upserts the
 *   contact, and emails the guest a confirmation plus ADMIN_EMAIL a
 *   notification.
 * - Vote submissions (default) — append a row to the Responses sheet,
 *   upsert the contact, and email the voter's results as a CSV + PDF
 *   attachment to ADMIN_EMAIL.
 */
function doPost(e) {
  const entry = JSON.parse(e.postData.contents);

  if (entry.type === "login") {
    upsertContact(entry.user, "Login");
    return jsonOut({ ok: true });
  }

  if (entry.type === "rsvp") {
    appendRsvpRow(entry);
    upsertContact({ first: entry.firstName, last: entry.lastName, email: entry.email, phone: entry.phone }, "RSVP");
    emailRsvpGuest(entry);
    emailRsvpAdmin(entry);
    addToResendContacts(entry);
    return jsonOut({ ok: true });
  }

  const tracks = entry.tracks || [];
  appendRow(entry);
  upsertContact(entry.user, "Vote");
  emailVote(entry, tracks);

  return jsonOut({ ok: true });
}

/**
 * Called by the admin "Sync All Votes" button.
 * Requires ?pass=<ADMIN_PASS> and returns every row as JSON,
 * shaped to match the `responses` array used in index.html.
 */
function doGet(e) {
  if (!e.parameter.pass || e.parameter.pass !== ADMIN_PASS) {
    return jsonOut({ error: "Unauthorized" });
  }

  if (e.parameter.type === "rsvp") {
    return jsonOut({ rsvps: getAllRsvps() });
  }

  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();
  if (data.length < 2) return jsonOut({ responses: [] });

  const header = data[0];
  const responses = data.slice(1).map(row => {
    const obj = {};
    header.forEach((h, i) => obj[h] = row[i]);

    const ratings = {}, vibes = {}, comments = {};
    for (let id = 1; id <= TRACK_COUNT; id++) {
      ratings[id]  = obj[`T${id}_stars`] || 0;
      vibes[id]    = obj[`T${id}_vibes`] ? String(obj[`T${id}_vibes`]).split("|").filter(Boolean) : [];
      comments[id] = obj[`T${id}_comment`] || "";
    }

    return {
      user: { first: obj.First, last: obj.Last, email: obj.Email, phone: obj.Phone },
      ratings, vibes, comments,
      avgRating: obj.AvgRating,
      submittedAt: obj.Timestamp
    };
  });

  return jsonOut({ responses });
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function getContactsSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CONTACTS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONTACTS_SHEET_NAME);
    sheet.appendRow(["First", "Last", "Email", "Phone", "First Seen", "Last Seen", "Source"]);
  }
  return sheet;
}

/**
 * Adds or updates a row in the Contacts sheet, keyed by email
 * (case-insensitive), so the list can be used for future
 * email/text marketing campaigns.
 */
function upsertContact(user, source) {
  if (!user || !user.email) return;

  const sheet = getContactsSheet();
  const data  = sheet.getDataRange().getValues();
  const email = user.email.trim().toLowerCase();
  const now   = new Date();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]).trim().toLowerCase() === email) {
      sheet.getRange(i + 1, 1, 1, 4).setValues([[user.first, user.last, user.email, user.phone]]);
      sheet.getRange(i + 1, 6).setValue(now);
      return;
    }
  }

  sheet.appendRow([user.first, user.last, user.email, user.phone, now, now, source]);
}

function appendRow(entry) {
  const sheet = getSheet();
  if (sheet.getLastRow() === 0) {
    const header = ["Timestamp", "First", "Last", "Email", "Phone", "AvgRating"];
    for (let id = 1; id <= TRACK_COUNT; id++) {
      header.push(`T${id}_stars`, `T${id}_vibes`, `T${id}_comment`);
    }
    sheet.appendRow(header);
  }

  const row = [
    entry.submittedAt, entry.user.first, entry.user.last,
    entry.user.email, entry.user.phone, entry.avgRating
  ];
  for (let id = 1; id <= TRACK_COUNT; id++) {
    row.push(
      entry.ratings[id] || "",
      (entry.vibes[id] || []).join("|"),
      entry.comments[id] || ""
    );
  }
  sheet.appendRow(row);
}

/**
 * Emails the voter's results as two attachments: a CSV data export
 * and a human-readable PDF summary.
 */
function emailVote(entry, tracks) {
  const namePart = `${entry.user.first}_${entry.user.last}`.replace(/[^a-zA-Z0-9_]/g, "_");
  const dateStr  = new Date().toISOString().slice(0, 10);

  const csvBlob = buildCsvBlob(entry, tracks, `BLU2_Vote_${namePart}_${dateStr}`);
  const pdfBlob = buildPdfBlob(entry, tracks, `BLU2_Vote_Summary_${namePart}_${dateStr}`);

  GmailApp.sendEmail(
    ADMIN_EMAIL,
    `BLU2 Vote — ${entry.user.first} ${entry.user.last}`,
    `New listening party vote submitted.\n\n` +
    `Name: ${entry.user.first} ${entry.user.last}\n` +
    `Email: ${entry.user.email}\n` +
    `Phone: ${entry.user.phone}\n` +
    `Average Rating: ${entry.avgRating} / 5\n\n` +
    `See attached CSV and PDF for the full per-track breakdown.`,
    { attachments: [csvBlob, pdfBlob], name: "BLU2 Listening Party" }
  );
}

function buildCsvBlob(entry, tracks, filename) {
  const header = ["First", "Last", "Email", "Phone", "Avg Rating", "Submitted",
    ...tracks.map(t => `${t.name} - Stars`),
    ...tracks.map(t => `${t.name} - Vibes`),
    ...tracks.map(t => `${t.name} - Comment`)
  ];
  const row = [
    entry.user.first, entry.user.last, entry.user.email, entry.user.phone,
    entry.avgRating, entry.submittedAt,
    ...tracks.map(t => entry.ratings[t.id] || ""),
    ...tracks.map(t => (entry.vibes[t.id] || []).join("|")),
    ...tracks.map(t => (entry.comments[t.id] || "").replace(/"/g, '""')),
  ];
  const csv = [header, row].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  return Utilities.newBlob(csv, "text/csv", filename + ".csv");
}

function buildPdfBlob(entry, tracks, filename) {
  const doc  = DocumentApp.create(filename);
  const body = doc.getBody();

  body.appendParagraph("Better Left Unsaid 2 — Vote Summary")
      .setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(`${entry.user.first} ${entry.user.last}`)
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(`Email: ${entry.user.email}    Phone: ${entry.user.phone}`);
  body.appendParagraph(`Average Rating: ${entry.avgRating} / 5`);
  body.appendParagraph(`Submitted: ${entry.submittedAt}`);
  body.appendParagraph("");

  tracks.forEach(t => {
    const stars = Number(entry.ratings[t.id]) || 0;
    body.appendParagraph(`${String(t.id).padStart(2, "0")}. ${t.name}`)
        .setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph(`Rating: ${"★".repeat(stars)}${"☆".repeat(5 - stars)} (${stars}/5)`);
    body.appendParagraph(`Vibes: ${(entry.vibes[t.id] || []).join(", ") || "—"}`);
    body.appendParagraph(`Comment: ${entry.comments[t.id] || "—"}`);
  });

  doc.saveAndClose();

  const file    = DriveApp.getFileById(doc.getId());
  const pdfBlob = file.getAs(MimeType.PDF).setName(filename + ".pdf");
  file.setTrashed(true); // clean up the temporary Doc

  return pdfBlob;
}

/* ════════════════════════════════════════════
   RSVP — sheet storage + email
═══════════════════════════════════════════ */

function getRsvpSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(RSVP_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(RSVP_SHEET_NAME);
    sheet.appendRow(["Timestamp", "First", "Last", "Email", "Phone", "Status", "Guests", "HeardFrom", "Message"]);
  }
  return sheet;
}

function appendRsvpRow(entry) {
  const sheet = getRsvpSheet();
  sheet.appendRow([
    entry.submittedAt, entry.firstName, entry.lastName, entry.email, entry.phone,
    entry.status, entry.guestCount, entry.heardFrom, entry.message || ""
  ]);
}

/**
 * Returns every RSVP row, shaped to match the `rsvps` array consumed by
 * rsvp.html's admin "Sync All RSVPs (Cloud)" button.
 */
function getAllRsvps() {
  const sheet = getRsvpSheet();
  const data  = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const header = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    header.forEach((h, i) => obj[h] = row[i]);
    return {
      firstName: obj.First, lastName: obj.Last, email: obj.Email, phone: obj.Phone,
      status: obj.Status, guestCount: obj.Guests, heardFrom: obj.HeardFrom,
      message: obj.Message, submittedAt: obj.Timestamp
    };
  });
}

const RSVP_STATUS_LABEL = { going: "I'M THERE", maybe: "MAYBE", cantmake: "CAN'T MAKE IT" };

function emailRsvpGuest(entry) {
  const statusLabel = RSVP_STATUS_LABEL[entry.status] || entry.status;
  const isGoing = entry.status === "going";

  const headline = isGoing ? "YOU'RE LOCKED IN." : (entry.status === "maybe" ? "YOU'RE PENCILED IN." : "WE'LL MISS YOU.");
  const bodyCopy = isGoing
    ? "Your RSVP is confirmed. Details on location and everything you need to know before June 27th are coming your way soon. Mali V can't wait to see you in the room."
    : entry.status === "maybe"
      ? "No pressure — you're on the list as a maybe. Lock it in any time before June 27th at the link below."
      : "We'll miss you this time. BLU2 streams everywhere July 1st — don't miss the album.";

  const html = `
    <div style="background:#050505;color:#F0EDE8;font-family:Arial,sans-serif;padding:0;margin:0;">
      <div style="background:#E8501A;color:#050505;padding:28px 32px;font-size:24px;font-weight:bold;letter-spacing:1px;">
        ${headline}
      </div>
      <div style="padding:32px;">
        <p style="font-size:15px;line-height:1.6;">${bodyCopy}</p>
        <table style="margin:24px 0;font-size:14px;color:#8F8F8F;">
          <tr><td style="padding:4px 12px 4px 0;">Event</td><td style="color:#F0EDE8;">${EVENT_LABEL}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;">Artist</td><td style="color:#F0EDE8;">Mali V</td></tr>
          <tr><td style="padding:4px 12px 4px 0;">Album</td><td style="color:#F0EDE8;">Better Left Unsaid 2</td></tr>
          <tr><td style="padding:4px 12px 4px 0;">Status</td><td style="color:#E8501A;">${statusLabel}</td></tr>
        </table>
        <a href="https://untitled.app" style="display:inline-block;background:#E8501A;color:#050505;padding:14px 28px;text-decoration:none;font-weight:bold;letter-spacing:1px;">BUY THE ALBUM EARLY</a>
        <p style="margin-top:36px;font-size:12px;color:#8F8F8F;">All Flights Delayed · @mali__v · betterleftunsaid2.com</p>
      </div>
    </div>`;

  GmailApp.sendEmail(
    entry.email,
    isGoing ? "You're locked in. BLU2 Listening Party — June 27" : "BLU2 Listening Party — RSVP received",
    bodyCopy,
    { htmlBody: html, name: "Mali V" }
  );
}

function emailRsvpAdmin(entry) {
  GmailApp.sendEmail(
    ADMIN_EMAIL,
    `New RSVP — ${entry.firstName} ${entry.lastName} (${entry.status})`,
    `Name: ${entry.firstName} ${entry.lastName}\n` +
    `Email: ${entry.email}\n` +
    `Phone: ${entry.phone}\n` +
    `Status: ${entry.status}\n` +
    `Guests: ${entry.guestCount}\n` +
    `Heard from: ${entry.heardFrom}\n` +
    `Message: ${entry.message || "None"}\n` +
    `Submitted: ${entry.submittedAt}`,
    { name: "BLU2 RSVP" }
  );
}

/**
 * Adds a guest to Resend Contacts for future marketing emails.
 * The API key is read from Script Properties (Project Settings →
 * Script Properties → RESEND_API_KEY), never from source code, so it
 * isn't exposed in the repo or shipped to the browser. No-ops if the
 * property hasn't been set yet.
 */
function addToResendContacts(data) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("RESEND_API_KEY");
  if (!apiKey) return;

  UrlFetchApp.fetch("https://api.resend.com/contacts", {
    method: "post",
    contentType: "application/json",
    headers: { "Authorization": `Bearer ${apiKey}` },
    payload: JSON.stringify({
      email: data.email,
      first_name: data.firstName,
      last_name: data.lastName,
      unsubscribed: false
    }),
    muteHttpExceptions: true
  });
}

/**
 * Manual/automatable reminder blast — run this from the Apps Script
 * editor (or attach a time-driven trigger for June 24/26/27) to email
 * everyone who RSVP'd "going". Gmail's send quota for consumer accounts
 * is ~100/day, so this is fine for a guest list this size but won't
 * scale to a large mailing list — see the Twilio note below for SMS.
 */
function sendReminders(subject, message) {
  const going = getAllRsvps().filter(r => r.status === "going" && r.email);
  going.forEach(r => {
    GmailApp.sendEmail(r.email, subject, message, { name: "Mali V" });
  });
  return `Sent to ${going.length} guest(s).`;
}

/**
 * TODO — SMS reminders via Twilio.
 * Twilio's API requires a server-side secret (Account SID + Auth Token),
 * so it can't be called from rsvp.html directly. This Apps Script project
 * is already a safe place to hold that secret (Script Properties, not
 * source code) — add a sendSms(to, body) function here using
 * UrlFetchApp.fetch() against the Twilio REST API once an account exists.
 */

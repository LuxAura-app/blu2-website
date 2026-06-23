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
const EVENT_TIME     = "6:00 PM – 11:00 PM";
const ALBUM_ART_URL  = "https://www.betterleftunsaid2.com/img/BurningRosePic.jpeg";

// EVENT LOCATION: The Brewery Recording Studio, 910 Grand St, Brooklyn, NY 11211
// EVENT TIME: 6pm - 11pm (sharp start)
// REVEAL DATE: June 26, 2026 — send to all confirmed "Going" RSVPs
// Withheld from the RSVP page and the confirmation email until sendLocationReveal()
// is run on June 26 — see that function below.

/**
 * Called by the site on login, vote submission, and RSVP submission.
 *
 * - `{ type: "login", user }` — upserts the contact into the Contacts
 *   sheet for future email/text marketing. No email is sent.
 * - `{ type: "rsvp", ... }` — appends a row to the RSVP sheet, upserts the
 *   contact, emails the guest a confirmation (and texts one too, if a
 *   phone was given), and emails ADMIN_EMAIL a notification.
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
    smsRsvpGuest(entry);
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
  // Public, no admin pass required — lets a guest who lost their
  // confirmation email/text find their own RSVP status and (once
  // sendLocationReveal() has run) the venue, by looking themselves
  // up by the email they RSVP'd with.
  if (e.parameter.type === "lookup") {
    return jsonOut(lookupGuest(e.parameter.email));
  }

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

/**
 * Self-service lookup for a guest who lost their confirmation
 * email/text — finds their RSVP by the exact email they registered
 * with, and only includes the venue if sendLocationReveal() has
 * already run (LOCATION_REVEALED script property). Never returns
 * other guests' data, phone numbers, or messages.
 */
function lookupGuest(email) {
  if (!email) return { found: false };

  const normalized = String(email).trim().toLowerCase();
  const rsvp = getAllRsvps().find(r => String(r.email).trim().toLowerCase() === normalized);
  const revealed = PropertiesService.getScriptProperties().getProperty("LOCATION_REVEALED") === "true";

  if (!rsvp) return { found: false };

  const result = {
    found: true,
    status: rsvp.status,
    guestCount: rsvp.guestCount,
    eventLabel: EVENT_LABEL,
    eventTime: EVENT_TIME,
    venueRevealed: revealed
  };

  if (revealed) {
    const venue = getVenueInfo();
    result.venueName = venue.name;
    result.venueAddress = venue.address;
    result.doors = venue.doors;
  }

  return result;
}

const RSVP_STATUS_LABEL = { going: "I'M THERE", maybe: "MAYBE", cantmake: "CAN'T MAKE IT" };

function buildRsvpGuestHtml(entry) {
  const statusLabel = RSVP_STATUS_LABEL[entry.status] || entry.status;
  const isGoing = entry.status === "going";

  const headline = isGoing ? "YOU'RE LOCKED IN." : (entry.status === "maybe" ? "YOU'RE PENCILED IN." : "WE'LL MISS YOU.");
  const bodyCopy = isGoing
    ? "Your RSVP is confirmed. Details on location and everything you need to know before June 27th are coming your way soon. Mali V can't wait to see you in the room."
    : entry.status === "maybe"
      ? "No pressure — you're on the list as a maybe. Lock it in any time before June 27th at the link below."
      : "We'll miss you this time. BLU2 streams everywhere July 1st — don't miss the album.";

  const locationNote = "Location details will be sent to you on June 26th — the day before the event. Make sure you're watching your inbox and texts. Lost the message? Head back to betterleftunsaid2.com/rsvp and look up your RSVP by email to pull it up again.";
  const showLocationNote = isGoing || entry.status === "maybe";

  return `
    <div style="background:#050505;color:#F0EDE8;font-family:Arial,sans-serif;padding:0;margin:0;max-width:600px;">
      <img src="${ALBUM_ART_URL}" alt="Better Left Unsaid 2" width="600" draggable="false" oncontextmenu="return false;" style="width:100%;max-width:600px;height:220px;object-fit:cover;object-position:center 80%;display:block;filter:saturate(0.9);pointer-events:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;"/>
      <div style="background:#E8501A;color:#050505;padding:24px 32px;font-size:24px;font-weight:bold;letter-spacing:1px;border-bottom:4px solid #050505;">
        ${headline}
      </div>
      <div style="padding:32px;">
        <p style="font-size:15px;line-height:1.6;">${bodyCopy}</p>
        ${showLocationNote ? `<p style="font-size:14px;line-height:1.6;color:#E8501A;">${locationNote}</p>` : ""}
        <table style="margin:24px 0;font-size:14px;color:#8F8F8F;border-top:1px solid #181818;border-bottom:1px solid #181818;padding:12px 0;">
          <tr><td style="padding:6px 12px 6px 0;">Event</td><td style="color:#F0EDE8;">${EVENT_LABEL}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;">Time</td><td style="color:#F0EDE8;">${EVENT_TIME}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;">Artist</td><td style="color:#F0EDE8;">Mali V</td></tr>
          <tr><td style="padding:6px 12px 6px 0;">Album</td><td style="color:#F0EDE8;">Better Left Unsaid 2</td></tr>
          <tr><td style="padding:6px 12px 6px 0;">Status</td><td style="color:#E8501A;">${statusLabel}</td></tr>
        </table>
        <p style="margin-top:36px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#E8501A;">All Flights Delayed · @mali__v · betterleftunsaid2.com</p>
      </div>
    </div>`;
}

function emailRsvpGuest(entry) {
  const isGoing = entry.status === "going";
  const showLocationNote = isGoing || entry.status === "maybe";
  const bodyCopy = isGoing
    ? "Your RSVP is confirmed. Details on location and everything you need to know before June 27th are coming your way soon. Mali V can't wait to see you in the room."
    : entry.status === "maybe"
      ? "No pressure — you're on the list as a maybe. Lock it in any time before June 27th at the link below."
      : "We'll miss you this time. BLU2 streams everywhere July 1st — don't miss the album.";
  const locationNote = "Location details will be sent to you on June 26th — the day before the event. Make sure you're watching your inbox and texts. Lost the message? Head back to betterleftunsaid2.com/rsvp and look up your RSVP by email to pull it up again.";

  GmailApp.sendEmail(
    entry.email,
    isGoing ? "You're locked in. BLU2 Listening Party — June 27" : "BLU2 Listening Party — RSVP received",
    showLocationNote ? `${bodyCopy}\n\n${locationNote}` : bodyCopy,
    { htmlBody: buildRsvpGuestHtml(entry), name: "Mali V" }
  );
}

/**
 * The initial RSVP confirmation text — mirrors emailRsvpGuest(): no
 * venue address here, just a confirmation and a heads-up that the
 * location follows on June 26th. Sent as an MMS (album art attached)
 * for the same look-and-feel as the day-before reveal text. No-ops
 * silently if the guest's phone doesn't normalize or Twilio isn't
 * configured yet (see sendMms()).
 */
function smsRsvpGuest(entry) {
  const phone = normalizePhoneE164(entry.phone);
  if (!phone) return;

  const isGoing = entry.status === "going";
  const showLocationNote = isGoing || entry.status === "maybe";
  const bodyCopy = isGoing
    ? "You're locked in. BLU2 Listening Party — June 27."
    : entry.status === "maybe"
      ? "No pressure — you're on the list as a maybe for June 27."
      : "We'll miss you this time. BLU2 streams everywhere July 1st.";
  const locationNote = "Location details come June 26th, the day before.";

  const body = `${bodyCopy}${showLocationNote ? " " + locationNote : ""}\n— Better Left Unsaid 2 · Mali V\nReply STOP to opt out.`;
  sendMms(phone, body, ALBUM_ART_URL);
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
 * The venue, kept out of EVENT_LABEL/EVENT_TIME so it's never sent in
 * the RSVP confirmation. Only sendLocationReveal() and the post-reveal
 * website lookup (doGet type=lookup) are allowed to surface this.
 */
function getVenueInfo() {
  return {
    name: "The Brewery Recording Studio",
    address: "910 Grand St, Brooklyn, NY 11211",
    doors: "Doors open 6pm. Sharp. Don't be late."
  };
}

/**
 * The June 26 location reveal — emails AND texts (MMS, with album art
 * attached) the venue to everyone who RSVP'd "going" or "maybe", one
 * day before the event. Also flips the LOCATION_REVEALED script
 * property so the website's "find my RSVP" lookup starts surfacing
 * the venue to guests who lost the email/text.
 *
 * HOW TO RUN: open script.google.com → this project → select
 * "sendLocationReveal" from the function dropdown in the toolbar →
 * click Run. Do this on June 26th. Requires RESEND_API_KEY (email)
 * and TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER
 * (text) to be set in Project Settings → Script Properties. If the
 * Twilio properties aren't set yet, texts are skipped silently and
 * email still goes out.
 */
function buildLocationRevealHtml() {
  const venue = getVenueInfo();
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.name + ", " + venue.address)}`;

  return `
    <div style="background:#050505;color:#F0EDE8;font-family:Arial,sans-serif;padding:0;margin:0;max-width:600px;">
      <img src="${ALBUM_ART_URL}" alt="Better Left Unsaid 2" width="600" draggable="false" oncontextmenu="return false;" style="width:100%;max-width:600px;height:220px;object-fit:cover;object-position:center 80%;display:block;filter:saturate(0.9);pointer-events:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;"/>
      <div style="background:#E8501A;color:#050505;padding:24px 32px;font-size:24px;font-weight:bold;letter-spacing:1px;border-bottom:4px solid #050505;">
        YOU'RE EXPECTED.
      </div>
      <div style="padding:32px;">
        <p style="font-size:18px;font-weight:bold;margin-bottom:4px;">${venue.name}</p>
        <p style="font-size:15px;color:#8F8F8F;margin-bottom:24px;">${venue.address}</p>
        <p style="font-size:15px;line-height:1.6;">${venue.doors}</p>
        <a href="${mapsUrl}" style="display:inline-block;background:#E8501A;color:#050505;padding:14px 28px;text-decoration:none;font-weight:bold;letter-spacing:1px;margin-top:24px;">GET DIRECTIONS →</a>
        <p style="margin-top:36px;font-size:14px;line-height:1.6;color:#8F8F8F;">Lost this email? Head back to <a href="https://www.betterleftunsaid2.com/rsvp#lookup" style="color:#E8501A;">betterleftunsaid2.com/rsvp</a> and look up your RSVP by email to pull the address back up.</p>
        <p style="margin-top:24px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#E8501A;">Better Left Unsaid 2 · Mali V · All Flights Delayed</p>
      </div>
    </div>`;
}

function sendLocationReveal() {
  const apiKey = PropertiesService.getScriptProperties().getProperty("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY isn't set in Script Properties.");

  const venue = getVenueInfo();
  const html = buildLocationRevealHtml();
  const smsBody = `YOU'RE EXPECTED.\n${venue.name}\n${venue.address}\n${venue.doors}\n— Better Left Unsaid 2 · Mali V\nReply STOP to opt out.`;
  const recipients = getAllRsvps().filter(r => r.status === "going" || r.status === "maybe");

  let emailSent = 0, smsSent = 0, smsAttempted = 0;
  recipients.forEach(r => {
    if (r.email) {
      const res = UrlFetchApp.fetch("https://api.resend.com/emails", {
        method: "post",
        contentType: "application/json",
        headers: { "Authorization": `Bearer ${apiKey}` },
        payload: JSON.stringify({
          from: "Mali V <party@betterleftunsaid2.com>",
          to: [r.email],
          subject: "Tomorrow. Here's where to be.",
          html: html
        }),
        muteHttpExceptions: true
      });
      if (res.getResponseCode() < 300) emailSent++;
    }

    const phone = normalizePhoneE164(r.phone);
    if (phone) {
      smsAttempted++;
      if (sendMms(phone, smsBody, ALBUM_ART_URL)) smsSent++;
    }
  });

  PropertiesService.getScriptProperties().setProperty("LOCATION_REVEALED", "true");

  return `Location reveal: ${emailSent}/${recipients.length} emails, ${smsSent}/${smsAttempted} texts.`;
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
 * Converts a free-typed RSVP phone number to E.164 (+1XXXXXXXXXX) for
 * Twilio. Returns null if it doesn't look like a valid US number —
 * callers should skip sending rather than guess.
 */
function normalizePhoneE164(phone) {
  if (!phone) return null;
  const raw = String(phone).trim();
  if (raw.startsWith("+")) return raw;

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}

/**
 * Sends an MMS (or SMS if mediaUrl is omitted) via Twilio. Reads
 * TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER from
 * Script Properties (Project Settings → Script Properties) — never
 * from source code. No-ops (returns false) if those aren't set yet,
 * so the rest of sendLocationReveal() still works email-only until
 * Twilio is configured.
 */
function sendMms(to, body, mediaUrl) {
  const sid = PropertiesService.getScriptProperties().getProperty("TWILIO_ACCOUNT_SID");
  const token = PropertiesService.getScriptProperties().getProperty("TWILIO_AUTH_TOKEN");
  const from = PropertiesService.getScriptProperties().getProperty("TWILIO_PHONE_NUMBER");
  if (!sid || !token || !from) return false;

  const payload = { To: to, From: from, Body: body };
  if (mediaUrl) payload.MediaUrl = mediaUrl;

  const res = UrlFetchApp.fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "post",
    payload: payload,
    headers: { "Authorization": "Basic " + Utilities.base64Encode(sid + ":" + token) },
    muteHttpExceptions: true
  });
  return res.getResponseCode() < 300;
}

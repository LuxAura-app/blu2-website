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
const TRACK_COUNT    = 14;
const EVENT_LABEL    = "BLU2 Listening Party — Saturday, June 27, 2026";
const EVENT_TIME     = "7:00 PM – 11:00 PM";
const ALBUM_ART_URL  = "https://www.betterleftunsaid2.com/img/BurningRosePic.jpeg";
const SITE_URL       = "https://www.betterleftunsaid2.com";
const BUY_URL        = "https://maliv.bandcamp.com/album/blu-2"; // Bandcamp — stream + buy. Set July 1, 2026 after the platform change from untitled.stream.
const FROM_ADDRESS   = "Mali V <party@betterleftunsaid2.com>"; // verified Resend sender
const UNSUBSCRIBE_MAILTO = "mailto:party@betterleftunsaid2.com?subject=unsubscribe";
const SOCIALS        = {
  instagram: "https://instagram.com/mali__v",
  youtube:   "https://youtube.com/@mali__v"
};

// EVENT LOCATION: The Brewery Recording Studio, 910 Grand St, Brooklyn, NY 11211
// EVENT TIME: 7pm - 11pm (sharp start)
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
    doors: "Doors open 7pm. Sharp. Don't be late.",
    contact: "610-428-0493"
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

/* ════════════════════════════════════════════
   NEWSLETTER — reusable HTML email + album release blast

   buildNewsletterEmailHtml() is a generic, on-brand email template
   that matches the BLU2 website design system (index.html / rsvp.html):
   black canvas (#050505), orange accent (#E8501A), off-white body
   (#F0EDE8), the burning-rose hero image, an all-caps orange headline
   band, a bulletproof CTA button, an optional facts table, and a
   socials footer. Pass it an options object and reuse it for any future
   campaign (tour dates, single drops, merch, etc.) — only the content
   changes, never the markup.

   sendAlbumReleaseEmail() is the first concrete campaign: the
   "Better Left Unsaid 2 is out" announcement, blasted to the whole
   Contacts marketing list via Resend on July 1, 2026. See SETUP.md for
   the midnight-trigger instructions.
═══════════════════════════════════════════ */

/**
 * Renders a reusable, design-system-matched HTML newsletter email.
 * All styling is inline + table-based for email-client compatibility
 * (Gmail strips <style> blocks and CSS variables), but the palette,
 * type treatment, and voice mirror the website exactly.
 *
 * @param {Object} opts
 * @param {string} opts.headline    Big all-caps orange band, e.g. "IT'S HERE."
 * @param {string} [opts.eyebrow]   Small uppercase label above the body, e.g. "OUT NOW · JULY 1, 2026"
 * @param {string} [opts.preheader] Hidden inbox-preview text (recommended)
 * @param {string} opts.intro       Lead paragraph (plain text or simple inline HTML)
 * @param {string[]} [opts.paragraphs] Additional body paragraphs
 * @param {string} [opts.ctaLabel]  Button text, e.g. "STREAM / BUY NOW →"
 * @param {string} [opts.ctaUrl]    Button link
 * @param {Array<[string,string]>} [opts.facts] Rows for the info table, [label, value]
 * @param {string} [opts.imageUrl]  Hero image (defaults to the album art)
 * @param {string} [opts.footerTagline] Small orange uppercase sign-off
 * @returns {string} Full HTML email body
 */
function buildNewsletterEmailHtml(opts) {
  const o = opts || {};
  const imageUrl = o.imageUrl || ALBUM_ART_URL;
  const eyebrow = o.eyebrow || "";
  const preheader = o.preheader || "";
  const intro = o.intro || "";
  const paragraphs = o.paragraphs || [];
  const facts = o.facts || [];
  const footerTagline = o.footerTagline || "Better Left Unsaid 2 · Mali V · All Flights Delayed";

  const paraStyle = "font-size:15px;line-height:1.7;color:#F0EDE8;margin:0 0 16px;";

  const eyebrowHtml = eyebrow
    ? `<p style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#E8501A;margin:0 0 16px;">${eyebrow}</p>`
    : "";

  const introHtml = intro ? `<p style="${paraStyle}">${intro}</p>` : "";

  const paragraphsHtml = paragraphs.map(p => `<p style="${paraStyle}">${p}</p>`).join("");

  // Bulletproof, table-based CTA button (renders in Outlook + Gmail).
  const ctaHtml = (o.ctaLabel && o.ctaUrl)
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;">
         <tr><td style="background:#E8501A;">
           <a href="${o.ctaUrl}" target="_blank"
              style="display:inline-block;padding:16px 36px;color:#050505;text-decoration:none;font-size:13px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">${o.ctaLabel}</a>
         </td></tr>
       </table>`
    : "";

  const factsHtml = facts.length
    ? `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:28px 0 8px;font-size:14px;color:#8F8F8F;border-top:1px solid #181818;border-bottom:1px solid #181818;">
         ${facts.map(([label, value]) => `<tr>
           <td style="padding:10px 16px 10px 0;white-space:nowrap;">${label}</td>
           <td style="padding:10px 0;color:#F0EDE8;text-align:right;">${value}</td>
         </tr>`).join("")}
       </table>`
    : "";

  // Hidden preheader: shows in the inbox preview line, not in the body.
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#050505;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><meta name="color-scheme" content="dark"/></head>
<body style="margin:0;padding:0;background:#050505;">
  ${preheaderHtml}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#050505;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#0D0D0D;border:1px solid #181818;">

        <!-- Hero image -->
        <tr><td style="padding:0;">
          <img src="${imageUrl}" alt="Better Left Unsaid 2" width="600"
               style="width:100%;max-width:600px;height:220px;object-fit:cover;object-position:center 80%;display:block;border:0;filter:saturate(0.9);"/>
        </td></tr>

        <!-- Orange headline band -->
        <tr><td style="background:#E8501A;color:#050505;padding:24px 32px;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:bold;letter-spacing:1px;line-height:1.05;text-transform:uppercase;border-bottom:4px solid #050505;">
          ${o.headline || ""}
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px;font-family:Arial,Helvetica,sans-serif;">
          ${eyebrowHtml}
          ${introHtml}
          ${paragraphsHtml}
          ${ctaHtml}
          ${factsHtml}
          <p style="margin:36px 0 0;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#E8501A;">${footerTagline}</p>
        </td></tr>

        <!-- Footer / socials -->
        <tr><td style="padding:24px 32px;border-top:1px solid #181818;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8F8F8F;text-align:center;">
          <a href="${SOCIALS.instagram}" target="_blank" style="color:#8F8F8F;text-decoration:none;margin:0 10px;">Instagram</a>
          <a href="${SOCIALS.youtube}" target="_blank" style="color:#8F8F8F;text-decoration:none;margin:0 10px;">YouTube</a>
          <a href="${SITE_URL}" target="_blank" style="color:#8F8F8F;text-decoration:none;margin:0 10px;">betterleftunsaid2.com</a>
          <p style="margin:16px 0 0;color:#555;font-size:11px;">© 2026 All Flights Delayed · You're receiving this because you signed up at betterleftunsaid2.com.<br/><a href="${UNSUBSCRIBE_MAILTO}" style="color:#8F8F8F;">Unsubscribe</a></p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Every unique email from the Contacts sheet (the marketing list built
 * up by logins, votes, and RSVPs). Deduped case-insensitively, header
 * and blanks skipped.
 */
function getAllContactEmails() {
  const sheet = getContactsSheet();
  const data = sheet.getDataRange().getValues();
  const seen = {};
  const emails = [];
  for (let i = 1; i < data.length; i++) {
    const email = String(data[i][2] || "").trim();
    const key = email.toLowerCase();
    if (!email || !key.includes("@") || seen[key]) continue;
    seen[key] = true;
    emails.push(email);
  }
  return emails;
}

/**
 * Album release announcement — "Better Left Unsaid 2 is out."
 *
 * Blasts the on-brand newsletter to the entire Contacts marketing list
 * via Resend (same channel as sendLocationReveal). Designed to be fired
 * automatically by a time-driven trigger at midnight ET on July 1, 2026
 * (see SETUP.md), but it's also safe to run by hand from the editor.
 *
 * Resend's List-Unsubscribe header + {{RESEND_UNSUBSCRIBE}} token handle
 * one-click unsubscribe so the blast is CAN-SPAM compliant. Requires
 * RESEND_API_KEY in Project Settings → Script Properties.
 */
const ALBUM_RELEASE_SUBJECT = "Here's the link — download Better Left Unsaid 2 now.";

/** The album-release email body — shared by the real blast and the test send. */
function buildAlbumReleaseHtml() {
  return buildNewsletterEmailHtml({
    preheader: "Better Left Unsaid 2 by Mali V is available to download now.",
    eyebrow: "Available to Download · July 1, 2026",
    headline: "IT'S HERE.",
    intro: "No more waiting. <strong>Better Left Unsaid 2</strong> is available to download right now — 14 tracks, every word the title says we shouldn't.",
    paragraphs: [
      "You were in the room before anyone. Now it's yours to keep. Download it, own it, send it to the one person who needs to hear it.",
      "Thank you for riding with Mali V from the jump. This one's for you."
    ],
    ctaLabel: "Download Now →",
    ctaUrl: BUY_URL,
    facts: [
      ["Album", "Better Left Unsaid 2"],
      ["Artist", "Mali V"],
      ["Tracks", "14"],
      ["Released", "July 1, 2026"]
    ],
    footerTagline: "Better Left Unsaid 2 · Mali V · All Flights Delayed"
  });
}

/** Sends one newsletter email to `email` via Resend. Returns the HTTPResponse. */
function sendOneNewsletterEmail(email, apiKey, html, subject) {
  return UrlFetchApp.fetch("https://api.resend.com/emails", {
    method: "post",
    contentType: "application/json",
    headers: { "Authorization": `Bearer ${apiKey}` },
    payload: JSON.stringify({
      from: FROM_ADDRESS,
      to: [email],
      subject: subject,
      html: html,
      headers: { "List-Unsubscribe": `<${UNSUBSCRIBE_MAILTO}>` }
    }),
    muteHttpExceptions: true
  });
}

function sendAlbumReleaseEmail() {
  const apiKey = PropertiesService.getScriptProperties().getProperty("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY isn't set in Script Properties.");

  const html = buildAlbumReleaseHtml();
  const recipients = getAllContactEmails();
  let sent = 0, failed = 0;

  recipients.forEach(email => {
    if (sendOneNewsletterEmail(email, apiKey, html, ALBUM_RELEASE_SUBJECT).getResponseCode() < 300) sent++;
    else failed++;
  });

  const summary = `Album release email: ${sent} sent, ${failed} failed, ${recipients.length} contacts.`;
  Logger.log(summary);
  return summary;
}

/**
 * One-off test send — delivers the exact album-release email (subject
 * prefixed with [TEST]) to a single address so you can preview rendering,
 * the CTA, and the unsubscribe footer before the real blast. Defaults to
 * the address below; pass an email to override. Safe to run anytime.
 */
function sendAlbumReleaseTest(email) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY isn't set in Script Properties.");

  const to = email || "rushell.mg@gmail.com";
  const res = sendOneNewsletterEmail(to, apiKey, buildAlbumReleaseHtml(), "[TEST] " + ALBUM_RELEASE_SUBJECT);
  const code = res.getResponseCode();

  // Log Resend's full response so failures are diagnosable. The usual
  // cause of a 200 with no inbox delivery is an unverified sender domain:
  // until betterleftunsaid2.com is verified in Resend, sends are
  // restricted to the Resend account owner's own address, and anything
  // else is rejected here with the reason in the body below.
  const summary =
    `Test album-release email to ${to}: HTTP ${code} (${code < 300 ? "sent" : "FAILED"}).\n` +
    `Resend response: ${res.getContentText()}`;
  Logger.log(summary);
  return summary;
}

/**
 * One-shot helper to schedule sendAlbumReleaseEmail() for late morning
 * (11:00 AM ET) on July 1, 2026 — not midnight, so the blast lands when
 * the list is actually awake and checking their inbox. Run this ONCE from
 * the editor any time before then. The script's timezone is
 * America/New_York (appsscript.json), so the Date components below resolve
 * to 11:00 AM Eastern on release day.
 *
 * Re-running it deletes any existing album-release trigger first, so
 * it's safe to run twice without double-sending.
 */
function createAlbumReleaseTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "sendAlbumReleaseEmail") ScriptApp.deleteTrigger(t);
  });

  const releaseSendTime = new Date(2026, 6, 1, 11, 0, 0); // July 1, 11:00 AM; month index 6; local = America/New_York
  ScriptApp.newTrigger("sendAlbumReleaseEmail")
    .timeBased()
    .at(releaseSendTime)
    .create();

  return `Trigger set: sendAlbumReleaseEmail fires at ${releaseSendTime} (America/New_York).`;
}

/**
 * One-click readiness check for the July 1 album-release blast. Logs (and
 * returns) whether everything is in place so nothing silently no-ops on
 * release day:
 *   - RESEND_API_KEY present in Script Properties
 *   - a time-based trigger for sendAlbumReleaseEmail is armed
 *   - how many contacts the blast would reach
 * Read-only — sends nothing and creates no triggers. Run it from the
 * editor's function dropdown.
 */
function checkAlbumReleaseReadiness() {
  const hasKey = !!PropertiesService.getScriptProperties().getProperty("RESEND_API_KEY");

  const triggers = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "sendAlbumReleaseEmail");
  const triggerArmed = triggers.length > 0;

  const contactCount = getAllContactEmails().length;

  const lines = [
    "── Album release readiness ──",
    `RESEND_API_KEY set:   ${hasKey ? "YES" : "NO  ← set it in Project Settings → Script Properties"}`,
    `Trigger armed:        ${triggerArmed ? `YES (${triggers.length})` : "NO  ← run createAlbumReleaseTrigger"}`,
    `Contacts to reach:    ${contactCount}`,
    `Ready to send:        ${hasKey && triggerArmed && contactCount > 0 ? "YES ✅" : "NOT YET ⚠️"}`
  ];

  const report = lines.join("\n");
  Logger.log(report);
  return report;
}

/* ════════════════════════════════════════════
   VOTING INVITE — "the room is open" blast to RSVP invitees

   A one-tap email to everyone who RSVP'd: hit the link, land on
   betterleftunsaid2.com, sign in, and rate every track live during the
   listening party. Reuses buildNewsletterEmailHtml() and the Resend
   channel. Send it the night of the event (voting opens 7 PM ET,
   June 27) by running sendVotingInviteEmail() from the editor.
═══════════════════════════════════════════ */

const VOTING_INVITE_SUBJECT = "The room is open. Rate every track — tonight.";

/** The voting-invite email body — shared by the real blast and the test send. */
function buildVotingInviteHtml() {
  return buildNewsletterEmailHtml({
    preheader: "The room is open — sign in and rate every track live with Mali V.",
    eyebrow: "Listening Party · June 27, 2026",
    headline: "THE ROOM IS OPEN.",
    intro: "Tonight, <strong>Better Left Unsaid 2</strong> plays in full — and you're in the room. Hit the button below, sign in, and rate every track live as it drops.",
    paragraphs: [
      "Your ratings and vibes shape the night. Mali V is watching the room in real time, so make every track count.",
      "One tap gets you in — see you inside."
    ],
    ctaLabel: "Enter the Room →",
    ctaUrl: SITE_URL,
    facts: [
      ["Event", "BLU2 Listening Party"],
      ["Date", "Saturday, June 27, 2026"],
      ["Time", "7:00 PM – 11:00 PM"],
      ["Artist", "Mali V"]
    ],
    footerTagline: "Better Left Unsaid 2 · Mali V · All Flights Delayed"
  });
}

/**
 * Unique RSVP emails, deduped case-insensitively (header and blanks
 * skipped). Pass `statuses` (e.g. ["going", "maybe"]) to include only
 * those RSVP statuses; omit it to include everyone.
 */
function getAllRsvpEmails(statuses) {
  const allow = statuses ? statuses.map(s => String(s).toLowerCase()) : null;
  const seen = {};
  const emails = [];
  getAllRsvps().forEach(r => {
    if (allow && allow.indexOf(String(r.status || "").toLowerCase()) === -1) return;
    const email = String(r.email || "").trim();
    const key = email.toLowerCase();
    if (!email || !key.includes("@") || seen[key]) return;
    seen[key] = true;
    emails.push(email);
  });
  return emails;
}

/**
 * Blasts the "the room is open" voting invite to every RSVP invitee via
 * Resend. Run this from the editor the night of the listening party.
 * Requires RESEND_API_KEY in Script Properties and a verified sender
 * domain (same setup as sendAlbumReleaseEmail).
 */
function sendVotingInviteEmail() {
  const apiKey = PropertiesService.getScriptProperties().getProperty("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY isn't set in Script Properties.");

  const html = buildVotingInviteHtml();
  // Only people who said they're coming — skip "can't make it" RSVPs.
  const recipients = getAllRsvpEmails(["going", "maybe"]);
  let sent = 0, failed = 0;

  recipients.forEach(email => {
    if (sendOneNewsletterEmail(email, apiKey, html, VOTING_INVITE_SUBJECT).getResponseCode() < 300) sent++;
    else failed++;
  });

  const summary = `Voting invite email: ${sent} sent, ${failed} failed, ${recipients.length} going/maybe invitees.`;
  Logger.log(summary);
  return summary;
}

/**
 * One-off test send of the voting invite (subject prefixed [TEST]) to a
 * single address. Defaults to rushell.mg@gmail.com; pass an email to
 * override. Logs Resend's full response so failures are diagnosable.
 */
function sendVotingInviteTest(email) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY isn't set in Script Properties.");

  const to = email || "rushell.mg@gmail.com";
  const res = sendOneNewsletterEmail(to, apiKey, buildVotingInviteHtml(), "[TEST] " + VOTING_INVITE_SUBJECT);
  const code = res.getResponseCode();

  const summary =
    `Test voting-invite email to ${to}: HTTP ${code} (${code < 300 ? "sent" : "FAILED"}).\n` +
    `Resend response: ${res.getContentText()}`;
  Logger.log(summary);
  return summary;
}

/* ════════════════════════════════════════════
   ARRIVAL INFO — "getting in" blast (directions + the door)

   Sent the night of the event to everyone coming (going / maybe): how to
   reach The Brewery Recording Studio, who to call if they can't find it,
   and the door instruction (buzz Studio A). Reuses buildNewsletterEmailHtml()
   and the Resend channel. Email-only — run sendArrivalInfoEmail() from the
   editor.
═══════════════════════════════════════════ */

const ARRIVAL_INFO_SUBJECT = "Getting in tonight — directions + the door.";

/** The arrival-info email body — shared by the real blast and the test send. */
function buildArrivalInfoHtml() {
  const venue = getVenueInfo();
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.name + ", " + venue.address)}`;

  return buildNewsletterEmailHtml({
    preheader: "Getting to Better Left Unsaid 2 — directions, the door, and who to call.",
    eyebrow: "Tonight · Listening Party",
    headline: "GETTING IN.",
    intro: `Heading to <strong>${venue.name}</strong> tonight? Here's everything you need to get through the door.`,
    paragraphs: [
      `Can't find the address, or running into any trouble on the way? Call or text <strong>${venue.contact}</strong> and we'll point you the right way.`,
      "Once you reach the address, <strong>buzz Studio A</strong> and we'll let you in."
    ],
    ctaLabel: "Get Directions →",
    ctaUrl: mapsUrl,
    facts: [
      ["Venue", venue.name],
      ["Address", venue.address],
      ["Doors", "7:00 PM"],
      ["Questions?", venue.contact]
    ],
    footerTagline: "Better Left Unsaid 2 · Mali V · All Flights Delayed"
  });
}

/**
 * Blasts the arrival-info email to every guest who's coming (going /
 * maybe) via Resend. Run from the editor the night of the event.
 * Requires RESEND_API_KEY and a verified sender domain.
 */
function sendArrivalInfoEmail() {
  const apiKey = PropertiesService.getScriptProperties().getProperty("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY isn't set in Script Properties.");

  const html = buildArrivalInfoHtml();
  const recipients = getAllRsvpEmails(["going", "maybe"]);
  let sent = 0, failed = 0;

  recipients.forEach(email => {
    if (sendOneNewsletterEmail(email, apiKey, html, ARRIVAL_INFO_SUBJECT).getResponseCode() < 300) sent++;
    else failed++;
  });

  const summary = `Arrival info email: ${sent} sent, ${failed} failed, ${recipients.length} going/maybe invitees.`;
  Logger.log(summary);
  return summary;
}

/**
 * One-off test send of the arrival-info email (subject prefixed [TEST])
 * to a single address. Defaults to rushell.mg@gmail.com; pass an email to
 * override. Logs Resend's full response so failures are diagnosable.
 */
function sendArrivalInfoTest(email) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY isn't set in Script Properties.");

  const to = email || "rushell.mg@gmail.com";
  const res = sendOneNewsletterEmail(to, apiKey, buildArrivalInfoHtml(), "[TEST] " + ARRIVAL_INFO_SUBJECT);
  const code = res.getResponseCode();

  const summary =
    `Test arrival-info email to ${to}: HTTP ${code} (${code < 300 ? "sent" : "FAILED"}).\n` +
    `Resend response: ${res.getContentText()}`;
  Logger.log(summary);
  return summary;
}

/* ════════════════════════════════════════════
   THANK YOU — post-event gratitude blast

   Sent the morning after the listening party to everyone who came
   ("going" RSVPs): appreciation for their time, energy, ears, and the
   honest critiques that sharpen the work. Reuses buildNewsletterEmailHtml()
   and the Resend channel; email-only. Run sendThankYouEmail() from the
   editor.
═══════════════════════════════════════════ */

const THANK_YOU_SUBJECT = "Thank you for last night.";

/** The thank-you email body — shared by the real blast and the test send. */
function buildThankYouHtml() {
  return buildNewsletterEmailHtml({
    preheader: "From all of us — thank you for your time, your ears, and your honesty.",
    eyebrow: "Better Left Unsaid 2 · Listening Party",
    headline: "THANK YOU.",
    intro: "From all of us — Mali V and the entire production team — thank you. Last night meant everything.",
    paragraphs: [
      "You gave us your time, your energy, and your ears. You sat with every track and told us the truth — the love and the critiques alike — and that honesty is exactly what sharpens us into better, more refined artists and a stronger production team.",
      "<strong>Better Left Unsaid 2</strong> is sharper because you were in the room. We can't thank you enough for shaping it with us.",
      "With nothing but love and gratitude — and we'll see you on release day."
    ],
    ctaLabel: "Get BLU2 — Out July 1 →",
    ctaUrl: BUY_URL,
    facts: [
      ["Album", "Better Left Unsaid 2"],
      ["Out", "July 1, 2026"],
      ["Artist", "Mali V"]
    ],
    footerTagline: "Better Left Unsaid 2 · Mali V · All Flights Delayed"
  });
}

/**
 * Blasts the thank-you email to everyone who came (going RSVPs) via
 * Resend. Run from the editor the morning after the event. Requires
 * RESEND_API_KEY and a verified sender domain.
 */
function sendThankYouEmail() {
  const apiKey = PropertiesService.getScriptProperties().getProperty("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY isn't set in Script Properties.");

  const html = buildThankYouHtml();
  const recipients = getAllRsvpEmails(["going"]);
  let sent = 0, failed = 0;

  recipients.forEach(email => {
    if (sendOneNewsletterEmail(email, apiKey, html, THANK_YOU_SUBJECT).getResponseCode() < 300) sent++;
    else failed++;
  });

  const summary = `Thank-you email: ${sent} sent, ${failed} failed, ${recipients.length} going invitees.`;
  Logger.log(summary);
  return summary;
}

/**
 * One-off test send of the thank-you email (subject prefixed [TEST]) to a
 * single address. Defaults to rushell.mg@gmail.com; pass an email to
 * override. Logs Resend's full response so failures are diagnosable.
 */
function sendThankYouTest(email) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY isn't set in Script Properties.");

  const to = email || "rushell.mg@gmail.com";
  const res = sendOneNewsletterEmail(to, apiKey, buildThankYouHtml(), "[TEST] " + THANK_YOU_SUBJECT);
  const code = res.getResponseCode();

  const summary =
    `Test thank-you email to ${to}: HTTP ${code} (${code < 300 ? "sent" : "FAILED"}).\n` +
    `Resend response: ${res.getContentText()}`;
  Logger.log(summary);
  return summary;
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
 * Sends an MMS (or SMS if mediaUrl is omitted) via Twilio, through the
 * Messaging Service (handles the verified toll-free number, opt-out
 * keywords, etc. on Twilio's side — no raw From number needed). Reads
 * TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_MESSAGING_SERVICE_SID
 * from Script Properties (Project Settings → Script Properties) —
 * never from source code. No-ops (returns false) if those aren't set
 * yet, so the rest of sendLocationReveal() still works email-only
 * until Twilio is configured.
 */
function sendMms(to, body, mediaUrl) {
  const sid = PropertiesService.getScriptProperties().getProperty("TWILIO_ACCOUNT_SID");
  const token = PropertiesService.getScriptProperties().getProperty("TWILIO_AUTH_TOKEN");
  const messagingServiceSid = PropertiesService.getScriptProperties().getProperty("TWILIO_MESSAGING_SERVICE_SID");
  if (!sid || !token || !messagingServiceSid) return false;

  const payload = { To: to, MessagingServiceSid: messagingServiceSid, Body: body };
  if (mediaUrl) payload.MediaUrl = mediaUrl;

  const res = UrlFetchApp.fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "post",
    payload: payload,
    headers: { "Authorization": "Basic " + Utilities.base64Encode(sid + ":" + token) },
    muteHttpExceptions: true
  });
  return res.getResponseCode() < 300;
}

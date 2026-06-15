/**
 * BLU2 Listening Party — Vote Sync & Email backend.
 * Deploy as a Google Apps Script Web App pointed at the BLU2 Votes sheet.
 * See SETUP.md for step-by-step deployment instructions.
 */

const SPREADSHEET_ID = "1l_XQQKZ4Sss_qQyA5bLfaHQ2OVh62XwhH1xzwvbHUm4";
const SHEET_NAME     = "Responses";
const CONTACTS_SHEET_NAME = "Contacts";
const ADMIN_EMAIL    = "titledtentatively@gmail.com";
const ADMIN_PASS     = "maliv2026"; // must match ADMIN_PASS in index.html
const TRACK_COUNT    = 13;

/**
 * Called by the site on login and on vote submission.
 *
 * - `{ type: "login", user }` — upserts the contact into the Contacts
 *   sheet for future email/text marketing. No email is sent.
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

/**
 * BLU2 Listening Party — Vote Sync & Email backend.
 * Deploy as a Google Apps Script Web App bound to a Google Sheet.
 * See SETUP.md for step-by-step deployment instructions.
 */

const SHEET_NAME   = "Responses";
const ADMIN_EMAIL  = "titledtentatively@gmail.com";
const ADMIN_PASS   = "maliv2026"; // must match ADMIN_PASS in index.html
const TRACK_COUNT  = 13;

/**
 * Called by the site on vote submission.
 * Appends a row to the sheet and emails the voter's results
 * as a CSV + PDF attachment to ADMIN_EMAIL.
 */
function doPost(e) {
  const entry  = JSON.parse(e.postData.contents);
  const tracks = entry.tracks || [];

  appendRow(entry);
  emailVote(entry, tracks);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
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

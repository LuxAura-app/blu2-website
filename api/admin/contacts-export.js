const { listConsentedContactsInRange } = require('../lib/order-log');
const { isAuthorizedAdminRequest, parseDateRange } = require('../lib/admin-auth');

function csvEscape(value) {
  const str = String(value || '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsv(rows) {
  const lines = rows.map((r) => [r.name, r.email, r.phone].map(csvEscape).join(','));
  return ['name,email,phone', ...lines].join('\n');
}

// Only ever reads contacts:index — sessions where marketingConsent !== true
// never land there in the first place (see api/stripe-webhook.js). There is
// deliberately no "export everyone" mode.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).send('Method not allowed');
    return;
  }

  if (!isAuthorizedAdminRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { from, to } = parseDateRange(req, 0);
  const contacts = await listConsentedContactsInRange(from, to);
  const rows = contacts.map((c) => ({ name: c.name, email: c.email, phone: c.phone }));

  const url = new URL(req.url, 'http://localhost');
  if (url.searchParams.get('format') === 'json') {
    res.status(200).json(rows);
    return;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="blu2-contacts.csv"');
  res.status(200).send(toCsv(rows));
};

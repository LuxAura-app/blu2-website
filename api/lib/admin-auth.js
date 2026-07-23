// Shared by both admin endpoints so the token check and date-range parsing
// live in exactly one place — a bug here would otherwise need fixing twice.

function isAuthorizedAdminRequest(req) {
  const token = process.env.ADMIN_REPORT_TOKEN;
  if (!token) return false;
  const header = req.headers['authorization'] || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return Boolean(match && match[1] === token);
}

function parseDate(value, fallback) {
  if (!value) return fallback;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? fallback : ms;
}

/** @param {number} defaultFromMs used when `?from=` is absent/invalid */
function parseDateRange(req, defaultFromMs) {
  const url = new URL(req.url, 'http://localhost');
  const now = Date.now();
  return {
    from: parseDate(url.searchParams.get('from'), defaultFromMs),
    to: parseDate(url.searchParams.get('to'), now),
  };
}

module.exports = { isAuthorizedAdminRequest, parseDateRange };

const { Resend } = require('resend');

/** @param {string} label e.g. "Orders" or "Alerts" */
function resolveFromAddress(label) {
  const host = new URL(process.env.SITE_URL || 'https://example.com').hostname;
  return `${process.env.STORE_NAME || 'Store'} ${label} <orders@${host}>`;
}

/**
 * Sends an internal ops alert (oversold inventory, a provider submission
 * that failed, an idempotency-completion write that didn't stick, etc.) to
 * ORDER_NOTIFICATION_EMAIL. Distinct from the customer-facing self-provider
 * order email. NEVER throws — an alerting failure must not itself break
 * the caller's control flow (see api/lib/idempotency.js's fail-loud, non-
 * blocking completion path for why).
 * @param {string} subject
 * @param {string} text
 * @returns {Promise<boolean>} true if the alert was sent
 */
async function sendAlert(subject, text) {
  if (!process.env.RESEND_API_KEY || !process.env.ORDER_NOTIFICATION_EMAIL) {
    console.error('[alert] RESEND_API_KEY/ORDER_NOTIFICATION_EMAIL not configured — alert not sent:', subject, text);
    return false;
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: resolveFromAddress('Alerts'),
      to: process.env.ORDER_NOTIFICATION_EMAIL,
      subject: `[ALERT] ${subject}`,
      text,
    });
    return true;
  } catch (err) {
    console.error('[alert] Failed to send alert email:', subject, err);
    return false;
  }
}

module.exports = { sendAlert, resolveFromAddress };

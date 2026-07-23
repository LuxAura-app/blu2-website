#!/usr/bin/env node
// Reads PRODUCTS out of shop.html and, per §11 of the fulfillment spec,
// prints every activation problem it finds rather than stopping at the
// first. Run manually or in CI: `node scripts/validate-products.js`
// (set STRIPE_SECRET_KEY to also validate priceId against live Stripe).
const fs = require('fs');
const path = require('path');
const Stripe = require('stripe');

const SHOP_HTML_PATH = path.join(__dirname, '..', 'shop.html');
const VALID_PROVIDERS = ['apliiq', 'printful', 'self'];

function isPlaceholder(value) {
  return !value || /^REPLACE_WITH_/.test(value);
}

function loadProducts() {
  const html = fs.readFileSync(SHOP_HTML_PATH, 'utf8');
  const match = html.match(/const PRODUCTS = (\[[\s\S]*?\n\]);/);
  if (!match) {
    throw new Error(`Could not find "const PRODUCTS = [...]" in ${SHOP_HTML_PATH}`);
  }
  // shop.html defines PRODUCTS as a plain trusted JS literal (it's run
  // as-is in the browser already) — evaluating the extracted source here
  // is simpler than writing a parser for what is, in practice, JSON5.
  return new Function(`return ${match[1]};`)();
}

function providerConfigured(provider) {
  if (provider === 'apliiq') {
    return Boolean(process.env.APLIIQ_APP_ID && process.env.APLIIQ_SHARED_SECRET && process.env.APLIIQ_STORE_ID);
  }
  if (provider === 'printful') {
    return Boolean(process.env.PRINTFUL_API_KEY);
  }
  if (provider === 'self') {
    return Boolean(process.env.RESEND_API_KEY && process.env.ORDER_NOTIFICATION_EMAIL);
  }
  return false;
}

async function validateProduct(product, stripe) {
  const problems = [];
  // Draft/placeholder products (active: false) are expected to be incomplete per §6 —
  // only flag them as blocking once someone actually flips active: true.
  const severity = product.active ? 'ERROR' : 'INFO';

  if (!VALID_PROVIDERS.includes(product.fulfillmentProvider)) {
    problems.push(`unsupported fulfillmentProvider "${product.fulfillmentProvider}"`);
  } else if (!providerConfigured(product.fulfillmentProvider)) {
    problems.push(`fulfillmentProvider "${product.fulfillmentProvider}" is not configured (missing env vars)`);
  }

  if (['apliiq', 'printful'].includes(product.fulfillmentProvider) && isPlaceholder(product.providerVariantId)) {
    problems.push('providerVariantId is missing or still a REPLACE_WITH_ placeholder');
  }

  if (isPlaceholder(product.priceId)) {
    problems.push('priceId is missing or still a REPLACE_WITH_ placeholder');
  } else if (stripe) {
    try {
      const price = await stripe.prices.retrieve(product.priceId);
      if (!price.active) problems.push(`Stripe price ${product.priceId} exists but is not active`);
    } catch (err) {
      problems.push(`Stripe price ${product.priceId} could not be retrieved: ${err.message}`);
    }
  }

  if (!product.image) {
    problems.push('no product image set');
  } else if (product.image.startsWith('img/')) {
    const localPath = path.join(__dirname, '..', product.image);
    if (!fs.existsSync(localPath)) {
      problems.push(`image file not found: ${product.image} (placeholder art will render instead)`);
    }
  }

  return problems.map((problem) => ({ id: product.id, severity, problem }));
}

async function main() {
  const products = loadProducts();
  const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
  if (!stripe) {
    console.warn('STRIPE_SECRET_KEY not set — skipping live Stripe price checks.\n');
  }

  const allIssues = [];
  for (const product of products) {
    allIssues.push(...(await validateProduct(product, stripe)));
  }

  if (allIssues.length === 0) {
    console.log(`All ${products.length} products passed validation.`);
    return;
  }

  for (const issue of allIssues) {
    console.log(`[${issue.severity}] ${issue.id}: ${issue.problem}`);
  }

  const errorCount = allIssues.filter((i) => i.severity === 'ERROR').length;
  console.log(`\n${allIssues.length} issue(s) found (${errorCount} blocking).`);
  if (errorCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

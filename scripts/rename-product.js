#!/usr/bin/env node
// One-off catalog metadata edit: updates a product's display `name` (what
// shop.html renders as the card title, via flattenProductToCards's
// `baseName`/`name`) without touching Stripe at all — no Price/Product is
// keyed by name, so this is a pure Redis catalog write.
//
// Usage:
//   node scripts/rename-product.js <internalProductId> --name="New Name"
//
// Needs real Redis credentials set.

const { getProduct, upsertProduct } = require('../lib/product-catalog');

function parseArgs(argv) {
  const args = { id: null, name: null };
  for (const raw of argv) {
    if (raw.startsWith('--name=')) {
      args.name = raw.slice('--name='.length);
    } else if (raw.startsWith('--')) {
      throw new Error(`Unrecognized flag: ${raw}`);
    } else if (!args.id) {
      args.id = raw;
    } else {
      throw new Error(`Unexpected argument: ${raw}`);
    }
  }
  return args;
}

/**
 * @param {string} internalProductId
 * @param {string} newName
 * @param {Object} [deps] injectable for tests
 */
async function renameProduct(internalProductId, newName, deps = {}) {
  const lookupProduct = deps.getProduct || getProduct;
  const upsert = deps.upsert || upsertProduct;

  if (!newName || !newName.trim()) {
    throw new Error('--name must be a non-empty string');
  }

  const product = await lookupProduct(internalProductId);
  if (!product) {
    throw new Error(`No catalog entry found for "${internalProductId}"`);
  }

  const oldName = product.name || null;
  await upsert(internalProductId, { name: newName });
  return { internalProductId, oldName, newName };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[rename-product] ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (!args.id || !args.name) {
    console.error('Usage: node scripts/rename-product.js <internalProductId> --name="New Name"');
    process.exitCode = 1;
    return;
  }

  try {
    const result = await renameProduct(args.id, args.name);
    console.log(`[rename-product] ${result.internalProductId}: "${result.oldName}" -> "${result.newName}"`);
  } catch (err) {
    console.error(`[rename-product] ${err.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { renameProduct, parseArgs };

#!/usr/bin/env node
// Manually sets (replaces) a `self`-fulfilled SKU's Redis stock counter —
// e.g. seeding a presale's hard cap before activating it. Thin CLI wrapper
// around lib/inventory.js's setInventory; the counter itself is a simple
// DECRBY target (see docs/shop-architecture.md's "known v1 limitations"),
// not a reservation system.
//
// Usage:
//   node scripts/set-inventory.js <sku> <count>
//
// Needs real Redis credentials set — see docs/shop-testing.md.

const { setInventory, getInventory } = require('../lib/inventory');

function parseArgs(argv) {
  if (argv.length !== 2) {
    throw new Error('Usage: node scripts/set-inventory.js <sku> <count>');
  }
  const [sku, countRaw] = argv;
  const count = Number(countRaw);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`<count> must be a non-negative integer, got "${countRaw}"`);
  }
  return { sku, count };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[set-inventory] ${err.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const before = await getInventory(args.sku);
    await setInventory(args.sku, args.count);
    console.log(`[set-inventory] ${args.sku}: ${before == null ? '(unset)' : before} -> ${args.count}`);
  } catch (err) {
    console.error(`[set-inventory] ${err.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs };

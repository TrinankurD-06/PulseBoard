// Upgrade U1: monitor types and cost fields.
//
// Existing monitors become `http` monitors with no price and the default
// currency. Only fields that are MISSING are set ($exists: false), so running it
// again changes nothing, and method, interval, status and counters are never
// touched: existing monitors keep behaving exactly as before.
export const name = '001-monitor-types-and-cost';

const DEFAULTS = {
  type: 'http',
  headUnsupported: false,
  costPer1kRequests: null,
  currency: 'INR',
};

export async function up(db) {
  const monitors = db.collection('monitors');
  let modified = 0;
  for (const [field, value] of Object.entries(DEFAULTS)) {
    const result = await monitors.updateMany(
      { [field]: { $exists: false } },
      { $set: { [field]: value } },
    );
    modified += result.modifiedCount;
  }
  return { modified };
}

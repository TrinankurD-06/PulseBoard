// Upgrade U2: adaptive intervals and monthly request budgets.
//
// Existing monitors keep their exact behaviour: adaptive OFF, the job keeps
// using their interval, no budget. Bounds are set so they always contain the
// existing interval. Only fields that are MISSING are set, so running this
// again changes nothing.
export const name = '002-adaptive-and-budget';

const missing = (field) => ({ [field]: { $exists: false } });

export async function up(db) {
  const monitors = db.collection('monitors');
  const updates = [
    [missing('adaptive'), { $set: { adaptive: false } }],
    // Pipeline updates: the value depends on the document's own intervalSec.
    [missing('currentIntervalSec'), [{ $set: { currentIntervalSec: '$intervalSec' } }]],
    [missing('minIntervalSec'), [{ $set: { minIntervalSec: { $min: [30, '$intervalSec'] } } }]],
    [missing('maxIntervalSec'), [{ $set: { maxIntervalSec: { $max: [600, '$intervalSec'] } } }]],
    [missing('responseEwmaMs'), { $set: { responseEwmaMs: null, responseEwmaAt: null } }],
    [missing('monthlyRequestBudget'), { $set: { monthlyRequestBudget: null } }],
    [missing('budgetAction'), { $set: { budgetAction: 'slow' } }],
    [missing('budgetExceededMonth'), { $set: { budgetExceededMonth: null } }],
    [missing('pausedReason'), [{ $set: { pausedReason: { $cond: ['$isPaused', 'user', null] } } }]],
  ];

  let modified = 0;
  for (const [filter, update] of updates) {
    const result = await monitors.updateMany(filter, update);
    modified += result.modifiedCount;
  }
  return { modified };
}

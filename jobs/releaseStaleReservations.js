const CronJob = require('cron').CronJob;
const BudgetCode = require('../models/BudgetCode');

/**
 * Scheduled job to release stale budget reservations
 * Runs daily at 2 AM
 */
const releaseStaleReservationsJob = new CronJob(
  '0 2 * * *', // Every day at 2 AM
  async function() {
    console.log('\n🧹 Running stale reservation cleanup job...');
    
    try {
      const activeBudgetCodes = await BudgetCode.find({ 
        active: true,
        'allocations': {
          $elemMatch: { status: 'allocated' }
        }
      });

      console.log(`Found ${activeBudgetCodes.length} budget codes with active reservations`);

      let totalReleased = 0;
      let totalAmount = 0;

      for (const budgetCode of activeBudgetCodes) {
        const result = await budgetCode.releaseStaleReservations(30);
        totalReleased += result.releasedCount;
        totalAmount += result.releasedAmount;
      }

      console.log(`✅ Cleanup complete:`);
      console.log(`   Released ${totalReleased} reservation(s)`);
      console.log(`   Total amount: XAF ${totalAmount.toLocaleString()}\n`);

    } catch (error) {
      console.error('❌ Stale reservation cleanup failed:', error);
    }
  },
  null,
  true,
  'Africa/Douala'
);

module.exports = releaseStaleReservationsJob;


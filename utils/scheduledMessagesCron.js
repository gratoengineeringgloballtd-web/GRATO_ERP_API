const cron = require('node-cron');
const Communication = require('../models/Communication');
const { deliverCommunication, recoverStuckCommunications } = require('../services/communicationDeliveryService');

/**
 * Process scheduled communications
 * Runs every 5 minutes
 */
const processScheduledCommunications = async () => {
  try {
    // Free any message left on 'sending' by a crash/restart (60+ min without progress)
    await recoverStuckCommunications().catch((e) => console.error('Recovery check failed:', e.message));

    console.log('=== CHECKING FOR SCHEDULED COMMUNICATIONS ===');
    
    const now = new Date();
    
    // Find communications scheduled to be sent now or in the past
    const scheduledCommunications = await Communication.find({
      status: 'scheduled',
      scheduledFor: { $lte: now }
    }).populate('sender', 'fullName email');

    if (scheduledCommunications.length === 0) {
      console.log('No scheduled communications to send');
      return;
    }

    console.log(`Found ${scheduledCommunications.length} scheduled communications`);

    for (const communication of scheduledCommunications) {
      try {
        console.log(`Processing communication: ${communication._id}`);
        
        // Update status to sending
        communication.status = 'sending';
        await communication.save();

        await deliverCommunication(communication._id);

      } catch (error) {
        console.error(`Error processing communication ${communication._id}:`, error);
        
        // Mark as failed
        try {
          await Communication.findByIdAndUpdate(communication._id, {
            status: 'failed'
          });
        } catch (updateError) {
          console.error('Failed to update communication status:', updateError);
        }
      }
    }

    console.log('=== SCHEDULED COMMUNICATIONS PROCESSING COMPLETE ===');

  } catch (error) {
    console.error('❌ Error in processScheduledCommunications:', error);
  }
};

/**
 * Initialize cron job
 * Runs every 5 minutes: 
 **/
const initializeScheduledMessagesCron = () => {
  // Run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    await processScheduledCommunications();
  });

  console.log('✅ Scheduled messages cron job initialized (runs every 5 minutes)');

  // Run once on startup to catch any missed scheduled messages
  setTimeout(async () => {
    // A restart means any 'sending' message was interrupted: reset them right away
    await recoverStuckCommunications({ onStartup: true }).catch((e) => console.error('Startup recovery failed:', e.message));
    processScheduledCommunications();
  }, 5000); // Wait 5 seconds after server start
};

module.exports = {
  initializeScheduledMessagesCron,
  processScheduledCommunications
};
const cron = require('node-cron');
const Communication = require('../models/Communication');
const { batchSendEmails } = require('../services/communicationEmailService');

/**
 * Process scheduled communications
 * Runs every 5 minutes
 */
const processScheduledCommunications = async () => {
  try {
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

        // Get recipient list
        const recipients = await communication.getRecipientList();

        if (recipients.length === 0) {
          console.error(`No recipients found for communication ${communication._id}`);
          communication.status = 'failed';
          await communication.save();
          continue;
        }

        // Send emails
        if (communication.deliveryMethod.email) {
          const emailResults = await batchSendEmails(communication, recipients);
          
          communication.deliveryStats.emailsSent = emailResults.sent;
          communication.deliveryStats.emailsFailed = emailResults.failed;
        }

        // Create in-app notifications (if enabled)
        if (communication.deliveryMethod.inApp) {
          communication.deliveryStats.inAppDelivered = recipients.length;
        }

        // Update status to sent
        communication.status = 'sent';
        communication.sentAt = new Date();
        communication.deliveryStats.lastUpdated = new Date();
        await communication.save();

        console.log(`✅ Communication ${communication._id} sent successfully to ${recipients.length} recipients`);

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
  setTimeout(() => {
    processScheduledCommunications();
  }, 5000); // Wait 5 seconds after server start
};

module.exports = {
  initializeScheduledMessagesCron,
  processScheduledCommunications
};
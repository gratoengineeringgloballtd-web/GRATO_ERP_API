const ScheduledReport = require('../models/ScheduledReport');
const {
  generateBudgetDashboardReport,
  generateUtilizationReport,
  generateAlertsReport,
  generateExcelReport,
  sendScheduledReportEmail
} = require('./reportGenerationService');
const cron = require('node-cron');

/**
 * Execute a scheduled report
 */
const executeScheduledReport = async (scheduledReport) => {
  try {
    console.log(`\n🔄 Executing scheduled report: ${scheduledReport.name}`);
    console.log(`   Type: ${scheduledReport.reportType}`);
    console.log(`   Format: ${scheduledReport.format}`);

    let reportData;

    // Generate report data based on type
    switch (scheduledReport.reportType) {
      case 'budget_dashboard':
        reportData = await generateBudgetDashboardReport(scheduledReport.filters);
        break;
      case 'budget_utilization':
        reportData = await generateUtilizationReport(scheduledReport.filters);
        break;
      case 'budget_alerts':
        reportData = await generateAlertsReport(scheduledReport.filters);
        break;
      default:
        throw new Error(`Unknown report type: ${scheduledReport.reportType}`);
    }

    // Generate attachments
    const attachments = [];

    if (scheduledReport.format === 'excel' || scheduledReport.format === 'both') {
      const excelBuffer = await generateExcelReport(reportData, scheduledReport.reportType);
      attachments.push({
        filename: `${scheduledReport.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`,
        content: excelBuffer,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
    }

    if (scheduledReport.format === 'pdf' || scheduledReport.format === 'both') {
      // PDF generation would go here
      // For now, we'll skip PDF to keep it simple
      console.log('   PDF generation skipped (Excel only for now)');
    }

    // Send email with attachments
    await sendScheduledReportEmail(scheduledReport, reportData, attachments);

    // Mark as executed
    await scheduledReport.markExecuted(true);

    console.log(`✅ Report executed successfully`);
    console.log(`   Next run: ${scheduledReport.nextRun.toLocaleString()}\n`);

    return {
      success: true,
      reportData,
      nextRun: scheduledReport.nextRun
    };
  } catch (error) {
    console.error(`❌ Error executing scheduled report:`, error);

    // Mark as failed
    await scheduledReport.markExecuted(false, error.message);

    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Process all due reports
 */
const processDueReports = async () => {
  try {
    console.log('\n📅 Checking for due scheduled reports...');

    const dueReports = await ScheduledReport.getDueReports();

    if (dueReports.length === 0) {
      console.log('   No reports due at this time\n');
      return { processed: 0, successful: 0, failed: 0 };
    }

    console.log(`   Found ${dueReports.length} report(s) due for execution`);

    const results = {
      processed: dueReports.length,
      successful: 0,
      failed: 0,
      reports: []
    };

    for (const report of dueReports) {
      const result = await executeScheduledReport(report);
      
      if (result.success) {
        results.successful++;
      } else {
        results.failed++;
      }

      results.reports.push({
        name: report.name,
        success: result.success,
        error: result.error
      });
    }

    console.log(`✅ Processed ${results.processed} report(s): ${results.successful} successful, ${results.failed} failed\n`);

    return results;
  } catch (error) {
    console.error('Error processing due reports:', error);
    throw error;
  }
};

/**
 * Initialize scheduled report cron job
 */
const initializeScheduledReports = () => {
  // Run every hour to check for due reports
  cron.schedule('0 * * * *', async () => {
    console.log('⏰ Scheduled report check triggered');
    try {
      await processDueReports();
    } catch (error) {
      console.error('Error in scheduled report cron:', error);
    }
  });

  console.log('✅ Scheduled report cron initialized (runs hourly)');
};

/**
 * Manually trigger a scheduled report
 */
const triggerReportNow = async (reportId) => {
  try {
    const report = await ScheduledReport.findById(reportId)
      .populate('createdBy', 'fullName email');

    if (!report) {
      throw new Error('Scheduled report not found');
    }

    console.log(`🚀 Manually triggering report: ${report.name}`);

    const result = await executeScheduledReport(report);

    return result;
  } catch (error) {
    console.error('Error triggering report:', error);
    throw error;
  }
};

module.exports = {
  executeScheduledReport,
  processDueReports,
  initializeScheduledReports,
  triggerReportNow
};
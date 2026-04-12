const BudgetCode = require('../models/BudgetCode');
const BudgetTransfer = require('../models/BudgetTransfer');
const { sendEmail } = require('./emailService');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generate Budget Dashboard Report
 */
const generateBudgetDashboardReport = async (filters = {}) => {
  try {
    console.log('📊 Generating Budget Dashboard Report...');

    const query = { active: true };
    if (filters.department) query.department = filters.department;
    if (filters.budgetType) query.budgetType = filters.budgetType;
    if (filters.fiscalYear) query.fiscalYear = filters.fiscalYear;

    const budgetCodes = await BudgetCode.find(query)
      .populate('budgetOwner', 'fullName email department')
      .populate('createdBy', 'fullName email')
      .sort({ utilizationPercentage: -1 });

    // Calculate summary
    const summary = {
      totalBudget: 0,
      totalUsed: 0,
      totalRemaining: 0,
      totalCodes: budgetCodes.length,
      criticalCodes: 0,
      warningCodes: 0,
      healthyCodes: 0,
      overallUtilization: 0
    };

    const alerts = [];

    budgetCodes.forEach(code => {
      summary.totalBudget += code.budget;
      summary.totalUsed += code.used;
      summary.totalRemaining += code.remaining;

      const utilization = code.utilizationPercentage;
      if (utilization >= 90) {
        summary.criticalCodes++;
        alerts.push({
          type: 'critical',
          code: code.code,
          name: code.name,
          utilization,
          remaining: code.remaining
        });
      } else if (utilization >= 75) {
        summary.warningCodes++;
        alerts.push({
          type: 'warning',
          code: code.code,
          name: code.name,
          utilization,
          remaining: code.remaining
        });
      } else {
        summary.healthyCodes++;
      }
    });

    if (summary.totalBudget > 0) {
      summary.overallUtilization = Math.round((summary.totalUsed / summary.totalBudget) * 100);
    }

    console.log('✅ Dashboard report generated successfully');

    return {
      summary,
      budgetCodes,
      alerts,
      generatedAt: new Date()
    };
  } catch (error) {
    console.error('Error generating dashboard report:', error);
    throw error;
  }
};

/**
 * Generate Budget Utilization Report
 */
const generateUtilizationReport = async (filters = {}) => {
  try {
    console.log('📈 Generating Utilization Report...');

    const query = { active: true };
    if (filters.department) query.department = filters.department;
    if (filters.budgetType) query.budgetType = filters.budgetType;
    if (filters.fiscalYear) query.fiscalYear = filters.fiscalYear;

    const budgetCodes = await BudgetCode.find(query);

    const report = {
      period: {
        fiscalYear: filters.fiscalYear || new Date().getFullYear(),
        department: filters.department || 'All',
        budgetType: filters.budgetType || 'All'
      },
      summary: {
        totalBudget: 0,
        totalUsed: 0,
        totalRemaining: 0,
        averageUtilization: 0,
        codesCount: budgetCodes.length
      },
      byDepartment: {},
      byBudgetType: {},
      topUtilizers: [],
      underutilized: []
    };

    budgetCodes.forEach(code => {
      report.summary.totalBudget += code.budget;
      report.summary.totalUsed += code.used;
      report.summary.totalRemaining += code.remaining;

      // By department
      if (!report.byDepartment[code.department]) {
        report.byDepartment[code.department] = {
          budget: 0,
          used: 0,
          remaining: 0,
          count: 0,
          utilization: 0
        };
      }
      const dept = report.byDepartment[code.department];
      dept.budget += code.budget;
      dept.used += code.used;
      dept.remaining += code.remaining;
      dept.count++;

      // By budget type
      if (!report.byBudgetType[code.budgetType]) {
        report.byBudgetType[code.budgetType] = {
          budget: 0,
          used: 0,
          remaining: 0,
          count: 0,
          utilization: 0
        };
      }
      const type = report.byBudgetType[code.budgetType];
      type.budget += code.budget;
      type.used += code.used;
      type.remaining += code.remaining;
      type.count++;

      // Track high utilizers
      if (code.utilizationPercentage >= 80) {
        report.topUtilizers.push({
          code: code.code,
          name: code.name,
          department: code.department,
          utilization: code.utilizationPercentage,
          budget: code.budget,
          used: code.used,
          remaining: code.remaining
        });
      }

      // Track underutilized
      if (code.utilizationPercentage < 40) {
        report.underutilized.push({
          code: code.code,
          name: code.name,
          department: code.department,
          utilization: code.utilizationPercentage,
          budget: code.budget,
          used: code.used,
          remaining: code.remaining
        });
      }
    });

    // Calculate averages
    if (report.summary.totalBudget > 0) {
      report.summary.averageUtilization = Math.round(
        (report.summary.totalUsed / report.summary.totalBudget) * 100
      );
    }

    // Calculate department utilizations
    Object.keys(report.byDepartment).forEach(dept => {
      const data = report.byDepartment[dept];
      if (data.budget > 0) {
        data.utilization = Math.round((data.used / data.budget) * 100);
      }
    });

    // Calculate type utilizations
    Object.keys(report.byBudgetType).forEach(type => {
      const data = report.byBudgetType[type];
      if (data.budget > 0) {
        data.utilization = Math.round((data.used / data.budget) * 100);
      }
    });

    // Sort
    report.topUtilizers.sort((a, b) => b.utilization - a.utilization);
    report.underutilized.sort((a, b) => a.utilization - b.utilization);

    console.log('✅ Utilization report generated successfully');

    return {
      ...report,
      generatedAt: new Date()
    };
  } catch (error) {
    console.error('Error generating utilization report:', error);
    throw error;
  }
};

/**
 * Generate Budget Alerts Report
 */
const generateAlertsReport = async (filters = {}) => {
  try {
    console.log('🚨 Generating Alerts Report...');

    const query = { active: true };
    if (filters.department) query.department = filters.department;

    const budgetCodes = await BudgetCode.find(query)
      .populate('budgetOwner', 'fullName email department');

    const alerts = {
      critical: [],
      warning: [],
      staleReservations: [],
      summary: {
        criticalCount: 0,
        warningCount: 0,
        staleCount: 0,
        totalAlerts: 0
      }
    };

    budgetCodes.forEach(code => {
      const utilization = code.utilizationPercentage;

      // Critical alerts
      if (utilization >= 90) {
        alerts.critical.push({
          code: code.code,
          name: code.name,
          department: code.department,
          utilization,
          remaining: code.remaining,
          owner: code.budgetOwner?.fullName || 'N/A'
        });
        alerts.summary.criticalCount++;
      }
      // Warning alerts
      else if (utilization >= 75) {
        alerts.warning.push({
          code: code.code,
          name: code.name,
          department: code.department,
          utilization,
          remaining: code.remaining,
          owner: code.budgetOwner?.fullName || 'N/A'
        });
        alerts.summary.warningCount++;
      }

      // Check for stale reservations
      const staleReservations = code.allocations.filter(alloc => {
        if (alloc.status !== 'allocated') return false;
        const daysSince = (Date.now() - alloc.allocatedDate) / (1000 * 60 * 60 * 24);
        return daysSince > 30;
      });

      if (staleReservations.length > 0) {
        alerts.staleReservations.push({
          code: code.code,
          name: code.name,
          count: staleReservations.length,
          totalAmount: staleReservations.reduce((sum, r) => sum + r.amount, 0),
          owner: code.budgetOwner?.fullName || 'N/A'
        });
        alerts.summary.staleCount++;
      }
    });

    alerts.summary.totalAlerts = 
      alerts.summary.criticalCount + 
      alerts.summary.warningCount + 
      alerts.summary.staleCount;

    console.log('✅ Alerts report generated successfully');

    return {
      ...alerts,
      generatedAt: new Date()
    };
  } catch (error) {
    console.error('Error generating alerts report:', error);
    throw error;
  }
};

/**
 * Generate Excel Report
 */
const generateExcelReport = async (reportData, reportType) => {
  try {
    console.log('📄 Generating Excel report...');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Budget Management System';
    workbook.created = new Date();

    switch (reportType) {
      case 'budget_dashboard':
        await createDashboardExcel(workbook, reportData);
        break;
      case 'budget_utilization':
        await createUtilizationExcel(workbook, reportData);
        break;
      case 'budget_alerts':
        await createAlertsExcel(workbook, reportData);
        break;
      default:
        throw new Error(`Unknown report type: ${reportType}`);
    }

    // Save to buffer
    const buffer = await workbook.xlsx.writeBuffer();
    console.log('✅ Excel report generated');

    return buffer;
  } catch (error) {
    console.error('Error generating Excel:', error);
    throw error;
  }
};

/**
 * Create Dashboard Excel
 */
const createDashboardExcel = async (workbook, reportData) => {
  // Summary sheet
  const summarySheet = workbook.addWorksheet('Summary');
  
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 20 }
  ];

  summarySheet.addRows([
    { metric: 'Total Budget (XAF)', value: reportData.summary.totalBudget.toLocaleString() },
    { metric: 'Total Used (XAF)', value: reportData.summary.totalUsed.toLocaleString() },
    { metric: 'Total Remaining (XAF)', value: reportData.summary.totalRemaining.toLocaleString() },
    { metric: 'Overall Utilization (%)', value: reportData.summary.overallUtilization },
    { metric: 'Total Budget Codes', value: reportData.summary.totalCodes },
    { metric: 'Critical Codes', value: reportData.summary.criticalCodes },
    { metric: 'Warning Codes', value: reportData.summary.warningCodes },
    { metric: 'Healthy Codes', value: reportData.summary.healthyCodes }
  ]);

  summarySheet.getRow(1).font = { bold: true };

  // Budget Codes sheet
  const codesSheet = workbook.addWorksheet('Budget Codes');
  
  codesSheet.columns = [
    { header: 'Code', key: 'code', width: 15 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Department', key: 'department', width: 15 },
    { header: 'Budget (XAF)', key: 'budget', width: 18 },
    { header: 'Used (XAF)', key: 'used', width: 18 },
    { header: 'Remaining (XAF)', key: 'remaining', width: 18 },
    { header: 'Utilization (%)', key: 'utilization', width: 15 }
  ];

  reportData.budgetCodes.forEach(code => {
    codesSheet.addRow({
      code: code.code,
      name: code.name,
      department: code.department,
      budget: code.budget,
      used: code.used,
      remaining: code.remaining,
      utilization: code.utilizationPercentage
    });
  });

  codesSheet.getRow(1).font = { bold: true };

  // Alerts sheet
  if (reportData.alerts && reportData.alerts.length > 0) {
    const alertsSheet = workbook.addWorksheet('Alerts');
    
    alertsSheet.columns = [
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Utilization (%)', key: 'utilization', width: 15 },
      { header: 'Remaining (XAF)', key: 'remaining', width: 18 }
    ];

    reportData.alerts.forEach(alert => {
      alertsSheet.addRow({
        type: alert.type.toUpperCase(),
        code: alert.code,
        name: alert.name,
        utilization: alert.utilization,
        remaining: alert.remaining
      });
    });

    alertsSheet.getRow(1).font = { bold: true };
  }
};

/**
 * Create Utilization Excel
 */
const createUtilizationExcel = async (workbook, reportData) => {
  // Summary sheet
  const summarySheet = workbook.addWorksheet('Summary');
  
  summarySheet.addRows([
    ['Budget Utilization Report'],
    [`Generated: ${new Date().toLocaleDateString('en-GB')}`],
    [''],
    ['Fiscal Year:', reportData.period.fiscalYear],
    ['Department:', reportData.period.department],
    ['Budget Type:', reportData.period.budgetType],
    [''],
    ['Total Budget (XAF):', reportData.summary.totalBudget.toLocaleString()],
    ['Total Used (XAF):', reportData.summary.totalUsed.toLocaleString()],
    ['Total Remaining (XAF):', reportData.summary.totalRemaining.toLocaleString()],
    ['Average Utilization (%):', reportData.summary.averageUtilization],
    ['Number of Codes:', reportData.summary.codesCount]
  ]);

  // By Department
  const deptSheet = workbook.addWorksheet('By Department');
  deptSheet.columns = [
    { header: 'Department', key: 'department', width: 20 },
    { header: 'Budget (XAF)', key: 'budget', width: 18 },
    { header: 'Used (XAF)', key: 'used', width: 18 },
    { header: 'Remaining (XAF)', key: 'remaining', width: 18 },
    { header: 'Utilization (%)', key: 'utilization', width: 15 },
    { header: 'Count', key: 'count', width: 10 }
  ];

  Object.keys(reportData.byDepartment).forEach(dept => {
    deptSheet.addRow({
      department: dept,
      ...reportData.byDepartment[dept]
    });
  });

  deptSheet.getRow(1).font = { bold: true };

  // By Budget Type
  const typeSheet = workbook.addWorksheet('By Budget Type');
  typeSheet.columns = [
    { header: 'Budget Type', key: 'type', width: 20 },
    { header: 'Budget (XAF)', key: 'budget', width: 18 },
    { header: 'Used (XAF)', key: 'used', width: 18 },
    { header: 'Remaining (XAF)', key: 'remaining', width: 18 },
    { header: 'Utilization (%)', key: 'utilization', width: 15 },
    { header: 'Count', key: 'count', width: 10 }
  ];

  Object.keys(reportData.byBudgetType).forEach(type => {
    typeSheet.addRow({
      type: type,
      ...reportData.byBudgetType[type]
    });
  });

  typeSheet.getRow(1).font = { bold: true };

  // Top Utilizers
  if (reportData.topUtilizers && reportData.topUtilizers.length > 0) {
    const topSheet = workbook.addWorksheet('Top Utilizers');
    topSheet.columns = [
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Department', key: 'department', width: 15 },
      { header: 'Utilization (%)', key: 'utilization', width: 15 }
    ];

    reportData.topUtilizers.forEach(code => {
      topSheet.addRow(code);
    });

    topSheet.getRow(1).font = { bold: true };
  }
};

/**
 * Create Alerts Excel
 */
const createAlertsExcel = async (workbook, reportData) => {
  // Summary sheet
  const summarySheet = workbook.addWorksheet('Summary');
  
  summarySheet.addRows([
    ['Budget Alerts Report'],
    [`Generated: ${new Date().toLocaleDateString('en-GB')}`],
    [''],
    ['Critical Alerts:', reportData.summary.criticalCount],
    ['Warning Alerts:', reportData.summary.warningCount],
    ['Stale Reservations:', reportData.summary.staleCount],
    ['Total Alerts:', reportData.summary.totalAlerts]
  ]);

  // Critical Alerts
  if (reportData.critical.length > 0) {
    const criticalSheet = workbook.addWorksheet('Critical Alerts');
    criticalSheet.columns = [
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Department', key: 'department', width: 15 },
      { header: 'Utilization (%)', key: 'utilization', width: 15 },
      { header: 'Remaining (XAF)', key: 'remaining', width: 18 },
      { header: 'Owner', key: 'owner', width: 20 }
    ];

    reportData.critical.forEach(alert => {
      criticalSheet.addRow(alert);
    });

    criticalSheet.getRow(1).font = { bold: true, color: { argb: 'FFFF0000' } };
  }

  // Warning Alerts
  if (reportData.warning.length > 0) {
    const warningSheet = workbook.addWorksheet('Warning Alerts');
    warningSheet.columns = [
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Department', key: 'department', width: 15 },
      { header: 'Utilization (%)', key: 'utilization', width: 15 },
      { header: 'Remaining (XAF)', key: 'remaining', width: 18 },
      { header: 'Owner', key: 'owner', width: 20 }
    ];

    reportData.warning.forEach(alert => {
      warningSheet.addRow(alert);
    });

    warningSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFA500' } };
  }

  // Stale Reservations
  if (reportData.staleReservations.length > 0) {
    const staleSheet = workbook.addWorksheet('Stale Reservations');
    staleSheet.columns = [
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Count', key: 'count', width: 10 },
      { header: 'Total Amount (XAF)', key: 'totalAmount', width: 18 },
      { header: 'Owner', key: 'owner', width: 20 }
    ];

    reportData.staleReservations.forEach(alert => {
      staleSheet.addRow(alert);
    });

    staleSheet.getRow(1).font = { bold: true };
  }
};

/**
 * Send scheduled report email
 */
const sendScheduledReportEmail = async (scheduledReport, reportData, attachments) => {
  try {
    console.log(`📧 Sending scheduled report: ${scheduledReport.name}`);

    const recipients = scheduledReport.recipients.map(r => r.email);

    // Build email HTML
    let html = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
        <div style="background-color: #1890ff; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">Scheduled Budget Report</h1>
        </div>
        
        <div style="padding: 30px; background-color: #f5f5f5;">
          <h2 style="color: #1890ff;">${scheduledReport.name}</h2>
          <p style="color: #666;">${scheduledReport.description || ''}</p>
          
          <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #333;">Report Summary</h3>
    `;

    // Add report-specific summary
    switch (scheduledReport.reportType) {
      case 'budget_dashboard':
        html += `
            <table style="width: 100%; border-collapse: collapse;">
              <tr style="border-bottom: 1px solid #e8e8e8;">
                <td style="padding: 10px;"><strong>Total Budget:</strong></td>
                <td style="padding: 10px; text-align: right;">XAF ${reportData.summary.totalBudget.toLocaleString()}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e8e8e8;">
                <td style="padding: 10px;"><strong>Total Used:</strong></td>
                <td style="padding: 10px; text-align: right;">XAF ${reportData.summary.totalUsed.toLocaleString()}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e8e8e8;">
                <td style="padding: 10px;"><strong>Total Remaining:</strong></td>
                <td style="padding: 10px; text-align: right;">XAF ${reportData.summary.totalRemaining.toLocaleString()}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e8e8e8;">
                <td style="padding: 10px;"><strong>Overall Utilization:</strong></td>
                <td style="padding: 10px; text-align: right; color: ${reportData.summary.overallUtilization >= 90 ? '#f5222d' : reportData.summary.overallUtilization >= 75 ? '#faad14' : '#52c41a'};">
                  <strong>${reportData.summary.overallUtilization}%</strong>
                </td>
              </tr>
              <tr>
                <td style="padding: 10px;"><strong>Total Budget Codes:</strong></td>
                <td style="padding: 10px; text-align: right;">${reportData.summary.totalCodes}</td>
              </tr>
            </table>
            
            ${reportData.alerts && reportData.alerts.length > 0 ? `
            <div style="margin-top: 20px; padding: 15px; background-color: #fff7e6; border-left: 4px solid #faad14;">
              <h4 style="margin: 0 0 10px 0; color: #faad14;">⚠️ Alerts</h4>
              <p style="margin: 0;"><strong>${reportData.alerts.length}</strong> budget code(s) require attention</p>
            </div>
            ` : ''}
        `;
        break;

      case 'budget_utilization':
        html += `
            <table style="width: 100%; border-collapse: collapse;">
              <tr style="border-bottom: 1px solid #e8e8e8;">
                <td style="padding: 10px;"><strong>Fiscal Year:</strong></td>
                <td style="padding: 10px; text-align: right;">${reportData.period.fiscalYear}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e8e8e8;">
                <td style="padding: 10px;"><strong>Department:</strong></td>
                <td style="padding: 10px; text-align: right;">${reportData.period.department}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e8e8e8;">
                <td style="padding: 10px;"><strong>Average Utilization:</strong></td>
                <td style="padding: 10px; text-align: right;"><strong>${reportData.summary.averageUtilization}%</strong></td>
              </tr>
              <tr>
                <td style="padding: 10px;"><strong>Budget Codes:</strong></td>
                <td style="padding: 10px; text-align: right;">${reportData.summary.codesCount}</td>
              </tr>
            </table>
        `;
        break;

      case 'budget_alerts':
        html += `
            <table style="width: 100%; border-collapse: collapse;">
              <tr style="border-bottom: 1px solid #e8e8e8;">
                <td style="padding: 10px;"><strong>Critical Alerts:</strong></td>
                <td style="padding: 10px; text-align: right; color: #f5222d;"><strong>${reportData.summary.criticalCount}</strong></td>
              </tr>
              <tr style="border-bottom: 1px solid #e8e8e8;">
                <td style="padding: 10px;"><strong>Warning Alerts:</strong></td>
                <td style="padding: 10px; text-align: right; color: #faad14;"><strong>${reportData.summary.warningCount}</strong></td>
              </tr>
              <tr style="border-bottom: 1px solid #e8e8e8;">
                <td style="padding: 10px;"><strong>Stale Reservations:</strong></td>
                <td style="padding: 10px; text-align: right;">${reportData.summary.staleCount}</td>
              </tr>
              <tr>
                <td style="padding: 10px;"><strong>Total Alerts:</strong></td>
                <td style="padding: 10px; text-align: right;"><strong>${reportData.summary.totalAlerts}</strong></td>
              </tr>
            </table>
            
            ${reportData.critical.length > 0 ? `
            <div style="margin-top: 20px; padding: 15px; background-color: #fff2f0; border-left: 4px solid #f5222d;">
              <h4 style="margin: 0 0 10px 0; color: #f5222d;">🚨 Critical Budget Codes</h4>
              <ul style="margin: 0; padding-left: 20px;">
                ${reportData.critical.slice(0, 5).map(alert => `
                  <li><strong>${alert.code}</strong>: ${alert.utilization}% utilized (XAF ${alert.remaining.toLocaleString()} remaining)</li>
                `).join('')}
              </ul>
              ${reportData.critical.length > 5 ? `<p style="margin: 10px 0 0 0; color: #666;"><em>...and ${reportData.critical.length - 5} more</em></p>` : ''}
            </div>
            ` : ''}
        `;
        break;
    }

    html += `
          </div>
          
          <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #333;">Report Details</h3>
            <p style="color: #666;">
              <strong>Report Type:</strong> ${scheduledReport.reportType.replace(/_/g, ' ').toUpperCase()}<br>
              <strong>Frequency:</strong> ${scheduledReport.frequency.charAt(0).toUpperCase() + scheduledReport.frequency.slice(1)}<br>
              <strong>Generated:</strong> ${new Date().toLocaleDateString('en-GB')} at ${new Date().toLocaleTimeString('en-GB')}<br>
              <strong>Next Run:</strong> ${new Date(scheduledReport.nextRun).toLocaleDateString('en-GB')}
            </p>
          </div>

          <div style="background-color: #e6f7ff; padding: 15px; border-radius: 8px; border-left: 4px solid #1890ff; margin: 20px 0;">
            <p style="margin: 0; color: #666;">
              📎 Detailed reports are attached to this email in ${scheduledReport.format === 'both' ? 'Excel and PDF' : scheduledReport.format.toUpperCase()} format.
            </p>
          </div>

          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e8e8e8;">
            <p style="color: #999; font-size: 12px;">
              This is an automated scheduled report from the Budget Management System.<br>
              To manage your scheduled reports, visit the Budget Management Dashboard.
            </p>
          </div>
        </div>
      </div>
    `;

    // Send email with attachments
    await sendEmail({
      to: recipients,
      subject: `${scheduledReport.name} - ${new Date().toLocaleDateString('en-GB')}`,
      html,
      attachments
    });

    console.log('✅ Scheduled report email sent successfully');
    return true;
  } catch (error) {
    console.error('Error sending scheduled report email:', error);
    throw error;
  }
};

module.exports = {
  generateBudgetDashboardReport,
  generateUtilizationReport,
  generateAlertsReport,
  generateExcelReport,
  sendScheduledReportEmail
};
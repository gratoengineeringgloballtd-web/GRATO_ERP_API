const BudgetCode = require('../models/BudgetCode');
const BudgetTransfer = require('../models/BudgetTransfer');
const PurchaseRequisition = require('../models/PurchaseRequisition');
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
/**
 * Generate Purchase Requisition Summary Report
 * Overall counts, status breakdown, and per-department/category rollups.
 */
const generateRequisitionSummaryReport = async (filters = {}) => {
  try {
    console.log('📊 Generating Purchase Requisition Summary Report...');

    const query = {};
    if (filters.department) query.department = filters.department;
    if (filters.itemCategory) query.itemCategory = filters.itemCategory;
    if (filters.status) query.status = filters.status;
    if (filters.dateRange?.start || filters.dateRange?.end) {
      query.createdAt = {};
      if (filters.dateRange.start) query.createdAt.$gte = new Date(filters.dateRange.start);
      if (filters.dateRange.end) query.createdAt.$lte = new Date(filters.dateRange.end);
    }

    const requisitions = await PurchaseRequisition.find(query)
      .populate('employee', 'fullName email department')
      .populate('budgetCode', 'code name')
      .sort({ createdAt: -1 });

    const REJECTED = ['rejected', 'supply_chain_rejected'];
    const APPROVED = ['approved', 'partially_disbursed', 'fully_disbursed', 'completed'];
    const PENDING = [
      'pending_supervisor', 'pending_finance_verification', 'pending_supply_chain_review',
      'pending_buyer_assignment', 'pending_head_approval', 'pending_ceo_approval', 'pending_ceo'
    ];

    const summary = {
      totalRequisitions: requisitions.length,
      totalValue: 0,
      approvedCount: 0,
      approvedValue: 0,
      rejectedCount: 0,
      pendingCount: 0,
      byDepartment: {},
      byCategory: {}
    };

    requisitions.forEach(r => {
      const value = r.budgetXAF || 0;
      summary.totalValue += value;

      if (APPROVED.includes(r.status)) { summary.approvedCount++; summary.approvedValue += value; }
      else if (REJECTED.includes(r.status)) { summary.rejectedCount++; }
      else if (PENDING.includes(r.status)) { summary.pendingCount++; }

      const dept = r.department || 'Unassigned';
      summary.byDepartment[dept] = summary.byDepartment[dept] || { count: 0, value: 0 };
      summary.byDepartment[dept].count++;
      summary.byDepartment[dept].value += value;

      const cat = r.itemCategory || 'Other';
      summary.byCategory[cat] = summary.byCategory[cat] || { count: 0, value: 0 };
      summary.byCategory[cat].count++;
      summary.byCategory[cat].value += value;
    });

    summary.approvalRate = summary.totalRequisitions > 0
      ? Math.round((summary.approvedCount / summary.totalRequisitions) * 100)
      : 0;

    console.log('✅ Requisition summary report generated successfully');

    return { summary, requisitions, generatedAt: new Date() };
  } catch (error) {
    console.error('Error generating requisition summary report:', error);
    throw error;
  }
};

/**
 * Generate Purchase Requisition Spend Report
 * Tracks approved value vs. actually disbursed value, by budget code.
 */
const generateRequisitionSpendReport = async (filters = {}) => {
  try {
    console.log('📊 Generating Purchase Requisition Spend Report...');

    const query = { status: { $in: ['approved', 'partially_disbursed', 'fully_disbursed', 'completed'] } };
    if (filters.department) query.department = filters.department;
    if (filters.dateRange?.start || filters.dateRange?.end) {
      query.createdAt = {};
      if (filters.dateRange.start) query.createdAt.$gte = new Date(filters.dateRange.start);
      if (filters.dateRange.end) query.createdAt.$lte = new Date(filters.dateRange.end);
    }

    const requisitions = await PurchaseRequisition.find(query)
      .populate('budgetCode', 'code name department')
      .populate('employee', 'fullName department')
      .sort({ createdAt: -1 });

    const byBudgetCode = {};
    let totalApproved = 0;
    let totalDisbursed = 0;

    requisitions.forEach(r => {
      const approved = r.budgetXAF || 0;
      const disbursed = r.totalDisbursed || 0;
      totalApproved += approved;
      totalDisbursed += disbursed;

      const key = r.budgetCode?.code || 'Unassigned';
      if (!byBudgetCode[key]) {
        byBudgetCode[key] = { code: key, name: r.budgetCode?.name || '', approved: 0, disbursed: 0, count: 0 };
      }
      byBudgetCode[key].approved += approved;
      byBudgetCode[key].disbursed += disbursed;
      byBudgetCode[key].count++;
    });

    const summary = {
      totalRequisitions: requisitions.length,
      totalApproved,
      totalDisbursed,
      totalOutstanding: totalApproved - totalDisbursed,
      disbursementRate: totalApproved > 0 ? Math.round((totalDisbursed / totalApproved) * 100) : 0
    };

    console.log('✅ Requisition spend report generated successfully');

    return { summary, byBudgetCode: Object.values(byBudgetCode), requisitions, generatedAt: new Date() };
  } catch (error) {
    console.error('Error generating requisition spend report:', error);
    throw error;
  }
};

/**
 * Generate Purchase Requisition Pending Approvals Report
 * A digest of everything currently stuck in the approval chain, with aging, so
 * bottlenecks (e.g. a specific approver sitting on requests) are visible.
 */
const generateRequisitionPendingApprovalsReport = async (filters = {}) => {
  try {
    console.log('📊 Generating Purchase Requisition Pending Approvals Report...');

    const PENDING_STATUSES = [
      'pending_supervisor', 'pending_finance_verification', 'pending_supply_chain_review',
      'pending_buyer_assignment', 'pending_head_approval', 'pending_ceo_approval', 'pending_ceo',
      'justification_pending_supervisor', 'justification_pending_finance',
      'justification_pending_supply_chain', 'justification_pending_head', 'justification_pending_ceo'
    ];

    const query = { status: { $in: PENDING_STATUSES } };
    if (filters.department) query.department = filters.department;

    const requisitions = await PurchaseRequisition.find(query)
      .populate('employee', 'fullName email department')
      .sort({ createdAt: 1 });

    const now = Date.now();
    const items = requisitions.map(r => {
      const currentStep = r.approvalChain?.find(s => s.status === 'pending');
      const daysPending = Math.floor((now - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24));
      return {
        requisitionNumber: r.requisitionNumber,
        title: r.title,
        employee: r.employee?.fullName || 'N/A',
        department: r.department,
        status: r.status,
        budgetXAF: r.budgetXAF || 0,
        pendingWith: currentStep?.approver?.name || 'N/A',
        pendingWithEmail: currentStep?.approver?.email || '',
        daysPending
      };
    });

    const summary = {
      totalPending: items.length,
      totalValuePending: items.reduce((sum, i) => sum + i.budgetXAF, 0),
      over7Days: items.filter(i => i.daysPending > 7).length,
      over14Days: items.filter(i => i.daysPending > 14).length,
      avgDaysPending: items.length > 0
        ? Math.round(items.reduce((sum, i) => sum + i.daysPending, 0) / items.length)
        : 0
    };

    console.log('✅ Requisition pending approvals report generated successfully');

    return { summary, items, generatedAt: new Date() };
  } catch (error) {
    console.error('Error generating requisition pending approvals report:', error);
    throw error;
  }
};

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
      case 'requisition_summary':
        await createRequisitionSummaryExcel(workbook, reportData);
        break;
      case 'requisition_spend':
        await createRequisitionSpendExcel(workbook, reportData);
        break;
      case 'requisition_pending_approvals':
        await createRequisitionPendingApprovalsExcel(workbook, reportData);
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

/**
 * Create Requisition Summary Excel
 */
const createRequisitionSummaryExcel = async (workbook, reportData) => {
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 20 }
  ];
  summarySheet.addRows([
    { metric: 'Total Requisitions', value: reportData.summary.totalRequisitions },
    { metric: 'Total Value (XAF)', value: reportData.summary.totalValue.toLocaleString() },
    { metric: 'Approved Count', value: reportData.summary.approvedCount },
    { metric: 'Approved Value (XAF)', value: reportData.summary.approvedValue.toLocaleString() },
    { metric: 'Rejected Count', value: reportData.summary.rejectedCount },
    { metric: 'Pending Count', value: reportData.summary.pendingCount },
    { metric: 'Approval Rate (%)', value: reportData.summary.approvalRate }
  ]);
  summarySheet.getRow(1).font = { bold: true };

  const deptSheet = workbook.addWorksheet('By Department');
  deptSheet.columns = [
    { header: 'Department', key: 'department', width: 30 },
    { header: 'Count', key: 'count', width: 12 },
    { header: 'Value (XAF)', key: 'value', width: 18 }
  ];
  Object.entries(reportData.summary.byDepartment).forEach(([department, data]) => {
    deptSheet.addRow({ department, count: data.count, value: data.value });
  });
  deptSheet.getRow(1).font = { bold: true };

  const categorySheet = workbook.addWorksheet('By Category');
  categorySheet.columns = [
    { header: 'Category', key: 'category', width: 25 },
    { header: 'Count', key: 'count', width: 12 },
    { header: 'Value (XAF)', key: 'value', width: 18 }
  ];
  Object.entries(reportData.summary.byCategory).forEach(([category, data]) => {
    categorySheet.addRow({ category, count: data.count, value: data.value });
  });
  categorySheet.getRow(1).font = { bold: true };

  const listSheet = workbook.addWorksheet('Requisitions');
  listSheet.columns = [
    { header: 'Requisition #', key: 'number', width: 18 },
    { header: 'Title', key: 'title', width: 30 },
    { header: 'Employee', key: 'employee', width: 22 },
    { header: 'Department', key: 'department', width: 20 },
    { header: 'Status', key: 'status', width: 22 },
    { header: 'Budget (XAF)', key: 'budget', width: 16 },
    { header: 'Created', key: 'created', width: 14 }
  ];
  reportData.requisitions.forEach(r => {
    listSheet.addRow({
      number: r.requisitionNumber,
      title: r.title,
      employee: r.employee?.fullName || 'N/A',
      department: r.department,
      status: r.status,
      budget: r.budgetXAF || 0,
      created: new Date(r.createdAt).toLocaleDateString('en-GB')
    });
  });
  listSheet.getRow(1).font = { bold: true };
};

/**
 * Create Requisition Spend Excel
 */
const createRequisitionSpendExcel = async (workbook, reportData) => {
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 20 }
  ];
  summarySheet.addRows([
    { metric: 'Total Requisitions', value: reportData.summary.totalRequisitions },
    { metric: 'Total Approved (XAF)', value: reportData.summary.totalApproved.toLocaleString() },
    { metric: 'Total Disbursed (XAF)', value: reportData.summary.totalDisbursed.toLocaleString() },
    { metric: 'Total Outstanding (XAF)', value: reportData.summary.totalOutstanding.toLocaleString() },
    { metric: 'Disbursement Rate (%)', value: reportData.summary.disbursementRate }
  ]);
  summarySheet.getRow(1).font = { bold: true };

  const codeSheet = workbook.addWorksheet('By Budget Code');
  codeSheet.columns = [
    { header: 'Code', key: 'code', width: 15 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Requisitions', key: 'count', width: 14 },
    { header: 'Approved (XAF)', key: 'approved', width: 18 },
    { header: 'Disbursed (XAF)', key: 'disbursed', width: 18 }
  ];
  reportData.byBudgetCode.forEach(c => {
    codeSheet.addRow({ code: c.code, name: c.name, count: c.count, approved: c.approved, disbursed: c.disbursed });
  });
  codeSheet.getRow(1).font = { bold: true };
};

/**
 * Create Requisition Pending Approvals Excel
 */
const createRequisitionPendingApprovalsExcel = async (workbook, reportData) => {
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 20 }
  ];
  summarySheet.addRows([
    { metric: 'Total Pending', value: reportData.summary.totalPending },
    { metric: 'Total Value Pending (XAF)', value: reportData.summary.totalValuePending.toLocaleString() },
    { metric: 'Pending Over 7 Days', value: reportData.summary.over7Days },
    { metric: 'Pending Over 14 Days', value: reportData.summary.over14Days },
    { metric: 'Average Days Pending', value: reportData.summary.avgDaysPending }
  ]);
  summarySheet.getRow(1).font = { bold: true };

  const itemsSheet = workbook.addWorksheet('Pending Items');
  itemsSheet.columns = [
    { header: 'Requisition #', key: 'number', width: 18 },
    { header: 'Title', key: 'title', width: 30 },
    { header: 'Employee', key: 'employee', width: 22 },
    { header: 'Department', key: 'department', width: 20 },
    { header: 'Status', key: 'status', width: 22 },
    { header: 'Budget (XAF)', key: 'budget', width: 16 },
    { header: 'Pending With', key: 'pendingWith', width: 22 },
    { header: 'Days Pending', key: 'daysPending', width: 14 }
  ];
  reportData.items.forEach(i => {
    const row = itemsSheet.addRow({
      number: i.requisitionNumber,
      title: i.title,
      employee: i.employee,
      department: i.department,
      status: i.status,
      budget: i.budgetXAF,
      pendingWith: i.pendingWith,
      daysPending: i.daysPending
    });
    if (i.daysPending > 14) row.getCell('daysPending').font = { color: { argb: 'FFCC0000' }, bold: true };
  });
  itemsSheet.getRow(1).font = { bold: true };
};

module.exports = {
  generateBudgetDashboardReport,
  generateUtilizationReport,
  generateAlertsReport,
  generateRequisitionSummaryReport,
  generateRequisitionSpendReport,
  generateRequisitionPendingApprovalsReport,
  generateExcelReport,
  sendScheduledReportEmail
};
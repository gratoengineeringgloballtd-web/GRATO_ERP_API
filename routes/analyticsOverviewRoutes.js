/**
 * routes/analyticsOverviewRoutes.js
 * MOUNT: app.use('/api/analytics-overview', require('./routes/analyticsOverviewRoutes'));
 *
 * Company-wide figures for the Analytics page. The per-module dashboard-stats
 * endpoints are scoped to the *caller* (e.g. "requests waiting on me"), which
 * made the Analytics page show zeros for most roles. This endpoint returns
 * organisation-wide aggregate counts only (no records), and each section is
 * computed independently so one failure never zeroes the others.
 */
const express = require('express');
const router = express.Router();
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');

router.use(authMiddleware);
router.use(requireRoles('admin', 'ceo', 'it', 'hr', 'finance', 'supply_chain', 'buyer', 'project', 'supervisor'));

const model = (name) => require(`../models/${name}`);

router.get('/', async (req, res) => {
  const role = req.user.role;
  const errors = [];

  const section = async (name, fn, fallback) => {
    try {
      return await fn();
    } catch (e) {
      console.error(`Analytics overview - ${name} failed:`, e.message);
      errors.push(name);
      return fallback;
    }
  };

  const now = new Date();
  const monthStart = now.getMonth() + 1;
  const year = now.getFullYear();
  const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const [hr, cash, invoice, budget, salary, pr, suppliers, perf, incident, it, leave, projects, inventory, assets] =
    await Promise.all([
      section('employees', async () => {
        const User = model('User');
        const base = { role: { $ne: 'supplier' } };
        const [total, active, probation, onLeave, expiring] = await Promise.all([
          User.countDocuments({ ...base, isActive: true }),
          User.countDocuments({ ...base, isActive: true, 'employmentDetails.employmentStatus': 'Active' }),
          User.countDocuments({ ...base, 'employmentDetails.employmentStatus': 'Probation' }),
          User.countDocuments({ ...base, 'employmentDetails.employmentStatus': 'On Leave' }),
          User.countDocuments({ ...base, 'employmentDetails.contractEndDate': { $gte: now, $lte: in30 } })
        ]);
        return { total, active, probation, onLeave, expiring };
      }, { total: 0, active: 0, probation: 0, onLeave: 0, expiring: 0 }),

      section('cash requests', async () => {
        const CashRequest = model('CashRequest');
        const PENDING = ['pending_supervisor', 'pending_departmental_head', 'pending_hr', 'pending_finance', 'pending_head_of_business', 'pending_ceo'];
        const [pending, total] = await Promise.all([
          CashRequest.countDocuments({ status: { $in: PENDING } }),
          CashRequest.countDocuments({})
        ]);
        return { pending, total };
      }, { pending: 0, total: 0 }),

      section('invoices', async () => {
        const Invoice = model('Invoice');
        const [pending, total] = await Promise.all([
          Invoice.countDocuments({ approvalStatus: { $in: ['pending_finance_assignment', 'pending_department_approval', 'pending_finance_review', 'pending_approval'] } }),
          Invoice.countDocuments({})
        ]);
        return { pending, total };
      }, { pending: 0, total: 0 }),

      section('budget codes', async () => {
        const BudgetCode = model('BudgetCode');
        const [pending, total] = await Promise.all([
          BudgetCode.countDocuments({ status: { $nin: ['active', 'rejected'] } }),
          BudgetCode.countDocuments({ status: 'active' })
        ]);
        return { pending, total };
      }, { pending: 0, total: 0 }),

      ['finance', 'admin', 'ceo'].includes(role)
        ? section('salary payments', async () => {
            const SalaryPayment = model('SalaryPayment');
            const [m, y] = await Promise.all([
              SalaryPayment.aggregate([{ $match: { 'paymentPeriod.year': year, 'paymentPeriod.month': monthStart, status: 'processed' } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
              SalaryPayment.aggregate([{ $match: { 'paymentPeriod.year': year, status: 'processed' } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }])
            ]);
            return { currentMonth: m[0]?.total || 0, yearToDate: y[0]?.total || 0 };
          }, { currentMonth: 0, yearToDate: 0 })
        : Promise.resolve({ currentMonth: 0, yearToDate: 0, restricted: true }),

      section('purchase requisitions', async () => {
        const PR = model('PurchaseRequisition');
        const PENDING = ['pending_supervisor', 'pending_finance_verification', 'pending_supply_chain_review', 'pending_buyer_assignment', 'pending_head_approval', 'pending_ceo_approval', 'pending_ceo'];
        const [pending, total] = await Promise.all([
          PR.countDocuments({ status: { $in: PENDING } }),
          PR.countDocuments({ status: { $ne: 'draft' } })
        ]);
        return { pending, total };
      }, { pending: 0, total: 0 }),

      section('suppliers', async () => {
        const User = model('User');
        const [approved, pending, total] = await Promise.all([
          User.countDocuments({ role: 'supplier', 'supplierStatus.accountStatus': 'approved' }),
          User.countDocuments({ role: 'supplier', 'supplierStatus.accountStatus': /^pending/ }),
          User.countDocuments({ role: 'supplier' })
        ]);
        return { approved, pending, total };
      }, { approved: 0, pending: 0, total: 0 }),

      section('supplier performance', async () => {
        const SP = model('SupplierPerformance');
        const rows = await SP.aggregate([
          { $group: { _id: '$supplier', score: { $avg: '$overallScore' } } }
        ]);
        const avg = rows.length ? rows.reduce((a, r) => a + (r.score || 0), 0) / rows.length : 0;
        return { avgScore: Math.round(avg * 10) / 10, topPerformers: rows.filter((r) => r.score >= 90).length };
      }, { avgScore: 0, topPerformers: 0 }),

      section('incident reports', async () => {
        const IncidentReport = model('IncidentReport');
        const [pending, total] = await Promise.all([
          IncidentReport.countDocuments({ status: 'submitted' }),
          IncidentReport.countDocuments({})
        ]);
        return { pending, total };
      }, { pending: 0, total: 0 }),

      section('IT support', async () => {
        const ITSupportRequest = model('ITSupportRequest');
        const PENDING = (ITSupportRequest.STATUS_GROUPS && ITSupportRequest.STATUS_GROUPS.PENDING) || ['pending_it_approval'];
        const [pending, total] = await Promise.all([
          ITSupportRequest.countDocuments({ status: { $in: PENDING } }),
          ITSupportRequest.countDocuments({})
        ]);
        return { pending, total };
      }, { pending: 0, total: 0 }),

      section('leave', async () => {
        const Leave = model('Leave');
        const PENDING = (Leave.STATUS_GROUPS && Leave.STATUS_GROUPS.PENDING) || ['pending_supervisor'];
        const [pending, total] = await Promise.all([
          Leave.countDocuments({ status: { $in: PENDING } }),
          Leave.countDocuments({ status: { $ne: 'draft' } })
        ]);
        return { pending, total };
      }, { pending: 0, total: 0 }),

      section('projects', async () => {
        const Project = model('Project');
        const base = { isActive: true, isDraft: false };
        const [pending, inProgress, completed, total] = await Promise.all([
          Project.countDocuments({ ...base, status: { $in: ['Not Started', 'Planning'] } }),
          Project.countDocuments({ ...base, status: 'In Progress' }),
          Project.countDocuments({ ...base, status: 'Completed' }),
          Project.countDocuments(base)
        ]);
        return { pending, inProgress, completed, total };
      }, { pending: 0, inProgress: 0, completed: 0, total: 0 }),

      section('inventory', async () => {
        const Inventory = model('Inventory');
        const [items, low, out, rows] = await Promise.all([
          Inventory.countDocuments({ isActive: true }),
          Inventory.countDocuments({ isActive: true, $expr: { $lte: ['$stockQuantity', '$reorderPoint'] } }),
          Inventory.countDocuments({ isActive: true, stockQuantity: 0 }),
          Inventory.find({ isActive: true }).select('stockQuantity averageCost standardPrice').lean()
        ]);
        const value = rows.reduce((s, i) => s + (i.stockQuantity || 0) * (i.averageCost || i.standardPrice || 0), 0);
        return { items, low, out, value };
      }, { items: 0, low: 0, out: 0, value: 0 }),

      section('fixed assets', async () => {
        const FixedAsset = model('FixedAsset');
        const [total, inUse, overdue, rows] = await Promise.all([
          FixedAsset.countDocuments({}),
          FixedAsset.countDocuments({ status: 'in-use' }),
          FixedAsset.countDocuments({ nextInspectionDue: { $lt: now }, status: { $nin: ['disposed', 'retired'] } }),
          FixedAsset.find({ status: { $nin: ['disposed', 'retired'] } }).select('acquisitionCost acquisitionDate usefulLifeYears salvageValue').lean()
        ]);
        let current = 0;
        rows.forEach((a) => {
          const years = (Date.now() - new Date(a.acquisitionDate).getTime()) / (365.25 * 86400000);
          const annual = ((a.acquisitionCost || 0) - (a.salvageValue || 0)) / (a.usefulLifeYears || 1);
          const acc = Math.min(annual * years, (a.acquisitionCost || 0) - (a.salvageValue || 0));
          current += Math.max(0, (a.acquisitionCost || 0) - acc);
        });
        return { total, inUse, overdue, value: Math.round(current) };
      }, { total: 0, inUse: 0, overdue: 0, value: 0 })
    ]);

  res.json({
    success: true,
    data: {
      hr,
      finance: {
        cashPending: cash.pending, cashTotal: cash.total,
        invoicePending: invoice.pending, invoiceTotal: invoice.total,
        budgetPending: budget.pending, budgetCodes: budget.total,
        salaryCurrentMonth: salary.currentMonth, salaryYTD: salary.yearToDate,
        salaryRestricted: !!salary.restricted
      },
      procurement: {
        prPending: pr.pending, prTotal: pr.total,
        suppliersApproved: suppliers.approved, suppliersPending: suppliers.pending, suppliersTotal: suppliers.total,
        avgPerfScore: perf.avgScore, topPerformers: perf.topPerformers
      },
      operations: {
        incidentPending: incident.pending, incidentTotal: incident.total,
        itPending: it.pending, itTotal: it.total,
        leavePending: leave.pending, leaveTotal: leave.total,
        projectsPending: projects.pending, projectsProgress: projects.inProgress,
        projectsComplete: projects.completed, projectsTotal: projects.total
      },
      assets: {
        inventoryItems: inventory.items, lowStock: inventory.low, outOfStock: inventory.out, stockValue: inventory.value,
        fixedAssets: assets.total, assetsInUse: assets.inUse, overdueInspections: assets.overdue, assetValue: assets.value
      }
    },
    errors
  });
});

module.exports = router;

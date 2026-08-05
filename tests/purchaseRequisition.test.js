/**
 * Integration tests for the Purchase Requisition approval + budget workflow.
 *
 * These tests exercise the controller functions directly (rather than going through
 * the full Express app / HTTP layer) so they stay fast and don't depend on app.js's
 * socket/cron/SharePoint bootstrapping. They use mongodb-memory-server so no real
 * database connection is required.
 *
 * Regression coverage for two bugs fixed in this pass:
 *   1. processHeadApproval used to set status = 'pending_ceo_approval', which was not
 *      a valid value in PurchaseRequisition's status enum, so .save() threw a
 *      ValidationError and CEO approval could never complete for high-value requisitions.
 *   2. Budget was never reserved at approval time (only decremented at disbursement,
 *      and even that path was broken), so multiple requisitions could be approved
 *      against the same budget code beyond its real remaining capacity.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('../services/emailService', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true }),
  sendPurchaseRequisitionEmail: new Proxy({}, { get: () => jest.fn().mockResolvedValue({ success: true }) })
}));

const User = require('../models/User');
const BudgetCode = require('../models/BudgetCode');
const PurchaseRequisition = require('../models/PurchaseRequisition');
const Item = require('../models/Item');

const purchaseRequisitionController = require('../controllers/purchaseRequisitionController');

let mongoServer;

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

afterEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({}))
  );
  jest.clearAllMocks();
});

/** Helper: create an employee user, a budget code, and one active item. */
async function seedBaseData({ budget = 1_000_000 } = {}) {
  const employee = await User.create({
    fullName: 'Test Employee',
    email: 'employee.notinorgchart@example.com', // deliberately absent from the hardcoded
    // org-chart config so the approval chain builder falls back to
    // createDefaultRequisitionApprovalChain() — still exercises the real CEO-threshold logic.
    password: 'password123',
    role: 'employee',
    department: 'Technical'
  });

  const budgetCode = await BudgetCode.create({
    code: 'TEST-001',
    name: 'Test Budget',
    department: 'Technical',
    budget,
    used: 0,
    active: true,
    status: 'active',
    fiscalYear: new Date().getFullYear()
  });

  const item = await Item.create({
    code: 'ITM-001',
    description: 'Test Item',
    category: 'Equipment',
    isActive: true
  });

  return { employee, budgetCode, item };
}

describe('Purchase Requisition — CEO approval status transition', () => {
  test('processHeadApproval saves a valid status when a CEO step is required (high value)', async () => {
    const { employee, budgetCode, item } = await seedBaseData();

    const createReq = {
      user: { userId: employee._id.toString() },
      body: {
        requisitionNumber: 'PR-TEST-001',
        title: 'High value equipment',
        itemCategory: 'Equipment',
        budgetXAF: 500000, // above the 100,000 XAF CEO threshold for purchase_requisition
        budgetCode: budgetCode._id.toString(),
        urgency: 'Medium',
        deliveryLocation: 'HQ',
        expectedDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        justificationOfPurchase: 'This is a valid justification of purchase over 20 chars.',
        items: JSON.stringify([{ itemId: item._id.toString(), code: item.code, description: item.description, quantity: 1, estimatedPrice: 500000 }])
      },
      files: []
    };
    const createRes = mockRes();
    await purchaseRequisitionController.createRequisition(createReq, createRes);

    expect(createRes.status).toHaveBeenCalledWith(201);
    const requisition = await PurchaseRequisition.findOne({ requisitionNumber: 'PR-TEST-001' });
    expect(requisition).not.toBeNull();
    expect(requisition.approvalChain.some(s => s.approver.role === 'CEO - Final Authority')).toBe(true);

    // Fast-forward: mark every non-head, non-CEO step approved so only the
    // Head-of-Business step is left pending, mirroring what the real chain would look
    // like once supervisor/finance/supply-chain have all signed off.
    requisition.approvalChain.forEach(step => {
      if (!['Head of Business Development & Supply Chain - Final Approval', 'CEO - Final Authority'].includes(step.approver.role)) {
        step.status = 'approved';
      }
    });
    requisition.status = 'pending_head_approval';
    await requisition.save();

    const hobStep = requisition.approvalChain.find(s => s.approver.role.includes('Head of Business'));

    const hobUser = await User.create({
      fullName: 'Head of Business',
      email: hobStep.approver.email,
      password: 'password123',
      role: 'supply_chain',
      department: 'Business Development & Supply Chain'
    });

    // Requisition needs a payment method + assigned buyer for the approval flow to run cleanly.
    requisition.paymentMethod = 'bank';
    requisition.supplyChainReview = { assignedBuyer: hobUser._id };
    await requisition.save();

    const approveReq = {
      params: { requisitionId: requisition._id.toString() },
      user: { userId: hobUser._id.toString() },
      body: { decision: 'approved', comments: 'Looks good' }
    };
    const approveRes = mockRes();

    // Before the fix, this threw inside processHeadApproval's try/catch and returned 500.
    await purchaseRequisitionController.processHeadApproval(approveReq, approveRes);

    expect(approveRes.status).not.toHaveBeenCalledWith(500);
    expect(approveRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );

    const updated = await PurchaseRequisition.findById(requisition._id);
    expect(updated.status).toBe('pending_ceo_approval');
  });
});

describe('Purchase Requisition — budget reservation on final approval', () => {
  test('final approval reserves budget and blocks over-commitment against the same code', async () => {
    const { employee, budgetCode, item } = await seedBaseData({ budget: 600000 });

    const makeRequisition = async (number, amount) => {
      const createReq = {
        user: { userId: employee._id.toString() },
        body: {
          requisitionNumber: number,
          title: 'Item',
          itemCategory: 'Equipment',
          budgetXAF: amount,
          budgetCode: budgetCode._id.toString(),
          urgency: 'Low',
          deliveryLocation: 'HQ',
          expectedDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          justificationOfPurchase: 'This is a valid justification of purchase over 20 chars.',
          items: JSON.stringify([{ itemId: item._id.toString(), code: item.code, description: item.description, quantity: 1, estimatedPrice: amount }])
        },
        files: []
      };
      const res = mockRes();
      await purchaseRequisitionController.createRequisition(createReq, res);
      return PurchaseRequisition.findOne({ requisitionNumber: number });
    };

    // Two requisitions of 400,000 each against a 600,000 budget code — only one should
    // be able to reach final approval.
    const reqA = await makeRequisition('PR-TEST-A', 400000);
    const reqB = await makeRequisition('PR-TEST-B', 400000);

    const approveToFinal = async (requisition) => {
      requisition.approvalChain.forEach(s => { s.status = 'approved'; });
      requisition.status = 'pending_head_approval';
      requisition.paymentMethod = 'bank';
      requisition.supplyChainReview = { assignedBuyer: employee._id };
      await requisition.save();

      const req = {
        params: { requisitionId: requisition._id.toString() },
        user: { userId: employee._id.toString() },
        body: { decision: 'approved', comments: 'ok' }
      };
      const res = mockRes();
      // Force this employee to be treated as an authorized head approver for the test
      await User.findByIdAndUpdate(employee._id, { role: 'admin' });
      await purchaseRequisitionController.processHeadApproval(req, res);
      return res;
    };

    const resA = await approveToFinal(reqA);
    expect(resA.status).not.toHaveBeenCalledWith(400);

    const codeAfterA = await BudgetCode.findById(budgetCode._id);
    expect(codeAfterA.allocations.some(a => a.requisitionId.toString() === reqA._id.toString() && a.status === 'allocated')).toBe(true);

    // Second approval should be rejected: only 200,000 of real remaining capacity is left
    // once the first 400,000 is reserved, but reserveBudget() checks against budget-used
    // at the time of the call — this proves the reservation call now fires at all
    // (before the fix, nothing was reserved and both would have gone through silently).
    const resB = await approveToFinal(reqB);
    expect(resB.status).toHaveBeenCalledWith(400);
    expect(resB.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });
});

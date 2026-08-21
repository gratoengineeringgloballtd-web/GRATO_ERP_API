const PurchaseRequisition = require('../models/PurchaseRequisition');
const User = require('../models/User');
const { getApprovalChainForRequisition } = require('../config/requisitionApprovalChain');
const { sendPurchaseRequisitionEmail, sendEmail } = require('../services/emailService');
const fs = require('fs');
const path = require('path');
const { 
  saveFile, 
  deleteFile,
  deleteFiles,
  STORAGE_CATEGORIES 
} = require('../utils/cloudinaryStorage');
const cancellationController = require('../controllers/Cancellationcontroller');
const { getEffectiveApprovalEmails, matchesEffectiveApprover } = require('../utils/delegationHelper');



const generatePettyCashFormPDF = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const user = await User.findById(req.user.userId);

    console.log('=== GENERATE PETTY CASH FORM PDF ===');
    console.log('Requisition ID:', requisitionId);
    console.log('Requested by:', user.email);

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('requestedBy', 'fullName email department position')
      .populate('employee', 'fullName email department position')
      .populate('project', 'name code')
      .populate('approvalChain.decidedBy', 'fullName email')
      .populate('items.productId', 'name description')
      .populate('disbursements.disbursedBy', 'fullName email')
      .populate('disbursements.acknowledgedBy', 'fullName email signature');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Purchase requisition not found'
      });
    }

    const requester = requisition.requestedBy || requisition.employee;
    const hasAccess = 
      requester._id.equals(req.user.userId) ||
      requisition.approvalChain.some(step => step.decidedBy?.equals(req.user.userId)) ||
      user.role === 'admin' ||
      user.role === 'finance' ||
      user.role === 'buyer' ||
      user.role === 'supply_chain';

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const pdfData = {
      ...requisition.toObject(),
      employee: requester,
      displayId: requisition.pettyCashForm?.formNumber || `PCF-${requisition._id.toString().slice(-6).toUpperCase()}`,
      items: requisition.items || []
    };

    const PDFService = require('../services/pdfService');
    const pdfResult = await PDFService.generatePettyCashFormPDF(pdfData, null);

    if (!pdfResult.success) {
      throw new Error('PDF generation failed');
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfResult.filename}"`);
    res.send(pdfResult.buffer);

    console.log(`✓ PDF generated and sent: ${pdfResult.filename}`);

  } catch (error) {
    console.error('Generate PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download petty cash form',
      error: error.message
    });
  }
};


const createRequisition = async (req, res) => {
  try {
    console.log('=== CREATE PURCHASE REQUISITION STARTED ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Files received:', req.files?.length || 0);

    const {
      requisitionNumber,
      title,
      itemCategory,
      budgetXAF,
      budgetCode,
      budgetHolder,
      urgency,
      deliveryLocation,
      expectedDate,
      justificationOfPurchase,
      justificationOfPreferredSupplier,
      items,
      project,
      supplierId,
      preferredSupplierName
    } = req.body;

    if (!requisitionNumber) {
      return res.status(400).json({ success: false, message: 'Requisition number is required' });
    }

    const justification = justificationOfPurchase || req.body.justificationOfPurchase;
    if (!justification || justification.length < 20) {
      return res.status(400).json({ success: false, message: 'Justification of purchase must be at least 20 characters long' });
    }

    if (!budgetCode) {
      return res.status(400).json({ success: false, message: 'Budget code selection is required' });
    }

    const employee = await User.findById(req.user.userId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const BudgetCode = require('../models/BudgetCode');
    const selectedBudgetCode = await BudgetCode.findById(budgetCode);

    if (!selectedBudgetCode) {
      return res.status(400).json({ success: false, message: 'Invalid budget code selected' });
    }

    if (!selectedBudgetCode.active || selectedBudgetCode.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Selected budget code is not active' });
    }

    const estimatedCost = budgetXAF ? parseFloat(budgetXAF) : 0;
    const availableBudget = selectedBudgetCode.budget - selectedBudgetCode.used;

    if (estimatedCost > availableBudget) {
      return res.status(400).json({
        success: false,
        message: `Insufficient budget. Available: XAF ${availableBudget.toLocaleString()}, Required: XAF ${estimatedCost.toLocaleString()}`
      });
    }

    let parsedItems;
    try {
      parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
    } catch (error) {
      return res.status(400).json({ success: false, message: 'Invalid items format' });
    }

    if (!parsedItems || !Array.isArray(parsedItems) || parsedItems.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one item must be specified' });
    }

    for (const item of parsedItems) {
      if (!item.itemId) {
        return res.status(400).json({ success: false, message: 'All items must have valid database references (itemId)' });
      }
      try {
        const Item = require('../models/Item');
        const validItem = await Item.findOne({ _id: item.itemId, isActive: true }).select('_id');
        if (!validItem) {
          return res.status(400).json({ success: false, message: `Invalid or inactive items: ${item.itemId}` });
        }
      } catch (itemError) {
        console.error('Item validation error:', itemError);
      }
    }

    const processedItems = parsedItems.map(item => ({
      itemId: item.itemId,
      code: item.code,
      description: item.description,
      category: item.category,
      subcategory: item.subcategory,
      quantity: parseInt(item.quantity),
      measuringUnit: item.measuringUnit,
      estimatedPrice: parseFloat(item.estimatedPrice) || 0,
      projectName: item.projectName || ''
    }));

    // const approvalChain = getApprovalChainForRequisition(employee.email);
    const approvalChain = getApprovalChainForRequisition(employee.email, estimatedCost);
    if (!approvalChain || approvalChain.length === 0) {
      return res.status(400).json({ success: false, message: 'Unable to determine approval chain. Please contact HR for assistance.' });
    }

    let attachments = [];
    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        try {
          const fileMetadata = await saveFile(file, STORAGE_CATEGORIES.PURCHASE_REQUISITIONS, 'attachments', null);
          attachments.push({
            name: file.originalname,
            publicId: fileMetadata.publicId,
            url: fileMetadata.url,
            localPath: fileMetadata.localPath,
            size: file.size,
            mimetype: file.mimetype,
            uploadedAt: new Date()
          });
        } catch (fileError) {
          console.error(`Error processing ${file.originalname}:`, fileError);
          continue;
        }
      }
    }

    let preferredSupplier = '';
    if (supplierId) {
      const supplier = await User.findById(supplierId);
      if (supplier) preferredSupplier = supplier.supplierDetails?.companyName || supplier.fullName;
    } else if (preferredSupplierName) {
      preferredSupplier = preferredSupplierName;
    }

    const requisition = new PurchaseRequisition({
      requisitionNumber,
      employee: req.user.userId,
      title,
      department: employee.department,
      itemCategory,
      budgetXAF: estimatedCost,
      budgetCode: selectedBudgetCode._id,
      budgetCodeInfo: {
        code: selectedBudgetCode.code,
        name: selectedBudgetCode.name,
        department: selectedBudgetCode.department,
        availableAtSubmission: availableBudget,
        submittedAmount: estimatedCost
      },
      budgetHolder,
      urgency,
      deliveryLocation,
      expectedDate: new Date(expectedDate),
      justificationOfPurchase: justification,
      justificationOfPreferredSupplier,
      items: processedItems,
      attachments,
      status: 'pending_supervisor',
      approvalChain: approvalChain.map(step => ({
        level: step.level,
        approver: {
          name: step.approver.name,
          email: step.approver.email,
          role: step.approver.role,
          department: step.approver.department
        },
        status: step.status || 'pending',
        assignedDate: step.assignedDate || new Date()
      })),
      project: project || undefined,
      supplierId: supplierId || undefined,
      preferredSupplier: preferredSupplier || undefined
    });

    await requisition.save();

    await requisition.populate('employee', 'fullName email department');
    await requisition.populate('budgetCode', 'code name budget used');
    if (requisition.project) await requisition.populate('project', 'name code');
    if (requisition.supplierId) await requisition.populate('supplierId', 'fullName email supplierDetails');

    const notifications = [];
    const firstApprover = approvalChain[0];

    if (firstApprover && firstApprover.approver.email) {
      try {
        const supervisorNotification = await sendEmail({
          to: firstApprover.approver.email,
          subject: `New Purchase Requisition Requires Your Approval - ${employee.fullName}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1890ff;">New Purchase Requisition for Approval</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td><strong>Requisition Number:</strong></td><td>${requisition.requisitionNumber}</td></tr>
                <tr><td><strong>Employee:</strong></td><td>${employee.fullName}</td></tr>
                <tr><td><strong>Department:</strong></td><td>${employee.department}</td></tr>
                <tr><td><strong>Title:</strong></td><td>${title}</td></tr>
                <tr><td><strong>Budget:</strong></td><td>XAF ${estimatedCost.toLocaleString()}</td></tr>
                <tr><td><strong>Budget Code:</strong></td><td>${selectedBudgetCode.code} - ${selectedBudgetCode.name}</td></tr>
                <tr><td><strong>Items Count:</strong></td><td>${parsedItems.length}</td></tr>
                <tr><td><strong>Urgency:</strong></td><td>${urgency}</td></tr>
              </table>
              <div style="background-color: #f0f8ff; border-left: 4px solid #1890ff; padding: 15px; margin: 20px 0;">
                <h4 style="color: #1890ff;">Justification</h4>
                <p>${justification}</p>
              </div>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/supervisor/purchase-requisitions" 
                   style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
                  Review Requisition
                </a>
              </div>
            </div>
          `
        });
        notifications.push(Promise.resolve(supervisorNotification));
      } catch (error) {
        console.error('Failed to send supervisor notification:', error);
        notifications.push(Promise.resolve({ error, type: 'supervisor' }));
      }
    }

    const notificationResults = await Promise.allSettled(notifications);
    const notificationStats = {
      sent: notificationResults.filter(r => r.status === 'fulfilled' && !r.value?.error).length,
      failed: notificationResults.filter(r => r.status === 'rejected' || r.value?.error).length
    };

    res.status(201).json({
      success: true,
      message: 'Purchase requisition created successfully and sent for approval',
      data: requisition,
      metadata: {
        attachmentsUploaded: attachments.length,
        itemsCount: parsedItems.length,
        approvalLevels: approvalChain.length,
        budgetCode: {
          code: selectedBudgetCode.code,
          name: selectedBudgetCode.name,
          availableAtSubmission: availableBudget,
          allocatedAmount: estimatedCost,
          remainingAfter: availableBudget - estimatedCost
        }
      },
      notifications: notificationStats
    });

  } catch (error) {
    console.error('Create purchase requisition error:', error);
    if (req.files && req.files.length > 0) {
      await Promise.allSettled(req.files.map(file => {
        if (file.path && fs.existsSync(file.path)) {
          return fs.promises.unlink(file.path).catch(e => console.error('File cleanup failed:', e));
        }
      }));
    }
    let errorMessage = 'Failed to create purchase requisition';
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      errorMessage = `Validation failed: ${validationErrors.join(', ')}`;
    }
    res.status(500).json({ success: false, message: errorMessage, error: error.message, details: error.name === 'ValidationError' ? error.errors : undefined });
  }
};


/**
 * Get requisitions pending head approval
 * ENHANCED: Supports filtering by status/tab + CEO support
 */
const getPendingHeadApprovals = async (req, res) => {
  try {
    const { status, tab, page = 1, limit = 20 } = req.query;
    console.log('=== GET PENDING HEAD APPROVALS ===');
    const user = await User.findById(req.user.userId);

    // Verify user is authorized (admin, supply_chain head, or CEO)
    const isCEOUser =
      user.role === 'ceo' ||
      user.email === 'tom@gratoengineering.com';

    if (!['admin', 'supply_chain'].includes(user.role) && !isCEOUser) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admin, supply chain head, or CEO can access this.'
      });
    }

    // CEO sees pending_ceo_approval; others see pending_head_approval
    const pendingStatus = isCEOUser
      ? { $in: ['pending_head_approval', 'pending_ceo_approval'] }
      : 'pending_head_approval';

    let query = {};

    switch (tab) {
      case 'pending':
        query.status = pendingStatus;
        break;
      case 'approved':
        query.status = 'approved';
        query['headApproval.decision'] = 'approved';
        break;
      case 'rejected':
        query['headApproval.decision'] = 'rejected';
        break;
      case 'all':
        query.status = { $in: ['pending_head_approval', 'pending_ceo_approval', 'approved', 'rejected'] };
        break;
      default:
        query.status = pendingStatus;
    }

    if (status && !tab) query.status = status;

    const requisitions = await PurchaseRequisition.find(query)
      .populate('employee', 'fullName email department')
      .populate('supplyChainReview.assignedBuyer', 'fullName email')
      .populate('headApproval.decidedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await PurchaseRequisition.countDocuments(query);

    const transformedRequisitions = requisitions.map(req => ({
      id: req._id,
      requisitionNumber: req.requisitionNumber,
      title: req.title,
      requester: req.employee?.fullName || 'Unknown',
      department: req.employee?.department || 'Unknown',
      category: req.itemCategory,
      budgetXAF: req.budgetXAF || req.financeVerification?.assignedBudget,
      urgency: req.urgency,
      status: req.status,
      paymentMethod: req.paymentMethod || 'bank',
      assignedBuyer: req.supplyChainReview?.assignedBuyer ? {
        id: req.supplyChainReview.assignedBuyer._id,
        name: req.supplyChainReview.assignedBuyer.fullName,
        email: req.supplyChainReview.assignedBuyer.email
      } : null,
      buyerAssignmentDate: req.supplyChainReview?.buyerAssignmentDate,
      sourcingType: req.supplyChainReview?.sourcingType,
      submittedDate: req.createdAt,
      expectedDeliveryDate: req.expectedDate,
      items: req.items,
      headApproval: req.headApproval
    }));

    res.json({
      success: true,
      data: transformedRequisitions,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: transformedRequisitions.length,
        totalRecords: total
      }
    });

  } catch (error) {
    console.error('Get pending head approvals error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch requisitions', error: error.message });
  }
};

/**
 * Get head approval statistics
 */
const getHeadApprovalStats = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!['admin', 'supply_chain'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const pending = await PurchaseRequisition.countDocuments({ status: 'pending_head_approval' });
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const approvedToday = await PurchaseRequisition.countDocuments({
      'headApproval.decision': 'approved',
      'headApproval.decisionDate': { $gte: startOfDay }
    });

    const pendingRequisitions = await PurchaseRequisition.find({ status: 'pending_head_approval' });
    const totalPendingValue = pendingRequisitions.reduce((sum, req) => {
      return sum + (req.budgetXAF || req.financeVerification?.assignedBudget || 0);
    }, 0);

    const pettyCashFormsGenerated = await PurchaseRequisition.countDocuments({
      'pettyCashForm.generated': true,
      'pettyCashForm.generatedDate': { $gte: startOfDay }
    });

    res.json({ success: true, data: { pending, approvedToday, totalPendingValue, pettyCashFormsGenerated, generatedAt: new Date() } });

  } catch (error) {
    console.error('Get head approval stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch statistics', error: error.message });
  }
};


/**
 * Get requisition details for head approval
 */
const getRequisitionDetails = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const user = await User.findById(req.user.userId);

    if (!['admin', 'supply_chain'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department phone')
      .populate('supplyChainReview.assignedBuyer', 'fullName email')
      .populate('supplyChainReview.buyerAssignedBy', 'fullName email')
      .populate('financeVerification.verifiedBy', 'fullName email')
      .populate('headApproval.decidedBy', 'fullName email')
      .populate('approvalChain.decidedBy', 'fullName email role');

    if (!requisition) {
      return res.status(404).json({ success: false, message: 'Requisition not found' });
    }

    const details = {
      id: requisition._id,
      requisitionNumber: requisition.requisitionNumber,
      title: requisition.title,
      requester: requisition.employee?.fullName || 'Unknown',
      department: requisition.employee?.department || 'Unknown',
      category: requisition.itemCategory,
      budgetXAF: requisition.budgetXAF || requisition.financeVerification?.assignedBudget,
      urgency: requisition.urgency,
      status: requisition.status,
      paymentMethod: requisition.paymentMethod || 'bank',
      deliveryLocation: requisition.deliveryLocation,
      expectedDeliveryDate: requisition.expectedDate,
      justification: requisition.justificationOfPurchase,
      items: requisition.items.map(item => ({
        id: item._id,
        description: item.description,
        customDescription: item.customDescription || '',
        quantity: item.quantity,
        measuringUnit: item.measuringUnit,
        estimatedPrice: item.estimatedPrice,
        customUnitPrice: typeof item.customUnitPrice === 'number' ? item.customUnitPrice : undefined,
        category: item.category,
        specifications: item.specifications
      })),
      assignedBuyer: requisition.supplyChainReview?.assignedBuyer ? {
        id: requisition.supplyChainReview.assignedBuyer._id,
        name: requisition.supplyChainReview.assignedBuyer.fullName,
        email: requisition.supplyChainReview.assignedBuyer.email
      } : null,
      buyerAssignmentDate: requisition.supplyChainReview?.buyerAssignmentDate,
      sourcingType: requisition.supplyChainReview?.sourcingType,
      approvalChain: requisition.approvalChain.map(step => ({
        level: step.level,
        approver: step.approver,
        status: step.status,
        comments: step.comments,
        actionDate: step.actionDate,
        actionTime: step.actionTime
      })),
      financeVerification: {
        budgetAvailable: requisition.financeVerification?.budgetAvailable,
        assignedBudget: requisition.financeVerification?.assignedBudget,
        budgetCode: requisition.financeVerification?.budgetCode,
        comments: requisition.financeVerification?.comments,
        verifiedBy: requisition.financeVerification?.verifiedBy?.fullName,
        verificationDate: requisition.financeVerification?.verificationDate
      },
      headApproval: requisition.headApproval,
      createdAt: requisition.createdAt
    };

    res.json({ success: true, data: details });

  } catch (error) {
    console.error('Get requisition details error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch requisition details', error: error.message });
  }
};


/**
 * Send petty cash form notification to buyer
 */
const sendPettyCashFormNotificationToBuyer = async (requisition) => {
  try {
    const buyer = requisition.supplyChainReview.assignedBuyer;
    await sendEmail({
      to: buyer.email,
      subject: `Petty Cash Form Ready - ${requisition.title}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #fff7e6; padding: 20px; border-radius: 8px; border-left: 4px solid #faad14;">
            <h2 style="color: #faad14; margin-top: 0;">📄 Petty Cash Form Ready for Download</h2>
            <p>Dear ${buyer.fullName},</p>
            <p>A petty cash form has been generated for your assigned requisition.</p>
            <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
              <h4>Form Details</h4>
              <ul>
                <li><strong>Form Number:</strong> ${requisition.pettyCashForm.formNumber}</li>
                <li><strong>Requisition:</strong> ${requisition.title}</li>
                <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                <li><strong>Requester:</strong> ${requisition.employee.fullName}</li>
                <li><strong>Amount:</strong> XAF ${requisition.budgetXAF.toLocaleString()}</li>
                <li><strong>Generated:</strong> ${new Date().toLocaleString('en-GB')}</li>
              </ul>
            </div>
            <div style="margin: 20px 0; text-align: center;">
              <a href="${process.env.FRONTEND_URL}/buyer/petty-cash" 
                 style="background-color: #faad14; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
                View Petty Cash Forms
              </a>
            </div>
          </div>
        </div>
      `
    });
    console.log('Petty cash form notification sent to buyer:', buyer.email);
  } catch (error) {
    console.error('Error sending buyer notification:', error);
    throw error;
  }
};

/**
 * Send petty cash form notification to employee
 */
const sendPettyCashFormNotificationToEmployee = async (requisition) => {
  try {
    await sendEmail({
      to: requisition.employee.email,
      subject: `Petty Cash Form Generated - ${requisition.title}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #f6ffed; padding: 20px; border-radius: 8px; border-left: 4px solid #52c41a;">
            <h2 style="color: #52c41a; margin-top: 0;">✓ Requisition Approved - Petty Cash Form Generated</h2>
            <p>Dear ${requisition.employee.fullName},</p>
            <p>Your purchase requisition has been approved and a petty cash form has been generated.</p>
            <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
              <h4>Requisition Details</h4>
              <ul>
                <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                <li><strong>Title:</strong> ${requisition.title}</li>
                <li><strong>Amount:</strong> XAF ${requisition.budgetXAF.toLocaleString()}</li>
                <li><strong>Payment Method:</strong> Petty Cash</li>
              </ul>
            </div>
            <p>Best regards,<br>Procurement Team</p>
          </div>
        </div>
      `
    });
    console.log('Petty cash form notification sent to employee:', requisition.employee.email);
  } catch (error) {
    console.error('Error sending employee notification:', error);
    throw error;
  }
};

// Get employee's own requisitions
const getEmployeeRequisitions = async (req, res) => {
  try {
    const requisitions = await PurchaseRequisition.find({ employee: req.user.userId })
      .populate('employee', 'fullName email department')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: requisitions, count: requisitions.length });
  } catch (error) {
    console.error('Get employee requisitions error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch requisitions', error: error.message });
  }
};

// Get single requisition details
const getEmployeeRequisition = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');

    if (!requisition) {
      return res.status(404).json({ success: false, message: 'Requisition not found' });
    }

    const user = await User.findById(req.user.userId);
    const canView = 
      requisition.employee._id.equals(req.user.userId) ||
      user.role === 'admin' ||
      requisition.approvalChain.some(step => step.approver.email === user.email);

    if (!canView) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.json({ success: true, data: requisition });
  } catch (error) {
    console.error('Get requisition details error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch requisition details', error: error.message });
  }
};

// Admin functions
const getAllRequisitions = async (req, res) => {
  try {
    const { status, department, page = 1, limit = 20 } = req.query;
    let filter = {};
    if (status) filter.status = status;
    if (department) {
      const users = await User.find({ department }).select('_id');
      filter.employee = { $in: users.map(u => u._id) };
    }

    const requisitions = await PurchaseRequisition.find(filter)
      .populate('employee', 'fullName email department')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await PurchaseRequisition.countDocuments(filter);

    res.json({
      success: true,
      data: requisitions,
      pagination: { current: page, total: Math.ceil(total / limit), count: requisitions.length, totalRecords: total }
    });
  } catch (error) {
    console.error('Get all requisitions error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch requisitions', error: error.message });
  }
};

// Get supervisor requisitions (pending approval)
// const getSupervisorRequisitions = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     if (!user) return res.status(404).json({ success: false, message: 'User not found' });

//     const requisitions = await PurchaseRequisition.find({
//       $or: [
//         {
//           'approvalChain': { $elemMatch: { 'approver.email': user.email, 'status': 'pending' } },
//           status: { $in: ['pending_supervisor'] }
//         },
//         {
//           'approvalChain': { $elemMatch: { 'approver.email': user.email } },
//           status: { $in: ['justification_pending_supervisor'] }
//         },
//         {
//           status: 'pending_cancellation',
//           'cancellationRequest.approvalChain': { $elemMatch: { 'approver.email': user.email, 'status': 'pending' } }
//         }
//       ]
//     })
//     .populate('employee', 'fullName email department')
//     .sort({ createdAt: -1 });

//     res.json({ success: true, data: requisitions, count: requisitions.length });
//   } catch (error) {
//     console.error('Get supervisor requisitions error:', error);
//     res.status(500).json({ success: false, message: 'Failed to fetch requisitions', error: error.message });
//   }
// };


const getSupervisorRequisitions = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // CEO sees requisitions at the pending_ceo step
    const isCEO = user.role === 'ceo' || user.email === 'tom@gratoengineering.com';

    const query = isCEO
      ? {
          $or: [
            { status: 'pending_ceo' },
            { status: 'pending_cancellation', 'cancellationRequest.approvalChain': { $elemMatch: { 'approver.email': user.email, status: 'pending' } } }
          ]
        }
      : {
          $or: [
            { 'approvalChain': { $elemMatch: { 'approver.email': user.email, status: 'pending' } }, status: { $in: ['pending_supervisor'] } },
            { 'approvalChain': { $elemMatch: { 'approver.email': user.email } }, status: { $in: ['justification_pending_supervisor'] } },
            { status: 'pending_cancellation', 'cancellationRequest.approvalChain': { $elemMatch: { 'approver.email': user.email, status: 'pending' } } }
          ]
        };

    const requisitions = await PurchaseRequisition.find(query)
      .populate('employee', 'fullName email department')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: requisitions, count: requisitions.length });
  } catch (error) {
    console.error('Get supervisor requisitions error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch requisitions', error: error.message });
  }
};

// Process supervisor decision
const processSupervisorDecision = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { decision, comments } = req.body;

    console.log('=== SUPERVISOR DECISION PROCESSING ===');
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');

    if (!requisition) return res.status(404).json({ success: false, message: 'Purchase requisition not found' });

    // Justification decisions are handled exclusively by processJustificationDecision
    // (route: POST /:requisitionId/justification-decision). This keeps a single source of
    // truth for role checks, status transitions, and notifications across the justification
    // chain (supervisor -> finance -> supply chain -> head -> CEO).
    if (requisition.status.startsWith('justification_pending_')) {
      return res.status(400).json({
        success: false,
        message: 'This requisition is in the justification review stage. Use POST /:requisitionId/justification-decision instead.'
      });
    }

    const effectiveEmails = await getEffectiveApprovalEmails(req.user.userId, user.email);
    const currentStepIndex = requisition.approvalChain.findIndex(
      step => matchesEffectiveApprover(step.approver.email, effectiveEmails) && step.status === 'pending'
    );

    if (currentStepIndex === -1) {
      return res.status(403).json({ success: false, message: 'You are not authorized to approve this requisition or it has already been processed' });
    }

    requisition.approvalChain[currentStepIndex].status = decision;
    requisition.approvalChain[currentStepIndex].comments = comments;
    requisition.approvalChain[currentStepIndex].actionDate = new Date();
    requisition.approvalChain[currentStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
    requisition.approvalChain[currentStepIndex].decidedBy = req.user.userId;

    if (decision === 'rejected') {
      requisition.status = 'rejected';
      requisition.supervisorDecision = { decision: 'rejected', comments, decisionDate: new Date(), decidedBy: req.user.userId };
    } else if (decision === 'approved') {
      const remainingApprovalSteps = requisition.approvalChain.filter(step => 
        step.status === 'pending' && 
        step.level < requisition.approvalChain.find(s => s.approver.role.includes('Finance'))?.level
      );

      if (remainingApprovalSteps.length === 1 && remainingApprovalSteps[0]._id.equals(requisition.approvalChain[currentStepIndex]._id)) {
        requisition.status = 'pending_finance_verification';
      } else {
        const nextStep = requisition.approvalChain.find(step => 
          step.level > requisition.approvalChain[currentStepIndex].level && 
          step.status === 'pending' &&
          !step.approver.role.includes('Finance') &&
          !step.approver.role.includes('Head of Business')
        );
        requisition.status = nextStep ? 'pending_supervisor' : 'pending_finance_verification';
      }
    }

    await requisition.save();

    const notifications = [];

    if (decision === 'approved') {
      if (requisition.status === 'pending_supply_chain_review') {
        const supplyChainTeam = await User.find({ $or: [{ role: 'supply_chain' }, { department: 'Business Development & Supply Chain' }] }).select('email fullName');
        if (supplyChainTeam.length > 0) {
          notifications.push(
            sendPurchaseRequisitionEmail.supervisorApprovalToSupplyChain(
              supplyChainTeam.map(u => u.email), requisition.employee.fullName, requisition.title, requisition._id, requisition.items.length, requisition.budgetXAF
            ).catch(error => ({ error, type: 'supply_chain' }))
          );
        }
      } else {
        const nextStep = requisition.approvalChain.find(step => 
          step.level > requisition.approvalChain[currentStepIndex].level && step.status === 'pending'
        );
        if (nextStep) {
          notifications.push(
            sendPurchaseRequisitionEmail.newRequisitionToSupervisor(
              nextStep.approver.email, requisition.employee.fullName, requisition.title, requisition._id, requisition.items.length, requisition.budgetXAF
            ).catch(error => ({ error, type: 'next_approver' }))
          );
        }
      }

      notifications.push(
        sendEmail({
          to: requisition.employee.email,
          subject: 'Purchase Requisition Approval Progress',
          html: `<h3>Your Purchase Requisition Has Been Approved</h3><p>Approved by ${user.fullName}. Moving to next stage.</p>`
        }).catch(error => ({ error, type: 'employee' }))
      );
    } else {
      notifications.push(
        sendPurchaseRequisitionEmail.denialToEmployee(
          requisition.employee.email, comments || 'Purchase requisition denied', requisition._id, user.fullName
        ).catch(error => ({ error, type: 'employee' }))
      );
    }

    const notificationResults = await Promise.allSettled(notifications);

    res.json({
      success: true,
      message: `Purchase requisition ${decision} successfully`,
      data: requisition,
      notifications: {
        sent: notificationResults.filter(r => r.status === 'fulfilled').length,
        failed: notificationResults.filter(r => r.status === 'rejected').length
      }
    });

  } catch (error) {
    console.error('Process supervisor decision error:', error);
    res.status(500).json({ success: false, message: 'Failed to process decision', error: error.message });
  }
};

// Get supply chain requisitions
const getSupplyChainRequisitions = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    let query = {};

    if (user.role === 'supply_chain' || user.department === 'Business Development & Supply Chain') {
      query = {
        $or: [
          { status: 'pending_supply_chain_review' },
          { status: 'justification_pending_supply_chain' },
          { 'approvalChain': { $elemMatch: { 'approver.email': user.email, 'status': 'pending' } } }
        ]
      };
    } else if (user.role === 'admin') {
      query = { status: { $in: ['pending_supply_chain_review', 'justification_pending_supply_chain', 'pending_buyer_assignment', 'pending_head_approval', 'justification_pending_head', 'supply_chain_approved', 'supply_chain_rejected', 'approved', 'in_procurement', 'procurement_complete', 'delivered'] } };
    } else {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const requisitions = await PurchaseRequisition.find(query)
      .populate('employee', 'fullName email department')
      .populate('supplyChainReview.assignedBuyer', 'fullName email buyerDetails')
      .populate('financeVerification.verifiedBy', 'fullName email')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: requisitions, count: requisitions.length });
  } catch (error) {
    console.error('Get supply chain requisitions error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch supply chain requisitions', error: error.message });
  }
};

// Process supply chain decision
const processSupplyChainDecision = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { decision, comments, assignedOfficer, estimatedCost, purchaseType } = req.body;

    const user = await User.findById(req.user.userId);
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');

    if (!requisition) return res.status(404).json({ success: false, message: 'Requisition not found' });

    const canProcess = user.role === 'admin' || user.role === 'supply_chain' ||
      user.department === 'Business Development & Supply Chain' ||
      requisition.approvalChain.some(step => step.approver.email === user.email && step.approver.role.includes('Supply Chain'));

    if (!canProcess) return res.status(403).json({ success: false, message: 'Access denied' });

    if (requisition.status === 'justification_pending_supply_chain') {
      requisition.justification = requisition.justification || {};
      requisition.justification.supplyChainReview = { decision, comments, reviewedBy: req.user.userId, reviewedDate: new Date() };
      if (decision === 'approve' || decision === 'approved') {
        requisition.status = 'justification_pending_head';
        requisition.justification.status = 'pending_head';
      } else {
        requisition.status = 'justification_rejected';
        requisition.justification.status = 'rejected';
      }
      await requisition.save();
      return res.json({ success: true, message: `Justification ${decision}`, data: requisition });
    }

    if (requisition.status === 'justification_pending_finance') {
      requisition.justification = requisition.justification || {};
      requisition.justification.financeReview = { decision, comments, reviewedBy: req.user.userId, reviewedDate: new Date() };
      if (decision === 'approve' || decision === 'approved') {
        requisition.status = 'justification_pending_supply_chain';
        requisition.justification.status = 'pending_supply_chain';
      } else {
        requisition.status = 'justification_rejected';
        requisition.justification.status = 'rejected';
      }
      await requisition.save();
      return res.json({ success: true, message: `Justification ${decision}`, data: requisition });
    }

    requisition.supplyChainReview = {
      decision, comments, assignedOfficer,
      estimatedCost: estimatedCost ? parseFloat(estimatedCost) : undefined,
      purchaseTypeAssigned: purchaseType,
      decisionDate: new Date(),
      decidedBy: req.user.userId
    };

    if (purchaseType) requisition.purchaseType = purchaseType;
    requisition.status = decision === 'approve' ? 'pending_buyer_assignment' : 'supply_chain_rejected';

    const supplyChainStepIndex = requisition.approvalChain.findIndex(step => step.approver.email === user.email && step.status === 'pending');
    if (supplyChainStepIndex !== -1) {
      requisition.approvalChain[supplyChainStepIndex].status = decision;
      requisition.approvalChain[supplyChainStepIndex].comments = comments;
      requisition.approvalChain[supplyChainStepIndex].actionDate = new Date();
      requisition.approvalChain[supplyChainStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
      requisition.approvalChain[supplyChainStepIndex].decidedBy = req.user.userId;
    }

    await requisition.save();

    const notifications = [];
    if (decision === 'approve') {
      const supplyChainCoordinator = await User.findOne({ email: 'lukong.lambert@gratoglobal.com' });
      if (supplyChainCoordinator) {
        notifications.push(sendEmail({
          to: supplyChainCoordinator.email,
          subject: `Requisition Ready for Buyer Assignment - ${requisition.employee.fullName}`,
          html: `<h3>Requisition Ready for Buyer Assignment</h3><p>Please assign a buyer and proceed.</p>`
        }).catch(error => ({ error, type: 'coordinator' })));
      }
      notifications.push(sendEmail({
        to: requisition.employee.email,
        subject: 'Purchase Requisition Approved by Supply Chain',
        html: `<h3>Your Purchase Requisition Has Been Approved!</h3><p>Approved by ${user.fullName}. Moving to buyer assignment.</p>`
      }).catch(error => ({ error, type: 'employee' })));
    } else {
      notifications.push(sendEmail({
        to: requisition.employee.email,
        subject: 'Purchase Requisition Rejected by Supply Chain',
        html: `<h3>Purchase Requisition Rejected</h3><p>Rejected by ${user.fullName}. ${comments ? `Reason: ${comments}` : ''}</p>`
      }).catch(error => ({ error, type: 'employee' })));
    }

    const notificationResults = await Promise.allSettled(notifications);
    res.json({
      success: true,
      message: `Requisition ${decision}d by supply chain`,
      data: requisition,
      notifications: { sent: notificationResults.filter(r => r.status === 'fulfilled' && !r.value?.error).length, failed: notificationResults.filter(r => r.status === 'rejected' || r.value?.error).length }
    });

  } catch (error) {
    console.error('Process supply chain decision error:', error);
    res.status(500).json({ success: false, message: 'Failed to process supply chain decision', error: error.message });
  }
};

// Process finance decision
const processFinanceDecision = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { decision, comments } = req.body;

    const user = await User.findById(req.user.userId);
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');

    if (!requisition) return res.status(404).json({ success: false, message: 'Requisition not found' });

    const financeEffectiveEmails = await getEffectiveApprovalEmails(req.user.userId, user.email);
    const canProcess = user.role === 'admin' || user.role === 'finance' ||
      requisition.approvalChain.some(step => matchesEffectiveApprover(step.approver.email, financeEffectiveEmails) && (step.approver.role === 'Finance Officer' || step.approver.role === 'President'));

    if (!canProcess) return res.status(403).json({ success: false, message: 'Access denied' });

    requisition.financeReview = { decision, comments, decisionDate: new Date(), decidedBy: req.user.userId };
    requisition.status = decision === 'approve' ? 'approved' : 'rejected';

    const financeStepIndex = requisition.approvalChain.findIndex(step => matchesEffectiveApprover(step.approver.email, financeEffectiveEmails) && step.status === 'pending');
    if (financeStepIndex !== -1) {
      requisition.approvalChain[financeStepIndex].status = decision;
      requisition.approvalChain[financeStepIndex].comments = comments;
      requisition.approvalChain[financeStepIndex].actionDate = new Date();
      requisition.approvalChain[financeStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
      requisition.approvalChain[financeStepIndex].decidedBy = req.user.userId;
    }

    await requisition.save();

    const notifications = [];
    if (decision === 'approve') {
      const supplyChainTeam = await User.find({ $or: [{ role: 'supply_chain' }, { department: 'Business Development & Supply Chain' }] }).select('email fullName');
      if (supplyChainTeam.length > 0) {
        notifications.push(sendEmail({ to: supplyChainTeam.map(u => u.email), subject: `Requisition Ready for Procurement - ${requisition.title}`, html: `<h3>Purchase Requisition Approved - Ready for Procurement</h3>` }).catch(error => ({ error, type: 'supply_chain' })));
      }
      notifications.push(sendEmail({ to: requisition.employee.email, subject: 'Purchase Requisition Approved by Finance', html: `<h3>Your Purchase Requisition Has Been Approved!</h3>` }).catch(error => ({ error, type: 'employee' })));
    } else {
      notifications.push(sendEmail({ to: requisition.employee.email, subject: 'Purchase Requisition Rejected by Finance', html: `<h3>Purchase Requisition Rejected</h3><p>${comments || ''}</p>` }).catch(error => ({ error, type: 'employee' })));
    }

    const notificationResults = await Promise.allSettled(notifications);
    res.json({
      success: true,
      message: `Requisition ${decision}d by finance`,
      data: requisition,
      notifications: { sent: notificationResults.filter(r => r.status === 'fulfilled').length, failed: notificationResults.filter(r => r.status === 'rejected').length }
    });

  } catch (error) {
    console.error('Process finance decision error:', error);
    res.status(500).json({ success: false, message: 'Failed to process finance decision', error: error.message });
  }
};

// Get approval chain preview
const getApprovalChainPreview = async (req, res) => {
  try {
    const { employeeName, department } = req.body;
    if (!employeeName || !department) {
      return res.status(400).json({ success: false, message: 'Employee name and department are required' });
    }
    const approvalChain = getApprovalChainForRequisition(employeeName, department);
    if (!approvalChain || approvalChain.length === 0) {
      return res.status(400).json({ success: false, message: 'Unable to determine approval chain for this employee' });
    }
    res.json({ success: true, data: approvalChain, message: `Found ${approvalChain.length} approval levels` });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get approval chain preview', error: error.message });
  }
};

// Get admin requisition details
const getAdminRequisitionDetails = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department')
      .populate('supervisorDecision.decidedBy', 'fullName email')
      .populate('supplyChainReview.decidedBy', 'fullName email')
      .populate('financeReview.decidedBy', 'fullName email')
      .populate('procurementDetails.assignedOfficer', 'fullName email');

    if (!requisition) return res.status(404).json({ success: false, message: 'Requisition not found' });
    res.json({ success: true, data: requisition });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch requisition details', error: error.message });
  }
};

// Get supervisor requisition
const getSupervisorRequisition = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const user = await User.findById(req.user.userId);
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');

    if (!requisition) return res.status(404).json({ success: false, message: 'Requisition not found' });

    const canView = user.role === 'admin' || requisition.approvalChain.some(step => step.approver.email === user.email);
    if (!canView) return res.status(403).json({ success: false, message: 'Access denied' });

    res.json({ success: true, data: requisition });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch requisition', error: error.message });
  }
};

// Update procurement status
const updateProcurementStatus = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { status, assignedOfficer, vendors, selectedVendor, finalCost, deliveryDate, deliveryStatus, comments } = req.body;

    const user = await User.findById(req.user.userId);
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');

    if (!requisition) return res.status(404).json({ success: false, message: 'Requisition not found' });

    const canUpdate = user.role === 'admin' || user.role === 'supply_chain' || user.department === 'Business Development & Supply Chain';
    if (!canUpdate) return res.status(403).json({ success: false, message: 'Access denied' });

    if (!requisition.procurementDetails) requisition.procurementDetails = {};
    if (assignedOfficer) requisition.procurementDetails.assignedOfficer = assignedOfficer;
    if (vendors) requisition.procurementDetails.vendors = vendors;
    if (selectedVendor) requisition.procurementDetails.selectedVendor = selectedVendor;
    if (finalCost) requisition.procurementDetails.finalCost = parseFloat(finalCost);
    if (deliveryDate) requisition.procurementDetails.deliveryDate = new Date(deliveryDate);
    if (deliveryStatus) requisition.procurementDetails.deliveryStatus = deliveryStatus;
    if (status) requisition.status = status;

    if (status === 'in_procurement' && !requisition.procurementDetails.procurementDate) {
      requisition.procurementDetails.procurementDate = new Date();
    }

    await requisition.save();
    const notifications = [];

    if (status === 'delivered') {
      notifications.push(sendPurchaseRequisitionEmail.deliveryToEmployee(
        requisition.employee.email, requisition.title, requisition._id, requisition.deliveryLocation, assignedOfficer
      ).catch(error => ({ error, type: 'employee' })));
    }

    const notificationResults = await Promise.allSettled(notifications);
    res.json({ success: true, message: 'Procurement status updated successfully', data: requisition, notifications: { sent: notificationResults.filter(r => r.status === 'fulfilled').length, failed: notificationResults.filter(r => r.status === 'rejected').length } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update procurement status', error: error.message });
  }
};

// Get dashboard statistics
const getDashboardStats = async (req, res) => {
  try {
    const { role, userId } = req.user;
    const user = await User.findById(userId);
    const { PENDING, APPROVED, REJECTED, IN_PROCUREMENT, JUSTIFICATION_PENDING, CANCELLED_OR_WITHDRAWN } = PurchaseRequisition.STATUS_GROUPS;
    let filter = {};

    if (role === 'employee') filter.employee = userId;
    else if (role === 'supervisor') filter['approvalChain.approver.email'] = user.email;
    else if (role === 'supply_chain') filter.status = { $in: ['pending_supply_chain_review', ...IN_PROCUREMENT] };
    else if (role === 'finance') filter.status = { $in: ['pending_finance_verification', 'pending_supply_chain_review', ...APPROVED] };

    const [totalCount, pendingCount, approvedCount, rejectedCount, inProcurementCount, completedCount, justificationCount, cancelledCount, recentRequisitions, monthlyStats] = await Promise.all([
      PurchaseRequisition.countDocuments(filter),
      PurchaseRequisition.countDocuments({ ...filter, status: { $in: PENDING } }),
      PurchaseRequisition.countDocuments({ ...filter, status: { $in: APPROVED } }),
      PurchaseRequisition.countDocuments({ ...filter, status: { $in: REJECTED } }),
      PurchaseRequisition.countDocuments({ ...filter, status: { $in: IN_PROCUREMENT } }),
      PurchaseRequisition.countDocuments({ ...filter, status: { $in: ['fully_disbursed', 'completed'] } }),
      PurchaseRequisition.countDocuments({ ...filter, status: { $in: JUSTIFICATION_PENDING } }),
      PurchaseRequisition.countDocuments({ ...filter, status: { $in: CANCELLED_OR_WITHDRAWN } }),
      PurchaseRequisition.find(filter).populate('employee', 'fullName email department').sort({ createdAt: -1 }).limit(10),
      PurchaseRequisition.aggregate([{ $match: filter }, { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, count: { $sum: 1 }, totalBudget: { $sum: '$budgetXAF' } } }, { $sort: { '_id.year': -1, '_id.month': -1 } }, { $limit: 12 }])
    ]);

    let stats = {
      summary: {
        total: totalCount,
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
        inProcurement: inProcurementCount,
        completed: completedCount,
        // Not mutually exclusive with the buckets above (a justification-pending or cancelled
        // PR was previously 'approved', so it's also counted there) — broken out separately
        // rather than silently dropped so the numbers are traceable instead of just missing.
        awaitingJustificationReview: justificationCount,
        cancelledOrWithdrawn: cancelledCount
      },
      recent: recentRequisitions,
      monthly: monthlyStats,
      trends: {
        approvalRate: totalCount > 0 ? Math.round((approvedCount / totalCount) * 100) : 0,
        completionRate: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
      }
    };

    if (role === 'finance' || role === 'admin') {
      const BudgetCode = require('../models/BudgetCode');
      const [budgetCodeStats, totalBudgetAllocated, budgetUtilization, financeRequisitions] = await Promise.all([
        BudgetCode.aggregate([{ $match: { active: true } }, { $group: { _id: null, totalBudgetCodes: { $sum: 1 }, totalBudget: { $sum: '$budget' }, totalUsed: { $sum: '$used' }, totalRemaining: { $sum: { $subtract: ['$budget', '$used'] } } } }]),
        PurchaseRequisition.aggregate([{ $match: { 'financeVerification.verificationDate': { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }, 'financeVerification.decision': 'approved' } }, { $group: { _id: null, totalAllocated: { $sum: '$financeVerification.assignedBudget' }, count: { $sum: 1 } } }]),
        PurchaseRequisition.aggregate([{ $match: { 'financeVerification.decision': 'approved', createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } }, { $group: { _id: '$department', totalAllocated: { $sum: '$financeVerification.assignedBudget' }, count: { $sum: 1 } } }, { $sort: { totalAllocated: -1 } }]),
        PurchaseRequisition.countDocuments({ status: 'pending_finance_verification' })
      ]);

      stats.finance = {
        budgetCodes: budgetCodeStats[0] || { totalBudgetCodes: 0, totalBudget: 0, totalUsed: 0, totalRemaining: 0 },
        thisMonth: { totalBudgetAllocated: totalBudgetAllocated[0]?.totalAllocated || 0, requisitionsApproved: totalBudgetAllocated[0]?.count || 0 },
        budgetUtilization,
        pendingVerification: financeRequisitions,
        overallUtilization: budgetCodeStats[0] ? Math.round((budgetCodeStats[0].totalUsed / budgetCodeStats[0].totalBudget) * 100) : 0
      };
    }

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard statistics', error: error.message });
  }
};

// Get category analytics
const getCategoryAnalytics = async (req, res) => {
  try {
    const { period = 'quarterly' } = req.query;
    let startDate = new Date();
    switch (period) {
      case 'monthly': startDate.setMonth(startDate.getMonth() - 1); break;
      case 'quarterly': startDate.setMonth(startDate.getMonth() - 3); break;
      case 'yearly': startDate.setFullYear(startDate.getFullYear() - 1); break;
      default: startDate.setMonth(startDate.getMonth() - 3);
    }

    const analytics = await PurchaseRequisition.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: { _id: '$itemCategory', count: { $sum: 1 }, totalBudget: { $sum: '$budgetXAF' }, avgBudget: { $avg: '$budgetXAF' }, approvedCount: { $sum: { $cond: [{ $in: ['$status', PurchaseRequisition.STATUS_GROUPS.APPROVED] }, 1, 0] } } } },
      { $addFields: { approvalRate: { $multiply: [{ $divide: ['$approvedCount', '$count'] }, 100] } } },
      { $sort: { totalBudget: -1 } }
    ]);

    res.json({ success: true, data: analytics, period });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch category analytics', error: error.message });
  }
};

// Get vendor performance data
const getVendorPerformance = async (req, res) => {
  try {
    const Supplier = require('../models/Supplier');

    const suppliers = await Supplier.find({ 'performance.totalOrders': { $gt: 0 } })
      .select('name performance')
      .sort({ 'performance.totalBusinessValue': -1 })
      .limit(50);

    const vendorData = suppliers.map(s => ({
      name: s.name,
      totalOrders: s.performance.totalOrders || 0,
      completedOrders: s.performance.completedOrders || 0,
      onTimeDelivery: s.onTimeDeliveryRate, // virtual, computed from onTimeDeliveries/lateDeliveries
      qualityRating: s.performance.qualityRating || 0,
      overallRating: s.performance.overallRating || 0,
      totalSpend: s.performance.totalBusinessValue || 0,
      averageOrderValue: s.performance.averageOrderValue || 0
    }));

    res.json({
      success: true,
      data: vendorData,
      message: vendorData.length === 0
        ? 'No suppliers have any recorded order performance yet.'
        : undefined
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch vendor performance', error: error.message });
  }
};

// Save draft requisition
const saveDraft = async (req, res) => {
  try {
    const { title, itemCategory, budgetXAF, budgetHolder, urgency, deliveryLocation, expectedDate, justificationOfPurchase, justificationOfPreferredSupplier, items } = req.body;
    const employee = await User.findById(req.user.userId);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    let parsedItems;
    try { parsedItems = typeof items === 'string' ? JSON.parse(items) : items; }
    catch (error) { parsedItems = []; }

    const draftRequisition = new PurchaseRequisition({
      employee: req.user.userId,
      title: title || 'Draft Requisition',
      department: employee.department,
      itemCategory: itemCategory || 'Other',
      budgetXAF: budgetXAF ? parseFloat(budgetXAF) : undefined,
      budgetHolder: budgetHolder || employee.department,
      urgency: urgency || 'Medium',
      deliveryLocation: deliveryLocation || 'Office',
      expectedDate: expectedDate ? new Date(expectedDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      justificationOfPurchase: justificationOfPurchase || 'Draft - to be completed',
      justificationOfPreferredSupplier,
      items: parsedItems || [],
      status: 'draft',
      approvalChain: []
    });

    await draftRequisition.save();
    await draftRequisition.populate('employee', 'fullName email department');
    res.json({ success: true, message: 'Draft saved successfully', data: draftRequisition });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to save draft', error: error.message });
  }
};

// Get procurement planning data
const getProcurementPlanningData = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const canView = user.role === 'admin' || user.role === 'supply_chain' || user.department === 'Business Development & Supply Chain';
    if (!canView) return res.status(403).json({ success: false, message: 'Access denied' });

    const { APPROVED, IN_PROCUREMENT } = PurchaseRequisition.STATUS_GROUPS;

    const [upcomingRequisitions, procurementPipeline, budgetUtilization, vendorWorkload] = await Promise.all([
      PurchaseRequisition.find({ status: { $in: APPROVED }, expectedDate: { $gte: new Date(), $lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } }).populate('employee', 'fullName department').sort({ expectedDate: 1 }).limit(20),
      PurchaseRequisition.aggregate([{ $match: { status: { $in: APPROVED } } }, { $group: { _id: '$status', count: { $sum: 1 }, totalValue: { $sum: '$budgetXAF' } } }]),
      PurchaseRequisition.aggregate([{ $match: { status: { $in: APPROVED }, createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } }, { $group: { _id: '$itemCategory', allocated: { $sum: '$budgetXAF' }, spent: { $sum: '$procurementDetails.finalCost' }, count: { $sum: 1 } } }]),
      // Current open workload per assigned buyer, so supply chain can see who's overloaded.
      PurchaseRequisition.aggregate([
        { $match: { status: { $in: IN_PROCUREMENT }, 'supplyChainReview.assignedBuyer': { $exists: true, $ne: null } } },
        { $group: { _id: '$supplyChainReview.assignedBuyer', openCount: { $sum: 1 }, totalValue: { $sum: '$budgetXAF' } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'buyer' } },
        { $unwind: { path: '$buyer', preserveNullAndEmptyArrays: true } },
        { $project: { _id: 0, buyerId: '$_id', buyerName: '$buyer.fullName', openCount: 1, totalValue: 1 } },
        { $sort: { openCount: -1 } }
      ])
    ]);

    res.json({ success: true, data: { upcoming: upcomingRequisitions, pipeline: procurementPipeline, budgetUtilization, vendorWorkload } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch procurement planning data', error: error.message });
  }
};

/**
 * Detailed tracking of every requisition supply chain has assigned to a buyer, showing
 * exactly where each one currently stands in the buyer's sourcing process (RFQ sent,
 * suppliers invited, quotes received/evaluated, vendor selected, PO created). This is
 * the per-requisition companion to getProcurementPlanningData's aggregate workload
 * summary - only possible because procurementDetails.status/rfqId now actually persist.
 */
const getBuyerAssignmentTracking = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const canView = user.role === 'admin' || user.role === 'supply_chain' || user.role === 'ceo' || user.department === 'Business Development & Supply Chain';
    if (!canView) return res.status(403).json({ success: false, message: 'Access denied' });

    const { buyerId, stage } = req.query;
    const { IN_PROCUREMENT } = PurchaseRequisition.STATUS_GROUPS;

    const query = {
      status: { $in: IN_PROCUREMENT },
      'supplyChainReview.assignedBuyer': { $exists: true, $ne: null }
    };
    if (buyerId) query['supplyChainReview.assignedBuyer'] = buyerId;

    const requisitions = await PurchaseRequisition.find(query)
      .populate('supplyChainReview.assignedBuyer', 'fullName email')
      .populate('employee', 'fullName department')
      .populate('procurementDetails.rfqId', 'rfqNumber status invitedSuppliers externalInvitations responseSummary responseDeadline')
      .sort({ 'supplyChainReview.buyerAssignmentDate': -1 })
      .lean();

    // A readable, ordered progress stage for each requisition, derived from the same
    // fields the buyer's own portal uses - so what supply chain sees always matches
    // what the buyer sees, rather than a separate parallel interpretation of status.
    const STAGE_ORDER = ['assigned', 'sourcing_initiated', 'quotes_evaluated', 'vendor_selected', 'purchase_order_created', 'procurement_complete'];
    const resolveStage = (req) => {
      if (req.status === 'procurement_complete' || req.status === 'delivered' || req.status === 'completed') return 'procurement_complete';
      const pdStatus = req.procurementDetails?.status;
      if (pdStatus && STAGE_ORDER.includes(pdStatus)) return pdStatus;
      if (req.procurementDetails?.rfqId) return 'sourcing_initiated';
      return 'assigned';
    };

    let data = requisitions.map(req => {
      const rfq = req.procurementDetails?.rfqId;
      const suppliersInvited = (rfq?.invitedSuppliers?.length || 0) + (rfq?.externalInvitations?.length || 0);
      const quotesReceived = rfq?.responseSummary?.totalResponded || 0;

      return {
        requisitionId: req._id,
        requisitionNumber: req.requisitionNumber,
        title: req.title,
        employee: req.employee ? { name: req.employee.fullName, department: req.employee.department } : null,
        budgetXAF: req.budgetXAF,
        assignedBuyer: req.supplyChainReview.assignedBuyer
          ? { id: req.supplyChainReview.assignedBuyer._id, name: req.supplyChainReview.assignedBuyer.fullName, email: req.supplyChainReview.assignedBuyer.email }
          : null,
        buyerAssignmentDate: req.supplyChainReview.buyerAssignmentDate,
        stage: resolveStage(req),
        stageLabel: {
          assigned: 'Assigned - not yet sourced',
          sourcing_initiated: 'RFQ sent - awaiting quotes',
          quotes_evaluated: 'Quotes evaluated',
          vendor_selected: 'Vendor selected',
          purchase_order_created: 'Purchase order created',
          procurement_complete: 'Complete'
        }[resolveStage(req)],
        rfq: rfq ? {
          rfqNumber: rfq.rfqNumber,
          status: rfq.status,
          suppliersInvited,
          quotesReceived,
          responseDeadline: rfq.responseDeadline
        } : null,
        selectedVendor: req.procurementDetails?.selectedVendor,
        finalCost: req.procurementDetails?.finalCost,
        lastUpdated: req.procurementDetails?.lastUpdated || req.updatedAt,
        daysSinceAssignment: req.supplyChainReview.buyerAssignmentDate
          ? Math.floor((Date.now() - new Date(req.supplyChainReview.buyerAssignmentDate).getTime()) / (1000 * 60 * 60 * 24))
          : null
      };
    });

    if (stage) {
      data = data.filter(r => r.stage === stage);
    }

    res.json({
      success: true,
      count: data.length,
      data,
      stageCounts: STAGE_ORDER.reduce((acc, s) => {
        acc[s] = data.filter(r => r.stage === s).length;
        return acc;
      }, {})
    });
  } catch (error) {
    console.error('Get buyer assignment tracking error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch buyer assignment tracking', error: error.message });
  }
};

/**
 * Download an on-demand Excel export of requisition data.
 * GET /api/purchase-requisitions/reports/export?type=requisition_summary|requisition_spend|requisition_pending_approvals
 * Reuses the same report generators that back the scheduled report system, so ad-hoc
 * downloads and scheduled emails always show identical numbers.
 */
const exportRequisitionReport = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const canExport = ['admin', 'finance', 'supply_chain', 'ceo'].includes(user.role) || user.department === 'Business Development & Supply Chain';
    if (!canExport) return res.status(403).json({ success: false, message: 'Access denied' });

    const { type = 'requisition_summary', department, itemCategory, status, startDate, endDate } = req.query;

    const allowedTypes = ['requisition_summary', 'requisition_spend', 'requisition_pending_approvals'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ success: false, message: `Invalid report type. Must be one of: ${allowedTypes.join(', ')}` });
    }

    const filters = { department, itemCategory, status };
    if (startDate || endDate) filters.dateRange = { start: startDate, end: endDate };

    const {
      generateRequisitionSummaryReport,
      generateRequisitionSpendReport,
      generateRequisitionPendingApprovalsReport,
      generateExcelReport
    } = require('../services/reportGenerationService');

    const generators = {
      requisition_summary: generateRequisitionSummaryReport,
      requisition_spend: generateRequisitionSpendReport,
      requisition_pending_approvals: generateRequisitionPendingApprovalsReport
    };

    const reportData = await generators[type](filters);
    const buffer = await generateExcelReport(reportData, type);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${type}_${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('Export requisition report error:', error);
    res.status(500).json({ success: false, message: 'Failed to export report', error: error.message });
  }
};

// Update requisition
const updateRequisition = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const updateData = req.body;
    const requisition = await PurchaseRequisition.findById(requisitionId);

    if (!requisition) return res.status(404).json({ success: false, message: 'Requisition not found' });
    if (!requisition.employee.equals(req.user.userId) && !['admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (!['draft', 'pending_supervisor'].includes(requisition.status)) {
      return res.status(400).json({ success: false, message: 'Can only update draft or pending supervisor requisitions' });
    }

    const allowedFields = ['title', 'itemCategory', 'budgetXAF', 'budgetHolder', 'urgency', 'deliveryLocation', 'expectedDate', 'justificationOfPurchase', 'justificationOfPreferredSupplier', 'items'];
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        if (field === 'items' && typeof updateData[field] === 'string') {
          try { requisition[field] = JSON.parse(updateData[field]); } catch (error) {}
        } else if (field === 'budgetXAF' && updateData[field]) {
          requisition[field] = parseFloat(updateData[field]);
        } else if (field === 'expectedDate' && updateData[field]) {
          requisition[field] = new Date(updateData[field]);
        } else {
          requisition[field] = updateData[field];
        }
      }
    });

    await requisition.save();
    await requisition.populate('employee', 'fullName email department');
    res.json({ success: true, message: 'Requisition updated successfully', data: requisition });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update requisition', error: error.message });
  }
};

// Delete draft requisition
const deleteRequisition = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const requisition = await PurchaseRequisition.findById(requisitionId);

    if (!requisition) return res.status(404).json({ success: false, message: 'Requisition not found' });
    if (!requisition.employee.equals(req.user.userId) && !['admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (requisition.status !== 'draft') {
      return res.status(400).json({ success: false, message: 'Can only delete draft requisitions' });
    }

    await PurchaseRequisition.findByIdAndDelete(requisitionId);
    res.json({ success: true, message: 'Draft requisition deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete requisition', error: error.message });
  }
};

// Get requisition statistics
const getRequisitionStats = async (req, res) => {
  try {
    const { startDate, endDate, department, status } = req.query;
    let matchFilter = {};
    if (startDate || endDate) { matchFilter.createdAt = {}; if (startDate) matchFilter.createdAt.$gte = new Date(startDate); if (endDate) matchFilter.createdAt.$lte = new Date(endDate); }
    if (department) { const users = await User.find({ department }).select('_id'); matchFilter.employee = { $in: users.map(u => u._id) }; }
    if (status) matchFilter.status = status;

    const stats = await PurchaseRequisition.aggregate([{ $match: matchFilter }, { $group: { _id: null, totalRequisitions: { $sum: 1 }, totalBudget: { $sum: '$budgetXAF' }, avgBudget: { $avg: '$budgetXAF' }, statusBreakdown: { $push: '$status' }, categoryBreakdown: { $push: '$itemCategory' }, departmentBreakdown: { $push: '$department' } } }]);

    const statusCounts = {}, categoryCounts = {}, departmentCounts = {};
    if (stats.length > 0) {
      stats[0].statusBreakdown.forEach(s => { statusCounts[s] = (statusCounts[s] || 0) + 1; });
      stats[0].categoryBreakdown.forEach(c => { categoryCounts[c] = (categoryCounts[c] || 0) + 1; });
      stats[0].departmentBreakdown.forEach(d => { departmentCounts[d] = (departmentCounts[d] || 0) + 1; });
    }

    res.json({ success: true, data: { summary: stats.length > 0 ? { totalRequisitions: stats[0].totalRequisitions, totalBudget: stats[0].totalBudget || 0, avgBudget: Math.round(stats[0].avgBudget || 0) } : { totalRequisitions: 0, totalBudget: 0, avgBudget: 0 }, breakdown: { status: statusCounts, category: categoryCounts, department: departmentCounts } } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch requisition statistics', error: error.message });
  }
};

// Get requisitions by user role
const getRequisitionsByRole = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const { status, page = 1, limit = 20 } = req.query;
    let query = {};
    const baseFilter = status ? { status } : {};

    switch (user.role) {
      case 'employee': query = { ...baseFilter, employee: req.user.userId }; break;
      case 'supervisor': query = { ...baseFilter, 'approvalChain': { $elemMatch: { 'approver.email': user.email, 'status': 'pending' } } }; break;
      case 'supply_chain': query = { ...baseFilter, $or: [{ status: 'pending_supply_chain_review' }, { status: 'supply_chain_approved' }, { status: 'in_procurement' }] }; break;
      case 'finance': query = { ...baseFilter, $or: [{ status: 'pending_finance_verification' }, { status: { $in: PurchaseRequisition.STATUS_GROUPS.APPROVED } }] }; break;
      case 'admin': query = baseFilter; break;
      default: return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const requisitions = await PurchaseRequisition.find(query).populate('employee', 'fullName email department').sort({ createdAt: -1 }).limit(limit * 1).skip((page - 1) * limit);
    const total = await PurchaseRequisition.countDocuments(query);

    res.json({ success: true, data: requisitions, pagination: { current: parseInt(page), total: Math.ceil(total / limit), count: requisitions.length, totalRecords: total }, role: user.role });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch requisitions', error: error.message });
  }
};


const processFinanceVerification = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { decision, comments } = req.body;

    console.log('=== FINANCE VERIFICATION PROCESSING ===');
    const user = await User.findById(req.user.userId);
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department')
      .populate('budgetCode', 'code name budget used department');

    if (!requisition) return res.status(404).json({ success: false, message: 'Requisition not found' });

    const canVerify = user.role === 'admin' || user.role === 'finance' || user.email === 'ranibellmambo@gratoengineering.com';
    if (!canVerify) return res.status(403).json({ success: false, message: 'Access denied' });

    if (requisition.items && requisition.items.length > 0) {
      requisition.items = requisition.items.map(item => {
        const itemData = item._doc || item;
        return {
          itemId: itemData.itemId || itemData._id,
          code: itemData.code || `ITEM-${Date.now()}`,
          description: itemData.description || 'Item description not available',
          category: itemData.category || 'General',
          subcategory: itemData.subcategory || 'General',
          quantity: itemData.quantity || 1,
          measuringUnit: itemData.measuringUnit || 'Pieces',
          estimatedPrice: itemData.estimatedPrice || 0,
          projectName: itemData.projectName || ''
        };
      });
    }

    if (!requisition.budgetCode) {
      return res.status(400).json({ success: false, message: 'No budget code found. Employee must select budget code during submission.' });
    }

    const budgetCode = requisition.budgetCode;
    const requiredBudget = requisition.budgetXAF || 0;
    const currentAvailableBudget = budgetCode.budget - budgetCode.used;

    if (decision === 'approved') {
      if (currentAvailableBudget < requiredBudget) {
        return res.status(400).json({ success: false, message: `Insufficient budget. Budget code ${budgetCode.code} has only XAF ${currentAvailableBudget.toLocaleString()} available, but XAF ${requiredBudget.toLocaleString()} is required.` });
      }

      requisition.financeVerification = {
        budgetAvailable: true,
        verifiedBudget: requiredBudget,
        budgetCodeVerified: budgetCode.code,
        budgetCodeId: budgetCode._id,
        availableBudgetAtVerification: currentAvailableBudget,
        comments,
        verifiedBy: req.user.userId,
        verificationDate: new Date(),
        decision: 'approved'
      };
      requisition.status = 'pending_supply_chain_review';
    } else {
      requisition.financeVerification = {
        budgetAvailable: false,
        verifiedBudget: requiredBudget,
        budgetCodeVerified: budgetCode.code,
        comments,
        verifiedBy: req.user.userId,
        verificationDate: new Date(),
        decision: 'rejected'
      };
      requisition.status = 'rejected';
    }

    const financeStepIndex = requisition.approvalChain.findIndex(step => step.approver.email.toLowerCase() === user.email.toLowerCase() && step.status === 'pending');
    if (financeStepIndex !== -1) {
      requisition.approvalChain[financeStepIndex].status = decision === 'approved' ? 'approved' : 'rejected';
      requisition.approvalChain[financeStepIndex].comments = comments;
      requisition.approvalChain[financeStepIndex].actionDate = new Date();
      requisition.approvalChain[financeStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
      requisition.approvalChain[financeStepIndex].decidedBy = req.user.userId;
    }

    try {
      await requisition.save();
    } catch (saveError) {
      if (saveError.name === 'ValidationError') {
        const errors = Object.keys(saveError.errors).map(key => `${key}: ${saveError.errors[key].message}`).join(', ');
        return res.status(400).json({ success: false, message: 'Requisition validation failed', details: errors });
      }
      return res.status(500).json({ success: false, message: 'Failed to save requisition', error: saveError.message });
    }

    const notifications = [];
    const { sendEmail } = require('../services/emailService');

    if (decision === 'approved') {
      const supplyChainCoordinator = await User.findOne({ email: 'lukong.lambert@gratoglobal.com' });
      if (supplyChainCoordinator) {
        notifications.push(sendEmail({
          to: supplyChainCoordinator.email,
          subject: `Purchase Requisition Ready - Budget Verified - ${requisition.employee.fullName}`,
          html: `<h3>Budget Verified - Ready for Supply Chain Review</h3><p>Budget Code: ${budgetCode.code}, Amount: XAF ${requiredBudget.toLocaleString()}</p>`
        }).catch(error => ({ error, type: 'supply_chain' })));
      }
      notifications.push(sendEmail({
        to: requisition.employee.email,
        subject: 'Purchase Requisition - Budget Verified',
        html: `<h3>Budget Verification Complete</h3><p>Your requisition has been verified by Finance. Next step: Supply Chain Review.</p>`
      }).catch(error => ({ error, type: 'employee' })));
    } else {
      notifications.push(sendEmail({
        to: requisition.employee.email,
        subject: 'Purchase Requisition - Budget Verification Rejected',
        html: `<h3>Budget Verification Rejected</h3><p>${comments || ''}</p>`
      }).catch(error => ({ error, type: 'employee' })));
    }

    const notificationResults = await Promise.allSettled(notifications);
    res.json({
      success: true,
      message: `Budget verification ${decision}`,
      data: { requisition, budgetVerification: { budgetCode: budgetCode.code, budgetCodeName: budgetCode.name, requiredBudget, availableBudget: currentAvailableBudget, verified: decision === 'approved' } },
      notifications: { sent: notificationResults.filter(r => r.status === 'fulfilled' && !r.value?.error).length, failed: notificationResults.filter(r => r.status === 'rejected' || r.value?.error).length }
    });

  } catch (error) {
    console.error('Process finance verification error:', error);
    res.status(500).json({ success: false, message: 'Failed to process finance verification', error: error.message });
  }
};

const assignBuyer = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { sourcingType, assignedBuyer, comments, purchaseType, paymentMethod = 'bank', estimatedCost } = req.body;

    const user = await User.findById(req.user.userId);
    const requisition = await PurchaseRequisition.findById(requisitionId).populate('employee', 'fullName email department');
    if (!requisition) return res.status(404).json({ success: false, message: 'Requisition not found' });

    const canAssign = user.role === 'admin' || user.email === 'lukong.lambert@gratoglobal.com' || user.role === 'supply_chain' || user.department === 'Business Development & Supply Chain';
    if (!canAssign) return res.status(403).json({ success: false, message: 'Access denied' });

    const buyer = await User.findOne({ _id: assignedBuyer, $or: [{ role: 'buyer' }, { departmentRole: 'buyer' }, { email: 'lukong.lambert@gratoglobal.com' }], isActive: true });
    if (!buyer) return res.status(400).json({ success: false, message: 'Invalid buyer selected or buyer not found' });

    if (!['pending_buyer_assignment', 'pending_supply_chain_review'].includes(requisition.status)) {
      return res.status(400).json({ success: false, message: `Cannot assign buyer to requisition with status: ${requisition.status}` });
    }

    if (!requisition.supplyChainReview) requisition.supplyChainReview = {};
    requisition.supplyChainReview = { ...requisition.supplyChainReview, decision: 'approve', sourcingType, assignedBuyer, buyerAssignmentDate: new Date(), buyerAssignedBy: req.user.userId, estimatedCost, comments, purchaseTypeAssigned: purchaseType || requisition.purchaseType };
    if (purchaseType) requisition.purchaseType = purchaseType;
    requisition.paymentMethod = paymentMethod;
    requisition.status = 'pending_head_approval';

    await requisition.save();

    if (buyer.buyerDetails) {
      await User.findByIdAndUpdate(assignedBuyer, { $inc: { 'buyerDetails.workload.currentAssignments': 1 } });
    }

    const notifications = [];
    notifications.push(sendEmail({
      to: buyer.email,
      subject: `New Purchase Requisition Assignment - ${requisition.employee.fullName}`,
      html: `<h3>New Procurement Assignment</h3><p>You have been assigned: ${requisition.title}. Payment: ${paymentMethod.toUpperCase()}.</p>`
    }).catch(error => ({ error, type: 'buyer' })));

    const headOfSupplyChain = await User.findOne({ email: 'kelvin.eyong@gratoglobal.com' });
    if (headOfSupplyChain) {
      notifications.push(sendEmail({
        to: headOfSupplyChain.email,
        subject: `Purchase Requisition Ready for Final Approval - ${requisition.employee.fullName}`,
        html: `<h3>Final Approval Required</h3><p>Buyer: ${buyer.fullName}. Amount: XAF ${(requisition.budgetXAF || 0).toLocaleString()}.</p>`
      }).catch(error => ({ error, type: 'head' })));
    }

    const notificationResults = await Promise.allSettled(notifications);
    res.json({ success: true, message: 'Buyer assigned successfully', data: { requisition, assignedBuyer: { id: buyer._id, name: buyer.fullName, email: buyer.email }, paymentMethod }, notifications: { sent: notificationResults.filter(r => r.status === 'fulfilled' && !r.value?.error).length, failed: notificationResults.filter(r => r.status === 'rejected' || r.value?.error).length } });

  } catch (error) {
    console.error('Assign buyer error:', error);
    res.status(500).json({ success: false, message: 'Failed to assign buyer', error: error.message });
  }
};


const assignBuyerWithPaymentMethod = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { buyerId, paymentMethod, estimatedCost, sourcingType, purchaseTypeAssigned, comments } = req.body;

    if (!buyerId) return res.status(400).json({ success: false, message: 'Buyer ID is required' });
    if (!paymentMethod || !['bank', 'cash'].includes(paymentMethod)) return res.status(400).json({ success: false, message: 'Valid payment method (bank or cash) is required' });

    const requisition = await PurchaseRequisition.findById(requisitionId).populate('employee', 'fullName email department');
    if (!requisition) return res.status(404).json({ success: false, message: 'Requisition not found' });
    if (requisition.status !== 'pending_buyer_assignment') return res.status(400).json({ success: false, message: `Cannot assign buyer. Current status: ${requisition.status}` });

    const buyer = await User.findById(buyerId);
    if (!buyer) return res.status(404).json({ success: false, message: 'Buyer not found' });
    if (buyer.role !== 'buyer' && buyer.departmentRole !== 'buyer') return res.status(400).json({ success: false, message: 'Selected user is not a buyer' });

    requisition.supplyChainReview = { ...requisition.supplyChainReview, assignedBuyer: buyerId, buyerAssignmentDate: new Date(), buyerAssignedBy: req.user.userId, paymentMethod, estimatedCost: estimatedCost || requisition.budgetXAF, sourcingType: sourcingType || 'quotation_required', purchaseTypeAssigned: purchaseTypeAssigned || requisition.purchaseType, comments: comments || `Buyer assigned with ${paymentMethod} payment method`, decision: 'approve', decisionDate: new Date(), decidedBy: req.user.userId };
    requisition.status = 'pending_head_approval';

    await requisition.save();

    try {
      const assignedBy = await User.findById(req.user.userId);
      await sendEmail({ to: buyer.email, subject: `New Requisition Assigned - ${requisition.title}`, html: `<h3>New Purchase Requisition Assigned</h3><p>Assigned by ${assignedBy.fullName}. Payment: ${paymentMethod === 'cash' ? 'Petty Cash' : 'Bank Transfer'}.</p>` });
    } catch (emailError) {
      console.error('Failed to send buyer notification:', emailError);
    }

    res.json({ success: true, message: `Buyer assigned successfully with ${paymentMethod} payment method`, data: { requisitionId: requisition._id, requisitionNumber: requisition.requisitionNumber, assignedBuyer: { id: buyer._id, name: buyer.fullName, email: buyer.email }, paymentMethod, status: requisition.status, nextStage: 'pending_head_approval' } });

  } catch (error) {
    console.error('Error assigning buyer with payment method:', error);
    res.status(500).json({ success: false, message: 'Failed to assign buyer', error: error.message });
  }
};


const getPaymentMethodOptions = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const requisition = await PurchaseRequisition.findById(requisitionId);
    if (!requisition) return res.status(404).json({ success: false, message: 'Requisition not found' });

    const amount = requisition.budgetXAF || 0;
    const options = {
      availableMethods: ['bank', 'cash'],
      recommendedMethod: amount > 1000000 ? 'bank' : 'cash',
      limits: { cash: { maximum: 5000000, recommended: 1000000 } },
      warnings: []
    };

    if (amount > options.limits.cash.maximum) {
      options.availableMethods = ['bank'];
      options.warnings.push(`Amount exceeds petty cash limit of XAF ${options.limits.cash.maximum.toLocaleString()}. Bank payment required.`);
    } else if (amount > options.limits.cash.recommended) {
      options.warnings.push(`Amount exceeds recommended petty cash limit of XAF ${options.limits.cash.recommended.toLocaleString()}. Bank payment is recommended.`);
    }

    res.json({ success: true, data: options });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get payment method options', error: error.message });
  }
};


const getFinanceRequisitions = async (req, res) => {
  try {
    console.log('\n=== FETCHING FINANCE REQUISITIONS ===');
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const financeEmail = user.email.toLowerCase();

    const query = {
      $or: [
        { status: 'pending_finance_verification' },
        { status: 'justification_pending_finance' },
        { 'approvalChain': { $elemMatch: { 'approver.email': financeEmail, 'approver.role': { $regex: /finance/i }, 'status': 'pending' } } },
        { 'financeVerification.verifiedBy': req.user.userId },
        { status: { $in: ['approved', 'partially_disbursed', 'fully_disbursed'] }, 'financeVerification.verifiedBy': req.user.userId }
      ]
    };

    const requisitions = await PurchaseRequisition.find(query)
      .populate('employee', 'fullName email department')
      .populate('financeVerification.verifiedBy', 'fullName email')
      .populate('disbursements.disbursedBy', 'fullName email')
      .populate('disbursements.acknowledgedBy', 'fullName email')
      .sort({ createdAt: -1 });

    const enrichedRequisitions = requisitions.map(req => {
      const reqObj = req.toObject();
      const financeStep = reqObj.approvalChain?.find(step => step.approver.email.toLowerCase() === financeEmail && step.approver.role?.toLowerCase().includes('finance'));
      const totalBudget = reqObj.budgetXAF || 0;
      const totalDisbursed = reqObj.totalDisbursed || 0;
      const remainingBalance = reqObj.remainingBalance ?? (totalBudget - totalDisbursed);
      const disbursementProgress = totalBudget > 0 ? Math.round((totalDisbursed / totalBudget) * 100) : 0;
      return { ...reqObj, financeApprovalStep: financeStep, isAwaitingFinance: financeStep?.status === 'pending', financeHasActed: financeStep?.status !== 'pending', totalDisbursed, remainingBalance, disbursementProgress, disbursements: reqObj.disbursements || [] };
    });

    res.json({ success: true, data: enrichedRequisitions, count: enrichedRequisitions.length, pending: enrichedRequisitions.filter(r => r.isAwaitingFinance).length });
  } catch (error) {
    console.error('Get finance requisitions error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch finance requisitions', error: error.message });
  }
};


const getAvailableBuyers = async (req, res) => {
  try {
    const buyers = await User.find({
      $or: [{ role: 'buyer' }, { departmentRole: 'buyer' }, { email: 'lukong.lambert@gratoglobal.com' }],
      isActive: true
    }).select('fullName email buyerDetails department role departmentRole');

    const processedBuyers = buyers.map(buyer => {
      const buyerObj = buyer.toObject();
      if (!buyerObj.buyerDetails) {
        buyerObj.buyerDetails = { specializations: ['General'], maxOrderValue: buyer.email === 'lukong.lambert@gratoglobal.com' ? 10000000 : 5000000, workload: { currentAssignments: 0, monthlyTarget: 20 }, performance: { completedOrders: 0, averageProcessingTime: 0 }, availability: { isAvailable: true } };
      }
      return buyerObj;
    });

    res.json({ success: true, data: processedBuyers, count: processedBuyers.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch available buyers', error: error.message });
  }
};

const getBuyerRequisitions = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    let query = {};

    if (user.role === 'buyer' || user.departmentRole === 'buyer') {
      query = { 'supplyChainReview.assignedBuyer': req.user.userId, status: { $in: ['pending_head_approval', 'approved', 'in_procurement', 'procurement_complete'] } };
    } else if (user.role === 'supply_chain' || user.role === 'admin') {
      query = { 'supplyChainReview.assignedBuyer': { $exists: true }, status: { $in: ['pending_head_approval', 'approved', 'in_procurement', 'procurement_complete'] } };
    } else {
      return res.status(403).json({ success: false, message: 'Access denied - not authorized to view buyer requisitions' });
    }

    const requisitions = await PurchaseRequisition.find(query).populate('employee', 'fullName email department').populate('supplyChainReview.assignedBuyer', 'fullName email role departmentRole').sort({ createdAt: -1 });
    res.json({ success: true, data: requisitions, count: requisitions.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch buyer requisitions', error: error.message });
  }
};


const getHeadApprovalRequisitions = async (req, res) => {
  try {
    console.log('\n=== FETCHING HEAD APPROVAL REQUISITIONS ===');
    const user = await User.findById(req.user.userId);

    // CEO can see both HOB-pending and CEO-pending requisitions
    const canView =
      user.role === 'admin' ||
      user.email === 'kelvin.eyong@gratoglobal.com' ||
      user.email === 'tom@gratoengineering.com' ||
      user.role === 'ceo';

    if (!canView) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const statusFilter = (user.email === 'tom@gratoengineering.com' || user.role === 'ceo')
      ? { status: { $in: ['pending_head_approval', 'pending_ceo_approval'] } }
      : { status: 'pending_head_approval' };

    const requisitions = await PurchaseRequisition.find(statusFilter)
      .populate('employee', 'fullName email department')
      .populate('financeVerification.verifiedBy', 'fullName')
      .populate('supplyChainReview.assignedBuyer', 'fullName email')
      .sort({ createdAt: -1 })
      .lean();

    const transformedRequisitions = requisitions.map(req => ({
      id: req._id,
      requisitionNumber: req.requisitionNumber,
      title: req.title,
      requester: req.employee?.fullName,
      department: req.department,
      category: req.itemCategory,
      budgetXAF: req.budgetXAF,
      urgency: req.urgency,
      expectedDeliveryDate: req.expectedDate,
      status: req.status,
      createdAt: req.createdAt,
      paymentMethod: req.paymentMethod || 'cash',
      financeVerification: {
        budgetAvailable: req.financeVerification?.budgetAvailable,
        assignedBudget: req.financeVerification?.assignedBudget,
        budgetCode: req.financeVerification?.budgetCode,
        comments: req.financeVerification?.comments,
        verifiedBy: req.financeVerification?.verifiedBy?.fullName,
        verificationDate: req.financeVerification?.verificationDate
      },
      sourcingType: req.supplyChainReview?.sourcingType,
      purchaseType: req.supplyChainReview?.purchaseTypeAssigned || req.purchaseType,
      buyerAssignmentDate: req.supplyChainReview?.buyerAssignmentDate,
      assignedBuyer: req.supplyChainReview?.assignedBuyer ? {
        id: req.supplyChainReview.assignedBuyer._id || req.supplyChainReview.assignedBuyer,
        name: req.supplyChainReview.assignedBuyer.fullName,
        email: req.supplyChainReview.assignedBuyer.email
      } : null,
      items: req.items,
      justification: req.justificationOfPurchase,
      deliveryLocation: req.deliveryLocation,
      approvalChain: req.approvalChain,
      headApproval: { decision: req.headApproval?.decision || 'pending', businessDecisions: req.headApproval?.businessDecisions || {} }
    }));

    res.json({ success: true, data: transformedRequisitions, count: transformedRequisitions.length, message: 'Requisitions ready for final approval' });
  } catch (error) {
    console.error('Get head approval requisitions error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch head approval requisitions', error: error.message });
  }
};

const getBudgetCodesForVerification = async (req, res) => {
  try {
    const BudgetCode = require('../models/BudgetCode');
    const { department } = req.query;
    let filter = { active: true };
    if (department) filter.$or = [{ department }, { department: 'General' }];

    const budgetCodes = await BudgetCode.find(filter).select('code name budget used department budgetType').sort({ utilizationPercentage: 1 });

    const formattedCodes = budgetCodes.map(code => ({
      code: code.code,
      name: code.name,
      department: code.department,
      budgetType: code.budgetType,
      totalBudget: code.budget,
      used: code.used,
      available: code.budget - code.used,
      utilizationRate: code.budget > 0 ? Math.round((code.used / code.budget) * 100) : 0,
      status: code.budget > 0 ? ((code.used / code.budget) >= 0.9 ? 'critical' : (code.used / code.budget) >= 0.75 ? 'high' : (code.used / code.budget) >= 0.5 ? 'moderate' : 'low') : 'low'
    }));

    res.json({ success: true, data: formattedCodes, count: formattedCodes.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch budget codes', error: error.message });
  }
};

// Finance Dashboard Data
const getFinanceDashboardData = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const canView = user.role === 'admin' || user.role === 'finance' || user.email === 'ranibellmambo@gratoengineering.com';
    if (!canView) return res.status(403).json({ success: false, message: 'Access denied' });

    const { PENDING, APPROVED } = PurchaseRequisition.STATUS_GROUPS;
    const relevantStatuses = [...new Set([...PENDING, ...APPROVED])];

    const financeRequisitions = await PurchaseRequisition.find({ status: { $in: relevantStatuses } }).populate('employee', 'fullName email department').sort({ createdAt: -1 });

    const stats = { totalValue: 0, pendingVerification: 0, approvedThisMonth: 0, rejectedThisMonth: 0, averageProcessingTime: 0, budgetUtilization: 0 };
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    let processingTimeTotalDays = 0;
    let processingTimeCount = 0;

    financeRequisitions.forEach(req => {
      stats.totalValue += req.budgetXAF || req.supplyChainReview?.estimatedCost || 0;
      if (req.status === 'pending_finance_verification') stats.pendingVerification++;
      const createdDate = new Date(req.createdAt);
      if (createdDate.getMonth() === currentMonth && createdDate.getFullYear() === currentYear) {
        if (req.financeVerification?.decision === 'approved') stats.approvedThisMonth++;
        else if (req.financeVerification?.decision === 'rejected') stats.rejectedThisMonth++;
      }
      // Time from submission to finance verification decision, in days — the real metric
      // 'averageProcessingTime' claims to be, rather than a hardcoded 0.
      if (req.financeVerification?.verificationDate) {
        const days = (new Date(req.financeVerification.verificationDate) - createdDate) / (1000 * 60 * 60 * 24);
        if (days >= 0) { processingTimeTotalDays += days; processingTimeCount++; }
      }
    });

    stats.averageProcessingTime = processingTimeCount > 0 ? Math.round((processingTimeTotalDays / processingTimeCount) * 10) / 10 : 0;

    const BudgetCode = require('../models/BudgetCode');
    const budgetCodeAgg = await BudgetCode.aggregate([
      { $match: { active: true } },
      { $group: { _id: null, totalBudget: { $sum: '$budget' }, totalUsed: { $sum: '$used' } } }
    ]);
    stats.budgetUtilization = (budgetCodeAgg[0] && budgetCodeAgg[0].totalBudget > 0)
      ? Math.round((budgetCodeAgg[0].totalUsed / budgetCodeAgg[0].totalBudget) * 100)
      : 0;

    const pendingDisbursement = await PurchaseRequisition.countDocuments({ status: { $in: ['approved', 'partially_disbursed'] }, remainingBalance: { $gt: 0 } });
    const partiallyDisbursed = await PurchaseRequisition.countDocuments({ status: 'partially_disbursed' });
    const fullyDisbursed = await PurchaseRequisition.countDocuments({ status: 'fully_disbursed' });

    stats.pendingDisbursement = pendingDisbursement;
    stats.partiallyDisbursed = partiallyDisbursed;
    stats.fullyDisbursed = fullyDisbursed;

    res.json({ success: true, data: { statistics: stats, urgentItems: financeRequisitions.filter(req => req.status === 'pending_finance_verification').slice(0, 10), pendingRequisitions: financeRequisitions.filter(req => req.status === 'pending_finance_verification'), totalRequisitions: financeRequisitions.length } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch finance dashboard data', error: error.message });
  }
};


const processSupplyChainBusinessDecisions = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { sourcingType, purchaseType, paymentMethod, assignedBuyer, estimatedCost, budgetXAF, comments } = req.body;

    const user = await User.findById(req.user.userId);
    const canProcess = user.role === 'admin' || user.role === 'supply_chain' || user.email === 'lukong.lambert@gratoglobal.com';
    if (!canProcess) return res.status(403).json({ success: false, message: 'Access denied. Only Supply Chain Coordinator can make these decisions.' });

    const requisition = await PurchaseRequisition.findById(requisitionId).populate('employee', 'fullName email department');
    if (!requisition) return res.status(404).json({ success: false, message: 'Requisition not found' });
    if (requisition.status !== 'pending_supply_chain_review') return res.status(400).json({ success: false, message: `Cannot process at this stage. Current status: ${requisition.status}` });

    const validationErrors = [];
    if (!sourcingType || !['direct_purchase', 'quotation_required', 'tender_process', 'framework_agreement'].includes(sourcingType)) validationErrors.push('Valid sourcing type is required');
    if (!purchaseType || !['opex', 'capex', 'standard', 'emergency'].includes(purchaseType)) validationErrors.push('Valid purchase type is required');
    if (!paymentMethod || !['bank', 'cash'].includes(paymentMethod)) validationErrors.push('Valid payment method (bank or cash) is required');
    if (!assignedBuyer) validationErrors.push('Buyer assignment is required');

    const finalBudget = budgetXAF ? parseFloat(budgetXAF) : requisition.budgetXAF || requisition.financeVerification?.assignedBudget || 0;
    if (!finalBudget || finalBudget <= 0) validationErrors.push('Budget amount is required.');
    if (finalBudget && finalBudget > 999999999) validationErrors.push(`Budget amount exceeds maximum allowed`);
    if (validationErrors.length > 0) return res.status(400).json({ success: false, message: 'Validation failed', errors: validationErrors });

    let budgetAssignedBySupplyChain = false;
    let previousBudget = requisition.budgetXAF;
    if (budgetXAF && parseFloat(budgetXAF) !== requisition.budgetXAF) {
      requisition.budgetXAF = parseFloat(budgetXAF);
      budgetAssignedBySupplyChain = true;
      if (requisition.financeVerification) requisition.financeVerification.assignedBudget = parseFloat(budgetXAF);
    }

    const buyer = await User.findOne({ _id: assignedBuyer, $or: [{ role: 'buyer' }, { departmentRole: 'buyer' }, { email: 'lukong.lambert@gratoglobal.com' }], isActive: true });
    if (!buyer) return res.status(400).json({ success: false, message: 'Invalid buyer selected or buyer is not active' });

    const supplyChainStepIndex = requisition.approvalChain.findIndex(step => step.approver.email.toLowerCase() === user.email.toLowerCase() && step.status === 'pending');
    if (supplyChainStepIndex !== -1) {
      requisition.approvalChain[supplyChainStepIndex].status = 'approved';
      requisition.approvalChain[supplyChainStepIndex].comments = comments;
      requisition.approvalChain[supplyChainStepIndex].actionDate = new Date();
      requisition.approvalChain[supplyChainStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
      requisition.approvalChain[supplyChainStepIndex].decidedBy = req.user.userId;
    }

    requisition.supplyChainReview = { ...requisition.supplyChainReview, sourcingType, purchaseTypeAssigned: purchaseType, assignedBuyer, buyerAssignmentDate: new Date(), buyerAssignedBy: req.user.userId, estimatedCost: estimatedCost || finalBudget, budgetAssignedBySupplyChain, assignedBudget: budgetAssignedBySupplyChain ? parseFloat(budgetXAF) : requisition.budgetXAF, previousBudget: budgetAssignedBySupplyChain ? previousBudget : undefined, comments, decision: 'approve', decisionDate: new Date(), decidedBy: req.user.userId };
    requisition.paymentMethod = paymentMethod;
    requisition.purchaseType = purchaseType;
    requisition.status = 'pending_head_approval';

    await requisition.save();

    res.json({ success: true, message: 'Business decisions recorded successfully', data: { requisitionId: requisition._id, status: requisition.status, paymentMethod: requisition.paymentMethod, budgetInfo: { finalBudget, assignedBySupplyChain: budgetAssignedBySupplyChain, previousBudget } } });
  } catch (error) {
    console.error('Process supply chain business decisions error:', error);
    res.status(500).json({ success: false, message: 'Failed to process business decisions', error: error.message });
  }
};


/**
 * Process head approval decision
 * ENHANCED: CEO-aware — HOB routes to CEO if CEO step exists; CEO approval is final
 */
const processHeadApproval = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { decision, comments } = req.body;

    console.log('=== PROCESS HEAD APPROVAL ===');
    console.log('Requisition ID:', requisitionId);
    console.log('Decision:', decision);

    const user = await User.findById(req.user.userId);

    // Verify authorization — HOB (Kelvin) or CEO (Tom) or admin
    const canApproveHead =
      ['admin', 'supply_chain', 'ceo'].includes(user.role) ||
      user.email === 'kelvin.eyong@gratoglobal.com' ||
      user.email === 'tom@gratoengineering.com';

    if (!canApproveHead) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admin, supply chain head, or CEO can approve.'
      });
    }

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department')
      .populate('supplyChainReview.assignedBuyer', 'fullName email');

    if (!requisition) {
      return res.status(404).json({ success: false, message: 'Requisition not found' });
    }

    // Verify status — HOB approval OR CEO final approval
    const validHeadStatuses = ['pending_head_approval', 'pending_ceo_approval'];
    if (!validHeadStatuses.includes(requisition.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot process approval. Current status: ${requisition.status}`
      });
    }

    // Update head approval record
    requisition.headApproval = {
      decision,
      comments,
      decisionDate: new Date(),
      decidedBy: req.user.userId
    };

    if (decision === 'approved') {
      // Check if there is a CEO step still pending AFTER this approver's step
      const isCEOApprover =
        user.email?.toLowerCase() === 'tom@gratoengineering.com' ||
        user.role === 'ceo';

      const pendingCEOStep = !isCEOApprover && requisition.approvalChain.find(step =>
        step.status === 'pending' &&
        (step.approver.role === 'CEO - Final Authority' ||
         step.approver.email?.toLowerCase() === 'tom@gratoengineering.com')
      );

      if (pendingCEOStep) {
        // HOB approved — move to CEO
        requisition.headApproval = {
          decision: 'approved',
          comments,
          decisionDate: new Date(),
          decidedBy: req.user.userId,
          decidedByRole: 'Head of Business'
        };

        // Update the HOB step in the approval chain
        const hobStepIndex = requisition.approvalChain.findIndex(step =>
          step.status === 'pending' &&
          step.approver.email?.toLowerCase() === user.email?.toLowerCase()
        );
        if (hobStepIndex !== -1) {
          requisition.approvalChain[hobStepIndex].status = 'approved';
          requisition.approvalChain[hobStepIndex].actionDate = new Date();
          requisition.approvalChain[hobStepIndex].decidedBy = req.user.userId;
          requisition.approvalChain[hobStepIndex].comments = comments;
        }

        requisition.status = 'pending_ceo_approval';
        pendingCEOStep.assignedDate = new Date();
        await requisition.save();

        // Notify CEO
        const ceoUser = await User.findOne({ email: 'tom@gratoengineering.com' });
        if (ceoUser) {
          await sendEmail({
            to: ceoUser.email,
            subject: `👑 Final CEO Approval Required - ${requisition.title}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #fff7e6; padding: 20px; border-radius: 8px; border-left: 4px solid #faad14;">
                  <h2 style="color: #faad14; margin-top: 0;">Final CEO Approval Required</h2>
                  <p>Dear ${ceoUser.fullName},</p>
                  <p>A purchase requisition has been approved by the Head of Business and requires your final authorization.</p>
                  <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                    <ul>
                      <li><strong>Employee:</strong> ${requisition.employee?.fullName || 'N/A'}</li>
                      <li><strong>Title:</strong> ${requisition.title}</li>
                      <li><strong>Budget:</strong> XAF ${(requisition.budgetXAF || 0).toLocaleString()}</li>
                      <li><strong>HOB Approved By:</strong> ${user.fullName}</li>
                    </ul>
                  </div>
                </div>
              </div>
            `
          }).catch(err => console.error('Failed to notify CEO:', err));
        }

        return res.json({
          success: true,
          message: 'Head of Business approved — moving to CEO final approval',
          data: {
            requisitionId: requisition._id,
            requisitionNumber: requisition.requisitionNumber,
            status: requisition.status,
            decision: 'approved',
            nextStep: 'CEO Final Approval',
            pettyCashForm: null,
            paymentMethod: requisition.paymentMethod
          }
        });
      }

      // No pending CEO step — this IS the final approval (CEO approving, or chain without CEO)

      // Reserve budget now that the requisition is fully approved, before committing the
      // status change. This closes a gap where budget was only ever decremented at
      // disbursement time, allowing multiple requisitions to be approved against the same
      // budget code beyond its actual remaining capacity.
      if (requisition.budgetCode && requisition.budgetXAF > 0) {
        try {
          const BudgetCode = require('../models/BudgetCode');
          const budgetCodeDoc = await BudgetCode.findById(requisition.budgetCode);
          if (budgetCodeDoc) {
            await budgetCodeDoc.reserveBudget(requisition._id, requisition.budgetXAF, req.user.userId);
          } else {
            console.warn(`Budget code ${requisition.budgetCode} not found during reservation — proceeding without reservation`);
          }
        } catch (budgetError) {
          console.error('Budget reservation failed during final approval:', budgetError);
          return res.status(400).json({
            success: false,
            message: `Cannot finalize approval: ${budgetError.message}`
          });
        }
      }

      requisition.status = 'approved';

      const paymentMethod = requisition.paymentMethod;

      if (paymentMethod === 'cash') {
        console.log('Payment method is cash - generating petty cash form');
        try {
          await requisition.generatePettyCashFormNumber();
          await requisition.save();
          if (requisition.supplyChainReview.assignedBuyer) {
            await sendPettyCashFormNotificationToBuyer(requisition);
          }
          await sendPettyCashFormNotificationToEmployee(requisition);
        } catch (pettyCashError) {
          console.error('Error generating petty cash form:', pettyCashError);
        }
      } else {
        console.log('Payment method is bank - no petty cash form needed');
        await requisition.save();
      }

      try {
        await sendEmail({
          to: requisition.employee.email,
          subject: `Requisition Approved - ${requisition.title}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #f6ffed; padding: 20px; border-radius: 8px; border-left: 4px solid #52c41a;">
                <h2 style="color: #52c41a; margin-top: 0;">✓ Requisition Approved</h2>
                <p>Dear ${requisition.employee.fullName},</p>
                <p>Your purchase requisition has been approved by ${user.fullName}.</p>
                <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <ul>
                    <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                    <li><strong>Title:</strong> ${requisition.title}</li>
                    <li><strong>Budget:</strong> XAF ${requisition.budgetXAF.toLocaleString()}</li>
                    <li><strong>Payment Method:</strong> ${paymentMethod === 'cash' ? 'Petty Cash' : 'Bank Transfer'}</li>
                  </ul>
                </div>
                ${paymentMethod === 'cash' && requisition.pettyCashForm?.formNumber ? `
                <div style="background-color: #fff7e6; padding: 15px; border-radius: 8px;">
                  <h4>Petty Cash Form Generated</h4>
                  <p><strong>Form Number:</strong> ${requisition.pettyCashForm.formNumber}</p>
                </div>` : ''}
                <p>Best regards,<br>Procurement Team</p>
              </div>
            </div>
          `
        });
      } catch (emailError) {
        console.error('Failed to send approval email:', emailError);
      }

    } else if (decision === 'rejected') {
      requisition.status = 'rejected';
      await requisition.save();

      try {
        await sendEmail({
          to: requisition.employee.email,
          subject: `Requisition Rejected - ${requisition.title}`,
          html: `<div style="font-family: Arial, sans-serif;"><h3>Requisition Rejected</h3><p>Dear ${requisition.employee.fullName},</p><p>Rejected by ${user.fullName}. ${comments ? `Reason: ${comments}` : ''}</p></div>`
        });
      } catch (emailError) {
        console.error('Failed to send rejection email:', emailError);
      }
    }

    res.json({
      success: true,
      message: `Requisition ${decision}`,
      data: {
        requisitionId: requisition._id,
        requisitionNumber: requisition.requisitionNumber,
        status: requisition.status,
        decision,
        pettyCashForm: requisition.pettyCashForm?.generated ? {
          formNumber: requisition.pettyCashForm.formNumber,
          generatedDate: requisition.pettyCashForm.generatedDate,
          status: requisition.pettyCashForm.status
        } : null,
        paymentMethod: requisition.paymentMethod
      }
    });

  } catch (error) {
    console.error('Error processing head approval:', error);
    res.status(500).json({ success: false, message: 'Failed to process head approval', error: error.message });
  }
};

// Get head approval requisition (detail view)
const getHeadApprovalRequisition = async (req, res) => {
  try {
    const { requisitionId } = req.params;

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department')
      .populate('financeVerification.verifiedBy', 'fullName email')
      .populate('supplyChainReview.assignedBuyer', 'fullName email')
      .populate('supplyChainReview.decidedBy', 'fullName email')
      .lean();

    if (!requisition) return res.status(404).json({ success: false, message: 'Requisition not found' });

    const formattedResponse = {
      id: requisition._id,
      requisitionNumber: requisition.requisitionNumber,
      title: requisition.title,
      status: requisition.status,
      category: requisition.itemCategory,
      urgency: requisition.urgency,
      budgetXAF: requisition.budgetXAF,
      deliveryLocation: requisition.deliveryLocation,
      expectedDeliveryDate: requisition.expectedDate,
      department: requisition.department,
      createdAt: requisition.createdAt,
      requester: requisition.employee?.fullName,
      requesterEmail: requisition.employee?.email,
      items: requisition.items,
      justification: requisition.justificationOfPurchase,
      financeVerification: {
        budgetAvailable: requisition.financeVerification?.budgetAvailable,
        assignedBudget: requisition.financeVerification?.assignedBudget,
        budgetCode: requisition.financeVerification?.budgetCode,
        comments: requisition.financeVerification?.comments,
        verificationDate: requisition.financeVerification?.verificationDate,
        verifiedBy: requisition.financeVerification?.verifiedBy?.fullName
      },
      supplyChainDecisions: {
        sourcingType: requisition.supplyChainReview?.sourcingType,
        purchaseType: requisition.supplyChainReview?.purchaseTypeAssigned || requisition.purchaseType,
        paymentMethod: requisition.paymentMethod,
        estimatedCost: requisition.supplyChainReview?.estimatedCost,
        decidedBy: requisition.supplyChainReview?.decidedBy?.fullName,
        decisionDate: requisition.supplyChainReview?.decisionDate,
        comments: requisition.supplyChainReview?.comments
      },
      assignedBuyer: requisition.supplyChainReview?.assignedBuyer ? {
        id: requisition.supplyChainReview.assignedBuyer._id || requisition.supplyChainReview.assignedBuyer,
        name: requisition.supplyChainReview.assignedBuyer.fullName,
        email: requisition.supplyChainReview.assignedBuyer.email
      } : null,
      buyerAssignmentDate: requisition.supplyChainReview?.buyerAssignmentDate,
      approvalChain: requisition.approvalChain,
      headApproval: requisition.headApproval || { decision: 'pending', businessDecisions: {} }
    };

    res.json({ success: true, data: formattedResponse });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch requisition', error: error.message });
  }
};

/**
 * Get dashboard statistics for purchase requisitions
 */
const getPurchaseRequisitionDashboardStats = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const user = await User.findById(userId);

    let query = {};
    if (userRole === 'employee') query.employee = userId;
    else if (userRole === 'supervisor' || userRole === 'technical') {
      query.$or = [{ employee: userId }, { 'approvalChain.approver.email': user.email, 'approvalChain.status': 'pending' }];
    } else if (userRole === 'buyer') {
      query.$or = [{ employee: userId }, { 'supplyChainReview.assignedBuyer': userId }];
    } else if (!['admin', 'finance', 'supply_chain', 'hr', 'it', 'hse', 'ceo'].includes(userRole)) {
      query.employee = userId;
    }

    const requisitions = await PurchaseRequisition.find(query);
    const { PENDING, DISBURSEMENT_COMPLETE } = PurchaseRequisition.STATUS_GROUPS;

    let buyerExtras = {};
    if (userRole === 'buyer') {
      const Quote = require('../models/Quote');
      const buyerRequisitionIds = requisitions
        .filter(r => r.supplyChainReview?.assignedBuyer?.equals(userId))
        .map(r => r._id);

      const quotesReceived = await Quote.countDocuments({
        requisitionId: { $in: buyerRequisitionIds },
        status: { $in: ['received', 'evaluated', 'selected'] }
      });

      buyerExtras = {
        inProgress: requisitions.filter(r => r.status === 'in_procurement' && r.supplyChainReview?.assignedBuyer?.equals(userId)).length,
        quotesReceived,
        completed: requisitions.filter(r => DISBURSEMENT_COMPLETE.includes(r.status) && r.supplyChainReview?.assignedBuyer?.equals(userId)).length
      };
    }

    const stats = {
      pending: requisitions.filter(r => PENDING.includes(r.status)).length,
      total: requisitions.length,
      ...buyerExtras
    };

    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error('Error fetching purchase requisition dashboard stats:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch purchase requisition dashboard stats', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};


/**
 * Process disbursement for purchase requisition
 */
const processDisbursement = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { amount, notes } = req.body;

    const disbursementAmount = parseFloat(amount);
    if (isNaN(disbursementAmount) || disbursementAmount <= 0) return res.status(400).json({ success: false, message: 'Invalid disbursement amount' });

    const requisition = await PurchaseRequisition.findById(requisitionId).populate('employee', 'fullName email department').populate('financeVerification.verifiedBy', 'fullName email');
    if (!requisition) return res.status(404).json({ success: false, message: 'Requisition not found' });
    if (!['approved', 'partially_disbursed'].includes(requisition.status)) return res.status(400).json({ success: false, message: `Cannot disburse. Current status: ${requisition.status}` });

    const totalBudget = requisition.budgetXAF || 0;
    const totalDisbursed = requisition.totalDisbursed || 0;
    const remainingBalance = requisition.remainingBalance || (totalBudget - totalDisbursed);

    if (disbursementAmount > remainingBalance) return res.status(400).json({ success: false, message: `Amount exceeds remaining balance. Available: XAF ${remainingBalance.toLocaleString()}` });

    if (requisition.budgetCode) {
      const BudgetCode = require('../models/BudgetCode');
      const budgetCodeDoc = await BudgetCode.findById(requisition.budgetCode);
      if (budgetCodeDoc) {
        try {
          await budgetCodeDoc.deductBudget(requisition._id, disbursementAmount);
        } catch (deductError) {
          // No 'allocated' reservation exists (e.g. requisition approved before this fix, or
          // budget code changed after approval) — fall back to a direct, best-effort update so
          // disbursement isn't blocked, but log it since it means the reservation is out of sync.
          console.warn(`deductBudget failed for requisition ${requisition._id}, falling back to direct update: ${deductError.message}`);
          budgetCodeDoc.used = (budgetCodeDoc.used || 0) + disbursementAmount;
          await budgetCodeDoc.save();
        }
      }
    }

    const disbursementNumber = (requisition.disbursements?.length || 0) + 1;
    if (!requisition.disbursements) requisition.disbursements = [];
    requisition.disbursements.push({ amount: disbursementAmount, date: new Date(), disbursedBy: req.user.userId, notes: notes || '', disbursementNumber });

    requisition.totalDisbursed = (requisition.totalDisbursed || 0) + disbursementAmount;
    requisition.remainingBalance = totalBudget - requisition.totalDisbursed;
    requisition.status = requisition.remainingBalance === 0 ? 'fully_disbursed' : 'partially_disbursed';

    await requisition.save();

    const user = await User.findById(req.user.userId);
    const isFullyDisbursed = requisition.status === 'fully_disbursed';

    await sendEmail({
      to: requisition.employee.email,
      subject: isFullyDisbursed ? `✅ Purchase Requisition Fully Disbursed` : `💰 Partial Disbursement #${disbursementNumber} Processed`,
      html: `<h3>${isFullyDisbursed ? 'Fully Disbursed' : 'Partial Disbursement Processed'}</h3><p>Amount: XAF ${disbursementAmount.toLocaleString()}. Total: XAF ${requisition.totalDisbursed.toLocaleString()}. Remaining: XAF ${requisition.remainingBalance.toLocaleString()}.</p>`
    }).catch(err => console.error('Failed to send disbursement notification:', err));

    res.json({ success: true, message: isFullyDisbursed ? 'Requisition fully disbursed' : `Partial disbursement #${disbursementNumber} processed successfully`, data: requisition, disbursement: { number: disbursementNumber, amount: disbursementAmount, totalDisbursed: requisition.totalDisbursed, remainingBalance: requisition.remainingBalance, progress: Math.round((requisition.totalDisbursed / totalBudget) * 100), isFullyDisbursed } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to process disbursement', error: error.message });
  }
};

/**
 * Get disbursement history
 */
const getDisbursementHistory = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const requisition = await PurchaseRequisition.findById(requisitionId).populate('employee', 'fullName email department').populate('disbursements.disbursedBy', 'fullName email');
    if (!requisition) return res.status(404).json({ success: false, message: 'Requisition not found' });

    res.json({ success: true, data: { requisitionId: requisition._id, requisitionNumber: requisition.requisitionNumber, employee: requisition.employee, budgetXAF: requisition.budgetXAF, totalDisbursed: requisition.totalDisbursed || 0, remainingBalance: requisition.remainingBalance || 0, progress: Math.round(((requisition.totalDisbursed || 0) / requisition.budgetXAF) * 100), status: requisition.status, disbursements: requisition.disbursements || [] } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch disbursement history', error: error.message });
  }
};

/**
 * Get pending disbursements
 */
const getPendingDisbursements = async (req, res) => {
  try {
    const requisitions = await PurchaseRequisition.find({ status: { $in: ['approved', 'partially_disbursed'] }, $expr: { $gt: [{ $subtract: ['$budgetXAF', { $ifNull: ['$totalDisbursed', 0] }] }, 0] } }).populate('employee', 'fullName email department').populate('financeVerification.verifiedBy', 'fullName email').sort({ createdAt: -1 });
    res.json({ success: true, data: requisitions, count: requisitions.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch pending disbursements', error: error.message });
  }
};


/**
 * Submit justification for a fully disbursed purchase requisition
 */
const submitPurchaseRequisitionJustification = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { actualExpenses, totalSpent, changeReturned, justificationSummary } = req.body;

    const requisition = await PurchaseRequisition.findById(requisitionId).populate('employee', 'fullName email department');
    if (!requisition) return res.status(404).json({ success: false, message: 'Purchase requisition not found' });

    const assignedBuyerId = requisition.supplyChainReview?.assignedBuyer?.toString();
    if (!assignedBuyerId || assignedBuyerId !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Access denied. Only the assigned buyer can justify this requisition.' });
    }

    const allowedStatuses = ['approved', 'partially_disbursed', 'fully_disbursed'];
    if (!allowedStatuses.includes(requisition.status)) {
      return res.status(400).json({ success: false, message: `Cannot submit justification for requisitions with status: ${requisition.status}.`, currentStatus: requisition.status });
    }

    let parsedExpenses;
    try { parsedExpenses = typeof actualExpenses === 'string' ? JSON.parse(actualExpenses) : actualExpenses; }
    catch (error) { return res.status(400).json({ success: false, message: 'Invalid expense data format' }); }

    if (!parsedExpenses || !Array.isArray(parsedExpenses) || parsedExpenses.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one expense item is required' });
    }

    let receipts = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const fileMetadata = await saveFile(file, STORAGE_CATEGORIES.PURCHASE_REQUISITIONS, 'receipts', requisitionId);
          receipts.push({ name: file.originalname, publicId: fileMetadata.publicId, url: fileMetadata.url, localPath: fileMetadata.localPath, size: file.size, mimetype: file.mimetype, uploadedAt: new Date(), uploadedBy: req.user.userId });
        } catch (fileError) { console.error(`Error processing ${file.originalname}:`, fileError); continue; }
      }
    }

    const formattedExpenses = parsedExpenses.map(expense => ({ description: expense.description.trim(), amount: parseFloat(expense.amount), category: expense.category.trim(), date: expense.date ? new Date(expense.date) : new Date() }));

    requisition.justification = { actualExpenses: formattedExpenses, totalSpent: parseFloat(totalSpent), changeReturned: parseFloat(changeReturned || 0), justificationSummary, receipts, submittedDate: new Date(), submittedBy: req.user.userId, status: 'pending_supervisor' };
    requisition.status = 'justification_pending_supervisor';

    await requisition.save();

    const supervisorStep = requisition.approvalChain.find(step => step.level === 1);
    if (supervisorStep) {
      await sendEmail({ to: supervisorStep.approver.email, subject: `Justification Submitted - Purchase Requisition ${requisition.requisitionNumber}`, html: `<h3>Purchase Requisition Justification Submitted</h3><p>${requisition.employee.fullName} has submitted justification for review.</p>` }).catch(err => console.error('Failed to notify supervisor:', err));
    }

    res.json({ success: true, message: 'Justification submitted successfully', data: { requisition, justification: { totalSpent: parseFloat(totalSpent), changeReturned: parseFloat(changeReturned || 0), expenseCount: formattedExpenses.length, receiptCount: receipts.length, status: 'pending_supervisor' } } });
  } catch (error) {
    console.error('Submit justification error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit justification', error: error.message });
  }
};

/**
 * Get justification details
 */
const getPurchaseRequisitionJustification = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department')
      .populate('justification.submittedBy', 'fullName email')
      .populate('justification.supervisorReview.reviewedBy', 'fullName email')
      .populate('justification.financeReview.reviewedBy', 'fullName email');

    if (!requisition) return res.status(404).json({ success: false, message: 'Purchase requisition not found' });

    const user = await User.findById(req.user.userId);
    const canView = requisition.employee._id.equals(req.user.userId) || user.role === 'admin' || user.role === 'finance' || requisition.approvalChain.some(step => step.approver.email === user.email);
    if (!canView) return res.status(403).json({ success: false, message: 'Access denied' });

    res.json({ success: true, data: { requisition, justification: requisition.justification } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch justification', error: error.message });
  }
};

/**
 * Download justification receipt
 */
const downloadJustificationReceipt = async (req, res) => {
  try {
    const { requisitionId, receiptId } = req.params;
    const requisition = await PurchaseRequisition.findById(requisitionId);
    if (!requisition) return res.status(404).json({ success: false, message: 'Purchase requisition not found' });

    const receipt = requisition.justification?.receipts?.find(r => r._id.toString() === receiptId);
    if (!receipt) return res.status(404).json({ success: false, message: 'Receipt not found' });

    const filePath = path.join(__dirname, '../', receipt.localPath);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: 'Receipt file not found on server' });

    res.download(filePath, receipt.name);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to download receipt', error: error.message });
  }
};

const acknowledgeDisbursement = async (req, res) => {
  try {
    const { requisitionId, disbursementId } = req.params;
    const { acknowledgmentNotes, acknowledgmentMethod } = req.body;

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department')
      .populate('disbursements.disbursedBy', 'fullName email')
      .populate('disbursements.acknowledgedBy', 'fullName email');

    if (!requisition) return res.status(404).json({ success: false, message: 'Requisition not found' });

    const assignedBuyerId = requisition.supplyChainReview?.assignedBuyer?._id?.toString() ?? requisition.supplyChainReview?.assignedBuyer?.toString();
    if (!assignedBuyerId || assignedBuyerId !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Only the assigned buyer can acknowledge receipt of disbursements' });
    }

    const disbursement = requisition.disbursements.id(disbursementId);
    if (!disbursement) return res.status(404).json({ success: false, message: 'Disbursement not found' });
    if (disbursement.acknowledged) return res.status(400).json({ success: false, message: 'This disbursement has already been acknowledged' });

    disbursement.acknowledged = true;
    disbursement.acknowledgedBy = req.user.userId;
    disbursement.acknowledgmentDate = new Date();
    disbursement.acknowledgmentNotes = acknowledgmentNotes || '';
    disbursement.acknowledgmentMethod = acknowledgmentMethod || 'cash';

    await requisition.save();
    await requisition.populate('disbursements.acknowledgedBy', 'fullName email');

    const financeUser = await User.findById(disbursement.disbursedBy);
    if (financeUser) {
      await sendEmail({ to: financeUser.email, subject: `Disbursement Acknowledged - ${requisition.requisitionNumber}`, html: `<h3>Disbursement Receipt Acknowledged</h3><p>${requisition.employee.fullName} confirmed receipt of XAF ${disbursement.amount.toLocaleString()}.</p>` }).catch(err => console.error('Failed to send acknowledgment notification:', err));
    }

    res.json({ success: true, message: 'Disbursement receipt acknowledged successfully', data: { disbursement: { _id: disbursement._id, disbursementNumber: disbursement.disbursementNumber, amount: disbursement.amount, acknowledged: disbursement.acknowledged, acknowledgedBy: disbursement.acknowledgedBy, acknowledgmentDate: disbursement.acknowledgmentDate, acknowledgmentMethod: disbursement.acknowledgmentMethod, acknowledgmentNotes: disbursement.acknowledgmentNotes }, requisition: requisition.toObject() } });
  } catch (error) {
    console.error('Acknowledge disbursement error:', error);
    res.status(500).json({ success: false, message: 'Failed to acknowledge disbursement', error: error.message });
  }
};


/**
 * Process justification decision — works for ALL roles in the justification chain:
 * supervisor → finance → supply_chain → head → CEO
 *
 * Status flow:
 *   justification_pending_supervisor
 *     → (approved) justification_pending_finance
 *     → (approved) justification_pending_supply_chain
 *     → (approved) justification_pending_head
 *     → (approved) justification_pending_ceo  [if CEO step exists]
 *     → (approved) justification_approved / completed
 *   Any step rejected → justification_rejected_<role>
 */
const processJustificationDecision = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { decision, comments } = req.body;

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department')
      .populate('supplyChainReview.assignedBuyer', 'fullName email');

    if (!requisition) return res.status(404).json({ success: false, message: 'Requisition not found' });

    // Must be in a justification-pending status
    const JUSTIFICATION_PENDING = [
      'justification_pending_supervisor',
      'justification_pending_finance',
      'justification_pending_supply_chain',
      'justification_pending_head',
      'justification_pending_ceo',
    ];

    if (!JUSTIFICATION_PENDING.includes(requisition.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot process justification decision. Current status: ${requisition.status}`
      });
    }

    // Role-to-status mapping (who can act at which status)
    const statusRoleMap = {
      justification_pending_supervisor:   ['employee', 'supervisor', 'technical', 'hr', 'supply_chain', 'finance', 'admin'],
      justification_pending_finance:      ['finance', 'admin'],
      justification_pending_supply_chain: ['supply_chain', 'admin'],
      justification_pending_head:         ['supply_chain', 'admin'],   // Head of Business uses supply_chain dashboard
      justification_pending_ceo:          ['ceo', 'admin'],
    };

    const allowedRoles = statusRoleMap[requisition.status] || [];

    // For supervisor step, also check the approval chain
    const isSupervisorStep = requisition.status === 'justification_pending_supervisor';
    if (isSupervisorStep) {
      const hasChainMatch = requisition.approvalChain?.some(
        step => step.approver.email.toLowerCase() === user.email.toLowerCase() && step.status === 'approved'
      );
      const isFinanceUser  = user.role === 'finance';
      const isAdminUser    = user.role === 'admin';
      if (!hasChainMatch && !isFinanceUser && !isAdminUser) {
        return res.status(403).json({ success: false, message: 'You are not in the approval chain for this requisition' });
      }
    } else {
      // CEO step: also allow by email
      const isCEO = user.role === 'ceo' || user.email === 'tom@gratoengineering.com';
      if (!allowedRoles.includes(user.role) && !isCEO) {
        return res.status(403).json({ success: false, message: 'Access denied for this justification stage' });
      }
    }

    // Status transition map
    const NEXT_STATUS = {
      justification_pending_supervisor:   'justification_pending_finance',
      justification_pending_finance:      'justification_pending_supply_chain',
      justification_pending_supply_chain: 'justification_pending_head',
      justification_pending_head:         'justification_pending_ceo',
      justification_pending_ceo:          'justification_approved',
    };

    // Rejection status map
    const REJECTED_STATUS = {
      justification_pending_supervisor:   'justification_rejected_supervisor',
      justification_pending_finance:      'justification_rejected_finance',
      justification_pending_supply_chain: 'justification_rejected_supply_chain',
      justification_pending_head:         'justification_rejected_head',
      justification_pending_ceo:          'justification_rejected_ceo',
    };

    // Role name for review record
    const ROLE_NAMES = {
      justification_pending_supervisor:   'supervisor',
      justification_pending_finance:      'finance',
      justification_pending_supply_chain: 'supply_chain',
      justification_pending_head:         'head',
      justification_pending_ceo:          'ceo',
    };

    const currentStage = ROLE_NAMES[requisition.status];
    const reviewKey    = `${currentStage}Review`;

    // Record the review decision on the justification sub-document
    requisition.justification = requisition.justification || {};
    requisition.justification[reviewKey] = {
      decision,
      comments,
      reviewedBy:   req.user.userId,
      reviewedDate: new Date()
    };

    if (decision === 'approved') {
      const nextStatus = NEXT_STATUS[requisition.status];

      // Check if the CEO step actually exists in the approval chain.
      // If moving to justification_pending_ceo but there's no CEO approver in the chain, skip to approved.
      if (nextStatus === 'justification_pending_ceo') {
        const hasCEOInChain = requisition.approvalChain?.some(
          s => s.approver.role === 'CEO - Final Authority' ||
               s.approver.email?.toLowerCase() === 'tom@gratoengineering.com'
        );
        if (!hasCEOInChain) {
          requisition.status = 'justification_approved';
          requisition.justification.status = 'approved';
          requisition.status = 'completed';
        } else {
          requisition.status = nextStatus;
          requisition.justification.status = nextStatus.replace('justification_pending_', 'pending_');
        }
      } else if (nextStatus === 'justification_approved') {
        requisition.status = 'completed';
        requisition.justification.status = 'approved';
      } else {
        requisition.status = nextStatus;
        requisition.justification.status = nextStatus.replace('justification_pending_', 'pending_');
      }
    } else {
      // Rejected
      requisition.status = REJECTED_STATUS[requisition.status];
      requisition.justification.status = 'rejected';
    }

    await requisition.save();

    // Notification helpers
    const notifications = [];
    const { sendEmail } = require('../services/emailService');
    const employeeEmail  = requisition.employee?.email;
    const employeeName   = requisition.employee?.fullName;

    if (decision === 'approved') {
      // Notify the next approver
      const nextApproverEmails = {
        justification_pending_finance:      'ranibellmambo@gratoengineering.com',
        justification_pending_supply_chain: 'lukong.lambert@gratoglobal.com',
        justification_pending_head:         'kelvin.eyong@gratoglobal.com',
        justification_pending_ceo:          'tom@gratoengineering.com',
      };
      const nextEmail = nextApproverEmails[requisition.status];
      if (nextEmail) {
        notifications.push(sendEmail({
          to: nextEmail,
          subject: `Justification Awaiting Your Review — ${requisition.requisitionNumber}`,
          html: `<h3>Purchase Requisition Justification</h3>
                 <p>The justification for requisition <strong>${requisition.requisitionNumber}</strong> 
                 submitted by <strong>${employeeName}</strong> is ready for your review.</p>
                 <p>Please log in to review and approve or reject.</p>`
        }).catch(e => ({ error: e })));
      }

      // Notify employee on final approval
      if (requisition.status === 'completed') {
        notifications.push(sendEmail({
          to: employeeEmail,
          subject: `Justification Fully Approved — ${requisition.requisitionNumber}`,
          html: `<h3>Your justification has been fully approved</h3>
                 <p>The justification for requisition <strong>${requisition.requisitionNumber}</strong> 
                 has been approved by all levels. The request is now complete.</p>`
        }).catch(e => ({ error: e })));
      } else {
        notifications.push(sendEmail({
          to: employeeEmail,
          subject: `Justification Approved at Level — ${requisition.requisitionNumber}`,
          html: `<h3>Justification Moving Forward</h3>
                 <p>Your justification for <strong>${requisition.requisitionNumber}</strong> 
                 was approved by ${user.fullName} and is progressing to the next level.</p>`
        }).catch(e => ({ error: e })));
      }
    } else {
      // Rejected — notify employee
      notifications.push(sendEmail({
        to: employeeEmail,
        subject: `Justification Rejected — ${requisition.requisitionNumber}`,
        html: `<h3>Justification Returned for Revision</h3>
               <p>Your justification for <strong>${requisition.requisitionNumber}</strong> 
               was rejected by <strong>${user.fullName}</strong>.</p>
               <p><strong>Reason:</strong> ${comments || 'No reason provided'}</p>
               <p>Please revise and resubmit your justification.</p>`
      }).catch(e => ({ error: e })));
    }

    await Promise.allSettled(notifications);

    res.json({
      success: true,
      message: `Justification ${decision === 'approved' ? 'approved' : 'rejected'} successfully`,
      data: {
        requisitionId: requisition._id,
        requisitionNumber: requisition.requisitionNumber,
        previousStatus: JUSTIFICATION_PENDING.find(s => s === requisition.justification?.[`${currentStage}Review`]?.decision) || currentStage,
        newStatus: requisition.status,
        decision,
        reviewedBy: user.fullName,
        reviewedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Process justification decision error:', error);
    res.status(500).json({ success: false, message: 'Failed to process justification decision', error: error.message });
  }
};

// Export all functions
module.exports = {
  createRequisition,
  updateRequisition,
  deleteRequisition,
  getEmployeeRequisitions,
  getEmployeeRequisition,
  getSupervisorRequisitions,
  getSupervisorRequisition,
  processSupervisorDecision,
  getSupplyChainRequisitions,
  // processSupplyChainDecision intentionally NOT exported: unreachable dead code superseded by
  // processSupplyChainBusinessDecisions (see /:requisitionId/supply-chain-decisions route) and
  // processJustificationDecision (see /:requisitionId/justification-decision route). Left in
  // place rather than deleted to avoid breaking anything that might still reference it directly
  // via require(); scheduled for removal in a future cleanup pass.
  updateProcurementStatus,
  getFinanceRequisitions,
  processFinanceDecision,
  getAllRequisitions,
  getAdminRequisitionDetails,
  getApprovalChainPreview,
  getRequisitionsByRole,
  getDashboardStats,
  getCategoryAnalytics,
  getVendorPerformance,
  getRequisitionStats,
  getProcurementPlanningData,
  getBuyerAssignmentTracking,
  exportRequisitionReport,
  processFinanceVerification,
  assignBuyer,
  assignBuyerWithPaymentMethod,
  getPaymentMethodOptions,
  processHeadApproval,
  getBuyerRequisitions,
  getAvailableBuyers,
  getHeadApprovalRequisitions,
  getHeadApprovalRequisition,
  getBudgetCodesForVerification,
  getFinanceDashboardData,
  processSupplyChainBusinessDecisions,
  getPurchaseRequisitionDashboardStats,
  getPendingHeadApprovals,
  getHeadApprovalStats,
  sendPettyCashFormNotificationToBuyer,
  sendPettyCashFormNotificationToEmployee,
  getRequisitionDetails,
  saveDraft,
  generatePettyCashFormPDF,
  processDisbursement,
  getDisbursementHistory,
  getPendingDisbursements,
  submitPurchaseRequisitionJustification,
  getPurchaseRequisitionJustification,
  downloadJustificationReceipt,
  processJustificationDecision,
  acknowledgeDisbursement
};


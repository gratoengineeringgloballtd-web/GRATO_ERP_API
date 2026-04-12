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
} = require('../utils/localFileStorage');
const cancellationController = require('../controllers/Cancellationcontroller');



const generatePettyCashFormPDF = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const user = await User.findById(req.user.userId);

    console.log('=== GENERATE PETTY CASH FORM PDF ===');
    console.log('Requisition ID:', requisitionId);
    console.log('Requested by:', user.email);

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('requestedBy', 'fullName email department position')
      .populate('employee', 'fullName email department position') // ✅ Also populate employee
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

    // Verify user has access
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

    // ✅ Transform data for PDF service (map requestedBy to employee for consistency)
    const pdfData = {
      ...requisition.toObject(),
      employee: requester, // ✅ Use requestedBy as employee
      displayId: requisition.pettyCashForm?.formNumber || `PCF-${requisition._id.toString().slice(-6).toUpperCase()}`,
      items: requisition.items || []
    };

    // Generate PDF
    const PDFService = require('../services/pdfService');
    const pdfResult = await PDFService.generatePettyCashFormPDF(
      pdfData,
      null
    );

    if (!pdfResult.success) {
      throw new Error('PDF generation failed');
    }

    // ✅ NO SAVE - Just send the PDF
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
      budgetCode, // ✅ NEW: Budget code from employee
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

    // Validate required fields
    if (!requisitionNumber) {
      return res.status(400).json({
        success: false,
        message: 'Requisition number is required'
      });
    }

    const justification = justificationOfPurchase || req.body.justificationOfPurchase;
    
    if (!justification || justification.length < 20) {
      return res.status(400).json({
        success: false,
        message: 'Justification of purchase must be at least 20 characters long'
      });
    }

    // ✅ NEW: Validate budget code is provided
    if (!budgetCode) {
      return res.status(400).json({
        success: false,
        message: 'Budget code selection is required'
      });
    }

    // Get user details
    const employee = await User.findById(req.user.userId);
    if (!employee) {
      return res.status(404).json({ 
        success: false, 
        message: 'Employee not found' 
      });
    }

    console.log('Employee details:', {
      fullName: employee.fullName,
      department: employee.department,
      email: employee.email
    });

    // ✅ NEW: Validate budget code and check availability
    const BudgetCode = require('../models/BudgetCode');
    const selectedBudgetCode = await BudgetCode.findById(budgetCode);

    if (!selectedBudgetCode) {
      return res.status(400).json({
        success: false,
        message: 'Invalid budget code selected'
      });
    }

    if (!selectedBudgetCode.active || selectedBudgetCode.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Selected budget code is not active'
      });
    }

    const estimatedCost = budgetXAF ? parseFloat(budgetXAF) : 0;
    const availableBudget = selectedBudgetCode.budget - selectedBudgetCode.used;

    console.log('Budget check:', {
      budgetCode: selectedBudgetCode.code,
      estimatedCost: estimatedCost,
      availableBudget: availableBudget
    });

    // ✅ NEW: Check if sufficient budget is available
    if (estimatedCost > availableBudget) {
      return res.status(400).json({
        success: false,
        message: `Insufficient budget. Available: XAF ${availableBudget.toLocaleString()}, Required: XAF ${estimatedCost.toLocaleString()}`
      });
    }

    // Parse items if it's a string
    let parsedItems;
    try {
      parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
    } catch (error) {
      console.error('Items parsing error:', error);
      return res.status(400).json({
        success: false,
        message: 'Invalid items format'
      });
    }

    // Validate items
    if (!parsedItems || !Array.isArray(parsedItems) || parsedItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one item must be specified'
      });
    }

    console.log('Parsed items:', parsedItems);

    // Validate items exist in database

    // Validate each itemId individually (allow duplicates with different descriptions)
    for (const item of parsedItems) {
      if (!item.itemId) {
        return res.status(400).json({
          success: false,
          message: 'All items must have valid database references (itemId)'
        });
      }
      try {
        const Item = require('../models/Item');
        const validItem = await Item.findOne({ _id: item.itemId, isActive: true }).select('_id');
        if (!validItem) {
          return res.status(400).json({
            success: false,
            message: `Invalid or inactive items: ${item.itemId}`
          });
        }
      } catch (itemError) {
        console.error('Item validation error:', itemError);
        // Continue anyway - validation is optional for now
      }
    }
    console.log('All items validated successfully');

    // Transform items to match database structure
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

    console.log('Processed items:', processedItems);

    // Generate approval chain using employee EMAIL
    const approvalChain = getApprovalChainForRequisition(employee.email);
    console.log('Generated approval chain:', JSON.stringify(approvalChain, null, 2));

    if (!approvalChain || approvalChain.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Unable to determine approval chain. Please contact HR for assistance.'
      });
    }

    // Process attachments using LOCAL STORAGE (like petty cash)
    let attachments = [];
    if (req.files && req.files.length > 0) {
      console.log(`\n📎 Processing ${req.files.length} attachment(s) using local storage...`);

      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];

        try {
          console.log(`   Processing file ${i + 1}/${req.files.length}: ${file.originalname}`);

          const fileMetadata = await saveFile(
            file,
            STORAGE_CATEGORIES.PURCHASE_REQUISITIONS,
            'attachments',
            null
          );

          attachments.push({
            name: file.originalname,
            publicId: fileMetadata.publicId,
            url: fileMetadata.url,
            localPath: fileMetadata.localPath,
            size: file.size,
            mimetype: file.mimetype,
            uploadedAt: new Date()
          });

          console.log(`   ✅ Saved: ${fileMetadata.publicId}`);

        } catch (fileError) {
          console.error(`   ❌ Error processing ${file.originalname}:`, fileError);
          continue;
        }
      }

      console.log(`\n✅ ${attachments.length} attachment(s) processed successfully`);
    }

    // Get supplier information
    let preferredSupplier = '';
    if (supplierId) {
      const supplier = await User.findById(supplierId);
      if (supplier) {
        preferredSupplier = supplier.supplierDetails?.companyName || supplier.fullName;
      }
    } else if (preferredSupplierName) {
      preferredSupplier = preferredSupplierName;
    }

    // ✅ NEW: Create requisition with budget code information
    const requisition = new PurchaseRequisition({
      requisitionNumber,
      employee: req.user.userId,
      title,
      department: employee.department,
      itemCategory,
      budgetXAF: estimatedCost,
      budgetCode: selectedBudgetCode._id, // ✅ Store budget code reference
      budgetCodeInfo: { // ✅ Store snapshot of budget code info at submission
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

    console.log('Requisition object before save:', {
      requisitionNumber: requisition.requisitionNumber,
      budgetCode: selectedBudgetCode.code,
      budgetXAF: requisition.budgetXAF,
      itemsCount: requisition.items.length,
      attachmentsCount: requisition.attachments.length,
      approvalChainCount: requisition.approvalChain.length
    });

    await requisition.save();
    console.log('✅ Requisition saved successfully with ID:', requisition._id);
    console.log(`   Budget Code: ${selectedBudgetCode.code}`);
    console.log(`   Budget Amount: XAF ${estimatedCost.toLocaleString()}`);
    console.log(`   Available Budget: XAF ${availableBudget.toLocaleString()}`);

    // Populate employee details for response
    await requisition.populate('employee', 'fullName email department');
    await requisition.populate('budgetCode', 'code name budget used');
    
    if (requisition.project) {
      await requisition.populate('project', 'name code');
    }
    
    if (requisition.supplierId) {
      await requisition.populate('supplierId', 'fullName email supplierDetails');
    }

    // === EMAIL NOTIFICATIONS ===
    const notifications = [];
    console.log('=== STARTING EMAIL NOTIFICATIONS ===');

    const firstApprover = approvalChain[0];
    console.log('First approver details:', firstApprover);

    if (firstApprover && firstApprover.approver.email) {
      console.log('Sending notification to first approver:', firstApprover.approver.email);
      
      try {
        const supervisorNotification = await sendEmail({
          to: firstApprover.approver.email,
          subject: `New Purchase Requisition Requires Your Approval - ${employee.fullName}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <h2 style="color: #1890ff; margin: 0;">New Purchase Requisition for Approval</h2>
                <p style="color: #666; margin: 5px 0 0 0;">A new purchase requisition has been submitted and requires your approval.</p>
              </div>

              <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                <h3 style="color: #333; margin-top: 0;">Requisition Details</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Requisition Number:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${requisition.requisitionNumber}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Employee:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${employee.fullName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Department:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${employee.department}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Title:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${title}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Budget:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">XAF ${estimatedCost.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Budget Code:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${selectedBudgetCode.code} - ${selectedBudgetCode.name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Items Count:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${parsedItems.length}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Urgency:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${urgency}</td>
                  </tr>
                </table>
              </div>

              <div style="background-color: #f0f8ff; border-left: 4px solid #1890ff; padding: 15px; margin: 20px 0;">
                <h4 style="margin: 0 0 10px 0; color: #1890ff;">Justification</h4>
                <p style="margin: 0; color: #333;">${justification}</p>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/supervisor/purchase-requisitions" 
                   style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                  Review Requisition
                </a>
              </div>
            </div>
          `
        });

        console.log('Supervisor notification result:', supervisorNotification);
        notifications.push(Promise.resolve(supervisorNotification));

      } catch (error) {
        console.error('Failed to send supervisor notification:', error);
        notifications.push(Promise.resolve({ error, type: 'supervisor' }));
      }
    }

    // Wait for all notifications to complete
    const notificationResults = await Promise.allSettled(notifications);
    
    const notificationStats = {
      sent: notificationResults.filter(r => r.status === 'fulfilled' && !r.value?.error).length,
      failed: notificationResults.filter(r => r.status === 'rejected' || r.value?.error).length
    };

    console.log('=== PURCHASE REQUISITION CREATED SUCCESSFULLY ===');

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

    // Clean up uploaded files if request failed
    if (req.files && req.files.length > 0) {
      console.log('Cleaning up uploaded files due to error...');
      await Promise.allSettled(
        req.files.map(file => {
          if (file.path && fsSync.existsSync(file.path)) {
            return fs.unlink(file.path).catch(e => 
              console.error('File cleanup failed:', e)
            );
          }
        })
      );
    }

    let errorMessage = 'Failed to create purchase requisition';
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      errorMessage = `Validation failed: ${validationErrors.join(', ')}`;
    }

    res.status(500).json({
      success: false,
      message: errorMessage,
      error: error.message,
      details: error.name === 'ValidationError' ? error.errors : undefined
    });
  }
};



/**
 * Get requisitions pending head approval
 * ENHANCED: Supports filtering by status/tab
 */
const getPendingHeadApprovals = async (req, res) => {
  try {
    const { status, tab, page = 1, limit = 20 } = req.query;
    
    console.log('=== GET PENDING HEAD APPROVALS ===');
    console.log('User:', req.user.userId);
    console.log('Filters:', { status, tab });
    
    const user = await User.findById(req.user.userId);
    
    // Verify user is authorized (admin or supply_chain head)
    if (!['admin', 'supply_chain'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admin or supply chain head can access this.'
      });
    }
    
    // Build query based on tab
    let query = {};
    
    switch (tab) {
      case 'pending':
        query.status = 'pending_head_approval';
        break;
      case 'approved':
        query.status = 'approved';
        query['headApproval.decision'] = 'approved';
        break;
      case 'rejected':
        query['headApproval.decision'] = 'rejected';
        break;
      case 'all':
        query.status = { 
          $in: ['pending_head_approval', 'approved', 'rejected'] 
        };
        break;
      default:
        query.status = 'pending_head_approval';
    }
    
    // Apply additional status filter if provided
    if (status && !tab) {
      query.status = status;
    }
    
    console.log('Query:', JSON.stringify(query, null, 2));
    
    const requisitions = await PurchaseRequisition.find(query)
      .populate('employee', 'fullName email department')
      .populate('supplyChainReview.assignedBuyer', 'fullName email')
      .populate('headApproval.decidedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await PurchaseRequisition.countDocuments(query);
    
    console.log(`Found ${requisitions.length} requisitions`);
    
    // Transform data for frontend
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
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requisitions',
      error: error.message
    });
  }
};

/**
 * Get head approval statistics
 */
const getHeadApprovalStats = async (req, res) => {
  try {
    console.log('=== GET HEAD APPROVAL STATS ===');
    
    const user = await User.findById(req.user.userId);
    
    // Verify authorization
    if (!['admin', 'supply_chain'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    // Get pending count
    const pending = await PurchaseRequisition.countDocuments({
      status: 'pending_head_approval'
    });
    
    // Get approved today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    
    const approvedToday = await PurchaseRequisition.countDocuments({
      'headApproval.decision': 'approved',
      'headApproval.decisionDate': { $gte: startOfDay }
    });
    
    // Get total pending value
    const pendingRequisitions = await PurchaseRequisition.find({
      status: 'pending_head_approval'
    });
    
    const totalPendingValue = pendingRequisitions.reduce((sum, req) => {
      return sum + (req.budgetXAF || req.financeVerification?.assignedBudget || 0);
    }, 0);
    
    // Get petty cash forms generated today
    const pettyCashFormsGenerated = await PurchaseRequisition.countDocuments({
      'pettyCashForm.generated': true,
      'pettyCashForm.generatedDate': { $gte: startOfDay }
    });
    
    const stats = {
      pending,
      approvedToday,
      totalPendingValue,
      pettyCashFormsGenerated,
      generatedAt: new Date()
    };
    
    console.log('Head approval stats:', stats);
    
    res.json({
      success: true,
      data: stats
    });
    
  } catch (error) {
    console.error('Get head approval stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
      error: error.message
    });
  }
};


/**
 * Get requisition details for head approval
 */
const getRequisitionDetails = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    
    console.log('=== GET REQUISITION DETAILS FOR HEAD APPROVAL ===');
    console.log('Requisition ID:', requisitionId);
    
    const user = await User.findById(req.user.userId);
    
    // Verify authorization
    if (!['admin', 'supply_chain'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department phone')
      .populate('supplyChainReview.assignedBuyer', 'fullName email')
      .populate('supplyChainReview.buyerAssignedBy', 'fullName email')
      .populate('financeVerification.verifiedBy', 'fullName email')
      .populate('headApproval.decidedBy', 'fullName email')
      .populate('approvalChain.decidedBy', 'fullName email role');
    
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }
    
    // Transform data
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
    
    res.json({
      success: true,
      data: details
    });
    
  } catch (error) {
    console.error('Get requisition details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requisition details',
      error: error.message
    });
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
            
            <div style="background-color: #e6f7ff; padding: 15px; border-radius: 8px; margin: 15px 0;">
              <h4 style="color: #1890ff; margin-top: 0;">Action Required</h4>
              <p>Please log in to your buyer dashboard to:</p>
              <ul>
                <li>Download the petty cash form PDF</li>
                <li>Review all requisition details</li>
                <li>Track the form status</li>
              </ul>
            </div>
            
            <div style="margin: 20px 0; text-align: center;">
              <a href="${process.env.FRONTEND_URL}/buyer/petty-cash" 
                 style="background-color: #faad14; color: white; padding: 12px 24px; 
                        text-decoration: none; border-radius: 4px; display: inline-block;">
                View Petty Cash Forms
              </a>
            </div>
            
            <p style="color: #666; font-size: 12px; margin-top: 20px;">
              Note: You can download this form multiple times if needed. All downloads are tracked for audit purposes.
            </p>
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
            
            <div style="background-color: #fff7e6; padding: 15px; border-radius: 8px; margin: 15px 0;">
              <h4>Petty Cash Form</h4>
              <p><strong>Form Number:</strong> ${requisition.pettyCashForm.formNumber}</p>
              <p>The assigned buyer will handle the petty cash disbursement process.</p>
            </div>
            
            <p><strong>Next Steps:</strong></p>
            <ul>
              <li>Your assigned buyer will download the petty cash form</li>
              <li>The procurement process will continue as scheduled</li>
              <li>You will be notified of any updates</li>
            </ul>
            
            <p>You can track your requisition status in your employee dashboard.</p>
            
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

    res.json({
      success: true,
      data: requisitions,
      count: requisitions.length
    });

  } catch (error) {
    console.error('Get employee requisitions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requisitions',
      error: error.message
    });
  }
};

// Get single requisition details with approval chain
const getEmployeeRequisition = async (req, res) => {
  try {
    const { requisitionId } = req.params;

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    // Check if user has permission to view this requisition
    const user = await User.findById(req.user.userId);
    const canView = 
      requisition.employee._id.equals(req.user.userId) || // Owner
      user.role === 'admin' || // Admin
      requisition.approvalChain.some(step => step.approver.email === user.email); // Approver

    if (!canView) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: requisition
    });

  } catch (error) {
    console.error('Get requisition details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requisition details',
      error: error.message
    });
  }
};

// Admin functions
const getAllRequisitions = async (req, res) => {
  try {
    const { status, department, page = 1, limit = 20 } = req.query;

    let filter = {};
    if (status) filter.status = status;
    if (department) {
      // Find users in the specified department
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
      pagination: {
        current: page,
        total: Math.ceil(total / limit),
        count: requisitions.length,
        totalRecords: total
      }
    });

  } catch (error) {
    console.error('Get all requisitions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requisitions',
      error: error.message
    });
  }
};

// Get supervisor requisitions (pending approval)
const getSupervisorRequisitions = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // // Find requisitions where current user is in the approval chain and status is pending
    // const requisitions = await PurchaseRequisition.find({
    //   $or: [
    //     {
    //       'approvalChain': {
    //         $elemMatch: {
    //           'approver.email': user.email,
    //           'status': 'pending'
    //         }
    //       },
    //       status: { $in: ['pending_supervisor'] }
    //     },
    //     {
    //       'approvalChain': {
    //         $elemMatch: {
    //           'approver.email': user.email
    //         }
    //       },
    //       status: { $in: ['justification_pending_supervisor'] }
    //     }
    //   ]
    // })
    const requisitions = await PurchaseRequisition.find({
  $or: [
    // Existing: normal approval flow
    {
      'approvalChain': {
        $elemMatch: {
          'approver.email': user.email,
          'status': 'pending'
        }
      },
      status: { $in: ['pending_supervisor'] }
    },
    // Existing: justification flow
    {
      'approvalChain': {
        $elemMatch: {
          'approver.email': user.email
        }
      },
      status: { $in: ['justification_pending_supervisor'] }
    },
    // NEW: cancellation approval flow
    {
      status: 'pending_cancellation',
      'cancellationRequest.approvalChain': {
        $elemMatch: {
          'approver.email': user.email,
          'status': 'pending'
        }
      }
    }
  ]
})
// .populate('employee', 'fullName email department')
// .sort({ createdAt: -1 });
    .populate('employee', 'fullName email department')
    .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: requisitions,
      count: requisitions.length
    });

  } catch (error) {
    console.error('Get supervisor requisitions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requisitions',
      error: error.message
    });
  }
};

// Process supervisor decision
const processSupervisorDecision = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { decision, comments } = req.body;

    console.log('=== SUPERVISOR DECISION PROCESSING ===');
    console.log('Requisition ID:', requisitionId);
    console.log('Decision:', decision);

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');

    if (!requisition) {
      return res.status(404).json({ 
        success: false, 
        message: 'Purchase requisition not found' 
      });
    }

    // ✅ Justification approval flow (Requester line supervisor)
    if (requisition.status === 'justification_pending_supervisor') {
      requisition.justification = requisition.justification || {};

      requisition.justification.supervisorReview = {
        decision,
        comments,
        reviewedBy: req.user.userId,
        reviewedDate: new Date()
      };

      if (decision === 'approved') {
        requisition.status = 'justification_pending_finance';
        requisition.justification.status = 'pending_finance';
      } else {
        requisition.status = 'justification_rejected';
        requisition.justification.status = 'rejected';
      }

      await requisition.save();

      return res.json({
        success: true,
        message: `Justification ${decision}`,
        data: requisition
      });
    }

    // Find current user's step in approval chain
    const currentStepIndex = requisition.approvalChain.findIndex(
      step => step.approver.email === user.email && step.status === 'pending'
    );

    if (currentStepIndex === -1) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to approve this requisition or it has already been processed'
      });
    }

    // Update the approval step
    requisition.approvalChain[currentStepIndex].status = decision;
    requisition.approvalChain[currentStepIndex].comments = comments;
    requisition.approvalChain[currentStepIndex].actionDate = new Date();
    requisition.approvalChain[currentStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
    requisition.approvalChain[currentStepIndex].decidedBy = req.user.userId;

    // Update overall requisition status based on decision
    if (decision === 'rejected') {
      requisition.status = 'rejected';

      // Also update the legacy supervisorDecision field for backward compatibility
      requisition.supervisorDecision = {
        decision: 'rejected',
        comments,
        decisionDate: new Date(),
        decidedBy: req.user.userId
      };
    } else if (decision === 'approved') {
      // Check if this was the last supervisor step before finance
      const remainingApprovalSteps = requisition.approvalChain.filter(step => 
        step.status === 'pending' && 
        step.level < requisition.approvalChain.find(s => s.approver.role.includes('Finance'))?.level
      );

      if (remainingApprovalSteps.length === 1 && remainingApprovalSteps[0]._id.equals(requisition.approvalChain[currentStepIndex]._id)) {
        // This was the last supervisor/hod approval step - move to finance verification
        requisition.status = 'pending_finance_verification';
      } else {
        // Move to next supervisor/department head level
        const nextStep = requisition.approvalChain.find(step => 
          step.level > requisition.approvalChain[currentStepIndex].level && 
          step.status === 'pending' &&
          !step.approver.role.includes('Finance') &&
          !step.approver.role.includes('Head of Business')
        );

        if (nextStep) {
          requisition.status = 'pending_supervisor';
        } else {
          // No more supervisor steps, move to finance
          requisition.status = 'pending_finance_verification';
        }
      }
    }

    await requisition.save();

    // Send notifications based on decision
    const notifications = [];

    if (decision === 'approved') {
      // Check if there are more approval steps or if it goes to supply chain
      if (requisition.status === 'pending_supply_chain_review') {
        // Notify supply chain team
        const supplyChainTeam = await User.find({ 
          $or: [
            { role: 'supply_chain' },
            { department: 'Business Development & Supply Chain' }
          ]
        }).select('email fullName');

        if (supplyChainTeam.length > 0) {
          notifications.push(
            sendPurchaseRequisitionEmail.supervisorApprovalToSupplyChain(
              supplyChainTeam.map(u => u.email),
              requisition.employee.fullName,
              requisition.title,
              requisition._id,
              requisition.items.length,
              requisition.budgetXAF
            ).catch(error => {
              console.error('Failed to send supply chain notification:', error);
              return { error, type: 'supply_chain' };
            })
          );
        }
      } else {
        // Notify next approver
        const nextStep = requisition.approvalChain.find(step => 
          step.level > requisition.approvalChain[currentStepIndex].level && step.status === 'pending'
        );

        if (nextStep) {
          notifications.push(
            sendPurchaseRequisitionEmail.newRequisitionToSupervisor(
              nextStep.approver.email,
              requisition.employee.fullName,
              requisition.title,
              requisition._id,
              requisition.items.length,
              requisition.budgetXAF
            ).catch(error => {
              console.error('Failed to send next approver notification:', error);
              return { error, type: 'next_approver' };
            })
          );
        }
      }

      // Notify employee of approval progress
      notifications.push(
        sendEmail({
          to: requisition.employee.email,
          subject: 'Purchase Requisition Approval Progress',
          html: `
            <h3>Your Purchase Requisition Has Been Approved</h3>
            <p>Dear ${requisition.employee.fullName},</p>

            <p>Your purchase requisition has been approved by ${user.fullName}.</p>

            <div style="background-color: #d4edda; padding: 15px; border-radius: 5px; margin: 15px 0;">
              <ul>
                <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                <li><strong>Approved by:</strong> ${user.fullName}</li>
                <li><strong>Status:</strong> ${requisition.status === 'pending_supply_chain_review' ? 'Moving to Supply Chain Review' : 'Moving to Next Approval'}</li>
              </ul>
            </div>

            <p>You will be notified of further updates.</p>

            <p>Best regards,<br>Purchase Management System</p>
          `
        }).catch(error => {
          console.error('Failed to send employee notification:', error);
          return { error, type: 'employee' };
        })
      );

    } else {
      // Request was rejected - notify employee
      notifications.push(
        sendPurchaseRequisitionEmail.denialToEmployee(
          requisition.employee.email,
          comments || 'Purchase requisition denied during approval process',
          requisition._id,
          user.fullName
        ).catch(error => {
          console.error('Failed to send employee denial notification:', error);
          return { error, type: 'employee' };
        })
      );
    }

    // Wait for all notifications
    const notificationResults = await Promise.allSettled(notifications);
    notificationResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`Notification ${index} failed:`, result.reason);
      } else if (result.value && result.value.error) {
        console.error(`${result.value.type} notification failed:`, result.value.error);
      } else {
        console.log(`Notification ${index} sent successfully`);
      }
    });

    console.log('=== SUPERVISOR DECISION PROCESSED ===');
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
    res.status(500).json({
      success: false,
      message: 'Failed to process decision',
      error: error.message
    });
  }
};

// Get supply chain requisitions
const getSupplyChainRequisitions = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    let query = {};

    if (user.role === 'supply_chain' || user.department === 'Business Development & Supply Chain') {
      // Supply chain users ONLY see requisitions pending their specific action
      // Show requisitions where:
      // 1. Status is pending_supply_chain_review (awaiting their business decisions)
      // 2. OR they are the current pending approver in the approval chain
      query = {
        $or: [
          { status: 'pending_supply_chain_review' },
          { status: 'justification_pending_supply_chain' },
          { 
            'approvalChain': {
              $elemMatch: {
                'approver.email': user.email,
                'status': 'pending'
              }
            }
          }
        ]
      };
    } else if (user.role === 'admin') {
      // Admins see all supply chain related requisitions for oversight
      query = {
        status: { 
          $in: [
            'pending_supply_chain_review', 
            'justification_pending_supply_chain',
            'pending_buyer_assignment',
            'pending_head_approval',
            'justification_pending_head',
            'supply_chain_approved', 
            'supply_chain_rejected', 
            'approved',
            'in_procurement', 
            'procurement_complete', 
            'delivered'
          ] 
        }
      };
    } else {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const requisitions = await PurchaseRequisition.find(query)
      .populate('employee', 'fullName email department')
      .populate('supplyChainReview.assignedBuyer', 'fullName email buyerDetails')
      .populate('financeVerification.verifiedBy', 'fullName email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: requisitions,
      count: requisitions.length
    });

  } catch (error) {
    console.error('Get supply chain requisitions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch supply chain requisitions',
      error: error.message
    });
  }
};


// Process supply chain decision
const processSupplyChainDecision = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { decision, comments, assignedOfficer, estimatedCost, purchaseType } = req.body;

    console.log('=== SUPPLY CHAIN DECISION PROCESSING ===');
    console.log('Requisition ID:', requisitionId);
    console.log('Decision:', decision);
    console.log('Purchase Type:', purchaseType); // NEW: Log purchase type

    const user = await User.findById(req.user.userId);
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    // Check if user can process supply chain decision
    const canProcess = 
      user.role === 'admin' || 
      user.role === 'supply_chain' ||
      user.department === 'Business Development & Supply Chain' ||
      requisition.approvalChain.some(step => 
        step.approver.email === user.email && 
        step.approver.role.includes('Supply Chain')
      );

    if (!canProcess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // ✅ Justification approval flow (Supply Chain)
    if (requisition.status === 'justification_pending_supply_chain') {
      requisition.justification = requisition.justification || {};

      requisition.justification.supplyChainReview = {
        decision,
        comments,
        reviewedBy: req.user.userId,
        reviewedDate: new Date()
      };

      if (decision === 'approve' || decision === 'approved') {
        requisition.status = 'justification_pending_head';
        requisition.justification.status = 'pending_head';
      } else {
        requisition.status = 'justification_rejected';
        requisition.justification.status = 'rejected';
      }

      await requisition.save();

      return res.json({
        success: true,
        message: `Justification ${decision}`,
        data: requisition
      });
    }

    // ✅ Justification approval flow (Finance)
    if (requisition.status === 'justification_pending_finance') {
      requisition.justification = requisition.justification || {};

      requisition.justification.financeReview = {
        decision,
        comments,
        reviewedBy: req.user.userId,
        reviewedDate: new Date()
      };

      if (decision === 'approve' || decision === 'approved') {
        requisition.status = 'justification_pending_supply_chain';
        requisition.justification.status = 'pending_supply_chain';
      } else {
        requisition.status = 'justification_rejected';
        requisition.justification.status = 'rejected';
      }

      await requisition.save();

      return res.json({
        success: true,
        message: `Justification ${decision}`,
        data: requisition
      });
    }

    // Update supply chain review
    requisition.supplyChainReview = {
      decision,
      comments,
      assignedOfficer,
      estimatedCost: estimatedCost ? parseFloat(estimatedCost) : undefined,
      purchaseTypeAssigned: purchaseType, // NEW: Store assigned purchase type
      decisionDate: new Date(),
      decidedBy: req.user.userId
    };

    // NEW: Update main purchase type field
    if (purchaseType) {
      requisition.purchaseType = purchaseType;
    }

    if (decision === 'approve') {
      requisition.status = 'pending_buyer_assignment'; // Move to buyer assignment
    } else {
      requisition.status = 'supply_chain_rejected';
    }

    // Update approval chain
    const supplyChainStepIndex = requisition.approvalChain.findIndex(step => 
      step.approver.email === user.email && step.status === 'pending'
    );

    if (supplyChainStepIndex !== -1) {
      requisition.approvalChain[supplyChainStepIndex].status = decision;
      requisition.approvalChain[supplyChainStepIndex].comments = comments;
      requisition.approvalChain[supplyChainStepIndex].actionDate = new Date();
      requisition.approvalChain[supplyChainStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
      requisition.approvalChain[supplyChainStepIndex].decidedBy = req.user.userId;
    }

    await requisition.save();

    // Send notifications based on decision
    const notifications = [];

    if (decision === 'approve') {
      // Notify supply chain coordinator for buyer assignment
      const supplyChainCoordinator = await User.findOne({
        email: 'lukong.lambert@gratoglobal.com'
      });

      if (supplyChainCoordinator) {
        notifications.push(
          sendEmail({
            to: supplyChainCoordinator.email,
            subject: `Requisition Ready for Buyer Assignment - ${requisition.employee.fullName}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
                  <h2 style="color: #1890ff; margin-top: 0;">Requisition Ready for Buyer Assignment</h2>
                  <p>A requisition has been approved and is ready for buyer assignment.</p>

                  <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                    <h4>Requisition Details</h4>
                    <ul>
                      <li><strong>Employee:</strong> ${requisition.employee.fullName}</li>
                      <li><strong>Title:</strong> ${requisition.title}</li>
                      <li><strong>Category:</strong> ${requisition.itemCategory}</li>
                      <li><strong>Budget:</strong> XAF ${(estimatedCost || requisition.budgetXAF || 0).toLocaleString()}</li>
                      ${purchaseType ? `<li><strong>Purchase Type:</strong> ${purchaseType.replace('_', ' ').toUpperCase()}</li>` : ''}
                      <li><strong>Items:</strong> ${requisition.items.length}</li>
                    </ul>
                  </div>

                  ${comments ? `
                  <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px;">
                    <p><strong>Comments:</strong></p>
                    <p style="font-style: italic;">${comments}</p>
                  </div>
                  ` : ''}

                  <div style="text-align: center; margin: 20px 0;">
                    <a href="${process.env.FRONTEND_URL}/supply-chain/requisitions/${requisition._id}"
                      style="background-color: #1890ff; color: white; padding: 12px 24px;
                             text-decoration: none; border-radius: 6px; font-weight: bold;">
                      Assign Buyer
                    </a>
                  </div>
                </div>
              </div>
            `
          }).catch(error => {
            console.error('Failed to send coordinator notification:', error);
            return { error, type: 'coordinator' };
          })
        );
      }

      // Notify employee of approval
      notifications.push(
        sendEmail({
          to: requisition.employee.email,
          subject: 'Purchase Requisition Approved by Supply Chain',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745;">
                <h2 style="color: #155724; margin-top: 0;">Your Purchase Requisition Has Been Approved!</h2>
                <p>Dear ${requisition.employee.fullName},</p>

                <p>Your purchase requisition has been approved by the supply chain team.</p>

                <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <ul>
                    <li><strong>Requisition:</strong> ${requisition.title}</li>
                    <li><strong>Approved by:</strong> ${user.fullName}</li>
                    <li><strong>Status:</strong> Ready for Buyer Assignment</li>
                    ${estimatedCost ? `<li><strong>Estimated Cost:</strong> XAF ${parseFloat(estimatedCost).toLocaleString()}</li>` : ''}
                    ${assignedOfficer ? `<li><strong>Assigned Officer:</strong> ${assignedOfficer}</li>` : ''}
                    ${purchaseType ? `<li><strong>Purchase Type:</strong> ${purchaseType.replace('_', ' ').toUpperCase()}</li>` : ''}
                  </ul>
                </div>

                ${comments ? `
                <div style="background-color: #e9ecef; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <p><strong>Supply Chain Comments:</strong></p>
                  <p style="font-style: italic;">${comments}</p>
                </div>
                ` : ''}

                <p>Your requisition will now be assigned to a buyer for procurement.</p>
                <p>Thank you!</p>
              </div>
            </div>
          `
        }).catch(error => {
          console.error('Failed to send employee approval notification:', error);
          return { error, type: 'employee' };
        })
      );

    } else {
      // Notify employee of rejection
      notifications.push(
        sendEmail({
          to: requisition.employee.email,
          subject: 'Purchase Requisition Rejected by Supply Chain',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #f8d7da; padding: 20px; border-radius: 8px; border-left: 4px solid #dc3545;">
                <h2 style="color: #721c24; margin-top: 0;">Purchase Requisition Rejected</h2>
                <p>Dear ${requisition.employee.fullName},</p>

                <p>Unfortunately, your purchase requisition has been rejected by the supply chain team.</p>

                <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <ul>
                    <li><strong>Requisition:</strong> ${requisition.title}</li>
                    <li><strong>Rejected by:</strong> ${user.fullName}</li>
                    <li><strong>Status:</strong> Supply Chain Rejected</li>
                  </ul>
                </div>

                ${comments ? `
                <div style="background-color: #f5c6cb; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <p><strong>Rejection Reason:</strong></p>
                  <p style="font-style: italic;">${comments}</p>
                </div>
                ` : ''}

                <p>Please contact the supply chain team if you need clarification or wish to submit a revised requisition.</p>
              </div>
            </div>
          `
        }).catch(error => {
          console.error('Failed to send employee rejection notification:', error);
          return { error, type: 'employee' };
        })
      );
    }

    // Wait for all notifications to complete
    const notificationResults = await Promise.allSettled(notifications);
    notificationResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`Notification ${index} failed:`, result.reason);
      } else if (result.value && result.value.error) {
        console.error(`${result.value.type} notification failed:`, result.value.error);
      } else {
        console.log(`Notification ${index} sent successfully`);
      }
    });

    console.log('=== SUPPLY CHAIN DECISION PROCESSED ===');
    res.json({
      success: true,
      message: `Requisition ${decision}d by supply chain`,
      data: requisition,
      notifications: {
        sent: notificationResults.filter(r => r.status === 'fulfilled' && !r.value?.error).length,
        failed: notificationResults.filter(r => r.status === 'rejected' || r.value?.error).length
      }
    });

  } catch (error) {
    console.error('Process supply chain decision error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process supply chain decision',
      error: error.message
    });
  }
};

// Process finance decision
const processFinanceDecision = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { decision, comments } = req.body;

    console.log('=== FINANCE DECISION PROCESSING ===');
    console.log('Requisition ID:', requisitionId);
    console.log('Decision:', decision);

    const user = await User.findById(req.user.userId);
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    // Check if user can process finance decision
    const canProcess = 
      user.role === 'admin' || 
      user.role === 'finance' ||
      requisition.approvalChain.some(step => 
        step.approver.email === user.email && 
        (step.approver.role === 'Finance Officer' || step.approver.role === 'President')
      );

    if (!canProcess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Update finance review
    requisition.financeReview = {
      decision,
      comments,
      decisionDate: new Date(),
      decidedBy: req.user.userId
    };

    if (decision === 'approve') {
      requisition.status = 'approved';
    } else {
      requisition.status = 'rejected';
    }

    // Update approval chain
    const financeStepIndex = requisition.approvalChain.findIndex(step => 
      step.approver.email === user.email && step.status === 'pending'
    );

    if (financeStepIndex !== -1) {
      requisition.approvalChain[financeStepIndex].status = decision;
      requisition.approvalChain[financeStepIndex].comments = comments;
      requisition.approvalChain[financeStepIndex].actionDate = new Date();
      requisition.approvalChain[financeStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
      requisition.approvalChain[financeStepIndex].decidedBy = req.user.userId;
    }

    await requisition.save();

    // Send notifications based on decision
    const notifications = [];

    if (decision === 'approve') {
      // Notify supply chain that requisition is ready for procurement
      const supplyChainTeam = await User.find({ 
        $or: [
          { role: 'supply_chain' },
          { department: 'Business Development & Supply Chain' }
        ]
      }).select('email fullName');

      if (supplyChainTeam.length > 0) {
        notifications.push(
          sendEmail({
            to: supplyChainTeam.map(u => u.email),
            subject: `Requisition Ready for Procurement - ${requisition.title}`,
            html: `
              <h3>Purchase Requisition Approved - Ready for Procurement</h3>
              <p>The following requisition has been fully approved and is ready to begin procurement:</p>

              <div style="background-color: #d4edda; padding: 15px; border-radius: 5px; margin: 15px 0;">
                <ul>
                  <li><strong>Employee:</strong> ${requisition.employee.fullName}</li>
                  <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                  <li><strong>Title:</strong> ${requisition.title}</li>
                  <li><strong>Approved Budget:</strong> XAF ${(requisition.supplyChainReview?.estimatedCost || requisition.budgetXAF || 0).toFixed(2)}</li>
                  <li><strong>Finance Approved by:</strong> ${user.fullName}</li>
                </ul>
              </div>

              <p>Please proceed with vendor selection and procurement process.</p>
            `
          }).catch(error => {
            console.error('Failed to send supply chain notification:', error);
            return { error, type: 'supply_chain' };
          })
        );
      }

      // Notify employee of finance approval
      notifications.push(
        sendEmail({
          to: requisition.employee.email,
          subject: 'Purchase Requisition Approved by Finance',
          html: `
            <h3>Your Purchase Requisition Has Been Approved!</h3>
            <p>Dear ${requisition.employee.fullName},</p>

            <p>Your purchase requisition has been approved by the finance team and is now ready for procurement.</p>

            <div style="background-color: #d4edda; padding: 15px; border-radius: 5px; margin: 15px 0;">
              <ul>
                <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                <li><strong>Approved by:</strong> ${user.fullName}</li>
                <li><strong>Status:</strong> Approved - Ready for Procurement</li>
              </ul>
            </div>

            ${comments ? `
            <div style="background-color: #e9ecef; padding: 15px; border-radius: 5px; margin: 15px 0;">
              <p><strong>Finance Comments:</strong></p>
              <p style="font-style: italic;">${comments}</p>
            </div>
            ` : ''}

            <p>The supply chain team will now begin the procurement process for your requested items.</p>

            <p>Thank you!</p>
          `
        }).catch(error => {
          console.error('Failed to send employee notification:', error);
          return { error, type: 'employee' };
        })
      );

    } else {
      // Notify employee of rejection
      notifications.push(
        sendEmail({
          to: requisition.employee.email,
          subject: 'Purchase Requisition Rejected by Finance',
          html: `
            <h3>Purchase Requisition Rejected</h3>
            <p>Dear ${requisition.employee.fullName},</p>

            <p>Unfortunately, your purchase requisition has been rejected by the finance team.</p>

            <div style="background-color: #f8d7da; padding: 15px; border-radius: 5px; margin: 15px 0;">
              <ul>
                <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                <li><strong>Rejected by:</strong> ${user.fullName}</li>
                <li><strong>Status:</strong> Finance Rejected</li>
              </ul>
            </div>

            ${comments ? `
            <div style="background-color: #f5c6cb; padding: 15px; border-radius: 5px; margin: 15px 0;">
              <p><strong>Rejection Reason:</strong></p>
              <p style="font-style: italic;">${comments}</p>
            </div>
            ` : ''}

            <p>Please contact the finance team if you need clarification or wish to submit a revised requisition.</p>
          `
        }).catch(error => {
          console.error('Failed to send employee rejection notification:', error);
          return { error, type: 'employee' };
        })
      );
    }

    // Wait for all notifications to complete
    const notificationResults = await Promise.allSettled(notifications);
    notificationResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`Notification ${index} failed:`, result.reason);
      } else if (result.value && result.value.error) {
        console.error(`${result.value.type} notification failed:`, result.value.error);
      } else {
        console.log(`Notification ${index} sent successfully`);
      }
    });

    console.log('=== FINANCE DECISION PROCESSED ===');
    res.json({
      success: true,
      message: `Requisition ${decision}d by finance`,
      data: requisition,
      notifications: {
        sent: notificationResults.filter(r => r.status === 'fulfilled').length,
        failed: notificationResults.filter(r => r.status === 'rejected').length
      }
    });

  } catch (error) {
    console.error('Process finance decision error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process finance decision',
      error: error.message
    });
  }
};

// Get approval chain preview (for form preview)
const getApprovalChainPreview = async (req, res) => {
  try {
    const { employeeName, department } = req.body;

    if (!employeeName || !department) {
      return res.status(400).json({
        success: false,
        message: 'Employee name and department are required'
      });
    }

    // Generate approval chain
    const approvalChain = getApprovalChainForRequisition(employeeName, department);

    if (!approvalChain || approvalChain.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Unable to determine approval chain for this employee'
      });
    }

    res.json({
      success: true,
      data: approvalChain,
      message: `Found ${approvalChain.length} approval levels`
    });

  } catch (error) {
    console.error('Get approval chain preview error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get approval chain preview',
      error: error.message
    });
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

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    res.json({
      success: true,
      data: requisition
    });

  } catch (error) {
    console.error('Get admin requisition details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requisition details',
      error: error.message
    });
  }
};

// Get supervisor requisition (for viewing specific requisition details)
const getSupervisorRequisition = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const user = await User.findById(req.user.userId);

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    // Check if user can view this requisition
    const canView = 
      user.role === 'admin' ||
      requisition.approvalChain.some(step => step.approver.email === user.email);

    if (!canView) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: requisition
    });

  } catch (error) {
    console.error('Get supervisor requisition error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requisition',
      error: error.message
    });
  }
};

// Update procurement status
const updateProcurementStatus = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { 
      status, 
      assignedOfficer, 
      vendors, 
      selectedVendor, 
      finalCost, 
      deliveryDate,
      deliveryStatus,
      comments 
    } = req.body;

    console.log('=== UPDATE PROCUREMENT STATUS ===');
    console.log('Requisition ID:', requisitionId);
    console.log('New Status:', status);

    const user = await User.findById(req.user.userId);
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    // Check permissions
    const canUpdate = 
      user.role === 'admin' || 
      user.role === 'supply_chain' ||
      user.department === 'Business Development & Supply Chain';

    if (!canUpdate) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Update procurement details
    if (!requisition.procurementDetails) {
      requisition.procurementDetails = {};
    }

    if (assignedOfficer) requisition.procurementDetails.assignedOfficer = assignedOfficer;
    if (vendors) requisition.procurementDetails.vendors = vendors;
    if (selectedVendor) requisition.procurementDetails.selectedVendor = selectedVendor;
    if (finalCost) requisition.procurementDetails.finalCost = parseFloat(finalCost);
    if (deliveryDate) requisition.procurementDetails.deliveryDate = new Date(deliveryDate);
    if (deliveryStatus) requisition.procurementDetails.deliveryStatus = deliveryStatus;

    // Update main status
    if (status) requisition.status = status;

    // Set procurement date when moving to in_procurement
    if (status === 'in_procurement' && !requisition.procurementDetails.procurementDate) {
      requisition.procurementDetails.procurementDate = new Date();
    }

    await requisition.save();

    // Send notifications based on status
    const notifications = [];

    if (status === 'delivered') {
      // Notify employee of delivery
      notifications.push(
        sendPurchaseRequisitionEmail.deliveryToEmployee(
          requisition.employee.email,
          requisition.title,
          requisition._id,
          requisition.deliveryLocation,
          assignedOfficer
        ).catch(error => {
          console.error('Failed to send delivery notification:', error);
          return { error, type: 'employee' };
        })
      );

      // Notify admins of completion
      const admins = await User.find({ role: 'admin' }).select('email fullName');
      if (admins.length > 0) {
        notifications.push(
          sendEmail({
            to: admins.map(a => a.email),
            subject: `Purchase Requisition Delivered - ${requisition.employee.fullName}`,
            html: `
              <h3>Purchase Requisition Completed Successfully</h3>
              <p>A purchase requisition has been completed and delivered.</p>

              <div style="background-color: #d4edda; padding: 15px; border-radius: 5px; margin: 15px 0;">
                <ul>
                  <li><strong>Employee:</strong> ${requisition.employee.fullName}</li>
                  <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                  <li><strong>Title:</strong> ${requisition.title}</li>
                  <li><strong>Final Cost:</strong> XAF ${(finalCost || 0).toFixed(2)}</li>
                  <li><strong>Delivered by:</strong> ${assignedOfficer || 'Procurement Team'}</li>
                  <li><strong>Status:</strong> Completed</li>
                </ul>
              </div>
            `
          }).catch(error => {
            console.error('Failed to send admin notification:', error);
            return { error, type: 'admin' };
          })
        );
      }
    }

    // Wait for notifications
    const notificationResults = await Promise.allSettled(notifications);

    res.json({
      success: true,
      message: 'Procurement status updated successfully',
      data: requisition,
      notifications: {
        sent: notificationResults.filter(r => r.status === 'fulfilled').length,
        failed: notificationResults.filter(r => r.status === 'rejected').length
      }
    });

  } catch (error) {
    console.error('Update procurement status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update procurement status',
      error: error.message
    });
  }
};

// Get dashboard statistics
const getDashboardStats = async (req, res) => {
  try {
    const { role, userId } = req.user;
    const user = await User.findById(userId);

    let filter = {};

    // Filter based on user role
    if (role === 'employee') {
      filter.employee = userId;
    } else if (role === 'supervisor') {
      filter['approvalChain.approver.email'] = user.email;
    } else if (role === 'supply_chain') {
      filter.status = { $in: ['pending_supply_chain_review', 'supply_chain_approved', 'in_procurement', 'procurement_complete'] };
    } else if (role === 'finance') {
      filter.status = { $in: ['pending_finance_verification', 'pending_supply_chain_review', 'approved', 'in_procurement', 'procurement_complete', 'delivered'] };
    }

    const [
      totalCount,
      pendingCount,
      approvedCount,
      rejectedCount,
      inProcurementCount,
      completedCount,
      recentRequisitions,
      monthlyStats
    ] = await Promise.all([
      PurchaseRequisition.countDocuments(filter),
      PurchaseRequisition.countDocuments({ 
        ...filter, 
        status: { $in: ['pending_supervisor', 'pending_finance_verification', 'pending_supply_chain_review'] } 
      }),
      PurchaseRequisition.countDocuments({ 
        ...filter, 
        status: { $in: ['approved', 'supply_chain_approved'] } 
      }),
      PurchaseRequisition.countDocuments({ 
        ...filter, 
        status: { $in: ['rejected', 'supply_chain_rejected'] } 
      }),
      PurchaseRequisition.countDocuments({ ...filter, status: 'in_procurement' }),
      PurchaseRequisition.countDocuments({ 
        ...filter, 
        status: { $in: ['procurement_complete', 'delivered'] } 
      }),

      // Recent requisitions
      PurchaseRequisition.find(filter)
        .populate('employee', 'fullName email department')
        .sort({ createdAt: -1 })
        .limit(10),

      // Monthly statistics
      PurchaseRequisition.aggregate([
        { $match: filter },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' }
            },
            count: { $sum: 1 },
            totalBudget: { $sum: '$budgetXAF' },
            avgProcessingTime: { $avg: '$processingTime' }
          }
        },
        { $sort: { '_id.year': -1, '_id.month': -1 } },
        { $limit: 12 }
      ])
    ]);

    let stats = {
      summary: {
        total: totalCount,
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
        inProcurement: inProcurementCount,
        completed: completedCount
      },
      recent: recentRequisitions,
      monthly: monthlyStats,
      trends: {
        approvalRate: totalCount > 0 ? Math.round(((approvedCount + completedCount) / totalCount) * 100) : 0,
        completionRate: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
      }
    };

    // Add finance-specific analytics if user is finance
    if (role === 'finance' || role === 'admin') {
      const BudgetCode = require('../models/BudgetCode');
      
      const [
        budgetCodeStats,
        totalBudgetAllocated,
        budgetUtilization,
        financeRequisitions
      ] = await Promise.all([
        // Budget code statistics
        BudgetCode.aggregate([
          { $match: { active: true } },
          {
            $group: {
              _id: null,
              totalBudgetCodes: { $sum: 1 },
              totalBudget: { $sum: '$budget' },
              totalUsed: { $sum: '$used' },
              totalRemaining: { $sum: { $subtract: ['$budget', '$used'] } }
            }
          }
        ]),
        
        // Total budget allocated to requisitions this month
        PurchaseRequisition.aggregate([
          {
            $match: {
              'financeVerification.verificationDate': {
                $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
              },
              'financeVerification.decision': 'approved'
            }
          },
          {
            $group: {
              _id: null,
              totalAllocated: { $sum: '$financeVerification.assignedBudget' },
              count: { $sum: 1 }
            }
          }
        ]),

        // Budget utilization by department
        PurchaseRequisition.aggregate([
          {
            $match: {
              'financeVerification.decision': 'approved',
              createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }
            }
          },
          {
            $group: {
              _id: '$department',
              totalAllocated: { $sum: '$financeVerification.assignedBudget' },
              count: { $sum: 1 }
            }
          },
          { $sort: { totalAllocated: -1 } }
        ]),

        // Finance pending requisitions
        PurchaseRequisition.countDocuments({ status: 'pending_finance_verification' })
      ]);

      // Add finance analytics to stats
      stats.finance = {
        budgetCodes: budgetCodeStats[0] || {
          totalBudgetCodes: 0,
          totalBudget: 0,
          totalUsed: 0,
          totalRemaining: 0
        },
        thisMonth: {
          totalBudgetAllocated: totalBudgetAllocated[0]?.totalAllocated || 0,
          requisitionsApproved: totalBudgetAllocated[0]?.count || 0
        },
        budgetUtilization: budgetUtilization,
        pendingVerification: financeRequisitions,
        overallUtilization: budgetCodeStats[0] ? 
          Math.round((budgetCodeStats[0].totalUsed / budgetCodeStats[0].totalBudget) * 100) : 0
      };
    }

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard statistics',
      error: error.message
    });
  }
};

// Get category analytics
const getCategoryAnalytics = async (req, res) => {
  try {
    const { period = 'quarterly' } = req.query;

    // Calculate date range based on period
    let startDate = new Date();
    switch (period) {
      case 'monthly':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarterly':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'yearly':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setMonth(startDate.getMonth() - 3);
    }

    const analytics = await PurchaseRequisition.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$itemCategory',
          count: { $sum: 1 },
          totalBudget: { $sum: '$budgetXAF' },
          avgBudget: { $avg: '$budgetXAF' },
          approvedCount: {
            $sum: {
              $cond: [
                { $in: ['$status', ['approved', 'in_procurement', 'procurement_complete', 'delivered']] },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $addFields: {
          approvalRate: {
            $multiply: [
              { $divide: ['$approvedCount', '$count'] },
              100
            ]
          }
        }
      },
      { $sort: { totalBudget: -1 } }
    ]);

    res.json({
      success: true,
      data: analytics,
      period: period
    });

  } catch (error) {
    console.error('Get category analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch category analytics',
      error: error.message
    });
  }
};

// Get vendor performance data
const getVendorPerformance = async (req, res) => {
  try {
    // This would integrate with vendor management system
    // For now, return mock data structure
    const mockVendorData = [
      {
        name: 'TechSolutions Cameroon',
        totalOrders: 28,
        onTimeDelivery: 95,
        qualityRating: 4.5,
        totalSpend: 15000000
      },
      {
        name: 'Office Supplies Plus',
        totalOrders: 45,
        onTimeDelivery: 90,
        qualityRating: 4.2,
        totalSpend: 8500000
      }
    ];

    res.json({
      success: true,
      data: mockVendorData,
      message: 'Vendor performance data (mock)'
    });

  } catch (error) {
    console.error('Get vendor performance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor performance',
      error: error.message
    });
  }
};

// Save draft requisition
const saveDraft = async (req, res) => {
  try {
    console.log('=== SAVE DRAFT REQUISITION ===');

    const {
      title,
      itemCategory,
      budgetXAF,
      budgetHolder,
      urgency,
      deliveryLocation,
      expectedDate,
      justificationOfPurchase,
      justificationOfPreferredSupplier,
      items
    } = req.body;

    // Get user details
    const employee = await User.findById(req.user.userId);
    if (!employee) {
      return res.status(404).json({ 
        success: false, 
        message: 'Employee not found' 
      });
    }

    // Parse items if it's a string
    let parsedItems;
    try {
      parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
    } catch (error) {
      parsedItems = [];
    }

    // Create draft requisition (no approval chain needed for drafts)
    const draftRequisition = new PurchaseRequisition({
      employee: req.user.userId,
      title: title || 'Draft Requisition',
      department: employee.department,
      itemCategory: itemCategory || 'Other',
      budgetXAF: budgetXAF ? parseFloat(budgetXAF) : undefined,
      budgetHolder: budgetHolder || employee.department,
      urgency: urgency || 'Medium',
      deliveryLocation: deliveryLocation || 'Office',
      expectedDate: expectedDate ? new Date(expectedDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days from now
      justificationOfPurchase: justificationOfPurchase || 'Draft - to be completed',
      justificationOfPreferredSupplier,
      items: parsedItems || [],
      status: 'draft',
      approvalChain: [] // Empty for drafts
    });

    await draftRequisition.save();
    await draftRequisition.populate('employee', 'fullName email department');

    res.json({
      success: true,
      message: 'Draft saved successfully',
      data: draftRequisition
    });

  } catch (error) {
    console.error('Save draft error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save draft',
      error: error.message
    });
  }
};

// Get procurement planning data
const getProcurementPlanningData = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    // Check permissions
    const canView = 
      user.role === 'admin' || 
      user.role === 'supply_chain' ||
      user.department === 'Business Development & Supply Chain';

    if (!canView) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const [
      upcomingRequisitions,
      procurementPipeline,
      budgetUtilization,
      vendorWorkload
    ] = await Promise.all([
      // Upcoming requisitions by expected date
      PurchaseRequisition.find({
        status: { $in: ['approved', 'in_procurement'] },
        expectedDate: { $gte: new Date(), $lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
      })
      .populate('employee', 'fullName department')
      .sort({ expectedDate: 1 })
      .limit(20),

      // Procurement pipeline by status
      PurchaseRequisition.aggregate([
        {
          $match: {
            status: { $in: ['approved', 'in_procurement', 'procurement_complete'] }
          }
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalValue: { $sum: '$budgetXAF' }
          }
        }
      ]),

      // Budget utilization by category
      PurchaseRequisition.aggregate([
        {
          $match: {
            status: { $in: ['approved', 'in_procurement', 'procurement_complete', 'delivered'] },
            createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } // This month
          }
        },
        {
          $group: {
            _id: '$itemCategory',
            allocated: { $sum: '$budgetXAF' },
            spent: { $sum: '$procurementDetails.finalCost' },
            count: { $sum: 1 }
          }
        }
      ]),

      // Mock vendor workload (would integrate with actual vendor system)
      Promise.resolve([
        { vendor: 'TechSolutions Cameroon', activeOrders: 5, pendingValue: 2500000 },
        { vendor: 'Office Supplies Plus', activeOrders: 3, pendingValue: 750000 }
      ])
    ]);

    res.json({
      success: true,
      data: {
        upcoming: upcomingRequisitions,
        pipeline: procurementPipeline,
        budgetUtilization,
        vendorWorkload
      }
    });

  } catch (error) {
    console.error('Get procurement planning data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch procurement planning data',
      error: error.message
    });
  }
};

// Update requisition (for drafts or pending requisitions)
const updateRequisition = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const updateData = req.body;

    const requisition = await PurchaseRequisition.findById(requisitionId);

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    // Check if user can update this requisition
    if (!requisition.employee.equals(req.user.userId) && !['admin'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Only allow updates for drafts or pending requisitions
    if (!['draft', 'pending_supervisor'].includes(requisition.status)) {
      return res.status(400).json({
        success: false,
        message: 'Can only update draft or pending supervisor requisitions'
      });
    }

    // Update allowed fields
    const allowedFields = [
      'title', 'itemCategory', 'budgetXAF', 'budgetHolder', 'urgency',
      'deliveryLocation', 'expectedDate', 'justificationOfPurchase',
      'justificationOfPreferredSupplier', 'items'
    ];

    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        if (field === 'items' && typeof updateData[field] === 'string') {
          try {
            requisition[field] = JSON.parse(updateData[field]);
          } catch (error) {
            // Keep existing items if parsing fails
          }
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

    res.json({
      success: true,
      message: 'Requisition updated successfully',
      data: requisition
    });

  } catch (error) {
    console.error('Update requisition error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update requisition',
      error: error.message
    });
  }
};

// Delete draft requisition
const deleteRequisition = async (req, res) => {
  try {
    const { requisitionId } = req.params;

    const requisition = await PurchaseRequisition.findById(requisitionId);

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    // Check permissions
    if (!requisition.employee.equals(req.user.userId) && !['admin'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Only allow deletion of draft requisitions
    if (requisition.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Can only delete draft requisitions'
      });
    }

    // Clean up attachments if any
    if (requisition.attachments && requisition.attachments.length > 0) {
      await Promise.allSettled(
        requisition.attachments.map(attachment => {
          const filePath = path.join(__dirname, '../uploads/requisitions', attachment.publicId);
          return fs.promises.unlink(filePath).catch(e => console.error('File cleanup failed:', e));
        })
      );
    }

    await PurchaseRequisition.findByIdAndDelete(requisitionId);

    res.json({
      success: true,
      message: 'Draft requisition deleted successfully'
    });

  } catch (error) {
    console.error('Delete requisition error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete requisition',
      error: error.message
    });
  }
};

// Get requisition statistics for reporting
const getRequisitionStats = async (req, res) => {
  try {
    const { startDate, endDate, department, status } = req.query;

    let matchFilter = {};

    // Date range filter
    if (startDate || endDate) {
      matchFilter.createdAt = {};
      if (startDate) matchFilter.createdAt.$gte = new Date(startDate);
      if (endDate) matchFilter.createdAt.$lte = new Date(endDate);
    }

    // Department filter
    if (department) {
      const users = await User.find({ department }).select('_id');
      matchFilter.employee = { $in: users.map(u => u._id) };
    }

    // Status filter
    if (status) {
      matchFilter.status = status;
    }

    const stats = await PurchaseRequisition.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: null,
          totalRequisitions: { $sum: 1 },
          totalBudget: { $sum: '$budgetXAF' },
          avgBudget: { $avg: '$budgetXAF' },
          avgProcessingTime: { $avg: '$processingTime' },
          statusBreakdown: {
            $push: '$status'
          },
          categoryBreakdown: {
            $push: '$itemCategory'
          },
          departmentBreakdown: {
            $push: '$department'
          }
        }
      }
    ]);

    // Process status breakdown
    const statusCounts = {};
    const categoryCounts = {};
    const departmentCounts = {};

    if (stats.length > 0) {
      stats[0].statusBreakdown.forEach(status => {
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });

      stats[0].categoryBreakdown.forEach(category => {
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
      });

      stats[0].departmentBreakdown.forEach(dept => {
        departmentCounts[dept] = (departmentCounts[dept] || 0) + 1;
      });
    }

    res.json({
      success: true,
      data: {
        summary: stats.length > 0 ? {
          totalRequisitions: stats[0].totalRequisitions,
          totalBudget: stats[0].totalBudget || 0,
          avgBudget: Math.round(stats[0].avgBudget || 0),
          avgProcessingTime: Math.round(stats[0].avgProcessingTime || 0)
        } : {
          totalRequisitions: 0,
          totalBudget: 0,
          avgBudget: 0,
          avgProcessingTime: 0
        },
        breakdown: {
          status: statusCounts,
          category: categoryCounts,
          department: departmentCounts
        }
      }
    });

  } catch (error) {
    console.error('Get requisition stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requisition statistics',
      error: error.message
    });
  }
};

// Get requisitions by user role (unified endpoint)
const getRequisitionsByRole = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const { status, page = 1, limit = 20 } = req.query;

    let query = {};
    let baseFilter = status ? { status } : {};

    switch (user.role) {
      case 'employee':
        query = { ...baseFilter, employee: req.user.userId };
        break;

      case 'supervisor':
        query = {
          ...baseFilter,
          'approvalChain': {
            $elemMatch: {
              'approver.email': user.email,
              'status': 'pending'
            }
          }
        };
        break;

      case 'supply_chain':
        query = {
          ...baseFilter,
          $or: [
            { status: 'pending_supply_chain_review' },
            { status: 'supply_chain_approved' },
            { status: 'in_procurement' }
          ]
        };
        break;

      case 'finance':
        query = {
          ...baseFilter,
          $or: [
            { status: 'pending_finance' },
            { status: 'approved' },
            { status: 'delivered' }
          ]
        };
        break;

      case 'admin':
        query = baseFilter; // See all
        break;

      default:
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
    }

    const requisitions = await PurchaseRequisition.find(query)
      .populate('employee', 'fullName email department')
      .populate('supplyChainReview.decidedBy', 'fullName')
      .populate('financeReview.decidedBy', 'fullName')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await PurchaseRequisition.countDocuments(query);

    res.json({
      success: true,
      data: requisitions,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: requisitions.length,
        totalRecords: total
      },
      role: user.role
    });

  } catch (error) {
    console.error('Get requisitions by role error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requisitions',
      error: error.message
    });
  }
};


const processFinanceVerification = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { decision, comments } = req.body;

    console.log('=== FINANCE VERIFICATION PROCESSING ===');
    console.log('Requisition ID:', requisitionId);
    console.log('Decision:', decision);

    const user = await User.findById(req.user.userId);
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department')
      .populate('budgetCode', 'code name budget used department');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    // Check if user can verify finance
    const canVerify =
      user.role === 'admin' ||
      user.role === 'finance' ||
      user.email === 'ranibellmambo@gratoengineering.com';

    if (!canVerify) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // ✅ CRITICAL FIX: Ensure all items have required fields
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

    // ✅ NEW: Verify budget code was selected by employee
    if (!requisition.budgetCode) {
      return res.status(400).json({
        success: false,
        message: 'No budget code found. Employee must select budget code during submission.'
      });
    }

    const budgetCode = requisition.budgetCode;
    const requiredBudget = requisition.budgetXAF || 0;
    const currentAvailableBudget = budgetCode.budget - budgetCode.used;

    console.log('Budget verification:', {
      budgetCode: budgetCode.code,
      requiredBudget: requiredBudget,
      currentAvailableBudget: currentAvailableBudget,
      availableAtSubmission: requisition.budgetCodeInfo?.availableAtSubmission
    });

    if (decision === 'approved') {
      // ✅ NEW: Only verify budget is still available (no assignment)
      if (currentAvailableBudget < requiredBudget) {
        return res.status(400).json({
          success: false,
          message: `Insufficient budget. Budget code ${budgetCode.code} has only XAF ${currentAvailableBudget.toLocaleString()} available, but XAF ${requiredBudget.toLocaleString()} is required.`
        });
      }

      // ✅ NEW: Update finance verification (verification only, no allocation)
      requisition.financeVerification = {
        budgetAvailable: true,
        verifiedBudget: requiredBudget,
        budgetCodeVerified: budgetCode.code,
        budgetCodeId: budgetCode._id,
        availableBudgetAtVerification: currentAvailableBudget,
        comments: comments,
        verifiedBy: req.user.userId,
        verificationDate: new Date(),
        decision: 'approved'
      };

      requisition.status = 'pending_supply_chain_review';
      console.log('✅ Budget verified successfully');
      console.log(`   Budget Code: ${budgetCode.code}`);
      console.log(`   Available: XAF ${currentAvailableBudget.toLocaleString()}`);
      
    } else {
      // Rejected
      requisition.financeVerification = {
        budgetAvailable: false,
        verifiedBudget: requiredBudget,
        budgetCodeVerified: budgetCode.code,
        comments: comments,
        verifiedBy: req.user.userId,
        verificationDate: new Date(),
        decision: 'rejected'
      };

      requisition.status = 'rejected';
      console.log('❌ Budget verification rejected');
    }

    // Update approval chain status for finance step
    const financeStepIndex = requisition.approvalChain.findIndex(
      step => step.approver.email.toLowerCase() === user.email.toLowerCase() && 
              step.status === 'pending'
    );

    if (financeStepIndex !== -1) {
      requisition.approvalChain[financeStepIndex].status = decision === 'approved' ? 'approved' : 'rejected';
      requisition.approvalChain[financeStepIndex].comments = comments;
      requisition.approvalChain[financeStepIndex].actionDate = new Date();
      requisition.approvalChain[financeStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
      requisition.approvalChain[financeStepIndex].decidedBy = req.user.userId;
    }

    try {
      await requisition.save();
      console.log('✅ Requisition saved successfully');
    } catch (saveError) {
      console.error('Requisition save error:', saveError);
      
      if (saveError.name === 'ValidationError') {
        const errors = Object.keys(saveError.errors)
          .map(key => `${key}: ${saveError.errors[key].message}`)
          .join(', ');
        
        return res.status(400).json({
          success: false,
          message: 'Requisition validation failed',
          details: errors
        });
      }
      
      return res.status(500).json({
        success: false,
        message: 'Failed to save requisition',
        error: saveError.message
      });
    }

    // Send notifications
    const notifications = [];
    const { sendEmail } = require('../services/emailService');
    
    if (decision === 'approved') {
      const supplyChainCoordinator = await User.findOne({
        email: 'lukong.lambert@gratoglobal.com'
      });

      if (supplyChainCoordinator) {
        notifications.push(
          sendEmail({
            to: supplyChainCoordinator.email,
            subject: `Purchase Requisition Ready - Budget Verified - ${requisition.employee.fullName}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
                  <h2 style="color: #1890ff; margin-top: 0;">📋 Budget Verified - Ready for Supply Chain Review</h2>
                  <p>Dear ${supplyChainCoordinator.fullName},</p>
                  <p>Finance has verified budget availability for a purchase requisition.</p>
                  
                  <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                    <h4>Requisition Details</h4>
                    <ul>
                      <li><strong>Employee:</strong> ${requisition.employee.fullName}</li>
                      <li><strong>Title:</strong> ${requisition.title}</li>
                      <li><strong>Budget Amount:</strong> XAF ${requiredBudget.toLocaleString()}</li>
                      <li><strong>Budget Code:</strong> ${budgetCode.code} - ${budgetCode.name}</li>
                      <li><strong>Available Budget:</strong> XAF ${currentAvailableBudget.toLocaleString()}</li>
                      <li><strong>Items Count:</strong> ${requisition.items.length}</li>
                    </ul>
                  </div>
                  
                  ${comments ? `
                  <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px;">
                    <p><strong>Finance Comments:</strong></p>
                    <p style="font-style: italic;">${comments}</p>
                  </div>
                  ` : ''}

                  <div style="text-align: center; margin: 20px 0;">
                    <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/supply-chain/requisitions/${requisition._id}"
                      style="background-color: #1890ff; color: white; padding: 12px 24px;
                             text-decoration: none; border-radius: 6px; font-weight: bold;">
                      Make Business Decisions
                    </a>
                  </div>
                </div>
              </div>
            `
          }).catch(error => {
            console.error('Failed to send supply chain notification:', error);
            return { error, type: 'supply_chain' };
          })
        );
      }

      // Notify employee
      notifications.push(
        sendEmail({
          to: requisition.employee.email,
          subject: 'Purchase Requisition - Budget Verified',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745;">
                <h2 style="color: #155724; margin-top: 0;">✅ Budget Verification Complete</h2>
                <p>Dear ${requisition.employee.fullName},</p>
                <p>Your purchase requisition has been verified by the Finance team.</p>
                
                <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <h4>Verification Details</h4>
                  <ul>
                    <li><strong>Requisition:</strong> ${requisition.title}</li>
                    <li><strong>Budget Amount:</strong> XAF ${requiredBudget.toLocaleString()}</li>
                    <li><strong>Budget Code:</strong> ${budgetCode.code}</li>
                    <li><strong>Status:</strong> Approved by Finance</li>
                    <li><strong>Next Step:</strong> Supply Chain Review</li>
                  </ul>
                </div>
                
                ${comments ? `
                <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px;">
                  <p><strong>Finance Comments:</strong></p>
                  <p style="font-style: italic;">${comments}</p>
                </div>
                ` : ''}
              </div>
            </div>
          `
        }).catch(error => {
          console.error('Failed to send employee notification:', error);
          return { error, type: 'employee' };
        })
      );
    } else {
      // Send rejection notification to employee
      notifications.push(
        sendEmail({
          to: requisition.employee.email,
          subject: 'Purchase Requisition - Budget Verification Rejected',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #f8d7da; padding: 20px; border-radius: 8px; border-left: 4px solid #dc3545;">
                <h2 style="color: #721c24; margin-top: 0;">❌ Budget Verification Rejected</h2>
                <p>Dear ${requisition.employee.fullName},</p>
                <p>Your purchase requisition could not be verified by Finance.</p>
                
                <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <ul>
                    <li><strong>Requisition:</strong> ${requisition.title}</li>
                    <li><strong>Budget Code:</strong> ${budgetCode.code}</li>
                    <li><strong>Requested Amount:</strong> XAF ${requiredBudget.toLocaleString()}</li>
                  </ul>
                </div>
                
                ${comments ? `<div style="background-color: #f5c6cb; padding: 15px; border-radius: 8px;">
                  <p><strong>Rejection Reason:</strong></p>
                  <p style="font-style: italic;">${comments}</p>
                </div>
                ` : ''}
                
                <p>Please contact the Finance team if you need clarification or wish to submit a revised requisition.</p>
              </div>
            </div>
          `
        }).catch(error => {
          console.error('Failed to send employee rejection notification:', error);
          return { error, type: 'employee' };
        })
      );
    }

    // Wait for all notifications
    const notificationResults = await Promise.allSettled(notifications);

    console.log('=== FINANCE VERIFICATION COMPLETED ===');
    res.json({
      success: true,
      message: `Budget verification ${decision}`,
      data: {
        requisition,
        budgetVerification: {
          budgetCode: budgetCode.code,
          budgetCodeName: budgetCode.name,
          requiredBudget: requiredBudget,
          availableBudget: currentAvailableBudget,
          verified: decision === 'approved',
          remainingAfterVerification: currentAvailableBudget - (decision === 'approved' ? requiredBudget : 0)
        }
      },
      notifications: {
        sent: notificationResults.filter(r => r.status === 'fulfilled' && !r.value?.error).length,
        failed: notificationResults.filter(r => r.status === 'rejected' || r.value?.error).length
      }
    });

  } catch (error) {
    console.error('Process finance verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process finance verification',
      error: error.message
    });
  }
};

const assignBuyer = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { 
      sourcingType, 
      assignedBuyer, 
      comments, 
      purchaseType,
      paymentMethod = 'bank',  // NEW: Add payment method with default
      estimatedCost  // NEW: Add estimated cost
    } = req.body;

    console.log('=== BUYER ASSIGNMENT PROCESSING ===');
    console.log('Requisition ID:', requisitionId);
    console.log('Assigned Buyer:', assignedBuyer);
    console.log('Purchase Type:', purchaseType);
    console.log('Payment Method:', paymentMethod); // NEW: Log payment method

    const user = await User.findById(req.user.userId);
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    // Check if user can assign buyer (Supply Chain Coordinator or Admin)
    const canAssign =
      user.role === 'admin' ||
      user.email === 'lukong.lambert@gratoglobal.com' ||
      user.role === 'supply_chain' ||
      user.department === 'Business Development & Supply Chain';

    if (!canAssign) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // FIXED: Validate assigned buyer exists and is active
    const buyer = await User.findOne({ 
      _id: assignedBuyer,
      $or: [
        { role: 'buyer' },
        { departmentRole: 'buyer' },
        { email: 'lukong.lambert@gratoglobal.com' } // Coordinator can also be a buyer
      ],
      isActive: true 
    });

    if (!buyer) {
      return res.status(400).json({
        success: false,
        message: 'Invalid buyer selected or buyer not found'
      });
    }

    // FIXED: Validate requisition status before assignment
    if (!['pending_buyer_assignment', 'pending_supply_chain_review'].includes(requisition.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot assign buyer to requisition with status: ${requisition.status}`
      });
    }

    // FIXED: Update supply chain review with proper buyer assignment
    if (!requisition.supplyChainReview) {
      requisition.supplyChainReview = {};
    }

    requisition.supplyChainReview = {
      ...requisition.supplyChainReview,
      decision: 'approve',
      sourcingType: sourcingType,
      assignedBuyer: assignedBuyer,
      buyerAssignmentDate: new Date(),
      buyerAssignedBy: req.user.userId,
      estimatedCost: estimatedCost,  // NEW: Add estimated cost
      comments: comments,
      purchaseTypeAssigned: purchaseType || requisition.purchaseType
    };

    // Update main purchase type if provided
    if (purchaseType) {
      requisition.purchaseType = purchaseType;
    }

    // NEW: Set payment method
    requisition.paymentMethod = paymentMethod;

    // FIXED: Set correct status after buyer assignment
    requisition.status = 'pending_head_approval';

    await requisition.save();

    // FIXED: Update buyer workload properly
    if (buyer.buyerDetails) {
      await User.findByIdAndUpdate(assignedBuyer, {
        $inc: { 'buyerDetails.workload.currentAssignments': 1 }
      });
    } else {
      // Initialize buyer details if they don't exist
      await User.findByIdAndUpdate(assignedBuyer, {
        $set: {
          'buyerDetails.workload.currentAssignments': 1,
          'buyerDetails.workload.monthlyTarget': 20,
          'buyerDetails.availability.isAvailable': true,
          'buyerDetails.maxOrderValue': 5000000,
          'buyerDetails.specializations': ['General']
        }
      });
    }

    // Send notifications
    const notifications = [];

    // Notify assigned buyer
    notifications.push(
      sendEmail({
        to: buyer.email,
        subject: `New Purchase Requisition Assignment - ${requisition.employee.fullName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
              <h2 style="color: #1890ff; margin-top: 0;">New Procurement Assignment</h2>
              <p>You have been assigned a new purchase requisition for processing.</p>

              <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <h4>Assignment Details</h4>
                <ul>
                  <li><strong>Employee:</strong> ${requisition.employee.fullName}</li>
                  <li><strong>Requisition:</strong> ${requisition.title}</li>
                  <li><strong>Category:</strong> ${requisition.itemCategory}</li>
                  <li><strong>Budget:</strong> XAF ${requisition.financeVerification?.assignedBudget?.toLocaleString() || requisition.budgetXAF?.toLocaleString() || 'TBD'}</li>
                  ${estimatedCost ? `<li><strong>Estimated Cost:</strong> XAF ${estimatedCost.toLocaleString()}</li>` : ''}
                  <li><strong>Sourcing Type:</strong> ${sourcingType.replace('_', ' ').toUpperCase()}</li>
                  ${purchaseType ? `<li><strong>Purchase Type:</strong> ${purchaseType.replace('_', ' ').toUpperCase()}</li>` : ''}
                  <li><strong>Payment Method:</strong> ${paymentMethod.toUpperCase()}</li>
                  <li><strong>Items Count:</strong> ${requisition.items.length}</li>
                </ul>
              </div>

              ${comments ? `
              <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px;">
                <p><strong>Assignment Notes:</strong></p>
                <p style="font-style: italic;">${comments}</p>
              </div>
              ` : ''}

              <div style="text-align: center; margin: 20px 0;">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/buyer/requisitions/${requisition._id}"
                   style="background-color: #1890ff; color: white; padding: 12px 24px;
                          text-decoration: none; border-radius: 6px; font-weight: bold;">
                  View Assignment Details
                </a>
              </div>
            </div>
          </div>
        `
      }).catch(error => {
        console.error('Failed to send buyer notification:', error);
        return { error, type: 'buyer' };
      })
    );

    // Notify head of supply chain for final approval
    const headOfSupplyChain = await User.findOne({
      email: 'kelvin.eyong@gratoglobal.com'
    });

    if (headOfSupplyChain) {
      notifications.push(
        sendEmail({
          to: headOfSupplyChain.email,
          subject: `Purchase Requisition Ready for Final Approval - ${requisition.employee.fullName}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
                <h2 style="color: #856404; margin-top: 0;">Final Approval Required</h2>
                <p>A purchase requisition has been processed and assigned, requiring your final approval.</p>

                <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <h4>Requisition Summary</h4>
                  <ul>
                    <li><strong>Employee:</strong> ${requisition.employee.fullName}</li>
                    <li><strong>Title:</strong> ${requisition.title}</li>
                    <li><strong>Budget:</strong> XAF ${requisition.financeVerification?.assignedBudget?.toLocaleString() || requisition.budgetXAF?.toLocaleString()}</li>
                    ${estimatedCost ? `<li><strong>Estimated Cost:</strong> XAF ${estimatedCost.toLocaleString()}</li>` : ''}
                    <li><strong>Budget Code:</strong> ${requisition.financeVerification?.budgetCode || 'N/A'}</li>
                    <li><strong>Assigned Buyer:</strong> ${buyer.fullName}</li>
                    <li><strong>Sourcing Method:</strong> ${sourcingType.replace('_', ' ').toUpperCase()}</li>
                    ${purchaseType ? `<li><strong>Purchase Type:</strong> ${purchaseType.replace('_', ' ').toUpperCase()}</li>` : ''}
                    <li><strong>Payment Method:</strong> ${paymentMethod.toUpperCase()}</li>
                  </ul>
                </div>

                <div style="text-align: center; margin: 20px 0;">
                  <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/supply-chain/head/requisitions/${requisition._id}"
                     style="background-color: #ffc107; color: #333; padding: 12px 24px;
                            text-decoration: none; border-radius: 6px; font-weight: bold;">
                    Review & Approve
                  </a>
                </div>
              </div>
            </div>
          `
        }).catch(error => {
          console.error('Failed to send head notification:', error);
          return { error, type: 'head' };
        })
      );
    }

    // Wait for notifications
    const notificationResults = await Promise.allSettled(notifications);

    console.log('=== BUYER ASSIGNMENT COMPLETED ===');
    res.json({
      success: true,
      message: 'Buyer assigned successfully',
      data: {
        requisition,
        assignedBuyer: {
          id: buyer._id,
          name: buyer.fullName,
          email: buyer.email,
          role: buyer.role,
          departmentRole: buyer.departmentRole
        },
        paymentMethod  // NEW: Include payment method in response
      },
      notifications: {
        sent: notificationResults.filter(r => r.status === 'fulfilled' && !r.value?.error).length,
        failed: notificationResults.filter(r => r.status === 'rejected' || r.value?.error).length
      }
    });

  } catch (error) {
    console.error('Assign buyer error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign buyer',
      error: error.message
    });
  }
};


/**
 * Assign buyer with payment method
 * ENHANCED: Now includes payment method selection
 */
const assignBuyerWithPaymentMethod = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { 
      buyerId, 
      paymentMethod, // NEW: 'bank' or 'cash'
      estimatedCost,
      sourcingType,
      purchaseTypeAssigned,
      comments 
    } = req.body;
    
    console.log('=== ASSIGN BUYER WITH PAYMENT METHOD ===');
    console.log('Requisition ID:', requisitionId);
    console.log('Buyer ID:', buyerId);
    console.log('Payment Method:', paymentMethod);
    
    // Validation
    if (!buyerId) {
      return res.status(400).json({
        success: false,
        message: 'Buyer ID is required'
      });
    }
    
    if (!paymentMethod || !['bank', 'cash'].includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Valid payment method (bank or cash) is required'
      });
    }
    
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');
    
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }
    
    // Verify status
    if (requisition.status !== 'pending_buyer_assignment') {
      return res.status(400).json({
        success: false,
        message: `Cannot assign buyer. Current status: ${requisition.status}`
      });
    }
    
    // Verify buyer exists and is actually a buyer
    const buyer = await User.findById(buyerId);
    if (!buyer) {
      return res.status(404).json({
        success: false,
        message: 'Buyer not found'
      });
    }
    
    if (buyer.role !== 'buyer' && buyer.departmentRole !== 'buyer') {
      return res.status(400).json({
        success: false,
        message: 'Selected user is not a buyer'
      });
    }
    
    // Update supply chain review with payment method
    requisition.supplyChainReview = {
      ...requisition.supplyChainReview,
      assignedBuyer: buyerId,
      buyerAssignmentDate: new Date(),
      buyerAssignedBy: req.user.userId,
      paymentMethod: paymentMethod, // NEW FIELD
      estimatedCost: estimatedCost || requisition.budgetXAF,
      sourcingType: sourcingType || 'quotation_required',
      purchaseTypeAssigned: purchaseTypeAssigned || requisition.purchaseType,
      comments: comments || `Buyer assigned with ${paymentMethod} payment method`,
      decision: 'approve',
      decisionDate: new Date(),
      decidedBy: req.user.userId
    };
    
    // Move to next stage - head approval
    requisition.status = 'pending_head_approval';
    
    await requisition.save();
    
    console.log(`Buyer assigned successfully with ${paymentMethod} payment method`);
    
    // Send notification to buyer
    try {
      const assignedBy = await User.findById(req.user.userId);
      
      await sendEmail({
        to: buyer.email,
        subject: `New Requisition Assigned - ${requisition.title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
              <h2 style="color: #1890ff; margin-top: 0;">New Purchase Requisition Assigned</h2>
              <p>Dear ${buyer.fullName},</p>
              <p>A new purchase requisition has been assigned to you by ${assignedBy.fullName}.</p>
              
              <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                <h4>Requisition Details</h4>
                <ul>
                  <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                  <li><strong>Title:</strong> ${requisition.title}</li>
                  <li><strong>Requester:</strong> ${requisition.employee.fullName}</li>
                  <li><strong>Department:</strong> ${requisition.employee.department}</li>
                  <li><strong>Category:</strong> ${requisition.itemCategory}</li>
                  <li><strong>Budget:</strong> XAF ${requisition.budgetXAF.toLocaleString()}</li>
                  <li><strong>Payment Method:</strong> ${paymentMethod === 'cash' ? 'Petty Cash' : 'Bank Transfer'}</li>
                  <li><strong>Urgency:</strong> ${requisition.urgency}</li>
                </ul>
              </div>
              
              ${paymentMethod === 'cash' ? `
              <div style="background-color: #fff7e6; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #faad14;">
                <h4 style="color: #faad14; margin-top: 0;">Petty Cash Payment</h4>
                <p>This requisition will be paid through petty cash. A petty cash form will be generated once the Head of Business approves this requisition.</p>
                <p><strong>You will be notified when the form is ready for download.</strong></p>
              </div>
              ` : `
              <div style="background-color: #f6ffed; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #52c41a;">
                <h4 style="color: #52c41a; margin-top: 0;">Bank Transfer Payment</h4>
                <p>This requisition will be paid through bank transfer. You can proceed with the sourcing process once approved by the Head of Business.</p>
              </div>
              `}
              
              <p><strong>Next Steps:</strong></p>
              <ul>
                <li>Review the requisition details in your dashboard</li>
                <li>Wait for Head of Business approval</li>
                ${paymentMethod === 'cash' ? 
                  '<li>Download and review the petty cash form once generated</li>' :
                  '<li>Begin the RFQ process after approval</li>'
                }
              </ul>
              
              <p>Please log in to your buyer dashboard to view full details.</p>
              <p>Best regards,<br>Supply Chain Team</p>
            </div>
          </div>
        `
      });
      
      console.log('Buyer notification email sent successfully');
    } catch (emailError) {
      console.error('Failed to send buyer notification:', emailError);
      // Don't fail the assignment if email fails
    }
    
    res.json({
      success: true,
      message: `Buyer assigned successfully with ${paymentMethod} payment method`,
      data: {
        requisitionId: requisition._id,
        requisitionNumber: requisition.requisitionNumber,
        assignedBuyer: {
          id: buyer._id,
          name: buyer.fullName,
          email: buyer.email
        },
        paymentMethod: paymentMethod,
        status: requisition.status,
        nextStage: 'pending_head_approval'
      }
    });
    
  } catch (error) {
    console.error('Error assigning buyer with payment method:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign buyer',
      error: error.message
    });
  }
};


/**
 * Get payment method options for requisition
 */
const getPaymentMethodOptions = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    
    const requisition = await PurchaseRequisition.findById(requisitionId);
    
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }
    
    // Determine available payment methods based on amount and other criteria
    const amount = requisition.budgetXAF || 0;
    
    const options = {
      availableMethods: ['bank', 'cash'],
      recommendedMethod: amount > 1000000 ? 'bank' : 'cash', // Recommend bank for large amounts
      limits: {
        cash: {
          maximum: 5000000, // 5M XAF limit for petty cash
          recommended: 1000000 // 1M XAF recommended limit
        }
      },
      warnings: []
    };
    
    // Add warnings based on amount
    if (amount > options.limits.cash.maximum) {
      options.availableMethods = ['bank'];
      options.warnings.push(`Amount exceeds petty cash limit of XAF ${options.limits.cash.maximum.toLocaleString()}. Bank payment required.`);
    } else if (amount > options.limits.cash.recommended) {
      options.warnings.push(`Amount exceeds recommended petty cash limit of XAF ${options.limits.cash.recommended.toLocaleString()}. Bank payment is recommended.`);
    }
    
    res.json({
      success: true,
      data: options
    });
    
  } catch (error) {
    console.error('Error getting payment method options:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment method options',
      error: error.message
    });
  }
};


// const getFinanceRequisitions = async (req, res) => {
//   try {
//       console.log('\n=== FETCHING FINANCE REQUISITIONS ===');
      
//       const user = await User.findById(req.user.userId);
      
//       if (!user) {
//           return res.status(404).json({ 
//               success: false, 
//               message: 'User not found' 
//           });
//       }

//       const financeEmail = user.email.toLowerCase();
//       console.log('Finance user:', financeEmail);

//       const query = {
//           $or: [
//               { status: 'pending_finance_verification' },
//               {
//                   status: 'pending_supervisor',
//                   'approvalChain': {
//                       $elemMatch: {
//                           'approver.email': financeEmail,
//                           'approver.role': { $regex: /finance/i },
//                           'status': 'pending'
//                       }
//                   }
//               },
//               {
//                   'financeVerification.verifiedBy': req.user.userId
//               },
//               {
//                   status: { $in: ['approved', 'partially_disbursed', 'fully_disbursed'] }, // ✅ ADD fully_disbursed
//                   'financeVerification.verifiedBy': req.user.userId
//               }
//           ]
//       };

//       console.log('Finance query:', JSON.stringify(query, null, 2));

//       const requisitions = await PurchaseRequisition.find(query)
//           .populate('employee', 'fullName email department')
//           .populate('financeVerification.verifiedBy', 'fullName email')
//           .populate('disbursements.disbursedBy', 'fullName email') // ✅ NEW: Populate disbursement user
//           .sort({ createdAt: -1 })
//           .lean(); // Keep lean for performance

//       console.log(`✅ Found ${requisitions.length} requisitions for finance`);

//       // ✅ Add finance-specific flags AND disbursement info
//       const enrichedRequisitions = requisitions.map(req => {
//           const financeStep = req.approvalChain?.find(step => 
//               step.approver.email.toLowerCase() === financeEmail &&
//               step.approver.role?.toLowerCase().includes('finance')
//           );

//           // ✅ Calculate disbursement data
//           const totalBudget = req.budgetXAF || 0;
//           const totalDisbursed = req.totalDisbursed || 0;
//           const remainingBalance = req.remainingBalance ?? (totalBudget - totalDisbursed);
//           const disbursementProgress = totalBudget > 0 
//               ? Math.round((totalDisbursed / totalBudget) * 100) 
//               : 0;

//           return {
//               ...req,
//               financeApprovalStep: financeStep,
//               isAwaitingFinance: financeStep?.status === 'pending',
//               financeHasActed: financeStep?.status !== 'pending',
              
//               // ✅ NEW: Add disbursement info
//               totalDisbursed: totalDisbursed,
//               remainingBalance: remainingBalance,
//               disbursementProgress: disbursementProgress,
//               disbursements: req.disbursements || []
//           };
//       });

//       res.json({
//           success: true,
//           data: enrichedRequisitions,
//           count: enrichedRequisitions.length,
//           pending: enrichedRequisitions.filter(r => r.isAwaitingFinance).length
//       });

//   } catch (error) {
//       console.error('Get finance requisitions error:', error);
//       res.status(500).json({
//           success: false,
//           message: 'Failed to fetch finance requisitions',
//           error: error.message
//       });
//   }
// };


// const getFinanceRequisitions = async (req, res) => {
//   try {
//       console.log('\n=== FETCHING FINANCE REQUISITIONS ===');
      
//       const user = await User.findById(req.user.userId);
      
//       if (!user) {
//           return res.status(404).json({ 
//               success: false, 
//               message: 'User not found' 
//           });
//       }

//       const financeEmail = user.email.toLowerCase();
//       console.log('Finance user:', financeEmail);

//       const query = {
//           $or: [
//               { status: 'pending_finance_verification' },
//               {
//                   status: 'pending_supervisor',
//                   'approvalChain': {
//                       $elemMatch: {
//                           'approver.email': financeEmail,
//                           'approver.role': { $regex: /finance/i },
//                           'status': 'pending'
//                       }
//                   }
//               },
//               {
//                   'financeVerification.verifiedBy': req.user.userId
//               },
//               {
//                   status: { $in: ['approved', 'partially_disbursed', 'fully_disbursed'] },
//                   'financeVerification.verifiedBy': req.user.userId
//               }
//           ]
//       };

//       console.log('Finance query:', JSON.stringify(query, null, 2));

//       // const requisitions = await PurchaseRequisition.find(query)
//       //     .populate('employee', 'fullName email department')
//       //     .populate('financeVerification.verifiedBy', 'fullName email')
//       //     .populate('disbursements.disbursedBy', 'fullName email')
//       //     .populate('disbursements.acknowledgedBy', 'fullName email') // ✅ ADD THIS
//       //     .sort({ createdAt: -1 })
//       //     .lean();

//       // In getFinanceRequisitions controller
//     const requisitions = await PurchaseRequisition.find(query)
//       .populate('employee', 'fullName email department')
//       .populate('financeVerification.verifiedBy', 'fullName email')
//       .populate('disbursements.disbursedBy', 'fullName email')
//       .populate('disbursements.acknowledgedBy', 'fullName email') // ✅ CRITICAL
//       .sort({ createdAt: -1 })
//       .lean();

//       console.log(`✅ Found ${requisitions.length} requisitions for finance`);

//       // ✅ Add finance-specific flags AND disbursement info
//       const enrichedRequisitions = requisitions.map(req => {
//           const financeStep = req.approvalChain?.find(step => 
//               step.approver.email.toLowerCase() === financeEmail &&
//               step.approver.role?.toLowerCase().includes('finance')
//           );

//           const totalBudget = req.budgetXAF || 0;
//           const totalDisbursed = req.totalDisbursed || 0;
//           const remainingBalance = req.remainingBalance ?? (totalBudget - totalDisbursed);
//           const disbursementProgress = totalBudget > 0 
//               ? Math.round((totalDisbursed / totalBudget) * 100) 
//               : 0;

//           return {
//               ...req,
//               financeApprovalStep: financeStep,
//               isAwaitingFinance: financeStep?.status === 'pending',
//               financeHasActed: financeStep?.status !== 'pending',
              
//               totalDisbursed: totalDisbursed,
//               remainingBalance: remainingBalance,
//               disbursementProgress: disbursementProgress,
//               disbursements: req.disbursements || []
//           };
//       });

//       res.json({
//           success: true,
//           data: enrichedRequisitions,
//           count: enrichedRequisitions.length,
//           pending: enrichedRequisitions.filter(r => r.isAwaitingFinance).length
//       });

//   } catch (error) {
//       console.error('Get finance requisitions error:', error);
//       res.status(500).json({
//           success: false,
//           message: 'Failed to fetch finance requisitions',
//           error: error.message
//       });
//   }
// };


const getFinanceRequisitions = async (req, res) => {
  try {
      console.log('\n=== FETCHING FINANCE REQUISITIONS ===');
      
      const user = await User.findById(req.user.userId);
      
      if (!user) {
          return res.status(404).json({ 
              success: false, 
              message: 'User not found' 
          });
      }

      const financeEmail = user.email.toLowerCase();
      console.log('Finance user:', financeEmail);

        // Show all requisitions relevant to finance, including those already acted on
        const query = {
          $or: [
            { status: 'pending_finance_verification' },
            { status: 'justification_pending_finance' },
            {
              'approvalChain': {
                $elemMatch: {
                  'approver.email': financeEmail,
                  'approver.role': { $regex: /finance/i },
                  'status': 'pending'
                }
              }
            },
            {
              'financeVerification.verifiedBy': req.user.userId
            },
            {
              status: { $in: ['approved', 'partially_disbursed', 'fully_disbursed'] },
              'financeVerification.verifiedBy': req.user.userId
            }
          ]
        };

      console.log('Finance query:', JSON.stringify(query, null, 2));

      // ✅ CRITICAL FIX: Don't use .lean() to preserve document methods
      const requisitions = await PurchaseRequisition.find(query)
          .populate('employee', 'fullName email department')
          .populate('financeVerification.verifiedBy', 'fullName email')
          .populate('disbursements.disbursedBy', 'fullName email')
          .populate('disbursements.acknowledgedBy', 'fullName email') // ✅ CRITICAL
          .sort({ createdAt: -1 });
          // ❌ REMOVED .lean() 

      console.log(`✅ Found ${requisitions.length} requisitions for finance`);
      
      // ✅ Log disbursement acknowledgment status for debugging
      requisitions.forEach(req => {
          if (req.disbursements?.length > 0) {
              console.log(`📋 ${req.requisitionNumber}:`);
              req.disbursements.forEach((d, i) => {
                  console.log(`   Disbursement ${i + 1}: ${d.acknowledged ? '✅ Acknowledged' : '⏳ Pending'}`);
              });
          }
      });

      // ✅ Convert to plain objects and add finance-specific flags
      const enrichedRequisitions = requisitions.map(req => {
          const reqObj = req.toObject(); // ✅ Convert to plain object AFTER population
          
          const financeStep = reqObj.approvalChain?.find(step => 
              step.approver.email.toLowerCase() === financeEmail &&
              step.approver.role?.toLowerCase().includes('finance')
          );

          const totalBudget = reqObj.budgetXAF || 0;
          const totalDisbursed = reqObj.totalDisbursed || 0;
          const remainingBalance = reqObj.remainingBalance ?? (totalBudget - totalDisbursed);
          const disbursementProgress = totalBudget > 0 
              ? Math.round((totalDisbursed / totalBudget) * 100) 
              : 0;

          return {
              ...reqObj,
              financeApprovalStep: financeStep,
              isAwaitingFinance: financeStep?.status === 'pending',
              financeHasActed: financeStep?.status !== 'pending',
              
              totalDisbursed: totalDisbursed,
              remainingBalance: remainingBalance,
              disbursementProgress: disbursementProgress,
              disbursements: reqObj.disbursements || []
          };
      });

      res.json({
          success: true,
          data: enrichedRequisitions,
          count: enrichedRequisitions.length,
          pending: enrichedRequisitions.filter(r => r.isAwaitingFinance).length
      });

  } catch (error) {
      console.error('Get finance requisitions error:', error);
      res.status(500).json({
          success: false,
          message: 'Failed to fetch finance requisitions',
          error: error.message
      });
  }
};


// NEW: Get Available Buyers
const getAvailableBuyers = async (req, res) => {
  try {
    console.log('=== FETCHING AVAILABLE BUYERS ===');
    
    // Get all users who can act as buyers
    const buyers = await User.find({
      $or: [
        { role: 'buyer' },
        { departmentRole: 'buyer' },
        // Include supply chain coordinator who can also buy
        { email: 'lukong.lambert@gratoglobal.com' }
      ],
      isActive: true
    }).select('fullName email buyerDetails department role departmentRole');

    console.log('Found buyers from database:', buyers.length);

    // Process and enhance buyer data
    const processedBuyers = buyers.map(buyer => {
      const buyerObj = buyer.toObject();
      
      // Ensure buyerDetails exist with defaults
      if (!buyerObj.buyerDetails) {
        buyerObj.buyerDetails = {
          specializations: ['General'],
          maxOrderValue: buyer.email === 'lukong.lambert@gratoglobal.com' ? 10000000 : 5000000,
          workload: {
            currentAssignments: 0,
            monthlyTarget: 20
          },
          performance: {
            completedOrders: 0,
            averageProcessingTime: 0
          },
          availability: {
            isAvailable: true
          }
        };
      }

      // Special handling for coordinator
      if (buyer.email === 'lukong.lambert@gratoglobal.com') {
        buyerObj.buyerDetails = {
          ...buyerObj.buyerDetails,
          specializations: ['All'],
          maxOrderValue: 10000000,
          workload: {
            currentAssignments: buyerObj.buyerDetails.workload?.currentAssignments || 0,
            monthlyTarget: 30
          },
          performance: {
            completedOrders: buyerObj.buyerDetails.performance?.completedOrders || 50,
            averageProcessingTime: 2.5
          },
          availability: {
            isAvailable: true
          },
          canSelfBuy: true
        };
      }

      return buyerObj;
    });

    console.log('Processed buyers:', processedBuyers.map(b => ({ name: b.fullName, email: b.email, role: b.role })));

    res.json({
      success: true,
      data: processedBuyers,
      count: processedBuyers.length
    });

  } catch (error) {
    console.error('Get available buyers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch available buyers',
      error: error.message
    });
  }
};

const getBuyerRequisitions = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    console.log('=== FETCHING BUYER REQUISITIONS ===');
    console.log('User:', { id: user._id, name: user.fullName, role: user.role, departmentRole: user.departmentRole });
    
    let query = {};
    
    if (user.role === 'buyer' || user.departmentRole === 'buyer') {
      // Standard buyer - see their assigned requisitions
      query = {
        'supplyChainReview.assignedBuyer': req.user.userId,
        status: { $in: ['pending_head_approval', 'approved', 'in_procurement', 'procurement_complete'] }
      };
    } else if (user.role === 'supply_chain' || user.role === 'admin') {
      // Supply chain or admin - see all buyer assignments
      query = {
        'supplyChainReview.assignedBuyer': { $exists: true },
        status: { $in: ['pending_head_approval', 'approved', 'in_procurement', 'procurement_complete'] }
      };
    } else {
      return res.status(403).json({
        success: false,
        message: 'Access denied - not authorized to view buyer requisitions'
      });
    }

    console.log('Query:', JSON.stringify(query, null, 2));

    const requisitions = await PurchaseRequisition.find(query)
      .populate('employee', 'fullName email department')
      .populate('supplyChainReview.assignedBuyer', 'fullName email role departmentRole')
      .sort({ createdAt: -1 });

    console.log('Found requisitions:', requisitions.length);

    res.json({
      success: true,
      data: requisitions,
      count: requisitions.length,
      userInfo: {
        role: user.role,
        departmentRole: user.departmentRole,
        canViewAll: ['admin', 'supply_chain'].includes(user.role)
      }
    });
    
  } catch (error) {
    console.error('Get buyer requisitions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch buyer requisitions',
      error: error.message
    });
  }
};


const getHeadApprovalRequisitions = async (req, res) => {
  try {
      console.log('\n=== FETCHING HEAD APPROVAL REQUISITIONS ===');
      
      const user = await User.findById(req.user.userId);

      // Check permissions (Head of Business Dev & Supply Chain)
      const canView =
          user.role === 'admin' ||
          user.email === 'kelvin.eyong@gratoglobal.com';

      if (!canView) {
          return res.status(403).json({
              success: false,
              message: 'Access denied'
          });
      }

      const requisitions = await PurchaseRequisition.find({
          status: 'pending_head_approval'
      })
          .populate('employee', 'fullName email department')
          .populate('financeVerification.verifiedBy', 'fullName')
          .populate('supplyChainReview.assignedBuyer', 'fullName email')
          .sort({ createdAt: -1 })
          .lean();

      // ✅ Transform data to match frontend expectations
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
          
          // ✅ CRITICAL: Get payment method from ROOT level
          paymentMethod: req.paymentMethod || 'cash', // Default to cash
          
          // Finance info
          financeVerification: {
              budgetAvailable: req.financeVerification?.budgetAvailable,
              assignedBudget: req.financeVerification?.assignedBudget,
              budgetCode: req.financeVerification?.budgetCode,
              comments: req.financeVerification?.comments,
              verifiedBy: req.financeVerification?.verifiedBy?.fullName,
              verificationDate: req.financeVerification?.verificationDate
          },
          
          // Supply chain decisions
          sourcingType: req.supplyChainReview?.sourcingType,
          purchaseType: req.supplyChainReview?.purchaseTypeAssigned || req.purchaseType,
          buyerAssignmentDate: req.supplyChainReview?.buyerAssignmentDate,
          assignedBuyer: req.supplyChainReview?.assignedBuyer ? {
              id: req.supplyChainReview.assignedBuyer._id || req.supplyChainReview.assignedBuyer,
              name: req.supplyChainReview.assignedBuyer.fullName,
              email: req.supplyChainReview.assignedBuyer.email
          } : null,
          
          // Items
          items: req.items,
          
          // Justification
          justification: req.justificationOfPurchase,
          deliveryLocation: req.deliveryLocation,
          
          // ✅ Include approval chain
          approvalChain: req.approvalChain,
          
          // Head approval
          headApproval: {
              decision: req.headApproval?.decision || 'pending',
              businessDecisions: req.headApproval?.businessDecisions || {}
          }
      }));

      console.log(`✅ Found ${transformedRequisitions.length} requisitions for head approval`);
      console.log('Payment methods:', transformedRequisitions.map(r => ({ 
          id: r.requisitionNumber, 
          payment: r.paymentMethod 
      })));

      res.json({
          success: true,
          data: transformedRequisitions,
          count: transformedRequisitions.length,
          message: 'Requisitions ready for final approval'
      });

  } catch (error) {
      console.error('Get head approval requisitions error:', error);
      res.status(500).json({
          success: false,
          message: 'Failed to fetch head approval requisitions',
          error: error.message
      });
  }
};

const getBudgetCodesForVerification = async (req, res) => {
  try {
    const BudgetCode = require('../models/BudgetCode');
    const { department } = req.query;

    let filter = { active: true };
    
    // If department is specified, get codes for that department or general codes
    if (department) {
      filter.$or = [
        { department: department },
        { department: 'General' }
      ];
    }

    const budgetCodes = await BudgetCode.find(filter)
      .select('code name budget used department budgetType')
      .sort({ utilizationPercentage: 1 }); // Sort by lowest utilization first

    // Format for dropdown with availability info
    const formattedCodes = budgetCodes.map(code => ({
      code: code.code,
      name: code.name,
      department: code.department,
      budgetType: code.budgetType,
      totalBudget: code.budget,
      used: code.used,
      available: code.budget - code.used,
      utilizationRate: code.budget > 0 ? Math.round((code.used / code.budget) * 100) : 0,
      status: code.budget > 0 ? (
        (code.used / code.budget) >= 0.9 ? 'critical' :
        (code.used / code.budget) >= 0.75 ? 'high' :
        (code.used / code.budget) >= 0.5 ? 'moderate' : 'low'
      ) : 'low'
    }));

    res.json({
      success: true,
      data: formattedCodes,
      count: formattedCodes.length
    });

  } catch (error) {
    console.error('Get budget codes for verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch budget codes',
      error: error.message
    });
  }
};

// Finance Dashboard Data
const getFinanceDashboardData = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    // Check permissions
    const canView = user.role === 'admin' || 
                   user.role === 'finance' || 
                   user.email === 'ranibellmambo@gratoengineering.com';

    if (!canView) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get all finance-related requisitions
    const financeRequisitions = await PurchaseRequisition.find({
      status: { 
        $in: [
          'pending_finance_verification',
          'pending_supply_chain_review',
          'pending_buyer_assignment',
          'pending_head_approval',
          'approved',
          'in_procurement',
          'procurement_complete'
        ]
      }
    })
    .populate('employee', 'fullName email department')
    .populate('financeVerification.verifiedBy', 'fullName email')
    .populate('supplyChainReview.assignedBuyer', 'fullName email')
    .sort({ createdAt: -1 });

    // Calculate statistics
    const stats = {
      totalValue: 0,
      pendingVerification: 0,
      approvedThisMonth: 0,
      rejectedThisMonth: 0,
      averageProcessingTime: 0,
      budgetUtilization: 0
    };

    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();

    // Process each requisition for statistics
    financeRequisitions.forEach(req => {
      // Calculate total value
      const reqValue = req.budgetXAF || req.supplyChainReview?.estimatedCost || 0;
      stats.totalValue += reqValue;

      // Count pending verification
      if (req.status === 'pending_finance_verification') {
        stats.pendingVerification++;
      }

      // Count monthly approvals/rejections
      const createdDate = new Date(req.createdAt);
      if (createdDate.getMonth() === currentMonth && createdDate.getFullYear() === currentYear) {
        if (req.financeVerification?.decision === 'approved') {
          stats.approvedThisMonth++;
        } else if (req.financeVerification?.decision === 'rejected') {
          stats.rejectedThisMonth++;
        }
      }
    });

    // Get urgent/high priority items requiring attention
    const urgentItems = financeRequisitions.filter(req => 
      req.status === 'pending_finance_verification' && 
      (req.urgency === 'High' || 
       new Date() - new Date(req.createdAt) > 7 * 24 * 60 * 60 * 1000) // More than 7 days old
    );

    // Get recent activity (last 10 finance-related actions)
    const recentActivity = financeRequisitions
      .filter(req => req.financeVerification?.verificationDate)
      .sort((a, b) => new Date(b.financeVerification.verificationDate) - new Date(a.financeVerification.verificationDate))
      .slice(0, 10)
      .map(req => ({
        id: req._id,
        requisitionNumber: req.requisitionNumber,
        title: req.title,
        employee: req.employee,
        action: req.financeVerification.decision,
        amount: req.budgetXAF || req.supplyChainReview?.estimatedCost || 0,
        date: req.financeVerification.verificationDate,
        verifiedBy: req.financeVerification.verifiedBy
      }));

    // Get budget breakdown by department
    const departmentBreakdown = {};
    financeRequisitions.forEach(req => {
      const dept = req.employee?.department || 'Unknown';
      const amount = req.budgetXAF || req.supplyChainReview?.estimatedCost || 0;
      
      if (!departmentBreakdown[dept]) {
        departmentBreakdown[dept] = {
          totalAmount: 0,
          count: 0,
          pending: 0,
          approved: 0
        };
      }
      
      departmentBreakdown[dept].totalAmount += amount;
      departmentBreakdown[dept].count++;
      
      if (req.status === 'pending_finance_verification') {
        departmentBreakdown[dept].pending++;
      } else if (req.financeVerification?.decision === 'approved') {
        departmentBreakdown[dept].approved++;
      }
    });

    // Get monthly trends (last 6 months)
    const monthlyTrends = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const month = date.getMonth();
      const year = date.getFullYear();
      
      const monthData = financeRequisitions.filter(req => {
        const reqDate = new Date(req.createdAt);
        return reqDate.getMonth() === month && reqDate.getFullYear() === year;
      });
      
      monthlyTrends.push({
        month: date.toLocaleString('default', { month: 'short', year: 'numeric' }),
        totalRequests: monthData.length,
        totalValue: monthData.reduce((sum, req) => sum + (req.budgetXAF || 0), 0),
        approved: monthData.filter(req => req.financeVerification?.decision === 'approved').length,
        rejected: monthData.filter(req => req.financeVerification?.decision === 'rejected').length
      });
    }

    // ✅ NEW: Get disbursement stats
    const pendingDisbursement = await PurchaseRequisition.countDocuments({
      status: { $in: ['approved', 'partially_disbursed'] },
      remainingBalance: { $gt: 0 }
    });

    const partiallyDisbursed = await PurchaseRequisition.countDocuments({
      status: 'partially_disbursed'
    });

    const fullyDisbursed = await PurchaseRequisition.countDocuments({
      status: 'fully_disbursed'
    });

    // ✅ Add to stats object
    stats.pendingDisbursement = pendingDisbursement;
    stats.partiallyDisbursed = partiallyDisbursed;
    stats.fullyDisbursed = fullyDisbursed;

    res.json({
      success: true,
      data: {
        statistics: stats,
        urgentItems: urgentItems.slice(0, 10), // Limit to 10 most urgent
        recentActivity,
        departmentBreakdown,
        monthlyTrends,
        pendingRequisitions: financeRequisitions.filter(req => req.status === 'pending_finance_verification'),
        totalRequisitions: financeRequisitions.length
      }
    });

  } catch (error) {
    console.error('Get finance dashboard data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch finance dashboard data',
      error: error.message
    });
  }
};


const processSupplyChainBusinessDecisions = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { 
      sourcingType, 
      purchaseType,
      paymentMethod, 
      assignedBuyer, 
      estimatedCost,
      budgetXAF,
      comments 
    } = req.body;
    
    console.log('\n=== SUPPLY CHAIN BUSINESS DECISIONS ===');
    console.log('Requisition ID:', requisitionId);
    console.log('Payment Method:', paymentMethod);
    console.log('Budget Assignment:', budgetXAF ? `XAF ${parseFloat(budgetXAF).toLocaleString()}` : 'Using existing');
    
    const user = await User.findById(req.user.userId);
    
    // Verify user is Supply Chain Coordinator or Admin
    const canProcess = 
      user.role === 'admin' ||
      user.role === 'supply_chain' ||
      user.email === 'lukong.lambert@gratoglobal.com';
    
    if (!canProcess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Supply Chain Coordinator can make these decisions.'
      });
    }
    
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department')
      .populate('financeVerification.verifiedBy', 'fullName email');
    
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }
    
    // Must be after finance verification
    if (requisition.status !== 'pending_supply_chain_review') {
      return res.status(400).json({
        success: false,
        message: `Cannot process at this stage. Current status: ${requisition.status}`
      });
    }
    
    // ============================================
    // VALIDATION
    // ============================================
    const validationErrors = [];
    
    if (!sourcingType || !['direct_purchase', 'quotation_required', 'tender_process', 'framework_agreement'].includes(sourcingType)) {
      validationErrors.push('Valid sourcing type is required');
    }
    
    if (!purchaseType || !['opex', 'capex', 'standard', 'emergency'].includes(purchaseType)) {
      validationErrors.push('Valid purchase type is required');
    }
    
    if (!paymentMethod || !['bank', 'cash'].includes(paymentMethod)) {
      validationErrors.push('Valid payment method (bank or cash) is required');
    }
    
    if (!assignedBuyer) {
      validationErrors.push('Buyer assignment is required');
    }
    
    // ✅ FIX: Check multiple budget sources with fallback chain
    const finalBudget = budgetXAF 
      ? parseFloat(budgetXAF) 
      : requisition.budgetXAF || requisition.financeVerification?.assignedBudget || 0;
    
    console.log('Budget check:');
    console.log('  - budgetXAF param:', budgetXAF);
    console.log('  - requisition.budgetXAF:', requisition.budgetXAF);
    console.log('  - financeVerification.assignedBudget:', requisition.financeVerification?.assignedBudget);
    console.log('  - finalBudget:', finalBudget);
    
    if (!finalBudget || finalBudget <= 0) {
      validationErrors.push('Budget amount is required. Please assign a budget for this requisition.');
    }
    
    if (finalBudget && finalBudget > 999999999) {
      validationErrors.push(`Budget amount (XAF ${finalBudget.toLocaleString()}) exceeds maximum allowed`);
    }
    
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }
    
    // ============================================
    // UPDATE BUDGET IF ASSIGNED BY SUPPLY CHAIN
    // ============================================
    let budgetAssignedBySupplyChain = false;
    let previousBudget = requisition.budgetXAF;
    
    if (budgetXAF && parseFloat(budgetXAF) !== requisition.budgetXAF) {
      console.log(`\n💰 Supply Chain assigning/updating budget:`);
      console.log(`   Previous: ${previousBudget ? `XAF ${previousBudget.toLocaleString()}` : 'Not set'}`);
      console.log(`   New: XAF ${parseFloat(budgetXAF).toLocaleString()}`);
      
      requisition.budgetXAF = parseFloat(budgetXAF);
      budgetAssignedBySupplyChain = true;
      
      if (requisition.financeVerification) {
        requisition.financeVerification.assignedBudget = parseFloat(budgetXAF);
      }
      
      console.log('✅ Budget updated successfully');
    }
    
    // Validate buyer
    const buyer = await User.findOne({
      _id: assignedBuyer,
      $or: [
        { role: 'buyer' },
        { departmentRole: 'buyer' },
        { email: 'lukong.lambert@gratoglobal.com' }
      ],
      isActive: true
    });
    
    if (!buyer) {
      return res.status(400).json({
        success: false,
        message: 'Invalid buyer selected or buyer is not active'
      });
    }
    
    console.log(`✅ Buyer validated: ${buyer.fullName}`);
    
    // Update approval chain
    const supplyChainStepIndex = requisition.approvalChain.findIndex(
      step => step.approver.email.toLowerCase() === user.email.toLowerCase() && 
              step.status === 'pending'
    );

    if (supplyChainStepIndex !== -1) {
      requisition.approvalChain[supplyChainStepIndex].status = 'approved';
      requisition.approvalChain[supplyChainStepIndex].comments = comments + 
        (budgetAssignedBySupplyChain ? `\n[Budget assigned: XAF ${parseFloat(budgetXAF).toLocaleString()}]` : '');
      requisition.approvalChain[supplyChainStepIndex].actionDate = new Date();
      requisition.approvalChain[supplyChainStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
      requisition.approvalChain[supplyChainStepIndex].decidedBy = req.user.userId;
    }
    
    // Update supply chain review
    requisition.supplyChainReview = {
      ...requisition.supplyChainReview,
      sourcingType: sourcingType,
      purchaseTypeAssigned: purchaseType,
      assignedBuyer: assignedBuyer,
      buyerAssignmentDate: new Date(),
      buyerAssignedBy: req.user.userId,
      estimatedCost: estimatedCost || finalBudget,
      budgetAssignedBySupplyChain: budgetAssignedBySupplyChain,
      assignedBudget: budgetAssignedBySupplyChain ? parseFloat(budgetXAF) : requisition.budgetXAF,
      previousBudget: budgetAssignedBySupplyChain ? previousBudget : undefined,
      comments: comments,
      decision: 'approve',
      decisionDate: new Date(),
      decidedBy: req.user.userId
    };
    
    requisition.paymentMethod = paymentMethod;
    requisition.purchaseType = purchaseType;
    requisition.status = 'pending_head_approval';
    
    await requisition.save();
    
    console.log('✅ Supply Chain business decisions recorded');
    console.log(`   Final Budget: XAF ${finalBudget.toLocaleString()}`);
    console.log(`   Payment: ${paymentMethod}`);
    console.log(`   Next: Head of Business approval`);
    
    // Send notifications (keeping existing notification code)...
    
    res.json({
      success: true,
      message: 'Business decisions recorded successfully',
      data: {
        requisitionId: requisition._id,
        status: requisition.status,
        paymentMethod: requisition.paymentMethod,
        budgetInfo: {
          finalBudget: finalBudget,
          assignedBySupplyChain: budgetAssignedBySupplyChain,
          previousBudget: previousBudget
        }
      }
    });
    
  } catch (error) {
    console.error('Process supply chain business decisions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process business decisions',
      error: error.message
    });
  }
};


/**
 * Process head approval decision
 * ENHANCED: Auto-generate petty cash form if payment method is cash
 */
const processHeadApproval = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { decision, comments } = req.body;
    
    console.log('=== PROCESS HEAD APPROVAL ===');
    console.log('Requisition ID:', requisitionId);
    console.log('Decision:', decision);
    
    const user = await User.findById(req.user.userId);
    
    // Verify authorization
    if (!['admin', 'supply_chain'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admin or supply chain head can approve.'
      });
    }
    
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department')
      .populate('supplyChainReview.assignedBuyer', 'fullName email');
    
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }
    
    // Verify status
    if (requisition.status !== 'pending_head_approval') {
      return res.status(400).json({
        success: false,
        message: `Cannot process approval. Current status: ${requisition.status}`
      });
    }
    
    // Update head approval
    requisition.headApproval = {
      decision: decision,
      comments: comments,
      decisionDate: new Date(),
      decidedBy: req.user.userId
    };
    
    if (decision === 'approved') {
      requisition.status = 'approved';
      
      // NEW: Auto-generate petty cash form if payment method is cash
      const paymentMethod = requisition.paymentMethod;
      
      if (paymentMethod === 'cash') {
        console.log('Payment method is cash - generating petty cash form');
        
        try {
          // Generate petty cash form number
          await requisition.generatePettyCashFormNumber();
          
          console.log('Petty cash form generated:', requisition.pettyCashForm.formNumber);
          
          // Save requisition with petty cash form
          await requisition.save();
          
          // Send notification to buyer about petty cash form
          if (requisition.supplyChainReview.assignedBuyer) {
            await sendPettyCashFormNotificationToBuyer(requisition);
          }
          
          // Send notification to employee
          await sendPettyCashFormNotificationToEmployee(requisition);
          
        } catch (pettyCashError) {
          console.error('Error generating petty cash form:', pettyCashError);
          // Continue with approval even if petty cash generation fails
          // The form can be regenerated later if needed
        }
      } else {
        console.log('Payment method is bank - no petty cash form needed');
        await requisition.save();
      }
      
      // Send approval notification
      try {
        await sendEmail({
          to: requisition.employee.email,
          subject: `Requisition Approved - ${requisition.title}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #f6ffed; padding: 20px; border-radius: 8px; border-left: 4px solid #52c41a;">
                <h2 style="color: #52c41a; margin-top: 0;">✓ Requisition Approved</h2>
                <p>Dear ${requisition.employee.fullName},</p>
                <p>Your purchase requisition has been approved by ${user.fullName} (Head of Business Dev & Supply Chain).</p>
                
                <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <h4>Requisition Details</h4>
                  <ul>
                    <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                    <li><strong>Title:</strong> ${requisition.title}</li>
                    <li><strong>Budget:</strong> XAF ${requisition.budgetXAF.toLocaleString()}</li>
                    <li><strong>Payment Method:</strong> ${paymentMethod === 'cash' ? 'Petty Cash' : 'Bank Transfer'}</li>
                    <li><strong>Approval Date:</strong> ${new Date().toLocaleDateString('en-GB')}</li>
                  </ul>
                </div>
                
                ${paymentMethod === 'cash' ? `
                <div style="background-color: #fff7e6; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <h4>Petty Cash Form Generated</h4>
                  <p><strong>Form Number:</strong> ${requisition.pettyCashForm?.formNumber}</p>
                  <p>A petty cash form has been automatically generated for this requisition. Your assigned buyer will handle the petty cash disbursement process.</p>
                </div>
                ` : `
                <div style="background-color: #e6f7ff; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <h4>Bank Transfer Payment</h4>
                  <p>This requisition will be processed through the standard procurement process with bank transfer payment.</p>
                  <p>Your assigned buyer will begin the sourcing process and send RFQs to qualified suppliers.</p>
                </div>
                `}
                
                <p><strong>Next Steps:</strong></p>
                <ul>
                  ${paymentMethod === 'cash' ? 
                    '<li>Your assigned buyer will download the petty cash form</li><li>The procurement process will continue as scheduled</li><li>You will be notified of any updates</li>' :
                    '<li>Your assigned buyer will create and send RFQs to suppliers</li><li>Suppliers will submit their quotations</li><li>The buyer will evaluate quotes and select the best option</li><li>You will be notified when procurement is complete</li>'
                  }
                </ul>
                
                <p>You can track your requisition status in your employee dashboard.</p>
                <p>Best regards,<br>Procurement Team</p>
              </div>
            </div>
          `
        });
        
        console.log('Approval email sent to employee');
      } catch (emailError) {
        console.error('Failed to send approval email:', emailError);
        // Don't fail the approval if email fails
      }
      
    } else if (decision === 'rejected') {
      requisition.status = 'rejected';
      await requisition.save();
      
      // Send rejection notification
      try {
        await sendEmail({
          to: requisition.employee.email,
          subject: `Requisition Rejected - ${requisition.title}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #fff2f0; padding: 20px; border-radius: 8px; border-left: 4px solid #ff4d4f;">
                <h2 style="color: #ff4d4f; margin-top: 0;">✗ Requisition Rejected</h2>
                <p>Dear ${requisition.employee.fullName},</p>
                <p>Your purchase requisition has been rejected by ${user.fullName} (Head of Business Dev & Supply Chain).</p>
                
                <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <h4>Requisition Details</h4>
                  <ul>
                    <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                    <li><strong>Title:</strong> ${requisition.title}</li>
                    <li><strong>Rejection Date:</strong> ${new Date().toLocaleDateString('en-GB')}</li>
                  </ul>
                </div>
                
                ${comments ? `
                <div style="background-color: #fff7e6; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <h4>Rejection Reason</h4>
                  <p>${comments}</p>
                </div>
                ` : ''}
                
                <p>If you believe this rejection was made in error or have additional information, please contact your supervisor or the Supply Chain team.</p>
                <p>Best regards,<br>Procurement Team</p>
              </div>
            </div>
          `
        });
        
        console.log('Rejection email sent to employee');
      } catch (emailError) {
        console.error('Failed to send rejection email:', emailError);
        // Don't fail the rejection if email fails
      }
    }

    // Log the approval decision
    await AuditLogger.log(
      decision === 'approved' ? 'HEAD_APPROVAL_APPROVED' : 'HEAD_APPROVAL_REJECTED',
      req.user.userId,
      requisitionId,
      {
        decision,
        comments,
        paymentMethod: requisition.paymentMethod,
        pettyCashGenerated: requisition.pettyCashForm?.generated,
        ipAddress: req.ip
      }
    );
    
    res.json({
      success: true,
      message: `Requisition ${decision}`,
      data: {
        requisitionId: requisition._id,
        requisitionNumber: requisition.requisitionNumber,
        status: requisition.status,
        decision: decision,
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
    res.status(500).json({
      success: false,
      message: 'Failed to process head approval',
      error: error.message
    });
  }
};

// Add this to your controller
const getHeadApprovalRequisition = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department')
      .populate('financeVerification.verifiedBy', 'fullName email')
      .populate('supplyChainReview.assignedBuyer', 'fullName email')
      .populate('supplyChainReview.decidedBy', 'fullName email')
      .lean();
    
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }
    
    // ✅ Format response with correct data
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
      
      // Employee info
      requester: requisition.employee?.fullName,
      requesterEmail: requisition.employee?.email,
      
      // Items
      items: requisition.items,
      
      // Justification
      justification: requisition.justificationOfPurchase,
      
      // Finance verification
      financeVerification: {
        budgetAvailable: requisition.financeVerification?.budgetAvailable,
        assignedBudget: requisition.financeVerification?.assignedBudget,
        budgetCode: requisition.financeVerification?.budgetCode,
        comments: requisition.financeVerification?.comments,
        verificationDate: requisition.financeVerification?.verificationDate,
        verifiedBy: requisition.financeVerification?.verifiedBy?.fullName
      },
      
      // ✅ CRITICAL: Supply chain decisions with correct payment method
      supplyChainDecisions: {
        sourcingType: requisition.supplyChainReview?.sourcingType,
        purchaseType: requisition.supplyChainReview?.purchaseTypeAssigned || requisition.purchaseType,
        paymentMethod: requisition.paymentMethod, // ✅ Get from main object
        estimatedCost: requisition.supplyChainReview?.estimatedCost,
        decidedBy: requisition.supplyChainReview?.decidedBy?.fullName,
        decisionDate: requisition.supplyChainReview?.decisionDate,
        comments: requisition.supplyChainReview?.comments
      },
      
      // Buyer assignment
      assignedBuyer: requisition.supplyChainReview?.assignedBuyer ? {
        id: requisition.supplyChainReview.assignedBuyer._id || requisition.supplyChainReview.assignedBuyer,
        name: requisition.supplyChainReview.assignedBuyer.fullName,
        email: requisition.supplyChainReview.assignedBuyer.email
      } : null,
      buyerAssignmentDate: requisition.supplyChainReview?.buyerAssignmentDate,
      
      // Approval chain
      approvalChain: requisition.approvalChain,
      
      // Head approval
      headApproval: requisition.headApproval || { decision: 'pending', businessDecisions: {} }
    };
    
    res.json({
      success: true,
      data: formattedResponse
    });
    
  } catch (error) {
    console.error('Get head approval requisition error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requisition',
      error: error.message
    });
  }
};

/**
 * Get dashboard statistics for purchase requisitions
 * Returns stats based on user role
 */
const getPurchaseRequisitionDashboardStats = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;

    console.log('=== GET PURCHASE REQUISITION DASHBOARD STATS ===');
    console.log('User:', userId);
    console.log('Role:', userRole);

    const user = await User.findById(userId);
    
    let query = { };

    // Filter based on user role
    if (userRole === 'employee') {
      // Employee sees only their requisitions
      query.employee = userId;
    } else if (userRole === 'supervisor' || userRole === 'technical') {
      // Supervisors see requisitions where they are in approval chain
      query.$or = [
        { employee: userId }, // Their own
        {
          'approvalChain.approver.email': user.email,
          'approvalChain.status': 'pending'
        }
      ];
    } else if (userRole === 'buyer') {
      // Buyers see assigned requisitions
      query.$or = [
        { employee: userId }, // Their own
        { 'supplyChainReview.assignedBuyer': userId }
      ];
    } else if (!['admin', 'finance', 'supply_chain', 'hr', 'it', 'hse'].includes(userRole)) {
      // Other roles see their own
      query.employee = userId;
    }
    // Admin, finance, supply_chain, hr, it, hse see all (no filter)

    console.log('Query:', JSON.stringify(query, null, 2));

    const requisitions = await PurchaseRequisition.find(query);

    // Calculate statistics
    const stats = {
      pending: requisitions.filter(r => 
        ['draft', 'pending_supervisor', 'pending_finance_verification', 
         'pending_supply_chain_review', 'pending_buyer_assignment', 
         'pending_head_approval'].includes(r.status)
      ).length,
      
      total: requisitions.length,
      
      // Additional stats for buyers
      ...(userRole === 'buyer' && {
        inProgress: requisitions.filter(r => 
          r.status === 'in_procurement' && 
          r.supplyChainReview?.assignedBuyer?.equals(userId)
        ).length,
        
        quotesReceived: requisitions.filter(r => 
          r.status === 'procurement_complete' && 
          r.supplyChainReview?.assignedBuyer?.equals(userId)
        ).length,
        
        completed: requisitions.filter(r => 
          ['procurement_complete', 'delivered'].includes(r.status) && 
          r.supplyChainReview?.assignedBuyer?.equals(userId)
        ).length
      })
    };

    console.log('Purchase Requisition Stats:', stats);

    res.status(200).json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Error fetching purchase requisition dashboard stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch purchase requisition dashboard stats',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


/**
 * Process disbursement for purchase requisition
 * POST /api/purchase-requisitions/:requisitionId/disburse
 */
const processDisbursement = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { amount, notes } = req.body;

    console.log('=== PROCESS PURCHASE REQUISITION DISBURSEMENT ===');
    console.log('Requisition ID:', requisitionId);
    console.log('Amount:', amount);

    const disbursementAmount = parseFloat(amount);
    if (isNaN(disbursementAmount) || disbursementAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid disbursement amount'
      });
    }

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department')
      .populate('financeVerification.verifiedBy', 'fullName email');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    // Verify status
    if (!['approved', 'partially_disbursed'].includes(requisition.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot disburse. Current status: ${requisition.status}`
      });
    }

    // Calculate remaining balance
    const totalBudget = requisition.budgetXAF || 0;
    const totalDisbursed = requisition.totalDisbursed || 0;
    const remainingBalance = requisition.remainingBalance || (totalBudget - totalDisbursed);

    // Verify amount doesn't exceed remaining balance
    if (disbursementAmount > remainingBalance) {
      return res.status(400).json({
        success: false,
        message: `Amount exceeds remaining balance. Available: XAF ${remainingBalance.toLocaleString()}`
      });
    }

    // Deduct from budget code if exists
    if (requisition.financeVerification?.budgetCode) {
      const BudgetCode = require('../models/BudgetCode');
      const budgetCode = await BudgetCode.findOne({ 
        code: requisition.financeVerification.budgetCode 
      });
      
      if (budgetCode) {
        // Add to allocations
        if (!budgetCode.allocations) {
          budgetCode.allocations = [];
        }
        
        budgetCode.allocations.push({
          requisitionId: requisition._id,
          amount: disbursementAmount,
          allocatedBy: req.user.userId,
          allocatedDate: new Date(),
          status: 'disbursed'
        });
        
        budgetCode.used = (budgetCode.used || 0) + disbursementAmount;
        await budgetCode.save();
        
        console.log(`✅ Budget deducted: XAF ${disbursementAmount.toLocaleString()} from ${budgetCode.code}`);
      }
    }

    // Add disbursement record
    const disbursementNumber = (requisition.disbursements?.length || 0) + 1;
    
    if (!requisition.disbursements) {
      requisition.disbursements = [];
    }

    requisition.disbursements.push({
      amount: disbursementAmount,
      date: new Date(),
      disbursedBy: req.user.userId,
      notes: notes || '',
      disbursementNumber
    });

    // Update totals
    requisition.totalDisbursed = (requisition.totalDisbursed || 0) + disbursementAmount;
    requisition.remainingBalance = totalBudget - requisition.totalDisbursed;

    // Update status
    if (requisition.remainingBalance === 0) {
      requisition.status = 'fully_disbursed';
    } else {
      requisition.status = 'partially_disbursed';
    }

    await requisition.save();

    // Send notification to employee
    const user = await User.findById(req.user.userId);
    const isFullyDisbursed = requisition.status === 'fully_disbursed';

    await sendEmail({
      to: requisition.employee.email,
      subject: isFullyDisbursed ? 
        `✅ Purchase Requisition Fully Disbursed` : 
        `💰 Partial Disbursement #${disbursementNumber} Processed`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: ${isFullyDisbursed ? '#d4edda' : '#d1ecf1'}; padding: 20px; border-radius: 8px;">
            <h3>${isFullyDisbursed ? 'Purchase Requisition Fully Disbursed' : 'Partial Disbursement Processed'}</h3>
            <p>Dear ${requisition.employee.fullName},</p>
            
            <p>A disbursement has been processed for your purchase requisition.</p>

            <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0;">
              <ul style="list-style: none; padding: 0;">
                <li><strong>Requisition:</strong> ${requisition.requisitionNumber || requisition.title}</li>
                <li><strong>Disbursement #:</strong> ${disbursementNumber}</li>
                <li><strong>Amount Disbursed:</strong> XAF ${disbursementAmount.toLocaleString()}</li>
                <li><strong>Total Disbursed:</strong> XAF ${requisition.totalDisbursed.toLocaleString()}</li>
                <li><strong>Remaining Balance:</strong> XAF ${requisition.remainingBalance.toLocaleString()}</li>
                <li><strong>Progress:</strong> ${Math.round((requisition.totalDisbursed / totalBudget) * 100)}%</li>
                <li><strong>Disbursed By:</strong> ${user.fullName} (Finance)</li>
              </ul>
            </div>

            ${notes ? `
            <div style="background-color: #f8f9fa; padding: 10px; border-radius: 5px; margin: 10px 0;">
              <p><strong>Notes:</strong></p>
              <p style="font-style: italic;">${notes}</p>
            </div>
            ` : ''}

            <p>Thank you!</p>
          </div>
        </div>
      `
    }).catch(err => console.error('Failed to send disbursement notification:', err));

    console.log('✅ Disbursement processed successfully');

    res.json({
      success: true,
      message: isFullyDisbursed ? 
        'Requisition fully disbursed' : 
        `Partial disbursement #${disbursementNumber} processed successfully`,
      data: requisition,
      disbursement: {
        number: disbursementNumber,
        amount: disbursementAmount,
        totalDisbursed: requisition.totalDisbursed,
        remainingBalance: requisition.remainingBalance,
        progress: Math.round((requisition.totalDisbursed / totalBudget) * 100),
        isFullyDisbursed
      }
    });

  } catch (error) {
    console.error('Process disbursement error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process disbursement',
      error: error.message
    });
  }
};

/**
 * Get disbursement history for a requisition
 * GET /api/purchase-requisitions/:requisitionId/disbursements
 */
const getDisbursementHistory = async (req, res) => {
  try {
    const { requisitionId } = req.params;

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department')
      .populate('disbursements.disbursedBy', 'fullName email');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    res.json({
      success: true,
      data: {
        requisitionId: requisition._id,
        requisitionNumber: requisition.requisitionNumber,
        employee: requisition.employee,
        budgetXAF: requisition.budgetXAF,
        totalDisbursed: requisition.totalDisbursed || 0,
        remainingBalance: requisition.remainingBalance || 0,
        progress: Math.round(((requisition.totalDisbursed || 0) / requisition.budgetXAF) * 100),
        status: requisition.status,
        disbursements: requisition.disbursements || []
      }
    });

  } catch (error) {
    console.error('Get disbursement history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch disbursement history',
      error: error.message
    });
  }
};

/**
 * Get pending disbursements (approved or partially disbursed)
 * GET /api/purchase-requisitions/finance/pending-disbursements
 */
const getPendingDisbursements = async (req, res) => {
  try {
    const requisitions = await PurchaseRequisition.find({
      status: { $in: ['approved', 'partially_disbursed'] },
      $expr: { 
        $gt: [
          { $subtract: ['$budgetXAF', { $ifNull: ['$totalDisbursed', 0] }] },
          0
        ]
      }
    })
    .populate('employee', 'fullName email department')
    .populate('financeVerification.verifiedBy', 'fullName email')
    .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: requisitions,
      count: requisitions.length
    });

  } catch (error) {
    console.error('Get pending disbursements error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending disbursements',
      error: error.message
    });
  }
};



/**
 * Submit justification for a fully disbursed purchase requisition
 * POST /api/purchase-requisitions/:requisitionId/justify
 */
const submitPurchaseRequisitionJustification = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { actualExpenses, totalSpent, changeReturned, justificationSummary } = req.body;

    console.log('=== SUBMIT PURCHASE REQUISITION JUSTIFICATION ===');
    console.log('Requisition ID:', requisitionId);
    console.log('User:', req.user.userId);
    console.log('Payload:', { actualExpenses, totalSpent, changeReturned });

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Purchase requisition not found'
      });
    }

    const assignedBuyerId = requisition.supplyChainReview?.assignedBuyer?.toString();

    console.log('Requisition found:', {
      id: requisition._id,
      status: requisition.status,
      employee: requisition.employee?._id,
      assignedBuyer: assignedBuyerId,
      currentUser: req.user.userId
    });

    // Verify user is the assigned buyer
    if (!assignedBuyerId || assignedBuyerId !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only the assigned buyer can justify this requisition.'
      });
    }

    // ✅ FIXED: Allow justification for approved, partially_disbursed, and fully_disbursed statuses
    const allowedStatuses = ['approved', 'partially_disbursed', 'fully_disbursed'];
    if (!allowedStatuses.includes(requisition.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot submit justification for requisitions with status: ${requisition.status}. Requisition must be approved or disbursed.`,
        currentStatus: requisition.status
      });
    }

    // Parse actualExpenses if it's a string
    let parsedExpenses;
    try {
      parsedExpenses = typeof actualExpenses === 'string' 
        ? JSON.parse(actualExpenses) 
        : actualExpenses;
    } catch (error) {
      console.error('Error parsing actualExpenses:', error);
      return res.status(400).json({
        success: false,
        message: 'Invalid expense data format'
      });
    }

    console.log('Parsed expenses:', parsedExpenses);

    // Validate actual expenses
    if (!parsedExpenses || !Array.isArray(parsedExpenses) || parsedExpenses.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one expense item is required'
      });
    }

    // Validate each expense has required fields
    const invalidExpenses = parsedExpenses.filter(exp => 
      !exp.description || !exp.amount || !exp.category
    );

    if (invalidExpenses.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'All expenses must have description, amount, and category',
        invalidExpenses
      });
    }

    // Process file uploads (receipts)
    let receipts = [];
    if (req.files && req.files.length > 0) {
      console.log(`📎 Processing ${req.files.length} receipt file(s)...`);
      
      for (const file of req.files) {
        try {
          const fileMetadata = await saveFile(
            file,
            STORAGE_CATEGORIES.PURCHASE_REQUISITIONS,
            'receipts',
            requisitionId
          );

          receipts.push({
            name: file.originalname,
            publicId: fileMetadata.publicId,
            url: fileMetadata.url,
            localPath: fileMetadata.localPath,
            size: file.size,
            mimetype: file.mimetype,
            uploadedAt: new Date(),
            uploadedBy: req.user.userId
          });

          console.log(`✅ Receipt saved: ${fileMetadata.publicId}`);
        } catch (fileError) {
          console.error(`❌ Error processing ${file.originalname}:`, fileError);
          continue;
        }
      }

      console.log(`✅ Successfully processed ${receipts.length} receipt(s)`);
    } else {
      console.log('⚠️ No receipt files uploaded');
    }

    // Clean and format expenses
    const formattedExpenses = parsedExpenses.map(expense => ({
      description: expense.description.trim(),
      amount: parseFloat(expense.amount),
      category: expense.category.trim(),
      date: expense.date ? new Date(expense.date) : new Date()
    }));

    console.log('Formatted expenses:', formattedExpenses);

    // Update requisition with justification
    requisition.justification = {
      actualExpenses: formattedExpenses,
      totalSpent: parseFloat(totalSpent),
      changeReturned: parseFloat(changeReturned || 0),
      justificationSummary: justificationSummary,
      receipts: receipts,
      submittedDate: new Date(),
      submittedBy: req.user.userId,
      status: 'pending_supervisor'
    };

    // Update main status
    requisition.status = 'justification_pending_supervisor';

    await requisition.save();

    console.log('✅ Justification submitted successfully');
    console.log('   Total Spent:', totalSpent);
    console.log('   Change Returned:', changeReturned);
    console.log('   Receipts:', receipts.length);
    console.log('   Expenses:', formattedExpenses.length);

    // Send notification to supervisor (first in approval chain)
    const supervisorStep = requisition.approvalChain.find(step => step.level === 1);
    if (supervisorStep) {
      try {
        await sendEmail({
          to: supervisorStep.approver.email,
          subject: `Justification Submitted - Purchase Requisition ${requisition.requisitionNumber}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px;">
                <h2 style="color: #1890ff;">📋 Purchase Requisition Justification Submitted</h2>
                <p>Dear ${supervisorStep.approver.name},</p>
                <p>${requisition.employee.fullName} has submitted justification for a completed purchase requisition.</p>
                
                <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <h4>Requisition Details</h4>
                  <ul>
                    <li><strong>Requisition Number:</strong> ${requisition.requisitionNumber}</li>
                    <li><strong>Title:</strong> ${requisition.title}</li>
                    <li><strong>Approved Amount:</strong> XAF ${requisition.budgetXAF.toLocaleString()}</li>
                    <li><strong>Total Spent:</strong> XAF ${parseFloat(totalSpent).toLocaleString()}</li>
                    <li><strong>Change Returned:</strong> XAF ${parseFloat(changeReturned || 0).toLocaleString()}</li>
                    <li><strong>Expenses:</strong> ${formattedExpenses.length} item(s)</li>
                    <li><strong>Receipts:</strong> ${receipts.length} file(s)</li>
                  </ul>
                </div>
                
                <div style="text-align: center; margin: 20px 0;">
                  <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/supervisor/purchase-requisitions/${requisition._id}/justify"
                     style="background-color: #1890ff; color: white; padding: 12px 24px;
                            text-decoration: none; border-radius: 6px; font-weight: bold;">
                    Review Justification
                  </a>
                </div>
              </div>
            </div>
          `
        });
        
        console.log('✅ Supervisor notification sent to:', supervisorStep.approver.email);
      } catch (emailError) {
        console.error('❌ Failed to send supervisor notification:', emailError);
        // Don't fail the submission if email fails
      }
    } else {
      console.log('⚠️ No supervisor found in approval chain');
    }

    res.json({
      success: true,
      message: 'Justification submitted successfully',
      data: {
        requisition,
        justification: {
          totalSpent: parseFloat(totalSpent),
          changeReturned: parseFloat(changeReturned || 0),
          expenseCount: formattedExpenses.length,
          receiptCount: receipts.length,
          status: 'pending_supervisor'
        }
      }
    });

  } catch (error) {
    console.error('❌ Submit justification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit justification',
      error: error.message
    });
  }
};

/**
 * Get justification details for a purchase requisition
 * GET /api/purchase-requisitions/:requisitionId/justification
 */
const getPurchaseRequisitionJustification = async (req, res) => {
  try {
    const { requisitionId } = req.params;

    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department')
      .populate('justification.submittedBy', 'fullName email')
      .populate('justification.supervisorReview.reviewedBy', 'fullName email')
      .populate('justification.financeReview.reviewedBy', 'fullName email');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Purchase requisition not found'
      });
    }

    // Check permissions
    const user = await User.findById(req.user.userId);
    const canView = 
      requisition.employee._id.equals(req.user.userId) ||
      user.role === 'admin' ||
      user.role === 'finance' ||
      requisition.approvalChain.some(step => step.approver.email === user.email);

    if (!canView) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: {
        requisition,
        justification: requisition.justification
      }
    });

  } catch (error) {
    console.error('Get justification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch justification',
      error: error.message
    });
  }
};

/**
 * Download justification receipt
 * GET /api/purchase-requisitions/:requisitionId/receipts/:receiptId/download
 */
const downloadJustificationReceipt = async (req, res) => {
  try {
    const { requisitionId, receiptId } = req.params;

    const requisition = await PurchaseRequisition.findById(requisitionId);

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Purchase requisition not found'
      });
    }

    const receipt = requisition.justification?.receipts?.find(
      r => r._id.toString() === receiptId
    );

    if (!receipt) {
      return res.status(404).json({
        success: false,
        message: 'Receipt not found'
      });
    }

    // Stream file
    const filePath = path.join(__dirname, '../', receipt.localPath);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Receipt file not found on server'
      });
    }

    res.download(filePath, receipt.name);

  } catch (error) {
    console.error('Download receipt error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download receipt',
      error: error.message
    });
  }
};

  const acknowledgeDisbursement = async (req, res) => {
    try {
        const { requisitionId, disbursementId } = req.params;
        const { acknowledgmentNotes, acknowledgmentMethod } = req.body;

        console.log('=== ACKNOWLEDGE DISBURSEMENT ===');
        console.log('Requisition ID:', requisitionId);
        console.log('Disbursement ID:', disbursementId);
        console.log('User:', req.user.userId);

        const requisition = await PurchaseRequisition.findById(requisitionId)
            .populate('employee', 'fullName email department')
            .populate('disbursements.disbursedBy', 'fullName email')
            .populate('disbursements.acknowledgedBy', 'fullName email'); 
            

        if (!requisition) {
            return res.status(404).json({
                success: false,
                message: 'Requisition not found'
            });
        }

        // Verify user is the employee (requester)
        if (requisition.employee._id.toString() !== req.user.userId) {
            return res.status(403).json({
                success: false,
                message: 'Only the requester can acknowledge receipt'
            });
        }

        // Find the disbursement
        const disbursement = requisition.disbursements.id(disbursementId);
        
        if (!disbursement) {
            return res.status(404).json({
                success: false,
                message: 'Disbursement not found'
            });
        }

        // Check if already acknowledged
        if (disbursement.acknowledged) {
            return res.status(400).json({
                success: false,
                message: 'This disbursement has already been acknowledged'
            });
        }

        // ✅ Update acknowledgment
        disbursement.acknowledged = true;
        disbursement.acknowledgedBy = req.user.userId;
        disbursement.acknowledgmentDate = new Date();
        disbursement.acknowledgmentNotes = acknowledgmentNotes || '';
        disbursement.acknowledgmentMethod = acknowledgmentMethod || 'cash';

        // ✅ SAVE CHANGES
        await requisition.save();

         // Send notification to finance
        const financeUser = await User.findById(disbursement.disbursedBy);
        if (financeUser) {
            await sendEmail({
                to: financeUser.email,
                subject: `Disbursement Acknowledged - ${requisition.requisitionNumber}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <div style="background-color: #d4edda; padding: 20px; border-radius: 8px;">
                            <h3 style="color: #155724;">✅ Disbursement Receipt Acknowledged</h3>
                            <p>Dear ${financeUser.fullName},</p>
                            <p>${requisition.employee.fullName} has confirmed receipt of disbursement.</p>
                            
                            <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0;">
                                <ul style="list-style: none; padding: 0;">
                                    <li><strong>Requisition:</strong> ${requisition.requisitionNumber}</li>
                                    <li><strong>Disbursement #:</strong> ${disbursement.disbursementNumber}</li>
                                    <li><strong>Amount:</strong> XAF ${disbursement.amount.toLocaleString()}</li>
                                    <li><strong>Receipt Method:</strong> ${acknowledgmentMethod?.replace('_', ' ').toUpperCase()}</li>
                                    <li><strong>Acknowledged:</strong> ${new Date().toLocaleString('en-GB')}</li>
                                </ul>
                            </div>

                            ${acknowledgmentNotes ? `
                            <div style="background-color: #f8f9fa; padding: 10px; border-radius: 5px; margin: 10px 0;">
                                <p><strong>Acknowledgment Notes:</strong></p>
                                <p style="font-style: italic;">${acknowledgmentNotes}</p>
                            </div>
                            ` : ''}

                            <p>This confirms the money was received successfully.</p>
                        </div>
                    </div>
                `
            }).catch(err => console.error('Failed to send acknowledgment notification:', err));
        }

        // ✅ RE-POPULATE after save to get fresh data
        await requisition.populate('disbursements.acknowledgedBy', 'fullName email');

        res.json({
            success: true,
            message: 'Disbursement receipt acknowledged successfully',
            data: {
                disbursement: disbursement.toObject(), // ✅ Full disbursement with populated data
                requisition: requisition.toObject()     // ✅ Full requisition
            }
        });

        console.log('✅ Disbursement acknowledged successfully');
        console.log('Updated disbursement:', {
            id: disbursement._id,
            acknowledged: disbursement.acknowledged,
            acknowledgedBy: disbursement.acknowledgedBy,
            acknowledgmentDate: disbursement.acknowledgmentDate
        });

        // Send notification to finance (existing code...)
        // ...

        // ✅ CRITICAL: Return FULL updated requisition with ALL disbursements
        res.json({
            success: true,
            message: 'Disbursement receipt acknowledged successfully',
            data: {
                disbursement: {
                    _id: disbursement._id,
                    disbursementNumber: disbursement.disbursementNumber,
                    amount: disbursement.amount,
                    acknowledged: disbursement.acknowledged,
                    acknowledgedBy: disbursement.acknowledgedBy,
                    acknowledgmentDate: disbursement.acknowledgmentDate,
                    acknowledgmentMethod: disbursement.acknowledgmentMethod,
                    acknowledgmentNotes: disbursement.acknowledgmentNotes
                },
                requisition: requisition.toObject() // ✅ Full requisition with ALL fields
            }
        });

    } catch (error) {
        console.error('Acknowledge disbursement error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to acknowledge disbursement',
            error: error.message
        });
    }
};

// Export all functions
module.exports = {
  // Core CRUD operations
  createRequisition,
  updateRequisition,
  deleteRequisition,

  // Employee functions
  getEmployeeRequisitions,
  getEmployeeRequisition,

  // Supervisor functions
  getSupervisorRequisitions,
  getSupervisorRequisition,
  processSupervisorDecision,

  // Supply chain functions
  getSupplyChainRequisitions,
  processSupplyChainDecision,
  updateProcurementStatus,

  // Finance functions
  getFinanceRequisitions,
  processFinanceDecision,

  // Admin functions
  getAllRequisitions,
  getAdminRequisitionDetails,

  // Utility functions
  getApprovalChainPreview,
  getRequisitionsByRole,

  // Analytics and reporting
  getDashboardStats,
  getCategoryAnalytics,
  getVendorPerformance,
  getRequisitionStats,
  getProcurementPlanningData,

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

  // Finance Dashboard
  getFinanceDashboardData,
  processSupplyChainBusinessDecisions,

  getPurchaseRequisitionDashboardStats,

  getPendingHeadApprovals,
  getHeadApprovalStats,
  sendPettyCashFormNotificationToBuyer,
  sendPettyCashFormNotificationToEmployee,
  getRequisitionDetails,

  // Draft management
  saveDraft,

  generatePettyCashFormPDF,
  processDisbursement,
  getDisbursementHistory,
  getPendingDisbursements,
  submitPurchaseRequisitionJustification,
  getPurchaseRequisitionJustification,
  downloadJustificationReceipt,
  acknowledgeDisbursement
};
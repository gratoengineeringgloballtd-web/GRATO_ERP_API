const SupplierInvoice = require('../models/SupplierInvoice');
const User = require('../models/User');
const { sendEmail, sendSupplierInvoiceEmail } = require('../services/emailService');
const { getSupplyChainCoordinator } = require('../config/supplierApprovalChain');
const { 
  saveFile, 
  deleteFile, 
  STORAGE_CATEGORIES
} = require('../utils/cloudinaryStorage');
// const { cloudinary } = require('../utils/cloudinaryStorage');
const fs = require('fs').promises;
const accountingService = require('../services/accountingService');
const { cloudinary } = require('../utils/cloudinaryStorage');  


const safePostSupplierInvoiceEntry = async (invoiceId, userId, context = '') => {
  try {
    await accountingService.ensureDefaultChart();
    await accountingService.postSupplierInvoice(invoiceId, userId);
    console.log(`✅ Accounting posted for supplier invoice${context ? ` (${context})` : ''}`);
  } catch (error) {
    console.error(`⚠️ Accounting auto-post skipped for supplier invoice${context ? ` (${context})` : ''}:`, error.message);
  }
};

/**
 * Submit supplier invoice - LOCAL STORAGE VERSION
 */
exports.submitSupplierInvoice = async (req, res) => {
  try {
    console.log('=== SUPPLIER INVOICE SUBMISSION (LOCAL STORAGE) ===');
    console.log('Supplier ID:', req.supplier.userId);

    const {
      invoiceNumber,
      poNumber,
      invoiceAmount,
      currency = 'XAF',
      invoiceDate,
      dueDate,
      description,
      serviceCategory,
      lineItems
    } = req.body;

    if (!invoiceNumber || !poNumber) {
      return res.status(400).json({
        success: false,
        message: 'Invoice number and PO number are required'
      });
    }

    const poRegex = /^PO-\d{4}-\d{6}$/;
    if (!poRegex.test(poNumber)) {
      return res.status(400).json({
        success: false,
        message: 'PO number format should be: PO-YYYY-###### (e.g., PO-2026-000075)'
      });
    }

    const existingInvoice = await SupplierInvoice.findOne({
      invoiceNumber: invoiceNumber.trim(),
      supplier: req.supplier.userId
    });

    if (existingInvoice) {
      return res.status(400).json({
        success: false,
        message: 'An invoice with this invoice number already exists'
      });
    }

    const supplier = await User.findById(req.supplier.userId);
    if (!supplier || supplier.role !== 'supplier') {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    console.log('Supplier found:', supplier.supplierDetails.companyName);

    const uploadedFiles = {};
    const uploadPromises = [];

    const saveFileLocally = async (file, subfolder, fieldName) => {
      try {
        console.log(`Saving ${fieldName} to local storage...`);
        
        const customFilename = `${supplier.supplierDetails.companyName}-${invoiceNumber}-${fieldName}-${Date.now()}${require('path').extname(file.originalname)}`;
        
        const result = await saveFile(
          file,
          STORAGE_CATEGORIES.SUPPLIER_INVOICES,
          subfolder,
          customFilename
        );

        if (file.path) {
          await fs.unlink(file.path).catch(err => 
            console.warn('Failed to delete temp file:', err.message)
          );
        }

        return result;
      } catch (error) {
        if (file.path) await fs.unlink(file.path).catch(() => {});
        throw new Error(`Failed to save ${fieldName}: ${error.message}`);
      }
    };

    if (req.files && req.files.invoiceFile && req.files.invoiceFile.length > 0) {
      const invoiceFile = req.files.invoiceFile[0];
      uploadPromises.push(
        saveFileLocally(invoiceFile, 'invoices', 'invoiceFile').then(result => {
          uploadedFiles.invoiceFile = result;
        })
      );
    }

    if (req.files && req.files.poFile && req.files.poFile.length > 0) {
      const poFile = req.files.poFile[0];
      uploadPromises.push(
        saveFileLocally(poFile, 'po-files', 'poFile').then(result => {
          uploadedFiles.poFile = result;
        })
      );
    }

    if (uploadPromises.length > 0) {
      await Promise.all(uploadPromises);
      console.log('All files saved to local storage successfully');
    }

    const invoiceData = {
      supplier: req.supplier.userId,
      supplierDetails: {
        companyName: supplier.supplierDetails.companyName,
        contactName: supplier.supplierDetails.contactName,
        email: supplier.email,
        supplierType: supplier.supplierDetails.supplierType,
        businessRegistrationNumber: supplier.supplierDetails.businessRegistrationNumber
      },
      invoiceNumber: invoiceNumber.trim(),
      poNumber: poNumber.toUpperCase(),
      invoiceAmount: invoiceAmount ? parseFloat(invoiceAmount) : 0,
      currency,
      invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      description: description ? description.trim() : `Invoice ${invoiceNumber.trim()} for PO ${poNumber.toUpperCase()}`,
      serviceCategory: serviceCategory || 'General',
      lineItems: lineItems ? (typeof lineItems === 'string' ? JSON.parse(lineItems) : lineItems) : [],
      approvalStatus: 'pending_supply_chain_assignment',
      ...uploadedFiles
    };

    console.log('Creating supplier invoice with data:', JSON.stringify(invoiceData, null, 2));
    const supplierInvoice = await SupplierInvoice.create(invoiceData);
    console.log('Supplier invoice created with ID:', supplierInvoice._id);

    // Notify Supply Chain Coordinator
    const supplyChainCoordinator = getSupplyChainCoordinator();
    await sendSupplierInvoiceEmail.newInvoiceToSupplyChain(
      supplyChainCoordinator.email,
      supplyChainCoordinator.name,
      supplier.supplierDetails.companyName,
      supplierInvoice.invoiceNumber,
      supplierInvoice.poNumber,
      supplierInvoice.invoiceAmount,
      currency,
      supplierInvoice.serviceCategory,
      supplierInvoice._id
    ).catch(err => console.error('Failed to notify Supply Chain:', err));

    // Confirm submission to supplier
    await sendSupplierInvoiceEmail.submissionConfirmationToSupplier(
      supplier.email,
      supplier.supplierDetails.contactName,
      supplier.supplierDetails.companyName,
      supplierInvoice.invoiceNumber,
      supplierInvoice.poNumber,
      currency,
      supplierInvoice.invoiceAmount
    ).catch(err => console.error('Failed to send supplier confirmation:', err));

    console.log('=== SUPPLIER INVOICE SUBMITTED SUCCESSFULLY (LOCAL STORAGE) ===');
    res.status(201).json({
      success: true,
      message: 'Supplier invoice submitted successfully and is pending Supply Chain review',
      data: supplierInvoice
    });

  } catch (error) {
    console.error('=== SUPPLIER INVOICE SUBMISSION FAILED ===', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to submit supplier invoice'
    });
  }
};


/**
 * NEW: Get invoices pending Supply Chain assignment
 */
exports.getSupplierInvoicesPendingSupplyChainAssignment = async (req, res) => {
  try {
    const { page = 1, limit = 10, serviceCategory, supplierType } = req.query;
    
    const filter = { approvalStatus: 'pending_supply_chain_assignment' };
    if (serviceCategory) filter.serviceCategory = serviceCategory;
    
    const skip = (page - 1) * limit;
    
    let query = SupplierInvoice.find(filter)
      .populate('supplier', 'supplierDetails.companyName supplierDetails.contactName email supplierDetails.supplierType')
      .sort({ uploadedDate: 1 }) // Oldest first
      .skip(skip)
      .limit(parseInt(limit));
    
    // Filter by supplier type if provided
    if (supplierType) {
      query = query.where('supplierDetails.supplierType').equals(supplierType);
    }
    
    const invoices = await query;
    const total = await SupplierInvoice.countDocuments(filter);
    
    res.json({
      success: true,
      data: invoices,
      pagination: {
        current: parseInt(page),
        pageSize: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('Error fetching invoices for supply chain:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoices'
    });
  }
};

/**
 * Assign supplier invoice by Supply Chain - LOCAL STORAGE VERSION
 */
exports.assignSupplierInvoiceBySupplyChain = async (req, res) => {
  try {
    console.log('=== SUPPLY CHAIN ASSIGNING SUPPLIER INVOICE WITH SIGNED DOCUMENT (LOCAL) ===');
    const { invoiceId } = req.params;
    let { department, comments } = req.body;
    
    if (!department) {
      return res.status(400).json({
        success: false,
        message: 'Department is required'
      });
    }
    
    if (department === 'HR & Admin') {
      department = 'HR/Admin';
    }
    
    if (!req.files || !req.files.signedDocument || req.files.signedDocument.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Signed document is required. Please download, sign, and upload the invoice.'
      });
    }
    
    const invoice = await SupplierInvoice.findById(invoiceId)
      .populate('supplier', 'supplierDetails email');
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Supplier invoice not found'
      });
    }
    
    if (invoice.approvalStatus !== 'pending_supply_chain_assignment') {
      return res.status(400).json({
        success: false,
        message: 'Invoice has already been assigned or processed'
      });
    }
    
    console.log(`Supply Chain assigning invoice ${invoice.invoiceNumber} to ${department}`);
    
    const signedDocFile = req.files.signedDocument[0];
    let signedDocData = null;
    
    try {
      const customFilename = `${invoice.supplierDetails.companyName}-${invoice.invoiceNumber}-SC-signed-${Date.now()}${require('path').extname(signedDocFile.originalname)}`;
      
      const result = await saveFile(
        signedDocFile,
        STORAGE_CATEGORIES.SIGNED_DOCUMENTS,
        'supply-chain',
        customFilename
      );

      if (signedDocFile.path) {
        await fs.unlink(signedDocFile.path).catch(err => 
          console.warn('Failed to delete temp file:', err.message)
        );
      }

      signedDocData = result;
      console.log('✓ Signed document saved to local storage');
    } catch (error) {
      if (signedDocFile.path) await fs.unlink(signedDocFile.path).catch(() => {});
      throw new Error(`Failed to save signed document: ${error.message}`);
    }
    
    invoice.assignBySupplyChain(department, req.user.userId, comments);
    invoice.supplyChainReview.signedDocument = signedDocData;
    
    await invoice.save();

    console.log(`Invoice assigned. First approver: ${invoice.getCurrentApprover()?.approver.name}`);
    
    // Notify first approver (Department Head - Level 1)
    const firstApprover = invoice.getCurrentApprover();
    if (firstApprover) {
      await sendSupplierInvoiceEmail.notifyNextApprover(
        firstApprover.approver.email,
        firstApprover.approver.name,
        firstApprover.approver.role,
        firstApprover.level,
        invoice.approvalChain.length,
        'Supply Chain Coordinator',
        invoice.supplierDetails.companyName,
        invoice.invoiceNumber,
        invoice.poNumber,
        invoice.currency,
        invoice.invoiceAmount,
        invoice.assignedDepartment,
        invoice._id
      ).catch(err => console.error('Failed to notify first approver:', err));
    }
    
    console.log('=== SUPPLY CHAIN ASSIGNMENT COMPLETED (LOCAL STORAGE) ===');
    
    res.json({
      success: true,
      message: 'Invoice assigned successfully with signed document',
      data: {
        ...invoice.toObject(),
        currentApprover: invoice.getCurrentApprover(),
        approvalProgress: invoice.approvalProgress
      }
    });
    
  } catch (error) {
    console.error('=== SUPPLY CHAIN ASSIGNMENT FAILED ===', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to assign invoice'
    });
  }
};

/**
 * NEW: Supply Chain rejects invoice
 */
exports.rejectSupplierInvoiceBySupplyChain = async (req, res) => {
  try {
    console.log('=== SUPPLY CHAIN REJECTING SUPPLIER INVOICE ===');
    const { invoiceId } = req.params;
    const { rejectionReason } = req.body;
    
    if (!rejectionReason || !rejectionReason.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }
    
    const invoice = await SupplierInvoice.findById(invoiceId)
      .populate('supplier', 'supplierDetails email');
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Supplier invoice not found'
      });
    }
    
    if (invoice.approvalStatus !== 'pending_supply_chain_assignment') {
      return res.status(400).json({
        success: false,
        message: 'Invoice can only be rejected at supply chain assignment stage'
      });
    }
    
    console.log(`Supply Chain rejecting invoice ${invoice.invoiceNumber}`);
    
    invoice.rejectBySupplyChain(req.user.userId, rejectionReason);
    await invoice.save();

    // Notify supplier of rejection
    await sendSupplierInvoiceEmail.invoiceRejectedToSupplier(
      invoice.supplier.email || invoice.supplierDetails.email,
      invoice.supplierDetails.contactName,
      invoice.invoiceNumber,
      invoice.poNumber,
      invoice.currency,
      invoice.invoiceAmount,
      'Supply Chain Coordinator',
      'Supply Chain Coordinator',
      rejectionReason,
      getSupplyChainCoordinator().email
    ).catch(err => console.error('Failed to notify supplier of SC rejection:', err));
    
    console.log('=== SUPPLY CHAIN REJECTION COMPLETED ===');
    
    res.json({
      success: true,
      message: 'Invoice rejected successfully',
      data: invoice
    });
    
  } catch (error) {
    console.error('=== SUPPLY CHAIN REJECTION FAILED ===', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to reject invoice'
    });
  }
};

/**
 * NEW: Bulk assign invoices by Supply Chain
 */
exports.bulkAssignSupplierInvoicesBySupplyChain = async (req, res) => {
  try {
    console.log('=== SUPPLY CHAIN BULK ASSIGNING INVOICES ===');
    const { invoiceIds, department, comments } = req.body;
    
    if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invoice IDs array is required'
      });
    }
    
    if (!department) {
      return res.status(400).json({
        success: false,
        message: 'Department is required'
      });
    }
    
    console.log(`Bulk assigning ${invoiceIds.length} invoices to ${department}`);
    
    const results = {
      successful: [],
      failed: []
    };
    
    for (const invoiceId of invoiceIds) {
      try {
        const invoice = await SupplierInvoice.findById(invoiceId)
          .populate('supplier', 'supplierDetails email');
        
        if (!invoice) {
          results.failed.push({ 
            invoiceId, 
            error: 'Invoice not found' 
          });
          continue;
        }
        
        if (invoice.approvalStatus !== 'pending_supply_chain_assignment') {
          results.failed.push({ 
            invoiceId, 
            invoiceNumber: invoice.invoiceNumber,
            error: 'Invoice already assigned or processed' 
          });
          continue;
        }
        
        invoice.assignBySupplyChain(department, req.user.userId, comments);
        await invoice.save();
        
        results.successful.push({
          invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          supplierName: invoice.supplierDetails.companyName,
          assignedDepartment: invoice.assignedDepartment,
          firstApprover: invoice.getCurrentApprover()?.approver.name
        });
        
        console.log(`✓ Successfully assigned ${invoice.invoiceNumber}`);
        
      } catch (error) {
        console.error(`Failed to assign invoice ${invoiceId}:`, error);
        results.failed.push({ 
          invoiceId, 
          error: error.message || 'Assignment failed' 
        });
      }
    }
    
    const totalSuccessful = results.successful.length;
    const totalFailed = results.failed.length;
    
    console.log(`Bulk assignment completed: ${totalSuccessful} successful, ${totalFailed} failed`);
    
    res.json({
      success: totalSuccessful > 0,
      message: `Bulk assignment completed: ${totalSuccessful} successful, ${totalFailed} failed`,
      data: results,
      summary: {
        total: invoiceIds.length,
        successful: totalSuccessful,
        failed: totalFailed,
        successRate: Math.round((totalSuccessful / invoiceIds.length) * 100)
      }
    });
    
  } catch (error) {
    console.error('=== BULK ASSIGNMENT FAILED ===', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Bulk assignment failed'
    });
  }
};

/**
 * NEW: Get Supply Chain dashboard statistics
 */
exports.getSupplyChainDashboardStats = async (req, res) => {
  try {
    const stats = {
      pendingAssignment: await SupplierInvoice.countDocuments({ 
        approvalStatus: 'pending_supply_chain_assignment' 
      }),
      assignedToday: await SupplierInvoice.countDocuments({
        'supplyChainReview.action': 'assigned',
        'supplyChainReview.reviewDate': {
          $gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }),
      rejectedToday: await SupplierInvoice.countDocuments({
        'supplyChainReview.action': 'rejected',
        'supplyChainReview.reviewDate': {
          $gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }),
      inApprovalChain: await SupplierInvoice.countDocuments({
        approvalStatus: {
          $in: [
            'pending_department_head_approval',
            'pending_head_of_business_approval',
            'pending_finance_approval',
            'pending_ceo_approval'
          ]
        }
      })
    };
    
    res.json({
      success: true,
      data: stats
    });
    
  } catch (error) {
    console.error('Error fetching supply chain stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics'
    });
  }
};

/**
 * NEW: Download current invoice document for signing
 */
exports.downloadInvoiceForSigning = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    
    const invoice = await SupplierInvoice.findById(invoiceId);
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }
    
    // Determine which document to download based on current level
    let documentToDownload = null;
    
    if (invoice.currentApprovalLevel === 0 || !invoice.approvalChain) {
      // If at Supply Chain level (before assignment), use original
      documentToDownload = invoice.invoiceFile;
    } else {
      // Find the last signed document from previous level
      const previousLevel = invoice.currentApprovalLevel - 1;
      
      if (previousLevel === 0) {
        // Previous was Supply Chain
        documentToDownload = invoice.supplyChainReview?.signedDocument || invoice.invoiceFile;
      } else {
        // Previous was another approver
        const previousStep = invoice.approvalChain.find(step => step.level === previousLevel);
        documentToDownload = previousStep?.signedDocument || invoice.invoiceFile;
      }
    }
    
    if (!documentToDownload || !documentToDownload.url) {
      return res.status(404).json({
        success: false,
        message: 'Invoice document not found'
      });
    }
    
    // Mark as downloaded for current step
    if (invoice.currentApprovalLevel > 0) {
      const currentStep = invoice.getCurrentApprover();
      if (currentStep && currentStep.approver.email === req.user.email) {
        currentStep.documentDownloaded = true;
        currentStep.downloadedAt = new Date();
        await invoice.save();
      }
    }
    
    res.json({
      success: true,
      data: {
        url: documentToDownload.url,
        originalName: documentToDownload.originalName,
        format: documentToDownload.format,
        signedBy: invoice.currentApprovalLevel === 1 ? 'Supply Chain Coordinator' : 
                 invoice.approvalChain?.find(s => s.level === invoice.currentApprovalLevel - 1)?.approver.name
      }
    });
    
  } catch (error) {
    console.error('Error downloading invoice:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download invoice'
    });
  }
};

/**
 * Process supplier approval step - LOCAL STORAGE VERSION
 */
exports.processSupplierApprovalStep = async (req, res) => {
  try {
    console.log('=== PROCESSING SUPPLIER INVOICE APPROVAL STEP (LOCAL) ===');
    const { invoiceId } = req.params;
    const { decision, comments, budgetCode, allocationAmount, paymentMethod } = req.body;
    
    if (!decision || !['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: 'Valid decision (approved/rejected) is required'
      });
    }

    if (decision === 'approved' && (!req.files || !req.files.signedDocument || req.files.signedDocument.length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'Signed document is required for approval. Please download, sign, and upload the invoice.'
      });
    }
    
    const invoice = await SupplierInvoice.findById(invoiceId)
      .populate('supplier', 'supplierDetails email');
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Supplier invoice not found'
      });
    }

    // Budget code only required at Finance level
    const isFinanceLevel = invoice.approvalChain?.find(
      step => step.level === invoice.currentApprovalLevel && 
              step.approver.role === 'Finance Officer'
    );
    
    if (decision === 'approved' && isFinanceLevel && !budgetCode) {
      return res.status(400).json({
        success: false,
        message: 'Budget code is required for Finance approval'
      });
    }

    const validApprovalStatuses = [
      'pending_department_approval',
      'pending_department_head_approval', 
      'pending_head_of_business_approval', 
      'pending_finance_approval',
      'pending_ceo_approval'
    ];
    
    if (!validApprovalStatuses.includes(invoice.approvalStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invoice is not in a pending approval state. Current status: ${invoice.approvalStatus}`,
        currentStatus: invoice.approvalStatus
      });
    }
    
    const user = await User.findById(req.user.userId).select('email fullName');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    if (!invoice.canUserApprove(user.email)) {
      const currentApprover = invoice.getCurrentApprover();
      return res.status(403).json({
        success: false,
        message: `You are not authorized to approve this invoice at this time. Current approver: ${currentApprover?.approver.name} (Level ${currentApprover?.level})`,
        currentApprover: {
          name: currentApprover?.approver.name,
          email: currentApprover?.approver.email,
          level: currentApprover?.level
        },
        yourEmail: user.email
      });
    }
    
    console.log(`Processing ${decision} by ${user.email} at level ${invoice.currentApprovalLevel}`);
    
    let signedDocData = null;
    
    if (decision === 'approved') {
      const signedDocFile = req.files.signedDocument[0];
      
      try {
        const customFilename = `${invoice.supplierDetails.companyName}-${invoice.invoiceNumber}-L${invoice.currentApprovalLevel}-signed-${Date.now()}${require('path').extname(signedDocFile.originalname)}`;
        
        const result = await saveFile(
          signedDocFile,
          STORAGE_CATEGORIES.SIGNED_DOCUMENTS,
          `level-${invoice.currentApprovalLevel}`,
          customFilename
        );

        if (signedDocFile.path) {
          await fs.unlink(signedDocFile.path).catch(err => 
            console.warn('Failed to delete temp file:', err.message)
          );
        }

        signedDocData = result;
        console.log(`✓ Level ${invoice.currentApprovalLevel} signed document saved`);
      } catch (error) {
        if (signedDocFile.path) await fs.unlink(signedDocFile.path).catch(() => {});
        throw new Error(`Failed to save signed document: ${error.message}`);
      }
    }

    // Capture current level before processing (needed for emails after status changes)
    const processedLevel = invoice.currentApprovalLevel;
    const processedStep = invoice.processApprovalStep(user.email, decision, comments, req.user.userId);
    
    if (signedDocData) {
      processedStep.signedDocument = signedDocData;
    }

    if (decision === 'approved' && isFinanceLevel && budgetCode) {
      invoice.allocatedBudgetCode = budgetCode;
      invoice.allocationAmount = allocationAmount ? parseFloat(allocationAmount) : invoice.invoiceAmount;
      if (paymentMethod) {
        invoice.paymentMethod = paymentMethod;
      }
      console.log(`✓ Budget code assigned: ${budgetCode}`);
      console.log(`✓ Allocation amount: ${invoice.allocationAmount}`);
      console.log(`✓ Payment method: ${paymentMethod}`);
    }
    
    await invoice.save();

    if (decision === 'approved' && invoice.approvalStatus === 'approved') {
      await safePostSupplierInvoiceEntry(invoice._id, req.user.userId, 'final approval');
    }

    // Send appropriate email notifications
    const supplierEmail = invoice.supplier?.email || invoice.supplierDetails?.email;

    if (invoice.approvalStatus === 'rejected') {
      // Notify supplier of rejection
      await sendSupplierInvoiceEmail.invoiceRejectedToSupplier(
        supplierEmail,
        invoice.supplierDetails.contactName,
        invoice.invoiceNumber,
        invoice.poNumber,
        invoice.currency,
        invoice.invoiceAmount,
        user.fullName,
        processedStep.approver.role,
        comments || 'Invoice did not meet approval requirements',
        getSupplyChainCoordinator().email
      ).catch(err => console.error('Failed to notify supplier of rejection:', err));

    } else if (invoice.approvalStatus === 'approved') {
      // Fully approved — notify supplier
      await sendSupplierInvoiceEmail.invoiceFullyApproved(
        supplierEmail,
        invoice.supplierDetails.contactName,
        invoice.invoiceNumber,
        invoice.poNumber,
        invoice.currency,
        invoice.invoiceAmount,
        invoice.paymentMethod
      ).catch(err => console.error('Failed to notify supplier of full approval:', err));

    } else {
      // Move to next level — notify next approver only
      const nextApprover = invoice.getCurrentApprover();
      if (nextApprover) {
        await sendSupplierInvoiceEmail.notifyNextApprover(
          nextApprover.approver.email,
          nextApprover.approver.name,
          nextApprover.approver.role,
          nextApprover.level,
          invoice.approvalChain.length,
          user.fullName,
          invoice.supplierDetails.companyName,
          invoice.invoiceNumber,
          invoice.poNumber,
          invoice.currency,
          invoice.invoiceAmount,
          invoice.assignedDepartment,
          invoice._id
        ).catch(err => console.error(`Failed to notify level ${nextApprover.level} approver:`, err));
      }
    }
    
    console.log('=== SUPPLIER INVOICE APPROVAL STEP PROCESSED SUCCESSFULLY (LOCAL) ===');
    
    res.json({
      success: true,
      message: `Supplier invoice ${decision} successfully`,
      data: {
        ...invoice.toObject(),
        currentApprover: invoice.getCurrentApprover(),
        approvalProgress: invoice.approvalProgress
      },
      processedStep
    });
    
  } catch (error) {
    console.error('=== SUPPLIER INVOICE APPROVAL STEP PROCESSING FAILED ===', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to process supplier invoice approval step'
    });
  }
};

// Get supplier's invoices
exports.getSupplierInvoices = async (req, res) => {
  try {
    const { status, startDate, endDate, page = 1, limit = 10 } = req.query;
    
    const filter = { supplier: req.supplier.userId };
    if (status) filter.approvalStatus = status;
    if (startDate || endDate) {
      filter.uploadedDate = {};
      if (startDate) filter.uploadedDate.$gte = new Date(startDate);
      if (endDate) filter.uploadedDate.$lte = new Date(endDate);
    }
    
    const skip = (page - 1) * limit;
    
    const invoices = await SupplierInvoice.find(filter)
      .populate('supplier', 'supplierDetails.companyName supplierDetails.contactName email')
      .populate('assignedBy', 'fullName email')
      .populate('approvalChain.approver.userId', 'fullName email')
      .sort({ uploadedDate: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await SupplierInvoice.countDocuments(filter);
    
    res.json({
      success: true,
      data: invoices,
      pagination: {
        current: parseInt(page),
        pageSize: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('Error fetching supplier invoices:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoices'
    });
  }
};

// Get specific supplier invoice details
exports.getSupplierInvoiceDetails = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    
    const invoice = await SupplierInvoice.findById(invoiceId)
      .populate('supplier', 'supplierDetails email')
      .populate('assignedBy', 'fullName email')
      .populate('approvalChain.approver.userId', 'fullName email');
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Supplier invoice not found'
      });
    }
    
    // Check if current user has permission to view
    let canView = false;
    
    if (req.supplier && invoice.supplier._id.toString() === req.supplier.userId) {
      canView = true; // Supplier can view their own invoices
    } else if (req.user && ['admin', 'finance'].includes(req.user.role)) {
      canView = true; // Admin and finance can view all
    } else if (req.user && invoice.approvalChain.some(step => step.approver.email === req.user.email)) {
      canView = true; // Approvers can view invoices in their chain
    }
    
    if (!canView) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this invoice'
      });
    }
    
    res.json({
      success: true,
      data: {
        ...invoice.toJSON(),
        approvalHistory: invoice.getApprovalHistory(),
        currentApprover: invoice.getCurrentApprover(),
        approvalProgress: invoice.approvalProgress,
        daysUntilDue: invoice.daysUntilDue
      }
    });
    
  } catch (error) {
    console.error('Error fetching supplier invoice details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoice details'
    });
  }
};

// Get all supplier invoices for finance management
exports.getSupplierInvoicesForFinance = async (req, res) => {
  try {
    const { status, serviceCategory, startDate, endDate, page = 1, limit = 10 } = req.query;
    
    const filter = {};
    if (status) filter.approvalStatus = status;
    if (serviceCategory) filter.serviceCategory = serviceCategory;
    if (startDate || endDate) {
      filter.uploadedDate = {};
      if (startDate) filter.uploadedDate.$gte = new Date(startDate);
      if (endDate) filter.uploadedDate.$lte = new Date(endDate);
    }
    
    const skip = (page - 1) * limit;
    
    const invoices = await SupplierInvoice.find(filter)
      .populate('supplier', 'supplierDetails email')
      .populate('assignedBy', 'fullName email')
      .populate('approvalChain.approver.userId', 'fullName email')
      .sort({ uploadedDate: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await SupplierInvoice.countDocuments(filter);
    
    res.json({
      success: true,
      data: invoices,
      pagination: {
        current: parseInt(page),
        pageSize: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('Error fetching supplier invoices for finance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch supplier invoices'
    });
  }
};

// Assign supplier invoice to department and create approval chain
exports.assignSupplierInvoiceToDepartment = async (req, res) => {
  try {
    console.log('=== ASSIGNING SUPPLIER INVOICE TO DEPARTMENT ===');
    const { invoiceId } = req.params;
    const { department, comments, updateDetails } = req.body;
    
    if (!department) {
      return res.status(400).json({
        success: false,
        message: 'Department is required'
      });
    }
    
    const invoice = await SupplierInvoice.findById(invoiceId)
      .populate('supplier', 'supplierDetails email');
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Supplier invoice not found'
      });
    }
    
    if (invoice.approvalStatus !== 'pending_finance_assignment') {
      return res.status(400).json({
        success: false,
        message: 'Invoice has already been assigned or processed'
      });
    }
    
    console.log('Assigning supplier invoice:', invoice.invoiceNumber, 'to department:', department);
    
    // Option 1: Just assign (like employee invoices)
    if (!updateDetails) {
      invoice.assignToDepartment(department, req.user.userId);
    } else {
      // Option 2: Update details and assign in one step
      invoice.processAndAssign(department, req.user.userId, updateDetails);
    }
    
    // Add comments if provided
    if (comments) {
      invoice.financeReview = {
        ...invoice.financeReview,
        finalComments: comments
      };
    }
    
    await invoice.save();
    
    console.log('Supplier invoice assigned successfully. First approver:', invoice.getCurrentApprover()?.approver.name);
    
    await invoice.populate('assignedBy', 'fullName email');
    
    console.log('=== SUPPLIER INVOICE ASSIGNED SUCCESSFULLY ===');
    
    res.json({
      success: true,
      message: 'Supplier invoice assigned to department successfully',
      data: invoice
    });
    
  } catch (error) {
    console.error('=== SUPPLIER INVOICE ASSIGNMENT FAILED ===', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to assign supplier invoice to department'
    });
  }
};



exports.updateSupplierInvoiceDetails = async (req, res) => {
  try {
    console.log('=== UPDATING SUPPLIER INVOICE DETAILS ===');
    const { invoiceId } = req.params;
    const updateDetails = req.body;
    
    const invoice = await SupplierInvoice.findById(invoiceId)
      .populate('supplier', 'supplierDetails email');
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Supplier invoice not found'
      });
    }
    
    if (invoice.approvalStatus !== 'pending_finance_assignment') {
      return res.status(400).json({
        success: false,
        message: 'Invoice details can only be updated while pending finance assignment'
      });
    }
    
    // Update the details
    invoice.updateFinanceDetails(updateDetails, req.user.userId);
    await invoice.save();
    
    console.log('=== SUPPLIER INVOICE DETAILS UPDATED ===');
    
    res.json({
      success: true,
      message: 'Supplier invoice details updated successfully',
      data: {
        ...invoice.toObject(),
        recommendations: invoice.getFinanceRecommendations(),
        hasMinimumInfo: invoice.hasMinimumInfo
      }
    });
    
  } catch (error) {
    console.error('=== SUPPLIER INVOICE DETAILS UPDATE FAILED ===', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to update supplier invoice details'
    });
  }
};


exports.bulkAssignSupplierInvoices = async (req, res) => {
  try {
    console.log('=== BULK ASSIGNING SUPPLIER INVOICES ===');
    const { invoiceIds, department, comments } = req.body;
    
    if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invoice IDs array is required'
      });
    }
    
    if (!department) {
      return res.status(400).json({
        success: false,
        message: 'Department is required'
      });
    }
    
    console.log(`Attempting to assign ${invoiceIds.length} invoices to department: ${department}`);
    
    // FIXED: Department name mapping to handle variations
    const departmentMapping = {
      'HR & Admin': 'HR & Admin',
      'HR/Admin': 'HR & Admin',
      'Technical': 'Technical',
      'Business Development': 'Business Development & Supply Chain',
      'Business Dev': 'Business Development & Supply Chain',
      'Supply Chain': 'Supply Chain',
      'Finance': 'Finance'
    };
    
    const mappedDepartment = departmentMapping[department] || department;
    console.log(`Mapped department: ${department} -> ${mappedDepartment}`);
    
    const results = {
      successful: [],
      failed: []
    };
    
    // Process each invoice individually to provide detailed error reporting
    for (const invoiceId of invoiceIds) {
      try {
        console.log(`Processing invoice ID: ${invoiceId}`);
        
        const invoice = await SupplierInvoice.findById(invoiceId)
          .populate('supplier', 'supplierDetails email');
        
        if (!invoice) {
          results.failed.push({ 
            invoiceId, 
            error: 'Invoice not found' 
          });
          continue;
        }
        
        console.log(`Found invoice: ${invoice.invoiceNumber}, Status: ${invoice.approvalStatus}`);
        
        if (invoice.approvalStatus !== 'pending_finance_assignment') {
          results.failed.push({ 
            invoiceId, 
            invoiceNumber: invoice.invoiceNumber,
            error: 'Invoice already assigned or processed',
            currentStatus: invoice.approvalStatus
          });
          continue;
        }
        
        // FIXED: Use the department mapping in the assignment
        console.log(`Assigning invoice ${invoice.invoiceNumber} to department: ${mappedDepartment}`);
        
        // Set the department directly to avoid enum validation issues
        invoice.assignedDepartment = mappedDepartment;
        invoice.assignedBy = req.user.userId;
        invoice.assignmentDate = new Date();
        invoice.assignmentTime = new Date().toTimeString().split(' ')[0];
        invoice.approvalStatus = 'pending_department_approval';
        
        // Get approval chain using service category primarily, fall back to department
        const { getSupplierApprovalChain } = require('../config/supplierApprovalChain');
        const chain = getSupplierApprovalChain(department, invoice.serviceCategory);
        
        if (!chain || chain.length === 0) {
          results.failed.push({ 
            invoiceId, 
            invoiceNumber: invoice.invoiceNumber,
            error: `No approval chain found for department: ${department}, service category: ${invoice.serviceCategory}`
          });
          continue;
        }
        
        // Create approval chain
        invoice.approvalChain = chain.map(step => ({
          level: step.level,
          approver: {
            name: step.approver,
            email: step.email,
            role: step.role,
            department: step.department
          },
          status: 'pending',
          activatedDate: step.level === 1 ? new Date() : null
        }));

        invoice.currentApprovalLevel = 1;
        
        // Update finance review
        if (comments) {
          invoice.financeReview = {
            reviewedBy: req.user.userId,
            reviewDate: new Date(),
            reviewTime: new Date().toTimeString().split(' ')[0],
            status: 'assigned',
            finalComments: comments
          };
        }
        
        // Mark as no longer initial submission
        invoice.initialSubmission = false;
        
        // Calculate processing time
        if (invoice.metadata) {
          invoice.metadata.submissionToAssignmentTime = 
            (invoice.assignmentDate - invoice.uploadedDate) / (1000 * 60 * 60 * 24);
        }
        
        // Save the invoice
        await invoice.save();
        
        const firstApprover = invoice.approvalChain[0];
        results.successful.push({
          invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          supplierName: invoice.supplierDetails.companyName,
          assignedDepartment: invoice.assignedDepartment,
          firstApprover: firstApprover?.approver.name || 'N/A',
          approvalChainLevels: invoice.approvalChain.length
        });
        
        console.log(`✓ Successfully assigned ${invoice.invoiceNumber} to ${invoice.assignedDepartment}. First approver: ${firstApprover?.approver.name}`);
        
      } catch (error) {
        console.error(`Failed to assign supplier invoice ${invoiceId}:`, error);
        results.failed.push({ 
          invoiceId, 
          error: error.message || 'Assignment failed',
          details: error.name === 'ValidationError' ? Object.keys(error.errors).join(', ') : undefined
        });
      }
    }
    
    const totalSuccessful = results.successful.length;
    const totalFailed = results.failed.length;
    
    console.log(`Bulk supplier invoice assignment completed: ${totalSuccessful} successful, ${totalFailed} failed`);
    
    // Log failed assignments for debugging
    if (results.failed.length > 0) {
      console.log('Failed assignments:', JSON.stringify(results.failed, null, 2));
    }
    
    res.json({
      success: totalSuccessful > 0, // Consider it successful if at least one succeeded
      message: `Bulk assignment completed: ${totalSuccessful} successful, ${totalFailed} failed`,
      data: results,
      summary: {
        total: invoiceIds.length,
        successful: totalSuccessful,
        failed: totalFailed,
        successRate: Math.round((totalSuccessful / invoiceIds.length) * 100)
      }
    });
    
  } catch (error) {
    console.error('=== BULK SUPPLIER INVOICE ASSIGNMENT FAILED ===', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Bulk assignment failed',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// Also update the single assignment method for consistency
exports.assignSupplierInvoiceToDepartment = async (req, res) => {
  try {
    console.log('=== ASSIGNING SUPPLIER INVOICE TO DEPARTMENT ===');
    const { invoiceId } = req.params;
    const { department, comments, updateDetails } = req.body;
    
    if (!department) {
      return res.status(400).json({
        success: false,
        message: 'Department is required'
      });
    }
    
    const invoice = await SupplierInvoice.findById(invoiceId)
      .populate('supplier', 'supplierDetails email');
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Supplier invoice not found'
      });
    }
    
    if (invoice.approvalStatus !== 'pending_finance_assignment') {
      return res.status(400).json({
        success: false,
        message: 'Invoice has already been assigned or processed',
        currentStatus: invoice.approvalStatus
      });
    }
    
    console.log(`Assigning supplier invoice: ${invoice.invoiceNumber} to department: ${department}`);
    
    // FIXED: Department name mapping
    const departmentMapping = {
      'HR & Admin': 'HR & Admin',
      'HR/Admin': 'HR & Admin',
      'Technical': 'Technical',
      'Business Development': 'Business Development & Supply Chain',
      'Business Dev': 'Business Development & Supply Chain',
      'Supply Chain': 'Supply Chain',
      'Finance': 'Finance'
    };
    
    const mappedDepartment = departmentMapping[department] || department;
    
    // Update details if provided (optional feature)
    if (updateDetails) {
      invoice.updateFinanceDetails(updateDetails, req.user.userId);
    }
    
    // Assign to department using mapped name
    invoice.assignedDepartment = mappedDepartment;
    invoice.assignedBy = req.user.userId;
    invoice.assignmentDate = new Date();
    invoice.assignmentTime = new Date().toTimeString().split(' ')[0];
    invoice.approvalStatus = 'pending_department_approval';
    
    // Get approval chain
    const { getSupplierApprovalChain } = require('../config/supplierApprovalChain');
    const chain = getSupplierApprovalChain(department, invoice.serviceCategory);
    
    if (!chain || chain.length === 0) {
      return res.status(400).json({
        success: false,
        message: `No approval chain found for department: ${department}, service category: ${invoice.serviceCategory}`
      });
    }
    
    // Create approval chain
    invoice.approvalChain = chain.map(step => ({
      level: step.level,
      approver: {
        name: step.approver,
        email: step.email,
        role: step.role,
        department: step.department
      },
      status: 'pending',
      activatedDate: step.level === 1 ? new Date() : null
    }));

    invoice.currentApprovalLevel = 1;
    
    // Add comments if provided
    if (comments) {
      invoice.financeReview = {
        ...invoice.financeReview,
        reviewedBy: req.user.userId,
        reviewDate: new Date(),
        reviewTime: new Date().toTimeString().split(' ')[0],
        status: 'assigned',
        finalComments: comments
      };
    }
    
    // Mark as processed
    invoice.initialSubmission = false;
    
    await invoice.save();
    
    console.log(`Supplier invoice assigned successfully. First approver: ${invoice.approvalChain[0]?.approver.name}`);
    
    await invoice.populate('assignedBy', 'fullName email');
    
    console.log('=== SUPPLIER INVOICE ASSIGNED SUCCESSFULLY ===');
    
    res.json({
      success: true,
      message: 'Supplier invoice assigned to department successfully',
      data: {
        ...invoice.toObject(),
        currentApprover: invoice.getCurrentApprover(),
        approvalProgress: invoice.approvalProgress
      }
    });
    
  } catch (error) {
    console.error('=== SUPPLIER INVOICE ASSIGNMENT FAILED ===', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to assign supplier invoice to department',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// Get pending supplier approvals for current user
exports.getPendingSupplierApprovalsForUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('email fullName');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    console.log('Fetching pending supplier approvals for:', user.email);
    
    // Get supplier invoices where this user appears in the pending approval chain
    let pendingInvoices = await SupplierInvoice.getPendingForApprover(user.email);
    
    console.log(`Found ${pendingInvoices.length} total invoices with ${user.email} in approval chain`);
    
    // Filter to only invoices where user is the CURRENT approver at currentApprovalLevel
    pendingInvoices = pendingInvoices.filter(invoice => {
      if (!invoice.approvalChain || !Array.isArray(invoice.approvalChain)) {
        return false;
      }
      
      // Find the current approval step
      const currentStep = invoice.approvalChain.find(step => step.level === invoice.currentApprovalLevel);
      
      // Check if user is the current approver
      return currentStep && currentStep.approver && currentStep.approver.email === user.email;
    });
    
    console.log(`Filtered to ${pendingInvoices.length} invoices where ${user.email} is current approver`);
    
    // Add additional details for each invoice
    const invoicesWithDetails = pendingInvoices.map(invoice => {
      // For lean objects, manually construct the response
      const currentStep = invoice.approvalChain?.find(s => s.level === invoice.currentApprovalLevel);
      
      return {
        _id: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        poNumber: invoice.poNumber,
        invoiceAmount: invoice.invoiceAmount,
        currency: invoice.currency,
        serviceCategory: invoice.serviceCategory,
        assignedDepartment: invoice.assignedDepartment,
        approvalStatus: invoice.approvalStatus,
        currentApprovalLevel: invoice.currentApprovalLevel,
        supplier: invoice.supplier,
        approvalChain: invoice.approvalChain,
        assignmentDate: invoice.assignmentDate,
        createdAt: invoice.createdAt,
        currentApprover: currentStep?.approver || null,
        approvalProgress: {
          current: invoice.currentApprovalLevel,
          total: invoice.approvalChain?.length || 0
        },
        canUserApprove: currentStep?.approver?.email === user.email
      };
    });
    
    res.json({
      success: true,
      data: invoicesWithDetails,
      count: invoicesWithDetails.length,
      userInfo: {
        email: user.email,
        name: user.fullName
      }
    });
    
  } catch (error) {
    console.error('Error fetching pending supplier approvals:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending supplier approvals',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Process supplier invoice payment
exports.processSupplierInvoicePayment = async (req, res) => {
  try {
    console.log('=== PROCESSING SUPPLIER INVOICE PAYMENT ===');
    const { invoiceId } = req.params;
    const { 
      paymentAmount, 
      paymentMethod, 
      transactionReference, 
      bankReference, 
      paymentDate,
      comments 
    } = req.body;
    
    const invoice = await SupplierInvoice.findById(invoiceId)
      .populate('supplier', 'email fullName');
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Supplier invoice not found'
      });
    }
    
    if (invoice.approvalStatus !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Invoice must be fully approved before payment processing'
      });
    }
    
    // Update payment details
    invoice.paymentStatus = 'paid';
    invoice.approvalStatus = 'paid';
    invoice.paymentDetails = {
      amountPaid: paymentAmount || invoice.invoiceAmount,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      paymentMethod: paymentMethod || 'Bank Transfer',
      transactionReference,
      bankReference,
      paidBy: req.user.userId
    };
    
    // Update finance review
    invoice.financeReview = {
      ...invoice.financeReview,
      reviewedBy: req.user.userId,
      reviewDate: new Date(),
      reviewTime: new Date().toTimeString().split(' ')[0],
      status: 'paid',
      finalComments: comments,
      paymentDate: invoice.paymentDetails.paymentDate,
      paymentReference: transactionReference,
      paymentAmount: invoice.paymentDetails.amountPaid,
      paymentMethod: invoice.paymentDetails.paymentMethod
    };
    
    await invoice.save();
    
    // Notify supplier of payment - use supplierDetails email or supplier email
    const supplierEmail = invoice.supplierDetails?.email || invoice.supplier?.email;
    if (supplierEmail) {
      await sendEmail({
        to: supplierEmail,
        subject: `Payment Processed - Invoice ${invoice.invoiceNumber}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #d4edda; padding: 20px; border-radius: 8px;">
              <h2>Payment Processed Successfully</h2>
              <p>Dear ${invoice.supplierDetails?.contactName || invoice.supplier?.fullName},</p>
              <p>Your invoice payment has been processed successfully.</p>
              
              <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3>Payment Details</h3>
                <ul>
                  <li><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</li>
                  <li><strong>PO Number:</strong> ${invoice.poNumber}</li>
                  <li><strong>Amount Paid:</strong> ${invoice.currency} ${invoice.paymentDetails.amountPaid.toLocaleString()}</li>
                  <li><strong>Payment Date:</strong> ${invoice.paymentDetails.paymentDate.toLocaleDateString('en-GB')}</li>
                  <li><strong>Payment Method:</strong> ${invoice.paymentDetails.paymentMethod}</li>
                  ${transactionReference ? `<li><strong>Transaction Reference:</strong> ${transactionReference}</li>` : ''}
                  ${bankReference ? `<li><strong>Bank Reference:</strong> ${bankReference}</li>` : ''}
                </ul>
              </div>
              
              ${comments ? `
              <div style="background-color: #e9ecef; padding: 15px; border-radius: 6px;">
                <p><strong>Finance Comments:</strong> "${comments}"</p>
              </div>
              ` : ''}
              
              <p>Thank you for your business with Grato Engineering.</p>
            </div>
          </div>
        `
      }).catch(error => {
        console.error('Failed to send payment notification:', error);
      });
    }
    
    console.log('=== SUPPLIER INVOICE PAYMENT PROCESSED ===');
    
    res.json({
      success: true,
      message: 'Payment processed successfully',
      data: invoice
    });
    
  } catch (error) {
    console.error('=== FAILED TO PROCESS SUPPLIER INVOICE PAYMENT ===', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to process payment'
    });
  }
};

// Mark supplier invoice as processed (final finance step)
exports.markSupplierInvoiceAsProcessed = async (req, res) => {
  try {
    console.log('=== MARKING SUPPLIER INVOICE AS PROCESSED ===');
    const { invoiceId } = req.params;
    const { comments } = req.body;

    const invoice = await SupplierInvoice.findById(invoiceId)
      .populate('supplier', 'supplierDetails email');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Supplier invoice not found'
      });
    }

    if (invoice.approvalStatus !== 'pending_finance_processing') {
      return res.status(400).json({
        success: false,
        message: 'Invoice must be pending finance processing to mark as processed'
      });
    }

    // Update invoice status
    invoice.approvalStatus = 'processed';
    
    // Update finance review
    invoice.financeReview = {
      ...invoice.financeReview,
      reviewedBy: req.user.userId,
      reviewDate: new Date(),
      reviewTime: new Date().toTimeString().split(' ')[0],
      status: 'processed',
      finalComments: comments || 'Invoice processed and ready for payment'
    };

    await invoice.save();

    // Send notification to supplier
    if (invoice.supplier && invoice.supplier.email) {
      await sendEmail({
        to: invoice.supplier.email,
        subject: `Invoice Processed - ${invoice.invoiceNumber}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #d1ecf1; padding: 20px; border-radius: 8px; border-left: 4px solid #0bc5ea;">
              <h2 style="color: #333; margin-top: 0;">Invoice Processed</h2>
              <p style="color: #555;">Dear ${invoice.supplierDetails.companyName},</p>
              <p>Your invoice has been processed by our finance team and is now ready for payment.</p>
              
              <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3>Invoice Details</h3>
                <ul style="list-style: none; padding: 0;">
                  <li><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</li>
                  <li><strong>PO Number:</strong> ${invoice.poNumber}</li>
                  <li><strong>Amount:</strong> ${invoice.currency} ${invoice.invoiceAmount.toLocaleString()}</li>
                  <li><strong>Status:</strong> Processed - Ready for Payment</li>
                  <li><strong>Processed Date:</strong> ${new Date().toLocaleDateString('en-GB')}</li>
                </ul>
              </div>
              
              ${comments ? `
              <div style="background-color: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0;">
                <p><strong>Finance Comments:</strong></p>
                <p style="font-style: italic;">${comments}</p>
              </div>
              ` : ''}
              
              <p>Payment will be processed according to our payment terms. You will receive a separate notification once payment is completed.</p>
              
              <p>Thank you for your business with Grato Engineering.</p>
            </div>
          </div>
        `
      }).catch(error => {
        console.error('Failed to send invoice processed notification:', error);
      });
    }

    console.log('=== SUPPLIER INVOICE MARKED AS PROCESSED ===');

    res.json({
      success: true,
      message: 'Invoice marked as processed successfully',
      data: {
        ...invoice.toObject(),
        currentApprover: invoice.getCurrentApprover(),
        approvalProgress: invoice.approvalProgress
      }
    });

  } catch (error) {
    console.error('=== FAILED TO MARK SUPPLIER INVOICE AS PROCESSED ===', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to mark invoice as processed'
    });
  }
};

// Bulk assign supplier invoices
exports.bulkAssignSupplierInvoices = async (req, res) => {
  try {
    console.log('=== BULK ASSIGNING SUPPLIER INVOICES ===');
    const { invoiceIds, department, comments } = req.body;
    
    if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invoice IDs array is required'
      });
    }
    
    if (!department) {
      return res.status(400).json({
        success: false,
        message: 'Department is required'
      });
    }
    
    const results = {
      successful: [],
      failed: []
    };
    
    for (const invoiceId of invoiceIds) {
      try {
        const invoice = await SupplierInvoice.findById(invoiceId)
          .populate('supplier', 'supplierDetails email');
        
        if (!invoice) {
          results.failed.push({ invoiceId, error: 'Invoice not found' });
          continue;
        }
        
        if (invoice.approvalStatus !== 'pending_finance_assignment') {
          results.failed.push({ 
            invoiceId, 
            invoiceNumber: invoice.invoiceNumber,
            error: 'Invoice already assigned or processed' 
          });
          continue;
        }
        
        invoice.assignToDepartment(department, req.user.userId);
        
        if (comments) {
          invoice.financeReview = {
            reviewedBy: req.user.userId,
            reviewDate: new Date(),
            reviewTime: new Date().toTimeString().split(' ')[0],
            status: 'assigned',
            finalComments: comments
          };
        }
        
        await invoice.save();
        
        results.successful.push({
          invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          supplierName: invoice.supplierDetails.companyName,
          firstApprover: invoice.getCurrentApprover()?.approver.name
        });
        
        console.log(`Successfully assigned ${invoice.invoiceNumber} to ${department}`);
        
      } catch (error) {
        console.error(`Failed to assign supplier invoice ${invoiceId}:`, error);
        results.failed.push({ 
          invoiceId, 
          error: error.message || 'Assignment failed' 
        });
      }
    }
    
    console.log(`Bulk supplier invoice assignment completed: ${results.successful.length} successful, ${results.failed.length} failed`);
    
    res.json({
      success: true,
      message: `Bulk assignment completed: ${results.successful.length} successful, ${results.failed.length} failed`,
      data: results
    });
    
  } catch (error) {
    console.error('=== BULK SUPPLIER INVOICE ASSIGNMENT FAILED ===', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Bulk assignment failed'
    });
  }
};

// Get supplier invoice analytics
exports.getSupplierInvoiceAnalytics = async (req, res) => {
  try {
    const { startDate, endDate, serviceCategory, supplierType } = req.query;
    
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.uploadedDate = {};
      if (startDate) dateFilter.uploadedDate.$gte = new Date(startDate);
      if (endDate) dateFilter.uploadedDate.$lte = new Date(endDate);
    }
    
    const matchFilter = { ...dateFilter };
    if (serviceCategory) matchFilter.serviceCategory = serviceCategory;
    
    // Overall statistics
    const overallStats = await SupplierInvoice.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: '$approvalStatus',
          count: { $sum: 1 },
          totalAmount: { $sum: '$invoiceAmount' },
          avgAmount: { $avg: '$invoiceAmount' },
          avgProcessingTime: {
            $avg: {
              $divide: [
                { $subtract: ['$updatedAt', '$uploadedDate'] },
                1000 * 60 * 60 * 24
              ]
            }
          }
        }
      }
    ]);
    
    // By service category
    const categoryStats = await SupplierInvoice.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$serviceCategory',
          count: { $sum: 1 },
          totalAmount: { $sum: '$invoiceAmount' },
          avgAmount: { $avg: '$invoiceAmount' },
          statuses: {
            $push: '$approvalStatus'
          }
        }
      },
      {
        $project: {
          _id: 1,
          count: 1,
          totalAmount: 1,
          avgAmount: 1,
          pendingCount: {
            $size: {
              $filter: {
                input: '$statuses',
                cond: { $in: ['$this', ['pending_finance_assignment', 'pending_department_approval']] }
              }
            }
          },
          approvedCount: {
            $size: {
              $filter: {
                input: '$statuses',
                cond: { $eq: ['$this', 'approved'] }
              }
            }
          },
          paidCount: {
            $size: {
              $filter: {
                input: '$statuses',
                cond: { $eq: ['$this', 'paid'] }
              }
            }
          }
        }
      }
    ]);
    
    // Top suppliers
    const topSuppliers = await SupplierInvoice.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$supplier',
          supplierName: { $first: '$supplierDetails.companyName' },
          supplierType: { $first: '$supplierDetails.supplierType' },
          count: { $sum: 1 },
          totalAmount: { $sum: '$invoiceAmount' }
        }
      },
      { $sort: { totalAmount: -1 } },
      { $limit: 10 }
    ]);
    
    // Recent activity
    const recentActivity = await SupplierInvoice.find(dateFilter)
      .populate('supplier', 'supplierDetails')
      .populate('assignedBy', 'fullName')
      .sort({ updatedAt: -1 })
      .limit(15)
      .select('invoiceNumber supplierDetails approvalStatus invoiceAmount serviceCategory updatedAt currentApprovalLevel');
    
    res.json({
      success: true,
      data: {
        overall: overallStats,
        byCategory: categoryStats,
        topSuppliers,
        recentActivity
      }
    });
    
  } catch (error) {
    console.error('Error fetching supplier invoice analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics'
    });
  }
};


exports.getSignedFileUrl = async (req, res) => {
  try {
    const { publicId, resourceType = 'raw' } = req.query;
    
    if (!publicId) {
      return res.status(400).json({ success: false, message: 'publicId is required' });
    }

    const requestor = req.user || req.supplier;
    if (!requestor) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure:     true
    });

    // Use generate_download_url for raw files — this creates a properly signed URL
    const signedUrl = cloudinary.utils.private_download_url(publicId, 'pdf', {
      resource_type: resourceType,
      type: 'upload',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      attachment: false  // false = view in browser, true = force download
    });

    res.json({ success: true, url: signedUrl });
  } catch (error) {
    console.error('Error generating signed URL:', error);
    res.status(500).json({ success: false, message: 'Failed to generate download URL' });
  }
};




exports.proxyFile = async (req, res) => {
  try {
    const { publicId, resourceType = 'raw' } = req.query;

    const requestor = req.user || req.supplier;
    if (!requestor) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure:     true
    });

    // Generate a short-lived signed download URL using Cloudinary's SDK
    const timestamp = Math.floor(Date.now() / 1000) + 3600;
    
    const signedUrl = cloudinary.utils.private_download_url(
      publicId,
      'pdf',
      {
        resource_type: resourceType,
        type: 'upload',
        expires_at: timestamp,
      }
    );

    console.log('Generated private download URL:', signedUrl);

    // Fetch using the signed URL (no basic auth needed - signature is in the URL)
    const axios = require('axios');
    const fileResponse = await axios.get(signedUrl, {
      responseType: 'stream',
      timeout: 30000
    });

    const filename = publicId.split('/').pop() || 'file.pdf';
    res.setHeader('Content-Type', fileResponse.headers['content-type'] || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    
    if (fileResponse.headers['content-length']) {
      res.setHeader('Content-Length', fileResponse.headers['content-length']);
    }

    fileResponse.data.pipe(res);

  } catch (error) {
    console.error('Error proxying file:', error.message);
    res.status(500).json({ success: false, message: 'Failed to retrieve file' });
  }
};





exports.makeFilePublic = async (req, res) => {
  try {
    const { publicId, resourceType = 'raw' } = req.body;

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure:     true
    });

    // Change access mode on existing file
    const result = await cloudinary.api.update(publicId, {
      resource_type: resourceType,
      access_mode: 'public'
    });

    res.json({ success: true, url: result.secure_url });
  } catch (error) {
    console.error('Error updating file access:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
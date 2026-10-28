const Invoice = require('../models/Invoice');
const User = require('../models/User');
const Customer = require('../models/Customer');
const { sendEmail } = require('../services/emailService');
const { getInvoiceApprovalChain } = require('../config/invoiceApprovalChain');
const WorkflowService = require('../services/workflowService');
const path = require('path');
const fs = require('fs').promises;
const accountingService = require('../services/accountingService');
const { getEffectiveApprovalEmails } = require('../utils/delegationHelper');

/**
 * Enrich one invoice or a list of invoices with `poBalance` — the tracked
 * customer PO's total/invoiced-so-far/remaining — whenever the invoice was
 * drawn against a partially-invoiceable PO (see Customer.purchaseOrders in
 * models/Customer.js). Approvers otherwise have no way to tell a partial
 * draw from the PO's full value when they're deciding whether to approve.
 *
 * Deliberately non-invasive: it takes whatever invoices an existing query
 * already returned (delegation-aware or not) and adds one field, rather
 * than changing how those invoices are fetched.
 */
async function withPOBalances(invoiceOrInvoices) {
  const isArray = Array.isArray(invoiceOrInvoices);
  const list = (isArray ? invoiceOrInvoices : [invoiceOrInvoices])
    .map(inv => (inv && typeof inv.toObject === 'function') ? inv.toObject() : inv);

  const customerIds = [...new Set(
    list
      .filter(inv => inv && inv.customerPOId && inv.customer)
      .map(inv => (inv.customer._id || inv.customer).toString())
  )];

  if (customerIds.length > 0) {
    try {
      const customers = await Customer.find({ _id: { $in: customerIds } }).select('purchaseOrders');
      const customerMap = new Map(customers.map(c => [c._id.toString(), c]));

      list.forEach(inv => {
        if (!inv || !inv.customerPOId || !inv.customer) return;
        const custId = (inv.customer._id || inv.customer).toString();
        const cust = customerMap.get(custId);
        const po = cust?.purchaseOrders?.id(inv.customerPOId);
        if (po) {
          inv.poBalance = {
            poNumber: po.poNumber,
            poTotal: po.amount,
            invoicedSoFar: po.invoicedAmount || 0,
            remaining: Math.round(((po.amount || 0) - (po.invoicedAmount || 0)) * 100) / 100,
            invoicingStatus: po.invoicingStatus || 'not_invoiced'
          };
        }
      });
    } catch (err) {
      console.warn('withPOBalances: failed to enrich invoices with PO balance:', err.message);
    }
  }

  return isArray ? list : list[0];
}

/**
 * Post a customer invoice to the books and RECORD the outcome on the invoice
 * (postingStatus 'posted' / 'failed' + postingError). It never throws, but a failure is no
 * longer silent: the caller gets { ok:false, error } to show the user, and finance can retry
 * via PUT /api/invoices/finance/retry-posting/:invoiceId. Posting itself is idempotent.
 */
const safePostCustomerInvoiceEntry = async (invoiceId, userId, context = '') => {
  const stamp = (fields) => Invoice.updateOne({ _id: invoiceId }, { $set: fields }).catch(e =>
    console.error('Could not record posting status:', e.message));
  try {
    await accountingService.ensureDefaultChart();
    await accountingService.postCustomerInvoice(invoiceId, userId);
    await stamp({ postingStatus: 'posted', postingError: null, postingAttemptedAt: new Date() });
    console.log(`✅ Accounting posted for customer invoice${context ? ` (${context})` : ''}`);
    return { ok: true };
  } catch (error) {
    console.error(`❌ ACCOUNTING POSTING FAILED for customer invoice${context ? ` (${context})` : ''}:`, error.message);
    await stamp({ postingStatus: 'failed', postingError: String(error.message || error).slice(0, 500), postingAttemptedAt: new Date() });
    return { ok: false, error: error.message || String(error) };
  }
};

// Ids that identify the person performing an action (the real person, even when acting as a delegator)
const actorIds = (user) => {
  const ids = [user?.userId, user?._id, user?.id];
  const real = user?.actingBy;
  if (real) ids.push(real.userId, real._id, real.id);
  return ids.filter(Boolean).map(String);
};
const isPreparer = (invoice, user) => {
  const ids = new Set(actorIds(user));
  if ([invoice.createdBy, invoice.employee]
    .filter(Boolean)
    .map(v => String(v._id || v))
    .some(v => ids.has(v))) return true;
  const mine = [user?.email, user?.actingBy?.email].filter(Boolean).map(e => String(e).toLowerCase());
  return invoice.getPreparerEmails().some(e => mine.includes(e));
};


// Helper function for status display
function getStatusDisplay(status) {
  const statusMap = {
    'pending_finance_assignment': 'Pending Assignment',
    'pending_department_approval': 'In Approval Chain',
    'approved': 'Fully Approved',
    'rejected': 'Rejected',
    'processed': 'Processed'
  };
  return statusMap[status] || status;
}


// Upload invoice with approval chain (LOCAL STORAGE)
exports.uploadInvoiceWithApprovalChain = async (req, res) => {
  try {
    const { poNumber, invoiceNumber } = req.body;
    const userId = req.user.userId;

    console.log('=== INVOICE UPLOAD WITH APPROVAL CHAIN STARTED ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Files received:', Object.keys(req.files || {}));
    console.log('User ID:', userId);

    // Validate required fields
    if (!poNumber || !invoiceNumber) {
      return res.status(400).json({
        success: false,
        message: 'PO Number and Invoice Number are required'
      });
    }

    // Validate PO number format
    const poRegex = /^PO-\w{2}\d{10}-\d+$/i;
    if (!poRegex.test(poNumber)) {
      return res.status(400).json({
        success: false,
        message: 'PO number format should be: PO-XX0000000000-X (e.g., PO-NG0100000000-1)'
      });
    }

    if (!req.files || !req.files.poFile || !req.files.invoiceFile) {
      return res.status(400).json({
        success: false,
        message: 'Both PO file and Invoice file are required'
      });
    }

    // Get employee details
    const employee = await User.findById(userId).populate('supervisor departmentHead');
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    console.log(`Employee found: ${employee.fullName} Department: ${employee.department}`);

    // Check for duplicate invoice
    const existingInvoice = await Invoice.findOne({
      poNumber: poNumber.toUpperCase(),
      invoiceNumber: invoiceNumber.trim(),
      employee: userId
    });

    if (existingInvoice) {
      return res.status(400).json({
        success: false,
        message: 'An invoice with this PO number and invoice number already exists'
      });
    }

    // Process file uploads - Move to permanent storage
    const moveFileToPermanent = async (file, subfolder) => {
      try {
        console.log(`🔄 Processing ${file.fieldname}...`);
        
        // Create permanent directory if it doesn't exist
        const permanentDir = path.join(__dirname, '../uploads', subfolder);
        await fs.mkdir(permanentDir, { recursive: true });

        // Generate new filename
        const timestamp = Date.now();
        const sanitizedPO = poNumber.replace(/[^a-zA-Z0-9-]/g, '_');
        const ext = path.extname(file.originalname);
        const newFilename = `${sanitizedPO}_${file.fieldname}_${timestamp}${ext}`;
        const newPath = path.join(permanentDir, newFilename);

        // Copy file from temp to permanent location
        await fs.copyFile(file.path, newPath);
        
        console.log(`✅ ${file.fieldname} saved to: ${newPath}`);

        // Delete temp file
        await fs.unlink(file.path).catch(err => 
          console.warn('Failed to delete temp file:', err.message)
        );

        return {
          originalName: file.originalname,
          filename: newFilename,
          path: newPath,
          relativePath: `uploads/${subfolder}/${newFilename}`,
          size: file.size,
          mimetype: file.mimetype,
          uploadedAt: new Date()
        };
      } catch (error) {
        console.error(`❌ Failed to process ${file.fieldname}:`, error);
        throw new Error(`Failed to process ${file.fieldname}: ${error.message}`);
      }
    };

    const poFile = req.files.poFile[0];
    const invoiceFile = req.files.invoiceFile[0];

    console.log('Processing file uploads...');
    const [poFileData, invoiceFileData] = await Promise.all([
      moveFileToPermanent(poFile, 'po-files'),
      moveFileToPermanent(invoiceFile, 'invoice-files')
    ]);

    console.log('✅ All files saved successfully\n');

    // Generate approval workflow using WorkflowService
    console.log('=== BUILDING INVOICE APPROVAL CHAIN ===');
    console.log('Employee:', employee.fullName);
    console.log('Department:', employee.department);

    const rawApprovalChain = await WorkflowService.generateApprovalWorkflow(
      userId,
      'purchase',
      { requireFinance: true }
    );

    if (!rawApprovalChain || rawApprovalChain.length === 0) {
      throw new Error('Failed to generate approval chain - no approvers found');
    }

    console.log(`✅ Generated approval chain with ${rawApprovalChain.length} levels`);

    // Map the approval chain to match Invoice schema structure
    const approvalChain = rawApprovalChain.map(step => ({
      level: step.level,
      approver: {
        name: step.approver.name,
        email: step.approver.email,
        role: step.approver.position,
        department: step.approver.department
      },
      status: step.status,
      assignedDate: step.assignedDate,
      approvalCapacity: step.approvalCapacity,
      metadata: step.metadata || {},
      notificationSent: false,
      activatedDate: step.level === 1 ? new Date() : null
    }));

    // Create invoice with properly structured approval chain
    console.log('Creating invoice with approval chain...');
    const newInvoice = new Invoice({
      employee: userId,
      employeeName: employee.fullName,
      employeeDepartment: employee.department,
      employeeDetails: {
        name: employee.fullName,
        email: employee.email,
        department: employee.department,
        position: employee.position || 'Employee'
      },
      poNumber: poNumber.toUpperCase(),
      invoiceNumber: invoiceNumber.trim(),
      poFile: poFileData,
      invoiceFile: invoiceFileData,
      approvalChain: approvalChain,
      currentApprovalLevel: 1,
      approvalStatus: 'pending_department_approval',
      overallStatus: 'pending_approval',
      uploadedDate: new Date(),
      uploadedTime: new Date().toTimeString().split(' ')[0],
      submittedAt: new Date()
    });

    await newInvoice.save();

    console.log('✅ Invoice created successfully with ID:', newInvoice._id);

    // Send notification to first approver
    const firstApprover = approvalChain[0];
    if (firstApprover) {
      console.log(`Sending notification to first approver: ${firstApprover.approver.name} (${firstApprover.approver.email})`);
      
      await sendEmail({
        to: firstApprover.approver.email,
        subject: `🔔 New Invoice Approval Required - ${newInvoice.poNumber}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
              <h2 style="color: #333; margin-top: 0;">🔔 Invoice Approval Required</h2>
              <p>Dear ${firstApprover.approver.name},</p>
              
              <p>A new invoice has been uploaded and requires your approval.</p>
              
              <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #ffc107; padding-bottom: 10px;">Invoice Details</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employee.fullName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Department:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employee.department}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>PO Number:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${newInvoice.poNumber}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Invoice Number:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${newInvoice.invoiceNumber}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0;"><strong>Your Role:</strong></td>
                    <td style="padding: 8px 0;"><span style="background-color: #ffc107; color: #333; padding: 4px 8px; border-radius: 4px;">${firstApprover.approver.role}</span></td>
                  </tr>
                </table>
              </div>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/invoices" 
                   style="display: inline-block; background-color: #28a745; color: white; 
                          padding: 15px 30px; text-decoration: none; border-radius: 8px;
                          font-weight: bold; font-size: 16px;">
                  👀 Review & Approve Invoice
                </a>
              </div>
              
              <p style="color: #888; font-size: 12px; margin-bottom: 0; text-align: center;">
                This is an automated message from the Finance Management System.
              </p>
            </div>
          </div>
        `
      }).then(() => {
        // Mark notification as sent
        newInvoice.approvalChain[0].notificationSent = true;
        newInvoice.approvalChain[0].notificationSentAt = new Date();
        return newInvoice.save();
      }).catch(error => {
        console.error('Failed to send first approver notification:', error);
      });
    }

    // Send confirmation to employee
    await sendEmail({
      to: employee.email,
      subject: 'Invoice Uploaded Successfully - Approval Chain Initiated',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f6ffed; padding: 20px; border-radius: 8px; border-left: 4px solid #52c41a;">
            <h3>✅ Invoice Upload Confirmation</h3>
            <p>Dear ${employee.fullName},</p>
            
            <p>Your invoice has been uploaded successfully and is now in the approval process.</p>
            
            <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0;">
              <p><strong>Upload Details:</strong></p>
              <ul style="list-style: none; padding-left: 0;">
                <li>📋 <strong>PO Number:</strong> ${newInvoice.poNumber}</li>
                <li>🔢 <strong>Invoice Number:</strong> ${newInvoice.invoiceNumber}</li>
                <li>📅 <strong>Upload Date:</strong> ${new Date().toLocaleDateString('en-GB')}</li>
                <li>⏰ <strong>Upload Time:</strong> ${newInvoice.uploadedTime}</li>
                <li>📊 <strong>Status:</strong> <span style="color: #faad14; font-weight: bold;">Pending Approval</span></li>
              </ul>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 15px 0;">
              <p><strong>📋 Approval Chain (${approvalChain.length} steps):</strong></p>
              <ol style="margin: 10px 0; padding-left: 20px;">
                ${approvalChain.map((step, idx) => `
                  <li style="margin: 8px 0;">
                    <strong>${step.approver.name}</strong> - ${step.approver.role}
                    ${idx === 0 ? '<span style="color: #faad14; font-weight: bold;"> (Current)</span>' : ''}
                  </li>
                `).join('')}
              </ol>
            </div>
            
            <p>You can track the status of your invoice in the employee portal.</p>
            
            <p style="margin-top: 20px;">Thank you!</p>
          </div>
        </div>
      `
    }).catch(error => {
      console.error('Failed to send employee confirmation:', error);
    });

    console.log('=== INVOICE UPLOAD COMPLETED SUCCESSFULLY ===\n');

    // Send response
    res.status(201).json({
      success: true,
      message: 'Invoice uploaded successfully and sent for approval',
      data: {
        invoiceId: newInvoice._id,
        poNumber: newInvoice.poNumber,
        invoiceNumber: newInvoice.invoiceNumber,
        status: newInvoice.approvalStatus,
        uploadedDate: newInvoice.uploadedDate,
        uploadedTime: newInvoice.uploadedTime,
        files: {
          poFile: poFileData.originalName,
          invoiceFile: invoiceFileData.originalName
        },
        approvalChain: approvalChain.map(step => ({
          level: step.level,
          approver: step.approver.name,
          position: step.approver.role,
          department: step.approver.department,
          status: step.status
        })),
        nextApprover: approvalChain[0] ? {
          name: approvalChain[0].approver.name,
          email: approvalChain[0].approver.email,
          role: approvalChain[0].approver.role
        } : null
      }
    });

  } catch (error) {
    console.error('=== INVOICE UPLOAD FAILED ===', error);

    // Clean up temp files on error
    if (req.files) {
      const tempFiles = [];
      if (req.files.poFile) tempFiles.push(...req.files.poFile);
      if (req.files.invoiceFile) tempFiles.push(...req.files.invoiceFile);
      
      for (const file of tempFiles) {
        try {
          if (file.path && await fs.access(file.path).then(() => true).catch(() => false)) {
            await fs.unlink(file.path);
            console.log('Cleaned up temp file:', file.path);
          }
        } catch (cleanupError) {
          console.warn('Failed to delete temp file:', cleanupError.message);
        }
      }
    }

    res.status(400).json({
      success: false,
      message: error.message || 'Failed to upload invoice',
      error: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        stack: error.stack
      } : undefined
    });
  }
};

// Get all invoices for finance management
exports.getInvoicesForFinance = async (req, res) => {
  try {
    const { status, department, startDate, endDate, employee, page = 1, limit = 50 } = req.query;
    
    console.log('=== FETCHING INVOICES FOR FINANCE ===');
    console.log('Filters:', { status, department, startDate, endDate, employee });
    
    const filter = {};
    
    // Status filter
    if (status) {
      filter.approvalStatus = status;
    }
    
    // Department filter
    if (department) {
      filter.assignedDepartment = department;
    }
    
    // Employee search filter
    if (employee) {
      filter.$or = [
        { 'employeeDetails.name': { $regex: employee, $options: 'i' } },
        { 'employeeDetails.email': { $regex: employee, $options: 'i' } }
      ];
    }
    
    // Date range filter
    if (startDate || endDate) {
      filter.uploadedDate = {};
      if (startDate) filter.uploadedDate.$gte = new Date(startDate);
      if (endDate) filter.uploadedDate.$lte = new Date(endDate);
    }
    
    const skip = (page - 1) * limit;
    
    console.log('Query filter:', JSON.stringify(filter, null, 2));
    
    const [invoices, total] = await Promise.all([
      Invoice.find(filter)
        .populate('employee', 'fullName email department')
        .populate('assignedBy', 'fullName email')
        .sort({ uploadedDate: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Invoice.countDocuments(filter)
    ]);
    
    // Add computed fields
    const enrichedInvoices = invoices.map(invoice => ({
      ...invoice,
      formattedUploadDateTime: invoice.uploadedDate 
        ? `${new Date(invoice.uploadedDate).toLocaleDateString('en-GB')} at ${invoice.uploadedTime || new Date(invoice.uploadedDate).toTimeString().split(' ')[0]}`
        : 'N/A',
      currentApprovalStep: invoice.approvalChain && invoice.currentApprovalLevel > 0
        ? invoice.approvalChain.find(step => step.level === invoice.currentApprovalLevel)
        : null,
      approvalProgress: invoice.approvalChain && invoice.approvalChain.length > 0
        ? Math.round((invoice.approvalChain.filter(step => step.status === 'approved').length / invoice.approvalChain.length) * 100)
        : 0,
      statusDisplay: getStatusDisplay(invoice.approvalStatus)
    }));
    
    console.log(`Found ${enrichedInvoices.length} invoices (Total: ${total})`);
    
    res.json({
      success: true,
      data: enrichedInvoices,
      pagination: {
        current: parseInt(page),
        pageSize: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('=== ERROR FETCHING FINANCE INVOICES ===', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoices',
      error: error.message
    });
  }
};


// Process approval step (sequential approval)
exports.processApprovalStep = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { decision, comments } = req.body;

    console.log('=== PROCESSING INVOICE APPROVAL STEP ===');
    console.log('Invoice ID:', invoiceId);
    console.log('User Email:', req.user.email);
    console.log('Decision:', decision);

    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid decision. Must be "approved" or "rejected"'
      });
    }

    const invoice = await Invoice.findById(invoiceId)
      .populate('employee', 'fullName email department');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    if (invoice.approvalStatus !== 'pending_department_approval') {
      return res.status(400).json({
        success: false,
        message: `This invoice is not awaiting approval (status: ${invoice.approvalStatus})`
      });
    }

    // Segregation of duties: whoever prepared/uploaded the invoice cannot approve or reject it
    if (isPreparer(invoice, req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Segregation of duties: you prepared this invoice, so someone else must approve it.'
      });
    }

    // Check if user (or someone who delegated to them) can approve at current level
    const effectiveEmails = await getEffectiveApprovalEmails(req.user.userId, req.user.email);
    if (!invoice.canUserApprove(effectiveEmails)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to approve this invoice at this level'
      });
    }

    // Process the approval step
    const processedStep = invoice.processApprovalStep(
      effectiveEmails,
      decision,
      comments,
      req.user.userId
    );

    await invoice.save();

    let posting = null;
    if (decision === 'approved' && invoice.approvalStatus === 'approved') {
      posting = await safePostCustomerInvoiceEntry(invoice._id, req.user.userId, 'final approval');
    }

    // Send notification to employee
    const statusText = decision === 'approved' ? 'approved' : 'rejected';
    if (invoice.employee?.email) await sendEmail({
      to: invoice.employee.email,
      subject: `Invoice ${statusText.charAt(0).toUpperCase() + statusText.slice(1)} - ${invoice.poNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: ${decision === 'approved' ? '#f6ffed' : '#fff2f0'}; padding: 20px; border-radius: 8px; border-left: 4px solid ${decision === 'approved' ? '#52c41a' : '#ff4d4f'};">
            <h3>Invoice ${decision === 'approved' ? 'Approved' : 'Rejected'}</h3>
            <p>Dear ${invoice.employee?.fullName || 'colleague'},</p>
            
            <p>Your invoice has been ${statusText} by ${processedStep.approver.name} (${processedStep.approver.role}).</p>
            
            <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0;">
              <ul>
                <li><strong>PO Number:</strong> ${invoice.poNumber}</li>
                <li><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</li>
                <li><strong>Status:</strong> ${invoice.approvalStatus}</li>
                ${comments ? `<li><strong>Comments:</strong> ${comments}</li>` : ''}
              </ul>
            </div>
            
            ${decision === 'approved' && invoice.currentApprovalLevel > 0 ? `
            <div style="background-color: #e6f7ff; padding: 15px; border-radius: 5px;">
              <p><strong>Next Step:</strong> Awaiting approval from ${invoice.getCurrentApprover().approver.name} (${invoice.getCurrentApprover().approver.role})</p>
            </div>
            ` : ''}
            
            <p>Thank you!</p>
          </div>
        </div>
      `
    }).catch(error => {
      console.error('Failed to send employee notification:', error);
    });

    // If approved and there's a next approver, send notification
    if (decision === 'approved' && invoice.currentApprovalLevel > 0) {
      const nextApprover = invoice.getCurrentApprover();
      if (nextApprover && !nextApprover.notificationSent) {
        await invoice.notifyCurrentApprover();
      }
    }

    console.log('=== APPROVAL STEP PROCESSED SUCCESSFULLY ===');
    res.json({
      success: true,
      message: `Invoice ${statusText} successfully` +
        (posting && !posting.ok ? ' — BUT the accounting entry could not be posted; finance must retry posting.' : ''),
      accountingPosted: posting ? posting.ok : undefined,
      accountingError: posting && !posting.ok ? posting.error : undefined,
      data: invoice
    });

  } catch (error) {
    console.error('Error processing approval step:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to process approval'
    });
  }
};

// Get pending approvals for user (current level only)
exports.getPendingApprovalsForUser = async (req, res) => {
  try {
    console.log('Fetching pending approvals for:', req.user.email);

    const effectiveEmails = await getEffectiveApprovalEmails(req.user.userId, req.user.email);
    const invoices = await Invoice.getPendingForApprover(effectiveEmails);

    console.log(`Found ${invoices.length} pending invoices for approval`);

    const data = await withPOBalances(invoices);

    res.json({
      success: true,
      count: invoices.length,
      data
    });
  } catch (error) {
    console.error('Error fetching pending approvals:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending approvals'
    });
  }
};

// Get invoice details
exports.getInvoiceDetails = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.invoiceId)
      .populate('employee', 'fullName email department')
      .populate('approvalChain.approver.userId', 'fullName email');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Only finance/admin/ceo, the preparer/uploader, or someone in the approval chain may view it
    const privileged = ['finance', 'admin', 'ceo'].includes(req.user.role);
    if (!privileged) {
      const emails = await getEffectiveApprovalEmails(req.user.userId, req.user.email);
      const inChain = (invoice.approvalChain || []).some(step =>
        step.approver?.email && emails.includes(String(step.approver.email).toLowerCase()));
      if (!inChain && !isPreparer(invoice, req.user)) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this invoice'
        });
      }
    }

    const enrichedInvoice = await withPOBalances(invoice);
    const poBalance = enrichedInvoice?.poBalance || null;

    res.json({
      success: true,
      data: {
        ...invoice.toJSON(),
        approvalHistory: invoice.getApprovalHistory(),
        approvalProgress: invoice.approvalProgress,
        currentApprover: invoice.getCurrentApprover(),
        formattedUploadDateTime: invoice.formattedUploadDateTime,
        approvalChainStatus: invoice.getApprovalChainStatus(),
        poBalance
      }
    });
  } catch (error) {
    console.error('Error fetching invoice details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoice details'
    });
  }
};

// Get all invoices for supervisor (including upcoming ones)
exports.getSupervisorInvoices = async (req, res) => {
  try {
    const { getInheritedSeat } = require('../utils/financeSeat');
    const inherited = await getInheritedSeat(req.user.email);
    const invoices = await Invoice.getForSupervisor([req.user.email, ...inherited.emails]);
    const data = await withPOBalances(invoices);

    res.json({
      success: true,
      count: invoices.length,
      data
    });
  } catch (error) {
    console.error('Error fetching supervisor invoices:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoices'
    });
  }
};

// Assign invoice to department and create sequential approval chain
exports.assignInvoiceToDepartment = async (req, res) => {
  try {
    console.log('=== ASSIGNING INVOICE TO DEPARTMENT ===');
    const { invoiceId } = req.params;
    const { department, comments } = req.body;
    
    if (!department) {
      return res.status(400).json({
        success: false,
        message: 'Department is required'
      });
    }
    
    const invoice = await Invoice.findById(invoiceId)
      .populate('employee', 'fullName email department');
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }
    
    if (invoice.approvalStatus !== 'pending_finance_assignment') {
      return res.status(400).json({
        success: false,
        message: 'Invoice has already been assigned or processed'
      });
    }
    
    const employeeName = invoice.employeeDetails?.name || invoice.employee.fullName;
    console.log('Creating approval chain for:', employeeName, 'in department:', department);
    
    // Assign to department and create sequential approval chain
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

    // NOTE: nothing is posted to the books here. An invoice is only booked once its approval
    // chain is fully approved (see processApprovalStep).
    
    console.log('Invoice assigned successfully. First approver:', invoice.getCurrentApprover()?.approver.name);
    
    // The post-save middleware will automatically send notification to the first approver
    
    await invoice.populate('assignedBy', 'fullName email');
    
    console.log('=== INVOICE ASSIGNED SUCCESSFULLY ===');
    
    res.json({
      success: true,
      message: 'Invoice assigned to department successfully',
      data: invoice
    });
    
  } catch (error) {
    console.error('=== INVOICE ASSIGNMENT FAILED ===', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to assign invoice to department'
    });
  }
};

// Get approval statistics for dashboard
exports.getApprovalStatistics = async (req, res) => {
  try {
    const { department, startDate, endDate } = req.query;
    
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.uploadedDate = {};
      if (startDate) dateFilter.uploadedDate.$gte = new Date(startDate);
      if (endDate) dateFilter.uploadedDate.$lte = new Date(endDate);
    }
    
    // Overall statistics
    const overallStats = await Invoice.aggregate([
      { $match: { ...dateFilter, ...(department ? { assignedDepartment: department } : {}) } },
      {
        $group: {
          _id: '$approvalStatus',
          count: { $sum: 1 },
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
    
    // Department-wise statistics
    const departmentStats = await Invoice.aggregate([
      { $match: dateFilter },
      { $match: { assignedDepartment: { $exists: true } } },
      {
        $group: {
          _id: {
            department: '$assignedDepartment',
            status: '$approvalStatus'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.department',
          statuses: {
            $push: {
              status: '$_id.status',
              count: '$count'
            }
          },
          totalInvoices: { $sum: '$count' }
        }
      }
    ]);
    
    // Recent activity
    const recentActivity = await Invoice.find(dateFilter)
      .populate('employee', 'fullName')
      .populate('assignedBy', 'fullName')
      .sort({ updatedAt: -1 })
      .limit(10)
      .select('poNumber invoiceNumber employeeDetails approvalStatus updatedAt assignedDepartment currentApprovalLevel');
    
    res.json({
      success: true,
      data: {
        overall: overallStats,
        byDepartment: departmentStats,
        recentActivity
      }
    });
    
  } catch (error) {
    console.error('Error fetching approval statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch approval statistics'
    });
  }
};

// Mark invoice as processed (final finance step)
exports.markInvoiceAsProcessed = async (req, res) => {
  try {
    console.log('=== MARKING INVOICE AS PROCESSED ===');
    const { invoiceId } = req.params;
    const { comments } = req.body;
    
    const invoice = await Invoice.findById(invoiceId)
      .populate('employee', 'fullName email');
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }
    
    if (invoice.approvalStatus !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Invoice must be fully approved before processing'
      });
    }
    
    // Update invoice status
    invoice.approvalStatus = 'processed';
    invoice.financeReview = {
      ...invoice.financeReview,
      reviewedBy: req.user.userId,
      reviewDate: new Date(),
      reviewTime: new Date().toTimeString().split(' ')[0],
      status: 'processed',
      finalComments: comments
    };
    
    await invoice.save();

    // Safety net: if the entry wasn't booked at approval (e.g. it failed), try again now
    let posting = null;
    if (invoice.postingStatus !== 'posted') {
      posting = await safePostCustomerInvoiceEntry(invoice._id, req.user.userId, 'marked processed');
    }
    
    // Notify employee
    if (invoice.employee?.email) {
      await sendEmail({
        to: invoice.employee.email,
        subject: `✅ Invoice Processed - ${invoice.poNumber}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #d4edda; padding: 20px; border-radius: 8px;">
              <h2>✅ Invoice Successfully Processed</h2>
              <p>Dear ${invoice.employeeDetails?.name || invoice.employee?.fullName || 'colleague'},</p>
              <p>Your invoice has been successfully processed by the finance team.</p>
              
              <div style="background-color: white; padding: 20px; border-radius: 8px;">
                <ul>
                  <li><strong>PO Number:</strong> ${invoice.poNumber}</li>
                  <li><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</li>
                  <li><strong>Status:</strong> PROCESSED</li>
                </ul>
              </div>
              
              ${comments ? `
              <div style="background-color: #e9ecef; padding: 15px; border-radius: 6px;">
                <p><strong>Finance Comments:</strong> "${comments}"</p>
              </div>
              ` : ''}
            </div>
          </div>
        `
      }).catch(error => {
        console.error('Failed to send processed notification:', error);
      });
    }
    
    console.log('=== INVOICE MARKED AS PROCESSED ===');
    
    res.json({
      success: true,
      message: 'Invoice marked as processed successfully' +
        (posting && !posting.ok ? ' — BUT the accounting entry could not be posted; use retry posting.' : ''),
      accountingPosted: posting ? posting.ok : undefined,
      accountingError: posting && !posting.ok ? posting.error : undefined,
      data: invoice
    });
    
  } catch (error) {
    console.error('=== FAILED TO MARK INVOICE AS PROCESSED ===', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to mark invoice as processed'
    });
  }
};

// Admin/CEO: swap the approver on a pending step (e.g. someone on leave, or an in-flight invoice
// whose approver is also its preparer). The new approver can't be the preparer.
exports.reassignApprovalStep = async (req, res) => {
  try {
    const { level, newApproverEmail, reason } = req.body || {};
    if (!level || !newApproverEmail || !reason || String(reason).trim().length < 5) {
      return res.status(400).json({ success: false, message: 'level, newApproverEmail and a reason (min 5 characters) are required' });
    }
    const invoice = await Invoice.findById(req.params.invoiceId);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (invoice.approvalStatus !== 'pending_department_approval') {
      return res.status(400).json({ success: false, message: 'Only invoices awaiting approval can be reassigned' });
    }
    const step = invoice.approvalChain.find(s => s.level === Number(level));
    if (!step || step.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'That step does not exist or is already decided' });
    }
    const email = String(newApproverEmail).trim().toLowerCase();
    if (invoice.getPreparerEmails().includes(email)) {
      return res.status(400).json({ success: false, message: 'The new approver prepared this invoice and cannot approve it' });
    }
    const user = await User.findOne({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
      .select('fullName email role department isActive');
    if (!user || user.isActive === false) {
      return res.status(404).json({ success: false, message: 'No active user has that email' });
    }
    step.reassignedFrom = { name: step.approver?.name, email: step.approver?.email };
    step.reassignedBy = req.user.userId;
    step.reassignedAt = new Date();
    step.reassignReason = String(reason).trim();
    step.approver = { name: user.fullName, email: user.email, userId: user._id, role: step.approver?.role || user.role, department: user.department };
    step.notificationSent = false;
    await invoice.save();   // post-save hook notifies the approver if this is the current level
    res.json({ success: true, message: `Step ${level} reassigned to ${user.fullName}`, data: invoice });
  } catch (error) {
    console.error('Reassign failed:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to reassign step' });
  }
};

// Retry booking an approved invoice whose accounting posting failed (idempotent)
exports.retryAccountingPost = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.invoiceId);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (!['approved', 'processed'].includes(invoice.approvalStatus)) {
      return res.status(400).json({ success: false, message: 'Only fully approved invoices can be posted to the books' });
    }
    const posting = await safePostCustomerInvoiceEntry(invoice._id, req.user.userId, 'manual retry');
    if (!posting.ok) {
      return res.status(422).json({ success: false, message: `Posting failed: ${posting.error}` });
    }
    res.json({ success: true, message: 'Invoice posted to the books' });
  } catch (error) {
    console.error('Retry posting failed:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to retry posting' });
  }
};

// Bulk assign invoices to department
exports.bulkAssignInvoices = async (req, res) => {
  try {
    console.log('=== BULK ASSIGNING INVOICES ===');
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
    
    console.log(`Processing ${invoiceIds.length} invoices for department: ${department}`);
    
    const results = {
      successful: [],
      failed: []
    };
    
    for (const invoiceId of invoiceIds) {
      try {
        console.log(`Processing invoice ID: ${invoiceId}`);
        
        const invoice = await Invoice.findById(invoiceId)
          .populate('employee', 'fullName email department');
        
        if (!invoice) {
          console.log(`Invoice not found: ${invoiceId}`);
          results.failed.push({ invoiceId, error: 'Invoice not found' });
          continue;
        }
        
        console.log(`Found invoice: ${invoice.poNumber} for employee: ${invoice.employeeDetails?.name || invoice.employee?.fullName || 'Unknown'}`);
        
        if (invoice.approvalStatus !== 'pending_finance_assignment') {
          console.log(`Invoice ${invoice.poNumber} already assigned or processed. Status: ${invoice.approvalStatus}`);
          results.failed.push({ 
            invoiceId, 
            poNumber: invoice.poNumber,
            error: 'Invoice already assigned or processed' 
          });
          continue;
        }
        
        const employeeName = invoice.employeeDetails?.name || invoice.employee?.fullName || 'Unknown Employee';
        console.log(`Assigning invoice ${invoice.poNumber} for employee "${employeeName}" to department "${department}"`);
        
        // Call the assignment method with error handling
        try {
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
            poNumber: invoice.poNumber,
            employeeName,
            firstApprover: invoice.getCurrentApprover()?.approver.name || 'None'
          });
          
          console.log(`Successfully assigned ${invoice.poNumber} to ${department}. First approver: ${invoice.getCurrentApprover()?.approver.name || 'None'}`);
          
        } catch (assignmentError) {
          console.error(`Assignment error for invoice ${invoice.poNumber}:`, assignmentError);
          results.failed.push({ 
            invoiceId, 
            poNumber: invoice.poNumber,
            error: `Assignment failed: ${assignmentError.message}` 
          });
        }
        
      } catch (error) {
        console.error(`Failed to process invoice ${invoiceId}:`, error);
        results.failed.push({ 
          invoiceId, 
          error: error.message || 'Processing failed' 
        });
      }
    }
    
    console.log(`Bulk assignment completed: ${results.successful.length} successful, ${results.failed.length} failed`);
    
    // Log failed assignments for debugging
    if (results.failed.length > 0) {
      console.log('Failed assignments:', results.failed);
    }
    
    res.json({
      success: true,
      message: `Bulk assignment completed: ${results.successful.length} successful, ${results.failed.length} failed`,
      data: results
    });
    
  } catch (error) {
    console.error('=== BULK ASSIGNMENT FAILED ===', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Bulk assignment failed'
    });
  }
};

// Get department list for assignment
exports.getDepartments = async (req, res) => {
  try {
    const departments = getDepartmentList();
    res.json({
      success: true,
      data: departments
    });
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch departments'
    });
  }
};

// Get employees in a department
exports.getDepartmentEmployees = async (req, res) => {
  try {
    const { department } = req.params;
    const employees = getEmployeesInDepartment(department);
    
    res.json({
      success: true,
      data: employees
    });
  } catch (error) {
    console.error('Error fetching department employees:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch department employees'
    });
  }
};

// Get all invoices for finance management
exports.getInvoicesForFinance = async (req, res) => {
  try {
    const { status, department, startDate, endDate, page = 1, limit = 10 } = req.query;
    
    const filter = {};
    if (status) filter.approvalStatus = status;
    if (department) filter.assignedDepartment = department;
    if (startDate || endDate) {
      filter.uploadedDate = {};
      if (startDate) filter.uploadedDate.$gte = new Date(startDate);
      if (endDate) filter.uploadedDate.$lte = new Date(endDate);
    }
    
    const skip = (page - 1) * limit;
    
    const invoices = await Invoice.find(filter)
      .populate('employee', 'fullName email department')
      .populate('assignedBy', 'fullName email')
      .populate('approvalChain.approver.userId', 'fullName email')
      .sort({ uploadedDate: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Invoice.countDocuments(filter);
    
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
    console.error('Error fetching finance invoices:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoices'
    });
  }
};


/**
 * Download PO file
 * GET /api/invoices/:invoiceId/download/po
 */
exports.downloadPOFile = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    
    console.log('=== DOWNLOADING PO FILE ===');
    console.log('Invoice ID:', invoiceId);
    console.log('User:', req.user.email);

    // Get invoice
    const invoice = await Invoice.findById(invoiceId).populate('employee', 'email');
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Authorization check
    const isEmployee = invoice.employee._id.toString() === req.user.userId;
    const isApprover = invoice.approvalChain.some(
      step => step.approver.email === req.user.email
    );
    const isFinance = req.user.role === 'finance' || req.user.role === 'admin';

    if (!isEmployee && !isApprover && !isFinance) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to download this file'
      });
    }

    // Get file path
    let filePath;
    
    if (invoice.poFile.path) {
      // Absolute path stored
      filePath = invoice.poFile.path;
    } else if (invoice.poFile.relativePath) {
      // Relative path stored
      filePath = path.join(__dirname, '..', invoice.poFile.relativePath);
    } else if (invoice.poFile.filename) {
      // Only filename stored - construct path
      filePath = path.join(__dirname, '../uploads/po-files', invoice.poFile.filename);
    } else {
      return res.status(404).json({
        success: false,
        message: 'File path information not found in database'
      });
    }

    console.log('File path:', filePath);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      console.error('File not found:', filePath);
      return res.status(404).json({
        success: false,
        message: 'File not found on server',
        details: process.env.NODE_ENV === 'development' ? {
          searchedPath: filePath,
          storedData: invoice.poFile
        } : undefined
      });
    }

    // Get file stats
    const stats = await fs.stat(filePath);
    
    // Set headers for download
    const originalName = invoice.poFile.originalName || 'po-file.pdf';
    const ext = path.extname(originalName);
    const mimeType = invoice.poFile.mimetype || getMimeType(ext);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename="${originalName}"`);
    
    console.log(`Sending file: ${originalName} (${stats.size} bytes)`);

    // Stream the file
    const fileStream = require('fs').createReadStream(filePath);
    
    fileStream.on('error', (error) => {
      console.error('Stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Error streaming file'
        });
      }
    });

    fileStream.pipe(res);

  } catch (error) {
    console.error('=== DOWNLOAD PO FILE FAILED ===', error);
    
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to download file',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
};

/**
 * Download Invoice file
 * GET /api/invoices/:invoiceId/download/invoice
 */
exports.downloadInvoiceFile = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    
    console.log('=== DOWNLOADING INVOICE FILE ===');
    console.log('Invoice ID:', invoiceId);
    console.log('User:', req.user.email);

    // Get invoice
    const invoice = await Invoice.findById(invoiceId).populate('employee', 'email');
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Authorization check
    const isEmployee = invoice.employee._id.toString() === req.user.userId;
    const isApprover = invoice.approvalChain.some(
      step => step.approver.email === req.user.email
    );
    const isFinance = req.user.role === 'finance' || req.user.role === 'admin';

    if (!isEmployee && !isApprover && !isFinance) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to download this file'
      });
    }

    // Get file path
    let filePath;
    
    if (invoice.invoiceFile.path) {
      filePath = invoice.invoiceFile.path;
    } else if (invoice.invoiceFile.relativePath) {
      filePath = path.join(__dirname, '..', invoice.invoiceFile.relativePath);
    } else if (invoice.invoiceFile.filename) {
      filePath = path.join(__dirname, '../uploads/invoice-files', invoice.invoiceFile.filename);
    } else {
      return res.status(404).json({
        success: false,
        message: 'File path information not found in database'
      });
    }

    console.log('File path:', filePath);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      console.error('File not found:', filePath);
      return res.status(404).json({
        success: false,
        message: 'File not found on server',
        details: process.env.NODE_ENV === 'development' ? {
          searchedPath: filePath,
          storedData: invoice.invoiceFile
        } : undefined
      });
    }

    // Get file stats
    const stats = await fs.stat(filePath);
    
    // Set headers for download
    const originalName = invoice.invoiceFile.originalName || 'invoice-file.pdf';
    const ext = path.extname(originalName);
    const mimeType = invoice.invoiceFile.mimetype || getMimeType(ext);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename="${originalName}"`);
    
    console.log(`Sending file: ${originalName} (${stats.size} bytes)`);

    // Stream the file
    const fileStream = require('fs').createReadStream(filePath);
    
    fileStream.on('error', (error) => {
      console.error('Stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Error streaming file'
        });
      }
    });

    fileStream.pipe(res);

  } catch (error) {
    console.error('=== DOWNLOAD INVOICE FILE FAILED ===', error);
    
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to download file',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
};

/**
 * Get file preview URL (for displaying in browser)
 * GET /api/invoices/:invoiceId/preview/:fileType
 */
exports.previewFile = async (req, res) => {
  try {
    const { invoiceId, fileType } = req.params; // fileType: 'po' or 'invoice'
    
    console.log(`=== PREVIEWING ${fileType.toUpperCase()} FILE ===`);
    
    const invoice = await Invoice.findById(invoiceId).populate('employee', 'email');
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Authorization check
    const isEmployee = invoice.employee._id.toString() === req.user.userId;
    const isApprover = invoice.approvalChain.some(
      step => step.approver.email === req.user.email
    );
    const isFinance = req.user.role === 'finance' || req.user.role === 'admin';

    if (!isEmployee && !isApprover && !isFinance) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this file'
      });
    }

    // Get file data
    const fileData = fileType === 'po' ? invoice.poFile : invoice.invoiceFile;
    
    // Get file path
    let filePath;
    if (fileData.path) {
      filePath = fileData.path;
    } else if (fileData.relativePath) {
      filePath = path.join(__dirname, '..', fileData.relativePath);
    } else if (fileData.filename) {
      const folder = fileType === 'po' ? 'po-files' : 'invoice-files';
      filePath = path.join(__dirname, `../uploads/${folder}`, fileData.filename);
    } else {
      return res.status(404).json({
        success: false,
        message: 'File path not found'
      });
    }

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'File not found on server'
      });
    }

    // Get file stats
    const stats = await fs.stat(filePath);
    const ext = path.extname(fileData.originalName || '');
    const mimeType = fileData.mimetype || getMimeType(ext);

    // For preview (inline display)
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `inline; filename="${fileData.originalName}"`);
    
    // Stream the file
    const fileStream = require('fs').createReadStream(filePath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Preview file failed:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to preview file'
      });
    }
  }
};

/**
 * Helper function to determine MIME type from extension
 */
function getMimeType(ext) {
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.txt': 'text/plain'
  };
  
  return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
}

module.exports = exports;




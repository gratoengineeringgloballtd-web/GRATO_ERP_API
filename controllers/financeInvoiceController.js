const Invoice = require('../models/Invoice');
const PurchaseOrder = require('../models/PurchaseOrder');
const User = require('../models/User');
const Supplier = require('../models/Supplier');
const Customer = require('../models/Customer');
const pdfService = require('../services/pdfService');
const { sendEmail } = require('../services/emailService');
const { cloudinary } = require('../config/cloudinary');
const fs = require('fs').promises;

/**
 * Finance-specific function to prepare invoices from approved POs
 * Only Finance role can access this
 */
exports.prepareInvoiceFromPO = async (req, res) => {
  try {
    console.log('=== FINANCE INVOICE PREPARATION ===');
    console.log('Finance User ID:', req.user.userId);
    console.log('Request body:', req.body);

    const {
      poId,
      poNumber,
      invoiceNumber,
      supplierId,
      customerId,
      customerPOId,
      poReference,
      invoiceDate,
      dueDate,
      totalAmount,
      taxAmount = 0,
      description,
      paymentTerms = 'net-30',
      status = 'draft',
      items = [],
      paymentTermsBreakdown = [],
      paymentTermsInvoiced = []
    } = req.body;

    // Validate required fields
    if (!invoiceNumber) {
      return res.status(400).json({
        success: false,
        message: 'Invoice number is required'
      });
    }

    // Check if invoice already exists
    const normalizedPoNumber = poNumber && poNumber !== 'N/A' ? poNumber.toUpperCase() : undefined;
    const existingQuery = {
      invoiceNumber: invoiceNumber.trim(),
      createdBy: req.user.userId
    };

    if (normalizedPoNumber) {
      existingQuery.poNumber = normalizedPoNumber;
    }

    const existingInvoice = await Invoice.findOne(existingQuery);

    if (existingInvoice) {
      return res.status(400).json({
        success: false,
        message: 'Invoice with this number already exists for this PO'
      });
    }

    // Get Finance user details
    const financeUser = await User.findById(req.user.userId).select('fullName email department');
    if (!financeUser) {
      return res.status(404).json({
        success: false,
        message: 'Finance user not found'
      });
    }

    // Get Supplier details
    let supplier = null;
    if (supplierId) {
      supplier = await Supplier.findById(supplierId);
    }

    // Get Customer details (for finance-prepared customer invoices)
    let customer = null;
    if (customerId) {
      customer = await Customer.findById(customerId);
    }

    // Get PO details for reference (if poId provided)
    let purchaseOrder = null;
    if (poId) {
      purchaseOrder = await PurchaseOrder.findById(poId);
    }

    // Upload file if provided
    let invoiceFileData = null;
    if (req.file) {
      try {
        console.log('📤 Uploading invoice file to Cloudinary...');
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: 'finance-invoices',
          resource_type: 'auto',
          public_id: `${poNumber}-${invoiceNumber}-${Date.now()}`,
          use_filename: true,
          unique_filename: true
        });

        invoiceFileData = {
          publicId: result.public_id,
          url: result.secure_url,
          format: result.format,
          resourceType: result.resource_type,
          bytes: result.bytes,
          originalName: req.file.originalname
        };

        console.log('✅ Invoice file uploaded:', invoiceFileData.url);

        // Clean up temp file
        await fs.unlink(req.file.path).catch(() => {});
      } catch (error) {
        console.error('❌ File upload error:', error);
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(500).json({
          success: false,
          message: 'Failed to upload invoice file'
        });
      }
    }

    // Create invoice record
    const invoiceData = {
      poNumber: normalizedPoNumber,
      invoiceNumber: invoiceNumber.trim(),
      poId: poId,
      customer: customerId,
      customerDetails: customer ? {
        name: customer.companyName || customer.tradingName || customer.name,
        email: customer.primaryEmail || customer.email,
        phone: customer.primaryPhone || customer.phone
      } : undefined,
      customerPOId: customerPOId,
      poReference: poReference,
      employee: req.user.userId, // Set employee to the finance user creating the invoice
      supplier: supplierId,
      supplierDetails: supplier ? {
        name: supplier.name,
        email: supplier.email,
        taxId: supplier.taxId
      } : null,
      invoiceDate: new Date(invoiceDate),
      dueDate: new Date(dueDate),
      totalAmount: parseFloat(totalAmount),
      taxAmount: parseFloat(taxAmount || 0),
      netAmount: parseFloat(totalAmount) - parseFloat(taxAmount || 0),
      description,
      paymentTerms,
      status: status, // 'draft' or 'pending_approval'
      items,
      paymentTermsBreakdown,
      paymentTermsInvoiced,
      invoiceFile: invoiceFileData,
      createdBy: req.user.userId,
      createdByDetails: {
        name: financeUser.fullName,
        email: financeUser.email,
        department: financeUser.department,
        role: 'finance'
      },
      approvalChain: buildFinanceApprovalChain(financeUser.department),
      approvalStatus: 'pending_finance_review'
    };

    console.log('Creating invoice with data:', invoiceData);
    const invoice = await Invoice.create(invoiceData);
    console.log('✅ Invoice created:', invoice._id);

    // Update PO to mark as invoiced (if poId provided)
    if (poId && purchaseOrder) {
      await PurchaseOrder.findByIdAndUpdate(poId, {
        hasInvoice: true,
        invoiceId: invoice._id,
        invoiceNumber: invoiceNumber
      });
    }

    res.status(201).json({
      success: true,
      message: 'Invoice prepared successfully',
      data: {
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        poNumber: invoice.poNumber,
        status: invoice.status,
        totalAmount: invoice.totalAmount,
        createdDate: invoice.createdAt
      }
    });

  } catch (error) {
    console.error('Error preparing invoice:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to prepare invoice'
    });
  }
};

/**
 * Get purchase orders available for invoicing
 */
exports.getPOsForInvoicing = async (req, res) => {
  try {
    const purchaseOrders = await PurchaseOrder.find({
      status: 'approved',
      hasInvoice: false
    })
      .populate('supplier', 'name email')
      .select('poNumber poDate supplier totalAmount status hasInvoice items')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: purchaseOrders,
      count: purchaseOrders.length
    });
  } catch (error) {
    console.error('Error fetching POs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch purchase orders'
    });
  }
};

/**
 * Get invoices prepared by Finance
 */
exports.getFinancePreparedInvoices = async (req, res) => {
  try {
    const { status } = req.query;
    
    console.log('=== FETCHING FINANCE PREPARED INVOICES ===');
    console.log('User ID:', req.user.userId);
    console.log('Status filter:', status);
    
    let query = {
      createdBy: req.user.userId,
      // Only show invoices created by Finance (not uploaded by employees)
      'createdByDetails.role': 'finance'
    };

    if (status) {
      query.status = status;
    }

    console.log('Query:', JSON.stringify(query, null, 2));

    const invoices = await Invoice.find(query)
      .populate('employee', 'fullName email')
      .sort({ createdAt: -1 });

    console.log(`Found ${invoices.length} invoices`);
    if (invoices.length > 0) {
      console.log('First invoice:', {
        id: invoices[0]._id,
        invoiceNumber: invoices[0].invoiceNumber,
        createdBy: invoices[0].createdBy,
        status: invoices[0].status,
        createdByRole: invoices[0].createdByDetails?.role
      });
    }

    res.json({
      success: true,
      data: invoices,
      count: invoices.length
    });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoices'
    });
  }
};

/**
 * Download finance-prepared invoice as PDF
 */
exports.downloadFinanceInvoicePDF = async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const invoice = await Invoice.findById(invoiceId)
      .populate('customer', 'companyName tradingName primaryEmail primaryPhone')
      .populate('employee', 'fullName email');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    const customer = invoice.customer || {};
    const pdfData = {
      invoiceNumber: invoice.invoiceNumber,
      poNumber: invoice.poNumber,
      poReference: invoice.poReference,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      totalAmount: invoice.totalAmount,
      taxAmount: invoice.taxAmount,
      netAmount: invoice.netAmount,
      description: invoice.description,
      paymentTerms: invoice.paymentTerms,
      items: invoice.items,
      paymentTermsBreakdown: invoice.paymentTermsBreakdown,
      customerDetails: invoice.customerDetails || {
        name: customer.companyName || customer.tradingName,
        email: customer.primaryEmail,
        phone: customer.primaryPhone
      }
    };

    const pdfResult = await pdfService.generateInvoicePDF(pdfData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=Invoice_${invoice.invoiceNumber}.pdf`
    );
    res.end(pdfResult.buffer);
  } catch (error) {
    console.error('Invoice PDF download error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate invoice PDF'
    });
  }
};

/**
 * Submit Finance prepared invoice for approval
 */
exports.submitInvoiceForApproval = async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Verify invoice is in draft status
    if (invoice.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Only draft invoices can be submitted for approval'
      });
    }

    // Verify Finance user is the creator
    if (invoice.createdBy.toString() !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to modify this invoice'
      });
    }

    // Update status
    invoice.status = 'pending_approval';
    invoice.approvalStatus = 'pending_manager_approval';
    invoice.submittedDate = new Date();
    invoice.submittedBy = req.user.userId;

    await invoice.save();

    // Send notification to approval chain
    await notifyApprovalChain(invoice);

    res.json({
      success: true,
      message: 'Invoice submitted for approval',
      data: {
        invoiceId: invoice._id,
        status: invoice.status
      }
    });
  } catch (error) {
    console.error('Error submitting invoice:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit invoice'
    });
  }
};

/**
 * Delete draft invoice
 */
exports.deleteFinanceInvoice = async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Can only delete draft invoices
    if (invoice.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Only draft invoices can be deleted'
      });
    }

    // Verify Finance user is the creator
    if (invoice.createdBy.toString() !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this invoice'
      });
    }

    // Delete from Cloudinary if file exists
    if (invoice.invoiceFile?.publicId) {
      try {
        await cloudinary.uploader.destroy(invoice.invoiceFile.publicId);
      } catch (err) {
        console.warn('Failed to delete file from Cloudinary:', err);
      }
    }

    // Delete invoice and reset PO
    if (invoice.poId) {
      await PurchaseOrder.findByIdAndUpdate(invoice.poId, {
        hasInvoice: false,
        invoiceId: null,
        invoiceNumber: null
      });
    }

    await Invoice.findByIdAndDelete(invoiceId);

    res.json({
      success: true,
      message: 'Invoice deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete invoice'
    });
  }
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Build Finance approval chain
 */
function buildFinanceApprovalChain(department) {
  return [
    {
      level: 1,
      role: 'finance_manager',
      department: department,
      status: 'pending',
      approvedBy: null,
      approvalDate: null,
      comments: ''
    },
    {
      level: 2,
      role: 'finance_director',
      department: 'Finance',
      status: 'pending',
      approvedBy: null,
      approvalDate: null,
      comments: ''
    },
    {
      level: 3,
      role: 'cfo',
      department: 'Finance',
      status: 'pending',
      approvedBy: null,
      approvalDate: null,
      comments: ''
    }
  ];
}

/**
 * Notify approval chain members
 */
async function notifyApprovalChain(invoice) {
  try {
    // Get first approver in chain
    const firstApprover = invoice.approvalChain?.[0];
    if (!firstApprover) return;

    // Get users with required role
    const approvers = await User.find({
      role: firstApprover.role,
      department: firstApprover.department,
      isActive: true
    }).select('email fullName');

    if (approvers.length === 0) return;

    const emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h3>Invoice Approval Required</h3>
        <p>A new invoice has been submitted by Finance for your approval.</p>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">
          <p><strong>Invoice Details:</strong></p>
          <ul>
            <li><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</li>
            <li><strong>PO Number:</strong> ${invoice.poNumber}</li>
            <li><strong>Total Amount:</strong> XAF ${invoice.totalAmount?.toLocaleString()}</li>
            <li><strong>Supplier:</strong> ${invoice.supplierDetails?.name || 'N/A'}</li>
            <li><strong>Due Date:</strong> ${moment(invoice.dueDate).format('DD/MM/YYYY')}</li>
          </ul>
        </div>
        
        <p><a href="${process.env.CLIENT_URL}/finance/invoices/${invoice._id}/approve">
          Review & Approve
        </a></p>
      </div>
    `;

    await sendEmail({
      to: approvers.map(a => a.email),
      subject: `⏳ Invoice Approval Required - ${invoice.invoiceNumber}`,
      html: emailBody
    }).catch(err => console.warn('Failed to send email:', err));

  } catch (error) {
    console.warn('Error notifying approval chain:', error);
  }
}

module.exports = exports;

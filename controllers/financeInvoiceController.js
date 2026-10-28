const Invoice = require('../models/Invoice');
const PurchaseOrder = require('../models/PurchaseOrder');
const User = require('../models/User');
const Supplier = require('../models/Supplier');
const Customer = require('../models/Customer');
const pdfService = require('../services/pdfService');
const { sendEmail } = require('../services/emailService');
const { cloudinary } = require('../config/cloudinary');
const { saveFile, STORAGE_CATEGORIES } = require('../utils/cloudinaryStorage');
const Counter = require('../models/Counter');

// Invoice numbers are GRAE-INV-<CUSTOMER>-<YEAR>-<NNN>. NNN comes from ONE system-wide counter
// held by the server (so two users can never get the same number). The first number issued is
// 043 because invoices 1-42 already exist; if existing invoices ever go higher, the counter
// continues after the highest one.
const INVOICE_SEQ_START = 42; // last number already used
const INVOICE_NUMBER_PATTERN = /^GRAE-INV-.+-\d{4}-(\d+)$/i;

async function nextInvoiceNumber(customerName) {
  // Never go below the highest sequence already present in the system
  const existing = await Invoice.find({ invoiceNumber: INVOICE_NUMBER_PATTERN }).select('invoiceNumber').lean();
  const highest = existing.reduce((m, i) => {
    const mt = INVOICE_NUMBER_PATTERN.exec(i.invoiceNumber || '');
    return mt ? Math.max(m, parseInt(mt[1], 10) || 0) : m;
  }, 0);
  await Counter.updateOne(
    { _id: 'invoice_number' },
    { $max: { seq: Math.max(INVOICE_SEQ_START, highest) } },
    { upsert: true }
  );
  const counter = await Counter.findOneAndUpdate(
    { _id: 'invoice_number' },
    { $inc: { seq: 1 } },
    { new: true }
  );
  const words = String(customerName || '').trim().split(/\s+/);
  const abbrev = words[0] ? words[0].substring(0, 3).toUpperCase() : 'CUST';
  return `GRAE-INV-${abbrev}-${new Date().getFullYear()}-${String(counter.seq).padStart(3, '0')}`;
}

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
      // Only used the first time a client PO is invoiced from an uploaded
      // file with no existing PO record: the PO's full value, so a tracked
      // record can be created and partial invoices raised against it later.
      poTotalAmount
    } = req.body;
    let invoiceNumber = req.body.invoiceNumber;

    // items / paymentTermsBreakdown / paymentTermsInvoiced arrive as real
    // arrays on a plain JSON request, but as JSON *strings* when this request
    // is multipart/form-data (which it now is, since a PO/invoice file can be
    // attached). Handle both shapes.
    const parseJsonField = (raw, fallback) => {
      if (raw === undefined || raw === null || raw === '') return fallback;
      if (typeof raw !== 'string') return raw;
      try {
        return JSON.parse(raw);
      } catch (e) {
        console.warn('Failed to parse JSON field, using fallback:', e.message);
        return fallback;
      }
    };

    const items = parseJsonField(req.body.items, []);
    const paymentTermsBreakdown = parseJsonField(req.body.paymentTermsBreakdown, []);
    const paymentTermsInvoiced = parseJsonField(req.body.paymentTermsInvoiced, []);

    // Validate required fields
    if (!invoiceNumber) {
      return res.status(400).json({
        success: false,
        message: 'Invoice number is required'
      });
    }

    // ── Input validation ────────────────────────────────────────────────────
    // A new invoice is always a draft; the client cannot choose the status.
    const status = 'draft';
    const netNum = Number(totalAmount);
    const vatNum = Number(taxAmount === '' || taxAmount === null || taxAmount === undefined ? 0 : taxAmount);
    if (!Number.isFinite(netNum) || netNum <= 0) {
      return res.status(400).json({ success: false, message: 'Amount (excl. VAT) must be a number greater than zero' });
    }
    if (!Number.isFinite(vatNum) || vatNum < 0) {
      return res.status(400).json({ success: false, message: 'VAT must be a number that is zero or more' });
    }
    if (vatNum > netNum) {
      return res.status(400).json({ success: false, message: 'VAT cannot be larger than the amount before VAT' });
    }
    const invDateObj = new Date(invoiceDate);
    const dueDateObj = new Date(dueDate);
    if (!invoiceDate || isNaN(invDateObj.getTime()) || !dueDate || isNaN(dueDateObj.getTime())) {
      return res.status(400).json({ success: false, message: 'A valid invoice date and due date are required' });
    }
    if (dueDateObj < invDateObj) {
      return res.status(400).json({ success: false, message: 'Due date cannot be before the invoice date' });
    }
    if (Array.isArray(items) && items.some(it =>
      (it.quantity !== undefined && !(Number(it.quantity) >= 0)) ||
      (it.unitPrice !== undefined && !(Number(it.unitPrice) >= 0)))) {
      return res.status(400).json({ success: false, message: 'Item quantities and unit prices must be zero or more' });
    }

    // Check if invoice already exists
    const normalizedPoNumber = poNumber && poNumber !== 'N/A' ? poNumber.toUpperCase() : undefined;
    // Duplicate numbers are re-checked system-wide below, AFTER an auto-generated number has
    // been assigned (the number the client sends may be replaced by the server's counter).

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

    // Auto-generated numbers from the preparation screen are replaced by the server's counter
    if (INVOICE_NUMBER_PATTERN.test(String(invoiceNumber || '').trim())) {
      invoiceNumber = await nextInvoiceNumber(
        customer ? (customer.companyName || customer.tradingName || customer.name) : ''
      );
    }

    invoiceNumber = String(invoiceNumber).trim();
    const numberTaken = await Invoice.findOne({ invoiceNumber }).select('_id').lean();
    if (numberTaken) {
      return res.status(409).json({
        success: false,
        message: `Invoice number ${invoiceNumber} is already used by another invoice`
      });
    }

    // Get PO details for reference (if poId provided)
    let purchaseOrder = null;
    if (poId) {
      purchaseOrder = await PurchaseOrder.findById(poId);
    }

    // Files come in via upload.fields([{name:'invoiceFile'},{name:'poFile'}]),
    // so multer puts them on req.files (memoryStorage — buffer, no disk path).
    const invoiceFileUpload = req.files?.invoiceFile?.[0] || null;
    const poFileUpload = req.files?.poFile?.[0] || null;

    // Upload the invoice document itself, if provided
    let invoiceFileData = null;
    if (invoiceFileUpload) {
      try {
        console.log('📤 Uploading invoice file to Cloudinary...');
        const uploadResult = await saveFile(
          invoiceFileUpload,
          STORAGE_CATEGORIES.EMPLOYEE_INVOICES,
          `${normalizedPoNumber || 'NOPO'}-${invoiceNumber}-invoice`
        );

        invoiceFileData = {
          publicId: uploadResult.publicId,
          url: uploadResult.url,
          format: uploadResult.format,
          resourceType: uploadResult.resourceType,
          bytes: uploadResult.bytes,
          originalName: uploadResult.originalName
        };

        console.log('✅ Invoice file uploaded:', invoiceFileData.url);
      } catch (error) {
        console.error('❌ Invoice file upload error:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to upload invoice file'
        });
      }
    }

    // Upload the client's PO document — this is the file the client sent,
    // used as the basis for this invoice. Optional, but this is the whole
    // point of this endpoint when there's no system PO record to link to.
    let poFileData = null;
    if (poFileUpload) {
      try {
        console.log('📤 Uploading client PO file to Cloudinary...');
        const uploadResult = await saveFile(
          poFileUpload,
          STORAGE_CATEGORIES.EMPLOYEE_INVOICES,
          `${normalizedPoNumber || 'NOPO'}-${invoiceNumber}-clientPO`
        );

        poFileData = {
          publicId: uploadResult.publicId,
          url: uploadResult.url,
          format: uploadResult.format,
          resourceType: uploadResult.resourceType,
          bytes: uploadResult.bytes,
          originalName: uploadResult.originalName
        };

        console.log('✅ Client PO file uploaded:', poFileData.url);
      } catch (error) {
        console.error('❌ Client PO file upload error:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to upload client PO file'
        });
      }
    }

    // ── Partial invoicing: resolve/validate the tracked Customer PO ─────────
    // `poRecord` is the Customer.purchaseOrders subdocument this invoice is
    // drawn against, if any. Two ways to end up with one:
    //   1. Finance picked an existing (possibly already-partially-invoiced)
    //      customer PO — customerPOId is provided directly.
    //   2. Finance just uploaded a brand-new client PO file and also gave its
    //      total value (poTotalAmount) — we create the tracked record now,
    //      on the fly, so future partial invoices have something to track
    //      against. If poTotalAmount isn't given, we skip tracking entirely
    //      and just attach the file to this one invoice (old behaviour).
    let poRecord = null;
    let resolvedCustomerPOId = customerPOId || undefined;

    if (customer && customerPOId) {
      poRecord = customer.purchaseOrders.id(customerPOId);
      if (!poRecord) {
        return res.status(404).json({
          success: false,
          message: 'Selected customer PO was not found'
        });
      }
    } else if (customer && poTotalAmount) {
      const newPoNumber = normalizedPoNumber || (poReference ? poReference.toUpperCase() : `CPO-${Date.now()}`);
      poRecord = await customer.addPurchaseOrder({
        poNumber: newPoNumber,
        description: description || `Uploaded while preparing invoice ${invoiceNumber}`,
        amount: parseFloat(poTotalAmount),
        currency: 'XAF',
        poDate: invoiceDate ? new Date(invoiceDate) : new Date(),
        document: poFileData ? {
          name: poFileData.originalName,
          url: poFileData.url,
          publicId: poFileData.publicId,
          size: poFileData.bytes
        } : undefined,
        notes: 'Created automatically by Finance while preparing an invoice from an uploaded client PO.'
      }, req.user.userId);
      resolvedCustomerPOId = poRecord._id;
    }

    // If we have a tracked PO, make sure this invoice doesn't push its
    // invoiced total past what the PO is actually worth, and that the PO
    // hasn't been closed to further invoicing.
    if (poRecord) {
      if (poRecord.invoicingClosed) {
        return res.status(400).json({
          success: false,
          message: `PO ${poRecord.poNumber} has been closed to further invoicing` +
            (poRecord.closedReason ? ` (${poRecord.closedReason})` : '') + '.'
        });
      }

      const alreadyInvoiced = poRecord.invoicedAmount || 0;
      const remaining = Math.round(((poRecord.amount || 0) - alreadyInvoiced) * 100) / 100;
      const requested = Number(totalAmount) || 0;

      if (requested - remaining > 0.5) {
        return res.status(400).json({
          success: false,
          message: `This amount exceeds the remaining balance on PO ${poRecord.poNumber}. ` +
            `PO total: ${(poRecord.amount || 0).toLocaleString()} XAF, already invoiced: ` +
            `${alreadyInvoiced.toLocaleString()} XAF, remaining: ${remaining.toLocaleString()} XAF.`
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
      customerPOId: resolvedCustomerPOId,
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
      totalAmount: netNum,
      taxAmount: vatNum,
      // Final amount = amount before VAT + VAT (net plus VAT, never net minus VAT)
      netAmount: netNum + vatNum,
      description,
      paymentTerms,
      status, // always 'draft' on creation; submitInvoiceForApproval moves it forward
      items,
      paymentTermsBreakdown,
      paymentTermsInvoiced,
      invoiceFile: invoiceFileData,
      poFile: poFileData,
      createdBy: req.user.userId,
      createdByDetails: {
        name: financeUser.fullName,
        email: financeUser.email,
        department: financeUser.department,
        role: 'finance'
      },
      // The real approval chain (named approvers) is built when the invoice is submitted
      approvalChain: [],
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

    // Update the tracked customer PO's running invoiced total, now that the
    // invoice itself has actually been saved successfully.
    let poBalance = null;
    if (poRecord && customer) {
      try {
        await customer.recordInvoicing(resolvedCustomerPOId, netNum);
        const updatedPo = customer.purchaseOrders.id(resolvedCustomerPOId);
        poBalance = {
          poTotal: updatedPo.amount,
          invoicedSoFar: updatedPo.invoicedAmount,
          remaining: Math.round(((updatedPo.amount || 0) - (updatedPo.invoicedAmount || 0)) * 100) / 100,
          invoicingStatus: updatedPo.invoicingStatus
        };
      } catch (trackingError) {
        // The invoice already saved successfully — don't fail the request
        // over a tracking update, just surface it loudly in the logs.
        console.error('⚠️  Invoice saved, but failed to update PO invoiced total:', trackingError.message);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Invoice prepared successfully',
      data: {
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        poNumber: invoice.poNumber,
        customerPOId: resolvedCustomerPOId,
        status: invoice.status,
        totalAmount: invoice.totalAmount,
        createdDate: invoice.createdAt,
        poBalance
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
    } else {
      query.status = { $ne: 'voided' };
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
      .populate('customer', 'companyName tradingName primaryEmail primaryPhone address billingAddress taxIdNumber businessRegistrationNumber')
      .populate('employee', 'fullName email');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    const customer = invoice.customer || {};

    // Address block for the PDF: use the billing address when it differs from
    // the physical one, otherwise the physical address.
    const addr = (customer.billingAddress && customer.billingAddress.street && customer.billingAddress.sameAsPhysical === false)
      ? customer.billingAddress
      : (customer.address || {});
    const addressLines = [];
    if (addr.street) String(addr.street).split(/\r?\n/).forEach(l => l.trim() && addressLines.push(l.trim()));
    if (addr.city) addressLines.push(addr.city);
    if (addr.state && addr.state !== addr.city) addressLines.push(addr.state);
    if (addr.country) addressLines.push(addr.country);

    // If this invoice was drawn against a tracked customer PO, pull its
    // current balance so the PDF can show "partial invoice, X of Y" context
    // instead of looking like a standalone, full-value invoice.
    let poBalance = null;
    if (invoice.customerPOId && invoice.customer) {
      try {
        const custDoc = await Customer.findById(invoice.customer).select('purchaseOrders');
        const po = custDoc?.purchaseOrders?.id(invoice.customerPOId);
        if (po) {
          poBalance = {
            poNumber: po.poNumber,
            poTotal: po.amount,
            invoicedSoFar: po.invoicedAmount || 0,
            remaining: Math.round(((po.amount || 0) - (po.invoicedAmount || 0)) * 100) / 100,
            invoicingStatus: po.invoicingStatus || 'not_invoiced'
          };
        }
      } catch (err) {
        console.warn('Could not load PO balance for invoice PDF:', err.message);
      }
    }

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
      customerDetails: {
        name: invoice.customerDetails?.name || customer.companyName || customer.tradingName,
        email: invoice.customerDetails?.email || customer.primaryEmail,
        phone: invoice.customerDetails?.phone || customer.primaryPhone,
        addressLines,
        taxId: customer.taxIdNumber,
        registrationNumber: customer.businessRegistrationNumber
      },
      poBalance
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

    // Build the real approval chain (named approvers) from the department structure.
    // The department comes from the request, else the invoice, else the preparer's own.
    const department = req.body?.department || invoice.assignedDepartment || invoice.createdByDetails?.department;
    if (!department) {
      return res.status(400).json({
        success: false,
        message: 'A department is required to build the approval chain'
      });
    }

    invoice.assignToDepartment(department, req.user.userId);   // sets pending_department_approval + chain
    if (!invoice.approvalChain || invoice.approvalChain.length === 0) {
      return res.status(400).json({
        success: false,
        message: `No approval chain could be built for department "${department}"`
      });
    }
    invoice.status = 'pending_approval';
    invoice.submittedDate = new Date();
    invoice.submittedBy = req.user.userId;

    await invoice.save();

    // The first approver is notified by the invoice's post-save hook.

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

    // Can only remove draft invoices
    if (invoice.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Only draft invoices can be removed'
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

    // Give back the tracked balance on the customer PO this invoice was
    // drawn against, so deleting a draft doesn't leave the PO permanently
    // showing money that was never actually invoiced.
    if (invoice.customerPOId && invoice.customer) {
      try {
        const cust = await Customer.findById(invoice.customer);
        if (cust) {
          await cust.reverseInvoicing(invoice.customerPOId, invoice.totalAmount || 0);
        }
      } catch (err) {
        console.warn('Failed to reverse PO invoiced total on delete:', err.message);
      }
    }

    // Void rather than delete: the invoice number stays on record (no reuse, no silent gap)
    invoice.status = 'voided';
    invoice.voidedAt = new Date();
    invoice.voidedBy = req.user.userId;
    invoice.voidReason = (req.body && req.body.reason) || 'Draft removed by finance';
    await invoice.save();

    res.json({
      success: true,
      message: `Draft voided. Invoice number ${invoice.invoiceNumber} stays on record and will not be reused.`
    });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete invoice'
    });
  }
};

/**
 * Get every invoice raised against a given customer PO, plus the PO's
 * current balance — used by the "invoicing history" view so Finance can see
 * what's already been billed and what's left before raising another partial
 * invoice.
 */
exports.getInvoicesForCustomerPO = async (req, res) => {
  try {
    const { customerPOId } = req.params;
    const { customerId } = req.query;

    const invoices = await Invoice.find({ customerPOId, status: { $ne: 'voided' } })
      .select('invoiceNumber totalAmount taxAmount netAmount status approvalStatus invoiceDate dueDate createdAt createdByDetails')
      .sort({ createdAt: -1 });

    let poBalance = null;
    if (customerId) {
      const customer = await Customer.findById(customerId).select('purchaseOrders');
      const po = customer?.purchaseOrders?.id(customerPOId);
      if (po) {
        poBalance = {
          poNumber: po.poNumber,
          poTotal: po.amount,
          invoicedSoFar: po.invoicedAmount || 0,
          remaining: Math.round(((po.amount || 0) - (po.invoicedAmount || 0)) * 100) / 100,
          invoicingStatus: po.invoicingStatus || 'not_invoiced'
        };
      }
    }

    res.json({
      success: true,
      data: invoices,
      poBalance
    });
  } catch (error) {
    console.error('Error fetching invoices for PO:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoices for this PO'
    });
  }
};

// (Approval chains are built by Invoice.assignToDepartment; approver e-mails by Invoice.notifyCurrentApprover.)

module.exports = exports;

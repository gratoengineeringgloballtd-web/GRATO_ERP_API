const DebitNote = require('../models/DebitNote');
const PurchaseOrder = require('../models/PurchaseOrder');
const Supplier = require('../models/Supplier');
const User = require('../models/User');
const pdfService = require('../services/pdfService');
const { sendEmail } = require('../services/emailService');

// Create debit note
exports.createDebitNote = async (req, res) => {
  try {
    const {
      purchaseOrderId,
      reason,
      description,
      debitAmount
    } = req.body;

    // Validate PO exists
    const po = await PurchaseOrder.findById(purchaseOrderId)
      .populate('supplierId', 'name email phone address');

    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }

    // Get department for approval chain
    const user = await User.findById(req.user.userId);
    const { getDebitNoteApprovalChain } = require('../config/debitNoteApprovalChain');
    const approvalChain = getDebitNoteApprovalChain(user.department);

    // Create debit note
    const debitNote = new DebitNote({
      purchaseOrderId: po._id,
      supplierId: po.supplierId._id,
      createdBy: req.user.userId,
      reason,
      description,
      originalAmount: po.totalAmount,
      debitAmount,
      currency: po.currency,
      status: 'pending_approval',
      approvalChain: approvalChain.map(step => ({
        level: step.level,
        approver: {
          name: step.approver,
          email: step.email,
          role: step.role,
          department: step.department
        },
        status: 'pending',
        activatedDate: step.level === 1 ? new Date() : null
      })),
      currentApprovalLevel: 1,
      supplierDetails: {
        name: po.supplierId.name,
        email: po.supplierId.email,
        phone: po.supplierId.phone,
        address: typeof po.supplierId.address === 'object' 
          ? `${po.supplierId.address.street || ''}, ${po.supplierId.address.city || ''}` 
          : po.supplierId.address
      },
      poNumber: po.poNumber
    });

    await debitNote.save();

    // Add activity
    await debitNote.addActivity(
      'created',
      `Debit note created against PO ${po.poNumber}`,
      user.fullName
    );

    res.json({
      success: true,
      message: 'Debit note created successfully and sent for approval',
      data: {
        debitNote: {
          id: debitNote._id,
          debitNoteNumber: debitNote.debitNoteNumber,
          status: debitNote.status,
          debitAmount: debitNote.debitAmount
        }
      }
    });

  } catch (error) {
    console.error('Create debit note error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create debit note',
      error: error.message
    });
  }
};

// Get debit notes
exports.getDebitNotes = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    let query = {};

    if (status) {
      query.status = status;
    }

    const debitNotes = await DebitNote.find(query)
      .populate('purchaseOrderId', 'poNumber totalAmount')
      .populate('supplierId', 'name email')
      .populate('createdBy', 'fullName')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await DebitNote.countDocuments(query);

    res.json({
      success: true,
      data: debitNotes,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: debitNotes.length,
        totalRecords: total
      }
    });

  } catch (error) {
    console.error('Get debit notes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch debit notes',
      error: error.message
    });
  }
};

// Get debit note details
exports.getDebitNoteDetails = async (req, res) => {
  try {
    const { debitNoteId } = req.params;

    const debitNote = await DebitNote.findById(debitNoteId)
      .populate('purchaseOrderId', 'poNumber totalAmount items')
      .populate('supplierId', 'name email phone address')
      .populate('createdBy', 'fullName email')
      .populate('approvalChain.approver.userId', 'fullName');

    if (!debitNote) {
      return res.status(404).json({
        success: false,
        message: 'Debit note not found'
      });
    }

    res.json({
      success: true,
      data: { debitNote }
    });

  } catch (error) {
    console.error('Get debit note details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch debit note details',
      error: error.message
    });
  }
};

// Process approval
exports.processDebitNoteApproval = async (req, res) => {
  try {
    const { debitNoteId } = req.params;
    const { decision, comments } = req.body;

    const debitNote = await DebitNote.findById(debitNoteId)
      .populate('purchaseOrderId', 'poNumber')
      .populate('supplierId', 'name email');

    if (!debitNote) {
      return res.status(404).json({
        success: false,
        message: 'Debit note not found'
      });
    }

    // Find current approval step
    const currentStep = debitNote.approvalChain.find(step => 
      step.level === debitNote.currentApprovalLevel && 
      step.approver.email === req.user.email &&
      step.status === 'pending'
    );

    if (!currentStep) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to approve at this level'
      });
    }

    // Update approval step
    currentStep.status = decision === 'approved' ? 'approved' : 'rejected';
    currentStep.decision = decision;
    currentStep.comments = comments;
    currentStep.actionDate = new Date();
    currentStep.actionTime = new Date().toTimeString().split(' ')[0];
    currentStep.approver.userId = req.user.userId;

    const user = await User.findById(req.user.userId);

    if (decision === 'rejected') {
      debitNote.status = 'rejected';
      debitNote.currentApprovalLevel = 0;
      
      await debitNote.addActivity(
        'rejected',
        `Rejected at Level ${currentStep.level} by ${user.fullName}`,
        user.fullName
      );
    } else {
      // Move to next level
      const nextLevel = debitNote.currentApprovalLevel + 1;
      const nextStep = debitNote.approvalChain.find(step => step.level === nextLevel);
      
      if (nextStep) {
        debitNote.currentApprovalLevel = nextLevel;
        nextStep.activatedDate = new Date();
        nextStep.notificationSent = false;
        
        await debitNote.addActivity(
          'approved',
          `Approved at Level ${currentStep.level} by ${user.fullName}, moved to Level ${nextLevel}`,
          user.fullName
        );
      } else {
        // All approvals complete
        debitNote.status = 'approved';
        debitNote.approvalDate = new Date();
        debitNote.currentApprovalLevel = 0;
        
        await debitNote.addActivity(
          'approved',
          `Final approval by ${user.fullName}`,
          user.fullName
        );

        // Send to supplier
        await sendDebitNoteToSupplier(debitNote);
      }
    }

    await debitNote.save();

    res.json({
      success: true,
      message: `Debit note ${decision === 'approved' ? 'approved' : 'rejected'} successfully`,
      data: {
        debitNote: {
          id: debitNote._id,
          debitNoteNumber: debitNote.debitNoteNumber,
          status: debitNote.status,
          currentApprovalLevel: debitNote.currentApprovalLevel
        }
      }
    });

  } catch (error) {
    console.error('Process debit note approval error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process approval',
      error: error.message
    });
  }
};

// Send to supplier (internal function)
async function sendDebitNoteToSupplier(debitNote) {
  try {
    const pdfData = {
      debitNoteNumber: debitNote.debitNoteNumber,
      poNumber: debitNote.poNumber,
      supplierDetails: debitNote.supplierDetails,
      reason: debitNote.reason,
      description: debitNote.description,
      originalAmount: debitNote.originalAmount,
      debitAmount: debitNote.debitAmount,
      currency: debitNote.currency,
      status: debitNote.status,
      createdAt: debitNote.createdAt,
      approvalChain: debitNote.approvalChain
    };

    const pdfResult = await pdfService.generateDebitNotePDF(pdfData);

    if (pdfResult.success) {
      await sendEmail({
        to: debitNote.supplierDetails.email,
        subject: `Debit Note ${debitNote.debitNoteNumber} - Action Required`,
        html: `
          <div style="font-family: Arial, sans-serif;">
            <h2>Debit Note Notification</h2>
            <p>Dear ${debitNote.supplierDetails.name},</p>
            <p>Please find attached a debit note issued against Purchase Order ${debitNote.poNumber}.</p>
            
            <div style="background-color: #fff2f0; padding: 15px; margin: 20px 0; border-left: 4px solid #f5222d;">
              <h3>Debit Details</h3>
              <p><strong>Debit Note Number:</strong> ${debitNote.debitNoteNumber}</p>
              <p><strong>Reason:</strong> ${debitNote.reason}</p>
              <p><strong>Debit Amount:</strong> ${debitNote.currency} ${debitNote.debitAmount.toLocaleString()}</p>
            </div>

            <p>Please review and acknowledge receipt of this debit note.</p>
            <p>Best regards,<br>GRATO ENGINEERING GLOBAL LTD</p>
          </div>
        `,
        attachments: [{
          filename: pdfResult.filename,
          content: pdfResult.buffer,
          contentType: 'application/pdf'
        }]
      });

      debitNote.status = 'sent_to_supplier';
      debitNote.sentDate = new Date();
      await debitNote.save();
    }
  } catch (error) {
    console.error('Error sending debit note to supplier:', error);
  }
}

// Download debit note PDF
exports.downloadDebitNotePDF = async (req, res) => {
  try {
    const { debitNoteId } = req.params;

    const debitNote = await DebitNote.findById(debitNoteId)
      .populate('purchaseOrderId', 'poNumber totalAmount')
      .populate('supplierId', 'name email phone address');

    if (!debitNote) {
      return res.status(404).json({
        success: false,
        message: 'Debit note not found'
      });
    }

    const pdfData = {
      debitNoteNumber: debitNote.debitNoteNumber,
      poNumber: debitNote.purchaseOrderId?.poNumber,
      supplierDetails: {
        name: debitNote.supplierId?.name,
        email: debitNote.supplierId?.email,
        phone: debitNote.supplierId?.phone,
        address: typeof debitNote.supplierId?.address === 'object'
          ? `${debitNote.supplierId.address.street || ''}, ${debitNote.supplierId.address.city || ''}`
          : debitNote.supplierId?.address
      },
      reason: debitNote.reason,
      description: debitNote.description,
      originalAmount: debitNote.originalAmount,
      debitAmount: debitNote.debitAmount,
      currency: debitNote.currency,
      status: debitNote.status,
      createdAt: debitNote.createdAt,
      approvalChain: debitNote.approvalChain
    };

    const pdfResult = await pdfService.generateDebitNotePDF(pdfData);

    if (!pdfResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate PDF'
      });
    }

    const filename = `Debit_Note_${debitNote.debitNoteNumber}_${Date.now()}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfResult.buffer.length);

    res.send(pdfResult.buffer);

  } catch (error) {
    console.error('Download debit note PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate PDF',
      error: error.message
    });
  }
};

// Supplier acknowledge debit note
exports.supplierAcknowledgeDebitNote = async (req, res) => {
  try {
    const { debitNoteId } = req.params;
    const { comments } = req.body;

    const debitNote = await DebitNote.findById(debitNoteId);

    if (!debitNote) {
      return res.status(404).json({
        success: false,
        message: 'Debit note not found'
      });
    }

    debitNote.supplierAcknowledgment = {
      acknowledged: true,
      acknowledgedBy: req.user.fullName || req.user.email,
      acknowledgedDate: new Date(),
      comments
    };

    debitNote.status = 'acknowledged';
    debitNote.acknowledgedDate = new Date();

    await debitNote.addActivity(
      'acknowledged',
      'Debit note acknowledged by supplier',
      req.user.fullName
    );

    await debitNote.save();

    res.json({
      success: true,
      message: 'Debit note acknowledged successfully',
      data: { debitNote }
    });

  } catch (error) {
    console.error('Acknowledge debit note error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to acknowledge debit note',
      error: error.message
    });
  }
};

module.exports = exports;
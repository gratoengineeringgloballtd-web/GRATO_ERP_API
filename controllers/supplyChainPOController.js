// controllers/supplyChainPOController.js

const PurchaseOrder = require('../models/PurchaseOrder');
const User = require('../models/User');
const { sendEmail } = require('../services/emailService');
const pdfService = require('../services/pdfService');
const { buildPurchaseOrderPdfData } = require('../services/purchaseOrderPdfData');
const { 
  saveFile, 
  STORAGE_CATEGORIES 
} = require('../utils/localFileStorage');

/**
 * Get POs pending Supply Chain assignment
 */
exports.getSupplyChainPendingPOs = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    
    const filter = { status: 'pending_supply_chain_assignment' };
    const skip = (page - 1) * limit;
    
    const pos = await PurchaseOrder.find(filter)
      .populate('buyerId', 'fullName email')
      .populate('supplierId', 'name email phone')
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await PurchaseOrder.countDocuments(filter);
    
    res.json({
      success: true,
      data: pos,
      pagination: {
        current: parseInt(page),
        pageSize: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('Error fetching pending POs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending POs'
    });
  }
};

/**
 * Download PO for signing
 */
exports.downloadPOForSigning = async (req, res) => {
  try {
    const { poId } = req.params;
    
    const po = await PurchaseOrder.findById(poId)
      .populate('supplierId', 'name email');
    
    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }
    
    // Determine which document to download
    let documentToDownload = null;
    
    if (po.currentApprovalLevel === 0 || !po.approvalChain) {
      // Supply Chain level - use original
      documentToDownload = { url: `/api/buyer/purchase-orders/${poId}/download-pdf` };
    } else {
      // Find previous signed document
      const previousLevel = po.currentApprovalLevel - 1;
      
      if (previousLevel === 0) {
        documentToDownload = po.supplyChainReview?.signedDocument;
      } else {
        const previousStep = po.approvalChain.find(step => step.level === previousLevel);
        documentToDownload = previousStep?.signedDocument;
      }
    }
    
    if (!documentToDownload || !documentToDownload.url) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    // Mark as downloaded
    if (po.currentApprovalLevel > 0) {
      const currentStep = po.getCurrentApprover();
      if (currentStep && currentStep.approver.email === req.user.email) {
        currentStep.documentDownloaded = true;
        currentStep.downloadedAt = new Date();
        await po.save();
      }
    }
    
    res.json({
      success: true,
      data: {
        url: documentToDownload.url,
        originalName: documentToDownload.originalName,
        format: documentToDownload.format,
        fileName: `PO_${po.poNumber}_${po.currentApprovalLevel > 0 ? `Level_${po.currentApprovalLevel - 1}_Signed` : 'Original'}.pdf`
      }
    });
    
  } catch (error) {
    console.error('Error downloading PO:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download PO'
    });
  }
};

/**
 * Assign PO with auto-signed document (Supply Chain)
 */
exports.assignPOToDepartment = async (req, res) => {
  try {
    console.log('=== SUPPLY CHAIN ASSIGNING PO WITH AUTO SIGNATURE ===');
    const { poId } = req.params;
    const { department, comments } = req.body;
    
    if (!department) {
      return res.status(400).json({
        success: false,
        message: 'Department is required'
      });
    }
    
    const po = await PurchaseOrder.findById(poId)
      .populate('buyerId', 'fullName email')
      .populate('supplierId', 'name email');
    
    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }
    
    if (po.status !== 'pending_supply_chain_assignment') {
      return res.status(400).json({
        success: false,
        message: 'PO has already been assigned'
      });
    }
    
    const supplyChainUser = await User.findById(req.user.userId).select('fullName signature email');
    const reviewDate = new Date();

    const signatureBlocks = [
      {
        label: 'Supply Chain',
        signatureUrl: supplyChainUser?.signature?.url || null,
        signedAt: reviewDate
      },
      { label: 'Department Head' },
      { label: 'Head of Business' },
      { label: 'Finance' }
    ];

    const pdfData = {
      ...buildPurchaseOrderPdfData(po),
      signatures: signatureBlocks
    };

    const pdfResult = await pdfService.generatePurchaseOrderPDF(pdfData);
    if (!pdfResult.success) {
      throw new Error(pdfResult.error || 'Failed to generate signed document');
    }

    const signedDocData = await saveFile(
      {
        buffer: pdfResult.buffer,
        originalname: `PO-${po.poNumber}-SC-signed.pdf`,
        mimetype: 'application/pdf',
        size: pdfResult.buffer.length
      },
      STORAGE_CATEGORIES.SIGNED_DOCUMENTS,
      'supply-chain',
      `PO-${po.poNumber}-SC-signed-${Date.now()}.pdf`
    );
    
    // Assign PO
    po.assignBySupplyChain(department, req.user.userId, comments);
    po.supplyChainReview.signedDocument = signedDocData;
    po.supplyChainReview.reviewDate = reviewDate;
    po.supplyChainReview.reviewTime = reviewDate.toTimeString().split(' ')[0];
    await po.save();
    
    // Notify first approver
    const firstApprover = po.getCurrentApprover();
    if (firstApprover) {
      await sendEmail({
        to: firstApprover.approver.email,
        subject: `Purchase Order Approval Required - ${po.poNumber}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px;">
              <h3>PO Approval Required</h3>
              <p>Dear ${firstApprover.approver.name},</p>
              <p>Purchase order ${po.poNumber} has been assigned to your department for approval.</p>
              
              <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0;">
                <p><strong>PO Number:</strong> ${po.poNumber}</p>
                <p><strong>Supplier:</strong> ${po.supplierDetails?.name || po.supplierName}</p>
                <p><strong>Amount:</strong> ${po.currency} ${po.totalAmount.toLocaleString()}</p>
                <p><strong>Department:</strong> ${po.assignedDepartment}</p>
              </div>
              
              <div style="background-color: #e6f7ff; padding: 15px; border-radius: 5px;">
                <p><strong>Document Signature:</strong></p>
                <p>Supply Chain has signed this PO. Your approval will automatically add your signature.</p>
              </div>
              
              <p style="text-align: center; margin: 20px 0;">
                <a href="${process.env.CLIENT_URL}/supervisor/po-approvals" 
                   style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
                  Review & Sign PO
                </a>
              </p>
            </div>
          </div>
        `
      }).catch(error => {
        console.error('Failed to notify approver:', error);
      });
    }
    
    console.log('=== PO ASSIGNMENT COMPLETED ===');
    
    res.json({
      success: true,
      message: 'PO assigned successfully with auto-signed document',
      data: {
        ...po.toObject(),
        currentApprover: po.getCurrentApprover(),
        approvalProgress: po.approvalProgress
      }
    });
    
  } catch (error) {
    console.error('=== PO ASSIGNMENT FAILED ===', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to assign PO'
    });
  }
};

/**
 * Reject PO (Supply Chain)
 */
exports.rejectPO = async (req, res) => {
  try {
    const { poId } = req.params;
    const { rejectionReason } = req.body;
    
    if (!rejectionReason || !rejectionReason.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }
    
    const po = await PurchaseOrder.findById(poId)
      .populate('buyerId', 'fullName email')
      .populate('supplierId', 'name email');
    
    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }
    
    if (po.status !== 'pending_supply_chain_assignment') {
      return res.status(400).json({
        success: false,
        message: 'PO can only be rejected at supply chain assignment stage'
      });
    }
    
    po.rejectBySupplyChain(req.user.userId, rejectionReason);
    await po.save();
    
    // Notify buyer
    if (po.buyerId && po.buyerId.email) {
      await sendEmail({
        to: po.buyerId.email,
        subject: `Purchase Order Rejected - ${po.poNumber}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #fff2f0; padding: 20px; border-radius: 8px;">
              <h3 style="color: #ff4d4f;">Purchase Order Rejected</h3>
              <p>Dear ${po.buyerId.fullName},</p>
              <p>Your purchase order has been rejected by Supply Chain.</p>
              
              <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0;">
                <p><strong>PO Number:</strong> ${po.poNumber}</p>
                <p><strong>Rejection Reason:</strong></p>
                <p style="color: #ff4d4f;">"${rejectionReason}"</p>
              </div>
              
              <p>Please review and make necessary corrections before resubmitting.</p>
            </div>
          </div>
        `
      }).catch(error => {
        console.error('Failed to notify buyer:', error);
      });
    }
    
    res.json({
      success: true,
      message: 'PO rejected successfully',
      data: po
    });
    
  } catch (error) {
    console.error('PO rejection error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to reject PO'
    });
  }
};

/**
 * Get Supply Chain dashboard stats
 */
exports.getSupplyChainPOStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const stats = {
      pendingAssignment: await PurchaseOrder.countDocuments({ 
        status: 'pending_supply_chain_assignment' 
      }),
      assignedToday: await PurchaseOrder.countDocuments({
        'supplyChainReview.action': 'assigned',
        'supplyChainReview.reviewDate': { $gte: today }
      }),
      rejectedToday: await PurchaseOrder.countDocuments({
        'supplyChainReview.action': 'rejected',
        'supplyChainReview.reviewDate': { $gte: today }
      }),
      inApprovalChain: await PurchaseOrder.countDocuments({
        status: {
          $in: [
            'pending_department_approval',
            'pending_head_of_business_approval',
            'pending_finance_approval'
          ]
        }
      })
    };
    
    res.json({
      success: true,
      data: stats
    });
    
  } catch (error) {
    console.error('Error fetching SC stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics'
    });
  }
};

module.exports = {
  getSupplyChainPendingPOs,
  downloadPOForSigning,
  assignPOToDepartment,
  rejectPO,
  getSupplyChainPOStats
};
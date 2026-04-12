const PurchaseRequisition = require('../models/PurchaseRequisition');
const User = require('../models/User');
const pdfService = require('../services/pdfService');
const { sendEmail } = require('../services/emailService');

/**
 * Get all petty cash forms for buyer dashboard
 */
const getBuyerPettyCashForms = async (req, res) => {
  try {
    const buyerId = req.user.userId;
    
    console.log('=== GET BUYER PETTY CASH FORMS ===');
    console.log('Buyer ID:', buyerId);
    
    // Find all requisitions where:
    // 1. Buyer is assigned
    // 2. Payment method is cash
    // 3. Petty cash form is generated
    const requisitions = await PurchaseRequisition.find({
      'supplyChainReview.assignedBuyer': buyerId,
      'supplyChainReview.paymentMethod': 'cash',
      'pettyCashForm.generated': true
    })
    .populate('employee', 'fullName email department')
    .populate('supplyChainReview.assignedBuyer', 'fullName email')
    .sort({ 'pettyCashForm.generatedDate': -1 });
    
    console.log(`Found ${requisitions.length} petty cash forms`);
    
    // Transform data for frontend
    const pettyCashForms = requisitions.map(req => ({
      id: req._id,
      requisitionNumber: req.requisitionNumber,
      pettyCashFormNumber: req.pettyCashForm.formNumber,
      title: req.title,
      employee: {
        name: req.employee.fullName,
        email: req.employee.email,
        department: req.employee.department
      },
      amountRequested: req.budgetXAF,
      generatedDate: req.pettyCashForm.generatedDate,
      downloadedCount: req.pettyCashForm.downloadedBy?.length || 0,
      lastDownloadDate: req.pettyCashForm.downloadedBy?.length > 0 ? 
        req.pettyCashForm.downloadedBy[req.pettyCashForm.downloadedBy.length - 1].downloadDate : null,
      status: req.pettyCashForm.status,
      urgency: req.urgency,
      itemCategory: req.itemCategory,
      items: req.items
    }));
    
    res.json({
      success: true,
      data: pettyCashForms,
      count: pettyCashForms.length
    });
    
  } catch (error) {
    console.error('Error fetching buyer petty cash forms:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch petty cash forms',
      error: error.message
    });
  }
};

/**
 * Get petty cash form details
 */
const getPettyCashFormDetails = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const buyerId = req.user.userId;
    
    console.log('=== GET PETTY CASH FORM DETAILS ===');
    console.log('Requisition ID:', requisitionId);
    console.log('Buyer ID:', buyerId);
    
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department phone')
      .populate('supplyChainReview.assignedBuyer', 'fullName email')
      .populate('approvalChain.decidedBy', 'fullName email role')
      .populate('financeVerification.verifiedBy', 'fullName email')
      .populate('disbursements.disbursedBy', 'fullName email')
      .populate('disbursements.acknowledgedBy', 'fullName email signature');
    
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }
    
    // Verify buyer is assigned to this requisition
    if (requisition.supplyChainReview.assignedBuyer._id.toString() !== buyerId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to access this petty cash form'
      });
    }
    
    // Verify petty cash form exists
    if (!requisition.pettyCashForm?.generated) {
      return res.status(404).json({
        success: false,
        message: 'Petty cash form not generated for this requisition'
      });
    }
    
    // Return complete details
    res.json({
      success: true,
      data: {
        requisition: {
          id: requisition._id,
          requisitionNumber: requisition.requisitionNumber,
          title: requisition.title,
          department: requisition.department,
          itemCategory: requisition.itemCategory,
          urgency: requisition.urgency,
          budgetXAF: requisition.budgetXAF,
          deliveryLocation: requisition.deliveryLocation,
          expectedDate: requisition.expectedDate,
          justificationOfPurchase: requisition.justificationOfPurchase,
          items: requisition.items,
          status: requisition.status
        },
        employee: {
          name: requisition.employee.fullName,
          email: requisition.employee.email,
          department: requisition.employee.department,
          phone: requisition.employee.phone
        },
        pettyCashForm: {
          formNumber: requisition.pettyCashForm.formNumber,
          generatedDate: requisition.pettyCashForm.generatedDate,
          status: requisition.pettyCashForm.status,
          downloadedCount: requisition.pettyCashForm.downloadedBy?.length || 0,
          downloadHistory: requisition.pettyCashForm.downloadedBy
        },
        approvalChain: requisition.approvalChain.map(step => ({
          level: step.level,
          approver: step.approver,
          status: step.status,
          comments: step.comments,
          actionDate: step.actionDate,
          actionTime: step.actionTime
        })),
        financeVerification: {
          budgetAvailable: requisition.financeVerification.budgetAvailable,
          assignedBudget: requisition.financeVerification.assignedBudget,
          budgetCode: requisition.financeVerification.budgetCode,
          comments: requisition.financeVerification.comments,
          verifiedBy: requisition.financeVerification.verifiedBy?.fullName,
          verificationDate: requisition.financeVerification.verificationDate
        },
        paymentMethod: requisition.supplyChainReview.paymentMethod
      }
    });
    
  } catch (error) {
    console.error('Error fetching petty cash form details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch petty cash form details',
      error: error.message
    });
  }
};

/**
 * Download petty cash form as PDF
 */
const downloadPettyCashFormPDF = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const buyerId = req.user.userId;
    const ipAddress = req.ip || req.connection.remoteAddress;
    
    console.log('=== DOWNLOAD PETTY CASH FORM PDF ===');
    console.log('Requisition ID:', requisitionId);
    console.log('Buyer ID:', buyerId);
    
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department phone')
      .populate('supplyChainReview.assignedBuyer', 'fullName email')
      .populate('approvalChain.decidedBy', 'fullName email role')
      .populate('financeVerification.verifiedBy', 'fullName email');
    
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }
    
    // Verify buyer is assigned
    if (requisition.supplyChainReview.assignedBuyer._id.toString() !== buyerId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to download this form'
      });
    }
    
    // Verify petty cash form exists
    if (!requisition.pettyCashForm?.generated) {
      return res.status(404).json({
        success: false,
        message: 'Petty cash form not generated for this requisition'
      });
    }
    
    // Prepare data for PDF generation
    const mappedDisbursements = Array.isArray(requisition.disbursements) && requisition.disbursements.length > 0
      ? requisition.disbursements.map((disbursement, index) => ({
          disbursementNumber: disbursement.disbursementNumber || index + 1,
          date: disbursement.date,
          amount: disbursement.amount,
          notes: disbursement.notes,
          disbursedBy: disbursement.disbursedBy,
          acknowledged: disbursement.acknowledged || false,
          acknowledgedBy: disbursement.acknowledgedBy,
          acknowledgmentDate: disbursement.acknowledgmentDate,
          acknowledgmentNotes: disbursement.acknowledgmentNotes
        }))
      : [];

    const pdfData = {
      _id: requisition._id,
      displayId: requisition.pettyCashForm.formNumber,
      requisitionNumber: requisition.requisitionNumber,
      title: requisition.title,
      department: requisition.department,
      itemCategory: requisition.itemCategory,
      urgency: requisition.urgency,
      amountRequested: requisition.budgetXAF,
      deliveryLocation: requisition.deliveryLocation,
      expectedDate: requisition.expectedDate,
      purpose: requisition.justificationOfPurchase,
      businessJustification: requisition.justificationOfPurchase,
      items: requisition.items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        measuringUnit: item.measuringUnit,
        estimatedPrice: item.estimatedPrice,
        totalPrice: item.quantity * (item.estimatedPrice || 0)
      })),
      employee: {
        fullName: requisition.employee.fullName,
        email: requisition.employee.email,
        department: requisition.employee.department,
        phone: requisition.employee.phone
      },
      status: 'approved', // Always approved for petty cash forms
      createdAt: requisition.pettyCashForm.generatedDate,
      approvalChain: requisition.approvalChain.map(step => ({
        level: step.level,
        approver: {
          name: step.approver.name,
          email: step.approver.email,
          role: step.approver.role,
          department: step.approver.department
        },
        status: step.status,
        comments: step.comments,
        actionDate: step.actionDate,
        actionTime: step.actionTime
      })),
      financeVerification: {
        budgetAvailable: requisition.financeVerification.budgetAvailable,
        assignedBudget: requisition.financeVerification.assignedBudget,
        budgetCode: requisition.financeVerification.budgetCode,
        comments: requisition.financeVerification.comments
      },
      disbursementDetails: {
        amount: requisition.financeVerification.assignedBudget || requisition.budgetXAF,
        date: requisition.pettyCashForm.generatedDate
      },
      disbursements: mappedDisbursements,
      requestType: 'petty-cash',
      paymentMethod: 'cash'
    };
    
    console.log('Generating PDF for petty cash form:', pdfData.displayId);
    
    // Generate PDF using the same format as cash request
    const pdfResult = await pdfService.generatePettyCashFormPDF(pdfData);
    
    if (!pdfResult.success) {
      console.error('PDF generation failed:', pdfResult.error);
      return res.status(500).json({
        success: false,
        message: 'Failed to generate PDF',
        error: pdfResult.error
      });
    }
    
    console.log('PDF generated successfully:', pdfResult.filename);
    
    // Record download
    await requisition.recordPettyCashFormDownload(buyerId, ipAddress);
    
    console.log('Download recorded for buyer:', buyerId);
    
    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfResult.filename}"`);
    res.setHeader('Content-Length', pdfResult.buffer.length);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    // Send the PDF buffer
    res.send(pdfResult.buffer);
    
    console.log('PDF download completed for petty cash form:', pdfData.displayId);
    
  } catch (error) {
    console.error('Error downloading petty cash form PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download petty cash form PDF',
      error: error.message
    });
  }
};

/**
 * Get buyer petty cash form statistics
 */
const getBuyerPettyCashStats = async (req, res) => {
  try {
    const buyerId = req.user.userId;
    
    console.log('=== GET BUYER PETTY CASH STATS ===');
    console.log('Buyer ID:', buyerId);
    
    const requisitions = await PurchaseRequisition.find({
      'supplyChainReview.assignedBuyer': buyerId,
      'supplyChainReview.paymentMethod': 'cash',
      'pettyCashForm.generated': true
    });
    
    const stats = {
      total: requisitions.length,
      pendingDownload: requisitions.filter(req => 
        req.pettyCashForm.status === 'pending_download'
      ).length,
      downloaded: requisitions.filter(req => 
        req.pettyCashForm.status === 'downloaded'
      ).length,
      totalAmount: requisitions.reduce((sum, req) => sum + (req.budgetXAF || 0), 0),
      byUrgency: {
        high: requisitions.filter(req => req.urgency === 'High').length,
        medium: requisitions.filter(req => req.urgency === 'Medium').length,
        low: requisitions.filter(req => req.urgency === 'Low').length
      }
    };
    
    console.log('Petty cash stats:', stats);
    
    res.json({
      success: true,
      data: stats
    });
    
  } catch (error) {
    console.error('Error fetching petty cash stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch petty cash statistics',
      error: error.message
    });
  }
};

/**
 * Mark petty cash form as completed
 */
const markPettyCashFormComplete = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const buyerId = req.user.userId;
    
    console.log('=== MARK PETTY CASH FORM COMPLETE ===');
    console.log('Requisition ID:', requisitionId);
    
    const requisition = await PurchaseRequisition.findById(requisitionId);
    
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }
    
    // Verify buyer is assigned
    if (requisition.supplyChainReview.assignedBuyer.toString() !== buyerId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this form'
      });
    }
    
    // Update petty cash form status
    requisition.pettyCashForm.status = 'completed';
    await requisition.save();
    
    console.log('Petty cash form marked as completed');
    
    res.json({
      success: true,
      message: 'Petty cash form marked as completed',
      data: {
        requisitionId: requisition._id,
        formNumber: requisition.pettyCashForm.formNumber,
        status: requisition.pettyCashForm.status
      }
    });
    
  } catch (error) {
    console.error('Error marking petty cash form complete:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark petty cash form as complete',
      error: error.message
    });
  }
};

module.exports = {
  getBuyerPettyCashForms,
  getPettyCashFormDetails,
  downloadPettyCashFormPDF,
  getBuyerPettyCashStats,
  markPettyCashFormComplete
};



const PurchaseRequisition = require('../models/PurchaseRequisition');
const Quote = require('../models/Quote');
const PurchaseOrder = require('../models/PurchaseOrder');

// Middleware to check if buyer has access to requisition
const checkRequisitionAccess = async (req, res, next) => {
  try {
    const { requisitionId } = req.params;
    const userId = req.user.userId;
    
    const requisition = await PurchaseRequisition.findById(requisitionId);
    
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }
    
    // Check if requisition is in a state that buyers can work with
    const allowedStatuses = [
      'supply_chain_approved',
      'pending_finance', 
      'approved', 
      'in_procurement',
      'procurement_complete',
      'delivered'
    ];
    
    if (!allowedStatuses.includes(requisition.status)) {
      return res.status(403).json({
        success: false,
        message: 'This requisition is not available for buyer processing'
      });
    }
    
    // Add requisition to request object for use in controller
    req.requisition = requisition;
    next();
    
  } catch (error) {
    console.error('Check requisition access error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking requisition access',
      error: error.message
    });
  }
};

// Middleware to check if buyer has access to quote
const checkQuoteAccess = async (req, res, next) => {
  try {
    const { quoteId } = req.params;
    
    const quote = await Quote.findById(quoteId)
      .populate('requisitionId', 'status');
    
    if (!quote) {
      return res.status(404).json({
        success: false,
        message: 'Quote not found'
      });
    }
    
    // Check if associated requisition is in buyer's domain
    const allowedStatuses = [
      'supply_chain_approved',
      'approved', 
      'in_procurement'
    ];
    
    if (!allowedStatuses.includes(quote.requisitionId.status)) {
      return res.status(403).json({
        success: false,
        message: 'This quote is not available for processing'
      });
    }
    
    req.quote = quote;
    next();
    
  } catch (error) {
    console.error('Check quote access error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking quote access',
      error: error.message
    });
  }
};

// Middleware to check purchase order access
const checkPurchaseOrderAccess = async (req, res, next) => {
  try {
    const { poId } = req.params;
    const userId = req.user.userId;
    
    const purchaseOrder = await PurchaseOrder.findById(poId);
    
    if (!purchaseOrder) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found'
      });
    }
    
    // Check if buyer owns this PO or is admin
    const userRole = req.user.role;
    if (userRole !== 'admin' && !purchaseOrder.buyerId.equals(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this purchase order'
      });
    }
    
    req.purchaseOrder = purchaseOrder;
    next();
    
  } catch (error) {
    console.error('Check purchase order access error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking purchase order access',
      error: error.message
    });
  }
};

module.exports = {
  checkRequisitionAccess,
  checkQuoteAccess,
  checkPurchaseOrderAccess
};
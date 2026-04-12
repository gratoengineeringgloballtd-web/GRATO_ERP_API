/**
 * Send PO to Supply Chain for assignment
 */
exports.sendPOToSupplyChain = async (req, res) => {
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
    
    // Verify buyer owns this PO
    if (po.buyerId.toString() !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access'
      });
    }
    
    // Only draft POs can be sent to Supply Chain
    if (po.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: `PO cannot be sent. Current status: ${po.status}`
      });
    }
    
    // Update status
    po.status = 'pending_supply_chain_assignment';
    po.activities.push({
      type: 'updated',
      description: 'PO sent to Supply Chain for assignment',
      user: req.user.fullName || 'Buyer',
      timestamp: new Date()
    });
    
    await po.save();
    
    // Notify Supply Chain Coordinator
    const { getSupplyChainCoordinator } = require('../config/poApprovalChain');
    const coordinator = getSupplyChainCoordinator();
    
    await sendEmail({
      to: coordinator.email,
      subject: `Purchase Order Assignment Required - ${po.poNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #e7f3ff; padding: 20px; border-radius: 8px;">
            <h3>Purchase Order Assignment Required</h3>
            <p>Dear ${coordinator.name},</p>
            <p>A new purchase order requires your review and department assignment.</p>
            
            <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0;">
              <p><strong>PO Number:</strong> ${po.poNumber}</p>
              <p><strong>Supplier:</strong> ${po.supplierDetails?.name || po.supplierName}</p>
              <p><strong>Amount:</strong> ${po.currency} ${po.totalAmount.toLocaleString()}</p>
              <p><strong>Items:</strong> ${po.items?.length || 0} items</p>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px;">
              <p><strong>Your Action Required:</strong></p>
              <ol>
                <li>Review the PO details</li>
                <li>Download and sign the document</li>
                <li>Assign to appropriate department</li>
                <li>OR reject if not valid</li>
              </ol>
            </div>
            
            <p style="text-align: center; margin: 20px 0;">
              <a href="${process.env.CLIENT_URL}/supply-chain/purchase-orders" 
                 style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
                Review & Assign PO
              </a>
            </p>
          </div>
        </div>
      `
    }).catch(error => {
      console.error('Failed to notify Supply Chain:', error);
    });
    
    res.json({
      success: true,
      message: 'Purchase order sent to Supply Chain successfully',
      data: {
        id: po._id,
        poNumber: po.poNumber,
        status: po.status
      }
    });
    
  } catch (error) {
    console.error('Send to Supply Chain error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send PO to Supply Chain',
      error: error.message
    });
  }
};
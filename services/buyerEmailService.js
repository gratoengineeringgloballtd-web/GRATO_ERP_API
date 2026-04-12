const { sendEmail } = require('./emailService');

const sendBuyerNotificationEmail = {
  requisitionAssigned: async (buyerEmail, requisition) => {
    const subject = `New Purchase Requisition Assigned - ${requisition.title}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #e3f2fd; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h2 style="color: #1976d2; margin: 0;">New Requisition Assignment</h2>
          <p style="color: #666; margin: 5px 0 0 0;">A new purchase requisition has been assigned to you for procurement.</p>
        </div>
        
        <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px;">
          <h3 style="color: #333; margin-top: 0;">Requisition Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Title:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${requisition.title}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Employee:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${requisition.employee.fullName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Department:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${requisition.department}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Category:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${requisition.itemCategory}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Budget:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">XAF ${requisition.budgetXAF?.toLocaleString() || 'Not specified'}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Expected Delivery:</strong></td>
              <td style="padding: 8px 0;">${new Date(requisition.expectedDate).toLocaleDateString()}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/buyer/requisitions/${requisition._id}" 
             style="background-color: #1976d2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Start Sourcing Process
          </a>
        </div>

        <div style="border-top: 1px solid #e8e8e8; padding-top: 20px; color: #666; font-size: 14px;">
          <p style="margin: 0;">Best regards,<br>Procurement Management System</p>
        </div>
      </div>
    `;

    return await sendEmail({
      to: buyerEmail,
      subject,
      html
    });
  },

  // Quote evaluation reminder
  quoteEvaluationReminder: async (buyerEmail, quote) => {
    const subject = `Quote Evaluation Reminder - ${quote.requisitionId.title}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h2 style="color: #856404; margin: 0;">Quote Evaluation Reminder</h2>
          <p style="color: #666; margin: 5px 0 0 0;">You have quotes awaiting evaluation.</p>
        </div>
        
        <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px;">
          <h3 style="color: #333; margin-top: 0;">Quote Details</h3>
          <p><strong>Supplier:</strong> ${quote.supplierId.name}</p>
          <p><strong>Requisition:</strong> ${quote.requisitionId.title}</p>
          <p><strong>Amount:</strong> XAF ${quote.totalAmount.toLocaleString()}</p>
          <p><strong>Received:</strong> ${new Date(quote.submissionDate).toLocaleDateString()}</p>
          <p><strong>Valid Until:</strong> ${new Date(quote.validUntil).toLocaleDateString()}</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/buyer/quotes" 
             style="background-color: #ffc107; color: #212529; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Evaluate Quotes
          </a>
        </div>
      </div>
    `;

    return await sendEmail({
      to: buyerEmail,
      subject,
      html
    });
  },

  // Delivery issue alert
  deliveryIssueAlert: async (buyerEmail, delivery, issue) => {
    const subject = `Delivery Issue Alert - ${delivery.trackingNumber}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #f8d7da; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h2 style="color: #721c24; margin: 0;">Delivery Issue Alert</h2>
          <p style="color: #666; margin: 5px 0 0 0;">An issue has been reported with one of your deliveries.</p>
        </div>
        
        <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px;">
          <h3 style="color: #333; margin-top: 0;">Issue Details</h3>
          <p><strong>Tracking Number:</strong> ${delivery.trackingNumber}</p>
          <p><strong>Issue Type:</strong> ${issue.type}</p>
          <p><strong>Priority:</strong> ${issue.priority.toUpperCase()}</p>
          <p><strong>Description:</strong> ${issue.description}</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/buyer/deliveries/${delivery._id}" 
             style="background-color: #dc3545; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            View Delivery Details
          </a>
        </div>
      </div>
    `;

    return await sendEmail({
      to: buyerEmail,
      subject,
      html
    });
  },

  // Purchase order confirmation
  purchaseOrderConfirmation: async (buyerEmail, purchaseOrder) => {
    const subject = `Purchase Order Created - PO#${purchaseOrder.orderNumber}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h2 style="color: #155724; margin: 0;">Purchase Order Confirmed</h2>
          <p style="color: #666; margin: 5px 0 0 0;">Your purchase order has been successfully created and sent to the supplier.</p>
        </div>
        
        <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px;">
          <h3 style="color: #333; margin-top: 0;">Purchase Order Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>PO Number:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${purchaseOrder.orderNumber}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Supplier:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${purchaseOrder.supplier?.name || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Total Amount:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">XAF ${purchaseOrder.totalAmount.toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Expected Delivery:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${new Date(purchaseOrder.expectedDeliveryDate).toLocaleDateString()}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Status:</strong></td>
              <td style="padding: 8px 0;">${purchaseOrder.status}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/buyer/purchase-orders/${purchaseOrder._id}" 
             style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            View Purchase Order
          </a>
        </div>

        <div style="border-top: 1px solid #e8e8e8; padding-top: 20px; color: #666; font-size: 14px;">
          <p style="margin: 0;">Best regards,<br>Procurement Management System</p>
        </div>
      </div>
    `;

    return await sendEmail({
      to: buyerEmail,
      subject,
      html
    });
  },

  // Budget approval required
  budgetApprovalRequired: async (buyerEmail, requisition) => {
    const subject = `Budget Approval Required - ${requisition.title}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h2 style="color: #856404; margin: 0;">Budget Approval Required</h2>
          <p style="color: #666; margin: 5px 0 0 0;">This requisition requires additional budget approval before proceeding.</p>
        </div>
        
        <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px;">
          <h3 style="color: #333; margin-top: 0;">Requisition Details</h3>
          <p><strong>Title:</strong> ${requisition.title}</p>
          <p><strong>Original Budget:</strong> XAF ${requisition.budgetXAF?.toLocaleString()}</p>
          <p><strong>Required Amount:</strong> XAF ${requisition.requiredAmount?.toLocaleString()}</p>
          <p><strong>Difference:</strong> XAF ${(requisition.requiredAmount - requisition.budgetXAF)?.toLocaleString()}</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/buyer/requisitions/${requisition._id}" 
             style="background-color: #ffc107; color: #212529; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Request Budget Approval
          </a>
        </div>
      </div>
    `;

    return await sendEmail({
      to: buyerEmail,
      subject,
      html
    });
  },

  // Supplier response notification
  supplierResponseNotification: async (buyerEmail, quote) => {
    const subject = `New Quote Received - ${quote.requisitionId.title}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #e3f2fd; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h2 style="color: #1976d2; margin: 0;">New Quote Received</h2>
          <p style="color: #666; margin: 5px 0 0 0;">A supplier has submitted a quote for your requisition.</p>
        </div>
        
        <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px;">
          <h3 style="color: #333; margin-top: 0;">Quote Summary</h3>
          <p><strong>Supplier:</strong> ${quote.supplierId.name}</p>
          <p><strong>Requisition:</strong> ${quote.requisitionId.title}</p>
          <p><strong>Quoted Amount:</strong> XAF ${quote.totalAmount.toLocaleString()}</p>
          <p><strong>Delivery Time:</strong> ${quote.deliveryTime} days</p>
          <p><strong>Valid Until:</strong> ${new Date(quote.validUntil).toLocaleDateString()}</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/buyer/quotes/${quote._id}" 
             style="background-color: #1976d2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Review Quote
          </a>
        </div>
      </div>
    `;

    return await sendEmail({
      to: buyerEmail,
      subject,
      html
    });
  },

  // Delivery completed notification
  deliveryCompletedNotification: async (buyerEmail, delivery) => {
    const subject = `Delivery Completed - ${delivery.trackingNumber}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h2 style="color: #155724; margin: 0;">Delivery Completed</h2>
          <p style="color: #666; margin: 5px 0 0 0;">A delivery has been successfully completed.</p>
        </div>
        
        <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px;">
          <h3 style="color: #333; margin-top: 0;">Delivery Details</h3>
          <p><strong>Tracking Number:</strong> ${delivery.trackingNumber}</p>
          <p><strong>Supplier:</strong> ${delivery.supplier?.name || 'N/A'}</p>
          <p><strong>Delivery Date:</strong> ${new Date(delivery.actualDeliveryDate).toLocaleDateString()}</p>
          <p><strong>Status:</strong> ${delivery.status}</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/buyer/deliveries/${delivery._id}" 
             style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            View Delivery Details
          </a>
        </div>

        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 0; color: #666; font-size: 14px;">
            <strong>Next Steps:</strong> Please review the delivery and provide feedback on supplier performance.
          </p>
        </div>
      </div>
    `;

    return await sendEmail({
      to: buyerEmail,
      subject,
      html
    });
  },

  // Weekly performance summary
  weeklyPerformanceSummary: async (buyerEmail, summaryData) => {
    const subject = `Weekly Procurement Performance Summary`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #e3f2fd; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h2 style="color: #1976d2; margin: 0;">Weekly Performance Summary</h2>
          <p style="color: #666; margin: 5px 0 0 0;">Your procurement activities for the past week.</p>
        </div>
        
        <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
          <h3 style="color: #333; margin-top: 0;">Key Metrics</h3>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            <div style="text-align: center; padding: 15px; background-color: #f8f9fa; border-radius: 6px;">
              <h4 style="color: #1976d2; margin: 0 0 5px 0;">${summaryData.totalRequisitions || 0}</h4>
              <p style="margin: 0; color: #666; font-size: 14px;">Total Requisitions</p>
            </div>
            <div style="text-align: center; padding: 15px; background-color: #f8f9fa; border-radius: 6px;">
              <h4 style="color: #28a745; margin: 0 0 5px 0;">${summaryData.completedRequisitions || 0}</h4>
              <p style="margin: 0; color: #666; font-size: 14px;">Completed</p>
            </div>
            <div style="text-align: center; padding: 15px; background-color: #f8f9fa; border-radius: 6px;">
              <h4 style="color: #ffc107; margin: 0 0 5px 0;">${summaryData.pendingQuotes || 0}</h4>
              <p style="margin: 0; color: #666; font-size: 14px;">Pending Quotes</p>
            </div>
            <div style="text-align: center; padding: 15px; background-color: #f8f9fa; border-radius: 6px;">
              <h4 style="color: #17a2b8; margin: 0 0 5px 0;">XAF ${summaryData.totalValue?.toLocaleString() || '0'}</h4>
              <p style="margin: 0; color: #666; font-size: 14px;">Total Value</p>
            </div>
          </div>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/buyer/analytics" 
             style="background-color: #1976d2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            View Detailed Analytics
          </a>
        </div>

        <div style="border-top: 1px solid #e8e8e8; padding-top: 20px; color: #666; font-size: 14px;">
          <p style="margin: 0;">Keep up the great work!<br>Procurement Management System</p>
        </div>
      </div>
    `;

    return await sendEmail({
      to: buyerEmail,
      subject,
      html
    });
  }
};

module.exports = {
  sendBuyerNotificationEmail
};
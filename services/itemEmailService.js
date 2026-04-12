const { sendEmail } = require('./emailService');

const sendItemRequestEmail = {
  /**
   * Notify supply chain team of new item request
   * @param {Array|string} supplyChainEmails 
   * @param {Object} itemRequest 
   * @param {Object} employee 
   * @returns {Promise<Object>}
   */
  newItemRequestToSupplyChain: async (supplyChainEmails, itemRequest, employee) => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const reviewLink = `${clientUrl}/supply-chain/item-management`;

      const subject = `New Item Request from ${employee.fullName} - ${itemRequest.category}`;
      
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #e3f2fd; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="color: #1976d2; margin: 0;">New Item Request for Database</h2>
            <p style="color: #666; margin: 5px 0 0 0;">A new item has been requested to be added to the purchase requisition database.</p>
          </div>

          <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <h3 style="color: #333; margin-top: 0;">Request Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Request ID:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${itemRequest.requestNumber}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Requested by:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${employee.fullName} (${employee.department})</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Item Description:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${itemRequest.description}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Category:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${itemRequest.category}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Unit of Measure:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${itemRequest.unitOfMeasure}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Urgency:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; text-transform: uppercase; color: ${itemRequest.urgency === 'high' ? '#d32f2f' : itemRequest.urgency === 'medium' ? '#ff9800' : '#2e7d32'};">${itemRequest.urgency}</td>
              </tr>
              ${itemRequest.estimatedPrice ? `
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Estimated Price:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">XAF ${parseFloat(itemRequest.estimatedPrice).toLocaleString()}</td>
              </tr>
              ` : ''}
              ${itemRequest.preferredSupplier ? `
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Preferred Supplier:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${itemRequest.preferredSupplier}</td>
              </tr>
              ` : ''}
            </table>
          </div>

          <div style="background-color: #f0f8ff; border-left: 4px solid #1976d2; padding: 15px; margin: 20px 0;">
            <h4 style="margin: 0 0 10px 0; color: #1976d2;">Business Justification</h4>
            <p style="margin: 0; color: #333;">${itemRequest.justification}</p>
          </div>

          ${itemRequest.additionalNotes ? `
          <div style="background-color: #f9f9f9; border-left: 4px solid #666; padding: 15px; margin: 20px 0;">
            <h4 style="margin: 0 0 10px 0; color: #666;">Additional Notes</h4>
            <p style="margin: 0; color: #333;">${itemRequest.additionalNotes}</p>
          </div>
          ` : ''}

          <div style="background-color: #fff3e0; border-left: 4px solid #ff9800; padding: 15px; margin: 20px 0;">
            <h4 style="margin: 0 0 10px 0; color: #ff9800;">Action Required</h4>
            <p style="margin: 0; color: #333;">Please review this item request and decide whether to add it to the database, approve it for future consideration, or reject it.</p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${reviewLink}" 
               style="background-color: #1976d2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Review Item Request
            </a>
          </div>

          <div style="border-top: 1px solid #e8e8e8; padding-top: 20px; color: #666; font-size: 14px;">
            <p style="margin: 0;">Best regards,<br>Item Management System</p>
            <p style="margin: 10px 0 0 0; font-size: 12px;">This is an automated notification. Please do not reply to this email.</p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: supplyChainEmails,
        subject,
        html
      });

    } catch (error) {
      console.error('Error sending item request notification:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify employee when item is created and added to database
   * @param {string} employeeEmail 
   * @param {Object} itemRequest 
   * @param {Object} createdItem 
   * @returns {Promise<Object>}
   */
  itemCreatedToEmployee: async (employeeEmail, itemRequest, createdItem) => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const requisitionLink = `${clientUrl}/employee/purchase-requisitions/new`;

      const subject = 'Item Request Approved - Item Added to Database';
      
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="color: #2e7d32; margin: 0;">Item Request Approved!</h2>
            <p style="color: #666; margin: 5px 0 0 0;">Your requested item has been added to the purchase requisition database.</p>
          </div>

          <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <h3 style="color: #333; margin-top: 0;">Item Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Item Code:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; color: #1976d2; font-weight: bold;">${createdItem.code}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Description:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${createdItem.description}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Category:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${createdItem.category}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Unit:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${createdItem.unitOfMeasure}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>Status:</strong></td>
                <td style="padding: 8px 0;"><span style="background-color: #2e7d32; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">ADDED TO DATABASE</span></td>
              </tr>
            </table>
          </div>

          <div style="background-color: #e3f2fd; border-left: 4px solid #1976d2; padding: 15px; margin: 20px 0;">
            <h4 style="margin: 0 0 10px 0; color: #1976d2;">What's Next?</h4>
            <p style="margin: 0; color: #333;">This item is now available for selection in purchase requisitions. You can find it by searching for the item code <strong>${createdItem.code}</strong> or description when creating a new purchase requisition.</p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${requisitionLink}" 
               style="background-color: #1976d2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Create Purchase Requisition
            </a>
          </div>

          <div style="border-top: 1px solid #e8e8e8; padding-top: 20px; color: #666; font-size: 14px;">
            <p style="margin: 0;">Thank you for helping us improve our item database!</p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        html
      });

    } catch (error) {
      console.error('Error sending item created notification:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify employee when item request is rejected
   * @param {string} employeeEmail 
   * @param {Object} itemRequest 
   * @param {string} rejectionReason 
   * @returns {Promise<Object>}
   */
  itemRequestRejected: async (employeeEmail, itemRequest, rejectionReason) => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const requestsLink = `${clientUrl}/employee/item-requests`;

      const subject = 'Item Request Status Update';
      
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #ffebee; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="color: #d32f2f; margin: 0;">Item Request Not Approved</h2>
            <p style="color: #666; margin: 5px 0 0 0;">Your item request has been reviewed and not approved at this time.</p>
          </div>

          <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <h3 style="color: #333; margin-top: 0;">Request Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Request ID:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${itemRequest.requestNumber}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Item:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${itemRequest.description}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Category:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${itemRequest.category}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>Status:</strong></td>
                <td style="padding: 8px 0;"><span style="background-color: #d32f2f; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">NOT APPROVED</span></td>
              </tr>
            </table>
          </div>

          <div style="background-color: #fff3e0; border-left: 4px solid #ff9800; padding: 15px; margin: 20px 0;">
            <h4 style="margin: 0 0 10px 0; color: #ff9800;">Reason for Decision</h4>
            <p style="margin: 0; color: #333;">${rejectionReason || 'No specific reason provided'}</p>
          </div>

          <div style="background-color: #e3f2fd; border-left: 4px solid #1976d2; padding: 15px; margin: 20px 0;">
            <h4 style="margin: 0 0 10px 0; color: #1976d2;">What You Can Do</h4>
            <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #333;">
              <li>Review the reason provided above</li>
              <li>Consider submitting a revised request with additional justification</li>
              <li>Contact the supply chain team for clarification</li>
              <li>Look for similar items already in the database</li>
            </ul>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${requestsLink}" 
               style="background-color: #6c757d; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              View All Requests
            </a>
          </div>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        html
      });

    } catch (error) {
      console.error('Error sending item request rejection notification:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify employee when item request is approved (but not yet created)
   * @param {string} employeeEmail 
   * @param {Object} itemRequest 
   * @returns {Promise<Object>}
   */
  itemRequestApproved: async (employeeEmail, itemRequest) => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const requestsLink = `${clientUrl}/employee/item-requests`;

      const subject = 'Item Request Approved';
      
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #fff3e0; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="color: #ff9800; margin: 0;">Item Request Approved</h2>
            <p style="color: #666; margin: 5px 0 0 0;">Your item request has been approved for future consideration.</p>
          </div>

          <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <h3 style="color: #333; margin-top: 0;">Request Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Request ID:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${itemRequest.requestNumber}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Item:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${itemRequest.description}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Category:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${itemRequest.category}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>Status:</strong></td>
                <td style="padding: 8px 0;"><span style="background-color: #ff9800; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">APPROVED</span></td>
              </tr>
            </table>
          </div>

          <div style="background-color: #e3f2fd; border-left: 4px solid #1976d2; padding: 15px; margin: 20px 0;">
            <h4 style="margin: 0 0 10px 0; color: #1976d2;">Next Steps</h4>
            <p style="margin: 0; color: #333;">Your item request has been approved and will be considered for addition to the database in future updates. You will be notified when the item becomes available for selection in purchase requisitions.</p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${requestsLink}" 
               style="background-color: #ff9800; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              View All Requests
            </a>
          </div>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        html
      });

    } catch (error) {
      console.error('Error sending item request approval notification:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
};

module.exports = {
  sendItemRequestEmail
};
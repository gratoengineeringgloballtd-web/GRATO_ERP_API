const Invoice = require('../models/Invoice');
const User = require('../models/User');
const { sendEmail } = require('../services/emailService');
const { cloudinary } = require('../config/cloudinary');
const fs = require('fs').promises;
const accountingService = require('../services/accountingService');

// Upload invoice with files - FIXED
exports.uploadInvoice = async (req, res) => {
  try {
    console.log('=== INVOICE UPLOAD STARTED ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Files received:', req.files ? Object.keys(req.files) : 'No files');
    console.log('User ID:', req.user.userId);

    const { poNumber, invoiceNumber } = req.body;

    // Validate required fields
    if (!poNumber || !invoiceNumber) {
      throw new Error('PO number and invoice number are required');
    }

    // Validate PO number format
    const poRegex = /^PO-\w{2}\d{10}-\d+$/i;
    if (!poRegex.test(poNumber)) {
      throw new Error('PO number format should be: PO-XX0000000000-X (e.g., PO-NG010000000-1)');
    }

    // Check for duplicate PO/Invoice combination
    const existingInvoice = await Invoice.findOne({
      poNumber: poNumber.toUpperCase(),
      invoiceNumber: invoiceNumber.trim(),
      employee: req.user.userId
    });

    if (existingInvoice) {
      throw new Error('An invoice with this PO number and invoice number already exists');
    }

    // Get employee details with department/position info
    const employee = await User.findById(req.user.userId).select('fullName email department position');
    if (!employee) {
      throw new Error('Employee not found');
    }

    console.log('Employee found:', employee.fullName, 'Department:', employee.department);

    // Verify Cloudinary is available
    if (!cloudinary || !cloudinary.uploader) {
      throw new Error('Cloudinary is not properly configured');
    }

    // Process file uploads to Cloudinary
    const uploadedFiles = {};
    const uploadPromises = [];

    // Helper function to upload to Cloudinary
    const uploadToCloudinary = async (file, folder) => {
      try {
        console.log(`🔄 Uploading ${file.fieldname} to Cloudinary...`);
        
        // Check if file exists
        try {
          await fs.access(file.path);
        } catch (error) {
          throw new Error(`File not found: ${file.path}`);
        }

        const result = await cloudinary.uploader.upload(file.path, {
          folder: `invoice-uploads/${folder}`,
          resource_type: 'auto',
          public_id: `${poNumber}-${file.fieldname}-${Date.now()}`,
          format: file.mimetype.includes('pdf') ? 'pdf' : undefined,
          use_filename: true,
          unique_filename: true
        });

        console.log(`✅ ${file.fieldname} uploaded successfully:`, {
          publicId: result.public_id,
          url: result.secure_url
        });

        // Clean up temporary file
        await fs.unlink(file.path).catch(err => 
          console.warn('Failed to delete temp file:', err.message)
        );

        return {
          publicId: result.public_id,
          url: result.secure_url,
          format: result.format,
          resourceType: result.resource_type,
          bytes: result.bytes,
          originalName: file.originalname
        };
      } catch (error) {
        console.error(`❌ Failed to upload ${file.fieldname}:`, error);
        await fs.unlink(file.path).catch(() => {});
        throw new Error(`Failed to upload ${file.fieldname}: ${error.message}`);
      }
    };

    // Process PO file if uploaded
    if (req.files && req.files.poFile && req.files.poFile.length > 0) {
      const poFile = req.files.poFile[0];
      uploadPromises.push(
        uploadToCloudinary(poFile, 'po-files').then(result => {
          uploadedFiles.poFile = result;
        })
      );
    }

    // Process invoice file if uploaded
    if (req.files && req.files.invoiceFile && req.files.invoiceFile.length > 0) {
      const invoiceFile = req.files.invoiceFile[0];
      uploadPromises.push(
        uploadToCloudinary(invoiceFile, 'invoice-files').then(result => {
          uploadedFiles.invoiceFile = result;
        })
      );
    }

    // Wait for all uploads to complete
    if (uploadPromises.length > 0) {
      await Promise.all(uploadPromises);
      console.log('✅ All files uploaded to Cloudinary successfully');
    }

    // Create invoice record with CORRECT enum values and employee details cached
    const invoiceData = {
      poNumber: poNumber.toUpperCase(),
      invoiceNumber: invoiceNumber.trim(),
      employee: req.user.userId,
      employeeDetails: {
        name: employee.fullName,
        email: employee.email,
        department: employee.department,
        position: employee.position || 'Employee'
      },
      uploadedDate: new Date(),
      uploadedTime: new Date().toTimeString().split(' ')[0],
      // ✅ FIXED: Use correct enum value instead of 'pending'
      approvalStatus: 'pending_finance_assignment',
      ...uploadedFiles
    };

    console.log('Creating invoice with data:', JSON.stringify(invoiceData, null, 2));
    const invoice = await Invoice.create(invoiceData);
    console.log('✅ Invoice created with ID:', invoice._id);

    // Send email notifications
    const notifications = [];

    // 1. Notify Finance Team
    const financeTeam = await User.find({ role: 'finance' }).select('email fullName');
    if (financeTeam.length > 0) {
      console.log('📧 Notifying finance team:', financeTeam.map(f => f.email));
      
      notifications.push(
        sendEmail({
          to: financeTeam.map(f => f.email),
          subject: `📄 New Invoice Upload - ${employee.fullName}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #e7f3ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
                <h3>New Invoice Upload Received</h3>
                <p>Dear Finance Team,</p>
                
                <p>A new invoice has been uploaded and requires department assignment for approval processing.</p>
                
                <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  <p><strong>Invoice Details:</strong></p>
                  <ul>
                    <li><strong>Employee:</strong> ${employee.fullName} (${employee.department || 'N/A'})</li>
                    <li><strong>Position:</strong> ${employee.position || 'Employee'}</li>
                    <li><strong>PO Number:</strong> ${invoice.poNumber}</li>
                    <li><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</li>
                    <li><strong>Upload Date:</strong> ${new Date().toLocaleDateString('en-GB')}</li>
                    <li><strong>Upload Time:</strong> ${invoice.uploadedTime}</li>
                    <li><strong>Status:</strong> <span style="color: #faad14;">⏳ Awaiting Department Assignment</span></li>
                  </ul>
                </div>
                
                <div style="background-color: #f6ffed; padding: 15px; border-radius: 5px; margin: 15px 0;">
                  <p><strong>Uploaded Files:</strong></p>
                  <ul>
                    ${uploadedFiles.poFile ? `<li>📎 PO File: ${uploadedFiles.poFile.originalName}</li>` : ''}
                    ${uploadedFiles.invoiceFile ? `<li>📎 Invoice File: ${uploadedFiles.invoiceFile.originalName}</li>` : ''}
                    ${!uploadedFiles.poFile && !uploadedFiles.invoiceFile ? '<li>No files attached</li>' : ''}
                  </ul>
                </div>
                
                <p>Please assign this invoice to the appropriate department for approval chain processing.</p>
                
                <p><strong>Action Required:</strong> 
                  <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/finance/invoices" 
                     style="background-color: #1890ff; color: white; padding: 8px 16px; text-decoration: none; border-radius: 4px;">
                    Assign to Department
                  </a>
                </p>
                
                <p>Thank you!</p>
              </div>
            </div>
          `
        }).catch(error => {
          console.error('Failed to send finance notification:', error);
          return { error, type: 'finance' };
        })
      );
    }

    // 2. Notify Admins
    const admins = await User.find({ role: 'admin' }).select('email fullName');
    if (admins.length > 0) {
      notifications.push(
        sendEmail({
          to: admins.map(a => a.email),
          subject: `Invoice Upload - ${employee.fullName}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px;">
                <h3>New Invoice Upload</h3>
                <p>An invoice has been uploaded by ${employee.fullName}.</p>
                
                <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0;">
                  <ul>
                    <li><strong>Employee:</strong> ${employee.fullName}</li>
                    <li><strong>Department:</strong> ${employee.department}</li>
                    <li><strong>Position:</strong> ${employee.position || 'Employee'}</li>
                    <li><strong>PO Number:</strong> ${invoice.poNumber}</li>
                    <li><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</li>
                    <li><strong>Status:</strong> Pending Department Assignment</li>
                  </ul>
                </div>
              </div>
            </div>
          `
        }).catch(error => {
          console.error('Failed to send admin notification:', error);
          return { error, type: 'admin' };
        })
      );
    }

    // 3. Confirm to employee
    notifications.push(
      sendEmail({
        to: employee.email,
        subject: 'Invoice Uploaded Successfully - Pending Assignment',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f6ffed; padding: 20px; border-radius: 8px; border-left: 4px solid #52c41a;">
              <h3>Invoice Upload Confirmation</h3>
              <p>Dear ${employee.fullName},</p>
              
              <p>Your invoice has been uploaded successfully and is now awaiting department assignment by the finance team.</p>
              
              <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <p><strong>Upload Details:</strong></p>
                <ul>
                  <li><strong>PO Number:</strong> ${invoice.poNumber}</li>
                  <li><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</li>
                  <li><strong>Upload Date:</strong> ${new Date().toLocaleDateString('en-GB')}</li>
                  <li><strong>Upload Time:</strong> ${invoice.uploadedTime}</li>
                  <li><strong>Status:</strong> <span style="color: #faad14;">Awaiting Department Assignment</span></li>
                </ul>
              </div>
              
              ${uploadedFiles.poFile || uploadedFiles.invoiceFile ? `
              <div style="background-color: #e6f7ff; padding: 15px; border-radius: 5px; margin: 15px 0;">
                <p><strong>Files Uploaded:</strong></p>
                <ul>
                  ${uploadedFiles.poFile ? `<li>✅ PO File: ${uploadedFiles.poFile.originalName}</li>` : ''}
                  ${uploadedFiles.invoiceFile ? `<li>✅ Invoice File: ${uploadedFiles.invoiceFile.originalName}</li>` : ''}
                </ul>
              </div>
              ` : ''}
              
              <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 15px 0;">
                <p><strong>What Happens Next:</strong></p>
                <ol>
                  <li>Finance team will assign your invoice to the appropriate department</li>
                  <li>Department supervisors/heads will review and approve</li>
                  <li>Once approved, finance will process the invoice</li>
                  <li>You'll receive notifications at each step</li>
                </ol>
              </div>
              
              <p>You can track the status of your invoice uploads in the employee portal.</p>
              
              <p>Thank you!</p>
            </div>
          </div>
        `
      }).catch(error => {
        console.error('Failed to send employee confirmation:', error);
        return { error, type: 'employee' };
      })
    );

    // Send all notifications
    const notificationResults = await Promise.allSettled(notifications);
    notificationResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`Notification ${index} failed:`, result.reason);
      } else if (result.value && result.value.error) {
        console.error(`${result.value.type} notification failed:`, result.value.error);
      } else {
        console.log(`📧 Notification ${index} sent successfully`);
      }
    });

    console.log('=== INVOICE UPLOADED SUCCESSFULLY ===');
    res.status(201).json({
      success: true,
      message: 'Invoice uploaded successfully and awaiting department assignment',
      data: invoice,
      notifications: {
        sent: notificationResults.filter(r => r.status === 'fulfilled').length,
        failed: notificationResults.filter(r => r.status === 'rejected').length
      }
    });

  } catch (error) {
    console.error('=== INVOICE UPLOAD FAILED ===', error);

    // Clean up any uploaded files on Cloudinary if the database save failed
    if (req.uploadedFiles) {
      const cleanupPromises = Object.values(req.uploadedFiles).map(file => {
        if (file.publicId && cloudinary && cloudinary.uploader) {
          return cloudinary.uploader.destroy(file.publicId).catch(err => 
            console.error('Failed to cleanup Cloudinary file:', err)
          );
        }
      });
      await Promise.allSettled(cleanupPromises);
    }

    // Clean up temporary files
    if (req.files) {
      const tempFiles = [];
      if (req.files.poFile) tempFiles.push(...req.files.poFile);
      if (req.files.invoiceFile) tempFiles.push(...req.files.invoiceFile);
      
      const cleanupPromises = tempFiles.map(file => 
        fs.unlink(file.path).catch(err => 
          console.warn('Failed to delete temp file:', err.message)
        )
      );
      await Promise.allSettled(cleanupPromises);
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

// Get employee's invoices
exports.getEmployeeInvoices = async (req, res) => {
  try {
    console.log('Fetching invoices for employee:', req.user.userId);
    
    const invoices = await Invoice.find({ employee: req.user.userId })
      .populate('employee', 'fullName email department')
      .populate('reviewedBy', 'fullName email')
      .populate('assignedBy', 'fullName email')
      .populate('approvalChain.approver.userId', 'fullName email')
      .sort({ uploadedDate: -1 });

    console.log(`Found ${invoices.length} invoices for employee`);

    res.json({
      success: true,
      count: invoices.length,
      data: invoices
    });
  } catch (error) {
    console.error('Error fetching employee invoices:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoices'
    });
  }
};

// Get all invoices for finance/admin
exports.getAllInvoices = async (req, res) => {
  try {
    const { status, fromDate, toDate } = req.query;
    
    const filter = {};
    
    if (status) filter.approvalStatus = status;
    if (fromDate || toDate) {
      filter.uploadedDate = {};
      if (fromDate) filter.uploadedDate.$gte = new Date(fromDate);
      if (toDate) filter.uploadedDate.$lte = new Date(toDate);
    }

    const invoices = await Invoice.find(filter)
      .populate('employee', 'fullName email department')
      .populate('reviewedBy', 'fullName email')
      .populate('assignedBy', 'fullName email')
      .populate('approvalChain.approver.userId', 'fullName email')
      .sort({ uploadedDate: -1 });

    res.json({
      success: true,
      count: invoices.length,
      data: invoices
    });
  } catch (error) {
    console.error('Error fetching all invoices:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoices'
    });
  }
};

// Process invoice approval/rejection - UPDATED to use correct enum values
exports.processInvoiceDecision = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { decision, comments } = req.body;

    console.log('=== INVOICE DECISION PROCESSING ===');
    console.log('Invoice ID:', invoiceId);
    console.log('Decision:', decision);

    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid decision. Must be "approved" or "rejected"'
      });
    }

    const invoice = await Invoice.findById(invoiceId)
      .populate('employee', 'fullName email');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // ✅ FIXED: Update invoice with correct enum values
    if (decision === 'approved') {
      invoice.approvalStatus = 'approved';
    } else {
      invoice.approvalStatus = 'rejected';
      if (comments) {
        invoice.rejectionComments = comments;
      }
    }
    
    invoice.reviewedBy = req.user.userId;
    invoice.reviewDate = new Date();

    await invoice.save();

    if (decision === 'approved') {
      try {
        await accountingService.ensureDefaultChart();
        await accountingService.postCustomerInvoice(invoice._id, req.user.userId);
        console.log('✅ Accounting posted for customer invoice (legacy approval flow)');
      } catch (accountingError) {
        console.error('⚠️ Accounting auto-post skipped for customer invoice (legacy approval flow):', accountingError.message);
      }
    }

    // Send notification to employee
    const notification = sendEmail({
      to: invoice.employee.email,
      subject: `Invoice ${decision === 'approved' ? 'Approved' : 'Rejected'} - ${invoice.poNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: ${decision === 'approved' ? '#f6ffed' : '#fff2f0'}; padding: 20px; border-radius: 8px; border-left: 4px solid ${decision === 'approved' ? '#52c41a' : '#ff4d4f'};">
            <h3>Invoice ${decision === 'approved' ? 'Approved' : 'Rejected'}</h3>
            <p>Dear ${invoice.employee.fullName},</p>
            
            <p>Your invoice has been ${decision}.</p>
            
            <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <p><strong>Invoice Details:</strong></p>
              <ul>
                <li><strong>PO Number:</strong> ${invoice.poNumber}</li>
                <li><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</li>
                <li><strong>Status:</strong> <span style="color: ${decision === 'approved' ? '#52c41a' : '#ff4d4f'};">${decision.toUpperCase()}</span></li>
              </ul>
            </div>
            
            ${decision === 'rejected' && comments ? `
            <div style="background-color: #fff1f0; padding: 15px; border-radius: 5px; margin: 15px 0;">
              <p><strong>Rejection Reason:</strong></p>
              <p style="font-style: italic;">${comments}</p>
            </div>
            ` : ''}
            
            <p>${decision === 'approved' ? 'Your invoice has been processed successfully.' : 'Please review the comments and resubmit if necessary.'}</p>
            
            <p>Thank you!</p>
          </div>
        </div>
      `
    });

    await notification.catch(error => {
      console.error('Failed to send notification:', error);
    });

    console.log('=== INVOICE DECISION PROCESSED ===');
    res.json({
      success: true,
      message: `Invoice ${decision} successfully`,
      data: invoice
    });

  } catch (error) {
    console.error('Error processing invoice decision:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to process decision'
    });
  }
};

// Get invoice details
exports.getInvoiceDetails = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.invoiceId)
      .populate('employee', 'fullName email department')
      .populate('reviewedBy', 'fullName email')
      .populate('assignedBy', 'fullName email')
      .populate('approvalChain.approver.userId', 'fullName email');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    res.json({
      success: true,
      data: {
        ...invoice.toJSON(),
        approvalHistory: invoice.getApprovalHistory ? invoice.getApprovalHistory() : [],
        approvalProgress: invoice.approvalProgress || 0,
        currentApprover: invoice.getCurrentApprover ? invoice.getCurrentApprover() : null,
        formattedUploadDateTime: invoice.formattedUploadDateTime
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




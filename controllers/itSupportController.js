const ITSupportRequest = require('../models/ITSupportRequest');
const User = require('../models/User');
const { getApprovalChain } = require('../config/departmentStructure');
const { sendITSupportEmail, sendEmail } = require('../services/emailService');
const { getITSupportApprovalChain } = require('../config/itSupportApprovalChain');
const { 
  saveFile, 
  deleteFile,
  deleteFiles,
  STORAGE_CATEGORIES 
} = require('../utils/localFileStorage');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');


/**
 * Maps raw approval chain from getITSupportApprovalChain() to ITSupportRequest schema format
 */
const mapApprovalChainForITRequest = (rawApprovalChain) => {
  if (!rawApprovalChain || !Array.isArray(rawApprovalChain)) {
    throw new Error('Invalid approval chain provided');
  }

  return rawApprovalChain.map((step, index) => {
    const approverData = step.approver || {};
    
    const approverName = String(approverData.name || 'Unknown Approver').trim();
    const approverEmail = String(approverData.email || '').trim().toLowerCase();
    const approverRole = String(approverData.role || approverData.position || 'Approver').trim();
    const approverDept = String(approverData.department || '').trim();

    if (!approverName || approverName === 'Unknown Approver') {
      console.error(`❌ Level ${index + 1}: Missing approver name`);
      throw new Error(`Approval chain configuration error: Missing approver name at level ${index + 1}`);
    }

    if (!approverEmail || approverEmail.length === 0) {
      console.error(`❌ Level ${index + 1}: Missing approver email`);
      throw new Error(`Approval chain configuration error: Missing approver email at level ${index + 1}`);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(approverEmail)) {
      console.error(`❌ Level ${index + 1}: Invalid email format: ${approverEmail}`);
      throw new Error(`Approval chain configuration error: Invalid email at level ${index + 1}`);
    }

    console.log(`  Level ${index + 1}: ${approverName} (${approverRole}) - ${approverEmail}${approverDept ? ` [${approverDept}]` : ''}`);

    return {
      level: step.level || (index + 1),
      approver: {
        name: approverName,
        email: approverEmail,
        role: approverRole,
        department: approverDept
      },
      status: step.status || 'pending',
      assignedDate: index === 0 ? new Date() : null,
      comments: '',
      actionDate: null,
      actionTime: null,
      decidedBy: null
    };
  });
};


// ===== DISCHARGE & ACKNOWLEDGMENT =====

// IT discharges items (IT staff action)
const dischargeITItems = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { dischargedItems } = req.body;
    const userId = req.user.userId;
    const user = await User.findById(userId);

    if (!user || (user.role !== 'it' && user.role !== 'admin')) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const request = await ITSupportRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    if (request.status !== 'it_approved' && request.status !== 'pending_discharge') {
      return res.status(400).json({ success: false, message: 'Request not ready for discharge' });
    }

    let parsedItems = [];
    try {
      parsedItems = typeof dischargedItems === 'string' ? JSON.parse(dischargedItems) : dischargedItems;
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Invalid dischargedItems format' });
    }

    let signatureUrl = null;
    if (req.file) {
      signatureUrl = req.file.path;
    }

    request.dischargedItems = parsedItems;
    request.dischargeSignature = {
      name: user.fullName,
      imageUrl: signatureUrl,
      signedBy: user._id,
      signedAt: new Date()
    };
    request.status = 'pending_acknowledgment';
    await request.save();

    res.json({
      success: true,
      message: 'Items discharged, awaiting requester acknowledgment',
      data: request
    });
  } catch (error) {
    console.error('Discharge IT items error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to discharge items',
      error: error.message
    });
  }
};

// Requester acknowledges receipt (employee action)
const acknowledgeDischarge = async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.userId;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const request = await ITSupportRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    if (request.status !== 'pending_acknowledgment') {
      return res.status(400).json({ success: false, message: 'Request not ready for acknowledgment' });
    }
    if (!request.employee.equals(user._id)) {
      return res.status(403).json({ success: false, message: 'Only the requester can acknowledge' });
    }

    let signatureUrl = null;
    if (req.file) {
      signatureUrl = req.file.path;
    }

    request.acknowledgmentSignature = {
      name: user.fullName,
      imageUrl: signatureUrl,
      signedBy: user._id,
      signedAt: new Date()
    };
    request.status = 'discharge_complete';
    await request.save();

    res.json({ success: true, message: 'Discharge acknowledged', data: request });
  } catch (error) {
    console.error('Acknowledge discharge error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to acknowledge discharge',
      error: error.message
    });
  }
};


// ===== CORE CRUD =====

const createITRequest = async (req, res) => {
  try {
    console.log('=== CREATE IT SUPPORT REQUEST STARTED ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const {
      ticketNumber,
      requestType,
      title,
      description,
      category,
      subcategory,
      priority,
      urgency,
      businessJustification,
      businessImpact,
      location,
      contactInfo,
      preferredContactMethod,
      requestedItems,
      deviceDetails,
      issueDetails,
      troubleshootingAttempted,
      troubleshootingSteps
    } = req.body;

    if (!ticketNumber) {
      return res.status(400).json({ success: false, message: 'Ticket number is required' });
    }

    if (!title || title.length < 5) {
      return res.status(400).json({ success: false, message: 'Title must be at least 5 characters long' });
    }

    let finalDescription = description;

    if (!finalDescription || finalDescription.length < 10) {
      if (businessJustification && businessJustification.length >= 10) {
        finalDescription = businessJustification;
      } else {
        let parsedRequestedItems = [];
        try {
          if (requestedItems) {
            parsedRequestedItems = typeof requestedItems === 'string' ? JSON.parse(requestedItems) : requestedItems;
          }
        } catch (e) {}

        if (parsedRequestedItems && parsedRequestedItems.length > 0) {
          const itemNames = parsedRequestedItems.filter(item => item.item).map(item => item.item).join(', ');
          finalDescription = `${requestType === 'material_request' ? 'Material request' : 'Technical support'} for: ${itemNames}`;
          if (businessJustification) finalDescription += `. ${businessJustification}`;
        } else {
          finalDescription = requestType === 'material_request'
            ? 'Material request for IT equipment and supplies'
            : 'Technical support request for IT assistance';
          if (title && title.length >= 5) finalDescription = `${finalDescription}: ${title}`;
        }
      }
    }

    if (!finalDescription || finalDescription.length < 10) {
      finalDescription = `IT ${requestType === 'material_request' ? 'Material' : 'Support'} Request - ${new Date().toLocaleDateString()}`;
    }

    let validCategory = category;
    if (!validCategory || validCategory === 'undefined') {
      validCategory = requestType === 'material_request' ? 'hardware' : 'other';
    }
    const validCategories = ['hardware', 'software', 'network', 'mobile', 'security', 'accessories', 'other'];
    if (!validCategories.includes(validCategory)) validCategory = 'other';

    let validSubcategory = subcategory;
    if (!validSubcategory || validSubcategory === 'undefined') {
      const defaultSubcategories = {
        hardware: 'computer', software: 'application', network: 'connectivity',
        mobile: 'device', security: 'access', accessories: 'peripheral', other: 'general'
      };
      validSubcategory = defaultSubcategories[validCategory] || 'general';
    }

    const employee = await User.findById(req.user.userId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    let parsedRequestedItems = [];
    let parsedDeviceDetails = {};
    let parsedIssueDetails = {};
    let parsedContactInfo = {};
    let parsedTroubleshootingSteps = [];

    try {
      if (requestedItems) parsedRequestedItems = typeof requestedItems === 'string' ? JSON.parse(requestedItems) : requestedItems;
      if (deviceDetails) parsedDeviceDetails = typeof deviceDetails === 'string' ? JSON.parse(deviceDetails) : deviceDetails;
      if (issueDetails) parsedIssueDetails = typeof issueDetails === 'string' ? JSON.parse(issueDetails) : issueDetails;
      if (contactInfo) parsedContactInfo = typeof contactInfo === 'string' ? JSON.parse(contactInfo) : contactInfo;
      if (troubleshootingSteps) parsedTroubleshootingSteps = typeof troubleshootingSteps === 'string' ? JSON.parse(troubleshootingSteps) : troubleshootingSteps;
    } catch (error) {
      return res.status(400).json({ success: false, message: 'Invalid data format in request fields' });
    }

    if (requestType === 'material_request') {
      if (!parsedRequestedItems || !Array.isArray(parsedRequestedItems) || parsedRequestedItems.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one item must be specified for material requests' });
      }
    }

    const rawApprovalChain = getITSupportApprovalChain(employee.email);
    if (!rawApprovalChain || rawApprovalChain.length === 0) {
      return res.status(400).json({ success: false, message: 'Unable to determine approval chain. Please contact HR for assistance.' });
    }

    let mappedApprovalChain;
    try {
      mappedApprovalChain = mapApprovalChainForITRequest(rawApprovalChain);
    } catch (mappingError) {
      return res.status(500).json({ success: false, message: 'System error: Failed to map approval chain', error: mappingError.message });
    }

    let attachments = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const fileMetadata = await saveFile(file, 'it-support', 'attachments', null);
          attachments.push({
            name: file.originalname,
            url: fileMetadata.url,
            publicId: fileMetadata.publicId,
            localPath: fileMetadata.localPath,
            size: fileMetadata.bytes,
            mimetype: file.mimetype
          });
        } catch (fileError) {
          console.error('❌ Error processing file:', file.originalname, fileError);
        }
      }
    }

    let totalEstimatedCost = 0;
    if (requestType === 'material_request' && parsedRequestedItems.length > 0) {
      totalEstimatedCost = parsedRequestedItems.reduce((total, item) => total + ((item.estimatedCost || 0) * (item.quantity || 1)), 0);
    }

    const request = new ITSupportRequest({
      ticketNumber,
      employee: req.user.userId,
      requestType,
      title,
      description: finalDescription,
      department: employee.department,
      category: validCategory,
      subcategory: validSubcategory,
      priority: priority || 'medium',
      urgency: urgency || 'normal',
      businessJustification: businessJustification || '',
      businessImpact: businessImpact || '',
      location: location || 'Office',
      contactInfo: {
        phone: parsedContactInfo.phone || employee.phone || '',
        email: employee.email,
        alternateContact: parsedContactInfo.alternateContact || ''
      },
      preferredContactMethod: preferredContactMethod || 'email',
      requestedItems: parsedRequestedItems,
      totalEstimatedCost,
      deviceDetails: parsedDeviceDetails,
      issueDetails: parsedIssueDetails,
      troubleshootingAttempted: troubleshootingAttempted === 'true' || troubleshootingAttempted === true,
      troubleshootingSteps: parsedTroubleshootingSteps,
      attachments,
      status: 'pending_supervisor',
      submittedBy: employee.email,
      submittedAt: new Date(),
      approvalChain: mappedApprovalChain,
      slaMetrics: {
        submittedDate: new Date(),
        targetResponseTime: priority === 'critical' ? 4 : priority === 'high' ? 8 : 24,
        targetResolutionTime: priority === 'critical' ? 24 : priority === 'high' ? 48 : 120,
        slaBreached: false
      }
    });

    await request.save();

    const notifications = [];

    if (mappedApprovalChain.length > 0) {
      const firstApprover = mappedApprovalChain[0];
      notifications.push(
        sendITSupportEmail.newRequestToSupervisor(
          firstApprover.approver.email,
          employee.fullName,
          requestType,
          title,
          request.ticketNumber,
          priority || 'medium',
          totalEstimatedCost || null,
          urgency || 'normal'
        ).catch(error => ({ error, type: 'supervisor' }))
      );
    }

    notifications.push(
      sendITSupportEmail.statusUpdateToEmployee(
        employee.email,
        request.ticketNumber,
        'pending_supervisor',
        'Your IT support request has been successfully submitted and is now awaiting supervisor approval.',
        'System',
        'You will receive email notifications as your request progresses through the approval process.'
      ).catch(error => ({ error, type: 'employee' }))
    );

    const notificationResults = await Promise.allSettled(notifications);
    await request.populate('employee', 'fullName email department');

    res.json({
      success: true,
      message: 'IT support request submitted successfully',
      data: request,
      notifications: {
        sent: notificationResults.filter(r => r.status === 'fulfilled').length,
        failed: notificationResults.filter(r => r.status === 'rejected').length
      }
    });

  } catch (error) {
    console.error('Create IT request error:', error);

    if (req.files && req.files.length > 0) {
      await Promise.allSettled(
        req.files.map(file => {
          if (file.path && fsSync.existsSync(file.path)) {
            return fs.unlink(file.path).catch(e => console.error('File cleanup failed:', e));
          }
        })
      );
    }

    res.status(500).json({ success: false, message: 'Failed to create IT support request', error: error.message });
  }
};


const getEmployeeITRequests = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, priority, requestType } = req.query;

    let filter = { employee: req.user.userId };
    if (status && status !== 'all') filter.status = status;
    if (priority && priority !== 'all') filter.priority = priority;
    if (requestType && requestType !== 'all') filter.requestType = requestType;

    const requests = await ITSupportRequest.find(filter)
      .populate('employee', 'fullName email department')
      .populate('itReview.technicianId', 'fullName')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const totalCount = await ITSupportRequest.countDocuments(filter);

    res.json({
      success: true,
      data: requests,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(totalCount / limit),
        count: requests.length,
        totalRecords: totalCount
      },
      message: `Found ${requests.length} IT support requests`
    });

  } catch (error) {
    console.error('Get employee IT requests error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch IT support requests', error: error.message });
  }
};


const getITRequestDetails = async (req, res) => {
  try {
    const { requestId } = req.params;

    const request = await ITSupportRequest.findById(requestId)
      .populate('employee', 'fullName email department')
      .populate('itReview.technicianId', 'fullName email')
      .populate('financeReview.decidedBy', 'fullName email')
      .populate('resolution.resolvedById', 'fullName email');

    if (!request) {
      return res.status(404).json({ success: false, message: 'IT request not found' });
    }

    const user = await User.findById(req.user.userId);
    const canView =
      request.employee._id.equals(req.user.userId) ||
      user.role === 'admin' ||
      user.role === 'it' ||
      request.approvalChain.some(step => step.approver.email === user.email);

    if (!canView) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.json({ success: true, data: request });

  } catch (error) {
    console.error('Get IT request details error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch IT request details', error: error.message });
  }
};


const getSupervisorITRequests = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const requests = await ITSupportRequest.find({
      'approvalChain': {
        $elemMatch: {
          'approver.email': user.email,
          'status': 'pending'
        }
      },
      status: {
        $in: [
          'pending_supervisor',
          'pending_departmental_head',
          'pending_head_of_business',
          'pending_it_approval'
        ]
      }
    })
    .populate('employee', 'fullName email department')
    .sort({ createdAt: -1 });

    res.json({ success: true, data: requests, count: requests.length });

  } catch (error) {
    console.error('Get supervisor IT requests error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch IT requests', error: error.message });
  }
};


const processSupervisorDecision = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { decision, comments } = req.body;

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const request = await ITSupportRequest.findById(requestId)
      .populate('employee', 'fullName email department');

    if (!request) return res.status(404).json({ success: false, message: 'IT support request not found' });

    const currentStepIndex = request.approvalChain.findIndex(
      step => step.approver.email === user.email && step.status === 'pending'
    );

    if (currentStepIndex === -1) {
      return res.status(403).json({ success: false, message: 'You are not authorized to approve this request or it has already been processed' });
    }

    request.approvalChain[currentStepIndex].status = decision;
    request.approvalChain[currentStepIndex].comments = comments;
    request.approvalChain[currentStepIndex].actionDate = new Date();
    request.approvalChain[currentStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
    request.approvalChain[currentStepIndex].decidedBy = req.user.userId;

    if (decision === 'rejected') {
      request.status = 'supervisor_rejected';
      request.supervisorDecision = { decision: 'rejected', comments, decisionDate: new Date(), decidedBy: req.user.userId };
    } else if (decision === 'approved') {
      request.supervisorDecision = { decision: 'approved', comments, decisionDate: new Date(), decidedBy: req.user.userId };

      const nextPendingStepIndex = request.approvalChain.findIndex(
        (step, idx) => idx > currentStepIndex && step.status === 'pending'
      );

      if (nextPendingStepIndex !== -1) {
        const nextPendingStep = request.approvalChain[nextPendingStepIndex];
        const roleStatusMap = {
          'Supervisor': 'pending_supervisor',
          'Departmental Head': 'pending_departmental_head',
          'Head of Business': 'pending_head_of_business',
          'IT Department - Final Approval': 'pending_it_approval'
        };
        request.status = roleStatusMap[nextPendingStep.approver.role] || 'pending_it_approval';
      } else {
        request.status = 'it_approved';
      }
    }

    await request.save();

    const notifications = [];
    if (decision === 'approved') {
      const nextPendingStep = request.approvalChain.find(step => step.status === 'pending');

      if (nextPendingStep) {
        if (nextPendingStep.approver.role === 'IT Department - Final Approval') {
          const itDepartment = await User.find({ role: 'it' }).select('email fullName');
          if (itDepartment.length > 0) {
            notifications.push(
              sendITSupportEmail.supervisorApprovalToIT(
                itDepartment.map(u => u.email),
                request.employee.fullName,
                request.requestType,
                request.title,
                request.ticketNumber,
                user.fullName,
                request.totalEstimatedCost || null,
                comments
              ).catch(error => ({ error, type: 'it' }))
            );
          }
        } else {
          notifications.push(
            sendEmail({
              to: nextPendingStep.approver.email,
              subject: `IT Support Request Approval Required - ${request.ticketNumber}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
                    <h2 style="color: #0050b3; margin-top: 0;">IT Support Request - Approval Required</h2>
                    <p>Dear ${nextPendingStep.approver.name},</p>
                    <p>An IT support request approved by ${user.fullName} requires your approval.</p>
                    <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                      <table style="width: 100%; border-collapse: collapse;">
                        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td><td>${request.employee.fullName}</td></tr>
                        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Request Type:</strong></td><td>${request.requestType === 'material_request' ? 'Material Request' : 'Technical Issue'}</td></tr>
                        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Title:</strong></td><td>${request.title}</td></tr>
                        <tr><td style="padding: 8px 0;"><strong>Ticket Number:</strong></td><td>${request.ticketNumber}</td></tr>
                      </table>
                    </div>
                    ${comments ? `<div style="background-color: #e6f7ff; border-left: 4px solid #1890ff; padding: 15px; margin: 20px 0;"><h4 style="color: #1890ff; margin-top: 0;">Previous Approver Comments:</h4><p>"${comments}"</p></div>` : ''}
                    <div style="text-align: center; margin: 30px 0;">
                      <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/supervisor/it-support/${request._id}" style="display: inline-block; background-color: #1890ff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">📋 Review & Approve Request</a>
                    </div>
                  </div>
                </div>
              `
            }).catch(error => ({ error, type: 'next_approver' }))
          );
        }
      }

      notifications.push(
        sendITSupportEmail.statusUpdateToEmployee(
          request.employee.email,
          request.ticketNumber,
          'approved',
          `Your IT support request has been approved by ${user.fullName} (${request.approvalChain[currentStepIndex].approver.role}).${nextPendingStep ? ` Awaiting approval from ${nextPendingStep.approver.name}.` : ' All approvals are complete.'}`,
          user.fullName,
          nextPendingStep ? `Next Approver: ${nextPendingStep.approver.name}` : 'Your request will be processed shortly.'
        ).catch(error => ({ error, type: 'employee' }))
      );
    } else {
      notifications.push(
        sendITSupportEmail.statusUpdateToEmployee(
          request.employee.email,
          request.ticketNumber,
          'rejected',
          comments || 'Your IT support request was not approved.',
          user.fullName,
          'Please contact your supervisor for more information or submit a revised request.'
        ).catch(error => ({ error, type: 'employee' }))
      );
    }

    const notificationResults = await Promise.allSettled(notifications);

    res.json({
      success: true,
      message: `IT support request ${decision} successfully`,
      data: request,
      notifications: {
        sent: notificationResults.filter(r => r.status === 'fulfilled').length,
        failed: notificationResults.filter(r => r.status === 'rejected').length
      }
    });

  } catch (error) {
    console.error('Process supervisor decision error:', error);
    res.status(500).json({ success: false, message: 'Failed to process supervisor decision', error: error.message });
  }
};


const getITDepartmentRequests = async (req, res) => {
  try {
    const requests = await ITSupportRequest.find({
      status: { $in: ['pending_it_review', 'it_assigned', 'in_progress', 'waiting_parts'] }
    })
    .populate('employee', 'fullName email department')
    .populate('itReview.technicianId', 'fullName')
    .sort({ createdAt: -1 });

    res.json({ success: true, data: requests, count: requests.length });

  } catch (error) {
    console.error('Get IT department requests error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch IT department requests', error: error.message });
  }
};


const processITDepartmentDecision = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { decision, comments, estimatedCost, technicianId, priorityLevel, estimatedCompletionTime } = req.body;

    const user = await User.findById(req.user.userId);
    const request = await ITSupportRequest.findById(requestId)
      .populate('employee', 'fullName email department');

    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    let normalizedDecision = decision;
    let newStatus = request.status;

    if (decision === 'approved') {
      normalizedDecision = 'approve';
      newStatus = technicianId ? 'it_assigned' : 'it_approved';
    } else if (decision === 'rejected') {
      normalizedDecision = 'reject';
      newStatus = 'it_rejected';
    } else if (decision === 'resolved') {
      normalizedDecision = 'resolved';
      newStatus = request.requestType === 'material_request' ? 'pending_discharge' : 'resolved';
    }

    request.itReview = {
      decision: normalizedDecision,
      comments,
      estimatedCost: estimatedCost || 0,
      technicianId: technicianId || req.user.userId,
      reviewDate: new Date(),
      decidedBy: req.user.userId,
      priorityLevel: priorityLevel || request.priority,
      estimatedCompletionTime
    };
    request.status = newStatus;
    await request.save();

    const notifications = [];
    if (normalizedDecision === 'approve') {
      notifications.push(
        sendITSupportEmail.statusUpdateToEmployee(
          request.employee.email, request.ticketNumber, 'it_approved',
          `Your IT request has been approved by the IT department. Work will begin shortly.`,
          user.fullName,
          estimatedCompletionTime ? `Estimated completion: ${estimatedCompletionTime}` : 'Work will begin shortly.'
        ).catch(error => ({ error, type: 'employee' }))
      );
    } else if (normalizedDecision === 'resolved') {
      notifications.push(
        sendITSupportEmail.resolutionToEmployee(
          request.employee.email, request.ticketNumber, request.requestType,
          comments || 'Your IT request has been resolved.', user.fullName
        ).catch(error => ({ error, type: 'employee' }))
      );
    } else if (normalizedDecision === 'reject') {
      notifications.push(
        sendITSupportEmail.statusUpdateToEmployee(
          request.employee.email, request.ticketNumber, 'rejected',
          comments || 'Your IT request has been rejected by the IT department.', user.fullName
        ).catch(error => ({ error, type: 'employee' }))
      );
    }

    const notificationResults = await Promise.allSettled(notifications);

    res.json({
      success: true,
      message: `IT request ${decision} successfully`,
      data: request,
      notifications: {
        sent: notificationResults.filter(r => r.status === 'fulfilled').length,
        failed: notificationResults.filter(r => r.status === 'rejected').length
      }
    });

  } catch (error) {
    console.error('Process IT department decision error:', error);
    res.status(500).json({ success: false, message: 'Failed to process IT department decision', error: error.message });
  }
};


const getFinanceITRequests = async (req, res) => {
  try {
    const requests = await ITSupportRequest.find({
      $or: [
        { status: 'pending_finance' },
        { requestType: 'material_request', totalEstimatedCost: { $gt: 100000 } }
      ]
    })
    .populate('employee', 'fullName email department')
    .populate('itReview.technicianId', 'fullName')
    .sort({ createdAt: -1 });

    res.json({ success: true, data: requests, count: requests.length });

  } catch (error) {
    console.error('Get finance IT requests error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch finance IT requests', error: error.message });
  }
};


const processFinanceDecision = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { decision, comments, amountApproved, disbursementAmount, budgetCodeId } = req.body;

    const user = await User.findById(req.user.userId);
    const request = await ITSupportRequest.findById(requestId)
      .populate('employee', 'fullName email department');

    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    const financeStepIndex = request.approvalChain.findIndex(step =>
      step.approver.email === user.email &&
      step.approver.role === 'Finance Officer' &&
      step.status === 'pending'
    );

    if (financeStepIndex === -1) {
      return res.status(403).json({ success: false, message: 'This request is not pending your approval.' });
    }

    const financeStep = request.approvalChain[financeStepIndex];
    const allPreviousApproved = request.approvalChain
      .filter(s => s.level < financeStep.level)
      .every(s => s.status === 'approved');

    if (!allPreviousApproved) {
      return res.status(400).json({ success: false, message: 'Cannot process finance approval until all previous levels are approved' });
    }

    if (decision === 'approved') {
      const finalAmount = disbursementAmount || amountApproved || request.amountRequested;

      request.approvalChain[financeStepIndex].status = 'approved';
      request.approvalChain[financeStepIndex].comments = comments;
      request.approvalChain[financeStepIndex].actionDate = new Date();
      request.approvalChain[financeStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
      request.approvalChain[financeStepIndex].decidedBy = req.user.userId;

      request.financeDecision = { decision: 'approved', comments, decisionDate: new Date() };
      request.status = disbursementAmount ? 'disbursed' : 'approved';
      if (amountApproved) request.amountApproved = parseFloat(amountApproved);
      request.financeOfficer = req.user.userId;

      await request.save();

      return res.json({ success: true, message: `Request ${decision} by finance`, data: request });
    } else {
      request.status = 'denied';
      request.financeDecision = { decision: 'rejected', comments, decisionDate: new Date() };
      request.approvalChain[financeStepIndex].status = 'rejected';
      request.approvalChain[financeStepIndex].comments = comments;
      request.approvalChain[financeStepIndex].actionDate = new Date();
      request.approvalChain[financeStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
      request.approvalChain[financeStepIndex].decidedBy = req.user.userId;

      await request.save();

      return res.json({ success: true, message: 'Request rejected by finance', data: request });
    }

  } catch (error) {
    console.error('Process finance decision error:', error);
    res.status(500).json({ success: false, message: 'Failed to process finance decision', error: error.message });
  }
};


const saveDraft = async (req, res) => {
  try {
    const { ticketNumber, requestType, title, description, category, subcategory, priority, urgency, requestedItems, deviceDetails, issueDetails } = req.body;

    const employee = await User.findById(req.user.userId);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    let parsedRequestedItems = [];
    let parsedDeviceDetails = {};
    let parsedIssueDetails = {};

    try {
      if (requestedItems) {
        parsedRequestedItems = typeof requestedItems === 'string' ? JSON.parse(requestedItems) : requestedItems;
        if (!Array.isArray(parsedRequestedItems)) parsedRequestedItems = [];
      }
      if (deviceDetails) {
        parsedDeviceDetails = typeof deviceDetails === 'string' ? JSON.parse(deviceDetails) : deviceDetails;
        if (typeof parsedDeviceDetails !== 'object' || parsedDeviceDetails === null) parsedDeviceDetails = {};
      }
      if (issueDetails) {
        parsedIssueDetails = typeof issueDetails === 'string' ? JSON.parse(issueDetails) : issueDetails;
        if (typeof parsedIssueDetails !== 'object' || parsedIssueDetails === null) parsedIssueDetails = {};
      }
    } catch (error) {
      console.warn('JSON parsing warning for draft:', error);
    }

    const draftRequest = new ITSupportRequest({
      ticketNumber: ticketNumber || `DRAFT-${Date.now()}`,
      employee: req.user.userId,
      requestType: requestType || 'technical_issue',
      title: title || 'Draft IT Request',
      description: description || 'Draft - to be completed',
      department: employee.department,
      category: category || 'other',
      subcategory: subcategory || 'other',
      priority: priority || 'medium',
      urgency: urgency || 'normal',
      requestedItems: parsedRequestedItems,
      deviceDetails: parsedDeviceDetails,
      issueDetails: parsedIssueDetails,
      contactInfo: { phone: employee.phone || '', email: employee.email },
      status: 'draft',
      approvalChain: []
    });

    await draftRequest.save();
    await draftRequest.populate('employee', 'fullName email department');

    res.json({ success: true, message: 'Draft saved successfully', data: draftRequest });

  } catch (error) {
    console.error('Save draft error:', error);
    res.status(500).json({ success: false, message: 'Failed to save draft', error: error.message });
  }
};


const getITRequestStats = async (req, res) => {
  try {
    const { startDate, endDate, department, status, requestType } = req.query;

    let matchFilter = {};
    if (startDate || endDate) {
      matchFilter.createdAt = {};
      if (startDate) matchFilter.createdAt.$gte = new Date(startDate);
      if (endDate) matchFilter.createdAt.$lte = new Date(endDate);
    }
    if (department) {
      const users = await User.find({ department }).select('_id');
      matchFilter.employee = { $in: users.map(u => u._id) };
    }
    if (status) matchFilter.status = status;
    if (requestType) matchFilter.requestType = requestType;

    const stats = await ITSupportRequest.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          avgResolutionTime: { $avg: '$slaMetrics.resolutionTime' },
          statusBreakdown: { $push: '$status' },
          categoryBreakdown: { $push: '$category' },
          priorityBreakdown: { $push: '$priority' },
          requestTypeBreakdown: { $push: '$requestType' }
        }
      }
    ]);

    const statusCounts = {};
    const categoryCounts = {};
    const priorityCounts = {};
    const requestTypeCounts = {};

    if (stats.length > 0) {
      stats[0].statusBreakdown.forEach(s => { statusCounts[s] = (statusCounts[s] || 0) + 1; });
      stats[0].categoryBreakdown.forEach(c => { categoryCounts[c] = (categoryCounts[c] || 0) + 1; });
      stats[0].priorityBreakdown.forEach(p => { priorityCounts[p] = (priorityCounts[p] || 0) + 1; });
      stats[0].requestTypeBreakdown.forEach(t => { requestTypeCounts[t] = (requestTypeCounts[t] || 0) + 1; });
    }

    res.json({
      success: true,
      data: {
        summary: stats.length > 0
          ? { totalRequests: stats[0].totalRequests, avgResolutionTime: Math.round(stats[0].avgResolutionTime || 0) }
          : { totalRequests: 0, avgResolutionTime: 0 },
        breakdown: { status: statusCounts, category: categoryCounts, priority: priorityCounts, requestType: requestTypeCounts }
      }
    });

  } catch (error) {
    console.error('Get IT request stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch IT request statistics', error: error.message });
  }
};


const getInventoryStatus = async (req, res) => {
  try {
    const mockInventoryData = [
      { item: 'Wireless Mouse', category: 'accessories', inStock: 15, allocated: 8, available: 7, reorderLevel: 10, needsReorder: false },
      { item: 'HDMI Cable', category: 'accessories', inStock: 3, allocated: 2, available: 1, reorderLevel: 5, needsReorder: true },
      { item: 'Laptop Charger', category: 'hardware', inStock: 8, allocated: 5, available: 3, reorderLevel: 4, needsReorder: true }
    ];
    res.json({ success: true, data: mockInventoryData, message: 'Inventory status data (mock)' });
  } catch (error) {
    console.error('Get inventory status error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch inventory status', error: error.message });
  }
};


const getAssetAnalytics = async (req, res) => {
  try {
    const [totalAssets, assetsByCategory, recentAssignments] = await Promise.all([
      ITSupportRequest.aggregate([{ $unwind: '$assetAssignment.assignedAssets' }, { $count: 'totalAssets' }]),
      ITSupportRequest.aggregate([
        { $unwind: '$assetAssignment.assignedAssets' },
        { $group: { _id: '$category', assetCount: { $sum: 1 }, totalValue: { $sum: '$assetAssignment.totalAssignedValue' } } },
        { $sort: { assetCount: -1 } }
      ]),
      ITSupportRequest.find({
        'assetAssignment.assignedAssets': { $exists: true, $ne: [] },
        'assetAssignment.assignedAssets.assignmentDate': { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      })
      .populate('employee', 'fullName department')
      .sort({ 'assetAssignment.assignedAssets.assignmentDate': -1 })
      .limit(10)
    ]);

    res.json({ success: true, data: { totalAssets: totalAssets[0]?.totalAssets || 0, assetsByCategory, recentAssignments } });

  } catch (error) {
    console.error('Get asset analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch asset analytics', error: error.message });
  }
};


const getCategoryAnalytics = async (req, res) => {
  try {
    const { period = 'monthly' } = req.query;

    let startDate = new Date();
    switch (period) {
      case 'weekly': startDate.setDate(startDate.getDate() - 7); break;
      case 'quarterly': startDate.setMonth(startDate.getMonth() - 3); break;
      default: startDate.setMonth(startDate.getMonth() - 1);
    }

    const analytics = await ITSupportRequest.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          resolvedCount: { $sum: { $cond: [{ $in: ['$status', ['resolved', 'closed']] }, 1, 0] } },
          avgResolutionTime: { $avg: '$slaMetrics.resolutionTime' },
          criticalCount: { $sum: { $cond: [{ $eq: ['$priority', 'critical'] }, 1, 0] } }
        }
      },
      { $addFields: { resolutionRate: { $multiply: [{ $divide: ['$resolvedCount', '$count'] }, 100] } } },
      { $sort: { count: -1 } }
    ]);

    res.json({ success: true, data: analytics, period });

  } catch (error) {
    console.error('Get category analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch category analytics', error: error.message });
  }
};


const getDashboardStats = async (req, res) => {
  try {
    const { role, userId } = req.user;
    const user = await User.findById(userId);

    let filter = {};
    if (role === 'employee') {
      filter.employee = userId;
    } else if (role === 'supervisor') {
      filter['approvalChain.approver.email'] = user.email;
    } else if (role === 'it') {
      filter.$or = [
        { status: { $in: ['pending_it_review', 'supervisor_approved', 'it_assigned', 'in_progress', 'waiting_parts'] } },
        { 'itReview.technicianId': userId }
      ];
    } else if (role === 'finance') {
      filter.$or = [
        { status: 'pending_finance' },
        { requestType: 'material_request', totalEstimatedCost: { $gt: 100000 } }
      ];
    }

    const [totalCount, pendingCount, inProgressCount, resolvedCount, materialRequestCount, technicalIssueCount, criticalCount, recentRequests, slaBreached] = await Promise.all([
      ITSupportRequest.countDocuments(filter),
      ITSupportRequest.countDocuments({ ...filter, status: { $in: ['pending_supervisor', 'pending_it_review', 'pending_finance'] } }),
      ITSupportRequest.countDocuments({ ...filter, status: { $in: ['it_assigned', 'in_progress', 'waiting_parts'] } }),
      ITSupportRequest.countDocuments({ ...filter, status: { $in: ['resolved', 'closed'] } }),
      ITSupportRequest.countDocuments({ ...filter, requestType: 'material_request' }),
      ITSupportRequest.countDocuments({ ...filter, requestType: 'technical_issue' }),
      ITSupportRequest.countDocuments({ ...filter, priority: 'critical', status: { $nin: ['resolved', 'closed', 'rejected'] } }),
      ITSupportRequest.find(filter).populate('employee', 'fullName email department').sort({ createdAt: -1 }).limit(10),
      ITSupportRequest.countDocuments({ ...filter, 'slaMetrics.slaBreached': true, status: { $nin: ['resolved', 'closed'] } })
    ]);

    res.json({
      success: true,
      data: {
        summary: { total: totalCount, pending: pendingCount, inProgress: inProgressCount, resolved: resolvedCount, materialRequests: materialRequestCount, technicalIssues: technicalIssueCount, critical: criticalCount, slaBreached },
        recent: recentRequests,
        trends: {
          resolutionRate: totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0,
          avgResponseTime: 45,
          slaCompliance: totalCount > 0 ? Math.round(((totalCount - slaBreached) / totalCount) * 100) : 100
        }
      }
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard statistics', error: error.message });
  }
};


const getITRequestsByRole = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const { status, page = 1, limit = 20, requestType, priority } = req.query;

    let query = {};
    let baseFilter = {};
    if (status) baseFilter.status = status;
    if (requestType) baseFilter.requestType = requestType;
    if (priority) baseFilter.priority = priority;

    switch (user.role) {
      case 'employee':
        query = { ...baseFilter, employee: req.user.userId };
        break;
      case 'supervisor':
        query = { ...baseFilter, 'approvalChain': { $elemMatch: { 'approver.email': user.email, 'status': 'pending' } } };
        break;
      case 'it':
        query = {
          ...baseFilter,
          $or: [
            { status: 'pending_it_approval' },
            { status: { $in: ['it_approved', 'it_assigned', 'in_progress', 'waiting_parts'] } },
            { 'itReview.technicianId': user._id },
            { status: 'resolved', 'itReview.technicianId': user._id }
          ]
        };
        break;
      case 'finance':
        query = {
          ...baseFilter,
          $or: [
            { status: 'pending_finance' },
            { requestType: 'material_request', totalEstimatedCost: { $gt: 100000 } },
            { status: 'it_approved', $or: [{ 'itReview.estimatedCost': { $gt: 100000 } }, { totalEstimatedCost: { $gt: 100000 } }] }
          ]
        };
        break;
      case 'admin':
        query = baseFilter;
        break;
      default:
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const requests = await ITSupportRequest.find(query)
      .populate('employee', 'fullName email department')
      .populate('itReview.technicianId', 'fullName')
      .populate('financeReview.decidedBy', 'fullName')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await ITSupportRequest.countDocuments(query);

    res.json({
      success: true,
      data: requests,
      pagination: { current: parseInt(page), total: Math.ceil(total / limit), count: requests.length, totalRecords: total },
      role: user.role,
      message: `Found ${requests.length} IT support requests`
    });

  } catch (error) {
    console.error('Get IT requests by role error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch IT requests', error: error.message });
  }
};


const updateFulfillmentStatus = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status, workLog, resolution, timeSpent, comments } = req.body;

    const user = await User.findById(req.user.userId);
    const request = await ITSupportRequest.findById(requestId).populate('employee', 'fullName email department');

    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    const canUpdate = user.role === 'admin' || user.role === 'it' || request.itReview?.technicianId?.equals(user._id);
    if (!canUpdate) return res.status(403).json({ success: false, message: 'Access denied' });

    if (status) request.status = status;

    if (workLog) {
      if (!request.itReview.workLog) request.itReview.workLog = [];
      request.itReview.workLog.push({ date: new Date(), technician: user.fullName, activity: workLog, timeSpent: timeSpent ? parseInt(timeSpent) : 0, status: status || request.status });
    }

    if (status === 'resolved' && resolution) {
      request.resolution = { description: resolution, resolvedBy: user.fullName, resolvedById: user._id, resolvedDate: new Date(), solution: resolution };
      if (request.submittedAt) {
        request.slaMetrics.resolutionTime = Math.floor((new Date() - new Date(request.submittedAt)) / (1000 * 60));
      }
    }

    await request.save();

    const notifications = [];
    if (status === 'resolved') {
      notifications.push(
        sendITSupportEmail.resolutionToEmployee(
          request.employee.email, request.ticketNumber, request.requestType, resolution, user.fullName,
          request.requestType === 'material_request' ? 'Items have been delivered to your specified location.' : ''
        ).catch(error => ({ error, type: 'employee' }))
      );
    } else if (status === 'in_progress') {
      notifications.push(
        sendITSupportEmail.statusUpdateToEmployee(
          request.employee.email, request.ticketNumber, 'in_progress',
          workLog || `Work has started on your IT request by ${user.fullName}.`, user.fullName,
          'You will receive updates as work progresses.'
        ).catch(error => ({ error, type: 'employee' }))
      );
    }

    const notificationResults = await Promise.allSettled(notifications);

    res.json({
      success: true,
      message: 'Fulfillment status updated successfully',
      data: request,
      notifications: { sent: notificationResults.filter(r => r.status === 'fulfilled').length, failed: notificationResults.filter(r => r.status === 'rejected').length }
    });

  } catch (error) {
    console.error('Update fulfillment status error:', error);
    res.status(500).json({ success: false, message: 'Failed to update fulfillment status', error: error.message });
  }
};


const updateAssetAssignment = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { assignedAssets, totalAssignedValue } = req.body;

    const user = await User.findById(req.user.userId);
    const request = await ITSupportRequest.findById(requestId).populate('employee', 'fullName email department');

    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    const canUpdate = user.role === 'admin' || user.role === 'it';
    if (!canUpdate) return res.status(403).json({ success: false, message: 'Access denied' });

    request.assetAssignment = {
      assignedAssets: assignedAssets.map(asset => ({ ...asset, assignmentDate: new Date() })),
      totalAssignedValue: totalAssignedValue || 0
    };

    if (assignedAssets && assignedAssets.length > 0) {
      request.status = request.requestType === 'material_request' ? 'pending_discharge' : 'resolved';
      request.resolution = {
        description: `Assets assigned: ${assignedAssets.map(a => a.description).join(', ')}`,
        resolvedBy: user.fullName,
        resolvedById: user._id,
        resolvedDate: new Date()
      };
    }

    await request.save();

    if (assignedAssets && assignedAssets.length > 0) {
      await sendEmail({
        to: request.employee.email,
        subject: 'IT Assets Assigned to You',
        html: `
          <h3>IT Assets Have Been Assigned to You</h3>
          <p>Dear ${request.employee.fullName},</p>
          <p>The following IT assets have been assigned to you:</p>
          <ul>${assignedAssets.map(asset => `<li>${asset.description}${asset.assetTag ? ` (Tag: ${asset.assetTag})` : ''}</li>`).join('')}</ul>
          <p>Ticket Number: ${request.ticketNumber} | Assigned by: ${user.fullName}</p>
        `
      }).catch(error => console.error('Failed to send asset assignment notification:', error));
    }

    res.json({ success: true, message: 'Asset assignment updated successfully', data: request });

  } catch (error) {
    console.error('Update asset assignment error:', error);
    res.status(500).json({ success: false, message: 'Failed to update asset assignment', error: error.message });
  }
};


const updateITRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const updateData = req.body;

    const request = await ITSupportRequest.findById(requestId);
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    const user = await User.findById(req.user.userId);
    const canUpdate = request.employee.equals(req.user.userId) || user.role === 'admin' || user.role === 'it';
    if (!canUpdate) return res.status(403).json({ success: false, message: 'Access denied' });

    const updatableStatuses = ['draft', 'pending_supervisor', 'it_assigned', 'in_progress'];
    if (!updatableStatuses.includes(request.status)) {
      return res.status(400).json({ success: false, message: 'Cannot update request in current status' });
    }

    const allowedFields = ['title', 'description', 'category', 'subcategory', 'priority', 'urgency', 'businessJustification', 'businessImpact', 'location', 'requestedItems', 'deviceDetails', 'issueDetails', 'troubleshootingSteps'];

    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        if (['requestedItems', 'deviceDetails', 'issueDetails', 'troubleshootingSteps'].includes(field)) {
          try { request[field] = typeof updateData[field] === 'string' ? JSON.parse(updateData[field]) : updateData[field]; } catch (error) {}
        } else {
          request[field] = updateData[field];
        }
      }
    });

    await request.save();
    await request.populate('employee', 'fullName email department');

    res.json({ success: true, message: 'IT request updated successfully', data: request });

  } catch (error) {
    console.error('Update IT request error:', error);
    res.status(500).json({ success: false, message: 'Failed to update IT request', error: error.message });
  }
};


const getAllITRequests = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, department, priority, requestType, startDate, endDate } = req.query;

    let filter = {};
    if (status && status !== 'all') filter.status = status;
    if (priority && priority !== 'all') filter.priority = priority;
    if (requestType && requestType !== 'all') filter.requestType = requestType;
    if (department && department !== 'all') {
      const users = await User.find({ department }).select('_id');
      filter.employee = { $in: users.map(u => u._id) };
    }
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const requests = await ITSupportRequest.find(filter)
      .populate('employee', 'fullName email department')
      .populate('itReview.technicianId', 'fullName')
      .populate('financeReview.decidedBy', 'fullName')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const totalCount = await ITSupportRequest.countDocuments(filter);

    res.json({
      success: true,
      data: requests,
      pagination: { current: parseInt(page), total: Math.ceil(totalCount / limit), count: requests.length, totalRecords: totalCount }
    });

  } catch (error) {
    console.error('Get all IT requests error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch IT requests', error: error.message });
  }
};


const getApprovalChainPreview = async (req, res) => {
  try {
    const employee = await User.findById(req.user.userId);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    const rawApprovalChain = getITSupportApprovalChain(employee.email);
    if (!rawApprovalChain || rawApprovalChain.length === 0) {
      return res.status(400).json({ success: false, message: 'Unable to determine approval chain' });
    }

    const mappedChain = mapApprovalChainForITRequest(rawApprovalChain);

    res.json({ success: true, data: mappedChain, message: `Found ${mappedChain.length} approval levels` });

  } catch (error) {
    console.error('Get approval chain preview error:', error);
    res.status(500).json({ success: false, message: 'Failed to get approval chain preview', error: error.message });
  }
};


const deleteITRequest = async (req, res) => {
  try {
    const { requestId } = req.params;

    const request = await ITSupportRequest.findById(requestId);
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    const user = await User.findById(req.user.userId);
    const canDelete = request.employee.equals(req.user.userId) || user.role === 'admin';
    if (!canDelete) return res.status(403).json({ success: false, message: 'Access denied' });

    if (request.status !== 'draft') {
      return res.status(400).json({ success: false, message: 'Can only delete draft requests' });
    }

    if (request.attachments && request.attachments.length > 0) {
      const deleteResult = await deleteFiles(request.attachments);
      console.log('   ✓ Cleanup result:', deleteResult);
    }

    await ITSupportRequest.findByIdAndDelete(requestId);

    res.json({ success: true, message: 'Draft IT request deleted successfully' });

  } catch (error) {
    console.error('Delete IT request error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete IT request', error: error.message });
  }
};


// ===== EXPORTS =====
module.exports = {
  // Core CRUD
  createITRequest,
  updateITRequest,
  deleteITRequest,

  // Employee
  getEmployeeITRequests,
  getITRequestDetails,

  // Supervisor
  getSupervisorITRequests,
  processSupervisorDecision,

  // IT Department
  getITDepartmentRequests,
  processITDepartmentDecision,
  updateFulfillmentStatus,
  updateAssetAssignment,

  // Finance
  getFinanceITRequests,
  processFinanceDecision,

  // Admin
  getAllITRequests,

  // Utility
  getApprovalChainPreview,
  getITRequestsByRole,

  // Analytics
  getDashboardStats,
  getCategoryAnalytics,
  getAssetAnalytics,
  getInventoryStatus,
  getITRequestStats,

  // Draft
  saveDraft,

  // ✅ Discharge & Acknowledgment — previously missing from exports
  dischargeITItems,
  acknowledgeDischarge
};










// // IT discharges items (IT staff action)
// const dischargeITItems = async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const { dischargedItems } = req.body;
//     const userId = req.user.userId;
//     const user = await User.findById(userId);
//     if (!user || (user.role !== 'it' && user.role !== 'admin')) {
//       return res.status(403).json({ success: false, message: 'Not authorized' });
//     }

//     const request = await ITSupportRequest.findById(requestId);
//     if (!request) {
//       return res.status(404).json({ success: false, message: 'Request not found' });
//     }
//     if (request.status !== 'it_approved' && request.status !== 'pending_discharge') {
//       return res.status(400).json({ success: false, message: 'Request not ready for discharge' });
//     }

//     // Parse dischargedItems (array of {item, quantity, assetTag, serialNumber})
//     let parsedItems = [];
//     try {
//       parsedItems = typeof dischargedItems === 'string' ? JSON.parse(dischargedItems) : dischargedItems;
//     } catch (e) {
//       return res.status(400).json({ success: false, message: 'Invalid dischargedItems format' });
//     }

//     // Handle signature upload
//     let signatureUrl = null;
//     if (req.file) {
//       // Move file to permanent location if needed
//       signatureUrl = req.file.path;
//     }

//     request.dischargedItems = parsedItems;
//     request.dischargeSignature = {
//       name: user.fullName,
//       imageUrl: signatureUrl,
//       signedBy: user._id,
//       signedAt: new Date()
//     };
//     request.status = 'pending_acknowledgment';
//     await request.save();

//     res.json({ success: true, message: 'Items discharged, awaiting requester acknowledgment', data: request });
//   } catch (error) {
//     console.error('Discharge IT items error:', error);
//     res.status(500).json({ success: false, message: 'Failed to discharge items', error: error.message });
//   }
// };

// // Requester acknowledges receipt (employee action)
// const acknowledgeDischarge = async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const userId = req.user.userId;
//     const user = await User.findById(userId);
//     if (!user) {
//       return res.status(403).json({ success: false, message: 'Not authorized' });
//     }

//     const request = await ITSupportRequest.findById(requestId);
//     if (!request) {
//       return res.status(404).json({ success: false, message: 'Request not found' });
//     }
//     if (request.status !== 'pending_acknowledgment') {
//       return res.status(400).json({ success: false, message: 'Request not ready for acknowledgment' });
//     }
//     if (!request.employee.equals(user._id)) {
//       return res.status(403).json({ success: false, message: 'Only the requester can acknowledge' });
//     }

//     // Handle signature upload
//     let signatureUrl = null;
//     if (req.file) {
//       signatureUrl = req.file.path;
//     }

//     request.acknowledgmentSignature = {
//       name: user.fullName,
//       imageUrl: signatureUrl,
//       signedBy: user._id,
//       signedAt: new Date()
//     };
//     request.status = 'discharge_complete';
//     await request.save();

//     res.json({ success: true, message: 'Discharge acknowledged', data: request });
//   } catch (error) {
//     console.error('Acknowledge discharge error:', error);
//     res.status(500).json({ success: false, message: 'Failed to acknowledge discharge', error: error.message });
//   }
// };
// const ITSupportRequest = require('../models/ITSupportRequest');
// const User = require('../models/User');
// const { getApprovalChain } = require('../config/departmentStructure');
// const { sendITSupportEmail, sendEmail } = require('../services/emailService');
// const { getITSupportApprovalChain } = require('../config/itSupportApprovalChain');
// const { 
//   saveFile, 
//   deleteFile,
//   deleteFiles,
//   STORAGE_CATEGORIES 
// } = require('../utils/localFileStorage');
// const fs = require('fs').promises;
// const fsSync = require('fs');
// const path = require('path');


// /**
//  * Maps raw approval chain from getITSupportApprovalChain() to ITSupportRequest schema format
//  * @param {Array} rawApprovalChain - Raw approval chain from config
//  * @returns {Array} Properly formatted approval chain for ITSupportRequest model
//  */
// const mapApprovalChainForITRequest = (rawApprovalChain) => {
//   if (!rawApprovalChain || !Array.isArray(rawApprovalChain)) {
//     throw new Error('Invalid approval chain provided');
//   }

//   return rawApprovalChain.map((step, index) => {
//     // Extract approver details properly
//     const approverData = step.approver || {};
    
//     // Validate that critical fields exist
//     const approverName = String(approverData.name || 'Unknown Approver').trim();
//     const approverEmail = String(approverData.email || '').trim().toLowerCase();
//     const approverRole = String(approverData.role || approverData.position || 'Approver').trim();
//     const approverDept = String(approverData.department || '').trim();

//     // Validate name
//     if (!approverName || approverName === 'Unknown Approver') {
//       console.error(`❌ Level ${index + 1}: Missing approver name`);
//       throw new Error(`Approval chain configuration error: Missing approver name at level ${index + 1}`);
//     }

//     // Validate email
//     if (!approverEmail || approverEmail.length === 0) {
//       console.error(`❌ Level ${index + 1}: Missing approver email`);
//       throw new Error(`Approval chain configuration error: Missing approver email at level ${index + 1}`);
//     }

//     // Validate email format
//     const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
//     if (!emailRegex.test(approverEmail)) {
//       console.error(`❌ Level ${index + 1}: Invalid email format: ${approverEmail}`);
//       throw new Error(`Approval chain configuration error: Invalid email at level ${index + 1}`);
//     }

//     console.log(`  Level ${index + 1}: ${approverName} (${approverRole}) - ${approverEmail}${approverDept ? ` [${approverDept}]` : ''}`);

//     return {
//       level: step.level || (index + 1),
//       approver: {
//         name: approverName,
//         email: approverEmail,
//         role: approverRole,
//         department: approverDept
//       },
//       status: step.status || (index === 0 ? 'pending' : 'pending'),
//       assignedDate: index === 0 ? new Date() : null,
//       comments: '',
//       actionDate: null,
//       actionTime: null,
//       decidedBy: null
//     };
//   });
// };


// // Create new IT support request
// const createITRequest = async (req, res) => {
//   try {
//     console.log('=== CREATE IT SUPPORT REQUEST STARTED ===');
//     console.log('Request body:', JSON.stringify(req.body, null, 2));

//     const {
//       ticketNumber,
//       requestType,
//       title,
//       description,
//       category,
//       subcategory,
//       priority,
//       urgency,
//       businessJustification,
//       businessImpact,
//       location,
//       contactInfo,
//       preferredContactMethod,
//       requestedItems,
//       deviceDetails,
//       issueDetails,
//       troubleshootingAttempted,
//       troubleshootingSteps
//     } = req.body;

//     // Validate required fields
//     if (!ticketNumber) {
//       return res.status(400).json({
//         success: false,
//         message: 'Ticket number is required'
//       });
//     }

//     if (!title || title.length < 5) {
//       return res.status(400).json({
//         success: false,
//         message: 'Title must be at least 5 characters long'
//       });
//     }

//     // Enhanced description validation and generation
//     let finalDescription = description;
    
//     if (!finalDescription || finalDescription.length < 10) {
//       // Try to create a meaningful description from available data
//       if (businessJustification && businessJustification.length >= 10) {
//         finalDescription = businessJustification;
//       } else {
//         // Parse requested items if available
//         let parsedRequestedItems = [];
//         try {
//           if (requestedItems) {
//             parsedRequestedItems = typeof requestedItems === 'string' ? JSON.parse(requestedItems) : requestedItems;
//           }
//         } catch (e) {
//           // Continue with empty array
//         }
        
//         if (parsedRequestedItems && parsedRequestedItems.length > 0) {
//           const itemNames = parsedRequestedItems
//             .filter(item => item.item)
//             .map(item => item.item)
//             .join(', ');
          
//           finalDescription = `${requestType === 'material_request' ? 'Material request' : 'Technical support'} for: ${itemNames}`;
          
//           if (businessJustification) {
//             finalDescription += `. ${businessJustification}`;
//           }
//         } else {
//           finalDescription = requestType === 'material_request' 
//             ? 'Material request for IT equipment and supplies'
//             : 'Technical support request for IT assistance';
          
//           if (title && title.length >= 5) {
//             finalDescription = `${finalDescription}: ${title}`;
//           }
//         }
//       }
//     }

//     // Final check - ensure we have at least 10 characters
//     if (!finalDescription || finalDescription.length < 10) {
//       finalDescription = `IT ${requestType === 'material_request' ? 'Material' : 'Support'} Request - ${new Date().toLocaleDateString()}`;
//     }

//     // Validate and set proper category
//     let validCategory = category;
//     if (!validCategory || validCategory === 'undefined') {
//       validCategory = requestType === 'material_request' ? 'hardware' : 'other';
//     }

//     // Validate category against enum values
//     const validCategories = ['hardware', 'software', 'network', 'mobile', 'security', 'accessories', 'other'];
//     if (!validCategories.includes(validCategory)) {
//       validCategory = 'other';
//     }

//     // Validate and set proper subcategory
//     let validSubcategory = subcategory;
//     if (!validSubcategory || validSubcategory === 'undefined') {
//       const defaultSubcategories = {
//         'hardware': 'computer',
//         'software': 'application',
//         'network': 'connectivity',
//         'mobile': 'device',
//         'security': 'access',
//         'accessories': 'peripheral',
//         'other': 'general'
//       };
//       validSubcategory = defaultSubcategories[validCategory] || 'general';
//     }

//     console.log('Final description:', finalDescription);
//     console.log('Valid category:', validCategory);
//     console.log('Valid subcategory:', validSubcategory);

//     // Get user details
//     const employee = await User.findById(req.user.userId);
//     if (!employee) {
//       return res.status(404).json({ 
//         success: false, 
//         message: 'Employee not found' 
//       });
//     }

//     console.log('Employee details:', {
//       fullName: employee.fullName,
//       department: employee.department,
//       email: employee.email
//     });

//     // Parse complex fields if they're strings
//     let parsedRequestedItems = [];
//     let parsedDeviceDetails = {};
//     let parsedIssueDetails = {};
//     let parsedContactInfo = {};
//     let parsedTroubleshootingSteps = [];

//     try {
//       if (requestedItems) {
//         parsedRequestedItems = typeof requestedItems === 'string' ? JSON.parse(requestedItems) : requestedItems;
//       }
//       if (deviceDetails) {
//         parsedDeviceDetails = typeof deviceDetails === 'string' ? JSON.parse(deviceDetails) : deviceDetails;
//       }
//       if (issueDetails) {
//         parsedIssueDetails = typeof issueDetails === 'string' ? JSON.parse(issueDetails) : issueDetails;
//       }
//       if (contactInfo) {
//         parsedContactInfo = typeof contactInfo === 'string' ? JSON.parse(contactInfo) : contactInfo;
//       }
//       if (troubleshootingSteps) {
//         parsedTroubleshootingSteps = typeof troubleshootingSteps === 'string' ? JSON.parse(troubleshootingSteps) : troubleshootingSteps;
//       }
//     } catch (error) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid data format in request fields'
//       });
//     }

//     // Validate request type specific fields
//     if (requestType === 'material_request') {
//       if (!parsedRequestedItems || !Array.isArray(parsedRequestedItems) || parsedRequestedItems.length === 0) {
//         return res.status(400).json({
//           success: false,
//           message: 'At least one item must be specified for material requests'
//         });
//       }
//     }

//     // Generate approval chain using employee EMAIL
//     console.log('Generating approval chain...');
//     const rawApprovalChain = getITSupportApprovalChain(employee.email);

//     if (!rawApprovalChain || rawApprovalChain.length === 0) {
//       console.error('❌ Failed to generate approval chain');
//       return res.status(400).json({
//         success: false,
//         message: 'Unable to determine approval chain. Please contact HR for assistance.'
//       });
//     }

//     console.log(`✓ Raw approval chain generated with ${rawApprovalChain.length} levels`);
    
//     // Map approval chain properly
//     let mappedApprovalChain;
//     try {
//       mappedApprovalChain = mapApprovalChainForITRequest(rawApprovalChain);
//       console.log('✓ Approval chain mapped successfully');
//       console.log('Final mapped chain:', JSON.stringify(mappedApprovalChain, null, 2));
//     } catch (mappingError) {
//       console.error('❌ Approval chain mapping failed:', mappingError);
//       return res.status(500).json({
//         success: false,
//         message: 'System error: Failed to map approval chain',
//         error: mappingError.message
//       });
//     }

//     // ===== FIXED: Process attachments using new local file storage =====
//     let attachments = [];
//     if (req.files && req.files.length > 0) {
//       console.log(`📎 Processing ${req.files.length} attachments...`);
      
//       for (const file of req.files) {
//         try {
//           // Use local file storage service
//           const fileMetadata = await saveFile(
//             file,
//             'it-support',     // category
//             'attachments',    // subfolder
//             null              // let it generate unique filename
//           );
          
//           attachments.push({
//             name: file.originalname,
//             url: fileMetadata.url,
//             publicId: fileMetadata.publicId,
//             localPath: fileMetadata.localPath, // Store local path for deletion
//             size: fileMetadata.bytes,
//             mimetype: file.mimetype
//           });
          
//           console.log(`   ✓ Saved: ${file.originalname} (${(fileMetadata.bytes / 1024).toFixed(2)} KB)`);
//         } catch (fileError) {
//           console.error('❌ Error processing file:', file.originalname, fileError);
//           // Continue with other files even if one fails
//         }
//       }
      
//       console.log(`✓ Successfully processed ${attachments.length}/${req.files.length} attachments`);
//     }

//     // Calculate total estimated cost for material requests
//     let totalEstimatedCost = 0;
//     if (requestType === 'material_request' && parsedRequestedItems.length > 0) {
//       totalEstimatedCost = parsedRequestedItems.reduce((total, item) => {
//         return total + ((item.estimatedCost || 0) * (item.quantity || 1));
//       }, 0);
//     }

//     // Create the IT support request with properly mapped approval chain
//     const request = new ITSupportRequest({
//       ticketNumber,
//       employee: req.user.userId,
//       requestType,
//       title,
//       description: finalDescription,
//       department: employee.department,
//       category: validCategory, 
//       subcategory: validSubcategory, 
//       priority: priority || 'medium',
//       urgency: urgency || 'normal',
//       businessJustification: businessJustification || '',
//       businessImpact: businessImpact || '',
//       location: location || 'Office',
//       contactInfo: {
//         phone: parsedContactInfo.phone || employee.phone || '',
//         email: employee.email,
//         alternateContact: parsedContactInfo.alternateContact || ''
//       },
//       preferredContactMethod: preferredContactMethod || 'email',
//       requestedItems: parsedRequestedItems,
//       totalEstimatedCost,
//       deviceDetails: parsedDeviceDetails,
//       issueDetails: parsedIssueDetails,
//       troubleshootingAttempted: troubleshootingAttempted === 'true' || troubleshootingAttempted === true,
//       troubleshootingSteps: parsedTroubleshootingSteps,
//       attachments, // Uses new local storage format with localPath
//       status: 'pending_supervisor',
//       submittedBy: employee.email,
//       submittedAt: new Date(),
//       approvalChain: mappedApprovalChain,
//       slaMetrics: {
//         submittedDate: new Date(),
//         targetResponseTime: priority === 'critical' ? 4 : priority === 'high' ? 8 : 24, 
//         targetResolutionTime: priority === 'critical' ? 24 : priority === 'high' ? 48 : 120, 
//         slaBreached: false
//       }
//     });

//     await request.save();

//     console.log('IT support request created successfully:', {
//       id: request._id,
//       ticketNumber: request.ticketNumber,
//       status: request.status,
//       description: finalDescription,
//       approvalChainLevels: mappedApprovalChain.length,
//       attachmentsCount: attachments.length
//     });

//     // Send notifications
//     const notifications = [];

//     // Notify first approver in chain
//     if (mappedApprovalChain.length > 0) {
//       const firstApprover = mappedApprovalChain[0];
      
//       notifications.push(
//         sendITSupportEmail.newRequestToSupervisor(
//           firstApprover.approver.email,
//           employee.fullName,
//           requestType,
//           title,
//           request.ticketNumber,
//           priority || 'medium',
//           totalEstimatedCost || null,
//           urgency || 'normal'
//         ).catch(error => {
//           console.error('Failed to send supervisor notification:', error);
//           return { error, type: 'supervisor' };
//         })
//       );
//     }

//     // Notify employee of submission
//     notifications.push(
//       sendITSupportEmail.statusUpdateToEmployee(
//         employee.email,
//         request.ticketNumber,
//         'pending_supervisor',
//         'Your IT support request has been successfully submitted and is now awaiting supervisor approval.',
//         'System',
//         'You will receive email notifications as your request progresses through the approval process.'
//       ).catch(error => {
//         console.error('Failed to send employee notification:', error);
//         return { error, type: 'employee' };
//       })
//     );

//     // Wait for all notifications to complete
//     const notificationResults = await Promise.allSettled(notifications);

//     // Populate the request for response
//     await request.populate('employee', 'fullName email department');

//     console.log('=== IT REQUEST CREATED SUCCESSFULLY ===\n');
    
//     res.json({
//       success: true,
//       message: 'IT support request submitted successfully',
//       data: request,
//       notifications: {
//         sent: notificationResults.filter(r => r.status === 'fulfilled').length,
//         failed: notificationResults.filter(r => r.status === 'rejected').length
//       }
//     });

//   } catch (error) {
//     console.error('Create IT request error:', error);
//     console.error('Error stack:', error.stack);
    
//     // ===== FIXED: Clean up temp files on error =====
//     if (req.files && req.files.length > 0) {
//       console.log(`🧹 Cleaning up ${req.files.length} temp files after error...`);
//       await Promise.allSettled(
//         req.files.map(file => {
//           if (file.path && fsSync.existsSync(file.path)) {
//             return fs.unlink(file.path).catch(e => 
//               console.error('File cleanup failed:', e)
//             );
//           }
//         })
//       );
//     }
    
//     res.status(500).json({
//       success: false,
//       message: 'Failed to create IT support request',
//       error: error.message
//     });
//   }
// };


// // Get employee's own IT requests
// const getEmployeeITRequests = async (req, res) => {
//   try {
//     const { status, page = 1, limit = 20, priority, requestType } = req.query;
    
//     let filter = { employee: req.user.userId };
    
//     // Add filters if provided
//     if (status && status !== 'all') filter.status = status;
//     if (priority && priority !== 'all') filter.priority = priority;
//     if (requestType && requestType !== 'all') filter.requestType = requestType;

//     const requests = await ITSupportRequest.find(filter)
//       .populate('employee', 'fullName email department')
//       .populate('itReview.technicianId', 'fullName')
//       .sort({ createdAt: -1 })
//       .limit(limit * 1)
//       .skip((page - 1) * limit);

//     const totalCount = await ITSupportRequest.countDocuments(filter);

//     res.json({
//       success: true,
//       data: requests,
//       pagination: {
//         current: parseInt(page),
//         total: Math.ceil(totalCount / limit),
//         count: requests.length,
//         totalRecords: totalCount
//       },
//       message: `Found ${requests.length} IT support requests`
//     });

//   } catch (error) {
//     console.error('Get employee IT requests error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch IT support requests',
//       error: error.message
//     });
//   }
// };

// // Get single IT request details with approval chain
// const getITRequestDetails = async (req, res) => {
//   try {
//     const { requestId } = req.params;

//     const request = await ITSupportRequest.findById(requestId)
//       .populate('employee', 'fullName email department')
//       .populate('itReview.technicianId', 'fullName email')
//       .populate('financeReview.decidedBy', 'fullName email')
//       .populate('resolution.resolvedById', 'fullName email');

//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'IT request not found'
//       });
//     }

//     // Check if user has permission to view this request
//     const user = await User.findById(req.user.userId);
//     const canView = 
//       request.employee._id.equals(req.user.userId) || // Owner
//       user.role === 'admin' || // Admin
//       user.role === 'it' || // IT department
//       request.approvalChain.some(step => step.approver.email === user.email); // Approver

//     if (!canView) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied'
//       });
//     }

//     res.json({
//       success: true,
//       data: request
//     });

//   } catch (error) {
//     console.error('Get IT request details error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch IT request details',
//       error: error.message
//     });
//   }
// };

// // Get supervisor IT requests (pending approval)
// const getSupervisorITRequests = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     if (!user) {
//       return res.status(404).json({ success: false, message: 'User not found' });
//     }

//     console.log('=== GET SUPERVISOR IT REQUESTS ===');
//     console.log('User:', {
//       id: user._id,
//       name: user.fullName,
//       email: user.email,
//       role: user.role
//     });

//     // FIXED: Find requests where current user is in the approval chain with pending status
//     // AND the request status matches their approval level
//     const requests = await ITSupportRequest.find({
//       'approvalChain': {
//         $elemMatch: {
//           'approver.email': user.email,
//           'status': 'pending'
//         }
//       },
//       // FIXED: Include ALL relevant statuses for approval chain
//       status: { 
//         $in: [
//           'pending_supervisor',
//           'pending_departmental_head',
//           'pending_head_of_business',
//           'pending_it_approval'
//         ] 
//       }
//     })
//     .populate('employee', 'fullName email department')
//     .sort({ createdAt: -1 });

//     console.log(`Found ${requests.length} requests for ${user.fullName}`);
    
//     // ADDITIONAL DEBUG: Log the approval chain status for each request
//     requests.forEach(req => {
//       const userStep = req.approvalChain?.find(step => 
//         step.approver.email === user.email
//       );
//       console.log(`Request ${req.ticketNumber}:`, {
//         status: req.status,
//         userStepStatus: userStep?.status,
//         userStepLevel: userStep?.level,
//         userStepRole: userStep?.approver.role
//       });
//     });

//     res.json({
//       success: true,
//       data: requests,
//       count: requests.length
//     });

//   } catch (error) {
//     console.error('Get supervisor IT requests error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch IT requests',
//       error: error.message
//     });
//   }
// };


// // Process supervisor decision
// const processSupervisorDecision = async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const { decision, comments } = req.body;

//     console.log('=== SUPERVISOR IT DECISION PROCESSING ===');
//     console.log('Request ID:', requestId);
//     console.log('Decision:', decision);

//     const user = await User.findById(req.user.userId);
//     if (!user) {
//       return res.status(404).json({ success: false, message: 'User not found' });
//     }

//     const request = await ITSupportRequest.findById(requestId)
//       .populate('employee', 'fullName email department');

//     if (!request) {
//       return res.status(404).json({ 
//         success: false, 
//         message: 'IT support request not found' 
//       });
//     }

//     console.log('Current request status:', request.status);
//     console.log('Approval chain:', request.approvalChain.map(step => ({
//       level: step.level,
//       email: step.approver.email,
//       role: step.approver.role,
//       status: step.status
//     })));

//     // Find current user's step in approval chain
//     const currentStepIndex = request.approvalChain.findIndex(
//       step => step.approver.email === user.email && step.status === 'pending'
//     );

//     if (currentStepIndex === -1) {
//       return res.status(403).json({
//         success: false,
//         message: 'You are not authorized to approve this request or it has already been processed'
//       });
//     }

//     console.log('Current step index:', currentStepIndex);
//     console.log('Current step details:', request.approvalChain[currentStepIndex]);

//     // Update the approval step
//     request.approvalChain[currentStepIndex].status = decision;
//     request.approvalChain[currentStepIndex].comments = comments;
//     request.approvalChain[currentStepIndex].actionDate = new Date();
//     request.approvalChain[currentStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
//     request.approvalChain[currentStepIndex].decidedBy = req.user.userId;

//     // Update overall request status based on decision
//     if (decision === 'rejected') {
//       request.status = 'supervisor_rejected';
      
//       // Update the legacy supervisorDecision field for backward compatibility
//       request.supervisorDecision = {
//         decision: 'rejected',
//         comments,
//         decisionDate: new Date(),
//         decidedBy: req.user.userId
//       };

//       console.log('✅ Request REJECTED by', user.fullName);
      
//     } else if (decision === 'approved') {
//       // Update legacy supervisorDecision field
//       request.supervisorDecision = {
//         decision: 'approved',
//         comments,
//         decisionDate: new Date(),
//         decidedBy: req.user.userId
//       };
      
//       // FIXED: Find the NEXT pending step AFTER current step
//       const nextPendingStepIndex = request.approvalChain.findIndex(
//         (step, idx) => idx > currentStepIndex && step.status === 'pending'
//       );
      
//       console.log('Next pending step index:', nextPendingStepIndex);
      
//       if (nextPendingStepIndex !== -1) {
//         const nextPendingStep = request.approvalChain[nextPendingStepIndex];
        
//         console.log('Next pending step:', {
//           level: nextPendingStep.level,
//           role: nextPendingStep.approver.role,
//           email: nextPendingStep.approver.email
//         });
        
//         // Determine status based on next approver's role
//         const roleStatusMap = {
//           'Supervisor': 'pending_supervisor',
//           'Departmental Head': 'pending_departmental_head',
//           'Head of Business': 'pending_head_of_business',
//           'IT Department - Final Approval': 'pending_it_approval'
//         };
        
//         request.status = roleStatusMap[nextPendingStep.approver.role] || 'pending_it_approval';
        
//         console.log(`✅ Approved by ${user.fullName} (${request.approvalChain[currentStepIndex].approver.role})`);
//         console.log(`✅ Next approval step: ${nextPendingStep.approver.role} (${nextPendingStep.approver.email})`);
//         console.log(`✅ Updated status to: ${request.status}`);
        
//       } else {
//         // All approvals complete
//         request.status = 'it_approved';
//         console.log('✅ All approval steps completed - IT approved');
//       }
//     }

//     await request.save();

//     console.log('✅ Request saved with new status:', request.status);

//     // Send notifications based on decision
//     const notifications = [];

//     if (decision === 'approved') {
//       // Find next pending step again after save
//       const nextPendingStep = request.approvalChain.find(step => step.status === 'pending');
      
//       if (nextPendingStep) {
//         console.log('Sending notification to:', nextPendingStep.approver.email);
        
//         if (nextPendingStep.approver.role === 'IT Department - Final Approval') {
//           // Notify IT department - this is the final approval step
//           const itDepartment = await User.find({ role: 'it' }).select('email fullName');
          
//           if (itDepartment.length > 0) {
//             notifications.push(
//               sendITSupportEmail.supervisorApprovalToIT(
//                 itDepartment.map(u => u.email),
//                 request.employee.fullName,
//                 request.requestType,
//                 request.title,
//                 request.ticketNumber,
//                 user.fullName,
//                 request.totalEstimatedCost || null,
//                 comments
//               ).catch(error => {
//                 console.error('Failed to send IT notification:', error);
//                 return { error, type: 'it' };
//               })
//             );
//           }
//         } else {
//           // Notify next approver (Department Head or President)
//           notifications.push(
//             sendEmail({
//               to: nextPendingStep.approver.email,
//               subject: `IT Support Request Approval Required - ${request.ticketNumber}`,
//               html: `
//                 <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
//                   <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
//                     <h2 style="color: #0050b3; margin-top: 0;">IT Support Request - Approval Required</h2>
//                     <p>Dear ${nextPendingStep.approver.name},</p>
//                     <p>An IT support request has been approved by ${user.fullName} (${request.approvalChain[currentStepIndex].approver.role}) and requires your approval.</p>

//                     <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
//                       <h3 style="color: #333; margin-top: 0;">Request Details</h3>
//                       <table style="width: 100%; border-collapse: collapse;">
//                         <tr>
//                           <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
//                           <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${request.employee.fullName}</td>
//                         </tr>
//                         <tr>
//                           <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Request Type:</strong></td>
//                           <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${request.requestType === 'material_request' ? 'Material Request' : 'Technical Issue'}</td>
//                         </tr>
//                         <tr>
//                           <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Title:</strong></td>
//                           <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${request.title}</td>
//                         </tr>
//                         <tr>
//                           <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Previous Approver:</strong></td>
//                           <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${user.fullName}</td>
//                         </tr>
//                         <tr>
//                           <td style="padding: 8px 0;"><strong>Ticket Number:</strong></td>
//                           <td style="padding: 8px 0;">${request.ticketNumber}</td>
//                         </tr>
//                       </table>
//                     </div>

//                     ${comments ? `
//                     <div style="background-color: #e6f7ff; border-left: 4px solid #1890ff; padding: 15px; margin: 20px 0;">
//                       <h4 style="color: #1890ff; margin-top: 0;">Previous Approver Comments:</h4>
//                       <p style="color: #333; margin-bottom: 0;">"${comments}"</p>
//                     </div>
//                     ` : ''}

//                     <div style="text-align: center; margin: 30px 0;">
//                       <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/supervisor/it-support/${request._id}" 
//                         style="display: inline-block; background-color: #1890ff; color: white; 
//                                 padding: 15px 30px; text-decoration: none; border-radius: 8px;
//                                 font-weight: bold; font-size: 16px;">
//                         📋 Review & Approve Request
//                       </a>
//                     </div>

//                     <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
//                     <p style="color: #888; font-size: 12px; margin-bottom: 0; text-align: center;">
//                       This is an automated message from the IT Support Management System.
//                     </p>
//                   </div>
//                 </div>
//               `
//             }).catch(error => {
//               console.error('Failed to send next approver notification:', error);
//               return { error, type: 'next_approver' };
//             })
//           );
//         }
//       }

//       // Notify employee of approval progress
//       notifications.push(
//         sendITSupportEmail.statusUpdateToEmployee(
//           request.employee.email,
//           request.ticketNumber,
//           'approved',
//           `Your IT support request has been approved by ${user.fullName} (${request.approvalChain[currentStepIndex].approver.role}).${nextPendingStep ? ` It is now awaiting approval from ${nextPendingStep.approver.name} (${nextPendingStep.approver.role}).` : ' All approvals are complete.'}`,
//           user.fullName,
//           nextPendingStep ? `Next Approver: ${nextPendingStep.approver.name}` : 'Your request will be processed shortly.'
//         ).catch(error => {
//           console.error('Failed to send employee notification:', error);
//           return { error, type: 'employee' };
//         })
//       );
//     } else {
//       // Request was rejected - notify employee
//       notifications.push(
//         sendITSupportEmail.statusUpdateToEmployee(
//           request.employee.email,
//           request.ticketNumber,
//           'rejected',
//           comments || 'Your IT support request was not approved.',
//           user.fullName,
//           'Please contact your supervisor for more information or submit a revised request if circumstances change.'
//         ).catch(error => {
//           console.error('Failed to send employee notification:', error);
//           return { error, type: 'employee' };
//         })
//       );
//     }

//     // Wait for notifications
//     const notificationResults = await Promise.allSettled(notifications);

//     console.log('=== DECISION PROCESSING COMPLETE ===\n');

//     res.json({
//       success: true,
//       message: `IT support request ${decision} successfully`,
//       data: request,
//       notifications: {
//         sent: notificationResults.filter(r => r.status === 'fulfilled').length,
//         failed: notificationResults.filter(r => r.status === 'rejected').length
//       }
//     });

//   } catch (error) {
//     console.error('Process supervisor decision error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to process supervisor decision',
//       error: error.message
//     });
//   }
// };

// // Get IT department requests
// const getITDepartmentRequests = async (req, res) => {
//   try {
//     const requests = await ITSupportRequest.find({
//       status: { $in: ['pending_it_review', 'it_assigned', 'in_progress', 'waiting_parts'] }
//     })
//     .populate('employee', 'fullName email department')
//     .populate('itReview.technicianId', 'fullName')
//     .sort({ createdAt: -1 });

//     res.json({
//       success: true,
//       data: requests,
//       count: requests.length
//     });

//   } catch (error) {
//     console.error('Get IT department requests error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch IT department requests',
//       error: error.message
//     });
//   }
// };


// // Process IT department decision - FIXED VERSION
// const processITDepartmentDecision = async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const { 
//       decision, 
//       comments, 
//       estimatedCost, 
//       technicianId, 
//       priorityLevel,
//       estimatedCompletionTime 
//     } = req.body;

//     const user = await User.findById(req.user.userId);
//     const request = await ITSupportRequest.findById(requestId)
//       .populate('employee', 'fullName email department');

//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Request not found'
//       });
//     }


//     // Normalize and handle all possible decisions
//     let normalizedDecision = decision;
//     let newStatus = request.status;
//     if (decision === 'approved') {
//       normalizedDecision = 'approve';
//       newStatus = 'it_approved';
//       if (technicianId) {
//         newStatus = 'it_assigned';
//       }
//     } else if (decision === 'rejected') {
//       normalizedDecision = 'reject';
//       newStatus = 'it_rejected';
//     } else if (decision === 'resolved') {
//       normalizedDecision = 'resolved';
//       // For material requests, set to 'pending_discharge' instead of 'resolved'
//       if (request.requestType === 'material_request') {
//         newStatus = 'pending_discharge';
//       } else {
//         newStatus = 'resolved';
//       }
//     }

//     // Update IT review
//     request.itReview = {
//       decision: normalizedDecision,
//       comments,
//       estimatedCost: estimatedCost || 0,
//       technicianId: technicianId || req.user.userId,
//       reviewDate: new Date(),
//       decidedBy: req.user.userId,
//       priorityLevel: priorityLevel || request.priority,
//       estimatedCompletionTime
//     };

//     request.status = newStatus;

//     await request.save();


//     // Send notifications
//     const notifications = [];
//     if (normalizedDecision === 'approve') {
//       // Notify employee of IT approval (FINAL APPROVAL)
//       notifications.push(
//         sendITSupportEmail.statusUpdateToEmployee(
//           request.employee.email,
//           request.ticketNumber,
//           'it_approved',
//           `Your IT request has been approved by the IT department${request.itReview.assignedTechnician ? ` and assigned to ${request.itReview.assignedTechnician}` : ''}. Work will begin shortly.`,
//           user.fullName,
//           estimatedCompletionTime ? `Estimated completion: ${estimatedCompletionTime}` : 'Work will begin shortly and you will receive updates as it progresses.'
//         ).catch(error => ({ error, type: 'employee' }))
//       );
//     } else if (normalizedDecision === 'resolved') {
//       // Notify employee of resolution
//       notifications.push(
//         sendITSupportEmail.resolutionToEmployee(
//           request.employee.email,
//           request.ticketNumber,
//           request.requestType,
//           comments || 'Your IT request has been resolved.',
//           user.fullName
//         ).catch(error => ({ error, type: 'employee' }))
//       );
//     } else if (normalizedDecision === 'reject') {
//       // Notify employee of rejection
//       notifications.push(
//         sendITSupportEmail.statusUpdateToEmployee(
//           request.employee.email,
//           request.ticketNumber,
//           'rejected',
//           comments || 'Your IT request has been rejected by the IT department.',
//           user.fullName
//         ).catch(error => ({ error, type: 'employee' }))
//       );
//     }

//     const notificationResults = await Promise.allSettled(notifications);

//     res.json({
//       success: true,
//       message: `IT request ${decision} successfully`,
//       data: request,
//       notifications: {
//         sent: notificationResults.filter(r => r.status === 'fulfilled').length,
//         failed: notificationResults.filter(r => r.status === 'rejected').length
//       }
//     });

//   } catch (error) {
//     console.error('Process IT department decision error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to process IT department decision',
//       error: error.message
//     });
//   }
// };

// // Get finance IT requests
// const getFinanceITRequests = async (req, res) => {
//   try {
//     const requests = await ITSupportRequest.find({
//       $or: [
//         { status: 'pending_finance' },
//         { requestType: 'material_request', totalEstimatedCost: { $gt: 100000 } }
//       ]
//     })
//     .populate('employee', 'fullName email department')
//     .populate('itReview.technicianId', 'fullName')
//     .sort({ createdAt: -1 });

//     res.json({
//       success: true,
//       data: requests,
//       count: requests.length
//     });

//   } catch (error) {
//     console.error('Get finance IT requests error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch finance IT requests',
//       error: error.message
//     });
//   }
// };

// // Process finance decision
// const processFinanceDecision = async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const { decision, comments, amountApproved, disbursementAmount, budgetCodeId } = req.body;

//     console.log('\n=== FINANCE DECISION PROCESSING ===');
//     console.log('Request ID:', requestId);
//     console.log('Decision:', decision);
//     console.log('Budget Code ID:', budgetCodeId);
//     console.log('User Email:', req.user.email);

//     const user = await User.findById(req.user.userId);
//     const request = await CashRequest.findById(requestId)
//       .populate('employee', 'fullName email department')
//       .populate('projectId', 'name code budgetCodeId');

//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Request not found'
//       });
//     }

//     console.log(`Current Status: ${request.status}`);
//     console.log(`Approval Chain:`);
//     request.approvalChain.forEach(step => {
//       console.log(`  L${step.level}: ${step.approver.name} (${step.approver.role}) - ${step.status}`);
//     });

//     // Find finance step in approval chain - DON'T hardcode level, search by role and email
//     const financeStepIndex = request.approvalChain.findIndex(step => 
//       step.approver.email === user.email && 
//       step.approver.role === 'Finance Officer' &&
//       step.status === 'pending'
//     );

//     if (financeStepIndex === -1) {
//       console.log('❌ No pending finance approval found for this user');
//       console.log('   Looking for: email =', user.email, ', role = Finance Officer, status = pending');
      
//       // Show what we found instead
//       const anyFinanceStep = request.approvalChain.find(s => 
//         s.approver.email === user.email && s.approver.role === 'Finance Officer'
//       );
      
//       if (anyFinanceStep) {
//         console.log(`   Found Finance step at Level ${anyFinanceStep.level} with status: ${anyFinanceStep.status}`);
//       }
      
//       return res.status(403).json({
//         success: false,
//         message: 'This request is not pending your approval. It may have already been processed.',
//         currentStatus: anyFinanceStep ? anyFinanceStep.status : 'not_found'
//       });
//     }

//     const financeStep = request.approvalChain[financeStepIndex];
//     console.log(`✓ Found pending finance approval at Level ${financeStep.level}`);

//     // Verify this is the final approval level OR all previous levels are approved
//     const allPreviousApproved = request.approvalChain
//       .filter(s => s.level < financeStep.level)
//       .every(s => s.status === 'approved');

//     if (!allPreviousApproved) {
//       console.log('⚠️  Warning: Not all previous levels are approved');
//       return res.status(400).json({
//         success: false,
//         message: 'Cannot process finance approval until all previous levels are approved'
//       });
//     }

//     if (decision === 'approved') {
//       const finalAmount = disbursementAmount || amountApproved || request.amountRequested;
//       console.log(`Final approved amount: XAF ${finalAmount}`);

//       // Handle budget allocation
//       let budgetCode = null;
      
//       if (request.projectId && request.projectId.budgetCodeId) {
//         console.log('Using project budget code');
//         budgetCode = await BudgetCode.findById(request.projectId.budgetCodeId);
//       } else if (budgetCodeId) {
//         console.log(`Finance assigning budget code: ${budgetCodeId}`);
//         budgetCode = await BudgetCode.findById(budgetCodeId);
//       } else {
//         return res.status(400).json({
//           success: false,
//           message: 'Budget code must be assigned for approval'
//         });
//       }

//       if (!budgetCode) {
//         return res.status(404).json({
//           success: false,
//           message: 'Budget code not found'
//         });
//       }

//       console.log(`Budget code: ${budgetCode.code} (Available: XAF ${budgetCode.remaining.toLocaleString()})`);

//       // Check budget sufficiency
//       if (budgetCode.remaining < parseFloat(finalAmount)) {
//         return res.status(400).json({
//           success: false,
//           message: `Insufficient budget. Available: XAF ${budgetCode.remaining.toLocaleString()}`
//         });
//       }

//       // Allocate budget
//       try {
//         await budgetCode.allocateBudget(request._id, parseFloat(finalAmount));
//         console.log('✅ Budget allocated successfully');

//         request.budgetAllocation = {
//           budgetCodeId: budgetCode._id,
//           budgetCode: budgetCode.code,
//           allocatedAmount: parseFloat(finalAmount),
//           allocationStatus: 'allocated',
//           assignedBy: req.user.userId,
//           assignedAt: new Date()
//         };
//       } catch (budgetError) {
//         console.error('❌ Budget allocation failed:', budgetError);
//         return res.status(500).json({
//           success: false,
//           message: `Failed to allocate budget: ${budgetError.message}`
//         });
//       }

//       // Update finance approval step
//       request.approvalChain[financeStepIndex].status = 'approved';
//       request.approvalChain[financeStepIndex].comments = comments;
//       request.approvalChain[financeStepIndex].actionDate = new Date();
//       request.approvalChain[financeStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
//       request.approvalChain[financeStepIndex].decidedBy = req.user.userId;

//       request.financeDecision = {
//         decision: 'approved',
//         comments,
//         decisionDate: new Date()
//       };

//       // CRITICAL: Set final status based on disbursement
//       if (disbursementAmount) {
//         request.status = 'disbursed';
//         request.disbursementDetails = {
//           date: new Date(),
//           amount: parseFloat(disbursementAmount),
//           disbursedBy: req.user.userId
//         };
//         console.log('✅ Request DISBURSED');
//       } else {
//         request.status = 'approved';
//         console.log('✅ Request APPROVED (awaiting disbursement)');
//       }

//       if (amountApproved) {
//         request.amountApproved = parseFloat(amountApproved);
//       }

//       request.financeOfficer = req.user.userId;
//       await request.save();

//       console.log('=== FINANCE APPROVAL COMPLETED ===\n');

//       // Send notifications
//       const notifications = [];

//       // Notify employee
//       const budgetInfo = `
//         <div style="background-color: #e6f7ff; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #1890ff;">
//           <p><strong>Budget Allocation:</strong></p>
//           <ul>
//             <li><strong>Budget Code:</strong> ${budgetCode.code} - ${budgetCode.name}</li>
//             <li><strong>Allocated Amount:</strong> XAF ${parseFloat(finalAmount).toLocaleString()}</li>
//             <li><strong>Budget Remaining:</strong> XAF ${budgetCode.remaining.toLocaleString()}</li>
//           </ul>
//         </div>
//       `;

//       notifications.push(
//         sendEmail({
//           to: request.employee.email,
//           subject: `Cash Request ${disbursementAmount ? 'Disbursed' : 'Approved'} - ${request.employee.fullName}`,
//           html: `
//             <h3>Cash Request ${disbursementAmount ? 'Disbursed' : 'Approved'}</h3>
//             <p>Dear ${request.employee.fullName},</p>
            
//             <p>Your cash request has been ${disbursementAmount ? 'approved and disbursed' : 'approved by the finance team'}.</p>

//             <div style="background-color: #d4edda; padding: 15px; border-radius: 5px; margin: 15px 0;">
//               <ul>
//                 <li><strong>Request ID:</strong> REQ-${requestId.toString().slice(-6).toUpperCase()}</li>
//                 <li><strong>Amount Approved:</strong> XAF ${parseFloat(finalAmount).toLocaleString()}</li>
//                 <li><strong>Approved by:</strong> ${user.fullName}</li>
//               </ul>
//             </div>

//             ${budgetInfo}

//             ${disbursementAmount ? 
//               '<p><em>Please submit your justification with receipts within the required timeframe.</em></p>' : 
//               '<p><em>Please wait for disbursement processing.</em></p>'
//             }
//           `
//         }).catch(error => {
//           console.error('Failed to send employee notification:', error);
//           return { error, type: 'employee' };
//         })
//       );

//       // Notify admins
//       const admins = await User.find({ role: 'admin' }).select('email fullName');
//       if (admins.length > 0) {
//         notifications.push(
//           sendEmail({
//             to: admins.map(a => a.email),
//             subject: `Cash Request ${disbursementAmount ? 'Disbursed' : 'Approved'} - ${request.employee.fullName}`,
//             html: `
//               <h3>Cash Request ${disbursementAmount ? 'Disbursed' : 'Approved'}</h3>
//               <p>A cash request has been ${disbursementAmount ? 'approved and disbursed' : 'approved'} by the finance team.</p>

//               <div style="background-color: #d4edda; padding: 15px; border-radius: 5px; margin: 15px 0;">
//                 <ul>
//                   <li><strong>Employee:</strong> ${request.employee.fullName}</li>
//                   <li><strong>Request ID:</strong> REQ-${requestId.toString().slice(-6).toUpperCase()}</li>
//                   <li><strong>Amount:</strong> XAF ${parseFloat(finalAmount).toLocaleString()}</li>
//                   <li><strong>Budget Code:</strong> ${budgetCode.code} - ${budgetCode.name}</li>
//                   <li><strong>Budget Remaining:</strong> XAF ${budgetCode.remaining.toLocaleString()}</li>
//                   <li><strong>Status:</strong> ${request.status.replace(/_/g, ' ').toUpperCase()}</li>
//                 </ul>
//               </div>
//             `
//           }).catch(error => {
//             console.error('Failed to send admin notification:', error);
//             return { error, type: 'admin' };
//           })
//         );
//       }

//       await Promise.allSettled(notifications);

//       return res.json({
//         success: true,
//         message: `Request ${decision} by finance and budget allocated from ${budgetCode.code}`,
//         data: {
//           request,
//           budgetAllocation: {
//             budgetCode: budgetCode.code,
//             budgetName: budgetCode.name,
//             allocatedAmount: parseFloat(finalAmount),
//             remainingBudget: budgetCode.remaining
//           }
//         }
//       });

//     } else {
//       // Handle rejection
//       console.log('❌ Request REJECTED by finance');
      
//       request.status = 'denied';
//       request.financeDecision = {
//         decision: 'rejected',
//         comments,
//         decisionDate: new Date()
//       };

//       request.approvalChain[financeStepIndex].status = 'rejected';
//       request.approvalChain[financeStepIndex].comments = comments;
//       request.approvalChain[financeStepIndex].actionDate = new Date();
//       request.approvalChain[financeStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
//       request.approvalChain[financeStepIndex].decidedBy = req.user.userId;

//       await request.save();

//       // Notify employee of denial
//       await sendCashRequestEmail.denialToEmployee(
//         request.employee.email,
//         comments || 'Request denied by finance team',
//         requestId,
//         user.fullName
//       ).catch(err => console.error('Failed to send denial email:', err));

//       console.log('=== REQUEST DENIED ===\n');
//       return res.json({
//         success: true,
//         message: 'Request rejected by finance',
//         data: request
//       });
//     }

//   } catch (error) {
//     console.error('Process finance decision error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to process finance decision',
//       error: error.message
//     });
//   }
// };

// // Save draft IT request
// const saveDraft = async (req, res) => {
//   try {
//     console.log('=== SAVE DRAFT IT REQUEST ===');

//     const {
//       ticketNumber,
//       requestType,
//       title,
//       description,
//       category,
//       subcategory,
//       priority,
//       urgency,
//       requestedItems,
//       deviceDetails,
//       issueDetails
//     } = req.body;

//     // Get user details
//     const employee = await User.findById(req.user.userId);
//     if (!employee) {
//       return res.status(404).json({ 
//         success: false, 
//         message: 'Employee not found' 
//       });
//     }

//     // Parse complex fields if they're strings with more relaxed error handling
//     let parsedRequestedItems = [];
//     let parsedDeviceDetails = {};
//     let parsedIssueDetails = {};

//     try {
//       if (requestedItems) {
//         parsedRequestedItems = typeof requestedItems === 'string' ? JSON.parse(requestedItems) : requestedItems;
//         if (!Array.isArray(parsedRequestedItems)) {
//           parsedRequestedItems = [];
//         }
//       }
//       if (deviceDetails) {
//         parsedDeviceDetails = typeof deviceDetails === 'string' ? JSON.parse(deviceDetails) : deviceDetails;
//         if (typeof parsedDeviceDetails !== 'object' || parsedDeviceDetails === null) {
//           parsedDeviceDetails = {};
//         }
//       }
//       if (issueDetails) {
//         parsedIssueDetails = typeof issueDetails === 'string' ? JSON.parse(issueDetails) : issueDetails;
//         if (typeof parsedIssueDetails !== 'object' || parsedIssueDetails === null) {
//           parsedIssueDetails = {};
//         }
//       }
//     } catch (error) {
//       // Use empty defaults if parsing fails for drafts
//       console.warn('JSON parsing warning for draft:', error);
//     }

//     // Create draft IT request (no approval chain needed for drafts and minimal validation)
//     const draftRequest = new ITSupportRequest({
//       ticketNumber: ticketNumber || `DRAFT-${Date.now()}`,
//       employee: req.user.userId,
//       requestType: requestType || 'technical_issue',
//       title: title || 'Draft IT Request',
//       description: description || 'Draft - to be completed',
//       department: employee.department,
//       category: category || 'other',
//       subcategory: subcategory || 'other',
//       priority: priority || 'medium',
//       urgency: urgency || 'normal',
//       requestedItems: parsedRequestedItems,
//       deviceDetails: parsedDeviceDetails,
//       issueDetails: parsedIssueDetails,
//       contactInfo: {
//         phone: employee.phone || '',
//         email: employee.email
//       },
//       status: 'draft',
//       approvalChain: [] // Empty for drafts
//     });

//     await draftRequest.save();
//     await draftRequest.populate('employee', 'fullName email department');

//     res.json({
//       success: true,
//       message: 'Draft saved successfully',
//       data: draftRequest
//     });

//   } catch (error) {
//     console.error('Save draft error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to save draft',
//       error: error.message
//     });
//   }
// };


// // Get IT request statistics
// const getITRequestStats = async (req, res) => {
//     try {
//       const { startDate, endDate, department, status, requestType } = req.query;
  
//       let matchFilter = {};
  
//       // Date range filter
//       if (startDate || endDate) {
//         matchFilter.createdAt = {};
//         if (startDate) matchFilter.createdAt.$gte = new Date(startDate);
//         if (endDate) matchFilter.createdAt.$lte = new Date(endDate);
//       }
  
//       // Department filter
//       if (department) {
//         const users = await User.find({ department }).select('_id');
//         matchFilter.employee = { $in: users.map(u => u._id) };
//       }
  
//       // Status filter
//       if (status) matchFilter.status = status;
  
//       // Request type filter
//       if (requestType) matchFilter.requestType = requestType;
  
//       const stats = await ITSupportRequest.aggregate([
//         { $match: matchFilter },
//         {
//           $group: {
//             _id: null,
//             totalRequests: { $sum: 1 },
//             avgResolutionTime: { $avg: '$slaMetrics.resolutionTime' },
//             statusBreakdown: { $push: '$status' },
//             categoryBreakdown: { $push: '$category' },
//             priorityBreakdown: { $push: '$priority' },
//             requestTypeBreakdown: { $push: '$requestType' }
//           }
//         }
//       ]);
  
//       // Process breakdowns
//       const statusCounts = {};
//       const categoryCounts = {};
//       const priorityCounts = {};
//       const requestTypeCounts = {};
  
//       if (stats.length > 0) {
//         stats[0].statusBreakdown.forEach(status => {
//           statusCounts[status] = (statusCounts[status] || 0) + 1;
//         });
  
//         stats[0].categoryBreakdown.forEach(category => {
//           categoryCounts[category] = (categoryCounts[category] || 0) + 1;
//         });
  
//         stats[0].priorityBreakdown.forEach(priority => {
//           priorityCounts[priority] = (priorityCounts[priority] || 0) + 1;
//         });
  
//         stats[0].requestTypeBreakdown.forEach(type => {
//           requestTypeCounts[type] = (requestTypeCounts[type] || 0) + 1;
//         });
//       }
  
//       res.json({
//         success: true,
//         data: {
//           summary: stats.length > 0 ? {
//             totalRequests: stats[0].totalRequests,
//             avgResolutionTime: Math.round(stats[0].avgResolutionTime || 0)
//           } : {
//             totalRequests: 0,
//             avgResolutionTime: 0
//           },
//           breakdown: {
//             status: statusCounts,
//             category: categoryCounts,
//             priority: priorityCounts,
//             requestType: requestTypeCounts
//           }
//         }
//       });
  
//     } catch (error) {
//       console.error('Get IT request stats error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to fetch IT request statistics',
//         error: error.message
//       });
//     }
// };
  

// // Get inventory status
// const getInventoryStatus = async (req, res) => {
//     try {
//       // Mock inventory data - would integrate with actual inventory management system
//       const mockInventoryData = [
//         {
//           item: 'Wireless Mouse',
//           category: 'accessories',
//           inStock: 15,
//           allocated: 8,
//           available: 7,
//           reorderLevel: 10,
//           needsReorder: false
//         },
//         {
//           item: 'HDMI Cable',
//           category: 'accessories', 
//           inStock: 3,
//           allocated: 2,
//           available: 1,
//           reorderLevel: 5,
//           needsReorder: true
//         },
//         {
//           item: 'Laptop Charger',
//           category: 'hardware',
//           inStock: 8,
//           allocated: 5,
//           available: 3,
//           reorderLevel: 4,
//           needsReorder: true
//         }
//       ];
  
//       res.json({
//         success: true,
//         data: mockInventoryData,
//         message: 'Inventory status data (mock)'
//       });
  
//     } catch (error) {
//       console.error('Get inventory status error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to fetch inventory status',
//         error: error.message
//       });
//     }
// };

// // Get asset analytics
// const getAssetAnalytics = async (req, res) => {
//     try {
//       const [
//         totalAssets,
//         assetsByCategory,
//         recentAssignments
//       ] = await Promise.all([
//         ITSupportRequest.aggregate([
//           { $unwind: '$assetAssignment.assignedAssets' },
//           { $count: 'totalAssets' }
//         ]),
  
//         ITSupportRequest.aggregate([
//           { $unwind: '$assetAssignment.assignedAssets' },
//           {
//             $group: {
//               _id: '$category',
//               assetCount: { $sum: 1 },
//               totalValue: { $sum: '$assetAssignment.totalAssignedValue' }
//             }
//           },
//           { $sort: { assetCount: -1 } }
//         ]),
  
//         ITSupportRequest.find({ 
//           'assetAssignment.assignedAssets': { $exists: true, $ne: [] },
//           'assetAssignment.assignedAssets.assignmentDate': { 
//             $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) 
//           }
//         })
//         .populate('employee', 'fullName department')
//         .sort({ 'assetAssignment.assignedAssets.assignmentDate': -1 })
//         .limit(10)
//       ]);
  
//       res.json({
//         success: true,
//         data: {
//           totalAssets: totalAssets[0]?.totalAssets || 0,
//           assetsByCategory,
//           recentAssignments
//         }
//       });
  
//     } catch (error) {
//       console.error('Get asset analytics error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to fetch asset analytics',
//         error: error.message
//       });
//     }
// };

// // Get category analytics
// const getCategoryAnalytics = async (req, res) => {
//     try {
//       const { period = 'monthly' } = req.query;
  
//       // Calculate date range based on period
//       let startDate = new Date();
//       switch (period) {
//         case 'weekly':
//           startDate.setDate(startDate.getDate() - 7);
//           break;
//         case 'monthly':
//           startDate.setMonth(startDate.getMonth() - 1);
//           break;
//         case 'quarterly':
//           startDate.setMonth(startDate.getMonth() - 3);
//           break;
//         default:
//           startDate.setMonth(startDate.getMonth() - 1);
//       }
  
//       const analytics = await ITSupportRequest.aggregate([
//         {
//           $match: {
//             createdAt: { $gte: startDate }
//           }
//         },
//         {
//           $group: {
//             _id: '$category',
//             count: { $sum: 1 },
//             resolvedCount: {
//               $sum: {
//                 $cond: [
//                   { $in: ['$status', ['resolved', 'closed']] },
//                   1,
//                   0
//                 ]
//               }
//             },
//             avgResolutionTime: { $avg: '$slaMetrics.resolutionTime' },
//             criticalCount: {
//               $sum: {
//                 $cond: [{ $eq: ['$priority', 'critical'] }, 1, 0]
//               }
//             }
//           }
//         },
//         {
//           $addFields: {
//             resolutionRate: {
//               $multiply: [
//                 { $divide: ['$resolvedCount', '$count'] },
//                 100
//               ]
//             }
//           }
//         },
//         { $sort: { count: -1 } }
//       ]);
  
//       res.json({
//         success: true,
//         data: analytics,
//         period: period
//       });
  
//     } catch (error) {
//       console.error('Get category analytics error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to fetch category analytics',
//         error: error.message
//       });
//     }
// };

// // Get dashboard statistics
// const getDashboardStats = async (req, res) => {
//   try {
//     const { role, userId } = req.user;
//     const user = await User.findById(userId);

//     let filter = {};

//     console.log('=== GET DASHBOARD STATS ===');
//     console.log('User:', { userId, role, department: user.department });

//     // FIXED: Role-based filtering logic
//     if (role === 'employee') {
//       filter.employee = userId;
//     } else if (role === 'supervisor') {
//       // Supervisors see requests they can approve
//       filter['approvalChain.approver.email'] = user.email;
//     } else if (role === 'it') {
//       // FIXED: IT sees all requests that need their attention
//       filter.$or = [
//         { status: { $in: ['pending_it_review', 'supervisor_approved', 'it_assigned', 'in_progress', 'waiting_parts'] } },
//         { 'itReview.technicianId': userId }
//       ];
//     } else if (role === 'finance') {
//       // Finance sees high-cost requests
//       filter.$or = [
//         { status: 'pending_finance' },
//         { requestType: 'material_request', totalEstimatedCost: { $gt: 100000 } }
//       ];
//     }
//     // Admin sees all (no filter)

//     console.log('Dashboard filter:', JSON.stringify(filter, null, 2));

//     const [
//       totalCount,
//       pendingCount,
//       inProgressCount,
//       resolvedCount,
//       materialRequestCount,
//       technicalIssueCount,
//       criticalCount,
//       recentRequests,
//       slaBreached
//     ] = await Promise.all([
//       ITSupportRequest.countDocuments(filter),
//       ITSupportRequest.countDocuments({ 
//         ...filter, 
//         status: { $in: ['pending_supervisor', 'pending_it_review', 'pending_finance'] } 
//       }),
//       ITSupportRequest.countDocuments({ 
//         ...filter, 
//         status: { $in: ['it_assigned', 'in_progress', 'waiting_parts'] } 
//       }),
//       ITSupportRequest.countDocuments({ 
//         ...filter, 
//         status: { $in: ['resolved', 'closed'] } 
//       }),
//       ITSupportRequest.countDocuments({ ...filter, requestType: 'material_request' }),
//       ITSupportRequest.countDocuments({ ...filter, requestType: 'technical_issue' }),
//       ITSupportRequest.countDocuments({ 
//         ...filter, 
//         priority: 'critical',
//         status: { $nin: ['resolved', 'closed', 'rejected'] }
//       }),

//       // Recent requests (last 10)
//       ITSupportRequest.find(filter)
//         .populate('employee', 'fullName email department')
//         .sort({ createdAt: -1 })
//         .limit(10),

//       // SLA breached count
//       ITSupportRequest.countDocuments({
//         ...filter,
//         'slaMetrics.slaBreached': true,
//         status: { $nin: ['resolved', 'closed'] }
//       })
//     ]);

//     // FIXED: Debug information
//     if (totalCount === 0) {
//       console.log('=== DEBUG: No requests found, checking database ===');
//       const allRequestsCount = await ITSupportRequest.countDocuments({});
//       console.log('Total requests in database:', allRequestsCount);
      
//       if (allRequestsCount > 0) {
//         const sampleRequests = await ITSupportRequest.find({}).limit(5).select('status employee requestType');
//         console.log('Sample requests:', sampleRequests);
//       }
//     }

//     const stats = {
//       summary: {
//         total: totalCount,
//         pending: pendingCount,
//         inProgress: inProgressCount,
//         resolved: resolvedCount,
//         materialRequests: materialRequestCount,
//         technicalIssues: technicalIssueCount,
//         critical: criticalCount,
//         slaBreached: slaBreached
//       },
//       recent: recentRequests,
//       trends: {
//         resolutionRate: totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0,
//         avgResponseTime: 45, // Mock data - would calculate from actual SLA metrics
//         slaCompliance: totalCount > 0 ? Math.round(((totalCount - slaBreached) / totalCount) * 100) : 100
//       }
//     };

//     console.log('Dashboard stats result:', {
//       total: totalCount,
//       pending: pendingCount,
//       inProgress: inProgressCount,
//       resolved: resolvedCount
//     });

//     res.json({
//       success: true,
//       data: stats
//     });

//   } catch (error) {
//     console.error('Get dashboard stats error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch dashboard statistics',
//       error: error.message
//     });
//   }
// };
  
// // Get IT requests by user role (unified endpoint)
// const getITRequestsByRole = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     const { status, page = 1, limit = 20, requestType, priority } = req.query;

//     let query = {};
//     let baseFilter = {};

//     if (status) baseFilter.status = status;
//     if (requestType) baseFilter.requestType = requestType;
//     if (priority) baseFilter.priority = priority;

//     console.log('=== GET IT REQUESTS BY ROLE ===');
//     console.log('User:', {
//       userId: req.user.userId,
//       role: user.role,
//       department: user.department,
//       email: user.email,
//       fullName: user.fullName
//     });

//     switch (user.role) {
//       case 'employee':
//         query = { ...baseFilter, employee: req.user.userId };
//         break;

//       case 'supervisor':
//         query = {
//           ...baseFilter,
//           'approvalChain': {
//             $elemMatch: {
//               'approver.email': user.email,
//               'status': 'pending'
//             }
//           }
//         };
//         break;

//       case 'it':
//         // FIXED: IT should see ALL requests that need IT attention, not just specific statuses
//         query = {
//           ...baseFilter,
//           $or: [
//             // Requests pending IT final approval
//             { status: 'pending_it_approval' },
//             // Requests already approved by IT and assigned
//             { status: { $in: ['it_approved', 'it_assigned', 'in_progress', 'waiting_parts'] } },
//             // Requests assigned to this specific technician
//             { 'itReview.technicianId': user._id },
//             // Include resolved requests for IT visibility
//             { status: 'resolved', 'itReview.technicianId': user._id }
//           ]
//         };
//         break;

//       case 'finance':
//         query = {
//           ...baseFilter,
//           $or: [
//             { status: 'pending_finance' },
//             { requestType: 'material_request', totalEstimatedCost: { $gt: 100000 } },
//             // FIXED: Include IT-approved high-cost requests
//             { 
//               status: 'it_approved', 
//               $or: [
//                 { 'itReview.estimatedCost': { $gt: 100000 } },
//                 { totalEstimatedCost: { $gt: 100000 } }
//               ]
//             }
//           ]
//         };
//         break;

//       case 'admin':
//         query = baseFilter; // Admins see everything
//         break;

//       default:
//         return res.status(403).json({
//           success: false,
//           message: 'Access denied'
//         });
//     }

//     console.log('User role:', user.role);
//     console.log('Final query:', JSON.stringify(query, null, 2));

//     const requests = await ITSupportRequest.find(query)
//       .populate('employee', 'fullName email department')
//       .populate('itReview.technicianId', 'fullName')
//       .populate('financeReview.decidedBy', 'fullName')
//       .sort({ createdAt: -1 })
//       .limit(limit * 1)
//       .skip((page - 1) * limit);

//     const total = await ITSupportRequest.countDocuments(query);

//     console.log(`Found ${requests.length} requests for ${user.role}`);
    
//     // FIXED: Debug log to see what requests exist in database
//     if (requests.length === 0 && user.role === 'it') {
//       console.log('=== DEBUG: Checking all IT requests in database ===');
//       const allRequests = await ITSupportRequest.find({}).select('status ticketNumber employee').populate('employee', 'fullName');
//       console.log('All requests in database:', allRequests.map(req => ({
//         ticketNumber: req.ticketNumber,
//         status: req.status,
//         employee: req.employee?.fullName
//       })));
//     }

//     res.json({
//       success: true,
//       data: requests,
//       pagination: {
//         current: parseInt(page),
//         total: Math.ceil(total / limit),
//         count: requests.length,
//         totalRecords: total
//       },
//       role: user.role,
//       message: `Found ${requests.length} IT support requests`
//     });

//   } catch (error) {
//     console.error('Get IT requests by role error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch IT requests',
//       error: error.message
//     });
//   }
// };


// const updateFulfillmentStatus = async (req, res) => {
//     try {
//       const { requestId } = req.params;
//       const { 
//         status, 
//         workLog, 
//         resolution,
//         timeSpent,
//         comments 
//       } = req.body;
  
//       console.log('=== UPDATE FULFILLMENT STATUS ===');
//       console.log('Request ID:', requestId);
//       console.log('New Status:', status);
  
//       const user = await User.findById(req.user.userId);
//       const request = await ITSupportRequest.findById(requestId)
//         .populate('employee', 'fullName email department');
  
//       if (!request) {
//         return res.status(404).json({
//           success: false,
//           message: 'Request not found'
//         });
//       }
  
//       // Check permissions
//       const canUpdate = 
//         user.role === 'admin' || 
//         user.role === 'it' ||
//         request.itReview?.technicianId?.equals(user._id);
  
//       if (!canUpdate) {
//         return res.status(403).json({
//           success: false,
//           message: 'Access denied'
//         });
//       }
  
//       // Update request status
//       if (status) request.status = status;
  
//       // Add work log entry
//       if (workLog) {
//         if (!request.itReview.workLog) {
//           request.itReview.workLog = [];
//         }
//         request.itReview.workLog.push({
//           date: new Date(),
//           technician: user.fullName,
//           activity: workLog,
//           timeSpent: timeSpent ? parseInt(timeSpent) : 0,
//           status: status || request.status
//         });
//       }
  
//       // Handle resolution
//       if (status === 'resolved' && resolution) {
//         request.resolution = {
//           description: resolution,
//           resolvedBy: user.fullName,
//           resolvedById: user._id,
//           resolvedDate: new Date(),
//           solution: resolution
//         };
  
//         // Calculate resolution time
//         if (request.submittedAt) {
//           request.slaMetrics.resolutionTime = Math.floor(
//             (new Date() - new Date(request.submittedAt)) / (1000 * 60)
//           );
//         }
//       }
  
//       await request.save();
  
//       // Send notifications based on status
//       const notifications = [];
  
//       if (status === 'resolved') {
//         // Notify employee of resolution
//         notifications.push(
//           sendITSupportEmail.resolutionToEmployee(
//             request.employee.email,
//             request.ticketNumber,
//             request.requestType,
//             resolution,
//             user.fullName,
//             request.requestType === 'material_request' ? 'Items have been delivered to your specified location.' : ''
//           ).catch(error => {
//             console.error('Failed to send employee resolution notification:', error);
//             return { error, type: 'employee' };
//           })
//         );
//       } else if (status === 'in_progress') {
//         // Notify employee that work has started
//         notifications.push(
//           sendITSupportEmail.statusUpdateToEmployee(
//             request.employee.email,
//             request.ticketNumber,
//             'in_progress',
//             workLog || `Work has started on your IT request by ${user.fullName}.`,
//             user.fullName,
//             'You will receive updates as work progresses. Feel free to contact us if you have any questions.'
//           ).catch(error => {
//             console.error('Failed to send employee progress notification:', error);
//             return { error, type: 'employee' };
//           })
//         );
//       }
  
//       // Wait for notifications
//       const notificationResults = await Promise.allSettled(notifications);
  
//       res.json({
//         success: true,
//         message: 'Fulfillment status updated successfully',
//         data: request,
//         notifications: {
//           sent: notificationResults.filter(r => r.status === 'fulfilled').length,
//           failed: notificationResults.filter(r => r.status === 'rejected').length
//         }
//       });
  
//     } catch (error) {
//       console.error('Update fulfillment status error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to update fulfillment status',
//         error: error.message
//       });
//     }
//   };

// const updateAssetAssignment = async (req, res) => {
//     try {
//       const { requestId } = req.params;
//       const { assignedAssets, totalAssignedValue } = req.body;
  
//       const user = await User.findById(req.user.userId);
//       const request = await ITSupportRequest.findById(requestId)
//         .populate('employee', 'fullName email department');
  
//       if (!request) {
//         return res.status(404).json({
//           success: false,
//           message: 'Request not found'
//         });
//       }
  
//       // Check permissions
//       const canUpdate = user.role === 'admin' || user.role === 'it';
  
//       if (!canUpdate) {
//         return res.status(403).json({
//           success: false,
//           message: 'Access denied'
//         });
//       }
  
//       // Update asset assignment
//       request.assetAssignment = {
//         assignedAssets: assignedAssets.map(asset => ({
//           ...asset,
//           assignmentDate: new Date()
//         })),
//         totalAssignedValue: totalAssignedValue || 0
//       };
  
//       // Update status to pending_discharge for material requests if assets assigned
//       if (assignedAssets && assignedAssets.length > 0) {
//         if (request.requestType === 'material_request') {
//           request.status = 'pending_discharge';
//         } else {
//           request.status = 'resolved';
//         }
//         request.resolution = {
//           description: `Assets assigned: ${assignedAssets.map(a => a.description).join(', ')}`,
//           resolvedBy: user.fullName,
//           resolvedById: user._id,
//           resolvedDate: new Date()
//         };
//       }
  
//       await request.save();
  
//       // Notify employee of asset assignment
//       if (assignedAssets && assignedAssets.length > 0) {
//         await sendEmail({
//           to: request.employee.email,
//           subject: 'IT Assets Assigned to You',
//           html: `
//             <h3>IT Assets Have Been Assigned to You</h3>
//             <p>Dear ${request.employee.fullName},</p>
  
//             <p>The following IT assets have been assigned to you for your request:</p>
  
//             <div style="background-color: #d4edda; padding: 15px; border-radius: 5px; margin: 15px 0;">
//               <ul>
//                 <li><strong>Ticket Number:</strong> ${request.ticketNumber}</li>
//                 <li><strong>Assigned by:</strong> ${user.fullName}</li>
//                 <li><strong>Assets:</strong></li>
//                 <ul>
//                   ${assignedAssets.map(asset => `
//                     <li>${asset.description} ${asset.assetTag ? `(Tag: ${asset.assetTag})` : ''}</li>
//                   `).join('')}
//                 </ul>
//               </ul>
//             </div>
  
//             <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 15px 0;">
//               <p><strong>Important:</strong> Please take care of these assets and report any issues immediately. Some assets may need to be returned when no longer needed.</p>
//             </div>
  
//             <p>Thank you for using our IT Support System!</p>
//           `
//         }).catch(error => {
//           console.error('Failed to send asset assignment notification:', error);
//         });
//       }
  
//       res.json({
//         success: true,
//         message: 'Asset assignment updated successfully',
//         data: request
//       });
  
//     } catch (error) {
//       console.error('Update asset assignment error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to update asset assignment',
//         error: error.message
//       });
//     }
// };

// const updateITRequest = async (req, res) => {
//     try {
//       const { requestId } = req.params;
//       const updateData = req.body;
  
//       const request = await ITSupportRequest.findById(requestId);
  
//       if (!request) {
//         return res.status(404).json({
//           success: false,
//           message: 'Request not found'
//         });
//       }
  
//       // Check if user can update this request
//       const user = await User.findById(req.user.userId);
//       const canUpdate = 
//         request.employee.equals(req.user.userId) || // Owner
//         user.role === 'admin' || // Admin
//         user.role === 'it'; // IT department
  
//       if (!canUpdate) {
//         return res.status(403).json({
//           success: false,
//           message: 'Access denied'
//         });
//       }
  
//       // Only allow updates for drafts or certain statuses
//       const updatableStatuses = ['draft', 'pending_supervisor', 'it_assigned', 'in_progress'];
//       if (!updatableStatuses.includes(request.status)) {
//         return res.status(400).json({
//           success: false,
//           message: 'Cannot update request in current status'
//         });
//       }
  
//       // Update allowed fields
//       const allowedFields = [
//         'title', 'description', 'category', 'subcategory', 'priority', 'urgency',
//         'businessJustification', 'businessImpact', 'location', 'requestedItems',
//         'deviceDetails', 'issueDetails', 'troubleshootingSteps'
//       ];
  
//       allowedFields.forEach(field => {
//         if (updateData[field] !== undefined) {
//           if (['requestedItems', 'deviceDetails', 'issueDetails', 'troubleshootingSteps'].includes(field)) {
//             try {
//               request[field] = typeof updateData[field] === 'string' ? 
//                               JSON.parse(updateData[field]) : updateData[field];
//             } catch (error) {
//               // Keep existing data if parsing fails
//             }
//           } else {
//             request[field] = updateData[field];
//           }
//         }
//       });
  
//       await request.save();
//       await request.populate('employee', 'fullName email department');
  
//       res.json({
//         success: true,
//         message: 'IT request updated successfully',
//         data: request
//       });
  
//     } catch (error) {
//       console.error('Update IT request error:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Failed to update IT request',
//         error: error.message
//       });
//     }
// };

// const getAllITRequests = async (req, res) => {
//   try {
//     const { status, page = 1, limit = 20, department, priority, requestType, startDate, endDate } = req.query;
    
//     let filter = {};
    
//     // Add filters
//     if (status && status !== 'all') filter.status = status;
//     if (priority && priority !== 'all') filter.priority = priority;
//     if (requestType && requestType !== 'all') filter.requestType = requestType;
//     if (department && department !== 'all') {
//       const users = await User.find({ department }).select('_id');
//       filter.employee = { $in: users.map(u => u._id) };
//     }
    
//     // Date range filter
//     if (startDate || endDate) {
//       filter.createdAt = {};
//       if (startDate) filter.createdAt.$gte = new Date(startDate);
//       if (endDate) filter.createdAt.$lte = new Date(endDate);
//     }

//     const requests = await ITSupportRequest.find(filter)
//       .populate('employee', 'fullName email department')
//       .populate('itReview.technicianId', 'fullName')
//       .populate('financeReview.decidedBy', 'fullName')
//       .sort({ createdAt: -1 })
//       .limit(limit * 1)
//       .skip((page - 1) * limit);

//     const totalCount = await ITSupportRequest.countDocuments(filter);

//     res.json({
//       success: true,
//       data: requests,
//       pagination: {
//         current: parseInt(page),
//         total: Math.ceil(totalCount / limit),
//         count: requests.length,
//         totalRecords: totalCount
//       }
//     });

//   } catch (error) {
//     console.error('Get all IT requests error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch IT requests',
//       error: error.message
//     });
//   }
// };

// const getApprovalChainPreview = async (req, res) => {
//   try {
//     const { department, employeeName } = req.body;
    
//     const employee = await User.findById(req.user.userId);
//     if (!employee) {
//       return res.status(404).json({ 
//         success: false, 
//         message: 'Employee not found' 
//       });
//     }

//     // Generate approval chain preview using employee email
//     const rawApprovalChain = getITSupportApprovalChain(employee.email);
    
//     if (!rawApprovalChain || rawApprovalChain.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'Unable to determine approval chain'
//       });
//     }
    
//     // Map the approval chain for preview
//     const mappedChain = mapApprovalChainForITRequest(rawApprovalChain);
    
//     res.json({
//       success: true,
//       data: mappedChain,
//       message: `Found ${mappedChain.length} approval levels`
//     });

//   } catch (error) {
//     console.error('Get approval chain preview error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to get approval chain preview',
//       error: error.message
//     });
//   }
// };

// // const deleteITRequest = async (req, res) => {
// //     try {
// //       const { requestId } = req.params;
  
// //       const request = await ITSupportRequest.findById(requestId);
  
// //       if (!request) {
// //         return res.status(404).json({
// //           success: false,
// //           message: 'Request not found'
// //         });
// //       }
  
// //       // Check permissions
// //       const user = await User.findById(req.user.userId);
// //       const canDelete = 
// //         request.employee.equals(req.user.userId) || 
// //         user.role === 'admin'; 
  
// //       if (!canDelete) {
// //         return res.status(403).json({
// //           success: false,
// //           message: 'Access denied'
// //         });
// //       }
  
// //       // Only allow deletion of draft requests
// //       if (request.status !== 'draft') {
// //         return res.status(400).json({
// //           success: false,
// //           message: 'Can only delete draft requests'
// //         });
// //       }
  
// //       // Clean up attachments if any
// //       if (request.attachments && request.attachments.length > 0) {
// //         await Promise.allSettled(
// //           request.attachments.map(attachment => {
// //             const filePath = path.join(__dirname, '../uploads/it-support', attachment.publicId);
// //             return fs.promises.unlink(filePath).catch(e => console.error('File cleanup failed:', e));
// //           })
// //         );
// //       }
  
// //       await ITSupportRequest.findByIdAndDelete(requestId);
  
// //       res.json({
// //         success: true,
// //         message: 'Draft IT request deleted successfully'
// //       });
  
// //     } catch (error) {
// //       console.error('Delete IT request error:', error);
// //       res.status(500).json({
// //         success: false,
// //         message: 'Failed to delete IT request',
// //         error: error.message
// //       });
// //     }
// // };


// // Add new function for deleting IT request with file cleanup:
// const deleteITRequest = async (req, res) => {
//   try {
//     const { requestId } = req.params;

//     const request = await ITSupportRequest.findById(requestId);

//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Request not found'
//       });
//     }

//     // Check permissions
//     const user = await User.findById(req.user.userId);
//     const canDelete = 
//       request.employee.equals(req.user.userId) || 
//       user.role === 'admin'; 

//     if (!canDelete) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied'
//       });
//     }

//     // Only allow deletion of draft requests
//     if (request.status !== 'draft') {
//       return res.status(400).json({
//         success: false,
//         message: 'Can only delete draft requests'
//       });
//     }

//     // Clean up attachments using new storage service
//     if (request.attachments && request.attachments.length > 0) {
//       console.log(`🗑️  Deleting ${request.attachments.length} attachments...`);
//       const deleteResult = await deleteFiles(request.attachments);
//       console.log(`   ✓ Cleanup result:`, deleteResult);
//     }

//     await ITSupportRequest.findByIdAndDelete(requestId);

//     res.json({
//       success: true,
//       message: 'Draft IT request deleted successfully'
//     });

//   } catch (error) {
//     console.error('Delete IT request error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to delete IT request',
//       error: error.message
//     });
//   }
// };

// // Export all functions
// module.exports = {
//     // Core CRUD operations
//     createITRequest,
//     updateITRequest,
//     deleteITRequest,
  
//     // Employee functions
//     getEmployeeITRequests,
//     getITRequestDetails,
  
//     // Supervisor functions
//     getSupervisorITRequests,
//     processSupervisorDecision,
  
//     // IT Department functions
//     getITDepartmentRequests,
//     processITDepartmentDecision,
//     updateFulfillmentStatus,
//     updateAssetAssignment,
  
//     // Finance functions
//     getFinanceITRequests,
//     processFinanceDecision,
  
//     // Admin functions
//     getAllITRequests,
  
//     // Utility functions
//     getApprovalChainPreview,
//     getITRequestsByRole,
  
//     // Analytics and reporting
//     getDashboardStats,
//     getCategoryAnalytics,
//     getAssetAnalytics,
//     getInventoryStatus,
//     getITRequestStats,
  
//     // Draft management
//     saveDraft
// };


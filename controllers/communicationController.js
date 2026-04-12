const Communication = require('../models/Communication');
const CommunicationReadReceipt = require('../models/CommunicationReadReceipt');
const User = require('../models/User');
const { batchSendEmails } = require('../services/communicationEmailService');
const path = require('path');
const fs = require('fs').promises;

/**
 * Create new communication (draft or scheduled)
 */
exports.createCommunication = async (req, res) => {
  try {
    const {
      title,
      content,
      messageType,
      priority,
      recipients,
      deliveryMethod,
      scheduledFor,
      tags,
      isTemplate,
      templateName
    } = req.body;

    // Validate user permissions
    if (!['admin', 'hr'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Only Admin and HR can create communications'
      });
    }

    // Parse recipients if it's a string
    const parsedRecipients = typeof recipients === 'string' 
      ? JSON.parse(recipients) 
      : recipients;

    // Parse deliveryMethod if it's a string
    const parsedDeliveryMethod = typeof deliveryMethod === 'string'
      ? JSON.parse(deliveryMethod)
      : deliveryMethod;

    // Create communication object
    const communication = new Communication({
      title,
      content,
      messageType: messageType || 'general',
      priority: priority || 'normal',
      sender: req.user._id,
      recipients: parsedRecipients,
      deliveryMethod: parsedDeliveryMethod || { email: true, inApp: false },
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      status: scheduledFor ? 'scheduled' : 'draft',
      tags: tags ? (Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim())) : [],
      isTemplate: isTemplate || false,
      templateName: isTemplate ? templateName : null
    });

    // Handle file attachments
    if (req.files && req.files.length > 0) {
      communication.attachments = req.files.map(file => ({
        filename: file.filename,
        originalName: file.originalname,
        path: file.path,
        size: file.size,
        mimetype: file.mimetype
      }));
    }

    // Calculate recipient count
    await communication.calculateRecipientCount();

    await communication.save();

    // Populate sender info
    await communication.populate('sender', 'fullName email role');

    res.status(201).json({
      success: true,
      message: scheduledFor 
        ? 'Communication scheduled successfully' 
        : 'Draft created successfully',
      data: communication
    });

  } catch (error) {
    console.error('Error creating communication:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create communication'
    });
  }
};

/**
 * Send communication immediately
 */
exports.sendCommunication = async (req, res) => {
  try {
    const { id } = req.params;

    if (!['admin', 'hr'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const communication = await Communication.findById(id)
      .populate('sender', 'fullName email');

    if (!communication) {
      return res.status(404).json({
        success: false,
        message: 'Communication not found'
      });
    }

    if (communication.status === 'sent') {
      return res.status(400).json({
        success: false,
        message: 'Communication already sent'
      });
    }

    // Update status to sending
    communication.status = 'sending';
    await communication.save();

    // Start async sending process
    sendCommunicationAsync(communication._id);

    res.json({
      success: true,
      message: 'Communication is being sent in the background',
      data: {
        id: communication._id,
        status: 'sending',
        totalRecipients: communication.recipients.totalCount
      }
    });

  } catch (error) {
    console.error('Error sending communication:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send communication'
    });
  }
};

/**
 * Async function to send communication in background
 */
const sendCommunicationAsync = async (communicationId) => {
  try {
    const communication = await Communication.findById(communicationId)
      .populate('sender', 'fullName email');

    if (!communication) {
      console.error('Communication not found:', communicationId);
      return;
    }

    // Get recipient list
    const recipients = await communication.getRecipientList();

    if (recipients.length === 0) {
      communication.status = 'failed';
      await communication.save();
      console.error('No recipients found for communication:', communicationId);
      return;
    }

    // Send emails
    if (communication.deliveryMethod.email) {
      const emailResults = await batchSendEmails(communication, recipients);
      
      communication.deliveryStats.emailsSent = emailResults.sent;
      communication.deliveryStats.emailsFailed = emailResults.failed;
    }

    // Create in-app notifications (if enabled)
    if (communication.deliveryMethod.inApp) {
      // Implementation depends on your notification system
      // For now, we'll just increment the counter
      communication.deliveryStats.inAppDelivered = recipients.length;
    }

    // Update status
    communication.status = 'sent';
    communication.sentAt = new Date();
    communication.deliveryStats.lastUpdated = new Date();
    await communication.save();

    console.log(`✅ Communication ${communicationId} sent successfully to ${recipients.length} recipients`);

  } catch (error) {
    console.error('Error in sendCommunicationAsync:', error);
    
    // Update communication status to failed
    try {
      await Communication.findByIdAndUpdate(communicationId, {
        status: 'failed'
      });
    } catch (updateError) {
      console.error('Failed to update communication status:', updateError);
    }
  }
};

/**
 * Get all communications (with filters)
 */
exports.getCommunications = async (req, res) => {
  try {
    const {
      status,
      messageType,
      priority,
      search,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    if (!['admin', 'hr'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const query = {};

    if (status) query.status = status;
    if (messageType) query.messageType = messageType;
    if (priority) query.priority = priority;
    
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    // HR can only see their own communications unless admin
    if (req.user.role === 'hr') {
      query.sender = req.user._id;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [communications, total] = await Promise.all([
      Communication.find(query)
        .populate('sender', 'fullName email role')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Communication.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: communications,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Error fetching communications:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch communications'
    });
  }
};

/**
 * Get single communication details
 */
exports.getCommunication = async (req, res) => {
  try {
    const { id } = req.params;

    if (!['admin', 'hr'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const communication = await Communication.findById(id)
      .populate('sender', 'fullName email role department')
      .populate('approvedBy', 'fullName email');

    if (!communication) {
      return res.status(404).json({
        success: false,
        message: 'Communication not found'
      });
    }

    // HR can only view their own communications
    if (req.user.role === 'hr' && communication.sender._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only view your own communications'
      });
    }

    // Get read statistics
    const readStats = await CommunicationReadReceipt.getReadStats(id);

    res.json({
      success: true,
      data: {
        ...communication.toObject(),
        readStats
      }
    });

  } catch (error) {
    console.error('Error fetching communication:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch communication'
    });
  }
};

/**
 * Update communication (only drafts and scheduled)
 */
exports.updateCommunication = async (req, res) => {
  try {
    const { id } = req.params;

    if (!['admin', 'hr'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const communication = await Communication.findById(id);

    if (!communication) {
      return res.status(404).json({
        success: false,
        message: 'Communication not found'
      });
    }

    // Can't update sent communications
    if (communication.status === 'sent') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update sent communications'
      });
    }

    // HR can only update their own communications
    if (req.user.role === 'hr' && communication.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own communications'
      });
    }

    const {
      title,
      content,
      messageType,
      priority,
      recipients,
      deliveryMethod,
      scheduledFor,
      tags
    } = req.body;

    // Update fields
    if (title) communication.title = title;
    if (content) communication.content = content;
    if (messageType) communication.messageType = messageType;
    if (priority) communication.priority = priority;
    
    if (recipients) {
      communication.recipients = typeof recipients === 'string' 
        ? JSON.parse(recipients) 
        : recipients;
      await communication.calculateRecipientCount();
    }
    
    if (deliveryMethod) {
      communication.deliveryMethod = typeof deliveryMethod === 'string'
        ? JSON.parse(deliveryMethod)
        : deliveryMethod;
    }
    
    if (scheduledFor !== undefined) {
      communication.scheduledFor = scheduledFor ? new Date(scheduledFor) : null;
      communication.status = scheduledFor ? 'scheduled' : 'draft';
    }
    
    if (tags) {
      communication.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim());
    }

    // Handle new attachments
    if (req.files && req.files.length > 0) {
      const newAttachments = req.files.map(file => ({
        filename: file.filename,
        originalName: file.originalname,
        path: file.path,
        size: file.size,
        mimetype: file.mimetype
      }));
      communication.attachments.push(...newAttachments);
    }

    // Record edit history
    communication.editHistory.push({
      editedBy: req.user._id,
      editedAt: new Date(),
      changes: 'Communication updated'
    });

    await communication.save();
    await communication.populate('sender', 'fullName email role');

    res.json({
      success: true,
      message: 'Communication updated successfully',
      data: communication
    });

  } catch (error) {
    console.error('Error updating communication:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update communication'
    });
  }
};

/**
 * Delete communication
 */
exports.deleteCommunication = async (req, res) => {
  try {
    const { id } = req.params;

    if (!['admin', 'hr'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const communication = await Communication.findById(id);

    if (!communication) {
      return res.status(404).json({
        success: false,
        message: 'Communication not found'
      });
    }

    // Only admin can delete sent communications
    if (communication.status === 'sent' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin can delete sent communications'
      });
    }

    // HR can only delete their own communications
    if (req.user.role === 'hr' && communication.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own communications'
      });
    }

    // Delete attachment files
    if (communication.attachments && communication.attachments.length > 0) {
      for (const attachment of communication.attachments) {
        try {
          await fs.unlink(attachment.path);
        } catch (err) {
          console.warn('Failed to delete attachment file:', attachment.path, err.message);
        }
      }
    }

    // Delete read receipts
    await CommunicationReadReceipt.deleteMany({ communication: id });

    await communication.deleteOne();

    res.json({
      success: true,
      message: 'Communication deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting communication:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete communication'
    });
  }
};

/**
 * Delete attachment from communication
 */
exports.deleteAttachment = async (req, res) => {
  try {
    const { id, attachmentId } = req.params;

    if (!['admin', 'hr'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const communication = await Communication.findById(id);

    if (!communication) {
      return res.status(404).json({
        success: false,
        message: 'Communication not found'
      });
    }

    if (communication.status === 'sent') {
      return res.status(400).json({
        success: false,
        message: 'Cannot modify sent communications'
      });
    }

    const attachment = communication.attachments.id(attachmentId);
    
    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found'
      });
    }

    // Delete file
    try {
      await fs.unlink(attachment.path);
    } catch (err) {
      console.warn('Failed to delete attachment file:', err.message);
    }

    // Remove from array
    communication.attachments.pull(attachmentId);
    await communication.save();

    res.json({
      success: true,
      message: 'Attachment deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting attachment:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete attachment'
    });
  }
};

/**
 * Preview recipient count before sending
 */
exports.previewRecipients = async (req, res) => {
  try {
    const { recipients } = req.body;

    if (!['admin', 'hr'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // Create temporary communication to calculate recipients
    const tempComm = new Communication({
      title: 'Preview',
      content: 'Preview',
      sender: req.user._id,
      recipients: typeof recipients === 'string' ? JSON.parse(recipients) : recipients
    });

    const count = await tempComm.calculateRecipientCount();
    const recipientList = await tempComm.getRecipientList();

    res.json({
      success: true,
      data: {
        count,
        preview: recipientList.slice(0, 10).map(r => ({
          name: r.fullName,
          email: r.email,
          department: r.department,
          role: r.role
        }))
      }
    });

  } catch (error) {
    console.error('Error previewing recipients:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to preview recipients'
    });
  }
};

/**
 * Get dashboard statistics
 */
exports.getDashboardStats = async (req, res) => {
  try {
    if (!['admin', 'hr'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const filter = req.user.role === 'hr' ? { sender: req.user._id } : {};

    const stats = await Communication.getDashboardStats(filter);

    const [totalDrafts, totalScheduled, recentCommunications] = await Promise.all([
      Communication.countDocuments({ ...filter, status: 'draft' }),
      Communication.countDocuments({ ...filter, status: 'scheduled' }),
      Communication.find({ ...filter, status: 'sent' })
        .sort({ sentAt: -1 })
        .limit(5)
        .populate('sender', 'fullName email')
        .select('title messageType priority sentAt recipients.totalCount deliveryStats')
    ]);

    res.json({
      success: true,
      data: {
        ...stats,
        drafts: totalDrafts,
        scheduled: totalScheduled,
        recent: recentCommunications
      }
    });

  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch statistics'
    });
  }
};

/**
 * Get analytics data
 */
exports.getAnalytics = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin can view analytics'
      });
    }

    const { startDate, endDate } = req.query;

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    const filter = Object.keys(dateFilter).length > 0 
      ? { sentAt: dateFilter }
      : {};

    const [
      overallStats,
      timeSeriesData,
      topSenders,
      engagementByType
    ] = await Promise.all([
      Communication.getDashboardStats(filter),
      
      // Time series data (by day)
      Communication.aggregate([
        { $match: { status: 'sent', ...filter } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$sentAt' } },
            count: { $sum: 1 },
            totalRecipients: { $sum: '$recipients.totalCount' },
            totalReads: { $sum: '$deliveryStats.readCount' }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      
      // Top senders
      Communication.aggregate([
        { $match: { status: 'sent', ...filter } },
        {
          $group: {
            _id: '$sender',
            count: { $sum: 1 },
            totalRecipients: { $sum: '$recipients.totalCount' }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'senderInfo'
          }
        },
        { $unwind: '$senderInfo' }
      ]),
      
      // Engagement by message type
      Communication.aggregate([
        { $match: { status: 'sent', ...filter } },
        {
          $group: {
            _id: '$messageType',
            count: { $sum: 1 },
            avgReadRate: {
              $avg: {
                $multiply: [
                  { $divide: ['$deliveryStats.readCount', '$recipients.totalCount'] },
                  100
                ]
              }
            }
          }
        }
      ])
    ]);

    res.json({
      success: true,
      data: {
        overall: overallStats,
        timeSeries: timeSeriesData,
        topSenders: topSenders.map(s => ({
          name: s.senderInfo.fullName,
          email: s.senderInfo.email,
          count: s.count,
          totalRecipients: s.totalRecipients
        })),
        engagementByType
      }
    });

  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch analytics'
    });
  }
};

/**
 * Get templates
 */
exports.getTemplates = async (req, res) => {
  try {
    if (!['admin', 'hr'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const filter = { isTemplate: true };
    
    // HR can only see their own templates
    if (req.user.role === 'hr') {
      filter.sender = req.user._id;
    }

    const templates = await Communication.find(filter)
      .populate('sender', 'fullName email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: templates
    });

  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch templates'
    });
  }
};

/**
 * Save communication as template
 */
exports.saveAsTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { templateName } = req.body;

    if (!['admin', 'hr'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const communication = await Communication.findById(id);

    if (!communication) {
      return res.status(404).json({
        success: false,
        message: 'Communication not found'
      });
    }

    await communication.saveAsTemplate(templateName);

    res.json({
      success: true,
      message: 'Template saved successfully',
      data: communication
    });

  } catch (error) {
    console.error('Error saving template:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to save template'
    });
  }
};

module.exports = exports;
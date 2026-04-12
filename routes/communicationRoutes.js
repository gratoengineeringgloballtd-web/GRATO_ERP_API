const express = require('express');
const router = express.Router();
const upload = require('../middlewares/uploadMiddleware');
const communicationController = require('../controllers/communicationController');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');

// Middleware to restrict to admin and HR only
// const adminOrHR = requireRoles(['admin', 'hr']);

// ============================================
// COMMUNICATION CRUD ROUTES
// ============================================

/**
 * @route   POST /api/communications
 * @desc    Create new communication (draft/scheduled)
 * @access  Admin, HR
 */
router.post(
  '/',
  authMiddleware,
  requireRoles('admin', 'hr'),
  upload.array('attachments', 10),
  communicationController.createCommunication
);

/**
 * @route   GET /api/communications
 * @desc    Get all communications with filters
 * @access  Admin, HR
 */
router.get(
  '/',
  authMiddleware,
  requireRoles('admin', 'hr'),
  communicationController.getCommunications
);

/**
 * @route   GET /api/communications/:id
 * @desc    Get single communication details
 * @access  Admin, HR
 */
router.get(
  '/:id',
  authMiddleware,
  requireRoles('admin', 'hr'),
  communicationController.getCommunication
);

/**
 * @route   PUT /api/communications/:id
 * @desc    Update communication (drafts/scheduled only)
 * @access  Admin, HR (own only)
 */
router.put(
  '/:id',
  authMiddleware,
  requireRoles('admin', 'hr'),
  upload.array('attachments', 10),
  communicationController.updateCommunication
);

/**
 * @route   DELETE /api/communications/:id
 * @desc    Delete communication
 * @access  Admin, HR (own only for drafts)
 */
router.delete(
  '/:id',
  authMiddleware,
  requireRoles('admin', 'hr'),
  communicationController.deleteCommunication
);

// ============================================
// SENDING & SCHEDULING
// ============================================

/**
 * @route   POST /api/communications/:id/send
 * @desc    Send communication immediately
 * @access  Admin, HR
 */
router.post(
  '/:id/send',
  authMiddleware,
  requireRoles('admin', 'hr'),
  communicationController.sendCommunication
);

/**
 * @route   POST /api/communications/preview-recipients
 * @desc    Preview recipient count and list
 * @access  Admin, HR
 */
router.post(
  '/preview-recipients',
  authMiddleware,
  requireRoles('admin', 'hr'),
  communicationController.previewRecipients
);

// ============================================
// ATTACHMENTS
// ============================================

/**
 * @route   DELETE /api/communications/:id/attachments/:attachmentId
 * @desc    Delete attachment from communication
 * @access  Admin, HR
 */
router.delete(
  '/:id/attachments/:attachmentId',
  authMiddleware,
  requireRoles('admin', 'hr'),
  communicationController.deleteAttachment
);

/**
 * @route   GET /api/communications/:id/attachment/:attachmentId
 * @desc    Download attachment
 * @access  Authenticated users
 */
router.get(
  '/:id/attachment/:attachmentId',
  authMiddleware,
  async (req, res) => {
    try {
      const { id, attachmentId } = req.params;
      const Communication = require('../models/Communication');
      
      const communication = await Communication.findById(id);
      
      if (!communication) {
        return res.status(404).json({
          success: false,
          message: 'Communication not found'
        });
      }
      
      const attachment = communication.attachments.id(attachmentId);
      
      if (!attachment) {
        return res.status(404).json({
          success: false,
          message: 'Attachment not found'
        });
      }
      
      res.download(attachment.path, attachment.originalName || attachment.filename);
      
    } catch (error) {
      console.error('Error downloading attachment:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to download attachment'
      });
    }
  }
);

// ============================================
// STATISTICS & ANALYTICS
// ============================================

/**
 * @route   GET /api/communications/stats/dashboard
 * @desc    Get dashboard statistics
 * @access  Admin, HR
 */
router.get(
  '/stats/dashboard',
  authMiddleware,
  requireRoles('admin', 'hr'),
  communicationController.getDashboardStats
);

/**
 * @route   GET /api/communications/stats/analytics
 * @desc    Get detailed analytics
 * @access  Admin only
 */
router.get(
  '/stats/analytics',
  authMiddleware,
  requireRoles(['admin']),
  communicationController.getAnalytics
);

// ============================================
// TEMPLATES
// ============================================

/**
 * @route   GET /api/communications/templates/list
 * @desc    Get all templates
 * @access  Admin, HR
 */
router.get(
  '/templates/list',
  authMiddleware,
  requireRoles('admin', 'hr'),
  communicationController.getTemplates
);

/**
 * @route   POST /api/communications/:id/save-template
 * @desc    Save communication as template
 * @access  Admin, HR
 */
router.post(
  '/:id/save-template',
  authMiddleware,
  requireRoles('admin', 'hr'),
  communicationController.saveAsTemplate
);

// ============================================
// READ TRACKING (Public endpoints with token)
// ============================================

/**
 * @route   GET /api/communications/:id/track-open
 * @desc    Track email open (pixel)
 * @access  Public (with user param)
 */
router.get(
  '/:id/track-open',
  async (req, res) => {
    try {
      const { id } = req.params;
      const { user } = req.query;
      
      if (user) {
        const CommunicationReadReceipt = require('../models/CommunicationReadReceipt');
        const Communication = require('../models/Communication');
        
        // Create or update read receipt
        await CommunicationReadReceipt.findOneAndUpdate(
          { communication: id, user },
          {
            emailOpened: true,
            emailOpenedAt: new Date()
          },
          { upsert: true, new: true }
        );
        
        // Update communication stats
        await Communication.findByIdAndUpdate(id, {
          $inc: { 'deliveryStats.readCount': 1 }
        });
      }
      
      // Return 1x1 transparent pixel
      const pixel = Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        'base64'
      );
      res.writeHead(200, {
        'Content-Type': 'image/gif',
        'Content-Length': pixel.length
      });
      res.end(pixel);
      
    } catch (error) {
      console.error('Error tracking open:', error);
      res.status(200).end(); // Still return success to not break email
    }
  }
);

/**
 * @route   GET /api/communications/:id/track-click
 * @desc    Track link click and redirect
 * @access  Public (with user and url params)
 */
router.get(
  '/:id/track-click',
  async (req, res) => {
    try {
      const { id } = req.params;
      const { user, url } = req.query;
      
      if (user && url) {
        const CommunicationReadReceipt = require('../models/CommunicationReadReceipt');
        const Communication = require('../models/Communication');
        
        // Find or create read receipt
        let receipt = await CommunicationReadReceipt.findOne({
          communication: id,
          user
        });
        
        if (!receipt) {
          receipt = new CommunicationReadReceipt({
            communication: id,
            user
          });
        }
        
        // Record link click
        await receipt.recordLinkClick(url);
        
        // Update communication stats
        await Communication.findByIdAndUpdate(id, {
          $inc: { 'deliveryStats.clickCount': 1 }
        });
      }
      
      // Redirect to actual URL
      res.redirect(decodeURIComponent(url));
      
    } catch (error) {
      console.error('Error tracking click:', error);
      // Still redirect even if tracking fails
      res.redirect(decodeURIComponent(req.query.url || '/'));
    }
  }
);

/**
 * @route   POST /api/communications/:id/mark-read
 * @desc    Mark communication as read (in-app)
 * @access  Authenticated users
 */
router.post(
  '/:id/mark-read',
  authMiddleware,
  async (req, res) => {
    try {
      const { id } = req.params;
      const CommunicationReadReceipt = require('../models/CommunicationReadReceipt');
      const Communication = require('../models/Communication');
      
      // Create or update read receipt
      await CommunicationReadReceipt.findOneAndUpdate(
        { communication: id, user: req.user._id },
        {
          readAt: new Date(),
          userAgent: req.headers['user-agent'],
          ipAddress: req.ip
        },
        { upsert: true, new: true }
      );
      
      // Update communication stats
      await Communication.findByIdAndUpdate(id, {
        $inc: { 'deliveryStats.readCount': 1 }
      });
      
      res.json({
        success: true,
        message: 'Marked as read'
      });
      
    } catch (error) {
      console.error('Error marking as read:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to mark as read'
      });
    }
  }
);

// ============================================
// EMPLOYEE VIEW ROUTES
// ============================================

/**
 * @route   GET /api/communications/employee/view/:id
 * @desc    View communication (employee perspective)
 * @access  Authenticated users
 */
router.get(
  '/employee/view/:id',
  authMiddleware,
  async (req, res) => {
    try {
      const { id } = req.params;
      const Communication = require('../models/Communication');
      
      const communication = await Communication.findOne({
        _id: id,
        status: 'sent'
      }).populate('sender', 'fullName role');
      
      if (!communication) {
        return res.status(404).json({
          success: false,
          message: 'Communication not found'
        });
      }
      
      res.json({
        success: true,
        data: communication
      });
      
    } catch (error) {
      console.error('Error viewing communication:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to load communication'
      });
    }
  }
);

/**
 * @route   GET /api/communications/employee/list
 * @desc    Get communications for current user
 * @access  Authenticated users
 */
router.get(
  '/employee/list',
  authMiddleware,
  async (req, res) => {
    try {
      const Communication = require('../models/Communication');
      const { page = 1, limit = 20 } = req.query;
      
      // Find communications where user is a recipient
      const query = {
        status: 'sent',
        $or: [
          { 'recipients.targetType': 'all' },
          { 'recipients.departments': req.user.department },
          { 'recipients.roles': req.user.role },
          { 'recipients.users': req.user._id }
        ]
      };
      
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      const [communications, total] = await Promise.all([
        Communication.find(query)
          .populate('sender', 'fullName role')
          .sort({ sentAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .select('title messageType priority sentAt content'),
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
      console.error('Error fetching employee communications:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to load communications'
      });
    }
  }
);

module.exports = router;
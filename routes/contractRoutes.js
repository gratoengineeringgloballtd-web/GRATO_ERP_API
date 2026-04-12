const express = require('express');
const router = express.Router();
const contractController = require('../controllers/contractController');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');

// Get all contracts
router.get('/',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  contractController.getAllContracts
);

// Get specific contract by ID
router.get('/:contractId',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  contractController.getContractById
);

// Create new contract
router.post('/',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  upload.fields([
    { name: 'contractDocuments', maxCount: 10 }
  ]),
  upload.validateFiles,
  upload.cleanupTempFiles,
  contractController.createContract
);

// Update contract
router.put('/:contractId',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  upload.fields([
    { name: 'contractDocuments', maxCount: 10 }
  ]),
  upload.validateFiles,
  upload.cleanupTempFiles,
  contractController.updateContract
);

// Delete contract (Admin only)
router.delete('/:contractId',
  authMiddleware,
  requireRoles('admin'),
  contractController.deleteContract
);

// Update contract status
router.put('/:contractId/status',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  contractController.updateContractStatus
);

// Approve contract
router.post('/:contractId/approve',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  async (req, res) => {
    req.body.status = 'approved';
    return contractController.updateContractStatus(req, res);
  }
);

// Terminate contract
router.post('/:contractId/terminate',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  async (req, res) => {
    req.body.status = 'terminated';
    return contractController.updateContractStatus(req, res);
  }
);

// Suspend contract
router.post('/:contractId/suspend',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  async (req, res) => {
    req.body.status = 'suspended';
    return contractController.updateContractStatus(req, res);
  }
);


// Renew contract
router.post('/:contractId/renew',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  contractController.renewContract
);


// Create contract amendment
router.post('/:contractId/amendments',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  upload.fields([
    { name: 'amendmentDocuments', maxCount: 5 }
  ]),
  upload.validateFiles,
  upload.cleanupTempFiles,
  contractController.createAmendment
);

// Approve amendment
router.put('/:contractId/amendments/:amendmentId/approve',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  async (req, res) => {
    try {
      const { contractId, amendmentId } = req.params;
      const { approvalNotes } = req.body;

      const contract = await Contract.findById(contractId);
      if (!contract) {
        return res.status(404).json({
          success: false,
          message: 'Contract not found'
        });
      }

      const amendment = contract.amendments.id(amendmentId);
      if (!amendment) {
        return res.status(404).json({
          success: false,
          message: 'Amendment not found'
        });
      }

      amendment.status = 'approved';
      amendment.approvedBy = req.user.userId;
      
      // Apply financial impact if any
      if (amendment.financialImpact && amendment.financialImpact.amount) {
        if (amendment.financialImpact.type === 'increase') {
          contract.financials.totalValue += amendment.financialImpact.amount;
        } else if (amendment.financialImpact.type === 'decrease') {
          contract.financials.totalValue -= amendment.financialImpact.amount;
        }
      }

      await contract.save();

      res.json({
        success: true,
        message: 'Amendment approved successfully',
        data: contract
      });
    } catch (error) {
      console.error('Error approving amendment:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to approve amendment'
      });
    }
  }
);


// Add milestone to contract
router.post('/:contractId/milestones',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  async (req, res) => {
    try {
      const { contractId } = req.params;
      const milestoneData = req.body;

      const contract = await Contract.findById(contractId);
      if (!contract) {
        return res.status(404).json({
          success: false,
          message: 'Contract not found'
        });
      }

      await contract.addMilestone(milestoneData, req.user.userId);

      res.json({
        success: true,
        message: 'Milestone added successfully',
        data: contract
      });
    } catch (error) {
      console.error('Error adding milestone:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add milestone'
      });
    }
  }
);

// Update milestone status
router.put('/:contractId/milestones/:milestoneId',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  async (req, res) => {
    try {
      const { contractId, milestoneId } = req.params;
      const { status, completedDate, notes } = req.body;

      const contract = await Contract.findById(contractId);
      if (!contract) {
        return res.status(404).json({
          success: false,
          message: 'Contract not found'
        });
      }

      await contract.updateMilestoneStatus(milestoneId, status, completedDate);

      // Add communication record
      await contract.addCommunication({
        type: 'other',
        subject: 'Milestone Updated',
        summary: `Milestone status updated to ${status}${notes ? `: ${notes}` : ''}`,
        participants: [req.user.fullName || 'User']
      }, req.user.userId);

      res.json({
        success: true,
        message: 'Milestone updated successfully',
        data: contract
      });
    } catch (error) {
      console.error('Error updating milestone:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update milestone'
      });
    }
  }
);


// Add communication record
router.post('/:contractId/communications',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  async (req, res) => {
    try {
      const { contractId } = req.params;
      const communicationData = req.body;

      const contract = await Contract.findById(contractId);
      if (!contract) {
        return res.status(404).json({
          success: false,
          message: 'Contract not found'
        });
      }

      await contract.addCommunication(communicationData, req.user.userId);

      res.json({
        success: true,
        message: 'Communication record added successfully'
      });
    } catch (error) {
      console.error('Error adding communication:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add communication record'
      });
    }
  }
);


// Upload additional documents
router.post('/:contractId/documents',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  upload.fields([
    { name: 'documents', maxCount: 10 }
  ]),
  upload.validateFiles,
  upload.cleanupTempFiles,
  async (req, res) => {
    try {
      const { contractId } = req.params;
      const { documentType, description } = req.body;

      const contract = await Contract.findById(contractId);
      if (!contract) {
        return res.status(404).json({
          success: false,
          message: 'Contract not found'
        });
      }

      if (!req.files || !req.files.documents) {
        return res.status(400).json({
          success: false,
          message: 'No documents uploaded'
        });
      }

      const uploadedDocs = [];
      const { uploadFile } = require('../services/fileUploadService');

      for (const file of req.files.documents) {
        try {
          const uploadResult = await uploadFile(file, `contract-documents/${contractId}`);
          
          const newDocument = {
            name: description || file.originalname,
            type: documentType || contractController.getDocumentType(file.originalname),
            filename: uploadResult.filename,
            originalName: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            url: uploadResult.url,
            publicId: uploadResult.publicId,
            uploadedBy: req.user.userId
          };

          contract.documents.push(newDocument);
          uploadedDocs.push(newDocument);
          
        } catch (uploadError) {
          console.error('Failed to upload document:', uploadError);
        }
      }

      await contract.save();

      res.json({
        success: true,
        message: `${uploadedDocs.length} document(s) uploaded successfully`,
        data: uploadedDocs
      });
    } catch (error) {
      console.error('Error uploading documents:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to upload documents'
      });
    }
  }
);

// Download contract document
router.get('/:contractId/documents/:documentId',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  async (req, res) => {
    try {
      const { contractId, documentId } = req.params;

      const contract = await Contract.findById(contractId);
      if (!contract) {
        return res.status(404).json({
          success: false,
          message: 'Contract not found'
        });
      }

      const document = contract.documents.id(documentId);
      if (!document) {
        return res.status(404).json({
          success: false,
          message: 'Document not found'
        });
      }

      // For now, redirect to the URL
      res.redirect(document.url);
    } catch (error) {
      console.error('Error downloading document:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to download document'
      });
    }
  }
);


// Get contract statistics
router.get('/analytics/statistics',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance'),
  async (req, res) => {
    try {
      const stats = await contractController.getContractStatistics();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error fetching contract statistics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch statistics'
      });
    }
  }
);

// Get expiring contracts
router.get('/analytics/expiring',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance'),
  contractController.getExpiringContracts
);

// Get contracts by supplier
router.get('/analytics/by-supplier/:supplierId',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance'),
  async (req, res) => {
    try {
      const { supplierId } = req.params;
      
      const contracts = await Contract.find({
        'supplier.supplierId': supplierId
      }).populate('management.contractManager', 'fullName email')
        .sort({ 'dates.creationDate': -1 });

      res.json({
        success: true,
        data: contracts,
        count: contracts.length
      });
    } catch (error) {
      console.error('Error fetching supplier contracts:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch supplier contracts'
      });
    }
  }
);

// Get contracts by department
router.get('/analytics/by-department/:department',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance'),
  async (req, res) => {
    try {
      const { department } = req.params;
      
      const contracts = await Contract.find({
        'management.department': department
      }).populate('management.contractManager', 'fullName email')
        .populate('supplier.supplierId', 'fullName email')
        .sort({ 'dates.creationDate': -1 });

      res.json({
        success: true,
        data: contracts,
        count: contracts.length
      });
    } catch (error) {
      console.error('Error fetching department contracts:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch department contracts'
      });
    }
  }
);


// Export contracts to Excel/JSON
router.get('/export',
  authMiddleware,
  requireRoles('admin', 'supply_chain', 'finance'),
  contractController.exportContracts
);


// Get contract notifications for current user
router.get('/notifications/my-contracts',
  authMiddleware,
  async (req, res) => {
    try {
      const userId = req.user.userId;
      
      const contracts = await Contract.find({
        $or: [
          { 'management.contractManager': userId },
          { 'management.createdBy': userId }
        ],
        'notifications.isActive': true
      }).select('contractNumber title notifications status dates')
        .populate('management.contractManager', 'fullName')
        .lean();

      const notifications = [];
      contracts.forEach(contract => {
        contract.notifications.forEach(notification => {
          if (notification.isActive) {
            notifications.push({
              contractId: contract._id,
              contractNumber: contract.contractNumber,
              contractTitle: contract.title,
              ...notification
            });
          }
        });
      });

      // Sort by severity and creation date
      notifications.sort((a, b) => {
        const severityOrder = { critical: 4, error: 3, warning: 2, info: 1 };
        if (severityOrder[a.severity] !== severityOrder[b.severity]) {
          return severityOrder[b.severity] - severityOrder[a.severity];
        }
        return new Date(b.createdDate) - new Date(a.createdDate);
      });

      res.json({
        success: true,
        data: notifications,
        count: notifications.length
      });
    } catch (error) {
      console.error('Error fetching contract notifications:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch notifications'
      });
    }
  }
);

// Acknowledge notification
router.put('/notifications/:contractId/:notificationId/acknowledge',
  authMiddleware,
  async (req, res) => {
    try {
      const { contractId, notificationId } = req.params;

      const contract = await Contract.findById(contractId);
      if (!contract) {
        return res.status(404).json({
          success: false,
          message: 'Contract not found'
        });
      }

      const notification = contract.notifications.id(notificationId);
      if (!notification) {
        return res.status(404).json({
          success: false,
          message: 'Notification not found'
        });
      }

      notification.acknowledgedBy = req.user.userId;
      notification.acknowledgedDate = new Date();
      notification.isActive = false;

      await contract.save();

      res.json({
        success: true,
        message: 'Notification acknowledged'
      });
    } catch (error) {
      console.error('Error acknowledging notification:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to acknowledge notification'
      });
    }
  }
);


// Bulk update contract statuses
router.put('/bulk/status',
  authMiddleware,
  requireRoles('admin', 'supply_chain'),
  async (req, res) => {
    try {
      const { contractIds, status, reason } = req.body;

      if (!contractIds || !Array.isArray(contractIds) || contractIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Contract IDs are required'
        });
      }

      const results = [];

      for (const contractId of contractIds) {
        try {
          const contract = await Contract.findById(contractId);
          if (contract) {
            const oldStatus = contract.status;
            contract.status = status;
            
            // Add communication record
            await contract.addCommunication({
              type: 'other',
              subject: 'Bulk Status Update',
              summary: `Status updated from ${oldStatus} to ${status} via bulk operation${reason ? `. Reason: ${reason}` : ''}`,
              participants: [req.user.fullName || 'User']
            }, req.user.userId);

            await contract.save();
            
            results.push({
              contractId,
              success: true,
              oldStatus,
              newStatus: status
            });
          } else {
            results.push({
              contractId,
              success: false,
              error: 'Contract not found'
            });
          }
        } catch (error) {
          results.push({
            contractId,
            success: false,
            error: error.message
          });
        }
      }

      res.json({
        success: true,
        message: 'Bulk update completed',
        data: results
      });
    } catch (error) {
      console.error('Error in bulk status update:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to perform bulk update'
      });
    }
  }
);


// Advanced contract search
router.post('/search',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  async (req, res) => {
    try {
      const {
        searchTerm,
        filters = {},
        sortBy = 'dates.creationDate',
        sortOrder = 'desc',
        page = 1,
        limit = 20
      } = req.body;

      let query = {};

      // Text search
      if (searchTerm && searchTerm.trim()) {
        query.$or = [
          { title: { $regex: searchTerm, $options: 'i' } },
          { contractNumber: { $regex: searchTerm, $options: 'i' } },
          { 'supplier.supplierName': { $regex: searchTerm, $options: 'i' } },
          { description: { $regex: searchTerm, $options: 'i' } }
        ];
      }

      // Apply filters
      Object.keys(filters).forEach(key => {
        if (filters[key] !== null && filters[key] !== undefined && filters[key] !== '') {
          if (key === 'dateRange' && filters[key].length === 2) {
            query['dates.startDate'] = {
              $gte: new Date(filters[key][0]),
              $lte: new Date(filters[key][1])
            };
          } else if (key === 'valueRange' && filters[key].length === 2) {
            query['financials.totalValue'] = {
              $gte: filters[key][0],
              $lte: filters[key][1]
            };
          } else {
            query[key] = filters[key];
          }
        }
      });

      const sort = {};
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const contracts = await Contract
        .find(query)
        .populate('management.contractManager', 'fullName email')
        .populate('supplier.supplierId', 'fullName email')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

      const total = await Contract.countDocuments(query);

      res.json({
        success: true,
        data: contracts,
        pagination: {
          current: parseInt(page),
          pageSize: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (error) {
      console.error('Error in contract search:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to search contracts'
      });
    }
  }
);

module.exports = router;
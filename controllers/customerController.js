const Customer = require('../models/Customer');
const CustomerOnboardingApplication = require('../models/CustomerOnboardingApplication');
const User = require('../models/User');

// Get all customers
exports.getAllCustomers = async (req, res) => {
  try {
    const { status, customerType, search, page = 1, limit = 10 } = req.query;
    
    const filter = {};
    
    if (status) filter.status = status;
    if (customerType) filter.customerType = customerType;
    if (search) {
      filter.$or = [
        { companyName: { $regex: search, $options: 'i' } },
        { customerId: { $regex: search, $options: 'i' } },
        { primaryEmail: { $regex: search, $options: 'i' } },
        { taxIdNumber: { $regex: search, $options: 'i' } }
      ];
    }
    
    const skip = (page - 1) * limit;
    
    const customers = await Customer.find(filter)
      .populate('onboardedBy', 'fullName email')
      .populate('approvedBy', 'fullName email')
      .populate('createdBy', 'fullName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Customer.countDocuments(filter);
    
    res.json({
      success: true,
      data: customers,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customers',
      error: error.message
    });
  }
};

// Get customer by ID
exports.getCustomerById = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id)
      .populate('onboardedBy', 'fullName email department')
      .populate('approvedBy', 'fullName email department')
      .populate('createdBy', 'fullName email')
      .populate('notes.addedBy', 'fullName email')
      .populate('statusHistory.changedBy', 'fullName email');
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    res.json({
      success: true,
      data: customer
    });
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer',
      error: error.message
    });
  }
};

// Create customer manually
exports.createCustomer = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const customerData = {
      ...req.body,
      createdBy: userId,
      onboardedBy: userId,
      onboardingDate: new Date(),
      status: 'pending'
    };
    
    const customer = new Customer(customerData);
    
    // Initialize approval chain (3-level: Lukong -> Ranibell -> Kelvin)
    customer.approvalChain = [
      {
        level: 1,
        approver: {
          name: 'Lukong Lambert',
          email: 'lukong.lambert@gratoglobal.com',
          role: 'Supply Chain Coordinator'
        },
        status: 'pending'
      },
      {
        level: 2,
        approver: {
          name: 'Ms. Ranibell Mambo',
          email: 'ranibellmambo@gratoengineering.com',
          role: 'Finance Manager'
        },
        status: 'pending'
      },
      {
        level: 3,
        approver: {
          name: 'Mr. E.T Kelvin',
          email: 'kelvin.eyong@gratoglobal.com',
          role: 'Head of Business'
        },
        status: 'pending'
      }
    ];
    customer.currentApprovalLevel = 1;
    
    await customer.save();
    
    const populatedCustomer = await Customer.findById(customer._id)
      .populate('createdBy', 'fullName email')
      .populate('onboardedBy', 'fullName email');
    
    res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      data: populatedCustomer
    });
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create customer',
      error: error.message
    });
  }
};

// Update customer
exports.updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const customer = await Customer.findById(id);
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    // Update fields
    Object.keys(req.body).forEach(key => {
      if (key !== '_id' && key !== 'customerId' && key !== 'createdBy') {
        customer[key] = req.body[key];
      }
    });
    
    customer.lastModifiedBy = userId;
    await customer.save();
    
    const updatedCustomer = await Customer.findById(id)
      .populate('onboardedBy', 'fullName email')
      .populate('approvedBy', 'fullName email')
      .populate('lastModifiedBy', 'fullName email');
    
    res.json({
      success: true,
      message: 'Customer updated successfully',
      data: updatedCustomer
    });
  } catch (error) {
    console.error('Error updating customer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update customer',
      error: error.message
    });
  }
};

// Update customer status
exports.updateCustomerStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    const userId = req.user.id;
    
    const customer = await Customer.findById(id);
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    await customer.updateStatus(status, userId, reason);
    
    const updatedCustomer = await Customer.findById(id)
      .populate('onboardedBy', 'fullName email')
      .populate('approvedBy', 'fullName email');
    
    res.json({
      success: true,
      message: `Customer status updated to ${status}`,
      data: updatedCustomer
    });
  } catch (error) {
    console.error('Error updating customer status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update customer status',
      error: error.message
    });
  }
};

// Approve customer
exports.approveCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { comments } = req.body;
    const userEmail = req.user.email;
    const userId = req.user.id;
    
    const customer = await Customer.findById(id);
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    // Check if user can approve
    if (!customer.canUserApprove(userEmail)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to approve this customer at this level'
      });
    }
    
    // Update current level
    const currentStep = customer.approvalChain.find(
      step => step.level === customer.currentApprovalLevel
    );
    
    if (currentStep) {
      currentStep.status = 'approved';
      currentStep.comments = comments;
      currentStep.actionDate = new Date();
    }
    
    // Move to next level or mark as approved
    if (customer.currentApprovalLevel < customer.approvalChain.length) {
      customer.currentApprovalLevel += 1;
    } else {
      customer.status = 'approved';
      customer.approvedBy = userId;
      customer.approvalDate = new Date();
    }
    
    await customer.save();
    
    const updatedCustomer = await Customer.findById(id)
      .populate('onboardedBy', 'fullName email')
      .populate('approvedBy', 'fullName email');
    
    res.json({
      success: true,
      message: customer.status === 'approved' 
        ? 'Customer fully approved' 
        : 'Customer approved at this level',
      data: updatedCustomer
    });
  } catch (error) {
    console.error('Error approving customer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve customer',
      error: error.message
    });
  }
};

// Reject customer
exports.rejectCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const userEmail = req.user.email;
    const userId = req.user.id;
    
    const customer = await Customer.findById(id);
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    // Check if user can reject
    if (!customer.canUserApprove(userEmail)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to reject this customer'
      });
    }
    
    customer.status = 'rejected';
    customer.rejectionReason = reason;
    customer.rejectedBy = userId;
    customer.rejectionDate = new Date();
    
    const currentStep = customer.approvalChain.find(
      step => step.level === customer.currentApprovalLevel
    );
    
    if (currentStep) {
      currentStep.status = 'rejected';
      currentStep.comments = reason;
      currentStep.actionDate = new Date();
    }
    
    await customer.save();
    
    const updatedCustomer = await Customer.findById(id)
      .populate('rejectedBy', 'fullName email');
    
    res.json({
      success: true,
      message: 'Customer rejected',
      data: updatedCustomer
    });
  } catch (error) {
    console.error('Error rejecting customer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject customer',
      error: error.message
    });
  }
};

// Add note to customer
exports.addCustomerNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { note, type } = req.body;
    const userId = req.user.id;
    
    const customer = await Customer.findById(id);
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    await customer.addNote(userId, note, type);
    
    const updatedCustomer = await Customer.findById(id)
      .populate('notes.addedBy', 'fullName email');
    
    res.json({
      success: true,
      message: 'Note added successfully',
      data: updatedCustomer
    });
  } catch (error) {
    console.error('Error adding note:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add note',
      error: error.message
    });
  }
};

// Get dashboard stats
exports.getCustomerDashboardStats = async (req, res) => {
  try {
    const total = await Customer.countDocuments();
    const active = await Customer.countDocuments({ status: 'active' });
    const pending = await Customer.countDocuments({ status: 'pending' });
    const suspended = await Customer.countDocuments({ status: 'suspended' });
    
    // Get customers by type
    const enterprise = await Customer.countDocuments({ customerType: 'Enterprise' });
    const sme = await Customer.countDocuments({ customerType: 'SME' });
    const government = await Customer.countDocuments({ customerType: 'Government' });
    
    // Get pending approvals for current user
    const userEmail = req.user.email;
    const pendingApprovals = await Customer.countDocuments({
      'approvalChain.approver.email': userEmail,
      'approvalChain.status': 'pending',
      status: 'pending'
    });
    
    res.json({
      success: true,
      data: {
        total,
        active,
        pending,
        suspended,
        byType: {
          enterprise,
          sme,
          government
        },
        pendingApprovals
      }
    });
  } catch (error) {
    console.error('Error fetching customer stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer statistics',
      error: error.message
    });
  }
};

// Get pending approvals for current user
exports.getPendingApprovals = async (req, res) => {
  try {
    const userEmail = req.user.email;
    
    const customers = await Customer.find({
      'approvalChain.approver.email': userEmail,
      'approvalChain.status': 'pending',
      status: 'pending'
    })
    .populate('onboardedBy', 'fullName email')
    .populate('createdBy', 'fullName email')
    .sort({ createdAt: -1 });
    
    const filtered = customers.filter(customer => {
      const currentStep = customer.approvalChain.find(
        step => step.level === customer.currentApprovalLevel
      );
      return currentStep && currentStep.approver.email === userEmail;
    });
    
    res.json({
      success: true,
      data: filtered
    });
  } catch (error) {
    console.error('Error fetching pending approvals:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending approvals',
      error: error.message
    });
  }
};

// ==========================================
// ONBOARDING APPLICATION CONTROLLERS
// ==========================================

// Create onboarding application
exports.createOnboardingApplication = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const application = new CustomerOnboardingApplication({
      ...req.body,
      submittedBy: userId
    });
    
    await application.save();
    
    const populatedApp = await CustomerOnboardingApplication.findById(application._id)
      .populate('submittedBy', 'fullName email');
    
    res.status(201).json({
      success: true,
      message: 'Customer onboarding application submitted successfully',
      data: populatedApp
    });
  } catch (error) {
    console.error('Error creating onboarding application:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create onboarding application',
      error: error.message
    });
  }
};

// Get all onboarding applications
exports.getOnboardingApplications = async (req, res) => {
  try {
    const { status } = req.query;
    
    const filter = {};
    if (status) filter.status = status;
    
    const applications = await CustomerOnboardingApplication.find(filter)
      .populate('submittedBy', 'fullName email')
      .populate('reviewHistory.reviewer', 'fullName email')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: applications
    });
  } catch (error) {
    console.error('Error fetching onboarding applications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch onboarding applications',
      error: error.message
    });
  }
};

// Approve onboarding application and create customer
exports.approveOnboardingApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const { comments } = req.body;
    const userId = req.user.id;
    
    const application = await CustomerOnboardingApplication.findById(id);
    
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }
    
    if (application.status !== 'pending_review') {
      return res.status(400).json({
        success: false,
        message: 'Application has already been processed'
      });
    }
    
    // Create customer from application
    const customer = new Customer({
      companyName: application.companyName,
      tradingName: application.tradingName,
      contactPersons: application.contactPersons,
      primaryEmail: application.primaryEmail,
      primaryPhone: application.primaryPhone,
      alternatePhone: application.alternatePhone,
      website: application.website,
      address: application.address,
      billingAddress: application.billingAddress,
      businessType: application.businessType,
      industry: application.industry,
      businessRegistrationNumber: application.businessRegistrationNumber,
      taxIdNumber: application.taxIdNumber,
      establishedYear: application.establishedYear,
      employeeCount: application.employeeCount,
      customerType: application.customerType,
      creditLimit: application.requestedCreditLimit,
      creditTerms: application.requestedCreditTerms,
      currency: application.currency,
      bankDetails: application.bankDetails,
      documents: application.documents,
      onboardingApplicationId: application._id,
      onboardedBy: userId,
      onboardingDate: new Date(),
      createdBy: userId,
      status: 'approved'
    });
    
    await customer.save();
    
    // Update application
    application.status = 'approved';
    application.customerId = customer._id;
    application.reviewHistory.push({
      reviewer: userId,
      status: 'approved',
      comments: comments
    });
    
    await application.save();
    
    res.json({
      success: true,
      message: 'Application approved and customer created successfully',
      data: {
        application,
        customer
      }
    });
  } catch (error) {
    console.error('Error approving onboarding application:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve application',
      error: error.message
    });
  }
};

// Finance - Upload PO for Customer
exports.uploadPurchaseOrder = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { poNumber, description, amount, currency, poDate, dueDate, paymentTerms, notes } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!poNumber || !amount || !poDate) {
      return res.status(400).json({
        success: false,
        message: 'PO Number, Amount, and PO Date are required'
      });
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Handle file upload if provided
    const poData = {
      poNumber,
      description: description || '',
      amount: parseFloat(amount),
      currency: currency || 'XAF',
      poDate: poDate ? new Date(poDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : null,
      paymentTerms: paymentTerms || '',
      notes: notes || ''
    };

    // If file is uploaded, add document info
    if (req.file) {
      poData.document = {
        name: req.file.originalname,
        url: req.file.path,
        publicId: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
        uploadedAt: new Date()
      };
    }

    await customer.addPurchaseOrder(poData, userId);

    const updatedCustomer = await Customer.findById(customerId)
      .populate('purchaseOrders.uploadedBy', 'fullName email');

    res.status(201).json({
      success: true,
      message: 'Purchase Order uploaded successfully',
      data: updatedCustomer
    });
  } catch (error) {
    console.error('Error uploading purchase order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload purchase order',
      error: error.message
    });
  }
};

// Get Customer's Purchase Orders
exports.getCustomerPurchaseOrders = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { status, page = 1, limit = 10 } = req.query;

    const customer = await Customer.findById(customerId)
      .populate('purchaseOrders.uploadedBy', 'fullName email');

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    let pos = customer.purchaseOrders || [];

    // Filter by status if provided
    if (status) {
      pos = pos.filter(po => po.status === status);
    }

    // Pagination
    const skip = (page - 1) * limit;
    const paginatedPOs = pos.slice(skip, skip + parseInt(limit));

    res.json({
      success: true,
      data: paginatedPOs,
      pagination: {
        total: pos.length,
        page: parseInt(page),
        pages: Math.ceil(pos.length / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching purchase orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch purchase orders',
      error: error.message
    });
  }
};

// Update Purchase Order (Full Edit)
exports.updatePurchaseOrder = async (req, res) => {
  try {
    const { customerId, poId } = req.params;
    const { poNumber, description, amount, currency, poDate, dueDate, paymentTerms, notes } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!poNumber || !amount || !poDate) {
      return res.status(400).json({
        success: false,
        message: 'PO Number, Amount, and PO Date are required'
      });
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const po = customer.purchaseOrders.id(poId);
    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase Order not found'
      });
    }

    // Check if PO number is unique (excluding current PO)
    const duplicatePO = customer.purchaseOrders.find(
      p => p.poNumber === poNumber && p._id.toString() !== poId
    );
    if (duplicatePO) {
      return res.status(400).json({
        success: false,
        message: 'PO Number already exists for this customer'
      });
    }

    // Update PO fields
    po.poNumber = poNumber;
    po.description = description || '';
    po.amount = parseFloat(amount);
    po.currency = currency || 'XAF';
    po.poDate = poDate ? new Date(poDate) : po.poDate;
    po.dueDate = dueDate ? new Date(dueDate) : null;
    po.notes = notes || '';

    // Handle payment terms - can be string or array (JSON string)
    if (paymentTerms) {
      try {
        // Try to parse as JSON array
        const parsed = JSON.parse(paymentTerms);
        if (Array.isArray(parsed)) {
          po.paymentTerms = parsed;
        } else {
          po.paymentTerms = paymentTerms;
        }
      } catch {
        // Not JSON, treat as string
        po.paymentTerms = paymentTerms;
      }
    }

    // Handle file upload if provided
    if (req.file) {
      po.document = {
        name: req.file.originalname,
        url: req.file.path,
        publicId: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
        uploadedAt: new Date()
      };
    }

    po.updatedBy = userId;
    po.updatedAt = new Date();

    await customer.save();

    const updatedCustomer = await Customer.findById(customerId)
      .populate('purchaseOrders.uploadedBy', 'fullName email')
      .populate('purchaseOrders.updatedBy', 'fullName email');

    const updatedPO = updatedCustomer.purchaseOrders.id(poId);

    res.json({
      success: true,
      message: 'Purchase Order updated successfully',
      data: updatedPO
    });
  } catch (error) {
    console.error('Error updating purchase order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update purchase order',
      error: error.message
    });
  }
};

// Update PO Status (Finance)
exports.updatePurchaseOrderStatus = async (req, res) => {
  try {
    const { customerId, poId } = req.params;
    const { status, notes } = req.body;

    if (!['pending', 'approved', 'rejected', 'paid'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid PO status'
      });
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const po = customer.purchaseOrders.id(poId);
    if (!po) {
      return res.status(404).json({
        success: false,
        message: 'Purchase Order not found'
      });
    }

    po.status = status;
    if (notes) {
      po.notes = notes;
    }

    await customer.save();

    res.json({
      success: true,
      message: `Purchase Order status updated to ${status}`,
      data: customer
    });
  } catch (error) {
    console.error('Error updating purchase order status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update purchase order status',
      error: error.message
    });
  }
};

// Delete PO
exports.deletePurchaseOrder = async (req, res) => {
  try {
    const { customerId, poId } = req.params;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    customer.purchaseOrders.id(poId).remove();
    await customer.save();

    res.json({
      success: true,
      message: 'Purchase Order deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting purchase order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete purchase order',
      error: error.message
    });
  }
};

module.exports = exports;

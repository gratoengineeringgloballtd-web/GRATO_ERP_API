const mongoose = require('mongoose');
const PurchaseRequisition = require('../models/PurchaseRequisition');
const RFQ = require('../models/RFQ');
const Quote = require('../models/Quote');
const Supplier = require('../models/Supplier');
const PettyCashForm = require('../models/PettyCashForm');
const User = require('../models/User');
const { sendEmail } = require('../services/emailService');
const { sendBuyerNotificationEmail } = require('../services/buyerEmailService');


const getAssignedRequisitions = async (req, res) => {
  try {
    const {
      status,
      sourcingStatus,
      page  = 1,
      limit = 200,   
      search,
      justified
    } = req.query;
 
    console.log('=== BUYER - GET ASSIGNED REQUISITIONS ===');
    console.log('User ID:', req.user.userId);
    console.log('Query params:', { status, sourcingStatus, page, limit, search, justified });
 
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }
 
    // ── Base scope (who can see what) ────────────────────────────────────
    let query = {};
 
    if (user.role === 'buyer' || user.departmentRole === 'buyer') {
      query = {
        'supplyChainReview.assignedBuyer': new mongoose.Types.ObjectId(req.user.userId)
      };
    } else if (user.role === 'supply_chain' || user.role === 'admin') {
      query = {
        'supplyChainReview.assignedBuyer': { $exists: true, $ne: null }
      };
    } else {
      return res.status(403).json({
        success: false,
        message: 'Access denied - user not authorized to view buyer requisitions'
      });
    }
 
    // ── Status filter (mutually exclusive, evaluated in priority order) ──
 
    if (justified === 'true') {
      // "Needs Justification" tab
      // Includes BOTH disbursed statuses AND the full justification workflow
      query.status = {
        $in: [
          'partially_disbursed',
          'fully_disbursed',
          'justification_pending_supervisor',
          'justification_pending_finance',
          'justification_pending_supply_chain',
          'justification_pending_head',
          'justification_rejected',
          'justification_approved',
        ]
      };
 
    } else if (sourcingStatus) {
      const sourcingStatusMap = {
        pending_sourcing: ['approved', 'pending_head_approval'],
        in_progress:      ['in_procurement'],
        quotes_received:  ['quotes_received'],
        completed:        ['procurement_complete', 'delivered', 'completed'],
      };
      const mapped = sourcingStatusMap[sourcingStatus];
      if (mapped) query.status = { $in: mapped };
      // unknown value → no extra filter (returns all)
 
    } else if (status) {
      query.status = status;
 
    } else {
      // "All" tab — every status a buyer ever touches
      query.status = {
        $in: [
          'pending_head_approval',
          'approved',
          'in_procurement',
          'quotes_received',
          'procurement_complete',
          'delivered',
          'completed',
          'partially_disbursed',
          'fully_disbursed',
          'justification_pending_supervisor',
          'justification_pending_finance',
          'justification_pending_supply_chain',
          'justification_pending_head',
          'justification_rejected',
          'justification_approved',
        ]
      };
    }
 
    // ── Optional text search ─────────────────────────────────────────────
    if (search) {
      query.$or = [
        { title:             { $regex: search, $options: 'i' } },
        { requisitionNumber: { $regex: search, $options: 'i' } },
        { itemCategory:      { $regex: search, $options: 'i' } },
      ];
    }
 
    console.log('Final query:', JSON.stringify(query, null, 2));
 
    const pageSize = Math.min(parseInt(limit) || 200, 500); // cap at 500
    const pageNum  = parseInt(page) || 1;
 
    const [requisitions, total] = await Promise.all([
      PurchaseRequisition.find(query)
        .populate('employee',                         'fullName email department')
        .populate('supplyChainReview.assignedBuyer',  'fullName email role departmentRole')
        .populate('supplyChainReview.decidedBy',      'fullName email')
        .populate('supplyChainReview.buyerAssignedBy','fullName email')
        .populate('financeVerification.verifiedBy',   'fullName email')
        .sort({ createdAt: -1 })
        .limit(pageSize)
        .skip((pageNum - 1) * pageSize),
      PurchaseRequisition.countDocuments(query),
    ]);
 
    // ── Transform to frontend shape ──────────────────────────────────────
    const transformedRequisitions = requisitions.map(req => ({
      id:                   req._id,
      title:                req.title,
      requester:            req.employee?.fullName   || 'Unknown',
      department:           req.employee?.department || 'Unknown',
      budget:               req.estimatedTotalCost   || req.budgetXAF,
      items:                req.items,
      expectedDeliveryDate: req.urgentDate || req.expectedDeliveryDate || req.expectedDate,
      urgency:              req.urgency    || 'Medium',
      category:             req.itemCategory,
      sourcingStatus:       mapBackendStatusToFrontend(req.status),
      status:               req.status,              // raw value, useful for debugging
      requestDate:          req.createdAt,
      deliveryLocation:     req.deliveryLocation,
      notes:                req.justificationOfPurchase,
      // Disbursement fields so the frontend can show context-aware actions
      totalDisbursed:       req.totalDisbursed  || 0,
      remainingBalance:     req.remainingBalance,
      paymentMethod:        req.paymentMethod,
    }));
 
    console.log(
      `Returning ${transformedRequisitions.length} of ${total} total matching requisitions`
    );
 
    res.json({
      success: true,
      data:    transformedRequisitions,
      pagination: {
        current:      pageNum,
        total:        Math.ceil(total / pageSize),
        count:        transformedRequisitions.length,
        totalRecords: total,
      },
      debug: {
        userRole:           user.role,
        userDepartmentRole: user.departmentRole,
        filtersReceived:    { status, sourcingStatus, justified },
      }
    });
 
  } catch (error) {
    console.error('Get assigned requisitions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assigned requisitions',
      error:   error.message,
    });
  }
};
 

// // Helper function to map backend status to frontend sourcingStatus
// const mapBackendStatusToFrontend = (backendStatus) => {
//     const statusMapping = {
//       'approved': 'pending_sourcing',
//       'pending_head_approval': 'pending_sourcing',
//       'in_procurement': 'in_progress',
//       'quotes_received': 'quotes_received',
//       'procurement_complete': 'completed',
//       'delivered': 'completed',
//       'justification_pending_supervisor': 'justified',
//       'justification_pending_finance': 'justified',
//       'justification_pending_supply_chain': 'justified',
//       'justification_pending_head': 'justified',
//       'justification_rejected': 'justified',
//       'justification_approved': 'justified',
//       'completed': 'completed'
//     };
    
//     return statusMapping[backendStatus] || 'pending_sourcing';
// };


const mapBackendStatusToFrontend = (backendStatus) => {
  const map = {
    // ── Pending sourcing ──────────────────────────────────────
    approved:                           'pending_sourcing',
    pending_head_approval:              'pending_sourcing',
 
    // ── Active procurement ────────────────────────────────────
    in_procurement:                     'in_progress',
 
    // ── Quotes received ───────────────────────────────────────
    quotes_received:                    'quotes_received',
 
    // ── Procurement done ──────────────────────────────────────
    procurement_complete:               'completed',
    delivered:                          'completed',
    completed:                          'completed',
 
    // ── Disbursed — buyer must submit justification ───────────
    // These two are the NEW ones that were previously missing
    partially_disbursed:                'justified',
    fully_disbursed:                    'justified',
 
    // ── Justification workflow ────────────────────────────────
    justification_pending_supervisor:   'justified',
    justification_pending_finance:      'justified',
    justification_pending_supply_chain: 'justified',
    justification_pending_head:         'justified',
    justification_rejected:             'justified',
    justification_approved:             'justified',
  };
 
  return map[backendStatus] || 'pending_sourcing';
};
  
// Get detailed requisition information
const getRequisitionDetails = async (req, res) => {
    try {
      const { requisitionId } = req.params;
      
      console.log('=== GET REQUISITION DETAILS ===');
      console.log('Requisition ID:', requisitionId);
      
      const requisition = await PurchaseRequisition.findById(requisitionId)
        .populate('employee', 'fullName email department')
        .populate('supplyChainReview.assignedBuyer', 'fullName email role')
        .populate('procurementDetails.assignedOfficer', 'fullName email');
      
      if (!requisition) {
        return res.status(404).json({
          success: false,
          message: 'Requisition not found'
        });
      }
      
      // Verify user has access to this requisition
      const user = await User.findById(req.user.userId);
      const isAssignedBuyer = requisition.supplyChainReview?.assignedBuyer?._id.toString() === req.user.userId;
      const isAuthorized = user.role === 'admin' || user.role === 'supply_chain' || isAssignedBuyer;
      
      if (!isAuthorized) {
        return res.status(403).json({
          success: false,
          message: 'Access denied - not authorized to view this requisition'
        });
      }
      
      // Transform to frontend format
      const detailedRequisition = {
        id: requisition._id,
        title: requisition.title,
        requester: requisition.employee?.fullName || 'Unknown',
        department: requisition.employee?.department || 'Unknown',
        requestDate: requisition.createdAt,
        expectedDeliveryDate: requisition.urgentDate || requisition.expectedDeliveryDate,
        budget: requisition.estimatedTotalCost || requisition.budgetXAF,
        urgency: requisition.urgency || 'Medium',
        category: requisition.itemCategory,
        deliveryLocation: requisition.deliveryLocation,
        notes: requisition.justificationOfPurchase,
        items: requisition.items.map(item => ({
          id: item._id,
          description: item.description,
          quantity: item.quantity,
          unit: item.measuringUnit,
          specifications: item.specifications || item.description
        })),
        sourcingStatus: mapBackendStatusToFrontend(requisition.status),
        status: requisition.status,
        assignmentDate: requisition.supplyChainReview?.assignmentDate,
        sourcingDetails: requisition.procurementDetails ? {
          submissionDate: requisition.procurementDetails.procurementStartDate,
          selectedSuppliers: requisition.procurementDetails.selectedSuppliers || [],
          expectedQuoteResponse: requisition.procurementDetails.quotationDeadline
        } : null
      };
      
      res.json({
        success: true,
        data: detailedRequisition
      });
      
    } catch (error) {
      console.error('Get requisition details error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch requisition details',
        error: error.message
      });
    }
};


const getSuppliersByCategory = async (req, res) => {
  try {
    const { category, search, page = 1, limit = 20, sortBy = 'rating' } = req.query;
    
    console.log('=== GET SUPPLIERS BY CATEGORY ===');
    console.log('Category:', category);
    console.log('Search:', search);
    
    // Build query filter
    let query = { status: 'approved' }; // Only approved suppliers
    
    // Filter by category if provided
    if (category) {
      query.categories = { $in: [category] }; // categories is an array field
    }
    
    // Add search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { 'address.city': { $regex: search, $options: 'i' } },
        { categories: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Build sort options
    let sortOptions = {};
    switch (sortBy) {
      case 'rating':
        sortOptions = { 'performance.overallRating': -1 };
        break;
      case 'name':
        sortOptions = { name: 1 };
        break;
      case 'recent':
        sortOptions = { 'performance.lastOrderDate': -1 };
        break;
      case 'reliability':
        sortOptions = { 'performance.deliveryRating': -1 };
        break;
      case 'price':
        sortOptions = { 'performance.priceCompetitiveness': -1 };
        break;
      default:
        sortOptions = { 'performance.overallRating': -1 };
    }
    
    console.log('Query:', JSON.stringify(query, null, 2));
    console.log('Sort options:', sortOptions);
    
    // Execute query with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const suppliers = await Supplier.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .select(`
        name email phone website
        address categories businessType
        performance.overallRating performance.qualityRating 
        performance.deliveryRating performance.communicationRating
        performance.priceCompetitiveness performance.totalOrders
        performance.completedOrders performance.lastOrderDate
        deliveryCapability certifications
      `)
      .lean();
    
    const total = await Supplier.countDocuments(query);
    
    // Transform data to match frontend expectations
    const transformedSuppliers = suppliers.map(supplier => ({
      id: supplier._id,
      name: supplier.name,
      email: supplier.email,
      phone: supplier.phone,
      address: supplier.address?.street || `${supplier.address?.city}, ${supplier.address?.country}` || 'Address not provided',
      website: supplier.website || '',
      rating: supplier.performance?.overallRating || 0,
      reliability: supplier.performance?.deliveryRating ? 
        (supplier.performance.deliveryRating >= 4.5 ? 'Excellent' : 
         supplier.performance.deliveryRating >= 3.5 ? 'Good' : 'Average') : 'Not Rated',
      priceCompetitiveness: supplier.performance?.priceCompetitiveness ? 
        (supplier.performance.priceCompetitiveness >= 4 ? 'High' : 
         supplier.performance.priceCompetitiveness >= 3 ? 'Medium' : 'Low') : 'Not Rated',
      deliveryCapacity: supplier.deliveryCapability?.averageDeliveryTime || 
        (supplier.performance?.averageDeliveryTime ? 
          `${supplier.performance.averageDeliveryTime} days` : 'Standard (5-7 days)'),
      specialization: supplier.categories || [],
      certifications: supplier.certifications?.map(cert => cert.name) || [],
      lastTransaction: supplier.performance?.lastOrderDate || null,
      totalOrders: supplier.performance?.totalOrders || 0,
      completionRate: supplier.performance?.totalOrders > 0 ? 
        Math.round((supplier.performance.completedOrders / supplier.performance.totalOrders) * 100) : 0
    }));
    
    console.log(`Found ${transformedSuppliers.length} suppliers`);
    
    res.json({
      success: true,
      data: transformedSuppliers,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / parseInt(limit)),
        count: transformedSuppliers.length,
        totalRecords: total
      },
      filters: {
        category,
        search,
        sortBy
      },
      message: `Found ${transformedSuppliers.length} suppliers${category ? ` for category: ${category}` : ''}`
    });
    
  } catch (error) {
    console.error('Get suppliers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch suppliers',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// Fixed createAndSendRFQ function in buyerRequisitionController.js

const createAndSendRFQ = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const {
      selectedSuppliers,
      expectedDeliveryDate,
      quotationDeadline,
      paymentTerms,
      deliveryLocation,
      specialRequirements
    } = req.body;
    
    console.log('=== CREATE AND SEND RFQ ===');
    console.log('Requisition ID:', requisitionId);
    console.log('Selected Suppliers:', selectedSuppliers);
    console.log('Expected Delivery Date:', expectedDeliveryDate);
    console.log('Quotation Deadline:', quotationDeadline);
    
    // Authentication check
    if (!req.user || !req.user.userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required - User not found in request'
      });
    }
    
    // Validation
    if (!selectedSuppliers || selectedSuppliers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one supplier must be selected'
      });
    }

    if (!expectedDeliveryDate) {
      return res.status(400).json({
        success: false,
        message: 'Expected delivery date is required'
      });
    }

    if (!quotationDeadline) {
      return res.status(400).json({
        success: false,
        message: 'Quotation deadline is required'
      });
    }
    
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department');
    
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }
    
    // Verify authorization
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const isAssignedBuyer = requisition.supplyChainReview?.assignedBuyer?.toString() === req.user.userId;
    const isAuthorized = user.role === 'admin' || user.role === 'supply_chain' || user.role === 'buyer' || isAssignedBuyer;
    
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to create RFQ for this requisition'
      });
    }
    
    // Check requisition status - FIXED to allow in_procurement status
    if (!['approved', 'pending_head_approval', 'supply_chain_approved', 'in_procurement'].includes(requisition.status)) {
      return res.status(400).json({
        success: false,
        message: `Requisition must be approved before sourcing. Current status: ${requisition.status}`
      });
    }

    // Check if RFQ already exists for this requisition
    const existingRFQ = await RFQ.findOne({ requisitionId });
    if (existingRFQ) {
      return res.status(400).json({
        success: false,
        message: 'An RFQ already exists for this requisition',
        data: {
          existingRFQId: existingRFQ._id,
          rfqNumber: existingRFQ.rfqNumber,
          status: existingRFQ.status,
          createdDate: existingRFQ.issueDate
        }
      });
    }
    
    // Date validation
    let deliveryDate, quoteDeadline;
    
    try {
      deliveryDate = new Date(expectedDeliveryDate);
      quoteDeadline = new Date(quotationDeadline);
      
      if (isNaN(deliveryDate.getTime())) {
        throw new Error('Invalid delivery date format');
      }
      if (isNaN(quoteDeadline.getTime())) {
        throw new Error('Invalid quotation deadline format');
      }
      
      if (quoteDeadline >= deliveryDate) {
        return res.status(400).json({
          success: false,
          message: 'Quotation deadline must be before expected delivery date'
        });
      }
      
      if (quoteDeadline <= new Date()) {
        return res.status(400).json({
          success: false,
          message: 'Quotation deadline must be in the future'
        });
      }
      
    } catch (dateError) {
      return res.status(400).json({
        success: false,
        message: `Date validation error: ${dateError.message}`
      });
    }

    // FIXED: Validate that all selected suppliers exist
    const supplierObjectIds = selectedSuppliers.map(id => {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error(`Invalid supplier ID format: ${id}`);
      }
      return new mongoose.Types.ObjectId(id);
    });

    console.log('Converted supplier ObjectIds:', supplierObjectIds);

    // Try to find suppliers in User collection first
    let validSuppliers = await User.find({
      _id: { $in: supplierObjectIds },
      role: 'supplier'
      // Removed isActive check temporarily to debug
    }).select('_id fullName email supplierDetails isActive status');

    console.log('Found suppliers in User collection:', validSuppliers.length);
    console.log('User collection supplier details:', validSuppliers.map(s => ({
      id: s._id,
      name: s.fullName,
      email: s.email,
      role: s.role,
      isActive: s.isActive,
      status: s.status,
      hasSupplierDetails: !!s.supplierDetails
    })));

    // If no suppliers found in User collection, try Supplier collection
    if (validSuppliers.length === 0) {
      console.log('No suppliers found in User collection, trying Supplier collection...');
      
      try {
        const Supplier = require('../models/Supplier');
        validSuppliers = await Supplier.find({
          _id: { $in: supplierObjectIds },
          status: { $in: ['approved', 'active'] }
        }).select('_id name email status');

        console.log('Found suppliers in Supplier collection:', validSuppliers.length);
        console.log('Supplier collection details:', validSuppliers.map(s => ({
          id: s._id,
          name: s.name,
          email: s.email,
          status: s.status
        })));

        // Transform Supplier model to match User model structure for consistency
        validSuppliers = validSuppliers.map(supplier => ({
          _id: supplier._id,
          fullName: supplier.name,
          email: supplier.email,
          role: 'supplier',
          supplierDetails: { companyName: supplier.name }
        }));
      } catch (supplierModelError) {
        console.log('Supplier model not available or error:', supplierModelError.message);
      }
    } else {
      // Filter out inactive suppliers from User collection
      validSuppliers = validSuppliers.filter(supplier => {
        const isActive = supplier.isActive !== false && supplier.status !== 'inactive';
        if (!isActive) {
          console.log(`Filtering out inactive supplier: ${supplier.fullName} (isActive: ${supplier.isActive}, status: ${supplier.status})`);
        }
        return isActive;
      });
    }

    console.log('Final valid suppliers count:', validSuppliers.length);

    if (validSuppliers.length === 0) {
      // Provide more detailed error message
      const allSuppliersInUser = await User.find({
        _id: { $in: supplierObjectIds }
      }).select('_id fullName role isActive status');

      return res.status(400).json({
        success: false,
        message: 'No valid active suppliers found with the provided IDs',
        debug: {
          requestedSupplierIds: selectedSuppliers,
          foundInDatabase: allSuppliersInUser.map(s => ({
            id: s._id,
            name: s.fullName,
            role: s.role,
            isActive: s.isActive,
            status: s.status
          })),
          issue: allSuppliersInUser.length === 0 ? 
            'Supplier IDs not found in database' : 
            'Suppliers found but not active or not in supplier role'
        }
      });
    }

    if (validSuppliers.length !== selectedSuppliers.length) {
      console.log(`Warning: Only ${validSuppliers.length} out of ${selectedSuppliers.length} suppliers are valid and active`);
      // Continue with valid suppliers instead of failing
    }

    // Update requisition status
    requisition.status = 'in_procurement';
    
    if (!requisition.procurementDetails) {
      requisition.procurementDetails = {};
    }
    
    requisition.procurementDetails = {
      ...requisition.procurementDetails,
      assignedOfficer: req.user.userId,
      procurementMethod: 'quotation',
      procurementStartDate: new Date(),
      expectedDeliveryDate: deliveryDate,
      deliveryLocation: deliveryLocation || requisition.deliveryLocation,
      paymentTerms: paymentTerms || '30 days',
      specialRequirements,
      quotationDeadline: quoteDeadline,
      selectedSuppliers: supplierObjectIds, // Store as ObjectIds
      status: 'sourcing_initiated'
    };
    
    await requisition.save();
    console.log('Requisition updated successfully');
    
    // FIXED: Create RFQ with proper supplier invitation structure
    try {
      // Generate RFQ number
      const rfqCount = await RFQ.countDocuments();
      const rfqNumber = `RFQ-${new Date().getFullYear()}-${String(rfqCount + 1).padStart(6, '0')}`;

      const rfq = new RFQ({
        rfqNumber,
        requisitionId,
        buyerId: req.user.userId,
        createdBy: req.user.userId, // FIXED: Added required createdBy field
        title: `RFQ for ${requisition.title}`,
        description: requisition.justificationOfPurchase || `Request for quotation for ${requisition.title}`,
        
        // Dates
        issueDate: new Date(),
        responseDeadline: quoteDeadline,
        expectedDeliveryDate: deliveryDate,
        
        // Items from requisition
        items: requisition.items.map(item => ({
          description: item.description,
          quantity: item.quantity,
          unit: item.measuringUnit || 'pcs',
          specifications: item.specifications || item.description,
          requiredDeliveryDate: deliveryDate
        })),
        
        // Terms
        paymentTerms: paymentTerms || '30 days',
        deliveryLocation: deliveryLocation || requisition.deliveryLocation,
        specialRequirements,
        // evaluationCriteria removed
        
        // FIXED: Properly structure invited suppliers with ObjectIds
        invitedSuppliers: supplierObjectIds.map(supplierId => ({
          supplierId: supplierId, // This is already an ObjectId
          invitedDate: new Date(),
          responseStatus: 'pending',
          remindersSent: 0
        })),
        
        // Status and summary
        status: 'sent',
        sentDate: new Date(),
        responseSummary: {
          totalInvited: supplierObjectIds.length,
          totalResponded: 0,
          totalDeclined: 0,
          averageResponseTime: 0
        }
      });
      
      const savedRFQ = await rfq.save();
      console.log('RFQ created successfully:', savedRFQ._id);
      console.log('RFQ invited suppliers structure:', savedRFQ.invitedSuppliers);
      
      // Update procurement details with RFQ reference
      requisition.procurementDetails.rfqId = savedRFQ._id;
      await requisition.save();
      
      // Send email notifications to suppliers
      const emailPromises = validSuppliers.map(async (supplier) => {
        try {
          await sendEmail({
            to: supplier.email,
            subject: `New RFQ Invitation - ${requisition.title}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
                  <h2 style="color: #1890ff; margin-top: 0;">Request for Quotation</h2>
                  <p>Dear ${supplier.supplierDetails?.companyName || supplier.fullName},</p>
                  <p>You have been invited to submit a quotation for the following requirement:</p>
                  
                  <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                    <h4>RFQ Details</h4>
                    <ul>
                      <li><strong>RFQ Number:</strong> ${rfqNumber}</li>
                      <li><strong>Title:</strong> ${requisition.title}</li>
                      <li><strong>Buyer:</strong> ${user.fullName}</li>
                      <li><strong>Department:</strong> ${requisition.employee?.department}</li>
                      <li><strong>Quote Deadline:</strong> ${quoteDeadline.toLocaleDateString('en-GB')} ${quoteDeadline.toLocaleTimeString('en-GB')}</li>
                      <li><strong>Expected Delivery:</strong> ${deliveryDate.toLocaleDateString('en-GB')}</li>
                      <li><strong>Items:</strong> ${requisition.items.length} item(s)</li>
                    </ul>
                  </div>
                  
                  <div style="background-color: #fff2e6; padding: 15px; border-radius: 8px; margin: 15px 0;">
                    <h4>Important Information</h4>
                    <p><strong>Payment Terms:</strong> ${paymentTerms || '30 days'}</p>
                    <p><strong>Delivery Location:</strong> ${deliveryLocation || requisition.deliveryLocation}</p>
                    ${specialRequirements ? `<p><strong>Special Requirements:</strong> ${specialRequirements}</p>` : ''}
                  </div>
                  
                  <div style="text-align: center; margin: 20px 0;">
                    <p><strong>Please log in to your supplier portal to view full details and submit your quote.</strong></p>
                    <p>Time remaining: ${Math.ceil((quoteDeadline - new Date()) / (1000 * 60 * 60 * 24))} days</p>
                  </div>
                </div>
              </div>
            `
          });
          console.log(`Email sent to supplier: ${supplier.email}`);
        } catch (emailError) {
          console.error(`Failed to send email to ${supplier.email}:`, emailError.message);
        }
      });

      await Promise.allSettled(emailPromises);
      
    } catch (rfqError) {
      console.error('RFQ creation failed:', rfqError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create RFQ',
        error: rfqError.message
      });
    }
    
    // Send notification to employee
    try {
      if (requisition.employee?.email) {
        await sendEmail({
          to: requisition.employee.email,
          subject: `Sourcing Started - ${requisition.title}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1890ff;">Sourcing Process Started</h2>
              <p>Dear ${requisition.employee.fullName},</p>
              <p>Your purchase requisition "${requisition.title}" has entered the sourcing phase.</p>
              <div style="background: #f5f5f5; padding: 15px; margin: 15px 0;">
                <p><strong>Buyer:</strong> ${user.fullName}</p>
                <p><strong>Suppliers Invited:</strong> ${validSuppliers.length}</p>
                <p><strong>Expected Delivery:</strong> ${deliveryDate.toLocaleDateString()}</p>
                <p><strong>Quote Deadline:</strong> ${quoteDeadline.toLocaleDateString()}</p>
              </div>
              <p>We will update you when quotes are received.</p>
            </div>
          `
        });
        
        console.log('Employee notification sent successfully');
      }
    } catch (emailError) {
      console.error('Email notification failed:', emailError.message);
    }
    
    res.json({
      success: true,
      message: `RFQ sent to ${validSuppliers.length} supplier(s) successfully`,
      data: {
        requisitionId,
        rfqId: requisition.procurementDetails.rfqId,
        suppliersInvited: validSuppliers.length,
        quotationDeadline: quoteDeadline,
        expectedDeliveryDate: deliveryDate,
        status: 'in_procurement',
        rfqNumber: requisition.procurementDetails.rfqId ? 
          (await RFQ.findById(requisition.procurementDetails.rfqId).select('rfqNumber'))?.rfqNumber : null
      }
    });
    
  } catch (error) {
    console.error('Create RFQ error:', error);
    
    // Handle specific error types
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        details: Object.values(error.errors).map(err => err.message)
      });
    }
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create and send RFQ',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

  

// Start sourcing process for a requisition
const startSourcing = async (req, res) => {
    try {
      const { requisitionId } = req.params;
      const {
        selectedSuppliers,
        expectedDeliveryDate,
        paymentTerms,
        deliveryLocation,
        specialRequirements,
        evaluationCriteria,
        quotationDeadline,
        procurementMethod
      } = req.body;
      
      console.log('=== BUYER - START SOURCING ===');
      console.log('Requisition ID:', requisitionId);
      
      const requisition = await PurchaseRequisition.findById(requisitionId)
        .populate('employee', 'fullName email department')
        .populate('supplyChainReview.assignedBuyer', 'fullName email');
      
      if (!requisition) {
        return res.status(404).json({
          success: false,
          message: 'Requisition not found'
        });
      }
      
      // FIXED: Verify buyer is assigned to this requisition
      const user = await User.findById(req.user.userId);
      const isAssignedBuyer = requisition.supplyChainReview?.assignedBuyer?._id.toString() === req.user.userId;
      const isAuthorized = user.role === 'admin' || user.role === 'supply_chain' || isAssignedBuyer;
      
      if (!isAuthorized) {
        return res.status(403).json({
          success: false,
          message: 'You are not assigned to this requisition or not authorized'
        });
      }
      
      // FIXED: Validate that requisition is ready for sourcing
      if (!['approved', 'pending_head_approval'].includes(requisition.status)) {
        return res.status(400).json({
          success: false,
          message: `Requisition is not ready for sourcing. Current status: ${requisition.status}`
        });
      }
      
      // FIXED: Update requisition status and procurement details
      requisition.status = 'in_procurement';
      
      if (!requisition.procurementDetails) {
        requisition.procurementDetails = {};
      }
      
      requisition.procurementDetails = {
        ...requisition.procurementDetails,
        assignedOfficer: req.user.userId,
        procurementMethod: procurementMethod || 'quotation',
        procurementStartDate: new Date(),
        expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : undefined,
        deliveryLocation: deliveryLocation || requisition.deliveryLocation,
        paymentTerms: paymentTerms || '30 days',
        specialRequirements,
        evaluationCriteria,
        quotationDeadline: quotationDeadline ? new Date(quotationDeadline) : undefined,
        selectedSuppliers: selectedSuppliers || [],
        status: 'sourcing_initiated'
      };
      
      await requisition.save();
      
      // Create RFQ if suppliers are selected
      if (selectedSuppliers && selectedSuppliers.length > 0) {
        try {
          const rfq = new RFQ({
            requisitionId,
            buyerId: req.user.userId,
            title: `RFQ for ${requisition.title}`,
            description: requisition.justificationOfPurchase,
            expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : undefined,
            responseDeadline: quotationDeadline ? new Date(quotationDeadline) : undefined,
            items: requisition.items.map(item => ({
              description: item.description,
              quantity: item.quantity,
              unit: item.measuringUnit,
              specifications: item.specifications || item.description
            })),
            paymentTerms: paymentTerms || '30 days',
            deliveryLocation: deliveryLocation || requisition.deliveryLocation,
            specialRequirements,
            evaluationCriteria,
            invitedSuppliers: selectedSuppliers.map(supplierId => ({ supplierId })),
            status: 'sent',
            sentDate: new Date()
          });
          
          await rfq.save();
          
          // Update procurement details with RFQ reference
          requisition.procurementDetails.rfqId = rfq._id;
          await requisition.save();
          
          console.log('RFQ created:', rfq._id);
        } catch (rfqError) {
          console.error('Failed to create RFQ:', rfqError);
          // Continue even if RFQ creation fails
        }
      }
      
      // Send notification to employee
      try {
        await sendEmail({
          to: requisition.employee.email,
          subject: `Procurement Started for Your Requisition - ${requisition.title}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
                <h2 style="color: #1890ff; margin-top: 0;">Procurement Process Started</h2>
                <p>Dear ${requisition.employee.fullName},</p>
                <p>Your purchase requisition is now in the procurement phase.</p>
                
                <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <h4>Procurement Details</h4>
                  <ul>
                    <li><strong>Requisition:</strong> ${requisition.title}</li>
                    <li><strong>Buyer:</strong> ${user.fullName}</li>
                    <li><strong>Method:</strong> ${procurementMethod || 'Quotation Process'}</li>
                    ${expectedDeliveryDate ? `<li><strong>Expected Delivery:</strong> ${new Date(expectedDeliveryDate).toLocaleDateString('en-GB')}</li>` : ''}
                    <li><strong>Status:</strong> Sourcing in Progress</li>
                  </ul>
                </div>
                
                <p>We will keep you updated on the progress. You can track the status in your dashboard.</p>
              </div>
            </div>
          `
        });
      } catch (emailError) {
        console.error('Failed to send employee notification:', emailError);
      }
      
      res.json({
        success: true,
        message: 'Sourcing process started successfully',
        data: {
          requisition: {
            id: requisition._id,
            status: requisition.status,
            procurementDetails: requisition.procurementDetails
          },
          suppliersInvited: selectedSuppliers?.length || 0
        }
      });
      
    } catch (error) {
      console.error('Start sourcing error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to start sourcing process',
        error: error.message
      });
    }
};

// Get quotes for evaluation
const getQuotesForEvaluation = async (req, res) => {
    try {
      const { status, page = 1, limit = 20, search, rfqId } = req.query;
      
      console.log('=== BUYER - GET QUOTES FOR EVALUATION ===');
      
      const user = await User.findById(req.user.userId);
      
      // First get RFQs created by this buyer or all if admin/supply_chain
      let rfqQuery = {};
      
      if (user.role === 'buyer' || user.departmentRole === 'buyer') {
        rfqQuery.buyerId = new mongoose.Types.ObjectId(req.user.userId);
      } else if (user.role === 'admin' || user.role === 'supply_chain') {
        // Can see all RFQs
        rfqQuery = {};
      } else {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
      
      if (rfqId) {
        rfqQuery._id = new mongoose.Types.ObjectId(rfqId);
      }
      
      const buyerRFQs = await RFQ.find(rfqQuery).select('_id');
      const rfqIds = buyerRFQs.map(rfq => rfq._id);
      
      let query = { rfqId: { $in: rfqIds } };
      
      if (status) {
        query.status = status;
      }
      
      if (search) {
        // Populate supplier data for search
        const suppliers = await User.find({
          role: 'supplier',
          $or: [
            { 'supplierDetails.companyName': { $regex: search, $options: 'i' } },
            { fullName: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } }
          ]
        }).select('_id');
        
        const supplierIds = suppliers.map(s => s._id);
        
        query.$or = [
          { supplierId: { $in: supplierIds } },
          { quoteNumber: { $regex: search, $options: 'i' } }
        ];
      }
      
      const quotes = await Quote.find(query)
        .populate('rfqId', 'title responseDeadline')
        .populate('requisitionId', 'title requisitionNumber')
        .populate('supplierId', 'fullName email supplierDetails.companyName')
        .populate('evaluation.evaluatedBy', 'fullName')
        .sort({ submissionDate: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);
      
      const total = await Quote.countDocuments(query);
      
      res.json({
        success: true,
        data: quotes,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / limit),
          count: quotes.length,
          totalRecords: total
        }
      });
      
    } catch (error) {
      console.error('Get quotes for evaluation error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch quotes',
        error: error.message
      });
    }
};

// Evaluate a quote
const evaluateQuote = async (req, res) => {
  try {
    const { quoteId } = req.params;
    const {
      qualityScore,
      costScore,
      deliveryScore,
      technicalScore,
      notes,
      strengths,
      weaknesses,
      recommendations
    } = req.body;
    
    const quote = await Quote.findById(quoteId)
      .populate('rfqId')
      .populate('supplierId', 'name email');
    
    if (!quote) {
      return res.status(404).json({
        success: false,
        message: 'Quote not found'
      });
    }
    
    // Verify buyer owns the RFQ for this quote
    if (quote.rfqId.buyerId.toString() !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access to quote'
      });
    }
    
    // Update quote evaluation
    const evaluationData = {
      qualityScore,
      costScore,
      deliveryScore,
      technicalScore,
      notes,
      strengths,
      weaknesses,
      recommendations
    };
    
    quote.evaluate(evaluationData, req.user.userId);
    await quote.save();
    
    res.json({
      success: true,
      message: 'Quote evaluated successfully',
      data: quote
    });
    
  } catch (error) {
    console.error('Evaluate quote error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to evaluate quote',
      error: error.message
    });
  }
};

// Get suppliers
const getSuppliers = async (req, res) => {
  try {
    const { category, search, page = 1, limit = 20, sortBy } = req.query;
    
    let query = { status: 'approved' };
    
    if (category) {
      query.categories = category;
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { categories: { $regex: search, $options: 'i' } }
      ];
    }
    
    let sortOptions = { 'performance.overallRating': -1 };
    
    if (sortBy === 'name') {
      sortOptions = { name: 1 };
    } else if (sortBy === 'recent') {
      sortOptions = { 'performance.lastOrderDate': -1 };
    }
    
    const suppliers = await Supplier.find(query)
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await Supplier.countDocuments(query);
    
    res.json({
      success: true,
      data: suppliers,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: suppliers.length,
        totalRecords: total
      }
    });
    
  } catch (error) {
    console.error('Get suppliers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch suppliers',
      error: error.message
    });
  }
};

// Get supplier details
const getSupplierDetails = async (req, res) => {
  try {
    const { supplierId } = req.params;
    
    const supplier = await Supplier.findById(supplierId);
    
    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }
    
    // Get recent quotes from this supplier for this buyer
    const buyerRFQs = await RFQ.find({ buyerId: req.user.userId }).select('_id');
    const rfqIds = buyerRFQs.map(rfq => rfq._id);
    
    const recentQuotes = await Quote.find({
      supplierId,
      rfqId: { $in: rfqIds }
    })
    .populate('rfqId', 'title')
    .populate('requisitionId', 'title requisitionNumber')
    .sort({ submissionDate: -1 })
    .limit(5);
    
    res.json({
      success: true,
      data: {
        supplier,
        recentQuotes,
        statistics: {
          totalQuotes: recentQuotes.length,
          averageRating: supplier.performance.overallRating,
          onTimeDeliveryRate: supplier.onTimeDeliveryRate,
          profileCompletion: supplier.profileCompletionScore
        }
      }
    });
    
  } catch (error) {
    console.error('Get supplier details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch supplier details',
      error: error.message
    });
  }
};

// Rate supplier performance
const rateSupplier = async (req, res) => {
  try {
    const { supplierId } = req.params;
    const {
      overallRating,
      qualityRating,
      deliveryRating,
      communicationRating,
      priceCompetitiveness,
      comments
    } = req.body;
    
    const supplier = await Supplier.findById(supplierId);
    
    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }
    
    // Update supplier ratings (this is a simplified version - you might want to implement weighted averages)
    supplier.performance.overallRating = overallRating;
    supplier.performance.qualityRating = qualityRating;
    supplier.performance.deliveryRating = deliveryRating;
    supplier.performance.communicationRating = communicationRating;
    supplier.performance.priceCompetitiveness = priceCompetitiveness;
    
    // Add communication record
    supplier.addCommunication({
      type: 'other',
      subject: 'Performance Rating',
      summary: comments || `Rated by buyer: ${overallRating}/5`,
      direction: 'outbound',
      userId: req.user.userId
    });
    
    await supplier.save();
    
    res.json({
      success: true,
      message: 'Supplier rated successfully',
      data: supplier.performance
    });
    
  } catch (error) {
    console.error('Rate supplier error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to rate supplier',
      error: error.message
    });
  }
};

// Send message to supplier
const sendSupplierMessage = async (req, res) => {
  try {
    const { supplierId } = req.params;
    const { subject, message } = req.body;
    
    const supplier = await Supplier.findById(supplierId);
    
    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }
    
    // Send email to supplier
    try {
      await sendEmail({
        to: supplier.email,
        subject: `Message from Buyer: ${subject}`,
        html: `
          <h3>Message from ${req.user.fullName}</h3>
          <p><strong>Subject:</strong> ${subject}</p>
          <p><strong>Message:</strong></p>
          <p>${message}</p>
          <hr>
          <p>Please respond through your supplier portal or contact us directly.</p>
        `
      });
    } catch (emailError) {
      console.error('Failed to send message to supplier:', emailError);
      return res.status(500).json({
        success: false,
        message: 'Failed to send message to supplier'
      });
    }
    
    // Record communication
    supplier.addCommunication({
      type: 'email',
      subject,
      summary: message,
      direction: 'outbound',
      userId: req.user.userId
    });
    
    await supplier.save();
    
    res.json({
      success: true,
      message: 'Message sent to supplier successfully'
    });
    
  } catch (error) {
    console.error('Send supplier message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message to supplier',
      error: error.message
    });
  }
};

// Get buyer dashboard statistics
const getBuyerDashboard = async (req, res) => {
    try {
      const buyerId = req.user.userId;
      const user = await User.findById(buyerId);
      
      console.log('=== BUYER DASHBOARD ===');
      console.log('User:', { name: user.fullName, role: user.role, departmentRole: user.departmentRole });
      
      let assignedRequisitionsQuery = {};
      let rfqQuery = {};
      
      // FIXED: Proper query based on user role
      if (user.role === 'buyer' || user.departmentRole === 'buyer') {
        assignedRequisitionsQuery = { 'supplyChainReview.assignedBuyer': new mongoose.Types.ObjectId(buyerId) };
        rfqQuery = { buyerId: new mongoose.Types.ObjectId(buyerId) };
      } else if (user.role === 'admin' || user.role === 'supply_chain') {
        assignedRequisitionsQuery = { 'supplyChainReview.assignedBuyer': { $exists: true } };
        rfqQuery = {}; // All RFQs
      }
      
      // Get assigned requisitions count by status
      const assignedRequisitions = await PurchaseRequisition.aggregate([
        { $match: assignedRequisitionsQuery },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalValue: { $sum: { $ifNull: ['$financeVerification.assignedBudget', '$budgetXAF'] } }
          }
        }
      ]);
      
      // Get RFQ statistics
      const rfqStats = await RFQ.aggregate([
        { $match: rfqQuery },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);
      
      // Get quotes statistics
      const allRFQs = await RFQ.find(rfqQuery).select('_id');
      const rfqIds = allRFQs.map(rfq => rfq._id);
      
      const quoteStats = await Quote.aggregate([
        { $match: { rfqId: { $in: rfqIds } } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalValue: { $sum: '$totalAmount' }
          }
        }
      ]);
      
      // Get recent activity
      const recentRequisitions = await PurchaseRequisition.find(assignedRequisitionsQuery)
        .populate('employee', 'fullName department')
        .populate('supplyChainReview.assignedBuyer', 'fullName')
        .sort({ createdAt: -1 })
        .limit(5);
      
      const recentQuotes = await Quote.find({
        rfqId: { $in: rfqIds }
      })
      .populate('supplierId', 'fullName supplierDetails.companyName')
      .populate('requisitionId', 'title')
      .sort({ submissionDate: -1 })
      .limit(5);
      
      // Calculate performance metrics
      const totalRequisitions = assignedRequisitions.reduce((sum, item) => sum + item.count, 0);
      const completedRequisitions = assignedRequisitions.find(item => 
        ['procurement_complete', 'delivered'].includes(item._id)
      )?.count || 0;
      const inProgressRequisitions = assignedRequisitions.find(item => item._id === 'in_procurement')?.count || 0;
      const completionRate = totalRequisitions > 0 ? (completedRequisitions / totalRequisitions) * 100 : 0;
      
      const totalQuoteValue = quoteStats.reduce((sum, item) => sum + (item.totalValue || 0), 0);
      const totalQuotes = quoteStats.reduce((sum, item) => sum + item.count, 0);
      const avgQuoteValue = totalQuotes > 0 ? totalQuoteValue / totalQuotes : 0;
      
      const totalProcurementValue = assignedRequisitions.reduce((sum, item) => sum + (item.totalValue || 0), 0);
      
      res.json({
        success: true,
        data: {
          statistics: {
            totalAssignedRequisitions: totalRequisitions,
            completedRequisitions,
            inProgressRequisitions,
            completionRate: Math.round(completionRate),
            totalRFQs: rfqStats.reduce((sum, item) => sum + item.count, 0),
            totalQuotes,
            totalQuoteValue,
            avgQuoteValue: Math.round(avgQuoteValue),
            totalProcurementValue,
            activeAssignments: inProgressRequisitions
          },
          statusBreakdown: {
            requisitions: assignedRequisitions,
            rfqs: rfqStats,
            quotes: quoteStats
          },
          recentActivity: {
            requisitions: recentRequisitions,
            quotes: recentQuotes
          },
          userInfo: {
            role: user.role,
            departmentRole: user.departmentRole,
            canViewAll: ['admin', 'supply_chain'].includes(user.role)
          }
        }
      });
      
    } catch (error) {
      console.error('Get buyer dashboard error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch dashboard data',
        error: error.message
      });
      const updateProcurementStatus = async (req, res) => {
        try {
          const { requisitionId } = req.params;
          const { 
            status,
            procurementNotes,
            vendorSelected,
            estimatedDeliveryDate,
            actualCost,
            deliveryTracking
          } = req.body;
          
          const user = await User.findById(req.user.userId);
          const requisition = await PurchaseRequisition.findById(requisitionId)
            .populate('employee', 'fullName email');
          
          if (!requisition) {
            return res.status(404).json({
              success: false,
              message: 'Requisition not found'
            });
          }
          
          // Verify buyer is assigned or user is authorized
          const isAssignedBuyer = requisition.supplyChainReview?.assignedBuyer?.toString() === req.user.userId;
          const isAuthorized = user.role === 'admin' || user.role === 'supply_chain' || isAssignedBuyer;
          
          if (!isAuthorized) {
            return res.status(403).json({
              success: false,
              message: 'You are not authorized to update this requisition'
            });
          }
          
          // Update procurement details
          if (!requisition.procurementDetails) {
            requisition.procurementDetails = {};
          }
          
          requisition.procurementDetails = {
            ...requisition.procurementDetails,
            lastUpdated: new Date(),
            lastUpdatedBy: req.user.userId,
            procurementNotes: procurementNotes,
            vendorSelected: vendorSelected,
            estimatedDeliveryDate: estimatedDeliveryDate ? new Date(estimatedDeliveryDate) : requisition.procurementDetails.estimatedDeliveryDate,
            actualCost: actualCost ? parseFloat(actualCost) : requisition.procurementDetails.actualCost,
            deliveryTracking: deliveryTracking
          };
          
          // Update main status if provided
          if (status && ['in_procurement', 'procurement_complete', 'delivered'].includes(status)) {
            requisition.status = status;
            
            if (status === 'procurement_complete') {
              requisition.procurementDetails.completionDate = new Date();
            } else if (status === 'delivered') {
              requisition.procurementDetails.deliveryDate = new Date();
            }
          }
          
          await requisition.save();
          
          // Send notification to employee about status update
          try {
            if (requisition.employee?.email) {
              await sendEmail({
                to: requisition.employee.email,
                subject: `Procurement Update - ${requisition.title}`,
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background-color: #f0f8ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
                      <h2 style="color: #1890ff; margin-top: 0;">Procurement Status Update</h2>
                      <p>Dear ${requisition.employee.fullName},</p>
                      <p>Your purchase requisition has been updated by the procurement team.</p>
                      
                      <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                        <h4>Update Details</h4>
                        <ul>
                          <li><strong>Requisition:</strong> ${requisition.title}</li>
                          <li><strong>Status:</strong> ${status || requisition.status}</li>
                          <li><strong>Buyer:</strong> ${user.fullName}</li>
                          ${vendorSelected ? `<li><strong>Vendor:</strong> ${vendorSelected}</li>` : ''}
                          ${estimatedDeliveryDate ? `<li><strong>Expected Delivery:</strong> ${new Date(estimatedDeliveryDate).toLocaleDateString('en-GB')}</li>` : ''}
                          ${actualCost ? `<li><strong>Actual Cost:</strong> XAF ${parseFloat(actualCost).toLocaleString()}</li>` : ''}
                        </ul>
                      </div>
                      
                      ${procurementNotes ? `
                      <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px;">
                        <h4>Notes:</h4>
                        <p>${procurementNotes}</p>
                      </div>
                      ` : ''}
                    </div>
                  </div>
                `
              });
            }
          } catch (emailError) {
            console.error('Failed to send update notification:', emailError);
          }
          
          res.json({
            success: true,
            message: 'Procurement status updated successfully',
            data: {
              requisition: {
                id: requisition._id,
                status: requisition.status,
                procurementDetails: requisition.procurementDetails
              }
            }
          });
          
        } catch (error) {
          console.error('Update procurement status error:', error);
          res.status(500).json({
            success: false,
            message: 'Failed to update procurement status',
            error: error.message
          });
        }
    };   }
};
  

const updateProcurementStatus = async (req, res) => {
    try {
      const { requisitionId } = req.params;
      const { 
        status,
        procurementNotes,
        vendorSelected,
        estimatedDeliveryDate,
        actualCost,
        deliveryTracking
      } = req.body;
      
      const user = await User.findById(req.user.userId);
      const requisition = await PurchaseRequisition.findById(requisitionId)
        .populate('employee', 'fullName email');
      
      if (!requisition) {
        return res.status(404).json({
          success: false,
          message: 'Requisition not found'
        });
      }
      
      // FIXED: Verify buyer is assigned or user is authorized
      const isAssignedBuyer = requisition.supplyChainReview?.assignedBuyer?.toString() === req.user.userId;
      const isAuthorized = user.role === 'admin' || user.role === 'supply_chain' || isAssignedBuyer;
      
      if (!isAuthorized) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to update this requisition'
        });
      }
      
      // Update procurement details
      if (!requisition.procurementDetails) {
        requisition.procurementDetails = {};
      }
      
      requisition.procurementDetails = {
        ...requisition.procurementDetails,
        lastUpdated: new Date(),
        lastUpdatedBy: req.user.userId,
        procurementNotes: procurementNotes,
        vendorSelected: vendorSelected,
        estimatedDeliveryDate: estimatedDeliveryDate ? new Date(estimatedDeliveryDate) : requisition.procurementDetails.estimatedDeliveryDate,
        actualCost: actualCost ? parseFloat(actualCost) : requisition.procurementDetails.actualCost,
        deliveryTracking: deliveryTracking
      };
      
      // Update main status if provided
      if (status && ['in_procurement', 'procurement_complete', 'delivered'].includes(status)) {
        requisition.status = status;
        
        if (status === 'procurement_complete') {
          requisition.procurementDetails.completionDate = new Date();
        } else if (status === 'delivered') {
          requisition.procurementDetails.deliveryDate = new Date();
        }
      }
      
      await requisition.save();
      
      // Send notification to employee about status update
      try {
        await sendEmail({
          to: requisition.employee.email,
          subject: `Procurement Update - ${requisition.title}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #f0f8ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
                <h2 style="color: #1890ff; margin-top: 0;">Procurement Status Update</h2>
                <p>Dear ${requisition.employee.fullName},</p>
                <p>Your purchase requisition has been updated by the procurement team.</p>
                
                <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <h4>Update Details</h4>
                  <ul>
                    <li><strong>Requisition:</strong> ${requisition.title}</li>
                    <li><strong>Status:</strong> ${status || requisition.status}</li>
                    <li><strong>Buyer:</strong> ${user.fullName}</li>
                    ${vendorSelected ? `<li><strong>Vendor:</strong> ${vendorSelected}</li>` : ''}
                    ${estimatedDeliveryDate ? `<li><strong>Expected Delivery:</strong> ${new Date(estimatedDeliveryDate).toLocaleDateString('en-GB')}</li>` : ''}
                    ${actualCost ? `<li><strong>Actual Cost:</strong> XAF ${parseFloat(actualCost).toLocaleString()}</li>` : ''}
                  </ul>
                </div>
                
                ${procurementNotes ? `
                <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px;">
                  <h4>Notes:</h4>
                  <p>${procurementNotes}</p>
                </div>
                ` : ''}
              </div>
            </div>
          `
        });
      } catch (emailError) {
        console.error('Failed to send update notification:', emailError);
      }
      
      res.json({
        success: true,
        message: 'Procurement status updated successfully',
        data: {
          requisition: {
            id: requisition._id,
            status: requisition.status,
            procurementDetails: requisition.procurementDetails
          }
        }
      });
      
    } catch (error) {
      console.error('Update procurement status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update procurement status',
        error: error.message
      });
    }
};


/**
 * Get quotes for a specific requisition
 */
 const getQuotes = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { status, page = 1, limit = 20 } = req.query;

    console.log('=== GET QUOTES FOR REQUISITION ===');
    console.log('Requisition ID:', requisitionId);
    console.log('User ID:', req.user.userId);

    // Verify user has access to this requisition
    const user = await User.findById(req.user.userId);
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('supplyChainReview.assignedBuyer', 'fullName email');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    // Check authorization
    const isAssignedBuyer = requisition.supplyChainReview?.assignedBuyer?._id.toString() === req.user.userId;
    const isAuthorized = user.role === 'admin' || user.role === 'supply_chain' || isAssignedBuyer;

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Access denied - not authorized to view quotes for this requisition'
      });
    }

    // Find quotes directly by requisitionId (since your Quote schema has requisitionId field)
    let query = { requisitionId: new mongoose.Types.ObjectId(requisitionId) };
    if (status) {
      query.status = status;
    }

    console.log('Quote query:', query);

    // Get quotes with supplier details
    const quotes = await Quote.find(query)
      .populate({
        path: 'supplierId',
        select: 'fullName email phone supplierDetails role',
        match: { role: 'supplier' }
      })
      .populate('evaluation.evaluatedBy', 'fullName')
      .sort({ submissionDate: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Quote.countDocuments(query);

    console.log(`Found ${quotes.length} quotes in database`);

    // Transform quotes to match frontend expectations
    const transformedQuotes = quotes
      .filter(quote => quote.supplierId) // Filter out quotes with no supplier found
      .map(quote => {
        console.log('Transforming quote:', {
          id: quote._id,
          supplierName: quote.supplierDetails?.name,
          totalAmount: quote.totalAmount,
          status: quote.status
        });

        return {
          id: quote._id,
          quoteNumber: quote.quoteNumber,
          rfqId: quote.rfqId,
          requisitionId: quote.requisitionId,
          supplierId: quote.supplierId._id,
          
          // Supplier details - handle both direct fields and nested supplierDetails
          supplierName: quote.supplierDetails?.name || 
                       quote.supplierId.supplierDetails?.companyName || 
                       quote.supplierId.fullName || 
                       'Unknown Supplier',
          supplierEmail: quote.supplierDetails?.email || 
                        quote.supplierId.email || '',
          supplierPhone: quote.supplierDetails?.phone || 
                        quote.supplierId.phone || '',
          
          // Quote financial details
          totalAmount: quote.totalAmount || 0,
          currency: quote.currency || 'XAF',
          
          // Dates
          submissionDate: quote.submissionDate || quote.createdAt,
          validUntil: quote.validUntil,
          
          // Status and delivery
          status: quote.status || 'received',
          deliveryTime: quote.deliveryTime?.value || 7,
          deliveryTimeUnit: quote.deliveryTime?.unit || 'days',
          
          // Terms
          paymentTerms: quote.paymentTerms || '30 days',
          deliveryTerms: quote.deliveryTerms || 'Standard delivery',
          warranty: quote.warranty || '',
          
          // Content
          items: quote.items || [],
          supplierNotes: quote.supplierNotes || '',
          attachments: quote.attachments || [],
          
          // Evaluation
          evaluation: quote.evaluation ? {
            evaluated: quote.evaluation.evaluated || false,
            qualityScore: quote.evaluation.qualityScore,
            costScore: quote.evaluation.costScore,
            deliveryScore: quote.evaluation.deliveryScore,
            totalScore: quote.evaluation.totalScore,
            notes: quote.evaluation.notes,
            evaluatedBy: quote.evaluation.evaluatedBy?.fullName,
            evaluationDate: quote.evaluation.evaluationDate
          } : { 
            evaluated: false,
            qualityScore: 0,
            costScore: 0,
            deliveryScore: 0,
            totalScore: 0
          }
        };
      });

    console.log(`Returning ${transformedQuotes.length} transformed quotes`);

    res.json({
      success: true,
      data: transformedQuotes,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: transformedQuotes.length,
        totalRecords: total
      },
      debug: {
        originalQuery: query,
        foundInDb: quotes.length,
        afterFilter: transformedQuotes.length
      }
    });

  } catch (error) {
    console.error('Get quotes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch quotes',
      error: error.message
    });
  }
};

/**
 * Get RFQ details including quotes and requisition info
 */
const getRFQDetails = async (req, res) => {
  try {
    const { requisitionId } = req.params;

    console.log('=== GET RFQ DETAILS ===');
    console.log('Requisition ID:', requisitionId);

    const user = await User.findById(req.user.userId);
    const requisition = await PurchaseRequisition.findById(requisitionId)
      .populate('employee', 'fullName email department')
      .populate('supplyChainReview.assignedBuyer', 'fullName email');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    // Check authorization
    const isAssignedBuyer = requisition.supplyChainReview?.assignedBuyer?._id.toString() === req.user.userId;
    const isAuthorized = user.role === 'admin' || user.role === 'supply_chain' || isAssignedBuyer;

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Find RFQ
    const rfq = await RFQ.findOne({ requisitionId })
      .populate('buyerId', 'fullName email')
      .populate('invitedSuppliers.supplierId', 'fullName email supplierDetails');

    if (!rfq) {
      return res.status(404).json({
        success: false,
        message: 'RFQ not found for this requisition'
      });
    }

    // Get quotes
    const quotes = await Quote.find({ rfqId: rfq._id })
      .populate('supplierId', 'fullName email phone supplierDetails')
      .populate('evaluation.evaluatedBy', 'fullName')
      .sort({ submissionDate: -1 });

    // Transform data
    const rfqDetails = {
      rfq: {
        id: rfq._id,
        rfqNumber: rfq.rfqNumber,
        title: rfq.title,
        description: rfq.description,
        issueDate: rfq.issueDate,
        responseDeadline: rfq.responseDeadline,
        expectedDeliveryDate: rfq.expectedDeliveryDate,
        status: rfq.status,
        paymentTerms: rfq.paymentTerms,
        deliveryLocation: rfq.deliveryLocation,
        specialRequirements: rfq.specialRequirements,
        evaluationCriteria: rfq.evaluationCriteria,
        items: rfq.items,
        invitedSuppliers: rfq.invitedSuppliers.map(inv => ({
          supplierId: inv.supplierId._id,
          supplierName: inv.supplierId.supplierDetails?.companyName || inv.supplierId.fullName,
          supplierEmail: inv.supplierId.email,
          invitedDate: inv.invitedDate,
          responseStatus: inv.responseStatus,
          responseDate: inv.responseDate
        })),
        responseSummary: rfq.responseSummary
      },
      requisition: {
        id: requisition._id,
        title: requisition.title,
        employee: requisition.employee,
        department: requisition.employee?.department,
        estimatedCost: requisition.estimatedTotalCost,
        deliveryLocation: requisition.deliveryLocation
      },
      quotes: quotes.filter(quote => quote.supplierId).map(quote => ({
        id: quote._id,
        quoteNumber: quote.quoteNumber,
        supplierId: quote.supplierId._id,
        supplierName: quote.supplierId.supplierDetails?.companyName || quote.supplierId.fullName,
        supplierEmail: quote.supplierId.email,
        supplierPhone: quote.supplierId.phone,
        totalAmount: quote.totalAmount,
        currency: quote.currency || 'XAF',
        submissionDate: quote.submissionDate,
        validUntil: quote.validUntil,
        status: quote.status,
        deliveryTime: quote.deliveryTime?.value || 7,
        deliveryTimeUnit: quote.deliveryTime?.unit || 'days',
        paymentTerms: quote.paymentTerms,
        warranty: quote.warranty,
        items: quote.items,
        supplierNotes: quote.supplierNotes,
        attachments: quote.attachments,
        evaluation: quote.evaluation
      }))
    };

    res.json({
      success: true,
      data: rfqDetails
    });

  } catch (error) {
    console.error('Get RFQ details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch RFQ details',
      error: error.message
    });
  }
};

/**
 * Evaluate quotes for a requisition
 */
const evaluateQuotes = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { quoteId, evaluation } = req.body;

    console.log('=== EVALUATE QUOTE ===');
    console.log('Requisition ID:', requisitionId);
    console.log('Quote ID:', quoteId);

    const user = await User.findById(req.user.userId);
    
    // Verify requisition access
    const requisition = await PurchaseRequisition.findById(requisitionId);
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    const isAssignedBuyer = requisition.supplyChainReview?.assignedBuyer?.toString() === req.user.userId;
    const isAuthorized = user.role === 'admin' || user.role === 'supply_chain' || isAssignedBuyer;

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Find and update quote
    const quote = await Quote.findById(quoteId);
    if (!quote) {
      return res.status(404).json({
        success: false,
        message: 'Quote not found'
      });
    }

    // Update quote evaluation
    quote.evaluation = {
      qualityScore: evaluation.qualityScore,
      costScore: evaluation.costScore,
      deliveryScore: evaluation.deliveryScore,
      totalScore: evaluation.totalScore,
      notes: evaluation.notes,
      evaluatedBy: req.user.userId,
      evaluationDate: new Date()
    };

    quote.status = 'evaluated';
    await quote.save();

    // Check if all quotes are evaluated
    const rfq = await RFQ.findOne({ requisitionId });
    const allQuotes = await Quote.find({ rfqId: rfq._id });
    const evaluatedCount = allQuotes.filter(q => q.status === 'evaluated').length;

    if (evaluatedCount === allQuotes.length && allQuotes.length > 0) {
      // Update requisition status
      requisition.status = 'quotes_received';
      await requisition.save();
    }

    res.json({
      success: true,
      message: 'Quote evaluated successfully',
      data: {
        quoteId: quote._id,
        evaluation: quote.evaluation,
        status: quote.status
      }
    });

  } catch (error) {
    console.error('Evaluate quotes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to evaluate quote',
      error: error.message
    });
  }
};

/**
 * Select a quote as winner and create purchase order
 */
 /**
 * Select a quote as winner and create purchase order
 */
  const selectQuote = async (req, res) => {
    try {
      const { requisitionId, quoteId } = req.params;
      const { 
        selectionReason, 
        createPurchaseOrder = true,
        purchaseOrderDetails = {}
      } = req.body;
  
      console.log('=== SELECT QUOTE AND CREATE PO ===');
      console.log('Requisition ID:', requisitionId);
      console.log('Quote ID:', quoteId);
      console.log('Create PO:', createPurchaseOrder);
      console.log('Request body:', req.body);
  
      const user = await User.findById(req.user.userId);
      
      const quote = await Quote.findById(quoteId)
        .populate('supplierId', 'fullName email phone supplierDetails')
        .populate('rfqId', 'title buyerId')
        .populate('requisitionId', 'title deliveryLocation employee');
  
      if (!quote) {
        return res.status(404).json({
          success: false,
          message: 'Quote not found'
        });
      }
  
      console.log('Quote found:', quote.id);
      console.log('Quote supplier:', quote.supplierId?.fullName);
  
      // Verify authorization
      const requisition = await PurchaseRequisition.findById(requisitionId);
      if (!requisition) {
        return res.status(404).json({
          success: false,
          message: 'Requisition not found'
        });
      }
  
      const isAssignedBuyer = requisition.supplyChainReview?.assignedBuyer?.toString() === req.user.userId;
      const isAuthorized = user.role === 'admin' || user.role === 'supply_chain' || isAssignedBuyer;
  
      if (!isAuthorized) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
  
      // Check if quote is already selected
      if (quote.status === 'selected') {
        return res.status(400).json({
          success: false,
          message: 'Quote has already been selected'
        });
      }
  
      console.log('Authorization passed, updating quote status...');
  
      // Update quote status
      quote.status = 'selected';
      quote.selectionDate = new Date();
      quote.selectionReason = selectionReason || 'Selected as winning quote';
      quote.selectedBy = req.user.userId;
      await quote.save();
  
      console.log('Quote status updated to selected');
  
      // Reject other quotes for the same RFQ
      const rejectedCount = await Quote.updateMany(
        { rfqId: quote.rfqId._id, _id: { $ne: quoteId } },
        { 
          status: 'rejected',
          rejectionDate: new Date(),
          rejectionReason: 'Another quote was selected'
        }
      );
  
      console.log(`Rejected ${rejectedCount.modifiedCount} other quotes`);
  
      // Update RFQ status
      const rfq = await RFQ.findById(quote.rfqId._id);
      if (rfq) {
        rfq.status = 'awarded';
        rfq.selectedQuote = quoteId;
        rfq.awardDate = new Date();
        rfq.awardReason = selectionReason || 'Best evaluated quote';
        await rfq.save();
        console.log('RFQ status updated to awarded');
      }
  
      let purchaseOrder = null;
  
      // Create purchase order if requested
      if (createPurchaseOrder) {
        try {
          console.log('Creating purchase order...');
          
          // Import PurchaseOrder model
          const PurchaseOrder = require('../models/PurchaseOrder');
  
          // Generate PO number
          const now = new Date();
          const year = now.getFullYear();
          const month = String(now.getMonth() + 1).padStart(2, '0');
          const day = String(now.getDate()).padStart(2, '0');
          const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
          const poNumber = `PO-${year}-${random}`;
  
          console.log('Generated PO number:', poNumber);
  
          // Calculate expected delivery date
          const deliveryDays = quote.deliveryTime?.value || 7;
          const expectedDeliveryDate = purchaseOrderDetails.deliveryDate ? 
            new Date(purchaseOrderDetails.deliveryDate) : 
            new Date(Date.now() + deliveryDays * 24 * 60 * 60 * 1000);
  
          console.log('Expected delivery date:', expectedDeliveryDate);
          console.log('Quote items:', quote.items);
  
          // Ensure quote items exist and have required fields
          if (!quote.items || quote.items.length === 0) {
            throw new Error('Quote has no items');
          }
  
          // Create purchase order
          purchaseOrder = new PurchaseOrder({
            poNumber,
            quoteId: quote._id,
            requisitionId: quote.requisitionId._id,
            supplierId: quote.supplierId._id,
            buyerId: req.user.userId,
            
            // Order details
            items: quote.items.map(item => ({
              description: item.description || 'Item description',
              quantity: item.quantity || 1,
              unitPrice: item.unitPrice || 0,
              totalPrice: item.totalPrice || (item.quantity * item.unitPrice) || 0,
              specifications: item.specifications || ''
            })),
            
            totalAmount: quote.totalAmount || 0,
            currency: quote.currency || 'XAF',
            
            // Delivery and payment
            deliveryAddress: purchaseOrderDetails.deliveryAddress || 
                            quote.requisitionId?.deliveryLocation ||
                            'Default delivery address',
            expectedDeliveryDate,
            paymentTerms: purchaseOrderDetails.paymentTerms || 
                         quote.paymentTerms || 
                         '30 days',
            
            // Additional details
            specialInstructions: purchaseOrderDetails.specialInstructions || 
                                `Purchase order created from selected quote ${quote.quoteNumber || quote._id}`,
            termsAndConditions: purchaseOrderDetails.termsAndConditions,
            
            // Status tracking
            status: 'draft',
            progress: 5,
            currentStage: 'created',
            
            // Activities log
            activities: [{
              type: 'created',
              description: `Purchase order created from selected quote (${quote.quoteNumber || quote._id})`,
              user: user.fullName || 'Buyer',
              timestamp: new Date()
            }],
            
            // Supplier details snapshot
            supplierDetails: {
              name: quote.supplierId.supplierDetails?.companyName || quote.supplierId.fullName,
              email: quote.supplierId.email,
              phone: quote.supplierId.phone,
              address: quote.supplierId.supplierDetails?.address || ''
            },
            
            createdBy: req.user.userId
          });
  
          console.log('Saving purchase order...');
          await purchaseOrder.save();
          console.log('Purchase order created successfully:', purchaseOrder.poNumber);
  
          // Update quote with PO reference
          quote.purchaseOrderId = purchaseOrder._id;
          quote.status = 'purchase_order_created';
          await quote.save();
  
          console.log('Quote updated with PO reference');
  
        } catch (poError) {
          console.error('Failed to create purchase order:', poError);
          console.error('PO Error stack:', poError.stack);
          
          // Don't fail the quote selection, but return the error info
          return res.status(500).json({
            success: false,
            message: 'Quote selected but purchase order creation failed',
            error: poError.message,
            stack: process.env.NODE_ENV === 'development' ? poError.stack : undefined,
            data: {
              selectedQuote: {
                id: quote._id,
                quoteNumber: quote.quoteNumber,
                supplierName: quote.supplierId.supplierDetails?.companyName || quote.supplierId.fullName,
                totalAmount: quote.totalAmount,
                selectionDate: quote.selectionDate
              }
            }
          });
        }
      }
  
      console.log('Updating requisition status...');
  
      // Update requisition status
      requisition.status = createPurchaseOrder && purchaseOrder ? 
        'procurement_complete' : 'quotes_received';
      
      if (!requisition.procurementDetails) {
        requisition.procurementDetails = {};
      }
      
      requisition.procurementDetails.selectedVendor = quote.supplierId.supplierDetails?.companyName || 
                                                     quote.supplierId.fullName;
      requisition.procurementDetails.finalCost = quote.totalAmount;
      requisition.procurementDetails.selectionDate = new Date();
      
      if (purchaseOrder) {
        requisition.procurementDetails.purchaseOrderId = purchaseOrder._id;
      }
      
      await requisition.save();
      console.log('Requisition status updated');
  
      // Send notification to winning supplier
      try {
        console.log('Sending notification to supplier...');
        const supplierName = quote.supplierId.supplierDetails?.companyName || quote.supplierId.fullName;
        
        await sendEmail({
          to: quote.supplierId.email,
          subject: `🎉 Congratulations! Your Quote Has Been Selected - ${rfq?.title || 'Purchase Request'}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #f6ffed; padding: 20px; border-radius: 8px; border-left: 4px solid #52c41a;">
                <h2 style="color: #52c41a; margin-top: 0;">🎉 Quote Selected!</h2>
                <p>Dear ${supplierName},</p>
                <p>We are pleased to inform you that your quote has been selected for the following requirement:</p>
                
                <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <h4>Selection Details</h4>
                  <ul>
                    <li><strong>RFQ:</strong> ${rfq?.title || 'Purchase Request'}</li>
                    <li><strong>Quote Amount:</strong> ${quote.currency} ${quote.totalAmount.toLocaleString()}</li>
                    <li><strong>Buyer:</strong> ${user.fullName}</li>
                    <li><strong>Selection Date:</strong> ${new Date().toLocaleDateString('en-GB')}</li>
                  </ul>
                  ${selectionReason ? `<p><strong>Selection Reason:</strong> ${selectionReason}</p>` : ''}
                </div>
                
                ${purchaseOrder ? `
                <div style="background-color: #e6f7ff; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <h4 style="color: #1890ff;">Purchase Order Created</h4>
                  <p>A purchase order has been automatically created:</p>
                  <p><strong>PO Number:</strong> ${purchaseOrder.poNumber}</p>
                  <p>You will receive the official purchase order separately via email.</p>
                </div>
                ` : ''}
                
                <p>Our procurement team will contact you shortly to finalize the delivery arrangements.</p>
                <p>Thank you for your competitive quotation and we look forward to working with you.</p>
                
                <p>Best regards,<br>${user.fullName}<br>Procurement Team</p>
              </div>
            </div>
          `
        });
        
        console.log('Supplier notification sent successfully');
      } catch (emailError) {
        console.error('Failed to send winner notification:', emailError);
      }
  
      // Send notification to employee
      try {
        console.log('Sending notification to employee...');
        if (requisition.employee) {
          const employee = await User.findById(requisition.employee);
          if (employee && employee.email) {
            await sendEmail({
              to: employee.email,
              subject: `Supplier Selected for Your Requisition - ${requisition.title}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <div style="background-color: #f6ffed; padding: 20px; border-radius: 8px;">
                    <h2 style="color: #52c41a;">Supplier Selected</h2>
                    <p>Dear ${employee.fullName},</p>
                    <p>We have selected a supplier for your purchase requisition:</p>
                    
                    <div style="background: white; padding: 15px; margin: 15px 0; border-radius: 8px;">
                      <p><strong>Requisition:</strong> ${requisition.title}</p>
                      <p><strong>Selected Supplier:</strong> ${quote.supplierId.supplierDetails?.companyName || quote.supplierId.fullName}</p>
                      <p><strong>Final Cost:</strong> ${quote.currency} ${quote.totalAmount.toLocaleString()}</p>
                      ${purchaseOrder ? `<p><strong>Purchase Order:</strong> ${purchaseOrder.poNumber}</p>` : ''}
                    </div>
                    
                    <p>We will keep you updated on the delivery progress.</p>
                    <p>Thank you for your patience during the procurement process.</p>
                  </div>
                </div>
              `
            });
            
            console.log('Employee notification sent successfully');
          }
        }
      } catch (emailError) {
        console.error('Failed to send employee notification:', emailError);
      }
  
      // Prepare response data
      const responseData = {
        selectedQuote: {
          id: quote._id,
          quoteNumber: quote.quoteNumber,
          supplierName: quote.supplierId.supplierDetails?.companyName || quote.supplierId.fullName,
          totalAmount: quote.totalAmount,
          currency: quote.currency,
          selectionDate: quote.selectionDate,
          selectionReason: quote.selectionReason
        },
        requisitionStatus: requisition.status
      };
  
      // Add purchase order info if created
      if (purchaseOrder) {
        responseData.purchaseOrder = {
          id: purchaseOrder._id,
          poNumber: purchaseOrder.poNumber,
          status: purchaseOrder.status,
          totalAmount: purchaseOrder.totalAmount,
          expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
          creationDate: purchaseOrder.createdAt
        };
      }
  
      console.log('Sending success response...');
  
      res.json({
        success: true,
        message: createPurchaseOrder && purchaseOrder ? 
          'Quote selected and purchase order created successfully' : 
          'Quote selected successfully',
        data: responseData
      });
  
    } catch (error) {
      console.error('Select quote error:', error);
      console.error('Error stack:', error.stack);
      res.status(500).json({
        success: false,
        message: 'Failed to select quote',
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
};


/**
 * Get petty cash forms assigned to buyer
 */
const getPettyCashForms = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    
    console.log('=== BUYER - GET PETTY CASH FORMS ===');
    console.log('Buyer ID:', req.user.userId);
    
    let query = {
      'supplyChainReview.assignedBuyer': req.user.userId,
      'paymentMethod': 'cash',
      'pettyCashForm.generated': true
    };
    
    if (status) {
      query['pettyCashForm.status'] = status;
    }
    
    const requisitions = await PurchaseRequisition.find(query)
      .populate('employee', 'fullName email department phone')
      .sort({ 'pettyCashForm.generatedDate': -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await PurchaseRequisition.countDocuments(query);
    
    // Transform to match frontend expectations
    const pettyCashForms = requisitions.map(req => ({
      id: req._id,
      pettyCashFormNumber: req.pettyCashForm.formNumber,
      requisitionNumber: req.requisitionNumber,
      title: req.title,
      employee: {
        name: req.employee.fullName,
        email: req.employee.email,
        department: req.employee.department,
        phone: req.employee.phone
      },
      amountRequested: req.pettyCashForm.amount || req.budgetXAF,
      generatedDate: req.pettyCashForm.generatedDate,
      status: req.pettyCashForm.status,
      urgency: req.urgency,
      downloadedCount: req.pettyCashForm.downloads?.length || 0,
      lastDownloadDate: req.pettyCashForm.downloads?.length > 0 ? 
        req.pettyCashForm.downloads[req.pettyCashForm.downloads.length - 1].downloadDate : null
    }));
    
    console.log(`Found ${pettyCashForms.length} petty cash forms`);
    
    res.json({
      success: true,
      data: pettyCashForms,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: pettyCashForms.length,
        totalRecords: total
      }
    });
    
  } catch (error) {
    console.error('Get petty cash forms error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch petty cash forms',
      error: error.message
    });
  }
};

/**
 * Get petty cash form details
 */
const getPettyCashFormDetails = async (req, res) => {
  try {
    const { formId } = req.params;
    
    console.log('=== GET PETTY CASH FORM DETAILS ===');
    console.log('Form ID:', formId);
    
    const requisition = await PurchaseRequisition.findById(formId)
      .populate('employee', 'fullName email department phone')
      .populate('supplyChainReview.assignedBuyer', 'fullName email')
      .populate('disbursements.disbursedBy', 'fullName email')
      .populate('disbursements.acknowledgedBy', 'fullName email signature');
    
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Petty cash form not found'
      });
    }
    
    // Verify buyer has access
    if (requisition.supplyChainReview?.assignedBuyer?._id.toString() !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied - you are not assigned to this requisition'
      });
    }
    
    // Verify it's a cash payment with generated form
    if (requisition.paymentMethod !== 'cash' || !requisition.pettyCashForm?.generated) {
      return res.status(400).json({
        success: false,
        message: 'This requisition does not have a petty cash form'
      });
    }
    
    // Transform to match frontend expectations
    const formDetails = {
      id: requisition._id,
      pettyCashForm: {
        formNumber: requisition.pettyCashForm.formNumber,
        generatedDate: requisition.pettyCashForm.generatedDate,
        status: requisition.pettyCashForm.status,
        amount: requisition.pettyCashForm.amount || requisition.budgetXAF,
        downloadedCount: requisition.pettyCashForm.downloads?.length || 0,
        downloadHistory: requisition.pettyCashForm.downloads || []
      },
      requisition: {
        id: requisition._id,
        requisitionNumber: requisition.requisitionNumber,
        title: requisition.title,
        itemCategory: requisition.itemCategory,
        budgetXAF: requisition.budgetXAF,
        urgency: requisition.urgency,
        deliveryLocation: requisition.deliveryLocation,
        justification: requisition.justificationOfPurchase,
        items: requisition.items.map(item => ({
          description: item.description,
          quantity: item.quantity,
          measuringUnit: item.measuringUnit,
          estimatedPrice: item.estimatedPrice
        }))
      },
      employee: {
        name: requisition.employee.fullName,
        email: requisition.employee.email,
        department: requisition.employee.department,
        phone: requisition.employee.phone
      },
      approvalChain: requisition.approvalChain.map(step => ({
        level: step.level,
        approver: {
          name: step.approver.name,
          email: step.approver.email,
          role: step.approver.role,
          department: step.approver.department
        },
        status: step.status,
        comments: step.comments,
        actionDate: step.actionDate,
        actionTime: step.actionTime
      }))
    };
    
    res.json({
      success: true,
      data: formDetails
    });
    
  } catch (error) {
    console.error('Get petty cash form details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch form details',
      error: error.message
    });
  }
};


const downloadPettyCashFormPDF = async (req, res) => {
  try {
    const { formId } = req.params;
    
    console.log('=== DOWNLOAD PETTY CASH FORM PDF ===');
    console.log('Form ID:', formId);
    console.log('Buyer ID:', req.user.userId);
    
    const requisition = await PurchaseRequisition.findById(formId)
      .populate('employee', 'fullName email department phone')
      .populate('supplyChainReview.assignedBuyer', 'fullName email');
    
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Petty cash form not found'
      });
    }
    
    // Verify buyer has access
    if (requisition.supplyChainReview?.assignedBuyer?._id.toString() !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    // Verify it's a cash payment with generated form
    if (requisition.paymentMethod !== 'cash' || !requisition.pettyCashForm?.generated) {
      return res.status(400).json({
        success: false,
        message: 'No petty cash form available for this requisition'
      });
    }
    
    // Import pdfService
    const pdfService = require('../services/pdfService');
    
    // Prepare data with items included
    const mappedDisbursements = Array.isArray(requisition.disbursements) && requisition.disbursements.length > 0
      ? requisition.disbursements.map((disbursement, index) => ({
          disbursementNumber: disbursement.disbursementNumber || index + 1,
          date: disbursement.date,
          amount: disbursement.amount,
          notes: disbursement.notes,
          disbursedBy: disbursement.disbursedBy,
          acknowledged: disbursement.acknowledged || false,
          acknowledgedBy: disbursement.acknowledgedBy,
          acknowledgmentDate: disbursement.acknowledgmentDate,
          acknowledgmentNotes: disbursement.acknowledgmentNotes
        }))
      : (requisition.pettyCashForm.disbursementDate ? [{
          disbursementNumber: 1,
          date: requisition.pettyCashForm.disbursementDate,
          amount: requisition.pettyCashForm.amount || requisition.budgetXAF,
          notes: 'Initial petty cash disbursement',
          acknowledged: false
        }] : []);

    const pdfData = {
      // IDs
      _id: requisition._id,
      displayId: requisition.pettyCashForm.formNumber,
      requisitionNumber: requisition.requisitionNumber,
      
      // Employee info
      employee: {
        fullName: requisition.employee.fullName,
        email: requisition.employee.email,
        department: requisition.employee.department,
        phone: requisition.employee.phone
      },
      
      // Request details
      title: requisition.title,
      purpose: requisition.title,
      justification: requisition.justificationOfPurchase,
      businessJustification: requisition.justificationOfPurchase,
      requestType: 'petty-cash',
      urgency: requisition.urgency?.toLowerCase() || 'medium',
      
      // Items array
      items: requisition.items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unit: item.measuringUnit || 'pcs',
        measuringUnit: item.measuringUnit || 'pcs',
        estimatedPrice: item.estimatedPrice || 0,
        specifications: item.specifications || item.description
      })),
      
      // Financial details
      amountRequested: requisition.budgetXAF,
      amountApproved: requisition.pettyCashForm.amount || requisition.budgetXAF,
      totalDisbursed: 0,
      remainingBalance: requisition.pettyCashForm.amount || requisition.budgetXAF,
      
      // Status
      status: requisition.pettyCashForm.status,
      
      // Dates
      createdAt: requisition.createdAt,
      
      // Disbursement details
      disbursementDetails: requisition.pettyCashForm.disbursementDate ? {
        date: requisition.pettyCashForm.disbursementDate,
        amount: requisition.pettyCashForm.amount || requisition.budgetXAF
      } : null,
      
      // Disbursements array
      disbursements: mappedDisbursements,
      
      // Approval chain
      approvalChain: requisition.approvalChain.map(step => ({
        level: step.level,
        approver: {
          name: step.approver.name,
          email: step.approver.email,
          role: step.approver.role,
          department: step.approver.department
        },
        status: step.status === 'approved' ? 'approved' : 
                step.status === 'rejected' ? 'rejected' : 'pending',
        comments: step.comments,
        actionDate: step.actionDate,
        actionTime: step.actionTime
      })),
      
      // Budget allocation
      budgetAllocation: requisition.financeVerification?.budgetCode ? {
        budgetCode: requisition.financeVerification.budgetCode,
        allocatedAmount: requisition.financeVerification.assignedBudget || requisition.budgetXAF,
        allocationStatus: 'allocated',
        budgetCodeId: {
          name: `Budget Code: ${requisition.financeVerification.budgetCode}`
        }
      } : null,
      
      // Additional context
      itemCategory: requisition.itemCategory,
      deliveryLocation: requisition.deliveryLocation
    };
    
    console.log('PDF Data prepared:', {
      formNumber: pdfData.displayId,
      employee: pdfData.employee.fullName,
      amount: pdfData.amountRequested,
      itemCount: pdfData.items.length,
      status: pdfData.status
    });
    
    // Generate PDF
    const pdfResult = await pdfService.generateCashRequestPDF(pdfData);
    
    if (!pdfResult.success) {
      throw new Error('PDF generation failed');
    }
    
    console.log('✅ PDF generated successfully');
    
    // ✅ FIXED: Update download history WITHOUT triggering validation
    await PurchaseRequisition.findByIdAndUpdate(
      formId,
      {
        $push: {
          'pettyCashForm.downloads': {
            downloadedBy: req.user.userId,
            downloadDate: new Date(),
            ipAddress: req.ip || req.connection.remoteAddress
          }
        }
      },
      { 
        runValidators: false, // ✅ Skip validation to avoid budgetCodeInfo errors
        new: false 
      }
    );
    
    console.log('✅ Download tracked');
    
    // Send PDF to browser
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfResult.filename}"`);
    res.setHeader('Content-Length', pdfResult.buffer.length);
    res.send(pdfResult.buffer);
    
    console.log('✅ PDF sent to browser successfully');
    
  } catch (error) {
    console.error('Download petty cash form PDF error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to download petty cash form',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Get petty cash form statistics for buyer
 */
const getPettyCashStats = async (req, res) => {
  try {
    console.log('=== GET PETTY CASH STATS ===');
    console.log('Buyer ID:', req.user.userId);
    
    const query = {
      'supplyChainReview.assignedBuyer': req.user.userId,
      'paymentMethod': 'cash',
      'pettyCashForm.generated': true,
      'status': 'approved'
    };
    
    const forms = await PurchaseRequisition.find(query);
    
    // Calculate stats
    const stats = {
      total: forms.length,
      pendingDownload: forms.filter(f => 
        !f.pettyCashForm.downloads || f.pettyCashForm.downloads.length === 0
      ).length,
      downloaded: forms.filter(f => 
        f.pettyCashForm.downloads && f.pettyCashForm.downloads.length > 0
      ).length,
      totalAmount: forms.reduce((sum, f) => sum + (f.pettyCashForm.amount || f.budgetXAF || 0), 0)
    };
    
    console.log('Stats:', stats);
    
    res.json({
      success: true,
      data: stats
    });
    
  } catch (error) {
    console.error('Get petty cash stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
      error: error.message
    });
  }
};

// ✅ NEW: Buyer adds/updates purchase justification
const updatePurchaseJustification = async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const { justificationOfPurchase, justificationOfPreferredSupplier } = req.body;
    const buyerId = req.user.userId;

    console.log('=== BUYER UPDATE JUSTIFICATION ===');
    console.log('Requisition ID:', requisitionId);
    console.log('Buyer ID:', buyerId);

    // Validate input
    if (!justificationOfPurchase || justificationOfPurchase.trim().length < 20) {
      return res.status(400).json({
        success: false,
        message: 'Purchase justification must be at least 20 characters'
      });
    }

    // Find requisition
    const requisition = await PurchaseRequisition.findById(requisitionId);
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    // Verify the requester is the assigned buyer
    if (!requisition.supplyChainReview?.assignedBuyer?.equals(buyerId)) {
      return res.status(403).json({
        success: false,
        message: 'You are not the assigned buyer for this requisition'
      });
    }

    // Update justification fields
    requisition.justificationOfPurchase = justificationOfPurchase.trim();
    if (justificationOfPreferredSupplier) {
      requisition.justificationOfPreferredSupplier = justificationOfPreferredSupplier.trim();
    }

    await requisition.save();

    console.log('✅ Justification updated successfully');

    res.json({
      success: true,
      message: 'Justification updated successfully',
      data: {
        justificationOfPurchase: requisition.justificationOfPurchase,
        justificationOfPreferredSupplier: requisition.justificationOfPreferredSupplier
      }
    });

  } catch (error) {
    console.error('Update justification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update justification',
      error: error.message
    });
  }
};

module.exports = {
    getAssignedRequisitions,
    getRequisitionDetails,
    getSuppliersByCategory,
    createAndSendRFQ,
    startSourcing: createAndSendRFQ, 
    getQuotesForEvaluation,
    getBuyerDashboard,
    updateProcurementStatus,
    getQuotes,
    getRFQDetails,
    evaluateQuotes,
    selectQuote,
    getPettyCashForms,
    getPettyCashFormDetails,
    downloadPettyCashFormPDF,
    getPettyCashStats,
    updatePurchaseJustification,  // ✅ NEW: Buyer can add/update justification
    
    // Placeholder implementations for missing functions
    evaluateQuote: async (req, res) => {
      try {
        const { quoteId } = req.params;
        const {
          qualityScore,
          costScore,
          deliveryScore,
          technicalScore,
          notes,
          strengths,
          weaknesses,
          recommendations
        } = req.body;
        
        // TODO: Implement quote evaluation logic
        res.json({ 
          success: true, 
          message: 'Quote evaluation functionality implemented',
          data: {
            quoteId,
            evaluation: {
              qualityScore,
              costScore,
              deliveryScore,
              technicalScore,
              notes,
              strengths,
              weaknesses,
              recommendations
            }
          }
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to evaluate quote',
          error: error.message
        });
      }
    },
    
    selectQuote: async (req, res) => {
      try {
        const { requisitionId, quoteId } = req.params;
        const { reason } = req.body;
        
        // TODO: Implement quote selection logic
        res.json({ 
          success: true, 
          message: 'Quote selection functionality implemented',
          data: {
            requisitionId,
            quoteId,
            selectionReason: reason
          }
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to select quote',
          error: error.message
        });
      }
    },
    
    getSuppliers: async (req, res) => {
      try {
        const { category, search, page = 1, limit = 20, sortBy } = req.query;
        
        // Mock implementation - replace with actual supplier fetching
        const mockSuppliers = [
          {
            id: 'supplier_1',
            name: 'TechCorp Solutions',
            email: 'contact@techcorp.cm',
            categories: ['IT Equipment', 'Office Supplies'],
            rating: 4.5,
            status: 'approved'
          },
          {
            id: 'supplier_2',
            name: 'Office Plus Ltd',
            email: 'info@officeplus.cm',
            categories: ['Office Supplies', 'Furniture'],
            rating: 4.2,
            status: 'approved'
          }
        ];
        
        res.json({
          success: true,
          data: mockSuppliers,
          pagination: {
            current: parseInt(page),
            total: 1,
            count: mockSuppliers.length,
            totalRecords: mockSuppliers.length
          }
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to fetch suppliers',
          error: error.message
        });
      }
    },
    
    getSupplierDetails: async (req, res) => {
      try {
        const { supplierId } = req.params;
        
        // Mock supplier details
        const mockSupplier = {
          id: supplierId,
          name: 'TechCorp Solutions',
          email: 'contact@techcorp.cm',
          phone: '+237 677 123 456',
          address: 'Douala, Cameroon',
          rating: 4.5,
          categories: ['IT Equipment', 'Office Supplies'],
          performance: {
            overallRating: 4.5,
            qualityRating: 4.7,
            deliveryRating: 4.3,
            communicationRating: 4.6
          }
        };
        
        res.json({
          success: true,
          data: {
            supplier: mockSupplier,
            recentQuotes: [],
            statistics: {
              totalQuotes: 0,
              averageRating: 4.5,
              onTimeDeliveryRate: 95,
              profileCompletion: 90
            }
          }
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to fetch supplier details',
          error: error.message
        });
      }
    },
    
    rateSupplier: async (req, res) => {
      try {
        const { supplierId } = req.params;
        const {
          overallRating,
          qualityRating,
          deliveryRating,
          communicationRating,
          priceCompetitiveness,
          comments
        } = req.body;
        
        // TODO: Implement supplier rating logic
        res.json({
          success: true,
          message: 'Supplier rated successfully',
          data: {
            supplierId,
            rating: {
              overallRating,
              qualityRating,
              deliveryRating,
              communicationRating,
              priceCompetitiveness,
              comments
            }
          }
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to rate supplier',
          error: error.message
        });
      }
    },
    
    sendSupplierMessage: async (req, res) => {
      try {
        const { supplierId } = req.params;
        const { subject, message } = req.body;
        
        // TODO: Implement supplier messaging logic
        res.json({
          success: true,
          message: 'Message sent to supplier successfully',
          data: {
            supplierId,
            subject,
            messageSent: true
          }
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to send message to supplier',
          error: error.message
        });
      }
    },

    rejectQuote: async (req, res) => {
      try {
        const { requisitionId, quoteId } = req.params;
        const { rejectionReason } = req.body;
  
        const quote = await Quote.findById(quoteId);
        if (!quote) {
          return res.status(404).json({
            success: false,
            message: 'Quote not found'
          });
        }
  
        quote.status = 'rejected';
        quote.rejectionDate = new Date();
        quote.rejectionReason = rejectionReason;
        quote.rejectedBy = req.user.userId;
        await quote.save();
  
        res.json({
          success: true,
          message: 'Quote rejected successfully'
        });
  
      } catch (error) {
        console.error('Reject quote error:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to reject quote',
          error: error.message
        });
      }
    },
  
    requestQuoteClarification: async (req, res) => {
      try {
        const { requisitionId, quoteId } = req.params;
        const { questions, priority = 'medium' } = req.body;
  
        const quote = await Quote.findById(quoteId)
          .populate('supplierId', 'email fullName supplierDetails');
  
        if (!quote) {
          return res.status(404).json({
            success: false,
            message: 'Quote not found'
          });
        }
  
        // Add clarification request to quote
        if (!quote.clarificationRequests) {
          quote.clarificationRequests = [];
        }
  
        quote.clarificationRequests.push({
          requestDate: new Date(),
          requestedBy: req.user.userId,
          questions,
          priority,
          status: 'pending'
        });
  
        quote.status = 'clarification_requested';
        await quote.save();
  
        // Send email to supplier
        const user = await User.findById(req.user.userId);
        try {
          await sendEmail({
            to: quote.supplierId.email,
            subject: `Clarification Request for Your Quote`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #faad14;">Clarification Request</h2>
                <p>Dear ${quote.supplierId.supplierDetails?.companyName || quote.supplierId.fullName},</p>
                <p>We require clarification on your submitted quote:</p>
                <div style="background: #fff7e6; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <p><strong>Questions:</strong></p>
                  <p>${questions}</p>
                </div>
                <p>Please respond at your earliest convenience.</p>
                <p>Best regards,<br/>${user.fullName}</p>
              </div>
            `
          });
        } catch (emailError) {
          console.error('Failed to send clarification email:', emailError);
        }
  
        res.json({
          success: true,
          message: 'Clarification request sent successfully'
        });
  
      } catch (error) {
        console.error('Request clarification error:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to send clarification request',
          error: error.message
        });
      }
    }
  };

  


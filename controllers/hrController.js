const User = require('../models/User');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const unlinkAsync = promisify(fs.unlink);
const crypto = require('crypto');
const sendEmail = require('../utils/sendEmail');

// ===== DOCUMENT UPLOAD - COMPLETELY REWRITTEN =====
exports.uploadDocument = async (req, res) => {
  try {
    const { id, type } = req.params;
    const file = req.file;

    console.log('\n=== HR DOCUMENT UPLOAD ===');
    console.log('Employee ID:', id);
    console.log('Document Type:', type);
    console.log('File received:', file ? file.originalname : 'None');

    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const employee = await User.findById(id);

    if (!employee) {
      console.error('Employee not found');
      // Clean up uploaded file
      if (file.path && fs.existsSync(file.path)) {
        await unlinkAsync(file.path);
      }
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    console.log(`Employee found: ${employee.fullName}`);

    // Create permanent storage directory
    const permanentDir = path.join(__dirname, '../uploads/hr-documents', id);
    
    try {
      await fs.promises.mkdir(permanentDir, { recursive: true, mode: 0o755 });
      console.log(`✓ Permanent directory ready: ${permanentDir}`);
    } catch (dirError) {
      console.error('Failed to create permanent directory:', dirError);
      if (file.path && fs.existsSync(file.path)) {
        await unlinkAsync(file.path);
      }
      throw new Error('Failed to prepare storage directory');
    }

    // Generate unique filename
    const timestamp = Date.now();
    const sanitizedType = type.replace(/[^a-zA-Z0-9]/g, '_');
    const ext = path.extname(file.originalname).toLowerCase();
    const baseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
    const uniqueFilename = `${sanitizedType}-${timestamp}-${baseName}${ext}`;
    const permanentPath = path.join(permanentDir, uniqueFilename);

    console.log(`Moving file from ${file.path} to ${permanentPath}`);

    // Move file from temp to permanent storage
    try {
      await fs.promises.rename(file.path, permanentPath);
      console.log('✓ File moved successfully');
    } catch (moveError) {
      console.error('Failed to move file:', moveError);
      // Try copy + delete as fallback
      try {
        await fs.promises.copyFile(file.path, permanentPath);
        await fs.promises.unlink(file.path);
        console.log('✓ File copied and temp deleted');
      } catch (fallbackError) {
        console.error('Fallback copy failed:', fallbackError);
        throw new Error('Failed to save document');
      }
    }

    // Verify file was saved
    if (!fs.existsSync(permanentPath)) {
      throw new Error('File was not saved successfully');
    }

    const fileStats = fs.statSync(permanentPath);
    console.log(`✓ File verified: ${fileStats.size} bytes`);

    // Initialize documents object if not exists
    if (!employee.employmentDetails) {
      employee.employmentDetails = {};
    }
    if (!employee.employmentDetails.documents) {
      employee.employmentDetails.documents = {};
    }

    const documentData = {
      name: file.originalname,
      filename: uniqueFilename,
      publicId: uniqueFilename, // For download endpoint
      filePath: permanentPath,
      relativePath: `/uploads/hr-documents/${id}/${uniqueFilename}`,
      size: file.size,
      mimetype: file.mimetype,
      uploadedAt: new Date(),
      uploadedBy: req.user.userId
    };

    // Check if document type supports multiple files
    const multipleDocsTypes = ['references', 'academicDiplomas', 'workCertificates'];

    if (multipleDocsTypes.includes(type)) {
      console.log(`Document type '${type}' supports multiple files`);
      
      // Initialize array if not exists
      if (!employee.employmentDetails.documents[type]) {
        employee.employmentDetails.documents[type] = [];
      }
      
      employee.employmentDetails.documents[type].push(documentData);
      console.log(`Added to array. Total ${type} documents: ${employee.employmentDetails.documents[type].length}`);
    } else {
      console.log(`Document type '${type}' is single file`);
      
      // Delete old file if exists
      const oldDoc = employee.employmentDetails.documents[type];
      if (oldDoc && oldDoc.filePath) {
        if (fs.existsSync(oldDoc.filePath)) {
          try {
            await unlinkAsync(oldDoc.filePath);
            console.log('✓ Old document deleted');
          } catch (err) {
            console.warn('Failed to delete old file:', err.message);
          }
        }
      }
      
      employee.employmentDetails.documents[type] = documentData;
    }

    // Mark as modified to ensure save
    employee.markModified('employmentDetails');
    await employee.save();

    console.log('✅ Document saved to database');
    console.log(`Document metadata:`, documentData);

    res.status(200).json({
      success: true,
      message: 'Document uploaded successfully',
      data: documentData
    });

  } catch (error) {
    console.error('❌ Upload document error:', error);
    
    // Clean up uploaded file on error
    if (req.file && req.file.path) {
      try {
        if (fs.existsSync(req.file.path)) {
          await unlinkAsync(req.file.path);
          console.log('✓ Temp file cleaned up');
        }
      } catch (cleanupErr) {
        console.error('Failed to cleanup temp file:', cleanupErr);
      }
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to upload document',
      error: error.message
    });
  }
};

// ===== DOCUMENT DOWNLOAD - COMPLETELY REWRITTEN =====
exports.downloadDocument = async (req, res) => {
  try {
    const { id, type } = req.params;

    console.log('\n=== HR DOCUMENT DOWNLOAD ===');
    console.log('Employee ID:', id);
    console.log('Document Type:', type);

    const employee = await User.findById(id);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    const document = employee.employmentDetails?.documents?.[type];

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    // Handle array documents (get the first one, or specify index in query)
    let docToDownload = document;
    if (Array.isArray(document)) {
      const index = parseInt(req.query.index) || 0;
      if (index >= document.length) {
        return res.status(404).json({
          success: false,
          message: 'Document index out of range'
        });
      }
      docToDownload = document[index];
    }

    const filePath = docToDownload.filePath;

    console.log('Document path:', filePath);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error('File not found on disk:', filePath);
      return res.status(404).json({
        success: false,
        message: 'File not found on server. It may have been moved or deleted.'
      });
    }

    // Verify file is readable
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
    } catch (accessError) {
      console.error('File exists but is not readable:', accessError);
      return res.status(403).json({
        success: false,
        message: 'File cannot be accessed'
      });
    }

    const stats = fs.statSync(filePath);
    console.log(`File size: ${(stats.size / 1024).toFixed(2)} KB`);

    // Set headers for download
    res.setHeader('Content-Type', docToDownload.mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${docToDownload.name}"`);
    res.setHeader('Content-Length', stats.size);

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    
    fileStream.on('error', (error) => {
      console.error('File stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Error reading file'
        });
      }
    });

    fileStream.on('end', () => {
      console.log('✅ File download completed');
    });

    fileStream.pipe(res);

  } catch (error) {
    console.error('❌ Download document error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to download document',
        error: error.message
      });
    }
  }
};

// ===== DELETE DOCUMENT - ENHANCED =====
exports.deleteDocument = async (req, res) => {
  try {
    const { id, docId } = req.params;

    console.log('\n=== HR DOCUMENT DELETE ===');
    console.log('Employee ID:', id);
    console.log('Document ID:', docId);

    const employee = await User.findById(id);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    const docs = employee.employmentDetails?.documents;
    if (!docs) {
      return res.status(404).json({
        success: false,
        message: 'No documents found'
      });
    }

    let deleted = false;
    let filePath = null;

    // Check each document type
    for (const [key, value] of Object.entries(docs)) {
      if (Array.isArray(value)) {
        // Multiple documents
        const index = value.findIndex(doc => doc._id && doc._id.toString() === docId);
        if (index !== -1) {
          filePath = value[index].filePath;
          value.splice(index, 1);
          deleted = true;
          console.log(`✓ Document removed from ${key} array at index ${index}`);
          break;
        }
      } else if (value && value._id && value._id.toString() === docId) {
        // Single document
        filePath = value.filePath;
        docs[key] = null;
        deleted = true;
        console.log(`✓ Single document ${key} removed`);
        break;
      }
    }

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    // Delete physical file
    if (filePath && fs.existsSync(filePath)) {
      try {
        await unlinkAsync(filePath);
        console.log('✓ Physical file deleted');
      } catch (err) {
        console.warn('Failed to delete physical file:', err.message);
      }
    } else {
      console.warn('Physical file not found:', filePath);
    }

    employee.markModified('employmentDetails');
    await employee.save();

    console.log('✅ Document deleted successfully');

    res.status(200).json({
      success: true,
      message: 'Document deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete document error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete document',
      error: error.message
    });
  }
};

// ===== NEW: VIEW DOCUMENT INFO =====
exports.getDocumentInfo = async (req, res) => {
  try {
    const { id, type } = req.params;

    const employee = await User.findById(id);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    const document = employee.employmentDetails?.documents?.[type];

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    // Handle array documents
    if (Array.isArray(document)) {
      const docs = document.map(doc => ({
        id: doc._id,
        name: doc.name,
        size: doc.size,
        mimetype: doc.mimetype,
        uploadedAt: doc.uploadedAt,
        uploadedBy: doc.uploadedBy,
        canViewInline: ['.pdf', '.jpg', '.jpeg', '.png', '.gif'].includes(
          path.extname(doc.name).toLowerCase()
        )
      }));

      return res.json({
        success: true,
        data: {
          type,
          multiple: true,
          documents: docs,
          count: docs.length
        }
      });
    }

    // Single document
    res.json({
      success: true,
      data: {
        type,
        multiple: false,
        document: {
          id: document._id,
          name: document.name,
          size: document.size,
          mimetype: document.mimetype,
          uploadedAt: document.uploadedAt,
          uploadedBy: document.uploadedBy,
          canViewInline: ['.pdf', '.jpg', '.jpeg', '.png', '.gif'].includes(
            path.extname(document.name).toLowerCase()
          )
        }
      }
    });

  } catch (error) {
    console.error('Get document info error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get document info',
      error: error.message
    });
  }
};

// ===== EXISTING FUNCTIONS (UNCHANGED) =====

exports.getStatistics = async (req, res) => {
  try {
    const totalEmployees = await User.countDocuments({ 
      role: { $ne: 'supplier' },
      isActive: true 
    });

    const activeEmployees = await User.countDocuments({
      role: { $ne: 'supplier' },
      isActive: true,
      'employmentDetails.employmentStatus': 'Active'
    });

    const inactiveEmployees = await User.countDocuments({
      role: { $ne: 'supplier' },
      isActive: false
    });

    const onProbation = await User.countDocuments({
      role: { $ne: 'supplier' },
      'employmentDetails.employmentStatus': 'Probation'
    });

    const onLeave = await User.countDocuments({
      role: { $ne: 'supplier' },
      'employmentDetails.employmentStatus': 'On Leave'
    });

    const noticePeriod = await User.countDocuments({
      role: { $ne: 'supplier' },
      'employmentDetails.employmentStatus': 'Notice Period'
    });

    const suspended = await User.countDocuments({
      role: { $ne: 'supplier' },
      'employmentDetails.employmentStatus': 'Suspended'
    });

    // Count employees with incomplete documents
    const allEmployees = await User.find({ 
      role: { $ne: 'supplier' },
      isActive: true 
    }).select('employmentDetails.documents');

    let pendingDocuments = 0;
    allEmployees.forEach(emp => {
      const requiredDocs = [
        'nationalId', 'birthCertificate', 'bankAttestation', 
        'locationPlan', 'medicalCertificate', 'criminalRecord', 
        'employmentContract'
      ];
      
      const docs = emp.employmentDetails?.documents || {};
      const hasAllDocs = requiredDocs.every(doc => 
        docs[doc] && (docs[doc].filename || docs[doc].filePath)
      );
      
      if (!hasAllDocs) pendingDocuments++;
    });

    // Department distribution
    const departmentAggregation = await User.aggregate([
      { 
        $match: { 
          role: { $ne: 'supplier' },
          isActive: true 
        } 
      },
      {
        $group: {
          _id: '$department',
          count: { $sum: 1 }
        }
      }
    ]);

    const departmentDistribution = {};
    departmentAggregation.forEach(dept => {
      if (dept._id) {
        departmentDistribution[dept._id] = dept.count;
      }
    });

    res.status(200).json({
      success: true,
      data: {
        totalEmployees,
        activeEmployees,
        inactiveEmployees,
        onProbation,
        onLeave,
        noticePeriod,
        suspended,
        pendingDocuments,
        departmentDistribution
      }
    });

  } catch (error) {
    console.error('Get statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
      error: error.message
    });
  }
};

exports.getEmployees = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      department = '',
      status = '',
      contractType = '',
      contractExpiring = ''
    } = req.query;

    const query = { role: { $ne: 'supplier' } };

    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { 'employmentDetails.employeeId': { $regex: search, $options: 'i' } }
      ];
    }

    if (department) {
      query.department = department;
    }

    if (status) {
      query['employmentDetails.employmentStatus'] = status;
    }

    if (contractType) {
      query['employmentDetails.contractType'] = contractType;
    }

    if (contractExpiring) {
      const days = parseInt(contractExpiring);
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + days);

      query['employmentDetails.contractEndDate'] = {
        $gte: new Date(),
        $lte: futureDate
      };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const employees = await User.find(query)
      .select('-password')
      .sort('-createdAt')
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      data: employees,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get employees error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch employees',
      error: error.message
    });
  }
};

exports.getEmployee = async (req, res) => {
  try {
    const employee = await User.findById(req.params.id)
      .select('-password')
      .populate('supervisor', 'fullName email')
      .populate('departmentHead', 'fullName email');

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    res.status(200).json({
      success: true,
      data: employee
    });

  } catch (error) {
    console.error('Get employee error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch employee',
      error: error.message
    });
  }
};

exports.createEmployee = async (req, res) => {
  try {
    const {
      fullName,
      email,
      personalEmail,
      phoneNumber,
      department,
      position,
      role = 'employee',
      departmentRole = 'staff',
      employmentDetails,
      personalDetails
    } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered'
      });
    }

    const tempPassword = crypto.randomBytes(8).toString('hex');

    if (employmentDetails && employmentDetails.startDate && !employmentDetails.probationEndDate) {
      const startDate = new Date(employmentDetails.startDate);
      const probationEnd = new Date(startDate);
      probationEnd.setMonth(probationEnd.getMonth() + 3);
      employmentDetails.probationEndDate = probationEnd;
    }

    const employee = await User.create({
      fullName,
      email,
      personalEmail,
      phoneNumber,
      password: tempPassword,
      department,
      position,
      role,
      departmentRole,
      personalDetails,
      employmentDetails: {
        ...employmentDetails,
        employmentStatus: employmentDetails?.employmentStatus || 'Probation'
      },
      isActive: true
    });

    try {
      await sendEmail({
        to: email,
        subject: 'Welcome to the Company - Account Created',
        html: `
          <h2>Welcome ${fullName}!</h2>
          <p>Your employee account has been created by HR.</p>
          <h3>Login Credentials:</h3>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Temporary Password:</strong> ${tempPassword}</p>
          <p><strong>Login URL:</strong> ${process.env.FRONTEND_URL}/login</p>
          <p style="color: red;"><strong>Important:</strong> Please change your password immediately after first login.</p>
          <hr>
          <p>If you have any questions, please contact HR department.</p>
        `
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
    }

    employee.password = undefined;

    res.status(201).json({
      success: true,
      message: 'Employee created successfully. Login credentials sent to email.',
      data: employee
    });

  } catch (error) {
    console.error('Create employee error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create employee',
      error: error.message
    });
  }
};

exports.updateEmployee = async (req, res) => {
  try {
    const {
      fullName,
      department,
      position,
      role,
      departmentRole,
      employmentDetails,
      personalDetails
    } = req.body;

    const employee = await User.findById(req.params.id);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    if (fullName) employee.fullName = fullName;
    if (req.body.personalEmail !== undefined) employee.personalEmail = req.body.personalEmail;
    if (req.body.phoneNumber !== undefined) employee.phoneNumber = req.body.phoneNumber;
    if (department) employee.department = department;
    if (position) employee.position = position;
    if (role) employee.role = role;
    if (departmentRole) employee.departmentRole = departmentRole;

    if (personalDetails) {
      if (!employee.personalDetails) {
        employee.personalDetails = {};
      }

      const existingPersonalDetails = employee.personalDetails.toObject
        ? employee.personalDetails.toObject()
        : employee.personalDetails;

      employee.personalDetails = {
        ...existingPersonalDetails,
        ...personalDetails
      };

      employee.markModified('personalDetails');
    }

    if (employmentDetails) {
      if (!employee.employmentDetails) {
        employee.employmentDetails = {};
      }

      const existingEmploymentDetails = employee.employmentDetails.toObject
        ? employee.employmentDetails.toObject()
        : employee.employmentDetails;

      employee.employmentDetails = {
        ...existingEmploymentDetails,
        ...employmentDetails,
        salary: {
          ...(existingEmploymentDetails.salary || {}),
          ...(employmentDetails.salary || {})
        },
        bankDetails: {
          ...(existingEmploymentDetails.bankDetails || {}),
          ...(employmentDetails.bankDetails || {})
        },
        governmentIds: {
          ...(existingEmploymentDetails.governmentIds || {}),
          ...(employmentDetails.governmentIds || {})
        },
        documents: existingEmploymentDetails.documents || employee.employmentDetails.documents
      };

      employee.markModified('employmentDetails');
    }

    await employee.save();
    employee.password = undefined;

    res.status(200).json({
      success: true,
      message: 'Employee updated successfully',
      data: employee
    });

  } catch (error) {
    console.error('Update employee error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update employee',
      error: error.message
    });
  }
};

exports.updateEmployeeStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const validStatuses = ['Probation', 'Ongoing', 'On Leave', 'Suspended', 'Notice Period', 'Termination', 'End of Contract'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid employment status'
      });
    }

    const employee = await User.findById(req.params.id);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    employee.employmentDetails.employmentStatus = status;
    
    if (status === 'Terminated') {
      employee.isActive = false;
      employee.employmentDetails.terminationDate = new Date();
    }

    await employee.save();

    res.status(200).json({
      success: true,
      message: 'Employee status updated successfully',
      data: employee
    });

  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update employee status',
      error: error.message
    });
  }
};

exports.deactivateEmployee = async (req, res) => {
  try {
    const employee = await User.findById(req.params.id);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    employee.isActive = false;
    employee.employmentDetails.employmentStatus = 'Inactive';
    await employee.save();

    res.status(200).json({
      success: true,
      message: 'Employee deactivated successfully'
    });

  } catch (error) {
    console.error('Deactivate employee error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to deactivate employee',
      error: error.message
    });
  }
};

exports.getExpiringContracts = async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + parseInt(days));

    const employees = await User.find({
      role: { $ne: 'supplier' },
      'employmentDetails.contractEndDate': {
        $gte: new Date(),
        $lte: futureDate
      }
    })
      .select('-password')
      .sort('employmentDetails.contractEndDate')
      .lean();

    res.status(200).json({
      success: true,
      data: employees
    });

  } catch (error) {
    console.error('Get expiring contracts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch expiring contracts',
      error: error.message
    });
  }
};

exports.requestContractRenewal = async (req, res) => {
  try {
    const { newEndDate, contractType, notes } = req.body;

    const employee = await User.findById(req.params.id);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    try {
      const admins = await User.find({ role: 'admin', isActive: true });
      
      for (const admin of admins) {
        await sendEmail({
          to: admin.email,
          subject: 'Contract Renewal Approval Required',
          html: `
            <h2>Contract Renewal Request</h2>
            <p>A contract renewal request requires your approval:</p>
            <hr>
            <p><strong>Employee:</strong> ${employee.fullName}</p>
            <p><strong>Department:</strong> ${employee.department}</p>
            <p><strong>Position:</strong> ${employee.position}</p>
            <p><strong>Current Contract Type:</strong> ${employee.employmentDetails?.contractType}</p>
            <p><strong>Current End Date:</strong> ${new Date(employee.employmentDetails?.contractEndDate).toLocaleDateString()}</p>
            <hr>
            <p><strong>Requested New Contract Type:</strong> ${contractType}</p>
            <p><strong>Requested New End Date:</strong> ${new Date(newEndDate).toLocaleDateString()}</p>
            ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
            <hr>
            <p>Please review and approve/reject this request in the HR system.</p>
            <p><a href="${process.env.FRONTEND_URL}/admin/hr/contracts">Review Contract Renewals</a></p>
          `
        });
      }
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
    }

    res.status(200).json({
      success: true,
      message: 'Contract renewal request submitted for admin approval'
    });

  } catch (error) {
    console.error('Request renewal error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit renewal request',
      error: error.message
    });
  }
};

exports.approveContractRenewal = async (req, res) => {
  try {
    const { newEndDate, contractType, approved } = req.body;

    const employee = await User.findById(req.params.id);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    if (approved) {
      employee.employmentDetails.contractEndDate = new Date(newEndDate);
      employee.employmentDetails.contractType = contractType;
      await employee.save();

      try {
        await sendEmail({
          to: employee.email,
          subject: 'Contract Renewal Approved',
          html: `
            <h2>Contract Renewal Approved</h2>
            <p>Dear ${employee.fullName},</p>
            <p>Your employment contract has been renewed:</p>
            <p><strong>New Contract Type:</strong> ${contractType}</p>
            <p><strong>New End Date:</strong> ${new Date(newEndDate).toLocaleDateString()}</p>
            <p>Thank you for your continued service.</p>
          `
        });
      } catch (emailError) {
        console.error('Email sending failed:', emailError);
      }

      res.status(200).json({
        success: true,
        message: 'Contract renewal approved',
        data: employee
      });
    } else {
      res.status(200).json({
        success: true,
        message: 'Contract renewal rejected'
      });
    }

  } catch (error) {
    console.error('Approve renewal error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process renewal approval',
      error: error.message
    });
  }
};

exports.getEmployeeLeaveBalance = async (req, res) => {
  try {
    const employee = await User.findById(req.params.id);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    const SickLeave = require('../models/SickLeave');
    
    const leaves = await SickLeave.find({ 
      employee: req.params.id,
      status: 'approved'
    }).sort('-startDate').limit(10);

    const currentYear = new Date().getFullYear();
    const annualLeavesThisYear = leaves.filter(leave => 
      leave.leaveType === 'annual' && 
      new Date(leave.startDate).getFullYear() === currentYear
    );

    const sickLeavesThisYear = leaves.filter(leave => 
      leave.leaveType === 'sick' && 
      new Date(leave.startDate).getFullYear() === currentYear
    );

    const annualLeaveUsed = annualLeavesThisYear.reduce((sum, leave) => 
      sum + leave.numberOfDays, 0
    );
    const sickLeaveUsed = sickLeavesThisYear.reduce((sum, leave) => 
      sum + leave.numberOfDays, 0
    );

    const annualLeaveTotal = 21;
    const annualLeaveBalance = annualLeaveTotal - annualLeaveUsed;

    res.status(200).json({
      success: true,
      data: {
        annualLeave: {
          total: annualLeaveTotal,
          used: annualLeaveUsed,
          balance: annualLeaveBalance
        },
        sickLeave: {
          used: sickLeaveUsed
        },
        recentLeaves: leaves.map(leave => ({
          leaveType: leave.leaveType,
          startDate: leave.startDate,
          endDate: leave.endDate,
          numberOfDays: leave.numberOfDays,
          status: leave.status
        }))
      }
    });

  } catch (error) {
    console.error('Get leave balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leave balance',
      error: error.message
    });
  }
};

exports.getEmployeePerformance = async (req, res) => {
  try {
    const userId = req.user.userId;
    const employeeId = req.params.id;
    const user = await User.findById(userId);

    const isAdmin = ['admin', 'supply_chain', 'hr'].includes(user.role);
    const isSupervisor = user.role === 'supervisor';
    
    if (!isAdmin) {
      if (isSupervisor) {
        const supervisor = await User.findById(userId).populate('directReports', '_id');
        const isDirectReport = supervisor.directReports.some(
          report => report._id.toString() === employeeId
        );
        
        if (!isDirectReport && userId !== employeeId) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. You can only view performance data for your direct reports.'
          });
        }
      } else if (userId !== employeeId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view your own performance data.'
        });
      }
    }

    const employee = await User.findById(employeeId);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    const QuarterlyEvaluation = require('../models/QuarterlyEvaluation');
    
    const evaluations = await QuarterlyEvaluation.find({
      employee: employeeId
    })
      .populate('supervisor', 'fullName email')
      .populate('quarterlyKPI')
      .populate('behavioralEvaluation')
      .sort({ createdAt: -1 });

    const latestEvaluation = evaluations.length > 0 ? evaluations[0] : null;
    
    const avgFinalScore = evaluations.length > 0
      ? evaluations.reduce((sum, e) => sum + (e.finalScore || 0), 0) / evaluations.length
      : 0;
    
    const avgTaskScore = evaluations.length > 0
      ? evaluations.reduce((sum, e) => sum + (e.taskMetrics?.taskPerformanceScore || 0), 0) / evaluations.length
      : 0;
    
    const avgBehavioralScore = evaluations.length > 0
      ? evaluations.reduce((sum, e) => sum + (e.behavioralScore || 0), 0) / evaluations.length
      : 0;

    const byGrade = evaluations.reduce((acc, e) => {
      if (e.grade) {
        acc[e.grade] = (acc[e.grade] || 0) + 1;
      }
      return acc;
    }, {});

    let currentQuarterKPI = null;
    if (latestEvaluation && latestEvaluation.quarterlyKPI) {
      const QuarterlyKPI = require('../models/QuarterlyKPI');
      currentQuarterKPI = await QuarterlyKPI.findById(latestEvaluation.quarterlyKPI);
    }

    let kpiAchievement = null;
    if (latestEvaluation && latestEvaluation.taskMetrics?.kpiAchievement) {
      const kpiData = latestEvaluation.taskMetrics.kpiAchievement;
      const totalWeight = kpiData.reduce((sum, kpi) => sum + kpi.kpiWeight, 0);
      const weightedAchievement = kpiData.reduce((sum, kpi) => sum + kpi.weightedScore, 0);

      kpiAchievement = {
        overallAchievement: Math.round(weightedAchievement),
        totalKPIs: kpiData.length,
        kpiBreakdown: kpiData.map(kpi => ({
          title: kpi.kpiTitle,
          weight: kpi.kpiWeight,
          tasksCompleted: kpi.tasksCompleted,
          averageGrade: kpi.averageGrade,
          achievedScore: kpi.achievedScore,
          weightedScore: kpi.weightedScore
        }))
      };
    }

    const performanceTrend = evaluations.slice(0, 4).map(evaluation => ({
      quarter: evaluation.quarter,
      finalScore: evaluation.finalScore,
      grade: evaluation.grade,
      taskPerformance: evaluation.taskMetrics?.taskPerformanceScore || 0,
      behavioralScore: evaluation.behavioralScore,
      performanceLevel: evaluation.performanceLevel
    }));

    res.status(200).json({
      success: true,
      data: {
        latestEvaluation: latestEvaluation ? {
          id: latestEvaluation._id,
          evaluationDate: latestEvaluation.createdAt,
          quarter: latestEvaluation.quarter,
          overallScore: latestEvaluation.finalScore,
          rating: latestEvaluation.grade,
          performanceLevel: latestEvaluation.performanceLevel,
          status: latestEvaluation.status,
          taskPerformanceScore: latestEvaluation.taskMetrics?.taskPerformanceScore || 0,
          behavioralScore: latestEvaluation.behavioralScore,
          supervisor: latestEvaluation.supervisor ? {
            id: latestEvaluation.supervisor._id,
            name: latestEvaluation.supervisor.fullName
          } : null
        } : null,
        allEvaluations: evaluations.map(e => ({
          id: e._id,
          quarter: e.quarter,
          finalScore: e.finalScore,
          grade: e.grade,
          performanceLevel: e.performanceLevel,
          status: e.status,
          createdAt: e.createdAt
        })),
        averageScores: {
          finalScore: Math.round(avgFinalScore * 10) / 10,
          taskPerformance: Math.round(avgTaskScore * 10) / 10,
          behavioral: Math.round(avgBehavioralScore * 10) / 10
        },
        totalEvaluations: evaluations.length,
        byGrade,
        kpiAchievement,
        performanceTrend,
        currentQuarterKPI: currentQuarterKPI ? {
          quarter: currentQuarterKPI.quarter,
          status: currentQuarterKPI.approvalStatus,
          kpiCount: currentQuarterKPI.kpis?.length || 0
        } : null
      }
    });

  } catch (error) {
    console.error('Get performance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch performance data',
      error: error.message
    });
  }
};

exports.exportEmployees = async (req, res) => {
  try {
    const {
      search = '',
      department = '',
      status = '',
      contractType = ''
    } = req.query;

    const query = { role: { $ne: 'supplier' } };

    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    if (department) query.department = department;
    if (status) query['employmentDetails.employmentStatus'] = status;
    if (contractType) query['employmentDetails.contractType'] = contractType;

    const employees = await User.find(query)
      .select('-password')
      .sort('fullName')
      .lean();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Employees');

    worksheet.columns = [
      { header: 'Employee ID', key: 'employeeId', width: 15 },
      { header: 'Full Name', key: 'fullName', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Position', key: 'position', width: 25 },
      { header: 'Contract Type', key: 'contractType', width: 20 },
      { header: 'Employment Status', key: 'employmentStatus', width: 20 },
      { header: 'Start Date', key: 'startDate', width: 15 },
      { header: 'Contract End Date', key: 'contractEndDate', width: 15 },
      { header: 'Salary', key: 'salary', width: 15 },
      { header: 'CNPS Number', key: 'cnpsNumber', width: 20 },
      { header: 'Taxpayer Number', key: 'taxPayerNumber', width: 20 }
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    worksheet.getRow(1).font = { color: { argb: 'FFFFFFFF' }, bold: true };

    employees.forEach(emp => {
      worksheet.addRow({
        employeeId: emp.employmentDetails?.employeeId || '',
        fullName: emp.fullName,
        email: emp.email,
        department: emp.department,
        position: emp.position,
        contractType: emp.employmentDetails?.contractType || '',
        employmentStatus: emp.employmentDetails?.employmentStatus || '',
        startDate: emp.employmentDetails?.startDate 
          ? new Date(emp.employmentDetails.startDate).toLocaleDateString()
          : '',
        contractEndDate: emp.employmentDetails?.contractEndDate 
          ? new Date(emp.employmentDetails.contractEndDate).toLocaleDateString()
          : '',
        salary: emp.employmentDetails?.salary?.amount 
          ? `${emp.employmentDetails.salary.currency} ${emp.employmentDetails.salary.amount}`
          : '',
        cnpsNumber: emp.employmentDetails?.governmentIds?.cnpsNumber || '',
        taxPayerNumber: emp.employmentDetails?.governmentIds?.taxPayerNumber || ''
      });
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=employees-${new Date().toISOString().split('T')[0]}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Export employees error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export employees',
      error: error.message
    });
  }
};


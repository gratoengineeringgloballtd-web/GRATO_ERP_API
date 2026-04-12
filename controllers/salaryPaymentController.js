const SalaryPayment = require('../models/SalaryPayment');
const BudgetCode = require('../models/BudgetCode');
const { saveFile, STORAGE_CATEGORIES } = require('../utils/localFileStorage'); // ✅ Use local storage
const fs = require('fs');
const path = require('path');
const accountingService = require('../services/accountingService');

const createSalaryPayment = async (req, res) => {
  try {
    const { paymentPeriod, departmentPayments, description } = req.body;
    
    // Parse department payments
    const payments = JSON.parse(departmentPayments);
    
    // Validate budget codes and availability
    for (const payment of payments) {
      const budgetCode = await BudgetCode.findById(payment.budgetCode);
      
      if (!budgetCode || budgetCode.status !== 'active') {
        return res.status(400).json({
          success: false,
          message: `Budget code not found or inactive for ${payment.department}`
        });
      }
      
      const available = budgetCode.budget - budgetCode.used;
      if (available < payment.amount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient budget for ${payment.department}. Available: XAF ${available.toLocaleString()}, Required: XAF ${payment.amount.toLocaleString()}`
        });
      }
    }
    
    // Calculate total
    const totalAmount = payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
    
    // ✅ Handle file uploads - SAVE LOCALLY
    const supportingDocuments = [];
    if (req.files && req.files.length > 0) {
      console.log(`\n📎 Processing ${req.files.length} supporting document(s)...`);
      
      for (const file of req.files) {
        try {
          // ✅ Save to local storage instead of Cloudinary
          const savedFile = await saveFile(
            file, 
            'salary-payments',  // Category
            'documents',        // Subfolder
            null                // Auto-generate filename
          );
          
          supportingDocuments.push({
            name: file.originalname,
            url: savedFile.url,              // ✅ Local URL: /uploads/salary-payments/documents/...
            publicId: savedFile.publicId,    // ✅ Filename (not Cloudinary ID)
            size: savedFile.bytes,
            mimetype: file.mimetype,
            uploadedAt: new Date()
          });
          
          console.log(`   ✅ Saved: ${file.originalname} → ${savedFile.url}`);
          
        } catch (error) {
          console.error(`   ❌ Failed to save ${file.originalname}:`, error.message);
          // Continue with other files even if one fails
        }
      }
      
      console.log(`✅ Saved ${supportingDocuments.length}/${req.files.length} document(s)\n`);
    }
    
    // Create salary payment
    const salaryPayment = await SalaryPayment.create({
      paymentPeriod: JSON.parse(paymentPeriod),
      departmentPayments: payments,
      totalAmount,
      description,
      supportingDocuments,
      submittedBy: req.user._id,
      status: 'processed',
      processedAt: new Date()
    });
    
    // Update budget codes
    for (const payment of payments) {
      await BudgetCode.findByIdAndUpdate(
        payment.budgetCode,
        { $inc: { used: payment.amount } }
      );
    }

    try {
      await accountingService.ensureDefaultChart();
      await accountingService.postSalaryPayment(salaryPayment._id, req.user.userId);
      console.log('✅ Accounting posted for salary payment');
    } catch (accountingError) {
      console.error('⚠️ Accounting auto-post skipped for salary payment:', accountingError.message);
    }
    
    const populated = await SalaryPayment.findById(salaryPayment._id)
      .populate('submittedBy', 'fullName email')
      .populate('departmentPayments.budgetCode', 'code name budget used');
    
    res.status(201).json({
      success: true,
      message: 'Salary payment processed successfully',
      data: populated,
      metadata: {
        totalAmount,
        departmentCount: payments.length,
        documentsUploaded: supportingDocuments.length
      }
    });
    
  } catch (error) {
    console.error('Create salary payment error:', error);
    
    // ✅ Cleanup uploaded files on error
    if (req.files && req.files.length > 0) {
      const { deleteFiles } = require('../utils/localFileStorage');
      await deleteFiles(req.files.map(f => ({ localPath: f.path })));
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to process salary payment',
      error: error.message
    });
  }
};

// Keep other functions unchanged
const getAllSalaryPayments = async (req, res) => {
  try {
    const { year, month, department, status } = req.query;
    
    const filter = {};
    
    if (year) filter['paymentPeriod.year'] = parseInt(year);
    if (month) filter['paymentPeriod.month'] = parseInt(month);
    if (status) filter.status = status;
    if (department) filter['departmentPayments.department'] = department;
    
    const salaryPayments = await SalaryPayment.find(filter)
      .populate('submittedBy', 'fullName email')
      .populate('departmentPayments.budgetCode', 'code name')
      .sort({ processedAt: -1 });
    
    res.json({
      success: true,
      data: salaryPayments,
      count: salaryPayments.length
    });
    
  } catch (error) {
    console.error('Get salary payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch salary payments',
      error: error.message
    });
  }
};

const getSalaryPaymentById = async (req, res) => {
  try {
    const salaryPayment = await SalaryPayment.findById(req.params.id)
      .populate('submittedBy', 'fullName email department')
      .populate('departmentPayments.budgetCode', 'code name budget used department');
    
    if (!salaryPayment) {
      return res.status(404).json({
        success: false,
        message: 'Salary payment not found'
      });
    }
    
    res.json({
      success: true,
      data: salaryPayment
    });
    
  } catch (error) {
    console.error('Get salary payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch salary payment',
      error: error.message
    });
  }
};

const getDashboardStats = async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    
    const [
      currentMonthTotal,
      yearToDateTotal,
      recentPayments
    ] = await Promise.all([
      SalaryPayment.aggregate([
        {
          $match: {
            'paymentPeriod.year': currentYear,
            'paymentPeriod.month': currentMonth,
            status: 'processed'
          }
        },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      SalaryPayment.aggregate([
        {
          $match: {
            'paymentPeriod.year': currentYear,
            status: 'processed'
          }
        },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      SalaryPayment.find({ status: 'processed' })
        .sort({ processedAt: -1 })
        .limit(5)
        .select('paymentPeriod totalAmount departmentPayments processedAt')
    ]);
    
    res.json({
      success: true,
      data: {
        currentMonth: currentMonthTotal[0]?.total || 0,
        yearToDate: yearToDateTotal[0]?.total || 0,
        recentPayments
      }
    });
    
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard stats',
      error: error.message
    });
  }
};

const downloadDocument = async (req, res) => {
  try {
    const { id, documentIndex } = req.params;
    
    const salaryPayment = await SalaryPayment.findById(id);
    
    if (!salaryPayment) {
      return res.status(404).json({
        success: false,
        message: 'Salary payment not found'
      });
    }
    
    const document = salaryPayment.supportingDocuments[parseInt(documentIndex)];
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    // Get file path
    const filePath = path.join(process.cwd(), document.url);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found on server'
      });
    }
    
    // Set headers
    res.setHeader('Content-Type', document.mimetype);
    res.setHeader('Content-Disposition', `attachment; filename="${document.name}"`);
    
    // Stream file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
  } catch (error) {
    console.error('Download document error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download document',
      error: error.message
    });
  }
};


module.exports = {
  createSalaryPayment,
  getAllSalaryPayments,
  getSalaryPaymentById,
  getDashboardStats,
  downloadDocument 
};










// const SalaryPayment = require('../models/SalaryPayment');
// const BudgetCode = require('../models/BudgetCode');
// const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');
// const fs = require('fs');


// const createSalaryPayment = async (req, res) => {
//   try {
//     const { paymentPeriod, departmentPayments, description } = req.body;
    
//     // Parse department payments
//     const payments = JSON.parse(departmentPayments);
    
//     // Validate budget codes and availability
//     for (const payment of payments) {
//       const budgetCode = await BudgetCode.findById(payment.budgetCode);
      
//       if (!budgetCode || budgetCode.status !== 'active') {
//         return res.status(400).json({
//           success: false,
//           message: `Budget code not found or inactive for ${payment.department}`
//         });
//       }
      
//       const available = budgetCode.budget - budgetCode.used;
//       if (available < payment.amount) {
//         return res.status(400).json({
//           success: false,
//           message: `Insufficient budget for ${payment.department}. Available: XAF ${available.toLocaleString()}, Required: XAF ${payment.amount.toLocaleString()}`
//         });
//       }
//     }
    
//     // Calculate total
//     const totalAmount = payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
    
//     // Handle file uploads
//     const supportingDocuments = [];
//     if (req.files && req.files.length > 0) {
//       for (const file of req.files) {
//         try {
//           const result = await uploadToCloudinary(file.path, 'salary-payments');
//           supportingDocuments.push({
//             name: file.originalname,
//             url: result.secure_url,
//             publicId: result.public_id,
//             size: file.size,
//             mimetype: file.mimetype,
//             uploadedAt: new Date()
//           });
//           fs.unlinkSync(file.path);
//         } catch (error) {
//           console.error('File upload error:', error);
//         }
//       }
//     }
    
//     // Create salary payment
//     const salaryPayment = await SalaryPayment.create({
//       paymentPeriod: JSON.parse(paymentPeriod),
//       departmentPayments: payments,
//       totalAmount,
//       description,
//       supportingDocuments,
//       submittedBy: req.user._id,
//       status: 'processed',
//       processedAt: new Date()
//     });
    
//     // Update budget codes
//     for (const payment of payments) {
//       await BudgetCode.findByIdAndUpdate(
//         payment.budgetCode,
//         { $inc: { used: payment.amount } }
//       );
//     }
    
//     const populated = await SalaryPayment.findById(salaryPayment._id)
//       .populate('submittedBy', 'fullName email')
//       .populate('departmentPayments.budgetCode', 'code name budget used');
    
//     res.status(201).json({
//       success: true,
//       message: 'Salary payment processed successfully',
//       data: populated,
//       metadata: {
//         totalAmount,
//         departmentCount: payments.length,
//         documentsUploaded: supportingDocuments.length
//       }
//     });
    
//   } catch (error) {
//     console.error('Create salary payment error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to process salary payment',
//       error: error.message
//     });
//   }
// };


// const getAllSalaryPayments = async (req, res) => {
//   try {
//     const { year, month, department, status } = req.query;
    
//     const filter = {};
    
//     if (year) filter['paymentPeriod.year'] = parseInt(year);
//     if (month) filter['paymentPeriod.month'] = parseInt(month);
//     if (status) filter.status = status;
//     if (department) filter['departmentPayments.department'] = department;
    
//     const salaryPayments = await SalaryPayment.find(filter)
//       .populate('submittedBy', 'fullName email')
//       .populate('departmentPayments.budgetCode', 'code name')
//       .sort({ processedAt: -1 });
    
//     res.json({
//       success: true,
//       data: salaryPayments,
//       count: salaryPayments.length
//     });
    
//   } catch (error) {
//     console.error('Get salary payments error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch salary payments',
//       error: error.message
//     });
//   }
// };

// const getSalaryPaymentById = async (req, res) => {
//   try {
//     const salaryPayment = await SalaryPayment.findById(req.params.id)
//       .populate('submittedBy', 'fullName email department')
//       .populate('departmentPayments.budgetCode', 'code name budget used department');
    
//     if (!salaryPayment) {
//       return res.status(404).json({
//         success: false,
//         message: 'Salary payment not found'
//       });
//     }
    
//     res.json({
//       success: true,
//       data: salaryPayment
//     });
    
//   } catch (error) {
//     console.error('Get salary payment error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch salary payment',
//       error: error.message
//     });
//   }
// };

// const getDashboardStats = async (req, res) => {
//   try {
//     const currentYear = new Date().getFullYear();
//     const currentMonth = new Date().getMonth() + 1;
    
//     const [
//       currentMonthTotal,
//       yearToDateTotal,
//       recentPayments
//     ] = await Promise.all([
//       SalaryPayment.aggregate([
//         {
//           $match: {
//             'paymentPeriod.year': currentYear,
//             'paymentPeriod.month': currentMonth,
//             status: 'processed'
//           }
//         },
//         { $group: { _id: null, total: { $sum: '$totalAmount' } } }
//       ]),
//       SalaryPayment.aggregate([
//         {
//           $match: {
//             'paymentPeriod.year': currentYear,
//             status: 'processed'
//           }
//         },
//         { $group: { _id: null, total: { $sum: '$totalAmount' } } }
//       ]),
//       SalaryPayment.find({ status: 'processed' })
//         .sort({ processedAt: -1 })
//         .limit(5)
//         .select('paymentPeriod totalAmount departmentPayments processedAt')
//     ]);
    
//     res.json({
//       success: true,
//       data: {
//         currentMonth: currentMonthTotal[0]?.total || 0,
//         yearToDate: yearToDateTotal[0]?.total || 0,
//         recentPayments
//       }
//     });
    
//   } catch (error) {
//     console.error('Get dashboard stats error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch dashboard stats',
//       error: error.message
//     });
//   }
// };


// //  Export all functions
// module.exports = {
//   getAllSalaryPayments,
//   createSalaryPayment,
//   getSalaryPaymentById,
//   getDashboardStats,
// };
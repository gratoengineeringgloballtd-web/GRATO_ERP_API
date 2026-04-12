const dotenv = require('dotenv');
dotenv.config();

const { initializeServer, verifyConfiguration } = require('./utils/serverInit');

initializeServer();
verifyConfiguration();

const initializeSharePointFolders = require('./utils/initializeFolders');
initializeSharePointFolders();

const { initializeStorageDirectories } = require('./utils/localFileStorage');

const express = require('express');
const http = require('http');
const path = require('path'); 
const fs = require('fs');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');

console.log('\n🔍 Loading route modules...');

const loadRoute = (routePath, routeName) => {

  try {
    const route = require(routePath);
    if (!route || typeof route !== 'function') {
      console.error(`❌ ${routeName}: Invalid export (not a function/router)`);
      console.error(`   Type: ${typeof route}`);
      console.error(`   Is Object: ${typeof route === 'object'}`);
      return null;
    }
    console.log(`✅ ${routeName}: Loaded successfully`);
    return route;
  } catch (error) {
    console.error(`❌ ${routeName}: Failed to load - ${error.message}`);
    return null;
  }
};

const authRoutes = loadRoute('./routes/authRoutes', 'authRoutes');
const pettyCashRoutes = loadRoute('./routes/pettyCashRoutes', 'pettyCashRoutes');
const cashRequestRoutes = loadRoute('./routes/cashRequestRoutes', 'cashRequestRoutes');
const invoiceRoutes = loadRoute('./routes/invoiceRoutes', 'invoiceRoutes');
const supplierRoutes = loadRoute('./routes/supplierInvoiceRoutes', 'supplierRoutes');
const purchaseRequisitionRoutes = loadRoute('./routes/purchaseRequisitionRoutes', 'purchaseRequisitionRoutes');
const vendorRoutes = loadRoute('./routes/vendorRoutes', 'vendorRoutes');
const incidentReportRoutes = loadRoute('./routes/incidentReportRoutes', 'incidentReportRoutes');
const budgetCodeRoutes = loadRoute('./routes/budgetCodeRoutes', 'budgetCodeRoutes');
const buyerRoutes = loadRoute('./routes/buyerRoutes', 'buyerRoutes');
const contractRoutes = loadRoute('./routes/contractRoutes', 'contractRoutes');
const itSupportRoutes = loadRoute('./routes/itSupportRoutes', 'itSupportRoutes');
const suggestionRoutes = loadRoute('./routes/suggestionRoutes', 'suggestionRoutes');
const leaveManagementRoutes = loadRoute('./routes/leaveManagementRoutes', 'leaveManagementRoutes');
const projectRoutes = loadRoute('./routes/projectRoutes', 'projectRoutes');
const supplierOnboardingRoutes = loadRoute('./routes/supplierOnboardingRoutes', 'supplierOnboardingRoutes');
const sharepointRoutes = loadRoute('./routes/sharepoint', 'sharepointRoutes');
const actionItemRoutes = loadRoute('./routes/actionItemRoutes', 'actionItemRoutes');
const communicationRoutes = loadRoute('./routes/communicationRoutes', 'communicationRoutes');
const quarterlyKPIRoutes = loadRoute('./routes/quarterlyKPIRoutes', 'quarterlyKPIRoutes');
const behavioralEvaluationRoutes = loadRoute('./routes/behavioralEvaluationRoutes', 'behavioralEvaluationRoutes');
const quarterlyEvaluationRoutes = loadRoute('./routes/quarterlyEvaluationRoutes', 'quarterlyEvaluationRoutes');
const inventoryRoutes = loadRoute('./routes/inventoryRoutes', 'inventoryRoutes');
const fixedAssetRoutes = loadRoute('./routes/fixedAssetRoutes', 'fixedAssetRoutes');
const supplierPerformanceRoutes = loadRoute('./routes/supplierPerformanceRoutes', 'supplierPerformanceRoutes');
const budgetTransferRoutes = loadRoute('./routes/budgetTransferRoutes', 'budgetTransferRoutes');
const enhancedUserRoutes = loadRoute('./routes/enhancedUserRoutes', 'enhancedUserRoutes');
const enhancedBehavioralRoutes = loadRoute('./routes/enhancedBehavioralEvaluationRoutes', 'enhancedBehavioralRoutes');
const scheduledReportRoutes = loadRoute('./routes/scheduledReportRoutes', 'scheduledReportRoutes');
const migrationRoutes = loadRoute('./routes/migrationRoutes', 'migrationRoutes');
const accountingRoutes = loadRoute('./routes/accountingRoutes', 'accountingRoutes');
const headApprovalRoutes = require('./routes/headApproval');
const quotationRoutes = require('./routes/quotationRoutes');
const debitNoteRoutes = require('./routes/debitNoteRoutes');
const projectPlanRoutes = require('./routes/projectPlanRoutes');
const tenderRoutes = require('./routes/tenderRoutes');
const salaryPaymentRoutes = require('./routes/salaryPaymentRoutes');
const customerRoutes = require('./routes/customerRoutes');

// Critical check for projectRoutes
if (!projectRoutes) {
  console.error('\n❌❌❌ CRITICAL: projectRoutes is NULL/UNDEFINED! ❌❌❌');
  console.error('The /api/projects endpoint will NOT work!');
  console.error('Check ./routes/projectRoutes.js for syntax errors\n');
} else {
  console.log('✅ projectRoutes loaded successfully, type:', typeof projectRoutes);
}

console.log('✅ Route loading complete\n');

const { upload, handleMulterError } = require('./middlewares/uploadMiddleware');
const connectDB = require('./config/db');
const swaggerSpec = require('./swagger');
const socketService = require('./services/socketService');
const releaseStaleReservationsJob = require('./jobs/releaseStaleReservations');
const { initializeScheduledReports } = require('./services/scheduledReportService');
const { scheduleBudgetAlerts } = require('./services/budgetNotificationService');
const { initializeScheduledMessagesCron } = require('./utils/scheduledMessagesCron');
const cron = require('node-cron');

const app = express();

const server = http.createServer(app);
socketService.initialize(server);

connectDB();

initializeScheduledMessagesCron();

// CORS Configuration
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      process.env.CLIENT_URL || 'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://localhost:5173', 
      'http://127.0.0.1:5173'
    ];
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); 
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with'],
  preflightContinue: false,
  optionsSuccessStatus: 200
}));

const ensureUploadDirectories = async () => {
  console.log('\n🗂️  Initializing upload directories...');
  
  try {
    await initializeStorageDirectories();
    console.log('✅ Local file storage directories initialized');
    
    const legacyDirectories = [
      path.join(__dirname, 'uploads/temp'),
      path.join(__dirname, 'uploads/hr-documents'),
      path.join(__dirname, 'uploads/documents'),
      path.join(__dirname, 'uploads/employee-documents'),
      path.join(__dirname, 'uploads/it-support'),
      path.join(__dirname, 'uploads/pdfs'),
      path.join(__dirname, 'uploads/exports')
    ];

    console.log('\n🗂️  Ensuring legacy directories exist...');
    
    legacyDirectories.forEach(dir => {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
          console.log(`   ✅ Created: ${dir}`);
        } else {
          fs.accessSync(dir, fs.constants.W_OK);
          console.log(`   ✓ Exists: ${dir}`);
        }
      } catch (error) {
        console.error(`   ❌ Failed to setup ${dir}:`, error.message);
      }
    });
    
    console.log('✅ All upload directories ready\n');
  } catch (error) {
    console.error('❌ Failed to initialize storage directories:', error);
  }
};

// Cron jobs
cron.schedule('0 8 * * *', async () => {
  try {
    console.log('=== RUNNING DAILY TASK REMINDERS ===');
    const User = require('./models/User');
    const ActionItem = require('./models/ActionItem');
    const { sendActionItemEmail } = require('./services/emailService');
    
    const users = await User.find({ isActive: true }).select('_id email fullName');
    
    for (const user of users) {
      const tasks = await ActionItem.find({
        assignedTo: user._id,
        status: { $nin: ['Completed'] }
      }).sort({ dueDate: 1 });

      if (tasks.length > 0) {
        await sendActionItemEmail.dailyTaskSummary(
          user.email,
          user.fullName,
          tasks
        ).catch(err => console.error(`Failed to send summary to ${user.email}:`, err));
      }
    }

    console.log('✅ Daily task reminders sent');
  } catch (error) {
    console.error('❌ Error in daily task reminders:', error);
  }
});

cron.schedule('0 9 * * *', async () => {
  try {
    console.log('=== CHECKING OVERDUE TASKS ===');
    const ActionItem = require('./models/ActionItem');
    const { sendActionItemEmail } = require('./services/emailService');
    
    const overdueTasks = await ActionItem.find({
      status: { $nin: ['Completed'] },
      dueDate: { $lt: new Date() }
    }).populate('assignedTo', 'email fullName');

    for (const task of overdueTasks) {
      await sendActionItemEmail.taskOverdue(
        task.assignedTo.email,
        task.assignedTo.fullName,
        task.title,
        task.dueDate,
        task._id
      ).catch(err => console.error(`Failed to send overdue notification:`, err));
    }

    console.log(`✅ Sent ${overdueTasks.length} overdue notifications`);
  } catch (error) {
    console.error('❌ Error checking overdue tasks:', error);
  }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
    } else if (filePath.match(/\.(jpg|jpeg|png|gif)$/i)) {
      res.setHeader('Content-Type', 'image/' + path.extname(filePath).substring(1));
    } else if (filePath.match(/\.(doc|docx)$/i)) {
      res.setHeader('Content-Type', 'application/msword');
    } else if (filePath.match(/\.(xls|xlsx)$/i)) {
      res.setHeader('Content-Type', 'application/vnd.ms-excel');
    }
  }
}));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  if (req.files) {
    console.log('Files:', Object.keys(req.files));
  }
  next();
});

console.log('\n🚀 Mounting API routes...');

// Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec.specs));

// Mount all routes with proper checks
if (authRoutes) {
  app.use('/api/auth', authRoutes);
  console.log('✅ Mounted: /api/auth');
}

if (pettyCashRoutes) {
  app.use('/api/petty-cash', pettyCashRoutes);
  console.log('✅ Mounted: /api/petty-cash');
}

if (cashRequestRoutes) {
  app.use('/api/cash-requests', cashRequestRoutes);
  console.log('✅ Mounted: /api/cash-requests');
}

if (invoiceRoutes) {
  app.use('/api/invoices', invoiceRoutes);
  console.log('✅ Mounted: /api/invoices');
}

if (supplierRoutes) {
  app.use('/api/suppliers', supplierRoutes);
  console.log('✅ Mounted: /api/suppliers');
}

if (customerRoutes) {
  app.use('/api/customers', customerRoutes);
  console.log('✅ Mounted: /api/customers');
}

if (purchaseRequisitionRoutes) {
  app.use('/api/purchase-requisitions', purchaseRequisitionRoutes);
  console.log('✅ Mounted: /api/purchase-requisitions');
}

if (incidentReportRoutes) {
  app.use('/api/incident-reports', incidentReportRoutes);
  console.log('✅ Mounted: /api/incident-reports');
}

try {
  app.use('/api/files', require('./routes/fileRoutes'));
  console.log('✅ Mounted: /api/files');
} catch (e) {
  console.error('❌ Failed to mount /api/files:', e.message);
}

try {
  app.use('/api/items', require('./routes/itemsRoutes'));
  console.log('✅ Mounted: /api/items');
} catch (e) {
  console.error('❌ Failed to mount /api/items:', e.message);
}

if (budgetCodeRoutes) {
  app.use('/api/budget-codes', budgetCodeRoutes);
  console.log('✅ Mounted: /api/budget-codes');
}

if (buyerRoutes) {
  // app.use('/api/buyer', buyerRoutes);
  app.use('/api/buyer', require('./routes/buyerRoutes'));
  console.log('✅ Mounted: /api/buyer');
}

if (contractRoutes) {
  app.use('/api/contracts', contractRoutes);
  console.log('✅ Mounted: /api/contracts');
}

if (itSupportRoutes) {
  app.use('/api/it-support', itSupportRoutes);
  console.log('✅ Mounted: /api/it-support');
}

if (suggestionRoutes) {
  app.use('/api/suggestions', suggestionRoutes);
  console.log('✅ Mounted: /api/suggestions');
}

if (leaveManagementRoutes) {
  app.use('/api/leave', leaveManagementRoutes);
  console.log('✅ Mounted: /api/leave');
}

// ========== PROJECT ROUTES - CRITICAL SECTION ==========
if (projectRoutes) {
  app.use('/api/projects', projectRoutes);
  console.log('✅ Mounted: /api/projects (includes all sub-milestone routes)');
} else {
  console.error('❌ FAILED to mount /api/projects - projectRoutes is null/undefined!');
}

if (supplierOnboardingRoutes) {
  app.use('/api/supplier-onboarding', supplierOnboardingRoutes);
  console.log('✅ Mounted: /api/supplier-onboarding');
}

if (sharepointRoutes) {
  app.use('/api/sharepoint', sharepointRoutes);
  console.log('✅ Mounted: /api/sharepoint');
}

if (actionItemRoutes) {
  app.use('/api/action-items', actionItemRoutes);
  console.log('✅ Mounted: /api/action-items');
}

if (communicationRoutes) {
  app.use('/api/communications', communicationRoutes);
  console.log('✅ Mounted: /api/communications');
}

if (quarterlyKPIRoutes) {
  app.use('/api/kpis', quarterlyKPIRoutes);
  console.log('✅ Mounted: /api/kpis');
}

if (behavioralEvaluationRoutes) {
  app.use('/api/behavioral-evaluations', behavioralEvaluationRoutes);
  console.log('✅ Mounted: /api/behavioral-evaluations');
}

if (quarterlyEvaluationRoutes) {
  app.use('/api/quarterly-evaluations', quarterlyEvaluationRoutes);
  console.log('✅ Mounted: /api/quarterly-evaluations');
}

if (inventoryRoutes) {
  app.use('/api/inventory', inventoryRoutes);
  console.log('✅ Mounted: /api/inventory');
}

if (fixedAssetRoutes) {
  app.use('/api/fixed-assets', fixedAssetRoutes);
  console.log('✅ Mounted: /api/fixed-assets');
}

if (supplierPerformanceRoutes) {
  app.use('/api/supplier-performance', supplierPerformanceRoutes);
  console.log('✅ Mounted: /api/supplier-performance');
}

if (enhancedUserRoutes) {
  app.use('/api/enhanced-users', enhancedUserRoutes);
  console.log('✅ Mounted: /api/enhanced-users');
}

if (enhancedBehavioralRoutes) {
  app.use('/api/enhanced-behavioral-evaluations', enhancedBehavioralRoutes);
  console.log('✅ Mounted: /api/enhanced-behavioral-evaluations');
}

if (migrationRoutes) {
  app.use('/api/migration', migrationRoutes);
  console.log('✅ Mounted: /api/migration');
}

if (scheduledReportRoutes) {
  app.use('/api/scheduled-reports', scheduledReportRoutes);
  console.log('✅ Mounted: /api/scheduled-reports');
}

if (accountingRoutes) {
  app.use('/api/accounting', accountingRoutes);
  console.log('✅ Mounted: /api/accounting');
}

if (budgetTransferRoutes) {
  app.use('/api/budget-transfers', budgetTransferRoutes);
  console.log('✅ Mounted: /api/budget-transfers');
}

if (headApprovalRoutes) {
  app.use('/api/head-approval', headApprovalRoutes);
  console.log('✅ Mounted: /api/head-approval');
}

if (quotationRoutes) {
  app.use('/api/quotations', quotationRoutes);
  console.log('✅ Mounted: /api/quotaions');
}

if (debitNoteRoutes) {
  app.use('/api/debit-notes', debitNoteRoutes);
  console.log('✅ Mounted: /api/debit-notes');
}

if (buyerRoutes) {
  app.use('/api/project-plans', require('./routes/projectPlanRoutes'));
  console.log('✅ Mounted: /api/project-plans');
}

app.use('/api/project-plans', projectPlanRoutes);

app.use('/api/tenders', tenderRoutes);

// app.use('/api/salary-payments', salaryPaymentRoutes);

if (salaryPaymentRoutes) {
  app.use('/api/salary-payments', salaryPaymentRoutes);
  console.log('✅ Mounted: /api/salary-payments');
} else {
  console.error('❌ Failed to load salaryPaymentRoutes');
}

try {
  app.use('/api/hr', require('./routes/hrRoutes'));
  console.log('✅ Mounted: /api/hr');
} catch (e) {
  console.error('❌ Failed to mount /api/hr:', e.message);
}

console.log('✅ Route mounting complete\n');

// Multer error handling
app.use(handleMulterError);

// Initialize directories and run migration
(async () => {
  try {
    await ensureUploadDirectories();
    
    console.log('\n🔧 Checking for projects needing migration...');
    try {
      const Project = require('./models/Project');
      const projectsNeedingFix = await Project.countDocuments({
        $or: [
          { approvalStatus: { $exists: false } },
          { approvalStatus: null }
        ]
      });

      if (projectsNeedingFix > 0) {
        console.log(`⚠️  Found ${projectsNeedingFix} projects without approvalStatus`);
        console.log('🔄 Running migration...');
        
        const { fixExistingProjects } = require('./scripts/fixExistingProjects');
        await fixExistingProjects();
        
        console.log('✅ Migration completed');
      } else {
        console.log('✅ All projects have approvalStatus');
      }
    } catch (migrationError) {
      console.error('⚠️  Migration error (non-fatal):', migrationError.message);
    }
    
    console.log('✅ Server initialization complete');
  } catch (error) {
    console.error('❌ Server initialization error:', error);
  }
})();

releaseStaleReservationsJob.start();
scheduleBudgetAlerts();
initializeScheduledReports();

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  
  // Cleanup uploaded files on error
  if (req.files) {
    const cleanupFiles = [];
    
    if (Array.isArray(req.files)) {
      cleanupFiles.push(...req.files);
    } else if (typeof req.files === 'object') {
      Object.values(req.files).forEach(files => {
        if (Array.isArray(files)) {
          cleanupFiles.push(...files);
        }
      });
    }
    
    cleanupFiles.forEach(file => {
      if (file.path) {
        fs.unlink(file.path, (unlinkErr) => {
          if (unlinkErr) console.warn('Failed to cleanup file:', file.path, unlinkErr.message);
        });
      }
    });
  }
  
  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: Object.values(err.errors).map(e => e.message)
    });
  }
  
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID format'
    });
  }
  
  if (err.code === 11000) {
    return res.status(400).json({
      success: false,
      message: 'Duplicate entry detected'
    });
  }
  
  // Generic error response
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler - MUST BE LAST
app.use('*', (req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

// Process error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start server
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`\n✅ Server started on port http://localhost:${PORT}`);
  console.log(`✅ Swagger UI available at http://localhost:${PORT}/api-docs\n`);
});

module.exports = app;









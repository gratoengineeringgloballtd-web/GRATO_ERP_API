const PurchaseRequisition = require('../models/PurchaseRequisition');
const PurchaseOrder = require('../models/PurchaseOrder');
const Quote = require('../models/Quote');
const Supplier = require('../models/Supplier');
const mongoose = require('mongoose');

// Get procurement analytics
const getProcurementAnalytics = async (req, res) => {
  try {
    const { 
      period = '90', 
      category,
      supplierId 
    } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    let matchFilter = {
      createdAt: { $gte: startDate }
    };

    if (category) {
      matchFilter.itemCategory = category;
    }

    // Procurement pipeline analytics
    const pipelineStats = await PurchaseRequisition.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalValue: { $sum: '$budgetXAF' },
          avgValue: { $avg: '$budgetXAF' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Category performance
    const categoryStats = await PurchaseRequisition.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: '$itemCategory',
          count: { $sum: 1 },
          totalValue: { $sum: '$budgetXAF' },
          avgProcessingTime: { $avg: '$processingTime' },
          completedCount: {
            $sum: {
              $cond: [
                { $in: ['$status', ['procurement_complete', 'delivered']] },
                1, 0
              ]
            }
          }
        }
      },
      {
        $addFields: {
          completionRate: {
            $multiply: [
              { $divide: ['$completedCount', '$count'] },
              100
            ]
          }
        }
      },
      { $sort: { totalValue: -1 } }
    ]);

    // Monthly trends
    const monthlyTrends = await PurchaseRequisition.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          requisitions: { $sum: 1 },
          totalValue: { $sum: '$budgetXAF' },
          completed: {
            $sum: {
              $cond: [
                { $in: ['$status', ['procurement_complete', 'delivered']] },
                1, 0
              ]
            }
          }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Processing time analysis
    const processingTimeStats = await PurchaseRequisition.aggregate([
      {
        $match: {
          ...matchFilter,
          status: { $in: ['procurement_complete', 'delivered'] }
        }
      },
      {
        $group: {
          _id: null,
          avgProcessingTime: { $avg: '$processingTime' },
          minProcessingTime: { $min: '$processingTime' },
          maxProcessingTime: { $max: '$processingTime' },
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        pipeline: pipelineStats,
        categories: categoryStats,
        trends: monthlyTrends,
        processingTime: processingTimeStats[0] || {},
        period: `${period} days`,
        generatedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Get procurement analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch procurement analytics',
      error: error.message
    });
  }
};

// Get supplier performance analytics
const getSupplierAnalytics = async (req, res) => {
  try {
    const { 
      period = '180',  // days
      category,
      minOrders = 3 
    } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    // Supplier performance metrics
    const supplierPerformance = await PurchaseOrder.aggregate([
      {
        $match: {
          creationDate: { $gte: startDate },
          status: { $in: ['completed', 'delivered'] }
        }
      },
      {
        $lookup: {
          from: 'suppliers',
          localField: 'supplierId',
          foreignField: '_id',
          as: 'supplier'
        }
      },
      { $unwind: '$supplier' },
      {
        $match: category ? { 'supplier.categories': category } : {}
      },
      {
        $group: {
          _id: '$supplierId',
          supplierName: { $first: '$supplier.name' },
          totalOrders: { $sum: 1 },
          totalValue: { $sum: '$totalAmount' },
          avgOrderValue: { $avg: '$totalAmount' },
          onTimeDeliveries: {
            $sum: {
              $cond: [
                '$performanceMetrics.onTimeDelivery',
                1, 0
              ]
            }
          },
          avgDeliveryVariance: { $avg: '$performanceMetrics.deliveryVariance' },
          qualityRating: { $avg: '$performanceMetrics.qualityRating' },
          supplierRating: { $avg: '$performanceMetrics.supplierRating' },
          costSavings: { $sum: '$costSavings' }
        }
      },
      {
        $match: {
          totalOrders: { $gte: parseInt(minOrders) }
        }
      },
      {
        $addFields: {
          onTimeDeliveryRate: {
            $multiply: [
              { $divide: ['$onTimeDeliveries', '$totalOrders'] },
              100
            ]
          }
        }
      },
      { $sort: { qualityRating: -1, onTimeDeliveryRate: -1 } }
    ]);

    // Quote response analytics
    const quoteAnalytics = await Quote.aggregate([
      {
        $match: {
          submissionDate: { $gte: startDate }
        }
      },
      {
        $lookup: {
          from: 'suppliers',
          localField: 'supplierId',
          foreignField: '_id',
          as: 'supplier'
        }
      },
      { $unwind: '$supplier' },
      {
        $group: {
          _id: '$supplierId',
          supplierName: { $first: '$supplier.name' },
          quotesSubmitted: { $sum: 1 },
          quotesSelected: {
            $sum: {
              $cond: [{ $eq: ['$status', 'selected'] }, 1, 0]
            }
          },
          avgResponseTime: { $avg: '$responseTime' },
          avgTotalScore: { $avg: '$evaluation.totalScore' },
          avgQualityScore: { $avg: '$evaluation.qualityScore' },
          avgCostScore: { $avg: '$evaluation.costScore' },
          avgDeliveryScore: { $avg: '$evaluation.deliveryScore' }
        }
      },
      {
        $addFields: {
          winRate: {
            $multiply: [
              { $divide: ['$quotesSelected', '$quotesSubmitted'] },
              100
            ]
          }
        }
      },
      { $sort: { avgTotalScore: -1 } }
    ]);

    // Category performance by supplier
    const categoryPerformance = await PurchaseOrder.aggregate([
      {
        $match: {
          creationDate: { $gte: startDate },
          status: { $in: ['completed', 'delivered'] }
        }
      },
      {
        $lookup: {
          from: 'purchaserequisitions',
          localField: 'requisitionId',
          foreignField: '_id',
          as: 'requisition'
        }
      },
      { $unwind: '$requisition' },
      {
        $lookup: {
          from: 'suppliers',
          localField: 'supplierId',
          foreignField: '_id',
          as: 'supplier'
        }
      },
      { $unwind: '$supplier' },
      {
        $group: {
          _id: {
            supplierId: '$supplierId',
            category: '$requisition.itemCategory'
          },
          supplierName: { $first: '$supplier.name' },
          category: { $first: '$requisition.itemCategory' },
          orders: { $sum: 1 },
          totalValue: { $sum: '$totalAmount' },
          avgRating: { $avg: '$performanceMetrics.supplierRating' }
        }
      },
      { $sort: { totalValue: -1 } }
    ]);

    res.json({
      success: true,
      data: {
        supplierPerformance,
        quoteAnalytics,
        categoryPerformance,
        period: `${period} days`,
        minOrders: parseInt(minOrders),
        generatedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Get supplier analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch supplier analytics',
      error: error.message
    });
  }
};

// Get cost savings analytics
const getCostSavingsAnalytics = async (req, res) => {
  try {
    const { period = '365' } = req.query; // days

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    // Quote comparison savings
    const quoteSavings = await Quote.aggregate([
      {
        $match: {
          submissionDate: { $gte: startDate },
          'evaluation.evaluated': true
        }
      },
      {
        $group: {
          _id: '$requisitionId',
          quotes: {
            $push: {
              supplierId: '$supplierId',
              totalAmount: '$totalAmount',
              status: '$status'
            }
          },
          selectedQuote: {
            $first: {
              $cond: [
                { $eq: ['$status', 'selected'] },
                '$totalAmount',
                null
              ]
            }
          },
          lowestQuote: { $min: '$totalAmount' },
          avgQuote: { $avg: '$totalAmount' },
          quoteCount: { $sum: 1 }
        }
      },
      {
        $addFields: {
          savingsVsAverage: {
            $subtract: ['$avgQuote', '$selectedQuote']
          },
          savingsVsLowest: {
            $subtract: ['$lowestQuote', '$selectedQuote']
          }
        }
      },
      {
        $group: {
          _id: null,
          totalRequisitions: { $sum: 1 },
          totalSavingsVsAverage: { $sum: '$savingsVsAverage' },
          avgSavingsVsAverage: { $avg: '$savingsVsAverage' },
          totalSelectedValue: { $sum: '$selectedQuote' },
          totalAvgValue: { $sum: '$avgQuote' }
        }
      }
    ]);

    // Budget vs actual cost analysis
    const budgetAnalysis = await PurchaseRequisition.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: { $in: ['procurement_complete', 'delivered'] }
        }
      },
      {
        $lookup: {
          from: 'purchaseorders',
          localField: '_id',
          foreignField: 'requisitionId',
          as: 'purchaseOrder'
        }
      },
      { $unwind: '$purchaseOrder' },
      {
        $group: {
          _id: null,
          totalBudgeted: { $sum: '$budgetXAF' },
          totalActual: { $sum: '$purchaseOrder.actualCost' },
          count: { $sum: 1 }
        }
      },
      {
        $addFields: {
          totalSavings: { $subtract: ['$totalBudgeted', '$totalActual'] },
          savingsRate: {
            $multiply: [
              {
                $divide: [
                  { $subtract: ['$totalBudgeted', '$totalActual'] },
                  '$totalBudgeted'
                ]
              },
              100
            ]
          }
        }
      }
    ]);

    // Monthly savings trend
    const monthlySavings = await PurchaseRequisition.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: { $in: ['procurement_complete', 'delivered'] }
        }
      },
      {
        $lookup: {
          from: 'purchaseorders',
          localField: '_id',
          foreignField: 'requisitionId',
          as: 'purchaseOrder'
        }
      },
      { $unwind: '$purchaseOrder' },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          budgeted: { $sum: '$budgetXAF' },
          actual: { $sum: '$purchaseOrder.actualCost' },
          count: { $sum: 1 }
        }
      },
      {
        $addFields: {
          savings: { $subtract: ['$budgeted', '$actual'] },
          savingsRate: {
            $multiply: [
              { $divide: [{ $subtract: ['$budgeted', '$actual'] }, '$budgeted'] },
              100
            ]
          }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.json({
      success: true,
      data: {
        quoteSavings: quoteSavings[0] || {},
        budgetAnalysis: budgetAnalysis[0] || {},
        monthlySavings,
        period: `${period} days`,
        generatedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Get cost savings analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cost savings analytics',
      error: error.message
    });
  }
};

// Get delivery performance analytics
const getDeliveryPerformanceAnalytics = async (req, res) => {
  try {
    const { period = '180', supplierId } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    let matchFilter = {
      createdAt: { $gte: startDate },
      status: { $in: ['delivered', 'completed'] }
    };

    if (supplierId) {
      matchFilter.supplierId = mongoose.Types.ObjectId(supplierId);
    }

    // Overall delivery performance
    const deliveryStats = await PurchaseOrder.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          onTimeDeliveries: {
            $sum: {
              $cond: ['$performanceMetrics.onTimeDelivery', 1, 0]
            }
          },
          avgDeliveryVariance: { $avg: '$performanceMetrics.deliveryVariance' },
          totalValue: { $sum: '$totalAmount' }
        }
      },
      {
        $addFields: {
          onTimeRate: {
            $multiply: [
              { $divide: ['$onTimeDeliveries', '$totalOrders'] },
              100
            ]
          }
        }
      }
    ]);

    // Delivery performance by supplier
    const supplierDeliveryPerformance = await PurchaseOrder.aggregate([
      { $match: matchFilter },
      {
        $lookup: {
          from: 'suppliers',
          localField: 'supplierId',
          foreignField: '_id',
          as: 'supplier'
        }
      },
      { $unwind: '$supplier' },
      {
        $group: {
          _id: '$supplierId',
          supplierName: { $first: '$supplier.name' },
          totalOrders: { $sum: 1 },
          onTimeDeliveries: {
            $sum: {
              $cond: ['$performanceMetrics.onTimeDelivery', 1, 0]
            }
          },
          avgVariance: { $avg: '$performanceMetrics.deliveryVariance' },
          avgRating: { $avg: '$performanceMetrics.supplierRating' },
          totalValue: { $sum: '$totalAmount' }
        }
      },
      {
        $addFields: {
          onTimeRate: {
            $multiply: [
              { $divide: ['$onTimeDeliveries', '$totalOrders'] },
              100
            ]
          }
        }
      },
      { $sort: { onTimeRate: -1, avgRating: -1 } }
    ]);

    // Delivery issues analysis
    const issueAnalysis = await DeliveryTracking.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $project: {
          issueCount: { $size: '$issues' },
          hasIssues: { $gt: [{ $size: '$issues' }, 0] },
          status: 1,
          supplierId: 1
        }
      },
      {
        $group: {
          _id: null,
          totalDeliveries: { $sum: 1 },
          deliveriesWithIssues: {
            $sum: {
              $cond: ['$hasIssues', 1, 0]
            }
          },
          totalIssues: { $sum: '$issueCount' }
        }
      },
      {
        $addFields: {
          issueRate: {
            $multiply: [
              { $divide: ['$deliveriesWithIssues', '$totalDeliveries'] },
              100
            ]
          }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        overallStats: deliveryStats[0] || {},
        supplierPerformance: supplierDeliveryPerformance,
        issueAnalysis: issueAnalysis[0] || {},
        period: `${period} days`,
        generatedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Get delivery performance analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch delivery performance analytics',
      error: error.message
    });
  }
};

// Export procurement report
const exportProcurementReport = async (req, res) => {
  try {
    const {
      reportType = 'procurement',
      period = '90',
      format = 'json',
      category,
      supplierId
    } = req.body;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    let reportData = {};

    switch (reportType) {
      case 'procurement':
        // Generate comprehensive procurement report
        const procurementData = await generateProcurementReport(startDate, category);
        reportData = {
          title: 'Procurement Performance Report',
          period: `${period} days`,
          data: procurementData
        };
        break;

      case 'supplier':
        // Generate supplier performance report
        const supplierData = await generateSupplierReport(startDate, supplierId);
        reportData = {
          title: 'Supplier Performance Report',
          period: `${period} days`,
          data: supplierData
        };
        break;

      case 'cost_savings':
        // Generate cost savings report
        const savingsData = await generateCostSavingsReport(startDate);
        reportData = {
          title: 'Cost Savings Analysis Report',
          period: `${period} days`,
          data: savingsData
        };
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid report type'
        });
    }

    if (format === 'json') {
      res.json({
        success: true,
        report: reportData,
        generatedAt: new Date(),
        generatedBy: req.user.userId
      });
    } else {
      // For other formats (CSV, Excel), you would implement conversion logic
      res.json({
        success: true,
        message: 'Report generated successfully',
        downloadUrl: `/api/reports/download/${Date.now()}` // Mock download URL
      });
    }

  } catch (error) {
    console.error('Export procurement report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export report',
      error: error.message
    });
  }
};

// Helper function to generate procurement report
const generateProcurementReport = async (startDate, category) => {
  let matchFilter = { createdAt: { $gte: startDate } };
  if (category) matchFilter.itemCategory = category;

  const [
    statusBreakdown,
    categoryBreakdown,
    processingTimes,
    costAnalysis
  ] = await Promise.all([
    // Status breakdown
    PurchaseRequisition.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalValue: { $sum: '$budgetXAF' }
        }
      }
    ]),

    // Category breakdown
    PurchaseRequisition.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: '$itemCategory',
          count: { $sum: 1 },
          totalValue: { $sum: '$budgetXAF' },
          avgValue: { $avg: '$budgetXAF' }
        }
      }
    ]),

    // Processing times
    PurchaseRequisition.aggregate([
      {
        $match: {
          ...matchFilter,
          status: { $in: ['procurement_complete', 'delivered'] }
        }
      },
      {
        $group: {
          _id: '$itemCategory',
          avgProcessingTime: { $avg: '$processingTime' },
          count: { $sum: 1 }
        }
      }
    ]),

    // Cost analysis
    PurchaseOrder.aggregate([
      {
        $match: {
          creationDate: { $gte: startDate },
          status: { $in: ['completed', 'delivered'] }
        }
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalValue: { $sum: '$totalAmount' },
          avgValue: { $avg: '$totalAmount' },
          totalSavings: { $sum: '$costSavings' }
        }
      }
    ])
  ]);

  return {
    statusBreakdown,
    categoryBreakdown,
    processingTimes,
    costAnalysis: costAnalysis[0] || {}
  };
};

// Helper function to generate supplier report
const generateSupplierReport = async (startDate, supplierId) => {
  let matchFilter = { creationDate: { $gte: startDate } };
  if (supplierId) matchFilter.supplierId = mongoose.Types.ObjectId(supplierId);

  const [
    performanceMetrics,
    quoteAnalysis,
    deliveryPerformance
  ] = await Promise.all([
    // Performance metrics
    PurchaseOrder.aggregate([
      {
        $match: {
          ...matchFilter,
          status: { $in: ['completed', 'delivered'] }
        }
      },
      {
        $lookup: {
          from: 'suppliers',
          localField: 'supplierId',
          foreignField: '_id',
          as: 'supplier'
        }
      },
      { $unwind: '$supplier' },
      {
        $group: {
          _id: '$supplierId',
          supplierName: { $first: '$supplier.name' },
          totalOrders: { $sum: 1 },
          totalValue: { $sum: '$totalAmount' },
          avgRating: { $avg: '$performanceMetrics.supplierRating' },
          onTimeDeliveries: {
            $sum: {
              $cond: ['$performanceMetrics.onTimeDelivery', 1, 0]
            }
          }
        }
      }
    ]),

    // Quote analysis
    Quote.aggregate([
      {
        $match: {
          submissionDate: { $gte: startDate },
          ...(supplierId && { supplierId: mongoose.Types.ObjectId(supplierId) })
        }
      },
      {
        $group: {
          _id: '$supplierId',
          quotesSubmitted: { $sum: 1 },
          quotesWon: {
            $sum: {
              $cond: [{ $eq: ['$status', 'selected'] }, 1, 0]
            }
          },
          avgScore: { $avg: '$evaluation.totalScore' }
        }
      }
    ]),

    // Delivery performance
    DeliveryTracking.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          ...(supplierId && { supplierId: mongoose.Types.ObjectId(supplierId) })
        }
      },
      {
        $group: {
          _id: '$supplierId',
          totalDeliveries: { $sum: 1 },
          issuesCount: { $sum: { $size: '$issues' } }
        }
      }
    ])
  ]);

  return {
    performanceMetrics,
    quoteAnalysis,
    deliveryPerformance
  };
};

// Helper function to generate cost savings report
const generateCostSavingsReport = async (startDate) => {
  const [
    budgetVsActual,
    quoteSavings,
    categoryWiseSavings
  ] = await Promise.all([
    // Budget vs actual analysis
    PurchaseRequisition.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: { $in: ['procurement_complete', 'delivered'] }
        }
      },
      {
        $lookup: {
          from: 'purchaseorders',
          localField: '_id',
          foreignField: 'requisitionId',
          as: 'po'
        }
      },
      { $unwind: '$po' },
      {
        $group: {
          _id: '$itemCategory',
          budgeted: { $sum: '$budgetXAF' },
          actual: { $sum: '$po.actualCost' },
          count: { $sum: 1 }
        }
      },
      {
        $addFields: {
          savings: { $subtract: ['$budgeted', '$actual'] },
          savingsRate: {
            $multiply: [
              { $divide: [{ $subtract: ['$budgeted', '$actual'] }, '$budgeted'] },
              100
            ]
          }
        }
      }
    ]),

    // Quote comparison savings
    Quote.aggregate([
      {
        $match: {
          submissionDate: { $gte: startDate },
          status: 'selected'
        }
      },
      {
        $lookup: {
          from: 'quotes',
          localField: 'requisitionId',
          foreignField: 'requisitionId',
          as: 'allQuotes'
        }
      },
      {
        $addFields: {
          avgQuoteAmount: { $avg: '$allQuotes.totalAmount' },
          maxQuoteAmount: { $max: '$allQuotes.totalAmount' }
        }
      },
      {
        $group: {
          _id: null,
          totalSelected: { $sum: '$totalAmount' },
          totalAverage: { $sum: '$avgQuoteAmount' },
          totalMaximum: { $sum: '$maxQuoteAmount' },
          count: { $sum: 1 }
        }
      },
      {
        $addFields: {
          savingsVsAverage: { $subtract: ['$totalAverage', '$totalSelected'] },
          savingsVsMaximum: { $subtract: ['$totalMaximum', '$totalSelected'] }
        }
      }
    ]),

    // Category-wise savings analysis
    PurchaseRequisition.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: { $in: ['procurement_complete', 'delivered'] }
        }
      },
      {
        $lookup: {
          from: 'purchaseorders',
          localField: '_id',
          foreignField: 'requisitionId',
          as: 'po'
        }
      },
      { $unwind: '$po' },
      {
        $group: {
          _id: '$itemCategory',
          budgeted: { $sum: '$budgetXAF' },
          actual: { $sum: '$po.totalAmount' },
          savings: { $sum: '$po.costSavings' }
        }
      }
    ])
  ]);

  return {
    budgetVsActual,
    quoteSavings: quoteSavings[0] || {},
    categoryWiseSavings
  };
};

module.exports = {
  getProcurementAnalytics,
  getSupplierAnalytics,
  getCostSavingsAnalytics,
  getDeliveryPerformanceAnalytics,
  exportProcurementReport
};
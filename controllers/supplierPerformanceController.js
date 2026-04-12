const SupplierPerformance = require('../models/SupplierPerformance');
const Supplier = require('../models/Supplier');
const StockTransaction = require('../models/StockTransaction');
const User = require('../models/User');

/**
 * Create supplier performance evaluation
 */
const createEvaluation = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    
    const {
      supplierId,
      supplierName,
      evaluationPeriod,
      onTimeDeliveryRate,
      qualityRating,
      costCompliance,
      responsivenessRating,
      metrics,
      incidents,
      strengths,
      weaknesses,
      improvementAreas,
      recommendation,
      remarks,
      actionItems
    } = req.body;

    // Validate supplier exists
    const supplier = await Supplier.findById(supplierId);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    // Calculate overall score
    const overallScore = (
      parseFloat(onTimeDeliveryRate) +
      parseFloat(qualityRating) +
      parseFloat(costCompliance) +
      parseFloat(responsivenessRating)
    ) / 4;

    const evaluation = new SupplierPerformance({
      supplier: supplierId,
      supplierName: supplierName || supplier.name,
      evaluationPeriod,
      onTimeDeliveryRate: parseFloat(onTimeDeliveryRate),
      qualityRating: parseFloat(qualityRating),
      costCompliance: parseFloat(costCompliance),
      responsivenessRating: parseFloat(responsivenessRating),
      overallScore,
      metrics,
      incidents: incidents || [],
      strengths: strengths || [],
      weaknesses: weaknesses || [],
      improvementAreas: improvementAreas || [],
      recommendation: recommendation || 'approved',
      remarks,
      actionItems: actionItems || [],
      evaluatedBy: req.user.userId,
      evaluatorName: user.fullName || user.email,
      evaluationDate: new Date(),
      status: 'draft'
    });

    await evaluation.save();
    await evaluation.populate([
      { path: 'supplier', select: 'name email phone' },
      { path: 'evaluatedBy', select: 'fullName email' }
    ]);

    res.status(201).json({
      success: true,
      message: 'Supplier evaluation created successfully',
      data: evaluation
    });
  } catch (error) {
    console.error('Create evaluation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create supplier evaluation',
      error: error.message
    });
  }
};

/**
 * Get all supplier evaluations
 */
const getEvaluations = async (req, res) => {
  try {
    const {
      supplierId,
      status,
      recommendation,
      startDate,
      endDate,
      page = 1,
      limit = 20,
      sortBy = 'evaluationDate',
      sortOrder = 'desc'
    } = req.query;

    // Build filter
    let filter = {};

    if (supplierId) {
      filter.supplier = supplierId;
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (recommendation && recommendation !== 'all') {
      filter.recommendation = recommendation;
    }

    if (startDate || endDate) {
      filter['evaluationPeriod.startDate'] = {};
      if (startDate) filter['evaluationPeriod.startDate'].$gte = new Date(startDate);
      if (endDate) filter['evaluationPeriod.startDate'].$lte = new Date(endDate);
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [evaluations, total] = await Promise.all([
      SupplierPerformance.find(filter)
        .populate('supplier', 'name email phone category')
        .populate('evaluatedBy', 'fullName email')
        .populate('reviewedBy', 'fullName email')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      SupplierPerformance.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: {
        evaluations,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / parseInt(limit)),
          count: evaluations.length,
          totalRecords: total
        }
      }
    });
  } catch (error) {
    console.error('Get evaluations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch supplier evaluations',
      error: error.message
    });
  }
};

/**
 * Get supplier performance history
 */
const getSupplierPerformance = async (req, res) => {
  try {
    const { supplierId } = req.params;

    const supplier = await Supplier.findById(supplierId);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    // Get all evaluations for this supplier
    const evaluations = await SupplierPerformance.find({ supplier: supplierId })
      .sort({ 'evaluationPeriod.startDate': -1 })
      .populate('evaluatedBy', 'fullName')
      .lean();

    if (evaluations.length === 0) {
      return res.json({
        success: true,
        data: {
          supplier,
          evaluations: [],
          summary: null,
          trend: null
        }
      });
    }

    // Calculate average scores
    const avgOnTimeDelivery = evaluations.reduce((sum, e) => sum + e.onTimeDeliveryRate, 0) / evaluations.length;
    const avgQuality = evaluations.reduce((sum, e) => sum + e.qualityRating, 0) / evaluations.length;
    const avgCostCompliance = evaluations.reduce((sum, e) => sum + e.costCompliance, 0) / evaluations.length;
    const avgResponsiveness = evaluations.reduce((sum, e) => sum + e.responsivenessRating, 0) / evaluations.length;
    const avgOverall = evaluations.reduce((sum, e) => sum + e.overallScore, 0) / evaluations.length;

    // Get latest evaluation
    const latestEvaluation = evaluations[0];

    // Calculate trend (comparing latest vs average)
    const trend = {
      onTimeDelivery: latestEvaluation.onTimeDeliveryRate - avgOnTimeDelivery,
      quality: latestEvaluation.qualityRating - avgQuality,
      costCompliance: latestEvaluation.costCompliance - avgCostCompliance,
      responsiveness: latestEvaluation.responsivenessRating - avgResponsiveness,
      overall: latestEvaluation.overallScore - avgOverall
    };

    // Count incidents
    const totalIncidents = evaluations.reduce((sum, e) => sum + (e.incidents?.length || 0), 0);
    const unresolvedIncidents = evaluations.reduce((sum, e) => 
      sum + (e.incidents?.filter(i => !i.resolved).length || 0), 0);

    res.json({
      success: true,
      data: {
        supplier,
        evaluations,
        summary: {
          totalEvaluations: evaluations.length,
          averageScores: {
            onTimeDelivery: avgOnTimeDelivery.toFixed(2),
            quality: avgQuality.toFixed(2),
            costCompliance: avgCostCompliance.toFixed(2),
            responsiveness: avgResponsiveness.toFixed(2),
            overall: avgOverall.toFixed(2)
          },
          latestScore: latestEvaluation.overallScore,
          latestRecommendation: latestEvaluation.recommendation,
          totalIncidents,
          unresolvedIncidents
        },
        trend
      }
    });
  } catch (error) {
    console.error('Get supplier performance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch supplier performance',
      error: error.message
    });
  }
};

/**
 * Update evaluation
 */
const updateEvaluation = async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const updateData = req.body;

    const evaluation = await SupplierPerformance.findById(evaluationId);
    if (!evaluation) {
      return res.status(404).json({
        success: false,
        message: 'Evaluation not found'
      });
    }

    // Check if user is the evaluator or has admin rights
    const user = await User.findById(req.user.userId);
    if (evaluation.evaluatedBy.toString() !== req.user.userId && 
        !['admin', 'supply_chain'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this evaluation'
      });
    }

    // Update allowed fields
    const allowedFields = [
      'onTimeDeliveryRate', 'qualityRating', 'costCompliance', 'responsivenessRating',
      'metrics', 'incidents', 'strengths', 'weaknesses', 'improvementAreas',
      'recommendation', 'remarks', 'actionItems'
    ];

    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        evaluation[field] = updateData[field];
      }
    });

    // Recalculate overall score if ratings changed
    if (updateData.onTimeDeliveryRate || updateData.qualityRating || 
        updateData.costCompliance || updateData.responsivenessRating) {
      evaluation.overallScore = (
        evaluation.onTimeDeliveryRate +
        evaluation.qualityRating +
        evaluation.costCompliance +
        evaluation.responsivenessRating
      ) / 4;
    }

    await evaluation.save();

    res.json({
      success: true,
      message: 'Evaluation updated successfully',
      data: evaluation
    });
  } catch (error) {
    console.error('Update evaluation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update evaluation',
      error: error.message
    });
  }
};

/**
 * Submit evaluation for review
 */
const submitEvaluation = async (req, res) => {
  try {
    const { evaluationId } = req.params;

    const evaluation = await SupplierPerformance.findById(evaluationId);
    if (!evaluation) {
      return res.status(404).json({
        success: false,
        message: 'Evaluation not found'
      });
    }

    if (evaluation.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Evaluation has already been submitted'
      });
    }

    evaluation.status = 'submitted';
    await evaluation.save();

    res.json({
      success: true,
      message: 'Evaluation submitted for review',
      data: evaluation
    });
  } catch (error) {
    console.error('Submit evaluation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit evaluation',
      error: error.message
    });
  }
};

/**
 * Review evaluation (approve/reject)
 */
const reviewEvaluation = async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const { approved, reviewNotes } = req.body;

    const user = await User.findById(req.user.userId);
    
    const evaluation = await SupplierPerformance.findById(evaluationId);
    if (!evaluation) {
      return res.status(404).json({
        success: false,
        message: 'Evaluation not found'
      });
    }

    if (evaluation.status !== 'submitted') {
      return res.status(400).json({
        success: false,
        message: 'Evaluation is not awaiting review'
      });
    }

    evaluation.status = approved ? 'reviewed' : 'draft';
    evaluation.reviewedBy = req.user.userId;
    evaluation.reviewDate = new Date();
    
    if (reviewNotes) {
      evaluation.remarks = evaluation.remarks 
        ? `${evaluation.remarks}\n\nReview Notes: ${reviewNotes}`
        : `Review Notes: ${reviewNotes}`;
    }

    await evaluation.save();

    res.json({
      success: true,
      message: `Evaluation ${approved ? 'approved' : 'returned for revision'}`,
      data: evaluation
    });
  } catch (error) {
    console.error('Review evaluation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to review evaluation',
      error: error.message
    });
  }
};

/**
 * Add incident to evaluation
 */
const addIncident = async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const { date, type, description, severity } = req.body;

    const evaluation = await SupplierPerformance.findById(evaluationId);
    if (!evaluation) {
      return res.status(404).json({
        success: false,
        message: 'Evaluation not found'
      });
    }

    evaluation.incidents.push({
      date: date || new Date(),
      type,
      description,
      severity: severity || 'medium',
      resolved: false
    });

    await evaluation.save();

    res.json({
      success: true,
      message: 'Incident added to evaluation',
      data: evaluation
    });
  } catch (error) {
    console.error('Add incident error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add incident',
      error: error.message
    });
  }
};

/**
 * Resolve incident
 */
const resolveIncident = async (req, res) => {
  try {
    const { evaluationId, incidentId } = req.params;
    const { resolutionNotes } = req.body;

    const evaluation = await SupplierPerformance.findById(evaluationId);
    if (!evaluation) {
      return res.status(404).json({
        success: false,
        message: 'Evaluation not found'
      });
    }

    const incident = evaluation.incidents.id(incidentId);
    if (!incident) {
      return res.status(404).json({
        success: false,
        message: 'Incident not found'
      });
    }

    incident.resolved = true;
    incident.resolutionDate = new Date();
    incident.resolutionNotes = resolutionNotes;

    await evaluation.save();

    res.json({
      success: true,
      message: 'Incident resolved',
      data: evaluation
    });
  } catch (error) {
    console.error('Resolve incident error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resolve incident',
      error: error.message
    });
  }
};

/**
 * Get supplier rankings
 */
const getSupplierRankings = async (req, res) => {
  try {
    const { category, limit = 20 } = req.query;

    // Build aggregation pipeline
    const pipeline = [
      // Get latest evaluation for each supplier
      { $sort: { 'evaluationPeriod.startDate': -1 } },
      {
        $group: {
          _id: '$supplier',
          latestEvaluation: { $first: '$$ROOT' }
        }
      },
      { $replaceRoot: { newRoot: '$latestEvaluation' } },
      // Lookup supplier details
      {
        $lookup: {
          from: 'suppliers',
          localField: 'supplier',
          foreignField: '_id',
          as: 'supplierDetails'
        }
      },
      { $unwind: '$supplierDetails' },
      // Sort by overall score
      { $sort: { overallScore: -1 } },
      // Limit results
      { $limit: parseInt(limit) },
      // Project fields
      {
        $project: {
          supplier: '$supplierDetails._id',
          supplierName: '$supplierDetails.name',
          category: '$supplierDetails.category',
          overallScore: 1,
          onTimeDeliveryRate: 1,
          qualityRating: 1,
          costCompliance: 1,
          responsivenessRating: 1,
          recommendation: 1,
          evaluationDate: 1
        }
      }
    ];

    // Add category filter if provided
    if (category && category !== 'all') {
      pipeline.splice(3, 0, {
        $match: { 'supplierDetails.category': category }
      });
    }

    const rankings = await SupplierPerformance.aggregate(pipeline);

    // Add rank positions
    const rankedSuppliers = rankings.map((supplier, index) => ({
      ...supplier,
      rank: index + 1,
      performanceGrade: supplier.overallScore >= 90 ? 'A' :
                        supplier.overallScore >= 80 ? 'B' :
                        supplier.overallScore >= 70 ? 'C' :
                        supplier.overallScore >= 60 ? 'D' : 'F'
    }));

    res.json({
      success: true,
      data: {
        rankings: rankedSuppliers,
        summary: {
          totalSuppliers: rankedSuppliers.length,
          averageScore: rankedSuppliers.reduce((sum, s) => sum + s.overallScore, 0) / rankedSuppliers.length,
          topPerformer: rankedSuppliers[0] || null
        }
      }
    });
  } catch (error) {
    console.error('Get supplier rankings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch supplier rankings',
      error: error.message
    });
  }
};

/**
 * Auto-calculate metrics from transactions
 */
const calculateMetricsFromTransactions = async (req, res) => {
  try {
    const { supplierId, startDate, endDate } = req.body;

    // Get all inbound transactions for supplier in period
    const transactions = await StockTransaction.find({
      supplier: supplierId,
      transactionType: 'inbound',
      transactionDate: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      }
    }).populate('item', 'standardPrice');

    if (transactions.length === 0) {
      return res.json({
        success: true,
        data: {
          metrics: null,
          message: 'No transactions found for this supplier in the specified period'
        }
      });
    }

    // Calculate metrics
    const totalOrders = transactions.length;
    
    // On-time deliveries (assuming we have expected delivery dates)
    const onTimeDeliveries = transactions.filter(t => {
      // This would need actual expected delivery date comparison
      // For now, assume all completed transactions are on time
      return t.status === 'completed';
    }).length;

    // Quality issues (from inspection status)
    const qualityIssues = transactions.filter(t => 
      t.inspectionStatus === 'failed'
    ).length;

    // Price variances
    let totalPriceVariance = 0;
    transactions.forEach(t => {
      if (t.item?.standardPrice && t.unitPrice) {
        const variance = ((t.unitPrice - t.item.standardPrice) / t.item.standardPrice) * 100;
        totalPriceVariance += Math.abs(variance);
      }
    });

    const avgPriceVariance = transactions.length > 0 ? totalPriceVariance / transactions.length : 0;

    // Total value delivered
    const totalValueDelivered = transactions.reduce((sum, t) => sum + t.totalValue, 0);

    // Calculate rates
    const onTimeDeliveryRate = (onTimeDeliveries / totalOrders) * 100;
    const qualityRating = ((totalOrders - qualityIssues) / totalOrders) * 100;
    const costCompliance = Math.max(0, 100 - avgPriceVariance);

    const metrics = {
      totalOrders,
      onTimeDeliveries,
      lateDeliveries: totalOrders - onTimeDeliveries,
      qualityIssues,
      priceVariances: avgPriceVariance,
      totalValueDelivered,
      defectRate: (qualityIssues / totalOrders) * 100,
      // Calculated rates
      onTimeDeliveryRate: onTimeDeliveryRate.toFixed(2),
      qualityRating: qualityRating.toFixed(2),
      costCompliance: costCompliance.toFixed(2)
    };

    res.json({
      success: true,
      data: { metrics },
      message: 'Metrics calculated from transaction data'
    });
  } catch (error) {
    console.error('Calculate metrics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate metrics',
      error: error.message
    });
  }
};

module.exports = {
  createEvaluation,
  getEvaluations,
  getSupplierPerformance,
  updateEvaluation,
  submitEvaluation,
  reviewEvaluation,
  addIncident,
  resolveIncident,
  getSupplierRankings,
  calculateMetricsFromTransactions
};
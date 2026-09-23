const express = require('express');
const { body, validationResult } = require('express-validator');
const dataMigrationService = require('../services/dataMigrationService');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Migrate all data from Sites to normalized models
 * POST /api/data-migration/migrate-all
 */
router.post('/migrate-all', 
  authenticateToken, 
  requireRole(['admin']), 
  [
    body('dryRun').optional().isBoolean(),
    body('updateExisting').optional().isBoolean(),
    body('skipErrors').optional().isBoolean()
  ], 
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const options = {
        dryRun: req.body.dryRun || false,
        updateExisting: req.body.updateExisting || false,
        skipErrors: req.body.skipErrors !== false
      };

      logger.info('Starting full data migration', { 
        requestedBy: req.user.userId,
        options 
      });

      const results = await dataMigrationService.migrateAllFromSites(options);

      res.json({
        success: true,
        message: options.dryRun ? 'Dry run completed' : 'Migration completed',
        results: results,
        summary: {
          totalCreated: Object.values(results).reduce((sum, r) => sum + r.created, 0),
          totalUpdated: Object.values(results).reduce((sum, r) => sum + r.updated, 0),
          totalErrors: Object.values(results).reduce((sum, r) => sum + r.errors.length, 0)
        }
      });

    } catch (error) {
      logger.error('Data migration failed:', error);
      res.status(500).json({
        success: false,
        error: 'Migration failed',
        details: error.message
      });
    }
  }
);

/**
 * Migrate only clusters
 * POST /api/data-migration/migrate-clusters
 */
router.post('/migrate-clusters', 
  authenticateToken, 
  requireRole(['admin']), 
  async (req, res) => {
    try {
      const Site = require('../models/Site');
      const sites = await Site.find({}).lean();
      
      const results = await dataMigrationService.extractClusters(sites, {
        dryRun: req.body.dryRun || false,
        updateExisting: req.body.updateExisting || false
      });

      res.json({
        success: true,
        message: 'Cluster migration completed',
        results: results
      });

    } catch (error) {
      logger.error('Cluster migration failed:', error);
      res.status(500).json({
        success: false,
        error: 'Cluster migration failed',
        details: error.message
      });
    }
  }
);

/**
 * Migrate only supervisors
 * POST /api/data-migration/migrate-supervisors
 */
router.post('/migrate-supervisors', 
  authenticateToken, 
  requireRole(['admin']), 
  async (req, res) => {
    try {
      const Site = require('../models/Site');
      const sites = await Site.find({}).lean();
      
      const results = await dataMigrationService.extractSupervisors(sites, {
        dryRun: req.body.dryRun || false,
        updateExisting: req.body.updateExisting || false
      });

      res.json({
        success: true,
        message: 'Supervisor migration completed',
        results: results
      });

    } catch (error) {
      logger.error('Supervisor migration failed:', error);
      res.status(500).json({
        success: false,
        error: 'Supervisor migration failed',
        details: error.message
      });
    }
  }
);

/**
 * Migrate only technicians
 * POST /api/data-migration/migrate-technicians
 */
router.post('/migrate-technicians', 
  authenticateToken, 
  requireRole(['admin']), 
  async (req, res) => {
    try {
      const Site = require('../models/Site');
      const sites = await Site.find({}).lean();
      
      const results = await dataMigrationService.extractTechnicians(sites, {
        dryRun: req.body.dryRun || false,
        updateExisting: req.body.updateExisting || false
      });

      res.json({
        success: true,
        message: 'Technician migration completed',
        results: results
      });

    } catch (error) {
      logger.error('Technician migration failed:', error);
      res.status(500).json({
        success: false,
        error: 'Technician migration failed',
        details: error.message
      });
    }
  }
);

/**
 * Migrate only towers
 * POST /api/data-migration/migrate-towers
 */
router.post('/migrate-towers', 
  authenticateToken, 
  requireRole(['admin']), 
  async (req, res) => {
    try {
      const Site = require('../models/Site');
      const sites = await Site.find({}).lean();
      
      const results = await dataMigrationService.extractTowers(sites, {
        dryRun: req.body.dryRun || false,
        updateExisting: req.body.updateExisting || false
      });

      res.json({
        success: true,
        message: 'Tower migration completed',
        results: results
      });

    } catch (error) {
      logger.error('Tower migration failed:', error);
      res.status(500).json({
        success: false,
        error: 'Tower migration failed',
        details: error.message
      });
    }
  }
);

/**
 * Migrate only generators
 * POST /api/data-migration/migrate-generators
 */
router.post('/migrate-generators', 
  authenticateToken, 
  requireRole(['admin']), 
  async (req, res) => {
    try {
      const Site = require('../models/Site');
      const sites = await Site.find({}).lean();
      
      const results = await dataMigrationService.extractGenerators(sites, {
        dryRun: req.body.dryRun || false,
        updateExisting: req.body.updateExisting || false
      });

      res.json({
        success: true,
        message: 'Generator migration completed',
        results: results
      });

    } catch (error) {
      logger.error('Generator migration failed:', error);
      res.status(500).json({
        success: false,
        error: 'Generator migration failed',
        details: error.message
      });
    }
  }
);

/**
 * Get migration status/preview
 * GET /api/data-migration/preview
 */
router.get('/preview', 
  authenticateToken, 
  requireRole(['admin']), 
  async (req, res) => {
    try {
      const Site = require('../models/Site');
      const User = require('../models/User');
      const Cluster = require('../models/Cluster');
      const Tower = require('../models/Tower');
      const Generator = require('../models/Generator');

      // Count unique values in Sites
      const [
        totalSites,
        uniqueClusters,
        uniqueSupervisors,
        uniqueTechnicians,
        sitesWithGenerators
      ] = await Promise.all([
        Site.countDocuments({}),
        Site.distinct('GRATO_Cluster').then(clusters => clusters.filter(c => c).length),
        Site.distinct('IHS_supervisor_name').then(names => names.filter(n => n).length),
        Site.distinct('Technician_Name').then(names => names.filter(n => n).length),
        Site.countDocuments({ Generators_Details: { $exists: true, $ne: [] } })
      ]);

      // Count existing normalized data
      const [
        existingClusters,
        existingSupervisors,
        existingTechnicians,
        existingTowers,
        existingGenerators
      ] = await Promise.all([
        Cluster.countDocuments({}),
        User.countDocuments({ role: 'supervisor' }),
        User.countDocuments({ role: { $in: ['technician', 'ac'] } }),
        Tower.countDocuments({}),
        Generator.countDocuments({})
      ]);

      // Calculate total generators to be created
      const sitesWithGens = await Site.find({ 
        Generators_Details: { $exists: true, $ne: [] } 
      }).select('Generators_Details').lean();
      
      const generatorsInSites = sitesWithGens.reduce((sum, site) => 
        sum + (site.Generators_Details?.length || 0), 0
      );

      // Calculate what would be created/updated
      const toBeCreated = {
        clusters: Math.max(0, uniqueClusters - existingClusters),
        supervisors: Math.max(0, uniqueSupervisors - existingSupervisors),
        technicians: Math.max(0, uniqueTechnicians - existingTechnicians),
        towers: Math.max(0, totalSites - existingTowers),
        generators: Math.max(0, generatorsInSites - existingGenerators)
      };

      const toBeUpdated = {
        clusters: Math.min(uniqueClusters, existingClusters),
        supervisors: Math.min(uniqueSupervisors, existingSupervisors),
        technicians: Math.min(uniqueTechnicians, existingTechnicians),
        towers: Math.min(totalSites, existingTowers),
        generators: Math.min(generatorsInSites, existingGenerators)
      };

      // Get sample data
      const sampleSites = await Site.find({})
        .limit(5)
        .select('IHS_ID_SITE Site_Name GRATO_Cluster Region IHS_supervisor_name Technician_Name Generators_Details')
        .lean();

      res.json({
        success: true,
        preview: {
          sites: {
            total: totalSites,
            withGenerators: sitesWithGenerators,
            withoutGenerators: totalSites - sitesWithGenerators
          },
          toBeCreated: toBeCreated,
          toBeUpdated: toBeUpdated,
          currentState: {
            clusters: existingClusters,
            supervisors: existingSupervisors,
            technicians: existingTechnicians,
            towers: existingTowers,
            generators: existingGenerators
          },
          targetState: {
            clusters: uniqueClusters,
            supervisors: uniqueSupervisors,
            technicians: uniqueTechnicians,
            towers: totalSites,
            generators: generatorsInSites
          },
          samples: sampleSites.map(site => ({
            siteId: site.IHS_ID_SITE,
            siteName: site.Site_Name,
            cluster: site.GRATO_Cluster,
            region: site.Region,
            supervisor: site.IHS_supervisor_name,
            technician: site.Technician_Name,
            generatorCount: site.Generators_Details?.length || 0
          }))
        }
      });

    } catch (error) {
      logger.error('Preview generation failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate preview',
        details: error.message
      });
    }
  }
);

/**
 * Validate migration readiness
 * GET /api/data-migration/validate
 */
router.get('/validate', 
  authenticateToken, 
  requireRole(['admin']), 
  async (req, res) => {
    try {
      const Site = require('../models/Site');
      const User = require('../models/User');

      const validationResults = {
        passed: true,
        warnings: [],
        errors: [],
        checks: []
      };

      // Check 1: Admin user exists
      const adminExists = await User.findOne({ role: 'admin' });
      validationResults.checks.push({
        name: 'Admin User Exists',
        passed: !!adminExists,
        message: adminExists ? 'Admin user found' : 'No admin user found'
      });
      if (!adminExists) {
        validationResults.errors.push('Admin user required for migration. Please create an admin user first.');
        validationResults.passed = false;
      }

      // Check 2: Sites exist
      const sitesCount = await Site.countDocuments({});
      validationResults.checks.push({
        name: 'Sites Data Available',
        passed: sitesCount > 0,
        message: `Found ${sitesCount} sites`
      });
      if (sitesCount === 0) {
        validationResults.errors.push('No sites found to migrate');
        validationResults.passed = false;
      }

      // Check 3: Sites have required fields
      const sitesWithoutId = await Site.countDocuments({ IHS_ID_SITE: { $in: [null, ''] } });
      validationResults.checks.push({
        name: 'Site IDs Present',
        passed: sitesWithoutId === 0,
        message: sitesWithoutId > 0 ? `${sitesWithoutId} sites missing IHS_ID_SITE` : 'All sites have IDs'
      });
      if (sitesWithoutId > 0) {
        validationResults.warnings.push(`${sitesWithoutId} sites are missing IHS_ID_SITE and will be skipped`);
      }

      // Check 4: Clusters are defined
      const sitesWithoutCluster = await Site.countDocuments({ GRATO_Cluster: { $in: [null, ''] } });
      validationResults.checks.push({
        name: 'Clusters Defined',
        passed: sitesWithoutCluster === 0,
        message: sitesWithoutCluster > 0 ? `${sitesWithoutCluster} sites without cluster` : 'All sites have clusters'
      });
      if (sitesWithoutCluster > 0) {
        validationResults.warnings.push(`${sitesWithoutCluster} sites don't have cluster assignments`);
      }

      // Check 5: Coordinates present
      const sitesWithoutCoords = await Site.countDocuments({
        $or: [
          { Latitude: { $in: [null, 0] } },
          { Longitude: { $in: [null, 0] } }
        ]
      });
      validationResults.checks.push({
        name: 'Coordinates Available',
        passed: sitesWithoutCoords === 0,
        message: sitesWithoutCoords > 0 ? `${sitesWithoutCoords} sites without coordinates` : 'All sites have coordinates'
      });
      if (sitesWithoutCoords > 0) {
        validationResults.warnings.push(`${sitesWithoutCoords} sites missing coordinates. Default coordinates will be used.`);
      }

      // Check 6: Generator data quality
      const sitesWithGens = await Site.countDocuments({ 
        Generators_Details: { $exists: true, $ne: [] } 
      });
      const sitesWithGenData = await Site.find({ 
        Generators_Details: { $exists: true, $ne: [] } 
      }).select('Generators_Details').lean();
      
      let gensWithoutBrand = 0;
      let gensWithoutSerial = 0;
      sitesWithGenData.forEach(site => {
        site.Generators_Details?.forEach(gen => {
          if (!gen.brand) gensWithoutBrand++;
          if (!gen.serial_number) gensWithoutSerial++;
        });
      });

      validationResults.checks.push({
        name: 'Generator Data Quality',
        passed: gensWithoutBrand === 0 && gensWithoutSerial === 0,
        message: `${sitesWithGens} sites with generators. ${gensWithoutBrand} missing brand, ${gensWithoutSerial} missing serial numbers`
      });
      if (gensWithoutBrand > 0 || gensWithoutSerial > 0) {
        validationResults.warnings.push('Some generators have incomplete data. Default values will be used.');
      }

      res.json({
        success: true,
        validation: validationResults,
        recommendation: validationResults.passed 
          ? 'System is ready for migration. Consider running a dry run first.'
          : 'Please resolve errors before proceeding with migration.'
      });

    } catch (error) {
      logger.error('Validation failed:', error);
      res.status(500).json({
        success: false,
        error: 'Validation failed',
        details: error.message
      });
    }
  }
);

/**
 * Rollback migration (delete created records)
 * POST /api/data-migration/rollback
 */
router.post('/rollback', 
  authenticateToken, 
  requireRole(['admin']), 
  [
    body('confirm').equals('ROLLBACK').withMessage('Confirmation required: send "ROLLBACK"')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const User = require('../models/User');
      const Cluster = require('../models/Cluster');
      const Tower = require('../models/Tower');
      const Generator = require('../models/Generator');

      logger.warn('Starting migration rollback', { requestedBy: req.user.userId });

      const results = {
        deletedClusters: 0,
        deletedSupervisors: 0,
        deletedTechnicians: 0,
        deletedTowers: 0,
        deletedGenerators: 0
      };

      // Delete in reverse order of creation
      results.deletedGenerators = (await Generator.deleteMany({})).deletedCount;
      results.deletedTowers = (await Tower.deleteMany({})).deletedCount;
      
      // Don't delete admin users
      results.deletedTechnicians = (await User.deleteMany({ role: 'technician' })).deletedCount;
      results.deletedSupervisors = (await User.deleteMany({ role: 'supervisor' })).deletedCount;
      
      results.deletedClusters = (await Cluster.deleteMany({})).deletedCount;

      logger.warn('Migration rollback completed', results);

      res.json({
        success: true,
        message: 'Rollback completed successfully',
        results: results
      });

    } catch (error) {
      logger.error('Rollback failed:', error);
      res.status(500).json({
        success: false,
        error: 'Rollback failed',
        details: error.message
      });
    }
  }
);

module.exports = router
const Site = require('../models/Site');
const User = require('../models/User');
const Cluster = require('../models/Cluster');
const Tower = require('../models/Tower');
const Generator = require('../models/Generator');
const logger = require('../utils/logger');

class DataMigrationService {
  
  /**
   * Main migration function - extracts all data from Sites
   */
  async migrateAllFromSites(options = {}) {
    const {
      dryRun = false,
      updateExisting = false,
      skipErrors = true
    } = options;

    const results = {
      clusters: { created: 0, updated: 0, errors: [] },
      supervisors: { created: 0, updated: 0, errors: [] },
      technicians: { created: 0, updated: 0, errors: [] },
      towers: { created: 0, updated: 0, errors: [] },
      generators: { created: 0, updated: 0, errors: [] },
      assignments: { 
        supervisorClusters: 0, 
        supervisorTowers: 0,
        technicianClusters: 0, 
        technicianTowers: 0, 
        errors: [] 
      }
    };

    try {
      logger.info('Starting data migration from Sites...', { dryRun, updateExisting });

      const sites = await Site.find({}).lean();
      logger.info(`Found ${sites.length} sites to process`);

      // Step 1: Create Supervisors FIRST
      logger.info('=== STEP 1: Creating Supervisors ===');
      const supervisorResults = await this.extractSupervisors(sites, { dryRun, updateExisting });
      results.supervisors = supervisorResults;
      logger.info('✓ Supervisors processed', { 
        created: supervisorResults.created, 
        updated: supervisorResults.updated,
        total: Object.keys(supervisorResults.mapping || {}).length
      });

      // Step 2: Create Technicians
      logger.info('=== STEP 2: Creating Technicians ===');
      const technicianResults = await this.extractTechnicians(sites, { dryRun, updateExisting });
      results.technicians = technicianResults;
      logger.info('✓ Technicians processed', { 
        created: technicianResults.created, 
        updated: technicianResults.updated,
        total: Object.keys(technicianResults.mapping || {}).length
      });

      // Step 3: Create Clusters (with supervisor references)
      logger.info('=== STEP 3: Creating Clusters ===');
      const clusterResults = await this.extractClusters(sites, { dryRun, updateExisting });
      results.clusters = clusterResults;
      logger.info('✓ Clusters processed', { 
        created: clusterResults.created, 
        updated: clusterResults.updated,
        total: Object.keys(clusterResults.mapping || {}).length
      });

      // Step 4: Create Towers (with cluster and supervisor references)
      logger.info('=== STEP 4: Creating Towers ===');
      const towerResults = await this.extractTowers(sites, { dryRun, updateExisting });
      results.towers = towerResults;
      logger.info('✓ Towers processed', { 
        created: towerResults.created, 
        updated: towerResults.updated,
        errors: towerResults.errors.length
      });

      // Step 5: Assign Technicians and Update Supervisor Relationships
      if (!dryRun) {
        logger.info('=== STEP 5: Assigning Technicians & Updating Supervisor Relationships ===');
        const assignmentResults = await this.assignTechniciansAndUpdateSupervisors(sites);
        results.assignments = assignmentResults;
        logger.info('✓ Assignments completed', {
          supervisorClusters: assignmentResults.supervisorClusters,
          supervisorTowers: assignmentResults.supervisorTowers,
          technicianClusters: assignmentResults.technicianClusters,
          technicianTowers: assignmentResults.technicianTowers,
          errors: assignmentResults.errors.length
        });
      }

      // Step 6: Create Generators
      logger.info('=== STEP 6: Creating Generators ===');
      const generatorResults = await this.extractGenerators(sites, { dryRun, updateExisting });
      results.generators = generatorResults;
      logger.info('✓ Generators processed', { 
        created: generatorResults.created, 
        updated: generatorResults.updated
      });

      logger.info('=== MIGRATION COMPLETED SUCCESSFULLY ===', {
        totalCreated: results.clusters.created + results.supervisors.created + 
                     results.technicians.created + results.towers.created + results.generators.created,
        totalUpdated: results.clusters.updated + results.supervisors.updated + 
                     results.technicians.updated + results.towers.updated + results.generators.updated,
        totalErrors: results.clusters.errors.length + results.supervisors.errors.length + 
                    results.technicians.errors.length + results.towers.errors.length + 
                    results.generators.errors.length + results.assignments.errors.length
      });

      return results;

    } catch (error) {
      logger.error('❌ Data migration failed:', error);
      throw error;
    }
  }

  /**
   * Safely create or update a user with proper error handling
   */
  async safeCreateOrUpdateUser(userData, options = {}) {
    const { updateExisting } = options;
    const bcrypt = require('bcrypt');
    
    try {
      // Check if user exists
      let user = await User.findOne({ 
        $or: [
          { email: userData.email },
          { fullName: userData.fullName, role: userData.role }
        ]
      });

      if (user) {
        if (updateExisting) {
          // Update only safe fields (never update password on existing users)
          const updateFields = {
            phone: userData.phone,
            isActive: userData.isActive,
            department: userData.department,
            position: userData.position
          };
          
          // Add specializations only if present
          if (userData.specializations) {
            updateFields.specializations = userData.specializations;
          }
          
          user = await User.findByIdAndUpdate(
            user._id,
            { $set: updateFields },
            { new: true, runValidators: false }
          );
          
          return { user, action: 'updated' };
        }
        return { user, action: 'existing' };
      }

      // Hash password before creating user
      if (userData.password) {
        const salt = await bcrypt.genSalt(10);
        userData.password = await bcrypt.hash(userData.password, salt);
      }

      // Create new user with hashed password
      user = new User(userData);
      
      // Save without triggering pre-save hook since we already hashed
      await user.save({ validateBeforeSave: true });
      
      return { user, action: 'created' };
      
    } catch (error) {
      // Handle specific validation errors
      if (error.name === 'ValidationError') {
        const validationErrors = Object.keys(error.errors).map(key => ({
          field: key,
          message: error.errors[key].message
        }));
        
        throw new Error(`User validation failed: ${JSON.stringify(validationErrors)}`);
      }
      
      // Handle duplicate key errors
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        throw new Error(`User with this ${field} already exists`);
      }
      
      throw error;
    }
  }

  /**
   * Extract supervisors from sites
   */
  async extractSupervisors(sites, options = {}) {
    const { dryRun, updateExisting } = options;
    const results = { created: 0, updated: 0, errors: [], mapping: {} };

    const supervisorMap = new Map();
    
    for (const site of sites) {
      const supervisorName = site.SBC_Supervisor || site.IHS_supervisor_name;
      if (!supervisorName) continue;

      const name = supervisorName.trim();
      if (!supervisorMap.has(name)) {
        supervisorMap.set(name, {
          name: name,
          contact: site.SBC_Supervisor_contact || site.IHS_phone_number,
          sites: []
        });
      }
      supervisorMap.get(name).sites.push(site);
    }

    logger.info(`Found ${supervisorMap.size} unique supervisors`);

    const admin = await User.findOne({ role: 'admin' });

    for (const [name, data] of supervisorMap) {
      try {
        const email = this.generateEmail(name, 'supervisor');
        const username = this.generateUsername(name);
        const cleanPhone = this.cleanPhoneNumber(data.contact);

        const userData = {
          username,
          email,
          password: 'Supervisor@123',
          fullName: name,
          role: 'supervisor',
          isActive: true,
          phone: cleanPhone,
          department: 'Operations',
          position: 'Site Supervisor',
          createdBy: admin?._id,
          specializations: ['team_management', 'approval_workflows']
        };

        if (!dryRun) {
          const result = await this.safeCreateOrUpdateUser(userData, { updateExisting });
          
          if (result.action === 'created') {
            results.created++;
            logger.info(`  ✓ Created supervisor: ${name} (${email})`);
          } else if (result.action === 'updated') {
            results.updated++;
            logger.info(`  ↻ Updated supervisor: ${name}`);
          } else {
            logger.info(`  → Existing supervisor: ${name}`);
          }

          results.mapping[name] = result.user._id;
        } else {
          logger.info(`  [DRY RUN] Would create/update supervisor: ${name}`);
        }

      } catch (error) {
        logger.error(`  ✗ Error processing supervisor ${name}:`, error.message);
        results.errors.push({ supervisor: name, error: error.message });
      }
    }

    return results;
  }

  /**
   * Extract technicians from sites
   */
  async extractTechnicians(sites, options = {}) {
    const { dryRun, updateExisting } = options;
    const results = { created: 0, updated: 0, errors: [], mapping: {} };

    const technicianMap = new Map();
    
    for (const site of sites) {
      if (!site.Technician_Name) continue;

      const name = site.Technician_Name.trim();
      if (!technicianMap.has(name)) {
        technicianMap.set(name, {
          name,
          contact: site.Technician_Contact,
          sites: []
        });
      }
      technicianMap.get(name).sites.push(site);
    }

    logger.info(`Found ${technicianMap.size} unique technicians`);

    const admin = await User.findOne({ role: 'admin' });

    for (const [name, data] of technicianMap) {
      try {
        const email = this.generateEmail(name, 'technician');
        const username = this.generateUsername(name);
        const cleanPhone = this.cleanPhoneNumber(data.contact);

        const userData = {
          username,
          email,
          password: 'Tech@123',
          fullName: name,
          role: 'technician',
          isActive: true,
          phone: cleanPhone,
          department: 'Field Operations',
          position: 'Field Technician',
          createdBy: admin?._id,
          specializations: ['preventive_maintenance', 'generator_repair']
        };

        if (!dryRun) {
          const result = await this.safeCreateOrUpdateUser(userData, { updateExisting });
          
          if (result.action === 'created') {
            results.created++;
            logger.info(`  ✓ Created technician: ${name} (${email})`);
          } else if (result.action === 'updated') {
            results.updated++;
            logger.info(`  ↻ Updated technician: ${name}`);
          } else {
            logger.info(`  → Existing technician: ${name}`);
          }

          results.mapping[name] = result.user._id;
        } else {
          logger.info(`  [DRY RUN] Would create/update technician: ${name}`);
        }

      } catch (error) {
        logger.error(`  ✗ Error processing technician ${name}:`, error.message);
        results.errors.push({ technician: name, error: error.message });
      }
    }

    return results;
  }

  /**
   * Extract clusters from sites
   */
  async extractClusters(sites, options = {}) {
    const { dryRun, updateExisting } = options;
    const results = { created: 0, updated: 0, errors: [], mapping: {} };

    const clusterMap = new Map();
    
    for (const site of sites) {
      if (!site.GRATO_Cluster) continue;

      const clusterName = site.GRATO_Cluster.trim();
      if (!clusterMap.has(clusterName)) {
        clusterMap.set(clusterName, []);
      }
      clusterMap.get(clusterName).push(site);
    }

    logger.info(`Found ${clusterMap.size} unique clusters`);

    const admin = await User.findOne({ role: 'admin' });

    for (const [clusterName, clusterSites] of clusterMap) {
      try {
        const code = this.generateClusterCode(clusterName);
        const region = clusterSites[0]?.Region || 'Unknown';
        const coordinates = this.calculateClusterCenter(clusterSites);

        // Find supervisor for this cluster
        const supervisorName = clusterSites[0]?.SBC_Supervisor || clusterSites[0]?.IHS_supervisor_name;
        let supervisor = null;
        if (supervisorName) {
          supervisor = await User.findOne({ 
            fullName: supervisorName.trim(),
            role: 'supervisor'
          });
        }

        const clusterData = {
          name: clusterName,
          code,
          region,
          description: `Cluster in ${region} with ${clusterSites.length} sites`,
          coverage_area: {
            center: coordinates,
            radius: 25
          },
          supervisor: supervisor?._id,
          contact_info: {
            office_address: clusterSites[0]?.IHS_sup_for_hand_over || '',
            phone: clusterSites[0]?.IHS_phone_number || ''
          },
          stats: {
            total_towers: clusterSites.length,
            active_towers: clusterSites.filter(s => s.Sites_Type).length
          },
          status: 'active',
          created_by: admin?._id
        };

        if (!dryRun) {
          let cluster = await Cluster.findOne({ code });

          if (cluster && updateExisting) {
            delete clusterData.created_by;
            cluster = await Cluster.findOneAndUpdate(
              { code },
              { $set: clusterData, last_updated_by: admin?._id },
              { new: true, runValidators: true }
            );
            results.updated++;
            logger.info(`  ↻ Updated cluster: ${clusterName} (${code})`);
          } else if (!cluster) {
            cluster = new Cluster(clusterData);
            await cluster.save();
            results.created++;
            logger.info(`  ✓ Created cluster: ${clusterName} (${code})${supervisor ? ` - Supervisor: ${supervisorName}` : ''}`);

            // Update supervisor's supervisedClusters array
            if (supervisor) {
              await User.findByIdAndUpdate(supervisor._id, {
                $addToSet: { supervisedClusters: cluster._id }
              });
              logger.info(`    → Added cluster to supervisor ${supervisorName}'s supervisedClusters`);
            }
          }

          results.mapping[clusterName] = cluster._id;
        } else {
          logger.info(`  [DRY RUN] Would create/update cluster: ${clusterName}`);
        }

      } catch (error) {
        logger.error(`  ✗ Error processing cluster ${clusterName}:`, error.message);
        results.errors.push({ cluster: clusterName, error: error.message });
      }
    }

    return results;
  }

  /**
   * Extract towers from sites
   */
  async extractTowers(sites, options = {}) {
    const { dryRun, updateExisting } = options;
    const results = { created: 0, updated: 0, errors: [], mapping: {} };

    const admin = await User.findOne({ role: 'admin' });
    let processedCount = 0;

    for (const site of sites) {
      try {
        if (!site.IHS_ID_SITE) {
          logger.warn('  ⚠ Site without IHS_ID_SITE found, skipping');
          continue;
        }

        // Skip sites without cluster
        if (!site.GRATO_Cluster) {
          results.errors.push({ 
            site: site.IHS_ID_SITE, 
            error: 'Missing cluster assignment' 
          });
          continue;
        }

        const towerId = this.generateTowerId(site.IHS_ID_SITE);
        
        const cluster = await Cluster.findOne({ name: site.GRATO_Cluster });
        if (!cluster && !dryRun) {
          logger.warn(`  ⚠ Cluster '${site.GRATO_Cluster}' not found for site ${site.IHS_ID_SITE}`);
          results.errors.push({ 
            site: site.IHS_ID_SITE, 
            error: `Cluster '${site.GRATO_Cluster}' not found` 
          });
          continue;
        }

        const supervisorName = site.SBC_Supervisor || site.IHS_supervisor_name;
        const supervisor = supervisorName ? await User.findOne({ 
          fullName: supervisorName.trim(),
          role: 'supervisor'
        }) : null;

        const nextInspectionDate = new Date();
        nextInspectionDate.setDate(nextInspectionDate.getDate() + 90);

        const towerData = {
          _id: towerId,
          name: site.Site_Name || `Tower ${site.IHS_ID_SITE}`,
          location: {
            address: site.MTN_Detail || site.OCM_Detail || 'Address not provided',
            city: this.extractCity(site.Region),
            state: site.Region || 'Unknown',
            country: 'Cameroon',
            postal_code: '',
            coordinates: {
              latitude: site.Latitude || 4.0511,
              longitude: site.Longitude || 9.7679
            }
          },
          specifications: {
            height: 40,
            type: this.mapSiteTypeToTowerType(site.Sites_Type),
            foundation_type: 'concrete',
            max_load_capacity: 5000,
            wind_rating: 150
          },
          power_requirements: {
            total_load: 50,
            critical_load: 30,
            backup_time_required: 24,
            voltage_requirement: 220,
            phases: 3
          },
          site_info: {
            installation_date: site.Actual_Date_Visit || new Date('2020-01-01'),
            commissioning_date: site.Actual_Date_Visit || new Date('2020-01-01'),
            site_access: this.determineSiteAccess(site),
            security_level: 'medium'
          },
          maintenance_schedule: {
            last_inspection: site.Actual_Date_Visit || null,
            next_inspection: nextInspectionDate,
            inspection_interval: 90
          },
          cluster_id: cluster?._id,
          supervisor: supervisor?._id || cluster?.supervisor,
          tenants: this.extractTenants(site),
          status: 'active',
          created_by: admin?._id
        };

        if (!dryRun) {
          let tower = await Tower.findById(towerId);

          if (tower && updateExisting) {
            delete towerData.created_by;
            tower = await Tower.findByIdAndUpdate(
              towerId,
              { $set: towerData, last_updated_by: admin?._id },
              { new: true, runValidators: false }
            );
            results.updated++;
          } else if (!tower) {
            tower = new Tower(towerData);
            await tower.save();
            results.created++;

            await Site.findByIdAndUpdate(site._id, {
              $set: { tower_reference: tower._id }
            });
          }

          results.mapping[site.IHS_ID_SITE] = tower._id;
          processedCount++;

          if (processedCount % 50 === 0) {
            logger.info(`  → Processed ${processedCount}/${sites.length} towers...`);
          }
        } else {
          logger.info(`  [DRY RUN] Would create/update tower: ${towerId}`);
        }

      } catch (error) {
        logger.error(`  ✗ Error processing tower for site ${site.IHS_ID_SITE}:`, error.message);
        results.errors.push({ site: site.IHS_ID_SITE, error: error.message });
      }
    }

    logger.info(`  ✓ Completed processing ${processedCount} towers`);
    return results;
  }

  /**
   * Assign technicians to clusters/towers AND update supervisor relationships
   */
  async assignTechniciansAndUpdateSupervisors(sites) {
    const results = {
      supervisorClusters: 0,
      supervisorTowers: 0,
      technicianClusters: 0,
      technicianTowers: 0,
      errors: []
    };

    // === PART 1: Update Supervisor Relationships ===
    logger.info('→ Updating supervisor relationships...');
    
    const supervisors = await User.find({ role: 'supervisor' });
    
    for (const supervisor of supervisors) {
      try {
        const assignments = await this.calculateSupervisorAssignments(supervisor._id);
        const updated = await this.safeUpdateSupervisorAssignments(supervisor._id, assignments);
        
        results.supervisorClusters += updated.clusters;
        results.supervisorTowers += updated.towers;

        logger.info(`  ✓ ${supervisor.fullName}: ${updated.clusters} clusters, ${updated.towers} towers, ${updated.technicians} technicians`);

      } catch (error) {
        logger.error(`  ✗ Error updating supervisor ${supervisor.fullName}: ${error.message}`);
        results.errors.push({ 
          supervisor: supervisor.fullName, 
          error: error.message,
          phase: 'supervisor_update'
        });
      }
    }

    // === PART 2: Assign Technicians to Towers ===
    logger.info('→ Assigning technicians to towers...');

    const technicianSites = this.groupSitesByTechnician(sites);

    for (const [techName, data] of technicianSites) {
      try {
        const technician = await User.findOne({ fullName: techName, role: 'technician' });
        if (!technician) {
          logger.warn(`  ⚠ Technician not found: ${techName}`);
          continue;
        }

        const towerIds = await this.getTowerIdsForSites(data.sites);
        
        if (towerIds.length > 0) {
          const { assigned } = await this.safeAssignTechnicianToTowers(technician._id, towerIds);
          results.technicianTowers += assigned;
          logger.info(`  ✓ ${techName}: ${assigned} tower assignments (${towerIds.length} total)`);
        }

      } catch (error) {
        logger.error(`  ✗ Error in tower assignment for ${techName}: ${error.message}`);
        results.errors.push({ 
          technician: techName, 
          error: error.message,
          phase: 'tower_assignment'
        });
      }
    }

    // === PART 3: Assign Technicians to Clusters ===
    logger.info('→ Assigning technicians to clusters...');

    for (const [techName, data] of technicianSites) {
      try {
        const technician = await User.findOne({ fullName: techName, role: 'technician' });
        if (!technician) continue;

        const clusterIds = await this.getClusterIdsForClusters(data.clusters);
        
        if (clusterIds.length > 0) {
          const { assigned } = await this.safeAssignTechnicianToClusters(technician._id, clusterIds);
          results.technicianClusters += assigned;
          logger.info(`  ✓ ${techName}: ${assigned} cluster assignments (${clusterIds.length} total)`);
        }

      } catch (error) {
        logger.error(`  ✗ Error in cluster assignment for ${techName}: ${error.message}`);
        results.errors.push({ 
          technician: techName, 
          error: error.message,
          phase: 'cluster_assignment'
        });
      }
    }

    // === PART 4: Re-update Supervisors with Technician Information ===
    logger.info('→ Re-updating supervisors with technician assignments...');
    
    for (const supervisor of supervisors) {
      try {
        const technicianIds = await this.getTechnicianIdsForSupervisor(supervisor._id);

        if (technicianIds.length > 0) {
          await User.updateOne(
            { _id: supervisor._id },
            { $set: { supervisedTechnicians: technicianIds } }
          );

          logger.info(`  ✓ ${supervisor.fullName}: ${technicianIds.length} supervised technicians`);
        }

      } catch (error) {
        logger.error(`  ✗ Error re-updating supervisor ${supervisor.fullName}: ${error.message}`);
        results.errors.push({ 
          supervisor: supervisor.fullName, 
          error: error.message,
          phase: 'supervisor_technician_update'
        });
      }
    }

    return results;
  }

  /**
   * Extract generators from sites
   */
  async extractGenerators(sites, options = {}) {
    const { dryRun, updateExisting } = options;
    const results = { created: 0, updated: 0, errors: [], mapping: {} };

    const admin = await User.findOne({ role: 'admin' });

    for (const site of sites) {
      try {
        if (!site.Generators_Details || site.Generators_Details.length === 0) {
          continue;
        }

        if (!site.IHS_ID_SITE) continue;

        const towerId = this.generateTowerId(site.IHS_ID_SITE);
        const tower = await Tower.findById(towerId);
        
        if (!tower && !dryRun) {
          logger.warn(`  ⚠ Tower not found for generators at site ${site.IHS_ID_SITE}`);
          continue;
        }

        for (const genDetail of site.Generators_Details) {
          const generatorId = this.generateGeneratorId(site.IHS_ID_SITE, genDetail.generator_number);

          const generatorData = {
            _id: generatorId,
            model: genDetail.brand || 'Unknown Model',
            manufacturer: genDetail.brand || 'Unknown Manufacturer',
            serial_number: genDetail.serial_number || `SN-${generatorId}`,
            status: this.determineGeneratorStatus(site, genDetail),
            tower_id: tower?._id,
            specifications: {
              fuel_type: 'diesel',
              fuel_capacity: 1000,
              power_rating: genDetail.kva || 100,
              voltage_output: 220,
              frequency: 50,
              engine_type: 'Turbocharged Diesel',
              cooling_system: 'liquid',
              operating_temperature: {
                min: -10,
                max: 50
              }
            },
            current_stats: {
              fuel: site.Fuel_Quantity_Found || 100,
              power: genDetail.load_1ph || 0,
              runtime: genDetail.actual_running_hours || 0,
              temperature: 25,
              voltage: 220,
              current: 0,
              frequency: 50
            },
            installation_date: site.Actual_Date_Visit || new Date(),
            last_maintenance: site.Actual_Date_Visit,
            maintenance_interval: genDetail.maintenance_cycle || 250,
            total_runtime: genDetail.actual_running_hours || 0,
            created_by: admin?._id
          };

          if (!dryRun) {
            let generator = await Generator.findById(generatorId);

            if (generator && updateExisting) {
              delete generatorData.created_by;
              generator = await Generator.findByIdAndUpdate(
                generatorId,
                { $set: generatorData, last_updated_by: admin?._id },
                { new: true, runValidators: false }
              );
              results.updated++;
            } else if (!generator) {
              generator = new Generator(generatorData);
              await generator.save();
              results.created++;

              if (tower) {
                const assignmentType = genDetail.generator_number === 1 ? 'primary' : 'backup';
                await tower.assignGenerator(generator._id, assignmentType);
              }

              await Site.findByIdAndUpdate(site._id, {
                $addToSet: { Current_Generators: generator._id }
              });
            }

            results.mapping[generatorId] = generator._id;
          } else {
            logger.info(`  [DRY RUN] Would create/update generator: ${generatorId}`);
          }
        }

      } catch (error) {
        logger.error(`  ✗ Error processing generators for site ${site.IHS_ID_SITE}:`, error.message);
        results.errors.push({ site: site.IHS_ID_SITE, error: error.message });
      }
    }

    return results;
  }

  // ===== HELPER METHODS =====

  /**
   * Safe cluster assignment - handles potential casting issues
   */
  async safeAssignTechnicianToClusters(technicianId, clusterIds) {
    try {
      const validClusterIds = clusterIds.filter(id => id);
      
      if (validClusterIds.length === 0) {
        return { assigned: 0 };
      }

      await User.updateOne(
        { _id: technicianId },
        { $set: { assigned_cluster: validClusterIds[0] } },
        { runValidators: false }
      );

      let assigned = 0;
      for (const clusterId of validClusterIds) {
        const cluster = await Cluster.findById(clusterId);
        if (!cluster) continue;

        const alreadyAssigned = cluster.assigned_technicians?.some(
          at => at.technician?.toString() === technicianId.toString()
        );

        if (!alreadyAssigned) {
          await Cluster.updateOne(
            { _id: clusterId },
            {
              $addToSet: {
                assigned_technicians: {
                  technician: technicianId,
                  assigned_date: new Date(),
                  role: 'primary',
                  specializations: ['generator', 'maintenance', 'power_system']
                }
              }
            },
            { runValidators: false }
          );
          
          assigned++;
        }
      }

      return { assigned };
      
    } catch (error) {
      logger.error(`Error assigning technician to clusters:`, error);
      throw error;
    }
  }

  /**
   * Safe tower assignment - handles string IDs properly
   */
  async safeAssignTechnicianToTowers(technicianId, towerIds) {
    try {
      if (!towerIds || towerIds.length === 0) {
        return { assigned: 0 };
      }

      await User.updateOne(
        { _id: technicianId },
        { $set: { assignedTowers: towerIds } },
        { runValidators: false }
      );

      let assigned = 0;
      for (const towerId of towerIds) {
        const tower = await Tower.findById(towerId);
        if (!tower) continue;

        const alreadyAssigned = tower.assigned_technicians?.some(
          at => at.technician_id?.toString() === technicianId.toString()
        );

        if (!alreadyAssigned) {
          await Tower.updateOne(
            { _id: towerId },
            {
              $addToSet: {
                assigned_technicians: {
                  technician_id: technicianId,
                  assignment_type: 'primary',
                  assigned_date: new Date()
                }
              }
            },
            { runValidators: false }
          );
          
          assigned++;
        }
      }

      return { assigned };
      
    } catch (error) {
      logger.error(`Error assigning technician to towers:`, error);
      throw error;
    }
  }

  /**
   * Safe supervisor update - handles arrays properly
   */
  async safeUpdateSupervisorAssignments(supervisorId, assignments) {
    try {
      const { clusterIds = [], towerIds = [], technicianIds = [] } = assignments;

      await User.updateOne(
        { _id: supervisorId },
        {
          $set: {
            supervised_clusters: clusterIds,
            assignedClusters: clusterIds,
            assignedTowers: towerIds,
            supervisedTechnicians: technicianIds
          }
        },
        { runValidators: false }
      );

      return {
        clusters: clusterIds.length,
        towers: towerIds.length,
        technicians: technicianIds.length
      };
      
    } catch (error) {
      logger.error(`Error updating supervisor assignments:`, error);
      throw error;
    }
  }

  /**
   * Calculate supervisor assignments
   */
  async calculateSupervisorAssignments(supervisorId) {
    const clusters = await Cluster.find({ supervisor: supervisorId });
    
    if (clusters.length === 0) {
      return { clusterIds: [], towerIds: [], technicianIds: [] };
    }

    const clusterIds = clusters.map(c => c._id);
    const towerIds = [];
    const technicianIds = new Set();

    for (const cluster of clusters) {
      const towers = await Tower.find({ cluster_id: cluster._id });
      towers.forEach(t => towerIds.push(t._id));

      const populatedCluster = await Cluster.findById(cluster._id).lean();
      if (populatedCluster.assigned_technicians) {
        populatedCluster.assigned_technicians.forEach(at => {
          if (at.technician) {
            technicianIds.add(at.technician.toString());
          }
        });
      }
    }

    return {
      clusterIds,
      towerIds,
      technicianIds: Array.from(technicianIds)
    };
  }

  /**
   * Group sites by technician
   */
  groupSitesByTechnician(sites) {
    const technicianSites = new Map();
    
    for (const site of sites) {
      if (!site.Technician_Name || !site.GRATO_Cluster || !site.IHS_ID_SITE) {
        continue;
      }

      const techName = site.Technician_Name.trim();
      if (!technicianSites.has(techName)) {
        technicianSites.set(techName, {
          sites: [],
          clusters: new Set()
        });
      }
      technicianSites.get(techName).sites.push(site);
      technicianSites.get(techName).clusters.add(site.GRATO_Cluster);
    }

    return technicianSites;
  }

  /**
   * Get tower IDs for sites
   */
  async getTowerIdsForSites(sites) {
    const towerIds = [];
    
    for (const site of sites) {
      try {
        const towerId = this.generateTowerId(site.IHS_ID_SITE);
        const tower = await Tower.findById(towerId);
        if (tower) {
          towerIds.push(tower._id);
        }
      } catch (error) {
        logger.error(`Error getting tower for site ${site.IHS_ID_SITE}:`, error.message);
      }
    }

    return towerIds;
  }

  /**
   * Get cluster IDs for cluster names
   */
  async getClusterIdsForClusters(clusterNames) {
    const clusterIds = [];
    
    for (const clusterName of clusterNames) {
      try {
        const cluster = await Cluster.findOne({ name: clusterName });
        if (cluster) {
          clusterIds.push(cluster._id);
        }
      } catch (error) {
        logger.error(`Error getting cluster ${clusterName}:`, error.message);
      }
    }

    return clusterIds;
  }

  /**
   * Get technician IDs for a supervisor
   */
  async getTechnicianIdsForSupervisor(supervisorId) {
    const clusters = await Cluster.find({ supervisor: supervisorId }).lean();
    const technicianIds = new Set();

    for (const cluster of clusters) {
      if (cluster.assigned_technicians) {
        cluster.assigned_technicians.forEach(at => {
          if (at.technician) {
            technicianIds.add(at.technician.toString());
          }
        });
      }
    }

    return Array.from(technicianIds);
  }

  /**
   * Clean phone number - strict validation
   */
  cleanPhoneNumber(contact) {
    if (!contact) return '';
    
    const rawPhone = String(contact).trim();
    let digitsOnly = rawPhone.replace(/[^\d+]/g, '');
    
    if (digitsOnly.startsWith('+')) {
      // Keep the + at the start
    } else {
      // Remove any stray + characters
      digitsOnly = digitsOnly.replace(/\+/g, '');
    }
    
    // Final validation
    if (!/^\+?\d+$/.test(digitsOnly)) {
      return '';
    }
    
    // Must have at least 9 digits to be valid
    if (digitsOnly.replace(/\+/g, '').length < 9) {
      return '';
    }
    
    return digitsOnly;
  }

  /**
   * Generate cluster code from name
   */
  generateClusterCode(name) {
    const words = name.toUpperCase().split(/\s+/);
    if (words.length >= 2) {
      return words[0].substring(0, 3) + words[1].substring(0, 2) + '1';
    }
    return name.substring(0, 5).toUpperCase().replace(/\s/g, '') + '1';
  }

  /**
   * Calculate cluster center from site coordinates
   */
  calculateClusterCenter(sites) {
    const validSites = sites.filter(s => 
      s.Latitude && s.Longitude && s.Latitude !== 0 && s.Longitude !== 0
    );
    
    if (validSites.length === 0) {
      return { latitude: 4.0511, longitude: 9.7679 };
    }

    const avgLat = validSites.reduce((sum, s) => sum + s.Latitude, 0) / validSites.length;
    const avgLon = validSites.reduce((sum, s) => sum + s.Longitude, 0) / validSites.length;

    return { latitude: avgLat, longitude: avgLon };
  }

  /**
   * Generate email from name
   */
  generateEmail(name, role) {
    const cleanName = name.toLowerCase()
      .replace(/\s+/g, '.')
      .replace(/[^a-z0-9.]/g, '');
    return `${cleanName}@generator-mgmt.cm`;
  }

  /**
   * Generate username from name
   */
  generateUsername(name) {
    return name.toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 30);
  }

  /**
   * Generate tower ID from site ID - FIXED FORMAT
   */
  generateTowerId(siteId) {
    const cleaned = siteId.replace(/^IHS_?/, '').replace(/_/g, '');
    
    const letters = cleaned.match(/[A-Z]+/)?.[0] || 'UNK';
    const numbers = cleaned.match(/\d+/)?.[0] || '000';
    
    const letterPart = letters.substring(0, 3).padEnd(3, 'X');
    const numberPart = numbers.padStart(3, '0').slice(-3);
    
    return `TOWER${letterPart}${numberPart}`;
  }

  /**
   * Generate generator ID from site ID and generator number
   */
  generateGeneratorId(siteId, genNumber) {
    const cleaned = siteId.replace(/^IHS_?/, '').replace(/_/g, '');
    
    const letters = cleaned.match(/[A-Z]+/)?.[0] || 'UNK';
    const numbers = cleaned.match(/\d+/)?.[0] || '000';
    
    const letterPart = letters.substring(0, 3).padEnd(3, 'X');
    const numberPart = numbers.padStart(3, '0').slice(-3);
    const genPart = String(genNumber).padStart(1, '0');
    
    return `GEN${letterPart}${numberPart}${genPart}`;
  }

  /**
   * Map site type to tower type
   */
  mapSiteTypeToTowerType(siteType) {
    if (!siteType) return 'monopole';
    
    const mapping = {
      'Rooftop': 'rooftop',
      'Greenfield': 'monopole',
      'Ground': 'lattice',
      'Guyed': 'guyed',
      'Stealth': 'stealth'
    };
    
    return mapping[siteType] || 'monopole';
  }

  /**
   * Extract city from region
   */
  extractCity(region) {
    if (!region) return 'Unknown';
    
    const cityMapping = {
      'Littoral': 'Douala',
      'Centre': 'Yaoundé',
      'Ouest': 'Bafoussam',
      'Nord-Ouest': 'Bamenda',
      'Sud-Ouest': 'Buea',
      'Nord': 'Garoua',
      'Extreme-Nord': 'Maroua',
      'Sud': 'Ebolowa',
      'Est': 'Bertoua',
      'Adamaoua': 'Ngaoundéré'
    };
    
    return cityMapping[region] || region;
  }

  /**
   * Determine site access type
   */
  determineSiteAccess(site) {
    if (site.Company_in_charge_of_Security) {
      return 'escort_required';
    }
    return '24/7';
  }

  /**
   * Extract tenants from site data
   */
  extractTenants(site) {
    const tenants = [];
    const tenantsCount = site.Tenants_Count || 2;
    
    if (site.MTN_NAME || site.MTN_ID) {
      tenants.push({
        name: 'MTN Cameroon',
        type: 'telecom',
        equipment_count: Math.floor(tenantsCount / 2) || 4,
        power_consumption: 20,
        contact_info: {
          name: site.MTN_NAME || '',
          phone: '',
          email: ''
        }
      });
    }

    if (site.OCM_NAME || site.OCM_ID) {
      tenants.push({
        name: 'Orange Cameroon',
        type: 'telecom',
        equipment_count: Math.ceil(tenantsCount / 2) || 4,
        power_consumption: 15,
        contact_info: {
          name: site.OCM_NAME || '',
          phone: '',
          email: ''
        }
      });
    }

    return tenants;
  }

  /**
   * Determine generator status from site data
   */
  determineGeneratorStatus(site, genDetail) {
    if (site.Automatization_Status === 'NOK') return 'fault';
    if (site.DG_Age_Check === 'PROB') return 'maintenance';
    if (site.Hour_Meter_Check === 'PROB') return 'maintenance';
    if (genDetail && genDetail.actual_running_hours > 0) return 'running';
    return 'standby';
  }
}

module.exports = new DataMigrationService();





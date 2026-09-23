require('dotenv').config();
const mongoose = require('mongoose');
const Site = require('../models/Site');
const User = require('../models/User');
const Cluster = require('../models/Cluster');

const DEFAULT_PASSWORD = process.env.DEFAULT_USER_PASSWORD || 'Grato@123';

const getMongoUri = () =>
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  'mongodb://localhost:27017/generator-management';

const normalizeEmail = (email) => (email || '').trim().toLowerCase();
const normalizePhone = (phone) => (phone || '').toString().replace(/\s|\(|\)|-/g, '');

const buildClusterMaps = async () => {
  const clusters = await Cluster.find({}).select('_id code name').lean();
  const byCode = new Map();
  const byName = new Map();

  clusters.forEach((c) => {
    if (c.code) byCode.set(c.code.trim().toUpperCase(), c._id.toString());
    if (c.name) byName.set(c.name.trim().toLowerCase(), c._id.toString());
  });

  return { byCode, byName };
};

const getClusterIdFromSite = (site, clusterMaps) => {
  if (site.cluster) return site.cluster.toString();
  const code = (site.GRATO_Cluster || '').trim();
  if (code) {
    const match =
      clusterMaps.byCode.get(code.toUpperCase()) ||
      clusterMaps.byName.get(code.toLowerCase());
    if (match) return match;
  }
  return null;
};

const upsertUser = async ({ fullName, email, phone, role }) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  let user = await User.findOne({ email: normalizedEmail }).select('+password');

  if (!user) {
    user = new User({
      fullName,
      email: normalizedEmail,
      phone: normalizePhone(phone) || '0000000000',
      role,
      password: DEFAULT_PASSWORD,
      isActive: true,
    });
  } else {
    user.fullName = fullName || user.fullName;
    user.phone = normalizePhone(phone) || user.phone || '0000000000';
    user.role = role;
    user.isActive = true;
    user.password = DEFAULT_PASSWORD;
  }

  await user.save();
  return user;
};

(async () => {
  try {
    const mongoUri = getMongoUri();
    await mongoose.connect(mongoUri);
    console.log('✓ MongoDB connected:', mongoUri);

    const clusterMaps = await buildClusterMaps();

    const sites = await Site.find({
      $or: [
        { Technician_Name: { $exists: true, $ne: null, $ne: '' } },
        { SBC_Supervisor: { $exists: true, $ne: null, $ne: '' } },
        { IHS_supervisor_name: { $exists: true, $ne: null, $ne: '' } },
      ]
    })
      .select(
        [
          'IHS_ID_SITE',
          'GRATO_Cluster',
          'cluster',
          'Technician_Name',
          'Technician_Contact',
          'Email_Address_SBC_Field_Engineer',
          'SBC_Supervisor',
          'SBC_Supervisor_contact',
          'IHS_supervisor_name',
          'IHS_phone_number',
          'Email_Address_SBC_Regional_Manager',
          'Email_Address_SBC_Head_of_Operations',
          'Email_Address_SBC_OPS_Head'
        ].join(' ')
      )
      .lean();

    const technicianMap = new Map();
    const supervisorMap = new Map();
    const techSupervisorMap = new Map();

    for (const site of sites) {
      const clusterId = getClusterIdFromSite(site, clusterMaps);

      const techName = (site.Technician_Name || '').trim();
      const techEmail = normalizeEmail(site.Email_Address_SBC_Field_Engineer);
      if (techName && techEmail) {
        if (!technicianMap.has(techEmail)) {
          technicianMap.set(techEmail, {
            fullName: techName,
            email: techEmail,
            phone: site.Technician_Contact || '',
            assignedSites: new Set(),
            assignedClusters: new Set(),
          });
        }
        const techEntry = technicianMap.get(techEmail);
        if (site.IHS_ID_SITE) techEntry.assignedSites.add(site.IHS_ID_SITE);
        if (clusterId) techEntry.assignedClusters.add(clusterId);
      }

      const supervisorName = (site.SBC_Supervisor || site.IHS_supervisor_name || '').trim();
      const supervisorEmail = normalizeEmail(
        site.Email_Address_SBC_Regional_Manager ||
          site.Email_Address_SBC_OPS_Head ||
          site.Email_Address_SBC_Head_of_Operations
      );

      if (supervisorName && supervisorEmail) {
        if (!supervisorMap.has(supervisorEmail)) {
          supervisorMap.set(supervisorEmail, {
            fullName: supervisorName,
            email: supervisorEmail,
            phone: site.SBC_Supervisor_contact || site.IHS_phone_number || '',
            supervisedClusters: new Set(),
          });
        }
        const supEntry = supervisorMap.get(supervisorEmail);
        if (clusterId) supEntry.supervisedClusters.add(clusterId);
      }

      if (techEmail && supervisorEmail) {
        techSupervisorMap.set(techEmail, supervisorEmail);
      }
    }

    const supervisorUsers = new Map();
    let createdSupervisors = 0;
    let createdTechnicians = 0;
    let skippedSupervisors = 0;
    let skippedTechnicians = 0;

    for (const supEntry of supervisorMap.values()) {
      const supervisorUser = await upsertUser({
        fullName: supEntry.fullName,
        email: supEntry.email,
        phone: supEntry.phone,
        role: 'supervisor',
      });

      if (!supervisorUser) {
        skippedSupervisors += 1;
        continue;
      }

      const clusters = Array.from(supEntry.supervisedClusters || []);
      const existingClusters = new Set(
        (supervisorUser.supervised_clusters || []).map((id) => id.toString())
      );
      const mergedClusters = Array.from(new Set([...existingClusters, ...clusters]));

      supervisorUser.supervised_clusters = mergedClusters;
      await supervisorUser.save();

      supervisorUsers.set(supEntry.email, supervisorUser);
      createdSupervisors += 1;
    }

    for (const techEntry of technicianMap.values()) {
      const techUser = await upsertUser({
        fullName: techEntry.fullName,
        email: techEntry.email,
        phone: techEntry.phone,
        role: 'technician',
      });

      if (!techUser) {
        skippedTechnicians += 1;
        continue;
      }

      const assignedSites = Array.from(techEntry.assignedSites || []);
      const existingSites = new Set((techUser.assigned_sites || []).map(String));
      techUser.assigned_sites = Array.from(new Set([...existingSites, ...assignedSites]));

      const assignedClusters = Array.from(techEntry.assignedClusters || []);
      const existingClusters = new Set((techUser.assignedClusters || []).map((id) => id.toString()));
      techUser.assignedClusters = Array.from(new Set([...existingClusters, ...assignedClusters]));
      if (!techUser.assigned_cluster && assignedClusters.length > 0) {
        techUser.assigned_cluster = assignedClusters[0];
      }

      const supervisorEmail = techSupervisorMap.get(techEntry.email);
      const supervisorUser = supervisorEmail ? supervisorUsers.get(supervisorEmail) : null;
      if (supervisorUser) {
        techUser.supervisor = supervisorUser._id;

        const assigned = new Set(
          (supervisorUser.assignedTechnicians || []).map((id) => id.toString())
        );
        if (!assigned.has(techUser._id.toString())) {
          supervisorUser.assignedTechnicians = [
            ...(supervisorUser.assignedTechnicians || []),
            techUser._id,
          ];
          await supervisorUser.save();
        }
      }

      await techUser.save();
      createdTechnicians += 1;
    }

    // Update cluster supervisor field when missing and supervisor is known
    for (const supEntry of supervisorMap.values()) {
      const supervisorUser = supervisorUsers.get(supEntry.email);
      if (!supervisorUser) continue;

      const clusterIds = Array.from(supEntry.supervisedClusters || []);
      for (const clusterId of clusterIds) {
        const cluster = await Cluster.findById(clusterId);
        if (!cluster) continue;
        if (!cluster.supervisor) {
          cluster.supervisor = supervisorUser._id;
          await cluster.save();
        }
      }
    }

    console.log('\n=== USER CREATION SUMMARY ===');
    console.log(`Supervisors processed: ${createdSupervisors}`);
    console.log(`Supervisors skipped (missing email): ${skippedSupervisors}`);
    console.log(`Technicians processed: ${createdTechnicians}`);
    console.log(`Technicians skipped (missing email): ${skippedTechnicians}`);
    console.log(`Default password set for all: ${DEFAULT_PASSWORD}`);

    console.log('\nDone.');
    process.exit(0);
  } catch (err) {
    console.error('Failed to create users from site data:', err);
    process.exit(1);
  }
})();

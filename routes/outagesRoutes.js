const express = require('express');
const router = express.Router();
const Outage = require('../models/Outage');
const Site = require('../models/Site');
const moment = require('moment');
const mongoose = require('mongoose');

// Helper function to convert Excel dates to JavaScript Date objects
const excelDateToJSDate = (excelDate) => {
  if (typeof excelDate === 'number') {
    const correctedExcelDate = excelDate > 60 ? excelDate - 1 : excelDate;
    const date = new Date((correctedExcelDate - 25569) * 86400 * 1000);
    return isNaN(date.getTime()) ? null : date;
  }
  if (typeof excelDate === 'string') {
    const parsedDate = moment(excelDate, [
      moment.ISO_8601,
      "MM/DD/YYYY HH:mm:ss",
      "YYYY-MM-DD HH:mm:ss",
      "DD-MM-YYYY HH:mm:ss",
      "HH:mm:ss",
      "MM/DD/YYYY",
    ], true);
    if (parsedDate.isValid()) {
      return parsedDate.toDate();
    }
  }
  return null;
};

// Helper function to parse 'HH:mm' duration string to total minutes
// Also handles raw numeric strings (assumes hours if numeric)
const parseDurationToMinutes = (durationStr) => {
  if (!durationStr) return 0;
  const parts = durationStr.split(':');
  if (parts.length === 2) {
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    if (!isNaN(hours) && !isNaN(minutes)) {
      return (hours * 60) + minutes;
    }
  }
  // Attempt to parse as a raw number if it's not HH:mm (assume hours)
  const numericDuration = parseFloat(durationStr);
  if (!isNaN(numericDuration)) {
    return numericDuration * 60; // Convert hours to minutes
  }
  return 0; // Default to 0 if parsing fails
};


// Route to handle Excel data upload (remains unchanged)
router.post('/upload', async (req, res) => {
  try {
    const outages = req.body;
    if (!Array.isArray(outages) || outages.length === 0) {
      return res.status(400).json({ error: 'No data provided for upload.' });
    }

    const processedOutages = outages.map(outage => {
      const tenantSiteId = (outage['Tenant Site ID'] || '').toString().trim();
      const isMTN = tenantSiteId.startsWith('T');
      const isOCM = tenantSiteId.startsWith('LIT');

      const rca1 = (outage['RCA 1'] || '').toString().trim();
      const isAccessPassive = rca1.toLowerCase() === 'access' || rca1.toLowerCase() === 'passive';

      const rca2 = (outage['RCA 2'] || '').toString().trim().toLowerCase();
      const rca3 = (outage['RCA 3'] || '').toString().trim().toLowerCase();
      const parentTenantOutage = (outage['Parent Tenant Outage'] || '').toString().trim();
      const cascadedOutage = outage['Cascaded outage'] === true || outage['Cascaded outage'] === 'TRUE';

      let isChild = false;
      let isParent = false;
      if (
        parentTenantOutage && parentTenantOutage !== '' &&
        (cascadedOutage ||
         rca2.includes('cascaded') || rca2.includes('rca2') ||
         rca3.includes('cascaded') || rca3.includes('rca3'))
      ) {
        isChild = true;
      }
      if (!isChild && cascadedOutage) {
        isParent = true;
      }

      let cascadedSitesValue = outage['Cascaded Sites'];
      if (cascadedSitesValue !== null && cascadedSitesValue !== undefined) {
        cascadedSitesValue = String(cascadedSitesValue);
      } else {
        cascadedSitesValue = null;
      }

      let cascadedTenantCountValue = outage['Cascaded Tenant count'];
      if (cascadedTenantCountValue !== null && cascadedTenantCountValue !== undefined) {
        cascadedTenantCountValue = parseInt(cascadedTenantCountValue, 10);
        if (isNaN(cascadedTenantCountValue)) {
            cascadedTenantCountValue = 0;
        }
      } else {
        cascadedTenantCountValue = 0;
      }

      return {
        State: (outage.State || '').toString().trim() || null,
        'Tenant Site ID': tenantSiteId || null,
        'Site ID': (outage['Site ID'] || '').toString().trim() || null, // This is the IHS_ID_SITE equivalent
        'IHS Site Name': (outage['IHS Site Name'] || '').toString().trim() || null,
        'State/District': (outage['State/District'] || '').toString().trim() || null,
        'Incident State': (outage['Incident State'] || '').toString().trim() || null,
        Tenant: (outage.Tenant || '').toString().trim() || null,
        Priority: (outage.Priority || '').toString().trim() || null,
        'Outage Start Time': excelDateToJSDate(outage['Outage Start Time']),
        'Outage End Time': excelDateToJSDate(outage['Outage End Time']),
        'Outage Duration': (outage['Outage Duration'] || '').toString().trim() || null,
        'Resolution Comments': (outage['Resolution Comments'] || '').toString().trim() || null,
        'Primary Cause': (outage['Primary Cause'] || '').toString().trim() || null,
        'RCA 1': rca1 || null,
        'RCA 2': (outage['RCA 2'] || '').toString().trim() || null,
        'RCA 3': (outage['RCA 3'] || '').toString().trim() || null,
        'Parent Tenant Outage': parentTenantOutage || null,
        'Cascaded Sites': cascadedSitesValue,
        'Incident Ref': (outage['Incident Ref'] || '').toString().trim() || null,
        'Cascaded outage': cascadedOutage,
        'Cascaded Tenant count': cascadedTenantCountValue,
        Number: (outage.Number || '').toString().trim() || null,
        isMTN,
        isOCM,
        isParent,
        isChild,
        isAccessPassive
      };
    });

    const bulkOps = processedOutages.map(outage => ({
      updateOne: {
        filter: { 'Tenant Site ID': outage['Tenant Site ID'], 'Site ID': outage['Site ID'] },
        update: { $set: outage },
        upsert: true
      }
    }));

    const result = await Outage.bulkWrite(bulkOps);

    res.status(200).json({
      message: 'Outage data uploaded and processed successfully!',
      upsertedCount: result.upsertedCount,
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount
    });
  } catch (error) {
    console.error('Error processing outage data:', error);
    if (error.code === 11000) {
        return res.status(409).json({ error: 'Duplicate record detected based on Tenant Site ID and Site ID. Some records might not have been inserted/updated.', details: error.message });
    }
    res.status(500).json({ error: 'Failed to upload outage data.', details: error.message });
  }
});

// Route to fetch filtered outage data, now including site data lookup and aggregation
router.get('/', async (req, res) => {
  try {
    const { tenantType, priority, parentChild, searchTerm, aggregate } = req.query; 

    const query = { isAccessPassive: true };

    if (tenantType === 'MTN') {
      query.isMTN = true;
    } else if (tenantType === 'OCM') {
      query.isOCM = true;
    }

    if (parentChild === 'parent') {
      query.isParent = true;
    } else if (parentChild === 'child') {
      query.isChild = true;
    }

    if (priority) {
        query.Priority = priority;
    }

    if (searchTerm) {
        const searchRegex = new RegExp(searchTerm, 'i');
        query.$or = [
            { 'Tenant Site ID': searchRegex },
            { 'Site ID': searchRegex },
            { 'IHS Site Name': searchRegex },
            { Tenant: searchRegex },
            { 'RCA 1': searchRegex },
            { 'RCA 2': searchRegex },
            { 'RCA 3': searchRegex },
            { 'Resolution Comments': searchRegex },
            { 'Incident Ref': searchRegex },
            { 'State/District': searchRegex }
        ].filter(Boolean);
    }

    const outages = await Outage.find(query).sort({ 'Outage Start Time': -1 });

    // Extract unique IHS Site IDs from outages to fetch corresponding site data
    const ihsSiteIds = [...new Set(outages.map(o => o['Site ID']).filter(Boolean))];

    // Fetch site data efficiently
    const sites = await Site.find({ IHS_ID_SITE: { $in: ihsSiteIds } }).select(
        'IHS_ID_SITE Sites_Power_Topology GRATO_Cluster Technician_Name Technician_Contact Company_in_charge_of_Security Sites_Priority IHS_supervisor_name'
    );

    // Create a map for quick lookup of site details by IHS_ID_SITE
    const siteMap = new Map(sites.map(site => [site.IHS_ID_SITE, site]));

    // Merge site data into outage records
    const transformedOutages = outages.map(outage => {
        const outageObj = outage.toObject(); // Convert Mongoose document to plain object
        const siteDetails = siteMap.get(outageObj['Site ID']); // Lookup site details

        return {
            ...outageObj,
            // Populate fields from Site database
            'Topology': siteDetails ? siteDetails.Sites_Power_Topology : null,
            'Cluster': siteDetails ? siteDetails.GRATO_Cluster : null,
            'Company in charge': siteDetails ? siteDetails.Company_in_charge_of_Security : null,
            'Clusterre': siteDetails ? siteDetails.GRATO_Cluster : null,
            'Technician': siteDetails ? siteDetails.Technician_Name : null,
            'Phone Number': siteDetails ? siteDetails.Technician_Contact : null,
            'Status': siteDetails ? siteDetails.Sites_Priority : null,
            'Support/Responsible': siteDetails ? siteDetails.IHS_supervisor_name : null,
        };
    });

    // --- New aggregation logic starts here ---
    if (aggregate === 'true') {
        const aggregatedDurations = {};

        transformedOutages.forEach(outage => {
            const cluster = outage.Cluster;
            const durationInMinutes = parseDurationToMinutes(outage['Outage Duration']);

            if (cluster) {
                if (!aggregatedDurations[cluster]) {
                    aggregatedDurations[cluster] = { MTN: 0, OCM: 0 };
                }

                if (outage.isMTN) {
                    aggregatedDurations[cluster].MTN += durationInMinutes;
                }
                if (outage.isOCM) { // An outage can contribute to both if applicable
                    aggregatedDurations[cluster].OCM += durationInMinutes;
                }
            }
        });
        return res.status(200).json(aggregatedDurations);
    }
    // --- New aggregation logic ends here ---


    res.status(200).json(transformedOutages); // Return raw data if not aggregating
  } catch (error) {
    console.error('Error fetching outage data:', error);
    res.status(500).json({ error: 'Failed to fetch outage data.', details: error.message });
  }
});

// PATCH or PUT /api/outages/:id (remains unchanged)
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Validate the ID using Mongoose
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid outage ID' });
    }

    // Define allowed fields that can be updated
    const allowedUpdates = {};
    const editableFields = ['Company in charge', 'Topology', 'Cluster', 'Technician', 'Phone Number', 'Clusterre', 'Status', 'Support/Responsible'];

    // Filter updates to only include allowed fields
    for (const key in updates) {
      if (editableFields.includes(key)) {
        allowedUpdates[key] = updates[key];
      }
    }

    if (Object.keys(allowedUpdates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update.' });
    }

    // Find the outage first to get the Site ID
    const outage = await Outage.findById(id);
    if (!outage) {
      return res.status(404).json({ message: 'Outage not found' });
    }

    // Update the outage
    const updatedOutage = await Outage.findByIdAndUpdate(
      id,
      { $set: allowedUpdates },
      { new: true, runValidators: true }
    );

    // If Company in charge was updated, also update the corresponding Site document
    if (allowedUpdates['Company in charge'] && outage['Site ID']) {
      await Site.updateOne(
        { IHS_ID_SITE: outage['Site ID'] },
        { $set: { Company_in_charge_of_Security: allowedUpdates['Company in charge'] } }
      );
    }

    res.json(updatedOutage);
  } catch (error) {
    console.error('Error updating outage:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const path = require('path');
const dotenv = require('dotenv');

// Load env vars
dotenv.config({ path: path.join(__dirname, '../.env') });

// Load Models
const Site = require('../models/Site');
const Generator = require('../models/Generator');
const Cluster = require('../models/Cluster');
const User = require('../models/User');

// Connect DB
const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/generator-management');
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

// Helper: Generate ID
const generateGenId = (brand) => {
    const prefix = 'GEN';
    // Ensure brand is string and safe
    let brandCode = (brand && typeof brand === 'string' ? brand : 'UNK').replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
    if (brandCode.length < 3) brandCode = brandCode.padEnd(3, 'X');
    
    const randomNum = Math.floor(1000 + Math.random() * 9000); 
    return `${prefix}_${brandCode}_${randomNum}`;
};

const mapRowToSite = async (row, headers, adminId) => {
    // Helper to get value
    const getVal = (pattern) => {
        // Try strict match first for common short headers
        let headerIndex = headers.findIndex(h => h === pattern || h === pattern + ' ');
        if (headerIndex !== -1) {
             let val = row[headerIndex];
             if (typeof val === 'object' && val !== null && 'text' in val) return val.text;
             return val != null ? String(val).trim() : null;
        }

        // Try fuzzy
        headerIndex = headers.findIndex(h => h && h.toLowerCase().includes(pattern.toLowerCase()));
        if (headerIndex === -1) return null;
        
        // Handle conflicting fuzzy matches
        // E.g. "DG brand" vs "DG2 brand" - if pattern is "DG brand", ensure matched header doesn't have "2" if pattern doesn't?
        // Actually, "DG brand" is unique enough if "DG2 brand" exists.
        
        let val = row[headerIndex];
        if (typeof val === 'object' && val !== null && 'text' in val) return val.text; 
        if (typeof val === 'object' && val !== null && 'hyperlink' in val) return val.text; 
        return val != null ? String(val).trim() : null;
    };

    const ihsId = getVal('IHS Site ID');
    if (!ihsId) return null;

    const siteName = getVal('Site Name Operator1') || getVal('Site Name') || `Site ${ihsId}`;
    const region = getVal('Region');
    const gratoClusterName = getVal('Grato Cluster');
    
    // Find cluster
    let clusterId = null;
    if (gratoClusterName) {
        let cluster = await Cluster.findOne({ name: new RegExp(`^${gratoClusterName}$`, 'i') });
        if (cluster) clusterId = cluster._id;
    }

    // Generator 1 Fields
    const gen1Brand = getVal('DG brand');
    const gen1Serial = getVal('DG Serial Number');
    const gen1Kva = getVal('DG KVA Update'); 
    
    // Generator 2 Fields
    const gen2Brand = getVal('DG2 brand'); 
    const gen2Serial = getVal('DG2 Serial Number');
    const gen2Kva = getVal('DG2 KVA'); 

    const generatorIds = [];
    const generatorsDetails = [];

    // Common specs for Gen
    const tankCapacity = parseFloat(getVal('Capacity Of Internal Tank')) || 500;
    const tankTypeRaw = getVal('Fuel Tank Status') || getVal('Tank Status');
    let tankType = 'INT';
    if (tankTypeRaw && tankTypeRaw.toLowerCase().includes('ext')) tankType = 'EXT';

    const createOrUpdateGen = async (brand, serial, kva) => {
         const genId = generateGenId(brand); 
         let gen = null;
         const cleanSerial = (serial && serial !== 'N/A' && serial.length > 2) ? serial : null;
         
         if (cleanSerial) {
             gen = await Generator.findOne({ serial_number: cleanSerial });
         }
         
         const powerRating = parseFloat(kva) || 20; 

         const genData = {
             _id: gen ? gen._id : genId,
             model: brand || 'Unknown Model',
             manufacturer: brand || 'Unknown Manufacturer',
             serial_number: cleanSerial || `${genId}-SN`,
             created_by: adminId, 
             status: 'standby',
             specifications: {
                 fuel_type: 'diesel',
                 power_rating: powerRating,
                 fuel_capacity: tankCapacity 
             }
         };
         
         try {
             if (gen) {
                 await Generator.updateOne({ _id: gen._id }, { specifications: genData.specifications });
                 return gen._id;
             } else {
                 const newGen = await Generator.create(genData);
                 return newGen._id;
             }
         } catch(e) {
             console.error(`Gen Create Validation Failed: ${e.message}`);
             return null;
         }
    };

    if (gen1Brand && gen1Brand !== 'N/A') {
        const id = await createOrUpdateGen(gen1Brand, gen1Serial, gen1Kva);
        if (id) generatorIds.push(id);
        
        generatorsDetails.push({
            generator_number: 1,
            brand: gen1Brand,
            serial_number: gen1Serial || 'N/A',
            kva: parseFloat(gen1Kva) || 0,
            dg_age: parseFloat(getVal('DG age')) || 0,
            actual_running_hours: parseFloat(getVal('Actual DG run hour')) || 0,
            // Mapping Status from "Status" column near DG1. The column after "DG Controller" is "Status".
            // getVal('Status') might match "Site Status".
            // We need to be careful with "Status". 
            // The CSV has multiple 'Status' columns.
            // But getVal uses findIndex... first match wins.
            // "Status" is index 29 (after DG Controller). "Site Status" is index 14.
            // If we search "Status", "Site Status" might fuzzy match?
            // "Site Status".includes("Status") -> Yes.
            // So we might need precise index logic for status, but for now let's hope the order is distinct or names are distinct.
            // Actually, "DG Controller" is followed by "Status".
            // "DG2 Controller" is followed by "Status".
            // Since we rely on column headers which are unique text strings in the header row...
            // Wait, does the header row have duplicate "Status" strings?
            // If so, ExcelJS reader puts them in the array. findIndex finds the FIRST one.
            // So we can only reliably map the FIRST "Status".
            // To fix this properly, we'd need positional mapping relative to the "DG brand" column.
            // But let's skip "Status" for now to avoid complexity or map it if it has a unique name like "DG Status".
            // The snippet says "Status".
        });
    }

    if (gen2Brand && gen2Brand !== 'N/A') {
        const id = await createOrUpdateGen(gen2Brand, gen2Serial, gen2Kva);
        if (id) generatorIds.push(id);
        
        generatorsDetails.push({
            generator_number: 2,
            brand: gen2Brand,
            serial_number: gen2Serial || 'N/A',
            kva: parseFloat(gen2Kva) || 0,
            dg_age: parseFloat(getVal('DG2 age')) || 0,
            actual_running_hours: parseFloat(getVal('Actual DG2 run hour')) || 0
        });
    }
    
    // Solar Enriched
    const solarSystem = {
        installed: getVal('Solar Solution installed') || 'No',
        cabinet_manufacturer: getVal('Solar Cabinet Manufacture'),
        controller_manufacturer: getVal('Solar controller Manufacture'),
        controller_type: getVal('Solar Controller Type'),
        converters_functional: parseFloat(getVal('# Functional Solar converters')) || 0,
        converters_faulty: parseFloat(getVal('# Faulty Solar Converters')) || 0,
        converters_empty: parseFloat(getVal('# Empty solar converters')) || 0,
        controller_capacity: parseFloat(getVal('Solar controller Unit Capacity')) || 0,
        
        panel_manufacturer: getVal('Solar Panel Manufacture'),
        panel_count: parseFloat(getVal('# SolarPanel')) || 0,
        panel_unit_capacity: parseFloat(getVal('Solar Panel Unit Capacity')) || 0,
        panel_voltage: parseFloat(getVal('Panel Voltage')) || 0,
        panel_broken_count: parseFloat(getVal('# Broken panels')) || 0,
        total_capacity: parseFloat(getVal('Solar Panel Capacity')) || 0,
        
        combiner_box_count: parseFloat(getVal('# Combiner Box')) || 0,
        combiner_box_voltage: parseFloat(getVal('Combiner Box Voltage')) || 0,
        lightning_protection: getVal('Lightning Protection')
    };

    // AC Enriched
    const acSystem = {
        count: parseFloat(getVal('Number of AC units')) || 0,
        units: []
    };
    
    if (getVal('AC1 brand')) {
        acSystem.units.push({
            brand: getVal('AC1 brand'),
            type: getVal('Type 1'),
            capacity: getVal('Capacity 1'),
            gas_type: getVal('Ac Gas Type Used1'),
            remote_status: getVal('Remote Control status 1'),
            issue: getVal('AC1 Issure') || getVal('AC1 Issue'),
            status: getVal('AC1 Status')
        });
    }
    
    if (getVal('AC2 brand')) {
        acSystem.units.push({
            brand: getVal('AC2 brand'),
            type: getVal('Type 2'),
            capacity: getVal('Capacity 2'),
            gas_type: getVal('Ac Gas Type Used2'),
            remote_status: getVal('Remote Control status 2'),
            issue: getVal('AC2 Issure') || getVal('AC2 Issue'),
            status: getVal('AC2 Status')
        });
    }

    // Load Readings
    const loadReadings = {
        phase_1_amps: parseFloat(getVal('Phase 1 (Amps)')) || 0,
        phase_2_amps: parseFloat(getVal('Phase 2 (Amps)')) || 0,
        phase_3_amps: parseFloat(getVal('Phase 3 (Amps)')) || 0,
        mtn_load_amps: parseFloat(getVal('MTN Load')) || 0,
        ocm_load_amps: parseFloat(getVal('OCM Load')) || 0,
        camtel_load_amps: parseFloat(getVal('Camtel Load')) || 0,
        site_dc_load_amps: parseFloat(getVal('Site DC Load')) || 0,
        ac_non_telco_load_amps: parseFloat(getVal('Site AC Not Telco')) || 0,
        avg_load_on_dg_kw: parseFloat(getVal('Average Load on DG')) || 0
    };

    // Security Detail
    const securityDetail = {
        company_name: getVal('Security Company'),
        guards: [
            { name: getVal('Guard 1 Name') || '', phone: getVal('Guarde 1 Phone Number') || '' },
            { name: getVal('Guard 2 Name') || '', phone: getVal('Guarde 2 Phone Number') || '' }
        ],
        incident_history: getVal('Site Incident')
    };

    // Date Parsing
    let actualDate = null;
    const dateStr = getVal('last date of maintenance');
    if (dateStr && dateStr !== 'N/A' && dateStr !== '#N/A') {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) actualDate = d;
    }

    // Rectifiers & Batteries
    const rectBrand = getVal('rectifier Brand');
    const rectNumRaw = getVal('number of rectifier instal');
    const rectCapRaw = getVal('rectifier capacity in W');
    
    const rectifiers = [];
    if (rectBrand || rectNumRaw) {
        rectifiers.push({
            type: rectBrand,
            number_of_rectifiers: parseFloat(rectNumRaw) || 0,
            capacity_of_one_rectifier: parseFloat(rectCapRaw) || 0
        });
    }

    const battNumRaw = getVal('Total Number Of Batterie');
    const battCap = getVal('Batterie Capacity');
    const battAutonomy = getVal('AVG battery Back up');
    
    const batteries = [];
    if (battNumRaw || battCap) {
        batteries.push({
            number_of_batteries: parseFloat(battNumRaw) || 0,
            battery_capacity: battCap,
            battery_autonomy: parseFloat(battAutonomy) || 0,
            battery_threshold_to_start_dg: 0
        });
    }

    const siteData = {
        IHS_ID: ihsId,
        IHS_ID_SITE: ihsId,
        Site_Name: siteName,
        Region: region,
        GRATO_Cluster: gratoClusterName,
        cluster: clusterId,
        Sites_Type: getVal('GRATO Site Topologie'),
        Sites_Priority: getVal('Site Priority'),
        Current_Generators: generatorIds,
        Generators_Details: generatorsDetails, // Added Enriched Data
        Solar_System: solarSystem, // Added Enriched Data
        AC_System: acSystem, // Added Enriched Data
        Load_Readings: loadReadings, // Added Enriched Data
        Security_Detail: securityDetail, // Added Enriched Data
        
        Primary_Generator: generatorIds.length > 0 ? generatorIds[0] : null,
        Secondary_Generator: generatorIds.length > 1 ? generatorIds[1] : null,
        Actual_Date_Visit: actualDate,
        Tank_Capacity_1: tankCapacity,
        Type_de_Tank: tankType,
        Rectifiers: rectifiers,
        Batteries: batteries,
        Power_Cab_1_Type: getVal('Power cabinet type UPDATE'),
        Sites_Configuration_Outdoor_Indoor: getVal('Indoor/Outdoor'),
        Visit_Comments: getVal('Comments'),
        Issues_Found: {
            Any_Other_Issue: getVal('Site Incident'),
            Issue_of_Solar: getVal('Solar Solution installed at site') === 'Yes' ? 'Solar Installed' : ''
        }
    };

    return siteData;
};

const importData = async () => {
    await connectDB();
    
    // Get an admin user
    const adminUser = await User.findOne({ role: 'admin' }) || await User.findOne({});
    const adminId = adminUser ? adminUser._id : new mongoose.Types.ObjectId(); // Fallback if no user

    const filePath = process.argv[2] || 'c:\\Users\\IT OFFICER\\Downloads\\GRATO Portfolio UPDATE.csv';
    console.log(`Reading file: ${filePath}`);

    const workbook = new ExcelJS.Workbook();
    await workbook.csv.readFile(filePath);
    const worksheet = workbook.getWorksheet(1);
    
    // Assuming row 3 is header (based on file read)
    // Row 1 & 2 are merged headers/empty
    const headerRow = worksheet.getRow(3);
    const headers = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        headers[colNumber - 1] = cell.text; // 0-based index
    });

    console.log('Headers detected:', headers.slice(0, 10));

    let createdCount = 0;
    let updatedCount = 0;

    // Iterate rows starting from 4
    for (let i = 4; i <= worksheet.rowCount; i++) {
        const row = worksheet.getRow(i);
        if (!row.hasValues) continue;

        // Convert row object to array of values matching header index
        const rowValues = [];
        // exceljs row.values is 1-based and might have gaps
        for(let j=1; j <= headers.length; j++) {
            rowValues.push(row.getCell(j).value); 
        }

        const siteData = await mapRowToSite(rowValues, headers, adminId);
        
        if (siteData) {
            try {
                // Upsert Site
                const exists = await Site.findOne({ IHS_ID_SITE: siteData.IHS_ID_SITE });
                if (exists) {
                    await Site.updateOne({ _id: exists._id }, siteData);
                    updatedCount++;
                    // console.log(`Updated ${siteData.IHS_ID_SITE}`);
                } else {
                    await Site.create(siteData);
                    createdCount++;
                    console.log(`Created ${siteData.IHS_ID_SITE}`);
                }
            } catch (err) {
                console.error(`Error saving site ${siteData.IHS_ID_SITE}:`, err.message);
            }
        }
        
        if (i % 50 === 0) console.log(`Processed ${i} rows...`);
    }

    console.log(`Import Complete. Created: ${createdCount}, Updated: ${updatedCount}`);
    process.exit();
};

importData();

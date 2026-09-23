const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load env vars from parent directory
const envPath = path.resolve(__dirname, '../../POWER-GEN-APP/.env'); 
dotenv.config({ path: path.join(__dirname, '../.env') });

// Load Models
const Site = require('../models/Site');
const Generator = require('../models/Generator');
const Cluster = require('../models/Cluster');
const User = require('../models/User');

// Connect DB
const connectDB = async () => {
    try {
        const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/generator-management';
        const conn = await mongoose.connect(uri);
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

const generateGenId = (brand) => {
    const prefix = 'GEN';
    let brandCode = (brand && typeof brand === 'string' ? brand : 'UNK').replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
    if (brandCode.length < 3) brandCode = brandCode.padEnd(3, 'X');
    const randomNum = Math.floor(1000 + Math.random() * 9000); 
    return `${prefix}_${brandCode}_${randomNum}`;
};

const importData = async () => {
    await connectDB();
    
    // Get Admin
    const adminUser = await User.findOne({ role: 'admin' }) || await User.findOne({});
    const adminId = adminUser ? adminUser._id : new mongoose.Types.ObjectId();

    const filePath = 'c:\\Users\\IT OFFICER\\Downloads\\GRATO Portfolio UPDATE.json';
    console.log(`Reading file: ${filePath}`);

    let jsonData;
    try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        jsonData = JSON.parse(fileContent);
    } catch (err) {
        console.error('Failed to read or parse JSON file:', err.message);
        process.exit(1);
    }

    const rows = jsonData['Master Data Base'];
    if (!rows || !Array.isArray(rows)) {
        console.error('Invalid JSON structure: "Master Data Base" array missing.');
        process.exit(1);
    }

    // Identify Header Row and Build Column Map for Duplicates
    let headerRowIndex = -1;
    let headerMap = {}; 
    let columnMultiMap = {}; // Key: Lowercase Header -> [ColKey1, ColKey2, ...]

    for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const row = rows[i];
        const values = Object.values(row);
        // Look for signature headers
        if (values.includes('IHS Site ID ') || values.includes('IHS Site ID')) {
            headerRowIndex = i;
            headerMap = row;
            break;
        }
    }

    if (headerRowIndex === -1) {
        console.error('Could not find header row containing "IHS Site ID"');
        process.exit(1);
    }

    console.log(`Found headers at row index ${headerRowIndex}`);
    console.log(`Total rows: ${rows.length}`);

    // Build MultiMap
    Object.keys(headerMap).forEach(key => {
        const val = String(headerMap[key]).trim().toLowerCase();
        if (!columnMultiMap[val]) {
            columnMultiMap[val] = [];
        }
        columnMultiMap[val].push(key);
    });
    
    // Sort columns for each header to ensure consistent ordering (Column1, Column2...)
    Object.keys(columnMultiMap).forEach(key => {
        columnMultiMap[key].sort((a, b) => {
            // Extract number from "Column123" if possible, else string compare
            const numA = parseInt(a.replace(/\D/g, '')) || 0;
            const numB = parseInt(b.replace(/\D/g, '')) || 0;
            return numA - numB;
        });
    });

    // Helper to get value
    // index is 0 for first occurrence, 1 for second, etc.
    const getVal = (dataRow, headerPattern, index = 0) => {
        const pattern = headerPattern.toLowerCase();
        // Find keys pattern matches (exact or fuzzy)
        let exactKey = Object.keys(columnMultiMap).find(k => k === pattern);
        if (!exactKey) {
            // Fuzzy
            exactKey = Object.keys(columnMultiMap).find(k => k.includes(pattern));
        }

        if (exactKey) {
            const cols = columnMultiMap[exactKey];
            const colKey = cols[index]; 
            if (colKey) {
                const val = dataRow[colKey];
                if (val === undefined || val === null) return null;
                const strVal = String(val).trim();
                // Handle common empty patterns
                if (['null', 'N/A', '#N/A', 'NaN', 'undefined'].includes(strVal) || strVal === '') return null;
                return strVal;
            }
        }
        return null;
    };

    let createdCount = 0;
    let updatedCount = 0;

    console.log('Starting import loop...');
    // Iterate Data Rows
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        
        const ihsId = getVal(row, 'IHS Site ID');
        if (!ihsId) continue; 

        // Basic Info
        const siteName = getVal(row, 'Site Name Operator1') || getVal(row, 'Site Name') || `Site ${ihsId}`;
        const region = getVal(row, 'Region');
        const gratoClusterName = getVal(row, 'Grato Cluster');

        // Cluster
        let clusterId = null;
        if (gratoClusterName) {
            let cluster = await Cluster.findOne({ name: new RegExp(`^${gratoClusterName}$`, 'i') });
            if (!cluster) {
                 try {
                    cluster = await Cluster.create({ name: gratoClusterName, region: region });
                 } catch (e) { 
                    cluster = await Cluster.findOne({ name: new RegExp(`^${gratoClusterName}$`, 'i') });
                 }
            }
            if (cluster) clusterId = cluster._id;
        }

        // --- Generators ---
        const generatorIds = [];
        const generatorsDetails = [];
        
        // Helper Create/Update Gen Doc
        const createOrUpdateGen = async (brand, serial, kva, num) => {
             const genId = generateGenId(brand); 
             const cleanSerial = (serial && serial.length > 2) ? serial : `${genId}-SN`;
             
             let gen = await Generator.findOne({ serial_number: cleanSerial });
             const powerRating = parseFloat(kva) || 20; 
             const genData = {
                 model: brand || 'Unknown',
                 manufacturer: brand || 'Unknown',
                 serial_number: cleanSerial,
                 created_by: adminId, 
                 status: 'standby',
                 specifications: { fuel_type: 'diesel', power_rating: powerRating, fuel_capacity: 500 } // Default tank
             };
             
             try {
                if (gen) {
                    await Generator.updateOne({ _id: gen._id }, { specifications: genData.specifications });
                    return gen._id;
                } else {
                    const newGen = await Generator.create(genData);
                    return newGen._id;
                }
             } catch(e) { return null; }
        };

        // Generator 1
        const g1Brand = getVal(row, 'DG brand');
        if (g1Brand) {
            const g1Serial = getVal(row, 'DG Serial Number');
            const g1Kva = getVal(row, 'DG KVA Update');
            const id = await createOrUpdateGen(g1Brand, g1Serial, g1Kva, 1);
            if (id) generatorIds.push(id);

            generatorsDetails.push({
                generator_number: 1,
                brand: g1Brand,
                serial_number: g1Serial || 'N/A',
                kva: parseFloat(g1Kva) || 0,
                dg_age: parseFloat(getVal(row, 'DG age')) || 0,
                actual_running_hours: parseFloat(getVal(row, 'Actual DG run hour')) || 0,
                cph: getVal(row, 'Actual Field  CPH', 0) || 'N/A',
                status: getVal(row, 'Status', 0) || 'N/A', 
                phase_type: getVal(row, 'Phase Type', 0)
            });
        }

        // Generator 2
        // "DG2 brand" is unique header
        const g2Brand = getVal(row, 'DG2 brand'); 
        if (g2Brand) {
            const g2Serial = getVal(row, 'DG2 Serial Number');
            const g2Kva = getVal(row, 'DG2 KVA');
            const id = await createOrUpdateGen(g2Brand, g2Serial, g2Kva, 2);
            if (id) generatorIds.push(id);

            // Fetch secondary attributes using index 1
            const cph2 = getVal(row, 'Actual Field  CPH', 1);
            const status2 = getVal(row, 'Status', 1);
            // Note: DG2 'Phase Type' header is "Phase Type(1 or 3" in column 36. 
            // My getVal fuzzy match should find 'phase type'. Index 1 should get Gen 2.
            const phase2 = getVal(row, 'Phase Type', 1); 
            
            generatorsDetails.push({
                generator_number: 2,
                brand: g2Brand,
                serial_number: g2Serial || 'N/A',
                kva: parseFloat(g2Kva) || 0,
                dg_age: parseFloat(getVal(row, 'DG2 age')) || 0,
                actual_running_hours: parseFloat(getVal(row, 'Actual DG2 run hour')) || 0,
                cph: cph2 || 'N/A',
                status: status2 || 'N/A',
                phase_type: phase2
            });
        }

        // --- Other Systems ---
        const solarSystem = {
            installed: getVal(row, 'Solar Solution installed') || 'No',
            cabinet_manufacturer: getVal(row, 'Solar Cabinet Manufacture'),
            controller_manufacturer: getVal(row, 'Solar controller Manufacture'),
            controller_type: getVal(row, 'Solar Controller Type'),
            converters_functional: parseFloat(getVal(row, '# Functional Solar converters')) || 0,
            converters_faulty: parseFloat(getVal(row, '# Faulty Solar Converters')) || 0,
            converters_empty: parseFloat(getVal(row, '# Empty solar converters')) || 0,
            controller_capacity: parseFloat(getVal(row, 'Solar controller Unit Capacity')) || 0,
            panel_manufacturer: getVal(row, 'Solar Panel Manufacture'),
            panel_count: parseFloat(getVal(row, '# SolarPanel')) || 0,
            panel_unit_capacity: parseFloat(getVal(row, 'Solar Panel Unit Capacity')) || 0,
            panel_voltage: parseFloat(getVal(row, 'Panel Voltage')) || 0,
            panel_broken_count: parseFloat(getVal(row, '# Broken panels')) || 0,
            total_capacity: parseFloat(getVal(row, 'Solar Panel Capacity')) || 0,
            combiner_box_count: parseFloat(getVal(row, '# Combiner Box')) || 0,
            combiner_box_voltage: parseFloat(getVal(row, 'Combiner Box Voltage')) || 0,
            lightning_protection: getVal(row, 'Lightning Protection')
        };

        const acSystem = {
            count: parseFloat(getVal(row, 'Number of AC units')) || 0,
            units: []
        };
        // AC 1
        if (getVal(row, 'AC1 brand')) {
            acSystem.units.push({
                brand: getVal(row, 'AC1 brand'),
                type: getVal(row, 'Type 1'),
                capacity: getVal(row, 'Capacity 1'),
                gas_type: getVal(row, 'Ac Gas Type Used1'),
                remote_status: getVal(row, 'Remote Control status 1'),
                issue: getVal(row, 'AC1 Issure') || getVal(row, 'AC1 Issue'),
                status: getVal(row, 'AC1 Status')
            });
        }
        // AC 2
        if (getVal(row, 'AC2 brand')) {
            acSystem.units.push({
                brand: getVal(row, 'AC2 brand'),
                type: getVal(row, 'Type 2'),
                capacity: getVal(row, 'Capacity 2'),
                gas_type: getVal(row, 'Ac Gas Type Used2'),
                remote_status: getVal(row, 'Remote Control status 2'),
                issue: getVal(row, 'AC2 Issure') || getVal(row, 'AC2 Issue'),
                status: getVal(row, 'AC2 Status')
            });
        }

        const loadReadings = {
            phase_1_amps: parseFloat(getVal(row, 'Phase 1 (Amps)')) || 0,
            phase_2_amps: parseFloat(getVal(row, 'Phase 2 (Amps)')) || 0,
            phase_3_amps: parseFloat(getVal(row, 'Phase 3 (Amps)')) || 0,
            mtn_load_amps: parseFloat(getVal(row, 'MTN Load')) || 0,
            ocm_load_amps: parseFloat(getVal(row, 'OCM Load')) || 0,
            camtel_load_amps: parseFloat(getVal(row, 'Camtel Load')) || 0,
            site_dc_load_amps: parseFloat(getVal(row, 'Site DC Load')) || 0,
            ac_non_telco_load_amps: parseFloat(getVal(row, 'Site AC Not Telco')) || 0,
            avg_load_on_dg_kw: parseFloat(getVal(row, 'Average Load on DG')) || 0
        };

        const securityDetail = {
            company_name: getVal(row, 'Security Company'),
            guards: [
                { name: getVal(row, 'Guard 1 Name') || '', phone: getVal(row, 'Guarde 1 Phone Number') || '' },
                { name: getVal(row, 'Guard 2 Name') || '', phone: getVal(row, 'Guarde 2 Phone Number') || '' }
            ],
            incident_history: getVal(row, 'Site Incident')
        };
        
        const rectBrand = getVal(row, 'rectifier Brand');
        const rectNum = parseFloat(getVal(row, 'number of rectifier instal')) || 0;
        const rectCap = parseFloat(getVal(row, 'rectifier capacity in W')) || 0;
        const rectifiers = [];
        if (rectBrand || rectNum > 0) {
            rectifiers.push({ type: rectBrand, number_of_rectifiers: rectNum, capacity_of_one_rectifier: rectCap });
        }

        const battNum = parseFloat(getVal(row, 'Total Number Of Batterie')) || 0;
        const battCap = getVal(row, 'Batterie Capacity');
        const battAut = parseFloat(getVal(row, 'AVG battery Back up')) || 0;
        const batteries = [];
        if (battNum > 0 || battCap) {
             batteries.push({ 
                 number_of_batteries: battNum, 
                 battery_capacity: battCap, 
                 battery_autonomy: battAut, 
                 battery_threshold_to_start_dg: 0 
            });
        }

        const dateStr = getVal(row, 'last date of maintenance');
        let actualDate = null;
        if (dateStr) {
            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) actualDate = d;
        }

        // Grid Power / ENEO Information
        const gridConnected = getVal(row, 'Grid Connected');
        const eneoMeterNumber = getVal(row, 'Eneo Meter Number');
        const meterReading = getVal(row, 'Grid Meter reading');
        const phaseType = getVal(row, 'Tree Pharse or Single Pharse');
        const gridAvailability = getVal(row, 'AVG Grid Availbality (Monthly)');

        // Construct Site Object
        const siteData = {
            IHS_ID: ihsId,
            IHS_ID_SITE: ihsId,
            Site_Name: siteName,
            Region: region,
            GRATO_Cluster: gratoClusterName,
            cluster: clusterId,
            Sites_Type: getVal(row, 'GRATO Site Topologie'),
            Sites_Priority: getVal(row, 'Site Priority'),
            Current_Generators: generatorIds,
            Generators_Details: generatorsDetails,
            Number_of_Generators: generatorsDetails.length,
            Solar_System: solarSystem,
            AC_System: acSystem,
            Load_Readings: loadReadings,
            Security_Detail: securityDetail,
            Primary_Generator: generatorIds[0] || null,
            Secondary_Generator: generatorIds[1] || null,
            Actual_Date_Visit: actualDate,
            Tank_Capacity_1: parseFloat(getVal(row, 'Capacity Of Internal Tank')) || 0,
            Type_de_Tank: (getVal(row, 'Fuel Tank Status') || '').includes('EXT') ? 'EXT' : 'INT',
            Rectifiers: rectifiers,
            Batteries: batteries,
            Power_Cab_1_Type: getVal(row, 'Power cabinet type'),
            Sites_Configuration_Outdoor_Indoor: getVal(row, 'Indoor/Outdoor'),
            Sites_Power_Topology: getVal(row, 'GRATO Site Topologie'),
            Alarm_Cable_Status: getVal(row, 'Alarm Cable Status'),
            Company_in_charge_of_Security: getVal(row, 'Security Company'),
            Visit_Comments: getVal(row, 'Comments'),
            
            // Grid Power / ENEO fields
            ENEO_Working: gridConnected || 'NO',
            ENEO_Meter_Number: eneoMeterNumber || '',
            ENEO_SQ_Check: meterReading || '',
            Phase_Type: phaseType || '',
            Grid_Availability: gridAvailability || '',
            
            Issues_Found: { 
                Any_Other_Issue: getVal(row, 'Site Incident'),
                Issue_of_Solar: getVal(row, 'Solar Solution installed') === 'Yes' ? 'Solar Installed' : ''
            }
        };

        try {
            const exists = await Site.findOne({ IHS_ID_SITE: ihsId });
            if (exists) {
                await Site.updateOne({ _id: exists._id }, siteData);
                updatedCount++;
            } else {
                await Site.create(siteData);
                createdCount++;
            }
        } catch (err) {
            console.error(`Error saving ${ihsId}:`, err.message);
        }

        if (i % 50 === 0) {
            console.log(`Processed ${i} rows...`);
        }
    }

    console.log(`JSON Import Complete. Created: ${createdCount}, Updated: ${updatedCount}`);
    process.exit();
};

importData();

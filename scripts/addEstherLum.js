const axios = require('axios');

// Configure your configuration variables
const API_URL = 'https://grato-erp-api.onrender.com/api/engineering-incidents';
// Replace this with the actual JWT token used during the request
const AUTH_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OTFhYmY1MmM3NDMwZTgxYzE5ODQ2YTEiLCJyb2xlIjoidGVjaG5pY2FsIiwiaWF0IjoxNzgyMjMyMzUwLCJleHAiOjE3ODIzMTg3NTB9.nMja04XSn5Tta988WaNXjYdVFYu9sc7LqbgqWd0OsuM'; 

const payload = {
  // Section 1 — Incident Description
  incidentId: "INC-20260515-00000677",
  title: "Network outage around Sombo T0298 TIS site Down with 24 sites",
  reportedDateTime: "2026-06-23T13:00:00.000Z",
  incidentStartDateTime: "2026-06-23T06:11:00.000Z",
  resolutionDateTime: "2026-06-23T12:18:00.000Z",
  duration: "6h07min",
  severity: "P1 / Critical",
  incidentTypes: ["Network Outage"],
  affectedSiteLocation: "Sombo and surounding",
  affectedServices: "24 sites DWDM link MICROWAVE back up link",
  slaStatus: "Outside SLA (OSLA)",
  changeId: "N/A",
  existingProblemId: "N/A",
  incidentStatus: "Resolved",
  detailsNarrative: "The DG failed to start after a grid outage. Root cause identified: faulty kick starter.",
  resolutionSummary: "The team replaced the faulty kick starter. DG successfully restarted after the replacement.",

  // Section 2 — Business Impact
  impactLevel: "Critical (Revenue Loss)",
  impactAffectedServices: "25 GSM UMTS LTE sites and fibers affected",
  numberOfUsersAffected: "", 
  financialImpact: "Severe — quantify below",
  regulatoryImpact: "Yes — described below",
  reputationalRisk: "High",
  impactDescription: "power issue caused 25 GSM UMTS LTE sites down , DWDM fiber link and MICROWAVE BACK LINK",

  // Section 3 — Sequence of Activities
  activityLog: "23/06/2026 | 03:49 | DG stopped after 2 grid fluctuations | NOC team...", // full text fallback
  activityLogEntries: [
    {"date":"23/06/2026","time":"03:49","action":"DG stopped after 2 grid fluctuations ","responsible":"NOC team"},
    {"date":"23/06/2026","time":"05:00","action":"Team arrived on site and started investigations with fuel line before starting the DG","responsible":"Technician"},
    {"date":"23/06/2026","time":"05:13","action":"BTSwent down and team investigate on DG spare parts as card and solenoid before retry to start the DG again without succeed ","responsible":"Technician"},
    {"date":"23/06/2026","time":"07:00","action":"team move to the site Ndokoma to collect DG battery to startthe DG","responsible":"Technician"},
    {"date":"23/06/2026","time":"07:13","action":"TX and DWDM went down","responsible":"NOC team"},
    {"date":"23/06/2026","time":"07:15","action":"team disconnected the starter and starting test it without load, team discoveredthat the kick starter coin and piston are damaged","responsible":"Technician/Cyrille IHS/Felix GRATO"},
    {"date":"23/06/2026","time":"07:30","action":"Edea team move to Ntoumba to collect a 30KVA kick starter","responsible":"Felix GRATO sup"},
    {"date":"23/06/2026","time":"09:30","action":"Technicianmove to ndokoma to collect 2 batteiers to bring back the TX up while waiting the starter","responsible":"Technician/IHS SS"},
    {"date":"23/06/2026","time":"11:00","action":"Technician connect the 2 lithium batteries but the TX was still down even after a workarounddone with active part","responsible":"Technician/IHS SS"},
    {"date":"23/06/2026","time":"12:40","action":"Edea team arrived on site with the kick and start working to connect ","responsible":"Technician/IHS SS/Felix GRATO sup"},
    {"date":"23/06/2026","time":"13:05","action":"DGstarted by the team ,the TX, DWDM link and MICROWAVE link starting going up","responsible":"NOC team/Technician/IHS SS/Felix GRATO sup"},
    {"date":"23/06/2026","time":"13:18","action":"BTS and all the services restored on site","responsible":"NOC team"}
  ],

  // Section 4 — Preliminary Findings
  initialObservation: "22/06/2026 Sombo CH 24h QT 105 = 10.5cm",
  systemsChecked: "Diesel investigation : QL 170l of fuel found in the tank when team arrived on site and 75L has been added , bring to total quantity on 245l",
  testsPerformed: ["On-site Inspection"], 
  initialConclusion: ["Hardware"],
  detailedFindings: "The DG failed to start after a grid outage. Root cause identified: faulty kick starter. The team replaced the faulty kick starter. DG successfully restarted after the replacement.",

  // Section 5 — Root Cause
  rcaMethod: "Other", // FIX: Changed from "" to allowed enum value "Other"
  rootCauseCategories: ["Hardware"],
  contributingFactors: "access issue due to bad road condition spare part not on hand when the incident arrived troubleshooting took long time",
  rootCauseConfirmedBy: "Didier OYONG",
  rootCauseDescription: "sites went down due to DG kick starter faulty , the team replaced the kick starter and all the services went up",

  // Section 6 — Key Challenges
  logisticsChallenges: "No",
  securityAccessIssues: "Yes",
  sparePartsAvailability: "Yes — delayed",
  communicationIssues: "No",
  vendorDelays: "No",
  challengeDetails: "",

  // Section 7 — Recommendations / Actions
  recommendationText: "Regularly inspect the kick starter and other parts from the DG during PM Instore site visit and routine check up with level 0 keep some spare parts available.", // FIX: Copied text here to fulfill 'required' constraint
  actionItems: [],
  additionalRecommendations: "Improve site monitoring with the NOC .",

  // Section 8 — Photo Evidence & Attachments (Mapped from Cloudinary logs)
  attachments: [
    {
      name: "DG RH found yesterday 22062026.jpeg",
      url: "https://res.cloudinary.com/ddlhwv65t/image/upload/v1782230659/grato-erp/engineering-incidents/DG_RH_found_yesterday_22062026-1782230658856-w4pfsc.jpg",
      mimetype: "image/jpeg"
    },
    {
      name: "site de Sombo.png",
      url: "https://res.cloudinary.com/ddlhwv65t/image/upload/v1782230660/grato-erp/engineering-incidents/site_de_Sombo-1782230659810-x4wagy.png",
      mimetype: "image/png"
    },
    {
      name: "WhatsApp Image 2026-06-23 at 2.46.16 PM (1).jpeg",
      url: "https://res.cloudinary.com/ddlhwv65t/image/upload/v1782230661/grato-erp/engineering-incidents/WhatsApp_Image_2026_06_23_at_2_46_16_PM__1_-1782230660845-urxr2i.jpg",
      mimetype: "image/jpeg"
    },
    {
      name: "WhatsApp Image 2026-06-23 at 2.46.16 PM.jpeg",
      url: "https://res.cloudinary.com/ddlhwv65t/image/upload/v1782230661/grato-erp/engineering-incidents/WhatsApp_Image_2026_06_23_at_2_46_16_PM-1782230661689-rxp9gf.jpg",
      mimetype: "image/jpeg"
    },
    {
      name: "WhatsApp Image 2026-06-23 at 2.46.17 PM (1).jpeg",
      url: "https://res.cloudinary.com/ddlhwv65t/image/upload/v1782230662/grato-erp/engineering-incidents/WhatsApp_Image_2026_06_23_at_2_46_17_PM__1_-1782230662280-nbngvy.jpg",
      mimetype: "image/jpeg"
    },
    {
      name: "WhatsApp Image 2026-06-23 at 2.46.17 PM.jpeg",
      url: "https://res.cloudinary.com/ddlhwv65t/image/upload/v1782230663/grato-erp/engineering-incidents/WhatsApp_Image_2026_06_23_at_2_46_17_PM-1782230663033-jggp2i.jpg",
      mimetype: "image/jpeg"
    }
  ],
  evidenceDescriptions: [
    { index: 0, description: "DG RH found yesterday 22/06/2026" },
    { index: 1, description: "video of test done on the DG starter" },
    { index: 2, description: "replacement of the faulty DG kick starter" }
  ],
  additionalAttachmentTypes: [],

  // Section 9 — Submitter / Staff Metadata
  submittedBy: "691abf52c7430e81c19846a1",
  preparedByName: "Mr. Pascal Assam",
  preparedByDesignation: "Operations Manager",
  overallStatus: "submitted",
  reportStatus: "Draft — awaiting review"
};

async function submitReport() {
  try {
    console.log('Sending corrected incident report payload to Render ERP API...');
    const response = await axios.post(API_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`
      }
    });
    console.log('✅ Status Code:', response.status);
    console.log('✅ Server Response:', response.data);
  } catch (error) {
    console.error('❌ Request failed:');
    if (error.response) {
      console.error('Data:', error.response.data);
      console.error('Status:', error.response.status);
    } else {
      console.error('Message:', error.message);
    }
  }
}

submitReport();












// require('dotenv').config();
// const mongoose = require('mongoose');
// const User = require('../models/User');

// const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

// async function connectDB() {
//   try {
//     await mongoose.connect(MONGO_URI);
//     console.log('✅ Connected to MongoDB Atlas\n');
//   } catch (error) {
//     console.error('❌ Connection failed:', error.message);
//     process.exit(1);
//   }
// }

// async function addFloraKidzeven() {
//   try {
//     console.log('👤 ADDING NEW USER: FLORA KIDZEVEN');
//     console.log('='.repeat(80) + '\n');

//     await connectDB();

//     const email = 'flora.kidzeven@gratoglobal.com';
//     const password = 'FlorA@GraTo#1';
//     const fullName = 'Flora Kidzeven';

//     const existing = await User.findOne({ email });
//     if (existing) {
//       console.log('⚠️  User already exists:', existing.fullName);
//       console.log('   Email:', existing.email);
//       console.log('   Department:', existing.department);
//       console.log('   Position:', existing.position);
//       process.exit(0);
//     }

//     const supervisorEmail = 'lukong.lambert@gratoglobal.com';
//     const supervisor = await User.findOne({ email: supervisorEmail });

//     if (!supervisor) {
//       console.error('❌ Supervisor not found:', supervisorEmail);
//       process.exit(1);
//     }

//     const department = supervisor.department || 'Business Development & Supply Chain';
//     const position = 'Supply Chain Staff';
//     const hierarchyLevel = Math.max(1, (supervisor.hierarchyLevel || 3) - 1);

//     const newUser = new User({
//       email,
//       password,
//       fullName,
//       role: 'employee',
//       department,
//       position,
//       supervisor: supervisor._id,
//       departmentHead: supervisor.departmentHead || supervisor.supervisor || null,
//       hierarchyLevel,
//       isActive: true
//     });

//     await newUser.save();

//     // Add to supervisor direct reports (if not already)
//     if (supervisor.directReports) {
//       const alreadyLinked = supervisor.directReports.some(
//         (id) => id.toString() === newUser._id.toString()
//       );
//       if (!alreadyLinked) {
//         supervisor.directReports.push(newUser._id);
//         await supervisor.save();
//       }
//     }

//     console.log('✅ User created successfully!\n');

//     console.log('📊 USER DETAILS');
//     console.log('='.repeat(80));
//     console.log(`Email              : ${newUser.email}`);
//     console.log(`Full Name          : ${newUser.fullName}`);
//     console.log(`Department         : ${newUser.department}`);
//     console.log(`Position           : ${newUser.position}`);
//     console.log(`Role               : ${newUser.role}`);
//     console.log(`Supervisor         : ${supervisor.fullName} (${supervisor.email})`);
//     console.log('='.repeat(80) + '\n');

//     console.log('🔐 LOGIN CREDENTIALS');
//     console.log('='.repeat(80));
//     console.log(`Email              : ${email}`);
//     console.log(`Password           : ${password}`);
//     console.log('='.repeat(80) + '\n');

//     process.exit(0);

//   } catch (error) {
//     console.error('\n❌ Failed to add user:', error);
//     console.error(error.stack);
//     process.exit(1);
//   }
// }

// if (require.main === module) {
//   addFloraKidzeven();
// }

// module.exports = { addFloraKidzeven };
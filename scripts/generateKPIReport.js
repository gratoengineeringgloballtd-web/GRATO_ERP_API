require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const QuarterlyKPI = require('../models/QuarterlyKPI');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB Atlas\n');
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    process.exit(1);
  }
}

function getCurrentQuarter() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const quarter = Math.ceil(month / 3);
  return `Q${quarter}-${year}`;
}

async function checkKPISubmissions(options = {}) {
  try {
    console.log('📊 KPI SUBMISSION STATUS REPORT');
    console.log('='.repeat(100) + '\n');

    await connectDB();

    const targetQuarter = options.quarter || getCurrentQuarter();
    console.log(`📅 Checking Quarter: ${targetQuarter}\n`);

    // Fetch all active employees (exclude suppliers only - NO user exclusions)
    const employeeQuery = {
      role: { $ne: 'supplier' },
      isActive: true
    };

    if (options.department) {
      employeeQuery.department = options.department;
    }

    const allEmployees = await User.find(employeeQuery)
      .select('_id fullName email department position role hierarchyLevel supervisor')
      .populate('supervisor', 'fullName email')
      .lean()
      .sort({ department: 1, fullName: 1 });

    console.log(`👥 Total Active Employees: ${allEmployees.length}\n`);

    // Fetch all KPIs for the target quarter
    const allKPIs = await QuarterlyKPI.find({ 
      quarter: targetQuarter
    })
      .populate('employee', 'fullName email department position')
      .populate('supervisor', 'fullName email')
      .lean();

    console.log(`📋 Total KPI Documents for ${targetQuarter}: ${allKPIs.length}\n`);

    // Create a map of employee IDs to their KPI status
    const kpiMap = new Map();
    allKPIs.forEach(kpi => {
      if (kpi.employee) {
        kpiMap.set(kpi.employee._id.toString(), kpi);
      }
    });

    // Categorize employees
    const withKPIs = [];
    const withoutKPIs = [];

    allEmployees.forEach(employee => {
      const employeeId = employee._id.toString();
      const kpi = kpiMap.get(employeeId);

      if (kpi) {
        withKPIs.push({
          employee,
          kpi: {
            _id: kpi._id,
            quarter: kpi.quarter || targetQuarter,
            approvalStatus: kpi.approvalStatus || 'draft',
            kpis: kpi.kpis || [],
            totalKPIs: kpi.kpis ? kpi.kpis.length : 0,
            totalWeight: kpi.totalWeight || 0,
            submittedAt: kpi.submittedAt || null,
            approvedAt: kpi.approvedAt || null,
            rejectedAt: kpi.rejectedAt || null,
            rejectionReason: kpi.rejectionReason || null,
            supervisor: kpi.supervisor || null,
            comments: kpi.comments || null
          }
        });
      } else {
        withoutKPIs.push({
          employee,
          kpi: null
        });
      }
    });

    // Display summary
    displaySummary(withKPIs, withoutKPIs, targetQuarter);

    // Generate PDF report
    if (options.pdf) {
      await generatePDFReport({ withKPIs, withoutKPIs, targetQuarter }, options.pdf);
    }

    return { withKPIs, withoutKPIs, allEmployees, targetQuarter };

  } catch (error) {
    console.error('\n❌ Error checking KPI submissions:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

function displaySummary(withKPIs, withoutKPIs, quarter) {
  console.log('📈 SUMMARY');
  console.log('-'.repeat(100));
  
  const total = withKPIs.length + withoutKPIs.length;
  const submissionRate = total > 0 ? ((withKPIs.length / total) * 100).toFixed(1) : 0;

  console.log(`\n📊 Overall Statistics:`);
  console.log(`   Total Employees               : ${total}`);
  console.log(`   Employees with KPIs           : ${withKPIs.length} (${submissionRate}%)`);
  console.log(`   Employees without KPIs        : ${withoutKPIs.length} (${(100 - submissionRate).toFixed(1)}%)`);

  // Breakdown by approval status
  if (withKPIs.length > 0) {
    const byStatus = {};
    withKPIs.forEach(item => {
      const status = item.kpi.approvalStatus;
      byStatus[status] = (byStatus[status] || 0) + 1;
    });

    console.log(`\n📋 KPI Approval Status:`);
    Object.entries(byStatus).sort().forEach(([status, count]) => {
      const percentage = ((count / withKPIs.length) * 100).toFixed(1);
      console.log(`   ${status.padEnd(20)}: ${count} (${percentage}%)`);
    });
  }

  console.log('\n' + '='.repeat(100) + '\n');
}

async function generatePDFReport(data, filename = 'kpi_submission_report') {
  return new Promise((resolve, reject) => {
    try {
      // Helper functions
      const safe = (value, defaultValue = 0) => {
        if (value === null || value === undefined) return defaultValue;
        const num = Number(value);
        return isNaN(num) || !isFinite(num) ? defaultValue : num;
      };

      const str = (value, defaultValue = 'N/A') => {
        if (!value) return defaultValue;
        const s = String(value).trim();
        return s || defaultValue;
      };

      const exportDir = path.join(__dirname, '..', 'exports');
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filepath = path.join(exportDir, `${filename}_${timestamp}.pdf`);

      // Logo path
      const logoPath = path.join(__dirname, '../public/images/company-logo.jpg');
      const hasLogo = fs.existsSync(logoPath);

      // Create PDF document
      const doc = new PDFDocument({ 
        size: 'A4', 
        margin: 50,
        bufferPages: true
      });
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      // Calculate statistics
      const total = safe(data.withKPIs.length + data.withoutKPIs.length);
      const submissionRate = total > 0 ? safe((data.withKPIs.length / total) * 100).toFixed(1) : '0.0';

      // Status breakdown
      const byStatus = {};
      data.withKPIs.forEach(item => {
        const status = item.kpi.approvalStatus;
        byStatus[status] = (byStatus[status] || 0) + 1;
      });

      let pageNumber = 1;
      const PAGE_MARGIN = 50;
      const PAGE_BOTTOM = 720; // Safe bottom margin for content
      const FOOTER_Y = 742;

      // Add watermark
      const addWatermark = () => {
        if (hasLogo) {
          doc.save();
          doc.opacity(0.1);
          try {
            doc.image(logoPath, 197.5, 296, { width: 200 });
          } catch (err) {}
          doc.opacity(1);
          doc.restore();
        }
      };

      // Add footer
      const addFooter = () => {
        doc.save();
        doc.moveTo(PAGE_MARGIN, FOOTER_Y).lineTo(545, FOOTER_Y).strokeColor('#cccccc').stroke();
        doc.fontSize(8).fillColor('#666666')
           .text(`Page ${pageNumber} | Confidential - Internal Use Only`, PAGE_MARGIN, 752, { 
             align: 'center', 
             width: 495 
           });
        doc.restore();
        pageNumber++;
      };

      // Add header
      const addHeader = (pageTitle = '') => {
        if (hasLogo) {
          try { 
            doc.image(logoPath, PAGE_MARGIN, 30, { width: 60, height: 60 }); 
          } catch (err) {}
        }
        doc.fontSize(10).fillColor('#333333')
           .text('KPI Management System', 120, 40)
           .fontSize(8).fillColor('#666666')
           .text(`Report Period: ${str(data.targetQuarter)}`, 120, 55)
           .text(`Generated: ${new Date().toLocaleDateString()}`, 120, 67);
        
        if (pageTitle) {
          doc.fontSize(9).fillColor('#4682b4').text(str(pageTitle), 400, 45, { align: 'right' });
        }
        
        doc.moveTo(PAGE_MARGIN, 100).lineTo(545, 100).strokeColor('#cccccc').stroke();
        doc.y = 115; // Reset Y position after header
      };

      // Check if we need a new page
      const checkPageBreak = (requiredSpace) => {
        if (doc.y + requiredSpace > PAGE_BOTTOM) {
          addFooter();
          doc.addPage();
          addWatermark();
          addHeader();
          return true;
        }
        return false;
      };

      // COVER PAGE
      addWatermark();
      if (hasLogo) {
        try { doc.image(logoPath, 216.5, 150, { width: 160, height: 160 }); } catch (err) {}
      }

      doc.y = 350;
      doc.fontSize(28).fillColor('#1a1a1a').font('Helvetica-Bold')
         .text('KPI SUBMISSION', { align: 'center' })
         .text('STATUS REPORT', { align: 'center' })
         .moveDown(2);

      doc.fontSize(18).fillColor('#4682b4').font('Helvetica')
         .text(`Quarter: ${str(data.targetQuarter)}`, { align: 'center' })
         .moveDown(3);

      const boxY = doc.y;
      doc.roundedRect(100, boxY, 395, 140, 5).fillAndStroke('#f8f9fa', '#dee2e6');
      
      doc.fillColor('#1a1a1a').fontSize(11).font('Helvetica-Bold')
         .text('Report Summary', 120, boxY + 20);
      
      doc.font('Helvetica').fontSize(10)
         .text(`Total Employees Reviewed: ${total}`, 120, boxY + 40)
         .text(`Submission Rate: ${submissionRate}%`, 120, boxY + 55)
         .text(`Employees with Submitted KPIs: ${safe(data.withKPIs.length)}`, 120, boxY + 70)
         .text(`Employees Pending Submission: ${safe(data.withoutKPIs.length)}`, 120, boxY + 85);
      
      doc.font('Helvetica-Bold').text('Report Details:', 120, boxY + 105);
      doc.font('Helvetica')
         .text(`Generated: ${new Date().toLocaleString()}`, 120, boxY + 120);
      
      addFooter();

      // DETAILED ANALYSIS - EMPLOYEES WITH KPIs
      if (data.withKPIs.length > 0) {
        doc.addPage();
        addWatermark();
        addHeader('KPI Submissions');
        
        doc.fontSize(20).fillColor('#1a1a1a').font('Helvetica-Bold')
           .text('Detailed KPI Submission Analysis', PAGE_MARGIN);
        doc.moveDown(0.5);

        doc.fontSize(10).fillColor('#333333').font('Helvetica')
           .text(
             `This section provides detailed information about all employees who have submitted KPIs for ${str(data.targetQuarter)}.`,
             PAGE_MARGIN, 
             doc.y, 
             { width: 495 }
           );
        doc.moveDown(1.5);

        const grouped = {};
        data.withKPIs.forEach(item => {
          const status = item.kpi.approvalStatus;
          if (!grouped[status]) grouped[status] = [];
          grouped[status].push(item);
        });

        const statusConfig = {
          approved: { color: '#28a745', bgColor: '#d4edda', borderColor: '#c3e6cb', title: 'Approved KPIs' },
          pending: { color: '#856404', bgColor: '#fff3cd', borderColor: '#ffeaa7', title: 'Pending Review' },
          rejected: { color: '#721c24', bgColor: '#f8d7da', borderColor: '#f5c6cb', title: 'Rejected KPIs' },
          draft: { color: '#383d41', bgColor: '#e2e3e5', borderColor: '#d6d8db', title: 'Draft KPIs' }
        };

        ['approved', 'pending', 'rejected', 'draft'].forEach(status => {
          if (!grouped[status] || grouped[status].length === 0) return;

          const config = statusConfig[status];
          const items = grouped[status];

          checkPageBreak(50);

          doc.fontSize(16).font('Helvetica-Bold').fillColor(config.color)
             .text(`${config.title} (${items.length})`, PAGE_MARGIN);
          doc.moveDown(0.5);

          items.forEach((item, idx) => {
            const boxHeight = 115;
            checkPageBreak(boxHeight + 20);

            const emp = item.employee;
            const kpi = item.kpi;
            if (!emp || !emp.fullName) return;

            const boxTop = doc.y;

            // Draw box
            doc.roundedRect(PAGE_MARGIN, boxTop, 495, boxHeight, 5)
               .fillAndStroke(config.bgColor, config.borderColor);

            // Employee name
            doc.fontSize(12).fillColor('#1a1a1a').font('Helvetica-Bold')
               .text(`${idx + 1}. ${str(emp.fullName)}`, PAGE_MARGIN + 15, boxTop + 15);

            // Status badge
            doc.roundedRect(450, boxTop + 15, 85, 20, 10).fill(config.color);
            doc.fontSize(9).fillColor('#ffffff').font('Helvetica-Bold')
               .text(status.toUpperCase(), 455, boxTop + 19, { width: 75, align: 'center' });

            // Left column details
            let detailY = boxTop + 45;
            doc.fontSize(9).fillColor('#495057');

            doc.font('Helvetica-Bold').text('Email:', PAGE_MARGIN + 15, detailY, { continued: true });
            doc.font('Helvetica').text(` ${str(emp.email)}`, { width: 250 });
            detailY += 15;

            doc.font('Helvetica-Bold').text('Department:', PAGE_MARGIN + 15, detailY, { continued: true });
            doc.font('Helvetica').text(` ${str(emp.department)}`, { width: 250 });
            detailY += 15;

            doc.font('Helvetica-Bold').text('Position:', PAGE_MARGIN + 15, detailY, { continued: true });
            doc.font('Helvetica').text(` ${str(emp.position)}`, { width: 250 });

            // Right column details
            detailY = boxTop + 45;
            doc.font('Helvetica-Bold').text('Total KPIs:', 280, detailY, { continued: true });
            doc.font('Helvetica').text(` ${String(safe(kpi.totalKPIs))}`);
            detailY += 15;

            doc.font('Helvetica-Bold').text('Weight:', 280, detailY, { continued: true });
            doc.font('Helvetica').text(` ${safe(kpi.totalWeight)}%`);

            // Move Y position past the box
            doc.y = boxTop + boxHeight + 15;
          });

          doc.moveDown(1);
        });
      }

      // EMPLOYEES WITHOUT KPIs
      if (data.withoutKPIs.length > 0) {
        checkPageBreak(80);

        doc.fontSize(16).font('Helvetica-Bold').fillColor('#dc3545')
           .text(`Employees Without KPI Submissions (${data.withoutKPIs.length})`, PAGE_MARGIN);
        doc.moveDown(1);

        doc.fontSize(10).fillColor('#721c24').font('Helvetica')
           .text(
             'The following employees have not submitted their KPIs for the current quarter. Immediate action is required.',
             PAGE_MARGIN, 
             doc.y, 
             { width: 495 }
           );
        doc.moveDown(1);

        // Group by department
        const byDept = {};
        data.withoutKPIs.forEach(item => {
          const dept = item.employee.department || 'No Department';
          if (!byDept[dept]) byDept[dept] = [];
          byDept[dept].push(item);
        });

        Object.entries(byDept).sort().forEach(([dept, items]) => {
          checkPageBreak(50);

          doc.fontSize(13).fillColor('#dc3545').font('Helvetica-Bold')
             .text(`${dept} (${items.length} employees)`, PAGE_MARGIN);
          doc.moveDown(0.5);

          items.forEach((item, idx) => {
            const boxHeight = 85;
            checkPageBreak(boxHeight + 15);

            const emp = item.employee;
            if (!emp || !emp.fullName) return;

            const boxTop = doc.y;

            // Draw box
            doc.roundedRect(PAGE_MARGIN, boxTop, 495, boxHeight, 5)
               .fillAndStroke('#fff5f5', '#f5c6cb');

            // Warning icon
            doc.fontSize(20).fillColor('#dc3545').text('!', PAGE_MARGIN + 15, boxTop + 12);

            // Employee name
            doc.fontSize(11).fillColor('#1a1a1a').font('Helvetica-Bold')
               .text(`${idx + 1}. ${str(emp.fullName)}`, PAGE_MARGIN + 35, boxTop + 12);

            // Details
            doc.fontSize(8).fillColor('#495057').font('Helvetica')
               .text(`Email: ${str(emp.email)}`, PAGE_MARGIN + 35, boxTop + 30)
               .text(`Position: ${str(emp.position)}`, PAGE_MARGIN + 35, boxTop + 43)
               .text(`Role: ${str(emp.role)}`, PAGE_MARGIN + 35, boxTop + 56);

            // Action required badge
            doc.roundedRect(400, boxTop + 12, 135, 20, 10).fill('#dc3545');
            doc.fontSize(8).fillColor('#ffffff').font('Helvetica-Bold')
               .text('ACTION REQUIRED', 405, boxTop + 16, { width: 125, align: 'center' });

            // Move Y position past the box
            doc.y = boxTop + boxHeight + 15;
          });

          doc.moveDown(1);
        });
      }

      addFooter();

      // Finalize
      doc.end();

      stream.on('finish', () => {
        console.log(`\n✅ Professional PDF Report Generated: ${filepath}`);
        console.log(`   File size: ${(fs.statSync(filepath).size / 1024).toFixed(2)} KB`);
        console.log(`   Total pages: ${pageNumber - 1}\n`);
        resolve(filepath);
      });

      stream.on('error', reject);

    } catch (error) {
      console.error('❌ PDF generation failed:', error.message);
      reject(error);
    }
  });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    pdf: 'kpi_submission_report',
    quarter: null,
    department: null
  };

  args.forEach(arg => {
    if (arg === '--no-pdf') {
      options.pdf = false;
    } else if (arg === '--pdf' || arg === '-p') {
      options.pdf = 'kpi_submission_report';
    } else if (arg.startsWith('--quarter=')) {
      options.quarter = arg.split('=')[1];
    } else if (arg.startsWith('--department=')) {
      options.department = arg.split('=')[1];
    } else if (arg.startsWith('--filename=')) {
      options.pdf = arg.split('=')[1];
    }
  });

  return options;
}

// Run the script
if (require.main === module) {
  const options = parseArgs();
  
  console.log('🚀 Starting KPI PDF Report Generation...\n');
  console.log(`📅 Target Quarter: ${options.quarter || getCurrentQuarter()}`);
  if (options.department) {
    console.log(`🏢 Department Filter: ${options.department}`);
  }
  console.log('');
  
  checkKPISubmissions(options)
    .then(() => {
      console.log('\n✅ Report generation completed successfully!\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Report generation failed:', error.message);
      console.error(error.stack);
      process.exit(1);
    });
}

module.exports = { checkKPISubmissions, getCurrentQuarter };



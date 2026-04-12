/**
 * identify-lost-attachments.js
 *
 * Identifies ALL lost/broken attachments across:
 *
 *   1. Purchase Requisitions
 *        └─ attachments[]
 *
 *   2. Cash Requests  (requestMode = 'advance')
 *        ├─ attachments[]
 *        └─ justification.documents[]
 *
 *   3. Reimbursements  (requestMode = 'reimbursement', same CashRequest model)
 *        ├─ attachments[]
 *        ├─ justification.documents[]
 *        └─ reimbursementDetails.receiptDocuments[]
 *
 * Usage:
 *   node scripts/identify-lost-attachments.js            ← report + CSV only
 *   node scripts/identify-lost-attachments.js --notify   ← report + CSV + emails
 */

require('dotenv').config();
const mongoose   = require('mongoose');
const fs         = require('fs');
const path       = require('path');
const nodemailer = require('nodemailer');

// ⚠️  User MUST be required before any model that references it via populate()
const User                = require('../models/User');
const PurchaseRequisition = require('../models/PurchaseRequisition');
const CashRequest         = require('../models/CashRequest');

const SEND_EMAILS = process.argv.includes('--notify');
const OUTPUT_DIR  = path.resolve(__dirname, '../reports');

// ── Email transporter ─────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST || process.env.SMTP_HOST,
  port:   parseInt(process.env.EMAIL_PORT || process.env.SMTP_PORT || '587'),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER || process.env.SMTP_USER,
    pass: process.env.EMAIL_PASS || process.env.SMTP_PASS,
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const isLostFile = (att) => {
  if (!att) return false;
  if (!att.localPath && !att.url) return true;
  if (att.localPath?.startsWith('/opt/render/')) return true;
  if (att.localPath && !fs.existsSync(att.localPath)) return true;
  return false;
};

const formatDate = (date) =>
  date ? new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  }) : 'N/A';

const statusBadge = (status) => {
  const colors = {
    approved:          '#52c41a',
    denied:            '#ff4d4f',
    completed:         '#1890ff',
    fully_disbursed:   '#52c41a',
    partially_disbursed: '#fa8c16',
  };
  const color = colors[status?.toLowerCase()] || '#666';
  return `<span style="background:${color};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:bold;">${(status || 'N/A').replace(/_/g, ' ')}</span>`;
};

// Collect all lost files from a single document across all attachment fields
// Returns an array of { fieldLabel, fileName } objects
const collectLostFiles = (doc, isReimbursement) => {
  const lost = [];

  // 1. Main attachments[]
  for (const att of doc.attachments || []) {
    if (isLostFile(att)) {
      lost.push({
        fieldLabel: 'Main Attachment',
        fileName:   att.name || att.originalName || 'Unknown file',
      });
    }
  }

  // 2. justification.documents[]
  for (const att of doc.justification?.documents || []) {
    if (isLostFile(att)) {
      lost.push({
        fieldLabel: 'Justification Document',
        fileName:   att.name || att.originalName || 'Unknown file',
      });
    }
  }

  // 3. reimbursementDetails.receiptDocuments[] (reimbursements only)
  if (isReimbursement) {
    for (const att of doc.reimbursementDetails?.receiptDocuments || []) {
      if (isLostFile(att)) {
        lost.push({
          fieldLabel: 'Receipt Document',
          fileName:   att.name || att.originalName || 'Unknown file',
        });
      }
    }
  }

  return lost;
};

// ── Scanners ──────────────────────────────────────────────────────────────────

const scanPurchaseRequisitions = async () => {
  console.log('\n📂 Scanning Purchase Requisitions...');

  const docs = await PurchaseRequisition.find({ 'attachments.0': { $exists: true } })
    .populate('employee', 'fullName email department')
    .select('requisitionNumber title status createdAt employee attachments')
    .sort({ createdAt: -1 })
    .lean();

  console.log(`   Found ${docs.length} record(s) with attachments`);

  const affected = [];

  for (const doc of docs) {
    const lostFiles = (doc.attachments || [])
      .filter(isLostFile)
      .map(a => ({ fieldLabel: 'Attachment', fileName: a.name || 'Unknown file' }));

    if (lostFiles.length === 0) continue;

    affected.push({
      moduleName:      'Purchase Requisition',
      appPath:         '/employee/purchase-requisitions',
      referenceNumber: doc.requisitionNumber || doc._id?.toString(),
      title:           doc.title || 'N/A',
      status:          doc.status,
      submittedDate:   doc.createdAt,
      employee:        doc.employee,
      lostFiles,
      lostCount:       lostFiles.length,
      docId:           doc._id,
    });
  }

  console.log(`   Affected records: ${affected.length}`);
  return affected;
};

const scanCashRequests = async () => {
  console.log('\n📂 Scanning Cash Requests (advances)...');

  // Has at least one of the three possible attachment arrays
  const docs = await CashRequest.find({
    requestMode: 'advance',
    $or: [
      { 'attachments.0':                        { $exists: true } },
      { 'justification.documents.0':            { $exists: true } },
    ],
  })
    .populate('employee', 'fullName email department')
    .select('requestMode purpose requestType status createdAt employee attachments justification')
    .sort({ createdAt: -1 })
    .lean();

  console.log(`   Found ${docs.length} record(s) with attachments`);

  const affected = [];

  for (const doc of docs) {
    const lostFiles = collectLostFiles(doc, false);
    if (lostFiles.length === 0) continue;

    affected.push({
      moduleName:      'Cash Request',
      appPath:         '/employee/cash-requests',
      referenceNumber: doc.displayId || doc._id?.toString(),
      title:           doc.purpose || doc.requestType || 'N/A',
      status:          doc.status,
      submittedDate:   doc.createdAt,
      employee:        doc.employee,
      lostFiles,
      lostCount:       lostFiles.length,
      docId:           doc._id,
    });
  }

  console.log(`   Affected records: ${affected.length}`);
  return affected;
};

const scanReimbursements = async () => {
  console.log('\n📂 Scanning Reimbursements...');

  const docs = await CashRequest.find({
    requestMode: 'reimbursement',
    $or: [
      { 'attachments.0':                              { $exists: true } },
      { 'justification.documents.0':                  { $exists: true } },
      { 'reimbursementDetails.receiptDocuments.0':    { $exists: true } },
    ],
  })
    .populate('employee', 'fullName email department')
    .select('requestMode purpose requestType status createdAt employee attachments justification reimbursementDetails')
    .sort({ createdAt: -1 })
    .lean();

  console.log(`   Found ${docs.length} record(s) with attachments`);

  const affected = [];

  for (const doc of docs) {
    const lostFiles = collectLostFiles(doc, true);
    if (lostFiles.length === 0) continue;

    affected.push({
      moduleName:      'Reimbursement',
      appPath:         '/employee/cash-requests',
      referenceNumber: doc.displayId || doc._id?.toString(),
      title:           doc.purpose || doc.requestType || 'N/A',
      status:          doc.status,
      submittedDate:   doc.createdAt,
      employee:        doc.employee,
      lostFiles,
      lostCount:       lostFiles.length,
      docId:           doc._id,
    });
  }

  console.log(`   Affected records: ${affected.length}`);
  return affected;
};

// ── Email builder ─────────────────────────────────────────────────────────────

const sendReuploadEmail = async (employee, allAffectedRecords) => {
  // Group records by module
  const moduleGroups = {};
  for (const r of allAffectedRecords) {
    if (!moduleGroups[r.moduleName]) moduleGroups[r.moduleName] = [];
    moduleGroups[r.moduleName].push(r);
  }

  const moduleSectionsHtml = Object.entries(moduleGroups).map(([moduleName, records]) => {
    const rows = records.map(r => {
      // Group lost files by field label for cleaner display
      const filesByField = {};
      for (const f of r.lostFiles) {
        if (!filesByField[f.fieldLabel]) filesByField[f.fieldLabel] = [];
        filesByField[f.fieldLabel].push(f.fileName);
      }
      const filesHtml = Object.entries(filesByField).map(([label, names]) =>
        `<div style="margin-bottom:4px;">
          <span style="color:#666;font-size:11px;">${label}:</span><br/>
          ${names.map(n => `<span>❌ ${n}</span>`).join('<br/>')}
        </div>`
      ).join('');

      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;">
            <strong>${r.referenceNumber}</strong>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;">
            ${r.title}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;">
            ${filesHtml}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;">
            ${formatDate(r.submittedDate)}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;">
            ${statusBadge(r.status)}
          </td>
        </tr>`;
    }).join('');

    return `
      <div style="margin-bottom:28px;">
        <h3 style="color:#1890ff;border-bottom:2px solid #e8f4ff;padding-bottom:8px;">
          📁 ${moduleName}
        </h3>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f5f5f5;">
              <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e8e8e8;font-size:12px;">Reference #</th>
              <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e8e8e8;font-size:12px;">Purpose / Title</th>
              <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e8e8e8;font-size:12px;">Lost Files</th>
              <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e8e8e8;font-size:12px;">Submitted</th>
              <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e8e8e8;font-size:12px;">Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

  const totalLost = allAffectedRecords.reduce((s, r) => s + r.lostCount, 0);

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;">
      <div style="background:linear-gradient(135deg,#1890ff,#096dd9);padding:28px 24px;border-radius:8px 8px 0 0;">
        <h2 style="color:#fff;margin:0;font-size:20px;">⚠️ Action Required: Re-upload Missing Files</h2>
        <p style="color:#d0e8ff;margin:8px 0 0 0;font-size:14px;">
          ${totalLost} file(s) across ${allAffectedRecords.length} record(s) need to be re-uploaded
        </p>
      </div>

      <div style="background:#fff;border:1px solid #e8e8e8;border-top:none;padding:28px 24px;border-radius:0 0 8px 8px;">
        <p style="font-size:14px;">Dear <strong>${employee.fullName}</strong>,</p>
        <p style="font-size:14px;color:#444;line-height:1.6;">
          We sincerely apologize for the inconvenience. Due to a server storage issue that has now
          been permanently resolved, some files you previously attached to your request(s) were lost.
          <strong>Your requests themselves are intact</strong> — only the attached files need to be re-uploaded.
        </p>

        ${moduleSectionsHtml}

        <div style="background:#fff7e6;border-left:4px solid #fa8c16;padding:16px 20px;margin:24px 0;border-radius:0 4px 4px 0;">
          <strong style="font-size:14px;">📋 Steps to re-upload:</strong>
          <ol style="margin:10px 0 0 0;padding-left:20px;font-size:13px;line-height:1.8;">
            <li>Log in to the ERP system</li>
            <li>Navigate to the relevant section (Purchase Requisitions / Cash Requests)</li>
            <li>Open the record listed above</li>
            <li>Re-attach the missing file(s)</li>
          </ol>
        </div>

        <div style="background:#f6ffed;border:1px solid #b7eb8f;border-radius:6px;padding:14px 18px;margin-bottom:24px;font-size:13px;">
          ✅ <strong>The storage issue has been fixed.</strong> All new uploads are now stored
          permanently and will not be affected by server updates or redeploys.
        </div>

        <div style="text-align:center;margin:28px 0 16px;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}"
             style="background:#1890ff;color:#fff;padding:13px 32px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;font-size:14px;">
            Go to ERP System
          </a>
        </div>

        <p style="color:#999;font-size:12px;text-align:center;margin-top:28px;">
          If you need assistance, please contact the Finance or IT department.<br/>
          We apologize again for this inconvenience.
        </p>
      </div>
    </div>`;

  return transporter.sendMail({
    from:    `"${process.env.EMAIL_FROM_NAME || 'ERP System'}" <${process.env.EMAIL_USER || process.env.SMTP_USER}>`,
    to:      employee.email,
    subject: `[Action Required] Please Re-upload ${totalLost} Missing File(s) — ERP System`,
    html,
  });
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(65));
  console.log(' LOST ATTACHMENT IDENTIFICATION — ALL MODULES');
  console.log('='.repeat(65));
  console.log(SEND_EMAILS
    ? '📧 --notify flag detected. Emails WILL be sent.\n'
    : '📋 Report only. Pass --notify to also send emails.\n'
  );

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');

  // ── Run all scanners ───────────────────────────────────────────────────────
  const allAffected = [];

  const scanners = [
    scanPurchaseRequisitions,
    scanCashRequests,
    scanReimbursements,
  ];

  for (const scan of scanners) {
    try {
      const results = await scan();
      allAffected.push(...results);
    } catch (error) {
      console.error(`\n⚠️  Scanner failed: ${error.message}`);
    }
  }

  // ── Group by employee ──────────────────────────────────────────────────────
  const employeeMap = {};
  for (const record of allAffected) {
    const empId = record.employee?._id?.toString() || 'unknown';
    if (!employeeMap[empId]) {
      employeeMap[empId] = { employee: record.employee, records: [] };
    }
    employeeMap[empId].records.push(record);
  }
  const affectedEmployees = Object.values(employeeMap);

  // ── Console report ─────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(65));
  console.log(' DETAILED REPORT');
  console.log('='.repeat(65));

  const byModule = {};
  for (const r of allAffected) {
    if (!byModule[r.moduleName]) byModule[r.moduleName] = [];
    byModule[r.moduleName].push(r);
  }

  for (const [moduleName, records] of Object.entries(byModule)) {
    console.log(`\n${'─'.repeat(65)}`);
    console.log(` 📁 ${moduleName.toUpperCase()} (${records.length} affected)`);
    console.log('─'.repeat(65));

    for (const r of records) {
      console.log(`\n  📄 ${r.referenceNumber} — ${r.title}`);
      console.log(`     Employee   : ${r.employee?.fullName || 'Unknown'} <${r.employee?.email || 'N/A'}>`);
      console.log(`     Department : ${r.employee?.department || 'N/A'}`);
      console.log(`     Status     : ${r.status || 'N/A'}`);
      console.log(`     Submitted  : ${formatDate(r.submittedDate)}`);
      console.log(`     Lost files : ${r.lostCount}`);
      r.lostFiles.forEach(f => console.log(`       ❌ [${f.fieldLabel}] ${f.fileName}`));
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const totalLostFiles = allAffected.reduce((s, r) => s + r.lostCount, 0);

  console.log('\n' + '='.repeat(65));
  console.log(' SUMMARY');
  console.log('='.repeat(65));

  if (Object.keys(byModule).length === 0) {
    console.log('  ✅ No lost attachments found across any module.');
  } else {
    for (const [moduleName, records] of Object.entries(byModule)) {
      const lostInModule = records.reduce((s, r) => s + r.lostCount, 0);
      console.log(`  ${moduleName.padEnd(30)} : ${records.length} record(s), ${lostInModule} lost file(s)`);
    }
    console.log('─'.repeat(65));
    console.log(`  ${'TOTAL'.padEnd(30)} : ${allAffected.length} record(s), ${totalLostFiles} lost file(s)`);
    console.log(`  Affected employees         : ${affectedEmployees.length}`);
  }

  // ── CSV export ─────────────────────────────────────────────────────────────
  try {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const csvLines = [
      'Module,Employee Name,Email,Department,Reference #,Title/Purpose,Status,Submitted Date,File Section,Lost File Name'
    ];

    for (const r of allAffected) {
      for (const f of r.lostFiles) {
        csvLines.push([
          `"${r.moduleName}"`,
          `"${r.employee?.fullName || 'Unknown'}"`,
          `"${r.employee?.email    || 'N/A'}"`,
          `"${r.employee?.department || 'N/A'}"`,
          `"${r.referenceNumber}"`,
          `"${r.title}"`,
          `"${r.status || 'N/A'}"`,
          `"${formatDate(r.submittedDate)}"`,
          `"${f.fieldLabel}"`,
          `"${f.fileName}"`,
        ].join(','));
      }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const csvPath   = path.join(OUTPUT_DIR, `lost-attachments-${timestamp}.csv`);
    fs.writeFileSync(csvPath, csvLines.join('\n'), 'utf8');
    console.log(`\n📊 CSV saved to: ${csvPath}`);

  } catch (csvError) {
    console.error('⚠️  Could not write CSV:', csvError.message);
  }

  // ── Email notifications ────────────────────────────────────────────────────
  if (SEND_EMAILS) {
    console.log('\n' + '─'.repeat(65));
    console.log(' SENDING EMAIL NOTIFICATIONS');
    console.log('─'.repeat(65));

    let sent = 0, failed = 0;

    for (const { employee, records } of affectedEmployees) {
      if (!employee?.email) {
        console.log(`  ⚠️  Skipping ${employee?.fullName || 'Unknown'} — no email on record`);
        continue;
      }

      const modules   = [...new Set(records.map(r => r.moduleName))];
      const fileCount = records.reduce((s, r) => s + r.lostCount, 0);

      try {
        await sendReuploadEmail(employee, records);
        sent++;
        console.log(`  ✅ ${employee.fullName} <${employee.email}>`);
        console.log(`     → ${records.length} record(s), ${fileCount} file(s) across: ${modules.join(', ')}`);
      } catch (error) {
        failed++;
        console.log(`  ❌ ${employee.email} — ${error.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 600));
    }

    console.log(`\n  Emails sent   : ${sent}`);
    console.log(`  Emails failed : ${failed}`);

  } else {
    console.log('\nTo send notifications run:');
    console.log('  node scripts/identify-lost-attachments.js --notify');
  }

  console.log('\n' + '='.repeat(65));
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
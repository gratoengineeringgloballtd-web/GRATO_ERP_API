/**
 * attach-file-to-requisition.js
 *
 * Attaches a local file directly to a purchase requisition's `attachments`
 * array, uploading it to Cloudinary the same way the app's own attachment
 * code does (utils/cloudinaryStorage.js's saveFile). No API/auth token
 * needed — this connects straight to MongoDB, same as
 * resume-po-at-rejected-level.js / restart-po-approval-chain.js.
 *
 * ─── SETUP ────────────────────────────────────────────────────────────
 * Run this FROM YOUR BACKEND ROOT (same folder as package.json / .env):
 *
 *   node scripts/attach-file-to-requisition.js <requisitionId-or-number> <filePath>
 *
 * Example:
 *   node scripts/attach-file-to-requisition.js REQ202610050726 "C:\Users\user\Downloads\20261005-GRATO_ENG-ELECTRICITY_BILL_AND_CAMWATER-SEPTEMBER_2026.pdf"
 *
 * It reads your DB connection from MONGO_URI, and your Cloudinary creds
 * (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET) from
 * your .env — same as the running server.
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envCandidates = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '.env')
];
const envPath = envCandidates.find(p => fs.existsSync(p));
dotenv.config(envPath ? { path: envPath } : undefined);

const mongoose = require('mongoose');

const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.txt': 'text/plain'
};

async function main() {
  const [, , requisitionArg, filePath] = process.argv;

  if (!requisitionArg || !filePath) {
    console.error('Usage: node scripts/attach-file-to-requisition.js <requisitionId-or-number> <filePath>');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI not found. Run this from your backend root (same folder as your .env).');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  console.log('✅ Connected to MongoDB\n');

  const PurchaseRequisition = require('../models/PurchaseRequisition');
  const { saveFile, STORAGE_CATEGORIES } = require('../utils/cloudinaryStorage');

  let requisition = await PurchaseRequisition.findOne({ requisitionNumber: requisitionArg });
  if (!requisition && mongoose.isValidObjectId(requisitionArg)) {
    requisition = await PurchaseRequisition.findById(requisitionArg);
  }

  if (!requisition) {
    console.error(`❌ No requisition found matching "${requisitionArg}"`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Found requisition ${requisition.requisitionNumber} (${requisition._id})`);
  console.log(`  status: ${requisition.status}`);
  console.log(`  existing attachments: ${requisition.attachments?.length || 0}`);

  const originalname = path.basename(filePath);
  const ext = path.extname(originalname).toLowerCase();
  const buffer = fs.readFileSync(filePath);
  const file = {
    originalname,
    mimetype: MIME_BY_EXT[ext] || 'application/octet-stream',
    size: buffer.length,
    buffer
  };

  console.log(`\n📎 Uploading ${originalname} (${(file.size / 1024).toFixed(1)} KB, ${file.mimetype})...`);

  try {
    const fileMetadata = await saveFile(file, STORAGE_CATEGORIES.PURCHASE_REQUISITIONS, 'attachments', null);

    requisition.attachments = requisition.attachments || [];
    requisition.attachments.push({
      name: file.originalname,
      publicId: fileMetadata.publicId,
      url: fileMetadata.url,
      localPath: fileMetadata.localPath,
      size: file.size,
      mimetype: file.mimetype,
      uploadedAt: new Date()
    });

    await requisition.save();

    console.log(`\n✅ Uploaded and attached successfully.`);
    console.log(`   URL: ${fileMetadata.url}`);
    console.log(`\n${requisition.requisitionNumber} now has ${requisition.attachments.length} attachment(s).`);
  } catch (uploadError) {
    console.error(`\n❌ Upload failed: ${uploadError.message}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});

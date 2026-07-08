/**
 * scripts/attach-file-to-requisition.js
 *
 * Uploads a local file to Cloudinary (via utils/cloudinaryStorage.js) and
 * attaches it to a specific Purchase Requisition's attachments[] array.
 *
 * Usage:
 *   node scripts/attach-file-to-requisition.js
 *
 * Adjust FILE_PATH / REQUISITION_NUMBER below if reused for a different file/request.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');

const User                = require('../models/User'); // must be required before PurchaseRequisition (populate refs)
const PurchaseRequisition = require('../models/PurchaseRequisition');
const { saveFile, STORAGE_CATEGORIES } = require('../utils/cloudinaryStorage');

// ── Config ──────────────────────────────────────────────────────────────────
const REQUISITION_NUMBER = 'REQ202607073768';
const FILE_PATH = path.resolve(__dirname, '../public/2026707-GRATO ENG-ENEO-JUNE 2026.pdf');
const DISPLAY_NAME = '2026707-GRATO ENG-ENEO-JUNE 2026'; // shown to users as attachment name

// ── Magic-byte mimetype/extension detection (file has no extension on disk) ─
const detectFileType = (buffer) => {
  const magic = {
    pdf:  { sig: [0x25, 0x50, 0x44, 0x46], ext: '.pdf',  mimetype: 'application/pdf' },
    png:  { sig: [0x89, 0x50, 0x4e, 0x47], ext: '.png',  mimetype: 'image/png' },
    jpg:  { sig: [0xff, 0xd8, 0xff],       ext: '.jpg',  mimetype: 'image/jpeg' },
    gif:  { sig: [0x47, 0x49, 0x46, 0x38], ext: '.gif',  mimetype: 'image/gif' },
  };

  for (const { sig, ext, mimetype } of Object.values(magic)) {
    if (sig.every((byte, i) => buffer[i] === byte)) {
      return { ext, mimetype };
    }
  }

  // Fallback: assume PDF, since utility bills are almost always scanned/exported as PDF.
  console.warn('⚠️  Could not detect file signature — defaulting to application/pdf. Verify this is correct.');
  return { ext: '.pdf', mimetype: 'application/pdf' };
};

async function main() {
  console.log('='.repeat(65));
  console.log(' ATTACH FILE TO PURCHASE REQUISITION');
  console.log('='.repeat(65));

  // ── Validate file exists ───────────────────────────────────────────────────
  if (!fs.existsSync(FILE_PATH)) {
    console.error(`❌ File not found at: ${FILE_PATH}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(FILE_PATH);
  const { ext, mimetype } = detectFileType(buffer);
  console.log(`📄 Source file : ${FILE_PATH}`);
  console.log(`   Size        : ${(buffer.length / 1024).toFixed(2)} KB`);
  console.log(`   Detected    : ${mimetype} (${ext})`);

  // ── Connect to DB ───────────────────────────────────────────────────────────
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');

  // ── Find the requisition ────────────────────────────────────────────────────
  const requisition = await PurchaseRequisition.findOne({ requisitionNumber: REQUISITION_NUMBER });
  if (!requisition) {
    console.error(`❌ Requisition ${REQUISITION_NUMBER} not found`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`📋 Found requisition: ${requisition.requisitionNumber} — ${requisition.title}`);

  // ── Upload to Cloudinary ─────────────────────────────────────────────────────
  const fileForUpload = {
    buffer,
    originalname: `${DISPLAY_NAME}${ext}`,
    mimetype,
    size: buffer.length,
  };

  console.log('\n☁️  Uploading to Cloudinary...');
  const uploadResult = await saveFile(
    fileForUpload,
    STORAGE_CATEGORIES.PURCHASE_REQUISITIONS,
    requisition.requisitionNumber
  );

  // ── Build attachment entry matching the schema ───────────────────────────────
  const attachment = {
    name:       `${DISPLAY_NAME}${ext}`,
    url:        uploadResult.url,
    publicId:   uploadResult.publicId,
    localPath:  uploadResult.localPath, // cloudinaryStorage sets this to the secure_url
    size:       uploadResult.bytes || buffer.length,
    mimetype:   uploadResult.mimetype,
    uploadedAt: new Date(),
  };

  requisition.attachments.push(attachment);
  await requisition.save();

  console.log('\n✅ Attachment saved to requisition:');
  console.log(`   Name : ${attachment.name}`);
  console.log(`   URL  : ${attachment.url}`);
  console.log(`   Size : ${(attachment.size / 1024).toFixed(2)} KB`);
  console.log(`\n   Requisition attachments count: ${requisition.attachments.length}`);

  await mongoose.disconnect();
  console.log('\n' + '='.repeat(65));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
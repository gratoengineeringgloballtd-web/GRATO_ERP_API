/**
 * scripts/attach-utility-bill-july2026.js
 *
 * Uploads the July 2026 ENEO (electricity) + Camwater (water) utility bills PDF to
 * Cloudinary (via utils/cloudinaryStorage.js) and attaches it to Purchase Requisition
 * REQ202608048272's attachments[] array.
 *
 * This exists because the requisition's own attachment upload didn't go through at
 * submission time (see the resubmitRequisitionController.js / apiClient FormData fixes
 * from this session) — this script is a one-off backfill for that specific requisition.
 *
 * Usage:
 *   node scripts/attach-utility-bill-july2026.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');

const User                = require('../models/User'); // must be required before PurchaseRequisition (populate refs)
const PurchaseRequisition = require('../models/PurchaseRequisition');
const { saveFile, STORAGE_CATEGORIES } = require('../utils/cloudinaryStorage');

// ── Config ──────────────────────────────────────────────────────────────────
const REQUISITION_NUMBER = 'REQ202608048272';
const FILE_PATH = path.resolve(__dirname, '../public/2026804-GRATO ENG-UTILITY BILLS-JULY 2026.pdf');
const DISPLAY_NAME = '2026804-GRATO ENG-UTILITY BILLS-JULY 2026'; // shown to users as attachment name

// ── Magic-byte mimetype/extension detection (defensive, in case the file on disk
//    ever ends up without its extension — this one already has .pdf) ────────────
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

  // Avoid attaching the same file twice if this script is re-run.
  const alreadyAttached = requisition.attachments.some(a => a.name === `${DISPLAY_NAME}${ext}`);
  if (alreadyAttached) {
    console.log(`ℹ️  "${DISPLAY_NAME}${ext}" is already attached to this requisition — skipping upload.`);
    await mongoose.disconnect();
    return;
  }

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
